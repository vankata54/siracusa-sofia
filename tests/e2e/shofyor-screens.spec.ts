import { test, expect, type TestInfo, type Page, type APIRequestContext, type Browser } from "@playwright/test";
import { ownServer, E, type Own } from "./own-server.ts";
import { order, login, ready, shift, errors, serious, drawn, toast, bar, noHScroll, targets, inside, moveOut, type Made } from "./shofyor-helpers.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* Шофьор, the other screens on real orders: "Маршрут" ("По-рано" / "По-късно" -> "Моят ред", the locked stop, no
   invented km), "Гориво" (the core's km error under the field, a good entry, the car change in the shift), the search,
   no connection (a status kept on the phone and sent after the reconnect), "Колата е в движение" (GPS speed in the
   browser), the end of the shift (blocked by an undelivered order, the cash formula, success), and every screen at 360
   and 390, light and dark: no horizontal scroll, targets of 48 px, no console errors, axe without serious violations.
   Own server per project (E2E_PORT + 22 / + 23). */
let S: Own, kitchen: APIRequestContext;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ playwright }, info: TestInfo) => {
  test.setTimeout(120_000);
  test.skip(!E.DRIVER_PASSWORD || !E.KITCHEN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("drv-screens-" + info.project.name, info.project.name === "phone" ? 22 : 23);
  kitchen = await playwright.request.newContext(); await login(kitchen, S.base, "kitchen");
});
test.afterAll(async () => { if (S) await S.stop(); });

const go = async (page: Page, path: string) => { await page.goto(S.base + path); await drawn(page); };
const api = (page: Page) => page.context().request;
async function readyOrders(page: Page, specs: { addr: string; pay?: "cash" | "card" | "voucher" }[]): Promise<Made[]> {
  const out: Made[] = [];
  for (const s of specs) { const o = await order(api(page), S.base, { ...s, lines: [{ id: "kebapcheta", q: 2 }] }); await ready(kitchen, S.base, o.no); out.push(o); }
  return out;
}
async function signed(page: Page) { await login(page.context(), S.base, "driver"); await shift(api(page), S.base); }

test("„Маршрут“ for a new course: Път А / Път Б for the ready orders before „Взех“, without „По-рано“ / „По-късно“", async ({ page }) => {
  const errs = errors(page);
  await signed(page);
  const os = await readyOrders(page, [{ addr: "ж.к. Дружба 1, бл. 9" }, { addr: "Бусманци, ул. Витоша 3" }]);
  await go(page, "/shofyor/marshrut/");
  await expect(page.locator("main .notice").first()).toContainText("2 поръчки чакат в ресторанта");
  await expect(page.locator(".rc").first()).toContainText("Път А · по срока");
  await expect(page.locator(".stops .stop:not(.home)")).toHaveCount(2);
  await expect(page.locator(".stops button")).toHaveCount(0);
  /* the words of the scheme are at least 14 px on the screen */
  const small = await page.evaluate(() => Array.from(document.querySelectorAll<SVGTextElement>(".scheme text")).map((t) => t.getBoundingClientRect().height).filter((h) => h > 0 && h < 14));
  expect(small).toEqual([]);
  await go(page, "/shofyor/");
  await expect(page.locator(".st-h .link")).toContainText("Път А · смени");
  /* they leave the route test alone */
  const nos = os.map((o) => o.no);
  expect((await api(page).post(S.base + "/api/driver/take", { data: { nos } })).status()).toBe(200);
  expect((await api(page).post(S.base + "/api/driver/go", { data: {} })).status()).toBe(200);
  for (const n of nos) expect((await api(page).post(S.base + "/api/driver/deliveries/" + n + "/deliver", { data: {} })).status()).toBe(200);
  expect(errs).toEqual([]);
});

