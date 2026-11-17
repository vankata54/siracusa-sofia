import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import { createRequire } from "node:module";
import { floorLock } from "./_floor-lock.ts";
import { moveOut } from "./shofyor-helpers.ts";
import { E, apiAs, admin, kitchen, newWaiter, startShift, endShift, guest, freeTable, signInCtx, errors } from "./servitor-helpers.ts";

/* "Управител" › "Сега" (/upravitel/, src/modules/upravitel/now.ts) on the real server: "Приеми" straight to "Готви се"
   (the kitchen's queue has it) and "Отмени"; an order with a sold-out dish -> the sheet -> "Приеми без него"; "Върни"
   the dish; a late delivery -> "Обади се на клиента" shows the whole number and writes the log, "Готово, обадих се";
   a QR order and a call over the manager's minutes (their moment 10 minutes back in the database) -> "Потвърди и прати",
   "Отивам"; the driver's question -> the three answers, the answer reaches the driver live; "Натоварено" with the
   confirmation -> the site's status; no connection: the action waits on the phone and goes by itself.
   The page and the API follow the preview clock 19:42 (SC_PREVIEW_API=1). The hall is shared: floorLock(). */
floorLock();

const CLOCK = "19:42", PV = "?preview=1&t=" + CLOCK;
const MANAGER = { username: "manager", password: E.MANAGER_PASSWORD };
const rnd = () => Math.random().toString(36).slice(2, 7);
const phoneNo = () => "0888 " + String(100000 + Math.floor(Math.random() * 899999)).replace(/(\d{2})(\d{2})(\d{2})/, "$1 $2 $3");
type Line = { id: string; q: number };
/** an order from the site (the customer); clock "12:30" makes it late at 19:42 */
async function order(mode: "delivery" | "pickup", lines: Line[], clock = CLOCK, phone = phoneNo()) {
  const r = await apiAs("manager", E.MANAGER_PASSWORD);
  const x = await r.post("/api/orders", { headers: { "x-sc-clock": clock }, data: {
    cart: { mode, lines: lines.map((l) => ({ key: l.id, extra: 0, mods: [], ...l })) }, name: "Иван Петров " + rnd(), phone, pay: "cash", note: "",
    ...(mode === "delivery" ? { addr: "ж.к. Дружба 2, бл. 311, вх. Б" } : {}) } });
  expect(x.status(), await x.text()).toBe(201);
  const o = (await x.json()) as { no: string; key: string };
  await r.dispose();
  return { ...o, phone };
}
async function open(page: Page, ctx: BrowserContext, path = "/upravitel/", hash = "") {
  await signInCtx(ctx, MANAGER);
  await page.goto(path + PV + (hash ? "#" + hash : ""));
  await expect(page.locator("[data-upscr]")).toBeVisible();
}
const toast = (page: Page) => page.locator(".bs-toast.on");
/** the problems over five are behind "Покажи още" */
async function showAll(page: Page) { const b = page.locator('[data-a="allp"]'); if (await b.count()) await b.click(); }
const card = (page: Page, key: string) => page.locator('.mg-prob[data-key="' + key + '"]');
/** the moment of a QR order or a call, 10 minutes earlier (straight in the server's database) */
function backdate(n: number, path: string) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const d = new Database("data/e2e-" + (process.env.E2E_PORT || "8788") + ".db");
  const r = d.prepare("UPDATE table_sessions SET data = json_set(data, ?, ?) WHERE json_extract(data, '$.n') = ? AND json_extract(data, '$.status') = 'open'").run(path, new Date(Date.now() - 600_000).toISOString(), n);
  d.close();
  expect(r.changes, "backdate " + n).toBe(1);
}
async function statusOf(a: APIRequestContext, no: string): Promise<string> {
  const r = await a.get("/api/admin/orders?limit=200");
  const j = await r.json() as { rows?: { no: string; status: string }[] } | { no: string; status: string }[];
  const rows = Array.isArray(j) ? j : j.rows || [];
  return (rows.find((x) => x.no === no) || { status: "?" }).status;
}

