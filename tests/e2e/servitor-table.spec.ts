import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* "Маса" of the waiter (/servitor/masa/#n, src/modules/servitor/table.ts) on the real server: a QR order of a guest
   appears live, "Отивам" → "Обслужено" (+ "Отмени"), "Потвърди и прати" with the grams of a steak (the error over 2000 гр.),
   the kitchen cooks and finishes (its API), "Сервирах" (+ "Отмени"), "Сметка" by dishes in two payments (nothing twice),
   "Затвори масата" with an unserved dish → "Затвори въпреки това" → the closed sitting; "Откажи" with a reason and
   "Отмени"; 360 and 390, light and dark: no horizontal scroll, targets ≥ 48 px, axe without serious, no console errors.
   The clock is the preview clock 19:30 (page: ?preview=1&t=19:30, API: x-sc-clock; SC_PREVIEW_API=1) so the kitchen is
   open whenever the tests run. The projects use their own tables (phone 1, 2; desktop 3, 4). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const PASS: Record<string, string> = { admin: E.ADMIN_PASSWORD, waiter: E.WAITER_PASSWORD, kitchen: E.KITCHEN_PASSWORD };
const CLOCK = { "x-sc-clock": "19:30" };
const Q = "?preview=1&t=19:30";
const phone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const tables = (page: Page) => (phone(page) ? [1, 2] : [3, 4]);

async function signIn(ctx: BrowserContext | APIRequestContext, role: string) {
  const req = "request" in ctx ? ctx.request : ctx;
  const r = await req.post("/api/auth/login", { data: { username: role === "admin" ? E.ADMIN_USER || "admin" : role, password: PASS[role] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[1349]|net::ERR_/.test(m.text())) list.push(m.text()); });
  return list;
}
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
async function api<T = any>(req: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const r = await req.fetch("/api/" + path, { method, headers: CLOCK, data: data as object | undefined });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}
const g32 = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
/** a guest's phone at table n: the code from the admin's QR list */
async function guest(req: APIRequestContext, admin: APIRequestContext, n: number) {
  const rows = (await api<{ n: number; code: string }[]>(admin, "GET", "admin/qr")).body;
  const code = rows.find((x) => x.n === n)!.code, g = g32();
  const post = (p: string, b: Record<string, unknown> = {}) => api(req, "POST", "floor/t/" + code + "/" + p, { g, ...b });
  expect((await post("open", { fresh: true })).status).toBe(200);
  return { post };
}
/** the table is free before a test (the sitting of an earlier run is paid and closed) */
async function freeTable(w: APIRequestContext, n: number) {
  const d = (await api<any>(w, "GET", "floor/table/" + n)).body;
  if (!d.session) return;
  if (d.pending) await api(w, "POST", "floor/table/" + n + "/qr/reject", { reason: "test" });
  if (d.rest > 0) await api(w, "POST", "floor/table/" + n + "/pay", { how: "cash" });
  expect((await api(w, "POST", "floor/table/" + n + "/close", { force: true })).status).toBe(200);
}
async function open(page: Page, n: number, theme?: string) {
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem("st-prefs", JSON.stringify({ theme: t })); } catch { /* ignore */ } }, theme);
  await page.goto("/servitor/masa/" + Q + "#" + n);
  await expect(page.locator(".st-app:not([data-boot]) .st-top h1")).toHaveText("Маса " + n);
  await expect(page.locator("main .st-skel")).toHaveCount(0);
}
/** nothing sticks out of the phone column (the column clips, so scrollWidth alone would not show it) */
const clipped = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && el.offsetParent !== null && (r.right > innerWidth + 0.5 || r.left < -0.5) && !el.closest(".guests, .st-toast, .vh, .skip"); }).map((el) => el.tagName + "." + el.className));
const toast = (page: Page) => page.locator(".st-toast.on");

