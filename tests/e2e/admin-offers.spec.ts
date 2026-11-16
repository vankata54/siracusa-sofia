import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { env, ownServer, signIn, errors, toastHas, undo, tap, noHScroll, isPhone, type Srv } from "./sales-helpers.ts";

/* /admin/offers/ (design/pages-admin/offers.html): "Никаква отстъпка срещу отзив в Google" on top and a new offer about a
   Google review refused; -30% locked and explained; -5% waits for the days ("Ранна резервация: дни"), the loyalty card for
   its rule; "В сайта" off / on with "Отмени" and "Сайтът се пресглобява"; "Правила" (days, hours, channel); a new offer
   (off) and "Изтрий" with "Отмени"; "Празник: цена"; the codes (SC10- from the rating, SCV- vouchers: new, check, "Използван");
   the inquiries for a voucher with the phone hidden until "Покажи телефона"; the rights; the site: the banner of the
   profile offer at /api/offers. Its own server per project (port E2E_PORT + 6 / + 7). */
let S: Srv;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!env.ADMIN_PASSWORD || !env.MARKETING_PASSWORD || !env.DRIVER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("offers", info, [6, 7]);
});
test.afterAll(async () => { if (S) await S.stop(); });

const offer = (page: import("@playwright/test").Page, id: string) => page.locator('.of[data-id="' + id + '"]');

test("the offers: no discount for a Google review, -30% locked, -5% and the stamps wait, axe", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/offers/");
  await expect(page.locator(".sa-h1")).toHaveText("Оферти и ваучери");
  await expect(page.locator(".of-policy")).toContainText("Никаква отстъпка срещу отзив в Google.");
  await expect(page.locator(".of")).toHaveCount(7);
  await expect(offer(page, "lunch30").locator("[data-on]")).toBeDisabled();
  await expect(offer(page, "lunch30")).toContainText("Заключено");
  await expect(offer(page, "celebration").locator("[data-on]")).toBeDisabled();
  await expect(offer(page, "celebration")).toContainText("[ЛИПСВА: колко дни]");
  await expect(offer(page, "loyalty").locator("[data-on]")).toBeDisabled();
  await expect(offer(page, "rating")).toContainText("Еднакво при „Да“ и при „Не“");
  /* the locked rule: only shown */
  await tap(offer(page, "lunch30").locator("[data-rules]"));
  await expect(page.locator(".sheetwrap.on .of-lock")).toContainText("Тук само се вижда");
  await expect(page.locator(".sheetwrap.on #ofs-from")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheetwrap")).toHaveCount(0);
  const a = await new AxeBuilder({ page }).include("main").analyze();
  expect(a.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  if (isPhone(page)) { await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(200); await noHScroll(page); }
  expect(errs).toEqual([]);
});

test("„В сайта“ off and „Отмени“; the rules of an offer; the site gets the change", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/offers/");
  const sw = offer(page, "signup").locator("[data-on]");
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" })); await sw.click({ force: true });
  await toastHas(page, "Изключена от сайта: Направете профил.");
  await toastHas(page, /Сайтът се пресглобява\.|В демото сайтът не се пресглобява\./);
  await expect(offer(page, "signup")).toHaveClass(/\boff\b/);
  const banner = async () => ((await (await context.request.get(S.base + "/api/offers")).json()) as { id: string }[]).map((o) => o.id);
  await expect.poll(banner).not.toContain("signup");
  await undo(page);
  await expect(offer(page, "signup")).not.toHaveClass(/\boff\b/);
  await expect.poll(banner).toContain("signup");

  await tap(offer(page, "rating").locator("[data-rules]"));
  const s = page.locator(".sheetwrap.on .sheet");
  await s.locator('[data-d="6"]').click(); await s.locator('[data-d="0"]').click(); /* сб, нд off */
  await s.locator('[data-c="table"]').click();
  await page.locator(".sheetwrap.on [data-ok]").click();
  await toastHas(page, "Правила: Кажете ни как беше · пн - пт, 10:00 - 22:30.");
  await expect(offer(page, "rating")).toContainText("пн - пт");
  await expect(offer(page, "rating")).toContainText("Доставка, Вземане");
  expect(errs).toEqual([]);
});