test("„Маршрут“: the locked first stop without its buttons, „По-късно“ makes „Моят ред“, no invented km", async ({ page }) => {
  const errs = errors(page);
  await signed(page);
  const os = await readyOrders(page, [{ addr: "ж.к. Дружба 2, бл. 311" }, { addr: "ж.к. Дружба 1, бл. 5" }, { addr: "Бусманци, ул. Витоша 12" }]);
  expect((await api(page).post(S.base + "/api/driver/take", { data: { nos: os.map((o) => o.no) } })).status()).toBe(200);
  expect((await api(page).post(S.base + "/api/driver/go", { data: {} })).status()).toBe(200);
  await go(page, "/shofyor/marshrut/");
  await expect(page.locator(".scheme svg[role=img]")).toHaveAttribute("aria-label", /3 адреса по ред/);
  await expect(page.locator(".rc").first()).toContainText("Път А · по срока");
  await expect(page.locator(".rc").first()).toContainText("[ЛИПСВА: маршрути от OSRM]");
  await expect(page.locator(".rc .nums")).not.toContainText(/\d+\s*(км|мин)/);
  const stops = page.locator(".stops .stop:not(.home)");
  await expect(stops).toHaveCount(3);
  await expect(stops.first().locator(".lockh")).toHaveText("Караш към нея сега: остава първа");
  await expect(stops.first().locator("button")).toHaveCount(0);
  await expect(stops.nth(1).getByRole("button", { name: /^По-рано/ })).toBeDisabled();
  const second = await stops.nth(1).getAttribute("data-no"), third = await stops.nth(2).getAttribute("data-no");
  await stops.nth(1).getByRole("button", { name: /^По-късно/ }).click();
  await expect(stops.nth(1)).toHaveAttribute("data-no", third!);
  await expect(stops.nth(2)).toHaveAttribute("data-no", second!);
  await expect(page.locator('.rc[aria-pressed="true"]')).toContainText("Моят ред");
  await page.locator('.rc[data-pick="A"]').click();
  await expect(page.locator('.rc[aria-pressed="true"]')).toContainText("Път А");
  /* the list follows the route */
  await go(page, "/shofyor/");
  await expect(page.locator(".st-h .link")).toContainText("Път А · смени");
  expect(errs).toEqual([]);
});

test("„Гориво“: the core's km error under the field, a good entry, the price per litre live; the car change in the shift", async ({ page }) => {
  const errs = errors(page);
  await signed(page);
  await go(page, "/shofyor/gorivo/");
  await page.fill("#f-litres", "40"); await page.fill("#f-sum", "60"); await page.fill("#f-km", "100");
  await expect(page.locator("#calc b")).toHaveText("1,50 €/л");
  await bar(page).getByRole("button", { name: "Запиши зареждането" }).click();
  await expect(page.locator("#e-km")).toHaveText("По-малко е от последно записания (48 250 км). Провери таблото.");
  await expect(page.locator("#f-km")).toBeFocused();
  await expect(page.locator("#f-litres")).toHaveValue("40");
  await page.fill("#f-km", "48300");
  await page.locator("#full").check();
  await bar(page).getByRole("button", { name: "Запиши зареждането" }).click();
  await expect(toast(page)).toContainText("Зареждането е записано: 40 л · 60,00 €.");
  await expect(page.locator(".hist .h").first()).toContainText("40,00 л · 60,00 €");
  await expect(page.locator(".hist .h").first()).toContainText("48 300 км · пълен резервоар");
  /* the car sheet: end km of car 1, start km of car 2 */
  await page.getByRole("button", { name: "Смени" }).click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator("h2")).toHaveText("С коя кола караш?");
  await sh.locator('.car[data-c="a2"]').click();
  await page.fill("#cke", "48200"); await page.fill("#cks", "31540");
  await sh.getByRole("button", { name: "Готово" }).click();
  await expect(sh.locator("#e-kmEnd")).toHaveText("Крайният км трябва да е поне 48 300.");
  await page.fill("#cke", "48320");
  await sh.getByRole("button", { name: "Готово" }).click();
  await expect(toast(page)).toContainText("Караш Автомобил 2.");
  await expect(page.locator(".carline b")).toHaveText("Автомобил 2");
  await expect(page.locator(".st-top [data-sub]")).toContainText("Автомобил 2");
  expect(errs).toEqual([]);
});

test("the search: only his deliveries; Enter opens the first one", async ({ page }) => {
  const errs = errors(page);
  await signed(page);
  const [o] = await readyOrders(page, [{ addr: "ж.к. Дружба 1, бл. 77" }]);
  expect((await api(page).post(S.base + "/api/driver/take", { data: { nos: [o.no] } })).status()).toBe(200);
  await go(page, "/shofyor/");
  await page.locator(".st-findfield").click();
  const f = page.locator(".st-find");
  await expect(f.locator(".fscope")).toContainText("Търсиш само в своите доставки");
  await page.locator("#fq").fill(o.no);
  await expect(f.locator(".frow").first()).toContainText("№ " + o.no);
  await page.locator("#fq").press("Enter");
  await expect(page).toHaveURL(new RegExp("/shofyor/dostavka/#" + o.no + "$"));
  await drawn(page);
  await expect(page.locator(".st-top h1")).toHaveText("№ " + o.no);
  await page.goto(S.base + "/shofyor/marshrut/"); await drawn(page);
  await page.locator('.st-top [data-act="find"]').click();
  await page.locator("#fq").fill("няма-такова");
  await expect(page.locator(".st-find .fempty h3")).toHaveText("Няма „няма-такова“");
  expect(errs).toEqual([]);
});

