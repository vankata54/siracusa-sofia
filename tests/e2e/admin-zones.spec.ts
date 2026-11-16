import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { env, ownServer, signIn, errors, toastHas, undo, tap, noHScroll, isPhone, type Srv } from "./sales-helpers.ts";

/* /admin/zones/ (design/pages-admin/zones.html): the map and the six quarters with [ЛИПСВА] for the fee of Горубляне and
   Гара Искър and the minimum order, "Нарисувай зона · Скоро", "Натоварено" in "Настройки"; the sheet (fee, minimum, time,
   hours up to 21:00, the check of the hours), "Доставяме" off with "Отмени", "Сайтът се пресглобява"; the rights.
   The site follows at once (the live zones of the core): /dostavka/ shows the minimum order and the quarter that is off,
   the cart stops a delivery to it and below the minimum. Its own server per project (port E2E_PORT + 4 / + 5). */
let S: Srv;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!env.ADMIN_PASSWORD || !env.MARKETING_PASSWORD || !env.DRIVER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("zones", info, [4, 5]);
});
test.afterAll(async () => { if (S) await S.stop(); });

const card = (page: import("@playwright/test").Page, slug: string) => page.locator("#z-" + slug);

test("the screen: summary, the map, [ЛИПСВА] for the fees and the minimum, „Скоро“, the link to „Настройки“, axe", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/zones/");
  await expect(page.locator(".sa-h1")).toHaveText("Зони за доставка");
  await expect(page.locator(".zn-z")).toHaveCount(6);
  await expect(page.locator(".map .z")).toHaveCount(6);
  await expect(card(page, "gorublyane")).toContainText("[ЛИПСВА: в €]");
  await expect(card(page, "gara-iskar").locator(".zn-facts dd").first()).toHaveText("[ЛИПСВА: в €]");
  await expect(card(page, "druzhba-2")).toContainText("около 25 мин");
  await expect(card(page, "druzhba-2")).toContainText("10:00 - 21:00");
  await expect(page.locator(".zn-sum")).toContainText("до 21:00");
  await expect(page.locator(".zn-draw")).toBeDisabled();
  await expect(page.locator(".zn-draw")).toHaveText("Нарисувай зона · Скоро");
  await expect(page.locator(".zn-note a")).toHaveAttribute("href", /\/admin\/settings\//);
  /* the map selects the card (keyboard too) */
  await page.locator('.map .z[data-zone="busmantsi"]').focus();
  await page.keyboard.press("Enter");
  await expect(card(page, "busmantsi")).toHaveClass(/\bon\b/);
  await expect(page).toHaveURL(/#z=busmantsi/);
  const a = await new AxeBuilder({ page }).include("main").analyze();
  expect(a.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
  if (isPhone(page)) { await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(200); await noHScroll(page); }
  expect(errs).toEqual([]);
});

test("the sheet: fee and minimum order, the check of the hours, „Отмени“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/zones/#z=gorublyane");
  await tap(card(page, "gorublyane").locator("[data-edit]"));
  const s = page.locator(".sheetwrap.on .sheet");
  await expect(s.locator("h2")).toHaveText("Горубляне");
  await s.locator("#zf-fee").fill("abc");
  await s.locator("#zf-from").selectOption("20:00");
  await s.locator("#zf-to").selectOption("19:00");
  await page.locator(".sheetwrap.on [data-ok]").click();
  await expect(s.locator("#zf-fee-e")).toHaveText("Напишете таксата като 2,50 или оставете празно.");
  await expect(s.locator("#zf-to-e")).toHaveText("Краят е след началото.");
  await expect(s.locator("#zf-fee")).toBeFocused();
  await s.locator("#zf-fee").fill("2,50");
  await s.locator("#zf-min").fill("15");
  await s.locator("#zf-from").selectOption("10:00");
  await s.locator("#zf-to").selectOption("21:00");
  await expect(s.locator("[data-prev]")).toContainText("2,50 €");
  await expect(s.locator("[data-prev]")).toContainText("15,00 €");
  await page.locator(".sheetwrap.on [data-ok]").click();
  await toastHas(page, "Горубляне: такса 2,50 €, мин. поръчка 15,00 €.");
  await toastHas(page, /Сайтът се пресглобява\.|В демото сайтът не се пресглобява\./);
  await expect(card(page, "gorublyane").locator(".zn-facts")).toContainText("2,50 €");
  await expect(card(page, "gorublyane").locator(".zn-facts")).toContainText("15,00 €");
  const z = await (await context.request.get(S.base + "/api/zones")).json() as { slug: string; fee: number | null; min: number | null }[];
  expect(z.find((x) => x.slug === "gorublyane")).toMatchObject({ fee: 2.5, min: 15 });
  await undo(page);
  await expect(card(page, "gorublyane").locator(".zn-facts dd").first()).toHaveText("[ЛИПСВА: в €]");
  await expect(page.locator("[data-site-line]")).toContainText("Последна промяна");
  /* the person's name, never the user name */
  if (env.ADMIN_NAME && env.ADMIN_NAME !== (env.ADMIN_USER || "admin")) await expect(page.locator("[data-site-line]")).toContainText("от " + env.ADMIN_NAME);
  expect(errs).toEqual([]);
});