test.beforeAll(() => { test.skip(!E.WAITER_PASSWORD || !E.KITCHEN_PASSWORD || !E.ADMIN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("a QR order live → grams → kitchen → „Сервирах“ → the bill by dishes in two payments → „Затвори въпреки това“", async ({ page, playwright, baseURL }) => {
  const errs = errors(page), n = tables(page)[0];
  await signIn(page.context(), "waiter");
  const w = page.context().request;
  const admin = await playwright.request.newContext({ baseURL }); await signIn(admin, "admin");
  const kitchen = await playwright.request.newContext({ baseURL }); await signIn(kitchen, "kitchen");
  const anon = await playwright.request.newContext({ baseURL });
  await freeTable(w, n);
  await open(page, n);
  await expect(page.locator("main h2")).toContainText("Масата е свободна");
  await expect(page.locator(".st-nav")).toHaveCount(0);
  await expect(page.locator(".st-top .st-back")).toHaveText("Маси");

  /* a guest scans, calls for water and sends the first order (it waits for the waiter): the screen follows live */
  const G = await guest(anon, admin, n);
  expect((await G.post("call", { kind: "water" })).status).toBe(200);
  await expect(page.locator(".cstrip")).toContainText("Вика · Вода / прибори");
  await page.locator(".cstrip [data-take]").click();
  await expect(toast(page)).toContainText("Маса " + n + ": отивам");
  await expect(page.locator(".cstrip [data-done]")).toBeFocused();
  await expect(page.locator(".cstrip.taken")).toContainText("отивам");
  await page.locator(".cstrip [data-done]").click();
  await expect(toast(page)).toContainText("Маса " + n + ": обслужено");
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect(page.locator(".cstrip [data-done]")).toBeVisible();
  await page.locator(".cstrip [data-done]").click();
  await expect(page.locator(".cstrip")).toHaveCount(0);

  await G.post("cart/add", { id: "pitsa-margarita", q: 2 });
  await G.post("cart/add", { id: "ribay-stek-ot-blek-angas" });
  expect((await G.post("send")).body.to).toBe("waiter");
  const card = page.locator(".qrcard");
  await expect(card).toContainText("Поръчка от QR · чака потвърждение");
  await expect(card).toContainText("Пица Маргарита");
  await expect(card).toContainText("9,20 € за 100 гр.");
  await expect(page.locator(".st-bar [data-reject]")).toHaveText("Откажи");

  /* "Потвърди и прати": the steak asks its grams first (over 2000: the error, the button is off) */
  await page.locator(".st-bar [data-confirm]").click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator("h2")).toHaveText("Грамаж");
  await sh.locator("#gg").fill("2500");
  await expect(sh.locator("#ggerr")).toHaveText("До 2000 гр. За повече: две отделни парчета.");
  await expect(sh.locator("[data-gok]")).toBeDisabled();
  await sh.locator('[data-gr="500"]').click();
  await expect(sh.locator("[data-gok]")).toHaveText("Потвърди и прати · 46,00 €");
  await sh.locator("[data-gok]").click();
  await expect(toast(page)).toContainText("Потвърдено и изпратено в кухнята · №");
  await expect(page.locator(".ono").first()).toBeFocused();
  await expect(page.locator(".qrcard")).toHaveCount(0);
  await expect(page.locator(".ocard")).toContainText("Рибай стек от Блек Ангъс · 500 гр.");
  await expect(page.locator(".ocard .stt.acc").first()).toContainText("Прието");
  const no = (await api<any>(w, "GET", "floor/table/" + n)).body.bills[0].orders[0].no as string;
  await expect(page.locator(".ono").first()).toContainText("№ " + no + " · ");
  await expect(page.locator(".ono").first()).toContainText("от QR");

  /* the kitchen cooks and finishes: the lines are live "Готви се", then "Готово за сервиране" with "Сервирах" */
  expect((await api(kitchen, "POST", "kitchen/orders/" + no + "/start", { sec: "all" })).status).toBe(200);
  await expect(page.locator(".ocard .stt.cook").first()).toContainText("Готви се");
  expect((await api(kitchen, "POST", "kitchen/orders/" + no + "/done", { sec: "all" })).status).toBe(200);
  await expect(page.locator("[data-serve]")).toHaveCount(2);
  await page.locator("[data-serve]").first().click();
  await expect(toast(page)).toContainText("Маса " + n + ": сервирано");
  /* the focus goes on to the next "Сервирах", never to the page */
  await expect(page.locator("[data-serve]").first()).toBeFocused();
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect(page.locator("[data-serve]")).toHaveCount(2);
  await page.locator('[data-serve$=":0"]').click();
  await expect(page.locator("[data-serve]")).toHaveCount(1);
  expect(await page.evaluate(() => document.activeElement && document.activeElement.tagName)).not.toBe("BODY");
  await expect(page.locator(".oline.served")).toContainText("Пица Маргарита");

  /* "Сметка" by dishes: two payments, each keeps its lines, the paid one is struck and off */
  await page.locator(".st-bar [data-bill]").click();
  await expect(sh.locator("h2")).toHaveText("Сметка · Маса " + n);
  await sh.locator('[data-m="dishes"]').click();
  await expect(sh.locator("[data-pay]")).toHaveText("Избери ястия");
  await sh.locator(".chk", { hasText: "Пица Маргарита" }).locator("input").check();
  await expect(sh.locator("[data-pay]")).toHaveText("Маркирай платено · 14,30 €");
  await sh.locator("[data-pay]").click();
  await expect(toast(page)).toContainText("Платено 14,30 € в брой");
  await expect(sh.locator(".chk", { hasText: "Пица Маргарита" }).locator("input")).toBeDisabled();
  await expect(sh.locator(".chk", { hasText: "Пица Маргарита" })).toContainText("платено");
  await sh.locator(".chk", { hasText: "Рибай" }).locator("input").check();
  await sh.locator('[data-p="card"]').click();
  await expect(sh.locator("[data-pay]")).toHaveText("Маркирай платено · 46,00 €");
  await sh.locator("[data-pay]").click();
  await expect(toast(page)).toContainText("Платено 46,00 € с карта");
  await expect(page.locator(".st-sheetwrap.on")).toHaveCount(0);
  const d = (await api<any>(w, "GET", "floor/table/" + n)).body;
  expect(d.payments.map((p: any) => [p.how, p.sum, p.keys.length])).toEqual([["cash", 14.3, 1], ["card", 46, 1]]);
  expect(d.rest).toBe(0);
  /* nothing is paid twice */
  expect((await api(w, "POST", "floor/table/" + n + "/pay", { how: "cash", keys: d.payments[0].keys })).status).toBe(409);
  await expect(page.locator(".paidrow").last()).toContainText("всичко е платено");
  await expect(page.locator(".st-bar [data-bill]")).toHaveCount(0);

  /* "Затвори масата": the steak is not served → listed → "Затвори въпреки това" */
  await page.locator("[data-close-table]").click();
  await expect(sh.locator(".notice")).toContainText("1 ястие още не е сервирано: 1× Рибай стек от Блек Ангъс · 500 гр.");
  await sh.getByRole("button", { name: "Затвори въпреки това" }).click();
  await expect(page.locator("main")).toContainText("Масата е затворена");
  await expect(page.locator("main")).toContainText("Следващите гости ще отворят нова сесия, като сканират кода на масата отново.");
  await expect(toast(page)).toContainText("Маса " + n + " е свободна");
  expect((await api<any>(w, "GET", "floor/table/" + n)).body.session).toBeNull();
  expect(errs).toEqual([]);
  await Promise.all([admin.dispose(), kitchen.dispose(), anon.dispose()]);
});

test("„Откажи“ asks the reason and has „Отмени“; guests without an order; „Гостите седнаха“", async ({ page, playwright, baseURL }) => {
  const errs = errors(page), n = tables(page)[1];
  await signIn(page.context(), "waiter");
  const w = page.context().request;
  const admin = await playwright.request.newContext({ baseURL }); await signIn(admin, "admin");
  const anon = await playwright.request.newContext({ baseURL });
  await freeTable(w, n);
  await open(page, n);
  await page.getByRole("button", { name: "Гостите седнаха" }).click();
  await expect(page.locator("main .notice")).toContainText("Гостите са седнали преди 1 мин и още нямат поръчка.");
  await expect(page.locator(".thead .stt")).toContainText("Чака поръчка");

  const G = await guest(anon, admin, n);
  await G.post("cart/add", { id: "kebapcheta", q: 3 });
  await G.post("send");
  await expect(page.locator(".qrcard")).toContainText("Кебапчета");
  await page.locator(".st-bar [data-reject]").click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator("h2")).toHaveText("Да откажа ли поръчката?");
  await expect(sh.locator("[data-rj]")).toBeDisabled();
  await expect(sh.locator("[data-r]")).toHaveText(["Тестова или по грешка", "Гостите се отказаха", "Ще я въведа аз"]);
  await sh.getByRole("button", { name: "Гостите се отказаха" }).click();
  await expect(sh.getByRole("button", { name: "Гостите се отказаха" })).toHaveAttribute("aria-pressed", "true");
  await sh.locator("[data-rj]").click();
  await expect(toast(page)).toContainText("Поръчката е отказана");
  await expect(page.locator(".qrcard")).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect(page.locator(".qrcard")).toContainText("Кебапчета");
  /* the guests see the refusal after a second "Откажи" */
  await page.locator(".st-bar [data-reject]").click();
  await sh.getByRole("button", { name: "Тестова или по грешка" }).click();
  await sh.locator("[data-rj]").click();
  await expect(page.locator(".qrcard")).toHaveCount(0);
  const v = (await G.post("view")).body as { rejected: { reason: string } | null };
  expect(v.rejected && v.rejected.reason).toBe("test");
  expect(errs).toEqual([]);
  await Promise.all([admin.dispose(), anon.dispose()]);
});

test("360 and 390, light and dark: no horizontal scroll, targets ≥ 48 px, axe without serious @phone", async ({ browser, baseURL }) => {
  for (const [width, theme] of [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, baseURL });
    await signIn(ctx, "waiter");
    const page = await ctx.newPage(), errs = errors(page), n = 2;
    if (width === 360 && theme === "light") {
      await freeTable(ctx.request, n);
      expect((await api(ctx.request, "POST", "floor/table/" + n + "/order", { lines: [{ id: "svinski-vrat", q: 1, guest: "Гост 1", note: "средно изпечен" }, { id: "tiramisu", q: 2, guest: "Гост 2" }], note: "десертът накрая" })).status).toBe(201);
    }
    await open(page, n, theme);
    await expect(page.locator(".ocard")).toHaveCount(2);
    await expect(page.locator(".onote").first()).toContainText("десертът накрая");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await clipped(page)).toEqual([]);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main button, main a, .st-bar button, .st-bar a, .st-top button, .st-top a"))
      .filter((el) => el.offsetParent !== null).map((el) => { const r = el.getBoundingClientRect(); return [el.textContent!.trim() || el.getAttribute("aria-label"), Math.round(r.width), Math.round(r.height)] as const; }).filter((x) => x[1] < 48 || x[2] < 48));
    expect(small).toEqual([]);
    await page.locator(".st-bar [data-bill]").click();
    await expect(page.locator(".st-sheetwrap.on .st-sheet h2")).toHaveText("Сметка · Маса " + n);
    await expect(page.locator('.st-sheetwrap.on [data-m="guests"]')).toHaveAttribute("aria-pressed", "true");
    expect(await serious(page)).toEqual([]);
    expect(errs).toEqual([]);
    await ctx.close();
  }
});