test("a new offer: a Google review is refused; added off; „Изтрий“ and „Отмени“", async ({ page, context }) => {
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/offers/");
  await page.locator("[data-newoffer]").first().click();
  const s = page.locator(".sheetwrap.on .sheet");
  await expect(s.locator("#ofs-t")).toBeFocused();
  await s.locator("#ofs-t").fill("-15% за отзив в Google");
  await page.locator(".sheetwrap.on [data-ok]").click();
  await expect(s.locator("#ofs-t-e")).toHaveText("Отстъпка срещу отзив в Google не се дава (правила на Google).");
  /* the core refuses it too (decision 30) */
  const r = await context.request.post(S.base + "/api/admin/offers", { data: { title: "Отстъпка за ревю", pct: 10, r: { days: [1], from: "10:00", to: "22:30", ch: ["pickup"], dish: "all" } } });
  expect(r.status()).toBe(422);
  await s.locator("#ofs-t").fill("Пица на обяд");
  await s.locator("#ofs-x").fill("Всяка пица -15% при вземане.");
  await s.locator("#ofs-p").fill("15");
  await page.locator(".sheetwrap.on [data-ok]").click();
  await toastHas(page, "Нова оферта: Пица на обяд");
  const mine = page.locator(".of", { hasText: "Пица на обяд" });
  await expect(mine).toHaveClass(/\boff\b/);
  await expect(mine).toContainText("Добавена от вас");
  await tap(mine.locator("[data-del]"));
  await page.locator(".sheetwrap.on [data-yes]").click();
  await toastHas(page, "Изтрита оферта: Пица на обяд.");
  await expect(page.locator(".of", { hasText: "Пица на обяд" })).toHaveCount(0);
  await undo(page);
  await expect(page.locator(".of", { hasText: "Пица на обяд" })).toHaveCount(1);
});

test("„Празник при нас“: the price of the calculator and the early days turn -5% on", async ({ page, context }) => {
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/offers/");
  await tap(page.locator('[data-cp="estimate"]'));
  await toastHas(page, "Цена в калкулатора на празник: ориентировъчна. Сайтът го показва веднага.");
  await expect(page.locator('[data-cp="estimate"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#of-ed").fill("400");
  await page.locator("[data-saveed]").click();
  await expect(page.locator("#of-ed-e")).toHaveText("Дните са цяло число от 1 до 365 (или празно).");
  await page.locator("#of-ed").fill("14");
  await page.locator("[data-saveed]").click();
  await toastHas(page, "Ранна резервация: поне 14 дни по-рано");
  await expect(offer(page, "celebration").locator("[data-on]")).toBeEnabled();
  const st = await (await context.request.get(S.base + "/api/status")).json() as { celebrationPrice: string; earlyDays: number | null };
  expect(st).toMatchObject({ celebrationPrice: "estimate", earlyDays: 14 });
});

test("codes: SC10- unknown, new SCV- vouchers, check and „Използван“", async ({ page, context }) => {
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/offers/#t=codes");
  await expect(page.locator('[data-tab="codes"]')).toHaveAttribute("aria-selected", "true");
  await page.locator("#of-code").fill("sc10 4829 163 057");
  await page.locator("[data-chk] button").click();
  await expect(page.locator("[data-res]")).toContainText("Няма такъв код.");
  await tap(page.locator("[data-gen]"));
  const s = page.locator(".sheetwrap.on .sheet");
  await s.locator("#og-v").fill("50");
  await s.locator("#og-n").fill("2");
  await page.locator(".sheetwrap.on [data-ok]").click();
  await expect(s.locator(".of-new")).toContainText("Готово: 2 кода");
  const code = (await s.locator(".of-new .mono").first().innerText()).trim();
  expect(code).toMatch(/^SCV-\d{10}$/);
  await page.locator(".sheetwrap.on [data-close]").click();
  await expect(page.locator(".of-codes tbody tr")).toHaveCount(2);
  await page.locator("#of-code").fill(code.toLowerCase().replace("-", " "));
  await page.locator("[data-chk] button").click();
  await expect(page.locator("[data-res]")).toContainText("Валиден код · 50,00 € ваучер");
  await page.locator("[data-res] [data-use]").click();
  await toastHas(page, "Отбелязан като използван: " + code);
  await page.locator("[data-chk] button").click();
  await expect(page.locator("[data-res]")).toContainText("Този код вече е използван.");
});

test("inquiries: a voucher from the site, the phone hidden until „Покажи телефона“, „Обадихме се“", async ({ page, context }) => {
  await signIn(context, S.base);
  const f = await context.request.post(S.base + "/api/feedback", { data: { name: "Клиент 1", contact: "0888123456", mode: "phone", topic: "voucher", message: "Запитване за ваучер за подарък: 50,00 €. За кого / повод: рожден ден" } });
  expect(f.ok()).toBe(true);
  await page.goto(S.base + "/admin/offers/#t=iq");
  const q = page.locator(".iq").first();
  await expect(q.locator("h3")).toHaveText("Ваучер за 50,00 €");
  await expect(q).toContainText("0888 •• •• 56");
  await expect(q).not.toContainText("0888123456");
  await q.locator("[data-show]").click();
  await expect(q.locator('a[href^="tel:"]').first()).toBeVisible();
  await tap(q.locator('[data-qs="called"]'));
  await toastHas(page, "Обадихме се: ваучер, Клиент 1");
  await expect(page.locator(".iq").first().locator(".sa-tag").first()).toHaveText("Обадихме се");
});

test("rights: Маркетинг has the offers, Шофьор does not", async ({ page, context }) => {
  await signIn(context, S.base, "marketing");
  await page.goto(S.base + "/admin/offers/");
  await expect(page.locator(".of-policy")).toBeVisible();
  await signIn(context, S.base, "driver");
  expect((await context.request.get(S.base + "/api/admin/offers")).status()).toBe(403);
});