test("„Приеми“ goes straight to „Готви се“ (the kitchen's queue has it), „Отмени“ takes it back", async ({ page, context }) => {
  const errs = errors(page);
  const o = await order("pickup", [{ id: "kebapcheta", q: 2 }]);
  await open(page, context);
  const row = page.locator('.mg-wrow[data-wno="' + o.no + '"]');
  await expect(row).toBeVisible();
  /* the sum of THIS order is allowed and is the core's */
  const k = await kitchen();
  await row.getByRole("button", { name: "Приеми № " + o.no }).click();
  await expect(toast(page)).toContainText("№ " + o.no + " е приета · Готви се");
  const q = JSON.stringify(await (await k.get("/api/kitchen/queue?sec=all")).json());
  expect(q).toContain('"' + o.no + '"');
  const a = await admin();
  expect(await statusOf(a, o.no)).toBe("cooking");
  await expect(row).toHaveCount(0);
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect(page.locator('.mg-wrow[data-wno="' + o.no + '"]')).toBeVisible();
  expect(await statusOf(a, o.no)).toBe("accepted");
  /* clean: into the kitchen */
  await page.locator('.mg-wrow[data-wno="' + o.no + '"] button').click();
  await expect(toast(page)).toContainText("е приета");
  expect(errs).toEqual([]);
});

test("an order with a sold-out dish: „Приеми“ asks first (the sheet), „Приеми без него“; then „Върни“ the dish", async ({ page, context }) => {
  const errs = errors(page);
  const o = await order("pickup", [{ id: "kebapcheta", q: 1 }, { id: "shopska-salata", q: 1 }]);
  const k = await kitchen();
  expect((await k.put("/api/kitchen/sold-out/shopska-salata", { data: { out: true, sec: "studeni" } })).status()).toBe(200);
  try {
    await open(page, context);
    const row = page.locator('.mg-wrow[data-wno="' + o.no + '"]');
    await expect(row.locator(".mg-wout")).toHaveText("Изчерпано: Шопска салата");
    /* the same order is a problem too ("Обади се на клиента" / "Приеми без него") */
    await showAll(page);
    await expect(card(page, "out:" + o.no)).toBeVisible();
    await row.locator("button").click();
    const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet");
    await expect(sh.locator("h2")).toHaveText("В поръчката има изчерпано");
    /* the whole number (the call is logged) */
    await expect(sh).toContainText(o.phone);
    await expect(sh.getByRole("link", { name: "Обади се на клиента" })).toHaveAttribute("href", "tel:" + o.phone.replace(/\s/g, ""));
    await sh.getByRole("button", { name: "Приеми без него" }).click();
    await expect(toast(page)).toContainText("е приета без „Шопска салата“ · Готви се");
    await expect(card(page, "out:" + o.no)).toHaveCount(0);
    const a = await admin();
    expect(await statusOf(a, o.no)).toBe("cooking");
    /* "Изчерпано днес" › "Върни" */
    const back = page.getByRole("button", { name: "Върни в менюто: Шопска салата" });
    await back.click();
    await expect(toast(page)).toContainText("„Шопска салата“ е отново в менюто");
    await expect(back).toHaveCount(0);
    const so = JSON.stringify(await (await k.get("/api/kitchen/sold-out?sec=all")).json());
    expect(so).not.toMatch(/"id":"shopska-salata"[^}]*"out":true/);
  } finally { await k.put("/api/kitchen/sold-out/shopska-salata", { data: { out: false, sec: "studeni" } }); }
  expect(errs).toEqual([]);
});

