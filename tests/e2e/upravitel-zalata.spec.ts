import { test, expect, request, type Page, type APIRequestContext, type TestInfo } from "@playwright/test";
import { ownServer, signIn, E, type Own } from "./own-server.ts";

/* "Управител" › "Залата" (src/modules/upravitel/hall.ts) and THE MONEY RULE, on an own server (a copy of the build, its own
   database): "Блокирай за гости без резервация" saves the hall's plan (the site is built again) and the roles of the
   manager change here, so the other specs never see either.
   - the tiles, the legend, the sheet of a table: the state, who serves it (a change in one tap), the orders and the sum
     OF THE TABLE (the core's number), the next reservation, "Блокирай за гости без резервация" and "Отмени";
   - the money rule: in "Сега", "Залата" and "Екипът" every "€" is the sum of ONE order, ONE table or a driver's cash,
     and it is the core's number; with "Финанси и гориво" given to the manager nothing more appears (the prototype shows
     no sum over orders in this module). */
test.describe.configure({ mode: "serial" });
let S: Own;
test.beforeAll(async ({}, info: TestInfo) => {
  test.setTimeout(120_000);
  S = await ownServer("up-hall-" + info.project.name, info.project.name === "phone" ? 20 : 21);
});
test.afterAll(async () => { if (S) await S.stop(); });

const CLOCK = "19:42", PV = "?preview=1&t=" + CLOCK;
const rnd = () => Math.random().toString(36).slice(2, 7);
const PW: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], kitchen: ["kitchen", E.KITCHEN_PASSWORD], driver: ["driver", E.DRIVER_PASSWORD] };
async function as(who: string, pw?: string): Promise<APIRequestContext> {
  const r = await request.newContext({ baseURL: S.base, extraHTTPHeaders: { "x-sc-clock": CLOCK } });
  const x = await r.post("/api/auth/login", { data: { username: PW[who] ? PW[who][0] : who, password: pw || PW[who][1] } });
  expect(x.status(), "sign-in " + who).toBe(200);
  return r;
}
async function waiter(a: APIRequestContext, name: string, tables: number[]) {
  const username = "e2e.up" + rnd(), password = "dlga-parola-" + rnd();
  expect((await a.post("/api/admin/staff", { data: { username, name, role: "waiter", password } })).status()).toBe(201);
  const w = await as(username, password);
  expect((await w.post("/api/floor/shift/start", { data: { tables } })).status()).toBe(200);
  return { username, name, api: w };
}
const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[13489]|422|429)/.test(m.text())) list.push(m.text()); });
  return list;
}
const toast = (page: Page) => page.locator(".bs-toast.on");
const euro = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",") + " €";
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/ /g, " ").trim();

/** every "€" on the screen: where it is and its text (the allowed places: one order, one table, a driver's cash) */
const euros = (page: Page) => page.evaluate(() => {
  const out: { where: string; text: string; key: string }[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!/€/.test(n.textContent || "")) continue;
    const el = n.parentElement!; if (!el.closest(".bs-app, .bs-ov") || !el.offsetParent) continue;
    const w = el.closest<HTMLElement>(".mg-wrow, .mg-cash, .bs-sheet .mg-kv, .mg-frow");
    const card = el.closest<HTMLElement>("[data-wno], .mg-person, .mg-kv");
    out.push({ where: w ? (w.classList.contains("mg-wrow") ? "order" : w.classList.contains("mg-cash") ? "cash" : w.classList.contains("mg-kv") ? "table" : "search") : "OTHER: " + (el.className || el.tagName), text: (el.textContent || "").trim(), key: card ? card.dataset.wno || card.id || (card.textContent || "").trim().slice(0, 40) : "" });
  }
  return out;
});