test("the site follows: minimum order and a quarter that is off on /dostavka/ and in the cart", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, S.base);
  /* through the API of the screen (the same core): Бусманци off, Горубляне with a fee and a minimum of 50 € */
  expect((await context.request.patch(S.base + "/api/admin/zones/busmantsi", { data: { on: false } })).status()).toBe(200);
  expect((await context.request.patch(S.base + "/api/admin/zones/gorublyane", { data: { fee: 3, min: 50 } })).status()).toBe(200);
  await page.goto(S.base + "/admin/zones/");
  await expect(card(page, "busmantsi")).toHaveClass(/\boff\b/);
  await expect(card(page, "busmantsi")).toContainText("Не доставяме");
  await expect(page.locator('.map .z[data-zone="busmantsi"]')).toHaveClass(/\boff\b/);

  await page.goto(S.base + "/dostavka/?preview=1&t=12:30#busmantsi");
  await expect(page.locator("[data-zcard]")).toContainText("Временно не доставяме до Бусманци");
  await expect(page.locator('[data-row="busmantsi"]')).toContainText("Временно не доставяме");
  await expect(page.locator('[data-row="busmantsi"] small')).toHaveText("");
  /* the head and the answers follow the live zones: the quarter that is off is never promised as free */
  await expect(page.locator("[data-lead]")).toHaveText("Безплатно до Дружба 1 и 2 и НПЗ Искър. До Горубляне и Гара Искър по тарифа. Временно не доставяме до Бусманци. Всеки ден от 10:00 до 21:00.");
  await expect(page.locator("[data-feeans]")).toContainText("Временно не доставяме до Бусманци.");
  await expect(page.locator("[data-feeans]")).not.toContainText("НПЗ Искър и Бусманци");
  await expect(page.locator(".minline")).toContainText("Горубляне 50,00 €");
  await tap(page.locator('[data-pick="gorublyane"]'));
  await expect(page.locator("[data-zcard]")).toContainText("50,00 €");
  await expect(page.locator("[data-zcard]")).toContainText("3,00 €");

  await page.addInitScript(() => {
    if (sessionStorage.getItem("zn-init")) return; sessionStorage.setItem("zn-init", "1");
    localStorage.setItem("sc-cookie", '"min"'); localStorage.removeItem("sc-checkout");
    localStorage.setItem("sc-cart", JSON.stringify({ mode: "delivery", lines: [{ key: "pitsa-margarita", id: "pitsa-margarita", q: 1, mods: [], extra: 0 }] }));
  });
  await page.goto(S.base + "/kolichka/?preview=1&t=12:30");
  await (isPhone(page) ? page.locator(".ck-bar .js-next") : page.locator(".sum-cta .js-next")).click();
  await page.locator("#addr").fill("Горубляне, ул. Липа 5");
  await page.locator("#addr-list li[data-i]").first().click();
  await expect(page.locator("#addr-res")).toContainText("Минималната поръчка за Горубляне е 50,00 €");
  await expect(page.locator(".fine").filter({ hasText: "Минимална поръчка: 50,00 € за Горубляне" })).toHaveCount(1);
  /* the main action says what is missing and leads to the menu */
  const main = isPhone(page) ? page.locator(".ck-bar .js-next") : page.locator(".sum-cta .js-next");
  await expect(main).toHaveText(/^Добавете още \d+,\d{2} €$/);
  await expect(main).toHaveAttribute("href", /\/menu\//);
  await page.locator("#addr").fill("Бусманци, ул. Липа 5");
  await expect(page.locator("#addr-list li[data-i]").first()).toContainText("Временно не доставяме");
  await page.locator("#addr-list li[data-i]").first().click();
  await expect(page.locator("#addr-res")).toContainText("Временно не доставяме до Бусманци");
  expect((await context.request.patch(S.base + "/api/admin/zones/busmantsi", { data: { on: true } })).status()).toBe(200);
  expect(errs).toEqual([]);
});

test("„Доставяме“ off and on with „Отмени“", async ({ page, context }) => {
  await signIn(context, S.base);
  await page.goto(S.base + "/admin/zones/");
  const sw = card(page, "npz-iskar").locator("[data-on]");
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sw.click({ force: true });
  await toastHas(page, "Спряна доставка в НПЗ Искър.");
  await expect(card(page, "npz-iskar")).toHaveClass(/\boff\b/);
  await expect(page.locator(".zn-sum")).toContainText("3");
  await undo(page);
  await expect(card(page, "npz-iskar")).not.toHaveClass(/\boff\b/);
  await expect(card(page, "npz-iskar").locator("[data-on]")).toBeChecked();
});

test("rights: Маркетинг and Шофьор do not see the zones", async ({ page, context }) => {
  await signIn(context, S.base, "marketing");
  await page.goto(S.base + "/admin/zones/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await context.request.get(S.base + "/api/admin/zones")).status()).toBe(403);
  await signIn(context, S.base, "driver");
  await page.goto(S.base + "/admin/zones/");
  await expect(page).toHaveURL(/\/shofyor\//);
});