test("@phone no connection: a status is kept on the phone („Записано на телефона“, the strip) and sent after the reconnect", async ({ page, context }) => {
  const errs = errors(page);
  await signed(page);
  const [o] = await readyOrders(page, [{ addr: "ж.к. Дружба 2, бл. 300" }]);
  expect((await api(page).post(S.base + "/api/driver/take", { data: { nos: [o.no] } })).status()).toBe(200);
  await go(page, "/shofyor/dostavka/#" + o.no);
  await context.setOffline(true);
  await expect(page.locator(".st-net")).toContainText("Няма връзка.");
  /* the screen stays: the tabs and the links to other screens say why */
  const tab = page.locator('.st-nav a[data-tab="route"]');
  await expect(tab).toHaveAttribute("aria-disabled", "true");
  await tab.click({ force: true });
  await expect(toast(page)).toContainText("Няма връзка: остани на този екран, действията се пазят тук.");
  await expect(page).toHaveURL(new RegExp("/shofyor/dostavka/#" + o.no + "$"));
  await bar(page).getByRole("button", { name: "Тръгвам · На път" }).click();
  await expect(toast(page)).toContainText("Записано на телефона: № " + o.no + " е на път");
  await expect(page.locator(".st-net")).toContainText("1 статус чака и тръгва сам.");
  await expect(page.locator(".flow li.now")).toHaveText("На път");
  await page.locator('.st-net [data-act="queue"]').click();
  await expect(page.locator(".st-sheetwrap.on .hist")).toContainText("№ " + o.no + " · На път");
  await page.keyboard.press("Escape");
  await context.setOffline(false);
  await expect(page.locator(".st-net")).toBeHidden({ timeout: 15_000 });
  await expect.poll(async () => (await (await api(page).get(S.base + "/api/driver/deliveries/" + o.no)).json()).st, { timeout: 10_000 }).toBe("road");
  expect(errs).toEqual([]);
});

test("@phone „Колата е в движение“: only with a GPS speed; „Аз съм пътник“ holds for the shift", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: 42.6600, longitude: 23.4000, accuracy: 10 } });
  const page = await ctx.newPage();
  const errs = errors(page);
  await signed(page);
  await go(page, "/shofyor/");
  await expect(page.locator(".moving")).toHaveCount(0);
  await page.waitForTimeout(1200);
  await ctx.setGeolocation({ latitude: 42.6630, longitude: 23.4000, accuracy: 10 }); /* ~330 m in ~1 s */
  const mv = page.locator(".moving");
  await expect(mv).toBeVisible();
  await expect(mv.locator("h1")).toHaveText("Колата е в движение");
  await expect(mv.getByRole("button", { name: "Паркирах" })).toBeFocused();
  await mv.getByRole("button", { name: "Аз съм пътник" }).click();
  await expect(mv).toHaveCount(0);
  await expect.poll(async () => (await (await api(page).get(S.base + "/api/driver/state")).json()).shift.parked).toBe("passenger");
  await page.reload(); await drawn(page);
  await page.waitForTimeout(1200);
  await ctx.setGeolocation({ latitude: 42.6700, longitude: 23.4000, accuracy: 10 });
  await page.waitForTimeout(800);
  await expect(page.locator(".moving")).toHaveCount(0);
  expect((await api(page).post(S.base + "/api/driver/prefs", { data: { parked: "" } })).status()).toBe(200);
  expect(errs).toEqual([]);
  await ctx.close();
});

async function shots(browser: Browser, w: number, theme: "light" | "dark", paths: string[]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, colorScheme: theme, hasTouch: true });
  const page = await ctx.newPage();
  const errs = errors(page);
  await signed(page);
  for (const p of paths) {
    await go(page, p);
    await page.waitForTimeout(250);
    await noHScroll(page);
    await inside(page, p + " " + w);
    await targets(page);
    expect(await serious(page), p + " " + w + " " + theme).toEqual([]);
  }
  expect(errs).toEqual([]);
  await ctx.close();
}