test("a late delivery: „Обади се на клиента“ shows the whole number and writes the log; „Готово, обадих се“ solves it", async ({ page, context }) => {
  const errs = errors(page);
  const o = await order("delivery", [{ id: "kebapcheta", q: 3 }], "12:30");
  const a = await admin();
  /* into the kitchen, so it is a late order and not one to accept */
  expect((await a.patch("/api/admin/orders/" + o.no, { data: { status: "cooking" } })).status()).toBeLessThan(300);
  await open(page, context);
  await showAll(page);
  const c = card(page, "late:" + o.no);
  await expect(c).toContainText("Доставка № " + o.no + " · закъснява");
  await c.getByRole("button", { name: "Обади се на клиента" }).click();
  const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet");
  await expect(sh.locator("h2")).toHaveText("Обади се на клиента");
  await expect(sh.locator("[data-tel-n]")).toHaveText(o.phone);
  await expect(sh.getByRole("link", { name: "Обади се" })).toHaveAttribute("href", "tel:" + o.phone.replace(/\s/g, ""));
  /* the log: order.call by the manager */
  const log = JSON.stringify(await (await a.get("/api/admin/audit?action=order.call&limit=50")).json());
  expect(log).toContain(o.no);
  await sh.getByRole("button", { name: "Готово, обадих се" }).click();
  await expect(toast(page)).toContainText("№ " + o.no + ": обади се на клиента");
  /* the card leaves; the solved ones are at the bottom ("Решени днес") */
  await expect(async () => { await showAll(page); await expect(card(page, "late:" + o.no)).toHaveClass(/solved/, { timeout: 1000 }); }).toPass({ timeout: 10_000 });
  /* "Закъсняват" counts it as seen */
  await expect(page.locator(".mg-kpi").nth(2)).toContainText(/(видяна|видени)$/);
  expect(errs).toEqual([]);
});

test("a QR order and a call over the manager's minutes: „Потвърди и прати“ and „Отивам“", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin();
  const w = await newWaiter(a, "Сервитьор " + rnd().toUpperCase());
  await startShift(w, [17, 18]);
  try {
    await freeTable(a, 17); await freeTable(a, 18);
    const g1 = await guest(a, 17);
    expect((await g1.post("cart/add", { id: "kebapcheta", q: 1 })).status).toBe(200);
    expect((await g1.post("send")).status).toBe(200);
    const g2 = await guest(a, 18);
    expect((await g2.call("order")).status).toBe(200);
    /* nobody answered for 10 minutes (more than settings.qrManager and settings.callManager) */
    backdate(17, "$.pending.at"); backdate(18, "$.calls[0].at");
    await open(page, context);
    await showAll(page);
    const qr = page.locator(".mg-prob", { hasText: "Маса 17 · QR поръчка" });
    await expect(qr).toBeVisible();
    await expect(qr.locator(".tm b")).toHaveText(/^1\d:\d\d$/);
    await expect(qr).toContainText("никой не я е потвърдил");
    await qr.getByRole("button", { name: "Потвърди и прати" }).click();
    await expect(toast(page)).toContainText("Маса 17: поръчката е в кухнята · №");
    const call = page.locator(".mg-prob", { hasText: "Маса 18 · Вика" });
    await expect(call).toBeVisible();
    await expect(call).toContainText("изпратено на теб");
    await call.getByRole("button", { name: "Отивам" }).click();
    await expect(toast(page)).toContainText("Маса 18: отиваш ти");
    await expect(page.locator(".mg-prob", { hasText: "Маса 18 · Вика" })).toHaveCount(0);
    /* the waiter sees the call as taken by the manager */
    const t18 = JSON.stringify(await (await w.api.get("/api/floor/table/18")).json());
    expect(t18).toContain("manager");
  } finally { await freeTable(a, 17); await freeTable(a, 18); await endShift(w); }
  expect(errs).toEqual([]);
});