test("the hall: tiles and legend, the sheet of a table (the waiter in one tap, the table's sum), „Блокирай за гости без резервация“ with „Отмени“", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errs = errors(page);
  const a = await as("admin");
  const w1 = await waiter(a, "Сервитьор " + rnd().toUpperCase(), [3, 4]), w2 = await waiter(a, "Сервитьор " + rnd().toUpperCase(), [5]);
  /* guests at table 3: an order the waiter confirms */
  const code = ((await (await a.get("/api/admin/qr")).json()) as { n: number; code: string }[]).find((r) => r.n === 3)!.code, g = tok();
  for (const [p, d] of [["open", {}], ["cart/add", { id: "kebapcheta", q: 2 }], ["send", {}]] as [string, Record<string, unknown>][]) expect((await a.post("/api/floor/t/" + code + "/" + p, { data: { g, ...d } })).status()).toBe(200);
  expect((await w1.api.post("/api/floor/table/3/qr/confirm", { data: {} })).status()).toBe(200);
  await signIn(context, S.base, "manager");
  await page.goto(S.base + "/upravitel/zalata/" + PV);
  await expect(page.locator("[data-upscr]")).toBeVisible();
  await expect(page.locator(".mg-legend .mg-tag")).toHaveText(["Вика", "Сметка", "QR поръчка", "Готово", "Чака поръчка", "Заета", "Резервирана", "Свободна"]);
  const tile = page.locator('.mg-tile[data-t="3"]:visible');
  await expect(tile).toContainText(w1.name);
  await expect(tile.locator(".w")).toHaveText(/Заета|Чака поръчка|Готово/);
  await tile.click();
  const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet");
  await expect(sh.locator("h2")).toHaveText("Маса 3 · Салон");
  await expect(sh.getByRole("button", { name: new RegExp(w1.name) })).toHaveAttribute("aria-pressed", "true");
  /* the sum OF THE TABLE: the core's number */
  const t3 = await (await (await as("manager")).get("/api/boss/hall/3")).json() as { sum: number; orders: { no: string; total: number }[] };
  await expect(sh.locator(".mg-kv", { hasText: "Сума на масата" }).locator("b")).toHaveText(euro(t3.sum));
  for (const o of t3.orders) await expect(sh.locator(".mg-kv", { hasText: "№ " + o.no })).toContainText(euro(o.total));
  /* who serves it: one tap */
  await sh.getByRole("button", { name: new RegExp(w2.name) }).click();
  await expect(toast(page)).toContainText("Маса 3: обслужва " + w2.name);
  const m = await as("manager");
  expect(((await (await m.get("/api/boss/hall/3")).json()) as { waiter: { username: string } }).waiter.username).toBe(w2.username);
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect.poll(async () => ((await (await m.get("/api/boss/hall/3")).json()) as { waiter: { username: string } }).waiter.username).toBe(w1.username);
  /* "Блокирай за гости без резервация" */
  await page.locator('.mg-tile[data-t="4"]:visible').click();
  await expect(sh.locator("h2")).toHaveText("Маса 4 · Салон");
  await expect(sh.locator("[data-walk]")).not.toBeChecked();
  await sh.locator(".mg-switch").click();
  await expect(toast(page)).toContainText("Маса 4 е само с резервация");
  const walk = async () => ((await (await m.get("/api/boss/hall")).json()) as { tiles: { n: number; walkin: boolean }[] }).tiles.find((x) => x.n === 4)!.walkin;
  expect(await walk()).toBe(false);
  await page.keyboard.press("Escape");
  await expect(page.locator('.mg-tile[data-t="4"]:visible .lock')).toBeVisible();
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect.poll(walk).toBe(true);
  await expect(page.locator('.mg-tile[data-t="4"]:visible .lock')).toHaveCount(0);
  /* "До края на вечерта": the links to the admin */
  await expect(page.getByRole("link", { name: "Нова резервация" })).toHaveAttribute("href", "/admin/reservations/#new=1");
  await expect(page.getByRole("link", { name: "Планът на залата" })).toHaveAttribute("href", "/admin/hall/#v=plan");
  await expect(page.getByRole("link", { name: "QR кодовете" })).toHaveAttribute("href", "/admin/qr/");
  for (const w of [w1, w2]) await w.api.post("/api/floor/shift/end", { data: {} });
  expect(errs).toEqual([]);
});

