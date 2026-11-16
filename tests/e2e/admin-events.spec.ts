import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { env, ownServer, signIn, errors, toastHas, undo, tap, noHScroll, isPhone, rebuilt, type Srv } from "./sales-helpers.ts";

/* /admin/events/ (design/pages-admin/events.html): Предстоящи / Минали, the monthly Greek night (never deleted, its date
   stays the last Saturday), "Ново събитие" with the checks of the core (name, date not in the past), the live preview
   "Така изглежда в сайта", "Запази чернова" -> "Публикувай" -> "Изтрий" -> "Отмени", "Сайтът се пресглобява", the rights.
   With a REAL rebuild (desktop project only, the rebuild is slow): the new event's page /sabitia/<id>/ shows its program
   and its menu (EVENT_EXTRA); the Greek night without them keeps [ЛИПСВА]. Its own server per project (E2E_PORT + 8 / + 9). */
let S: Srv;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!env.ADMIN_PASSWORD || !env.MARKETING_PASSWORD || !env.DRIVER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("events", info, [8, 9]);
});
test.afterAll(async () => { if (S) await S.stop(); });

const ymdPlus = (n: number) => { const d = new Date(Date.now() + n * 864e5); return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); };

test("the list: the Greek night in the site (no „Изтрий“), the past tab, axe", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/events/");
  await expect(page.locator(".sa-h1")).toHaveText("Събития");
  const g = page.locator(".ev").first();
  await expect(g.locator("h3")).toHaveText("Гръцка вечер");
  await expect(g).toContainText("В сайта");
  await expect(g).toContainText("[ЛИПСВА: програма и меню]");
  await expect(g.locator("[data-del]")).toHaveCount(0);
  await expect(g).toContainText("Не се трие");
  expect((await context.request.delete(S.base + "/api/admin/events/" + (await g.getAttribute("data-id")))).status()).toBe(409);
  await page.locator('[data-tab="past"]').click();
  await expect(page).toHaveURL(/#t=past/);
  await expect(page.locator("#ev-p")).toContainText("Още няма минали събития.");
  await page.locator('[data-tab="up"]').click();
  const a = await new AxeBuilder({ page }).include("main").analyze();
  expect(a.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  if (isPhone(page)) { await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(200); await noHScroll(page); }
  expect(errs).toEqual([]);
});

test("a new event: the checks, a draft with the preview, „Публикувай“, „Изтрий“ and „Отмени“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/events/");
  await page.locator("[data-new]").first().click();
  const s = page.locator(".sheetwrap.on .sheet");
  await expect(s.locator("#ef-n")).toBeFocused();
  await page.locator(".sheetwrap.on [data-draft]").click();
  await expect(s.locator("#ef-n-e")).toHaveText("Напишете име, например „Гръцка вечер“.");
  await expect(s.locator("#ef-date-e")).toHaveText("Изберете дата.");
  await s.locator("#ef-n").fill("Вечер на виното");
  await s.locator("#ef-date").fill(ymdPlus(10));
  await s.locator('[data-pm="free"]').click();
  await s.locator("#ef-seats").fill("6");
  await expect(s.locator("[data-prev]")).toContainText("Вечер на виното");
  await expect(s.locator("[data-prev]")).toContainText("Вход свободен");
  await expect(s.locator("[data-prev]")).toContainText("Остават 6 места");
  await page.locator(".sheetwrap.on [data-draft]").click();
  await toastHas(page, "Чернова: Вечер на виното");
  const card = page.locator(".ev", { hasText: "Вечер на виното" });
  await expect(card).toContainText("Чернова");
  await expect(card).toContainText("След 10 дни");
  await tap(card.locator("[data-pub]"));
  await toastHas(page, "Публикувано в сайта: Вечер на виното");
  await toastHas(page, /Сайтът се пресглобява\.|В демото сайтът не се пресглобява\./);
  await expect(card).toContainText("В сайта");
  const pub = async () => ((await (await context.request.get(S.base + "/api/events")).json()) as { n: string }[]).map((e) => e.n);
  await expect.poll(pub).toContain("Вечер на виното");
  await tap(card.locator("[data-del]"));
  await expect(page.locator(".sheetwrap.on h2")).toHaveText("Да изтрием ли „Вечер на виното“?");
  await page.locator(".sheetwrap.on [data-yes]").click();
  await toastHas(page, "Изтрито: Вечер на виното.");
  await expect(page.locator(".ev", { hasText: "Вечер на виното" })).toHaveCount(0);
  await undo(page);
  await expect(page.locator(".ev", { hasText: "Вечер на виното" })).toContainText("В сайта");
  await expect.poll(pub).toContain("Вечер на виното");
  expect(errs).toEqual([]);
});

test("the Greek night: changed, never hidden; its date stays the last Saturday", async ({ page, context }) => {
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/events/");
  await tap(page.locator(".ev", { hasText: "Гръцка вечер" }).locator("[data-edit]"));
  const s = page.locator(".sheetwrap.on .sheet");
  await expect(s.locator("#ef-date")).toBeDisabled();
  await expect(s).toContainText("Всяка последна събота на месеца.");
  await expect(page.locator(".sheetwrap.on [data-draft]")).toHaveCount(0);
  await expect(page.locator(".sheetwrap.on [data-ok]")).toHaveText("Запази");
});

test("@desktop the site after a real rebuild: the program and the menu of the evening on its page", async ({ page, context }) => {
  test.setTimeout(300_000);
  await signIn(context, S.base);
  const r = await context.request.post(S.base + "/api/admin/events", { data: { n: "Италианска вечер", cat: "Тематични вечери", date: ymdPlus(20), time: "19:00", text: "Паста и музика.", prog: "19:00 Посрещане\n20:30 Жива музика", menu: "Брускета\nПаста карбонара", priceMode: "price", price: 25, publish: true } });
  expect(r.ok()).toBe(true);
  const id = (await r.json() as { id: string }).id;
  const b = await rebuilt(context, S.base);
  expect(b.error || "").toBe("");
  await expect.poll(async () => (await context.request.get(S.base + "/sabitia/" + id + "/")).status(), { timeout: 200_000 }).toBe(200);
  await page.goto(S.base + "/sabitia/" + id + "/");
  await expect(page.locator(".tl")).toContainText("Посрещане");
  await expect(page.locator(".tl")).toContainText("20:30");
  await expect(page.locator("[data-evmenu]")).toContainText("Паста карбонара");
  await expect(page.locator(".ev-also")).toHaveCount(0);
  /* the Greek night has no program yet: [ЛИПСВА] stays */
  const ev = (await (await context.request.get(S.base + "/api/events")).json()) as { id: string; n: string }[];
  await page.goto(S.base + "/sabitia/" + ev.find((e) => e.n === "Гръцка вечер")!.id + "/");
  await expect(page.locator(".tl")).toContainText("[ЛИПСВА");
});

test("rights: Маркетинг has the events, Шофьор does not", async ({ page, context }) => {
  await signIn(context, S.base, "marketing");
  await page.goto(S.base + "/admin/events/");
  await expect(page.locator(".ev").first()).toBeVisible();
  await signIn(context, S.base, "driver");
  expect((await context.request.get(S.base + "/api/admin/events")).status()).toBe(403);
});