test("the driver's question „адрес извън зоните“: three answers, „Да я достави“ last; the answer reaches the driver live", async ({ page, context, browser }) => {
  const errs = errors(page);
  const a = await admin();
  /* a driver of this test (his own shift) and a ready delivery */
  const u = "e2e.dr" + rnd(), pw = "dlga-parola-" + rnd();
  expect((await a.post("/api/admin/staff", { data: { username: u, name: "Шофьор " + rnd().toUpperCase(), role: "driver", password: pw } })).status()).toBe(201);
  const d = await apiAs(u, pw);
  /* a car nobody has in the shift, its last kilometres */
  const cars = ((await (await d.get("/api/driver/state")).json()) as { cars: { id: string; busyBy: string | null; lastKm: number | null }[] }).cars;
  const c0 = cars.find((c) => !c.busyBy) || cars[0], car = c0.id, km = (c0.lastKm || 48000) + 5;
  const st = await d.post("/api/driver/start", { data: { car, km, float: 20 } });
  expect([201, 409], await st.text()).toContain(st.status());
  try {
  const o = await order("delivery", [{ id: "kebapcheta", q: 2 }]);
  const k = await kitchen();
  expect((await k.post("/api/kitchen/orders/" + o.no + "/done", { data: { sec: "skara" } })).status()).toBe(200);
  /* the site never accepts an address outside the zones: the test moves it in the server's database */
  moveOut("data/e2e-" + (process.env.E2E_PORT || "8788") + ".db", o.no);
  expect((await d.post("/api/driver/deliveries/" + o.no + "/ask", { data: { note: "" } })).status()).toBe(201);
  /* the driver's phone: his deliveries */
  const dctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await signInCtx(dctx, { username: u, password: pw });
  const dp = await dctx.newPage();
  await dp.goto("/shofyor/dostavka/" + PV + "#" + o.no);
  await expect(dp.locator("body")).toContainText("Чакаш отговор от управителя");
  await open(page, context);
  await showAll(page);
  const c = page.locator(".mg-prob", { hasText: "адрес извън зоните" }).filter({ hasText: "№ " + o.no });
  await expect(c.locator(".tm span")).toHaveText("пита");
  await c.getByRole("button", { name: "Реши" }).click();
  const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet");
  await expect(sh.locator("h2")).toHaveText("Адрес извън зоните");
  await expect(sh.locator(".mg-foot3 .pill")).toHaveText(["Върни я в ресторанта", "Предложи вземане от място", "Да я достави"]);
  await sh.getByRole("button", { name: "Предложи вземане от място" }).click();
  await expect(toast(page)).toContainText("да предложи на клиента вземане от място");
  await expect(dp.locator("body")).toContainText("Управителят: Предложи вземане от място.", { timeout: 10_000 });
  await dctx.close();
  } finally { await d.post("/api/driver/end", { data: { km: km + 10, handed: true } }); }
  expect(errs).toEqual([]);
});

test("„Натоварено“: the confirmation shows what the customer sees; the site's status follows; off again", async ({ page, context, request }) => {
  const errs = errors(page);
  await open(page, context);
  const sw = page.locator("[data-busy]");
  await expect(sw).not.toBeChecked();
  await page.locator(".mg-busy .mg-switch").click();
  const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet");
  await expect(sh.locator("h2")).toHaveText("Включи „Натоварено“?");
  await expect(sh.locator(".mg-cmp")).toContainText(/около \d+ мин/);
  await expect(sh.locator(".mg-cmp .now")).toContainText("Възможни са закъснения · около");
  await sh.getByRole("button", { name: "Включи" }).click();
  await expect(toast(page)).toContainText("„Натоварено“ е включено");
  await expect(page.locator(".mg-busy")).toHaveClass(/\bon\b/);
  await expect(page.locator(".mg-busy .sub")).toContainText("Включено от");
  const s1 = await (await request.get("/api/status", { headers: { "x-sc-clock": CLOCK } })).json() as { eta: { busy: boolean; text: string } };
  expect(s1.eta.busy).toBe(true);
  expect(s1.eta.text).toContain("Възможни са закъснения");
  await page.locator(".mg-busy .mg-switch").click();
  await expect(toast(page)).toContainText("„Натоварено“ е изключено");
  const s2 = await (await request.get("/api/status", { headers: { "x-sc-clock": CLOCK } })).json() as { eta: { busy: boolean } };
  expect(s2.eta.busy).toBe(false);
  expect(errs).toEqual([]);
});

test("no connection: „Приеми“ is kept on the phone and goes by itself when the connection is back", async ({ page, context }) => {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const o = await order("pickup", [{ id: "kebapcheta", q: 1 }]);
  await open(page, context);
  const row = page.locator('.mg-wrow[data-wno="' + o.no + '"]');
  await expect(row).toBeVisible();
  await context.setOffline(true);
  await expect(page.locator(".bs-net")).toBeVisible();
  await row.locator("button").click();
  await expect(toast(page)).toContainText("Записано на телефона, тръгва само, щом има връзка.");
  const a = await admin();
  expect(await statusOf(a, o.no)).toBe("accepted");
  await context.setOffline(false);
  await expect(page.locator(".bs-net")).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => statusOf(a, o.no), { timeout: 10_000 }).toBe("cooking");
  await expect(page.locator('.mg-wrow[data-wno="' + o.no + '"]')).toHaveCount(0);
  expect(errs).toEqual([]);
});