test("the money rule: only one order, one table, a driver's cash; with „Финанси и гориво“ the screens stay the same", async ({ page, context }) => {
  test.setTimeout(90_000);
  const errs = errors(page);
  const a = await as("admin"), m = await as("manager");
  /* data: two orders to accept (a sum for each, never their total), a driver with cash */
  const ord = async () => { const x = await a.post("/api/orders", { data: { cart: { mode: "pickup", lines: [{ id: "kebapcheta", key: "kebapcheta", q: 1 + Math.floor(Math.random() * 3), extra: 0, mods: [] }] }, name: "Клиент " + rnd(), phone: "0888 " + String(100000 + Math.floor(Math.random() * 899999)), pay: "cash", note: "" } }); expect(x.status()).toBe(201); };
  await ord(); await ord();
  const d = await as("driver");
  const st = await d.get("/api/driver/state"), sj = await st.json() as { shift: unknown; cars: { id: string; busyBy: string | null }[] };
  if (!sj.shift) expect((await d.post("/api/driver/start", { data: { car: (sj.cars.find((c) => !c.busyBy) || sj.cars[0]).id, km: 50000, float: 20 } })).status()).toBe(201);
  await signIn(context, S.base, "manager");
  async function check(label: string) {
    const now = await (await m.get("/api/boss/now")).json() as { waits: { orders: { no: string; total: number }[] }; money: boolean };
    const team = await (await m.get("/api/boss/team")).json() as { drivers: { user: string; cash: number; cashParts: { orders: number; float: number | null; fuel: number } }[] };
    /* a driver's cash and what it is made of (the cash orders, the start float, the fuel in cash) */
    const cashes = team.drivers.flatMap((x) => [Math.abs(x.cash), x.cashParts.orders, x.cashParts.float || 0, x.cashParts.fuel]).map((v) => norm(euro(v)));
    const seen: string[] = [];
    for (const [path, what] of [["/upravitel/", "Сега"], ["/upravitel/zalata/", "Залата"], ["/upravitel/ekipat/", "Екипът"]]) {
      await page.goto(S.base + path + PV);
      await expect(page.locator("[data-upscr]")).toBeVisible();
      const list = await euros(page);
      for (const e of list) {
        expect(e.where, label + " " + what + ": " + e.text).not.toMatch(/^OTHER/);
        if (e.where === "order") { const o = now.waits.orders.find((x) => x.no === e.key); expect(o, "order " + e.key).toBeTruthy(); expect(norm(e.text)).toBe(norm(euro(o!.total))); }
        if (e.where === "cash") expect(cashes, "cash " + e.text).toContain(norm(e.text));
        seen.push(what + ":" + e.where + ":" + norm(e.text));
      }
      /* never the words of a sum over orders */
      await expect(page.locator(".bs-app main")).not.toContainText(/Оборот|оборот|Днес:\s*\d/);
    }
    expect(seen.filter((x) => x.startsWith("Сега:order")).length).toBe(now.waits.orders.length);
    return seen.sort();
  }
  const before = await check("без финанси");
  /* "Финанси и гориво" for the manager (the main admin's "Роли и права") */
  const roles = await (await a.get("/api/admin/roles")).json() as { id: string; sections: string[] }[];
  const mgr = roles.find((r) => r.id === "manager")!;
  expect((await a.put("/api/admin/roles/manager", { data: { sections: [...mgr.sections, "finance"] } })).status()).toBe(200);
  try {
    const m2 = await as("manager");
    expect(((await (await m2.get("/api/boss/now")).json()) as { money: boolean; today: unknown }).money).toBe(true);
    await context.clearCookies(); await signIn(context, S.base, "manager");
    const after = await check("с финанси");
    expect(after).toEqual(before);
  } finally { await a.put("/api/admin/roles/manager", { data: { sections: mgr.sections } }); }
  expect(errs).toEqual([]);
});

test("the rights: without „Кухня“, „Меню“, „Настройки“, „Сервитьор“ and „Залата“ the actions are not offered (and the core refuses them)", async ({ page, context }) => {
  const errs = errors(page);
  const a = await as("admin");
  const roles = await (await a.get("/api/admin/roles")).json() as { id: string; sections: string[] }[];
  const mgr = roles.find((r) => r.id === "manager")!;
  expect((await a.put("/api/admin/roles/manager", { data: { sections: ["dashboard", "notes", "orders"] } })).status()).toBe(200);
  try {
    await signIn(context, S.base, "manager");
    await page.goto(S.base + "/upravitel/" + PV);
    await expect(page.locator("[data-upscr]")).toBeVisible();
    await expect(page.locator("[data-busy]")).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Върни в менюто/ })).toHaveCount(0);
    const m = await as("manager");
    expect((await m.post("/api/boss/kitchen/busy", { data: { on: true } })).status()).toBe(403);
    expect((await m.post("/api/boss/kitchen/back", { data: { dish: "pleskavitsa", back: true } })).status()).toBe(403);
    expect((await m.post("/api/boss/qr/3/confirm", { data: {} })).status()).toBe(403);
  } finally { await a.put("/api/admin/roles/manager", { data: { sections: mgr.sections } }); }
  expect(errs).toEqual([]);
});