test("@phone every screen at 360 and 390, light and dark: no horizontal scroll, 48 px, axe", async ({ browser, page }) => {
  test.setTimeout(120_000);
  await signed(page);
  const [o, far, longA] = await readyOrders(page, [{ addr: "Горубляне, ул. Самоковско шосе 5", pay: "voucher" }, { addr: "Горубляне, ул. Самоковско шосе 117", pay: "cash" }, { addr: "ж.к. Дружба 2, бл. 311, вх. Б, ет. 4, ап. 12", pay: "cash" }]);
  /* outside the zones (the first card says "уточни с ресторанта") */
  const out = await order(api(page), S.base, { lines: [{ id: "kebapcheta", q: 1 }] }); moveOut(S.db, out.no); await ready(kitchen, S.base, out.no);
  expect((await api(page).post(S.base + "/api/driver/take", { data: { nos: [far.no, longA.no] } })).status()).toBe(200);
  expect((await api(page).post(S.base + "/api/driver/go", { data: {} })).status()).toBe(200);
  for (const w of [360, 390]) for (const t of ["light", "dark"] as const) await shots(browser, w, t, ["/shofyor/", "/shofyor/dostavka/#" + far.no, "/shofyor/dostavka/#" + out.no, "/shofyor/dostavka/#" + o.no, "/shofyor/marshrut/", "/shofyor/gorivo/", "/shofyor/smyana/"]);
  /* the green button with the unknown fee: the word and the money in its frame */
  await go(page, "/shofyor/dostavka/#" + far.no);
  await expect(bar(page).locator('[data-st="done"]')).toContainText("+ такса");
  /* the sign-in without a session */
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const p = await ctx.newPage(); const errs = errors(p);
  await p.goto(S.base + "/shofyor/vhod/"); await drawn(p);
  await noHScroll(p); await targets(p);
  expect(await serious(p)).toEqual([]);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("„Край на смяната“: blocked by an undelivered order, the cash formula, the km and the tick, „Смяната приключи“ and the sign-out", async ({ page }) => {
  const errs = errors(page);
  await signed(page);
  /* everything of the earlier tests is delivered or returned, one order stays taken */
  const l = (await (await api(page).get(S.base + "/api/driver/list")).json()) as { active: { no: string; st: string }[] };
  for (const d of l.active) {
    if (d.st === "picked") await api(page).post(S.base + "/api/driver/go", { data: { nos: [d.no] } });
    if (d.st !== "prob") await api(page).post(S.base + "/api/driver/deliveries/" + d.no + "/deliver", { data: {} });
    else await api(page).post(S.base + "/api/driver/deliveries/" + d.no + "/returned");
  }
  const [o] = await readyOrders(page, [{ addr: "ж.к. Дружба 2, бл. 280" }]);
  expect((await api(page).post(S.base + "/api/driver/take", { data: { nos: [o.no] } })).status()).toBe(200);
  await go(page, "/shofyor/smyana/");
  await expect(page.locator(".st-top h1")).toHaveText("Край на смяната");
  await expect(page.locator("[data-unfinished]")).toContainText("1 поръчка не е доставена (№ " + o.no + ")");
  await expect(bar(page).getByRole("button", { name: "Приключи смяната" })).toBeDisabled();
  await api(page).post(S.base + "/api/driver/go", { data: { nos: [o.no] } });
  await api(page).post(S.base + "/api/driver/deliveries/" + o.no + "/deliver", { data: {} });
  const sum = (await (await api(page).get(S.base + "/api/driver/shift")).json()) as { handover: number; cash: { sum: number }; float: number; fuelCash: number };
  expect(sum.handover).toBeCloseTo(sum.cash.sum + (sum.float || 0) - sum.fuelCash, 2);
  await page.reload(); await drawn(page);
  /* the words follow the number: "1 зареждане" (the fuel test made one), "доставена" / "доставени" */
  await expect(page.locator(".dsum")).toContainText(/1\s*зареждане(?!я)/);
  const fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";
  await expect(page.locator(".cashbox .big")).toHaveText(fmt(sum.handover));
  await expect(page.locator(".cashbox")).toContainText("+ Начално ресто");
  await expect(page.locator(".cashbox")).toContainText("- Гориво, платено в брой");
  await expect(page.locator(".cashbox .kv.tot")).toContainText("За предаване");
  await expect(page.locator("label.chk")).toContainText("[ЛИПСВА: на кого се предават парите]");
  const end = bar(page).getByRole("button", { name: "Приключи смяната" });
  await expect(end).toBeEnabled();
  await page.fill("#ke", "10");
  await end.click();
  await expect(page.locator("#eke")).toContainText("По-малко е от последно записания");
  const last = (await (await api(page).get(S.base + "/api/driver/state")).json()).shift.lastKm as number;
  await page.fill("#ke", String(last + 42));
  await expect(page.locator("#diff")).toContainText("км");
  await end.click();
  await expect(page.locator("#ehd")).toHaveText("Отбележи, че си предал парите.");
  await page.locator("#hd").check();
  await end.click();
  await expect(page).toHaveURL(/\/shofyor\/vhod\/#done/);
  await expect(page.locator("main h2")).toHaveText("Смяната приключи");
  await expect(page.locator("main")).toContainText("Благодарим!");
  await expect(bar(page).getByRole("button", { name: "Към входа" })).toBeVisible();
  /* the session is gone: no pencil, no tabs, no "Търси" / "Смяна" */
  await expect(page.locator(".st-nav, .st-tools, .sa-pen-btn")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Към входа" }).click();
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 1 от 3");
  await expect.poll(async () => (await api(page).get(S.base + "/api/driver/state")).status()).toBe(401);
  expect(errs).toEqual([]);
});
