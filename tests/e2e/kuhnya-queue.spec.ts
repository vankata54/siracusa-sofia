import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* Кухня · Опашка (/kuhnya/, src/modules/kuhnya/queue.ts + find.ts) on real orders: a delivery from the site and a pickup
   placed through the public API by a second browser context (the customer), never sample data. A new order arrives live
   in an open queue (banner, "Нова"), "Започни", a line ready / not ready (the notice and "Върни"), "Готово" with a 1 s
   hold, the status on the customer's tracking page, "По-късно", no connection (the bar, actions kept and sent with their
   time), "Търси", the empty queue, many orders (card widths at 1280 / 1024 / 768 / 1440, both edges), axe, no errors.
   The database is shared with the other specs: every check is about the orders this test made itself.
   Tablet tests: each opens its own context with its own viewport (they run once, in the desktop project). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
type Opt = { w?: number; h?: number; sec?: string; theme?: "dark" | "light"; reduced?: boolean };
async function tablet(browser: Browser, o: Opt = {}): Promise<{ ctx: BrowserContext; page: Page; errs: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: o.w || 1280, height: o.h || 800 }, hasTouch: true, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  expect((await ctx.request.post("/api/auth/login", { data: { username: "kitchen", password: E.KITCHEN_PASSWORD } })).status(), "sign-in").toBe(200);
  await ctx.addInitScript(([sec, theme]) => {
    try { if (localStorage.getItem("sk-test")) return; localStorage.setItem("sk-test", "1"); localStorage.setItem("sk-sec", JSON.stringify(sec)); if (theme) localStorage.setItem("sk-theme", JSON.stringify(theme)); } catch { /* ignore */ }
  }, [o.sec || "skara", o.theme || ""]);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  /* a request that fails while the test has cut the connection is the point of that test */
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return { ctx, page, errs };
}
type Line = { id: string; q: number; mods?: string[] };
type Made = { no: string; key: string };
const ADDR = { addr: "ж.к. Дружба 2, бл. 311" };
/** the customer orders from the site (12:30 on the shop's clock: the kitchen and the delivery are open; the times are real) */
async function order(request: APIRequestContext, mode: "delivery" | "pickup", lines: Line[], extra: Record<string, unknown> = {}): Promise<Made> {
  const r = await request.post("/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode, lines: lines.map((l) => ({ key: l.id + (l.mods || []).join(), extra: 0, mods: [], ...l })) }, ...(mode === "delivery" ? ADDR : {}), name: "Иван Петров", phone: "0888 12 34 56", pay: "cash", ...extra } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as Made;
}
type Tk = { no: string; isNew: boolean; status: string; startedHm: string; lines: { i: number; ks: string; readyAt: string | null }[] };
const queue = async (ctx: BrowserContext, sec = "skara") => (await (await ctx.request.get("/api/kitchen/queue?sec=" + sec)).json()) as { tickets: Tk[]; later: { no: string }[] };
const ticket = async (ctx: BrowserContext, no: string, sec = "skara") => (await queue(ctx, sec)).tickets.find((t) => t.no === no);
const card = (page: Page, no: string) => page.locator('.tk[data-no="' + no + '"]');
const loaded = async (page: Page) => { await expect(page.locator(".kstrip .kcount")).toContainText("Чакат"); };
const open = async (page: Page, path = "/kuhnya/") => { await page.goto(path); await loaded(page); };
const toastBtn = (page: Page) => page.locator(".kt button");
/** press and hold with the mouse */
async function hold(page: Page, el: Locator, ms: number) {
  await el.scrollIntoViewIfNeeded();
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
}
/** the customer's tracking page in its own context */
async function tracking(browser: Browser, o: Made) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  const page = await ctx.newPage();
  await page.goto("/porachka/" + o.no + "-" + o.key + "/");
  return { ctx, page, now: page.locator(".tl li.now .nm") };
}
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const inView = (page: Page, no: string) => page.evaluate((no) => { const c = document.querySelector('.tk[data-no="' + no + '"]')!.getBoundingClientRect(), q = document.querySelector("[data-q]")!.getBoundingClientRect(); return c.left >= q.left - 1 && c.right <= q.right + 1; }, no);

test("@desktop a new order from the site arrives live: the banner „Нова · Доставка № … · Виж“, „Нова“ on the card, the counters; „Виж“ opens it", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  await open(page);
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 2, mods: ["без лук"] }, { id: "svinski-vrat", q: 1 }, { id: "shopska-salata", q: 1 }], { note: "Без прибори" });
  const c = card(page, o.no);
  await expect(c).toBeVisible(); /* no reload */
  await expect(c).toHaveClass(/\bisnew\b/);
  await expect(c).toHaveAttribute("aria-label", "Доставка № " + o.no);
  await expect(c.locator(".tk-k")).toHaveText("Доставка");
  await expect(c.locator(".tk-t")).toHaveText("№ " + o.no);
  await expect(c.locator(".tag.new")).toHaveText("Нова · от сайта");
  await expect(c.locator(".tmr small")).toHaveText("остават");
  await expect(c.locator(".tmr b")).toHaveText(/^(19:[45]\d|20:00)$/);
  await expect(c.locator(".tk-m")).toHaveText(/пристигна \d\d:\d\d\s*срок \d\d:\d\d\s*шофьор \d\d:\d\d$/);
  await expect(c.locator(".tk-note")).toHaveText("Без прибори");
  /* only the lines of the section; the salad is in "Други секции" with its state in words */
  await expect(c.locator(".ln .nm")).toHaveText(["Кебапчета", "Свински врат"]);
  await expect(c.locator(".ln .q").first()).toHaveText(/^2\s×$/);
  await expect(c.locator(".md.no")).toHaveText("без лук");
  await expect(c.locator(".tk-o h4")).toHaveText("Други секции");
  await expect(c.locator(".tk-o .os")).toHaveText("Салати · чака");
  await expect(c.locator("[data-start]")).toHaveText("Започни");
  await expect(c.locator("[data-done] .lbl")).toHaveText(/^\s*Готово\s+задръжте 1 сек\.$/);
  /* the timer runs every second */
  const t0 = await c.locator(".tmr b").textContent();
  await expect(c.locator(".tmr b")).not.toHaveText(t0!, { timeout: 3000 });
  /* the counters and the tab: the same as the server */
  const n = (await queue(ctx)).tickets.length;
  await expect(page.locator("[data-qn]")).toHaveText(String(n));
  await expect(page.locator(".kcount > span").first()).toHaveText("Чакат " + n);
  /* the banner leads to the newest unopened order (other specs may place orders too: open them until it is ours) */
  const banner = page.locator(".knew");
  await expect(banner).toBeVisible();
  expect(await banner.evaluate((el) => getComputedStyle(el).animationName)).toContain("kglow");
  for (let i = 0; i < 20 && !((await banner.textContent()) || "").includes("№ " + o.no); i++) { await banner.click(); await page.waitForTimeout(150); }
  await expect(banner).toHaveText(new RegExp("^Нова · Доставка № " + o.no + "\\s*Виж$"));
  expect((await banner.boundingBox())!.height).toBeGreaterThanOrEqual(52);
  await banner.click();
  await expect(c).not.toHaveClass(/\bisnew\b/);
  await expect(c.locator(".tag.new")).toHaveCount(0);
  await expect(page.locator(".knew").filter({ hasText: "№ " + o.no })).toHaveCount(0);
  await expect.poll(() => inView(page, o.no)).toBe(true);
  await expect.poll(async () => (await ticket(ctx, o.no))!.isNew).toBe(false);
  /* another tablet of the same section finishes it: the card leaves this screen by itself */
  expect((await ctx.request.post("/api/kitchen/orders/" + o.no + "/done", { data: { sec: "skara" } })).status()).toBe(200);
  await expect(c).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the double tone of a new order: only after the first touch of this load, and only while „Звук“ is on", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  await ctx.addInitScript(() => {
    const w = window as unknown as { __osc: number; AudioContext: typeof AudioContext };
    w.__osc = 0;
    const P = w.AudioContext.prototype, orig = P.createOscillator;
    P.createOscillator = function (this: AudioContext) { w.__osc++; return orig.call(this); };
  });
  const tones = () => page.evaluate(() => (window as unknown as { __osc: number }).__osc);
  await open(page);
  const a = await order(request, "pickup", [{ id: "kebapcheta", q: 1 }]);
  await expect(card(page, a.no)).toBeVisible();
  expect(await tones()).toBe(0); /* the browser plays nothing before a touch: the key says "Звук: докоснете" */
  await expect(page.locator("[data-sound]")).toHaveText("Звук: докоснете");
  await page.locator("[data-clock]").click();
  await expect(page.locator("[data-sound]")).toHaveText("Звук вкл.");
  expect(await tones()).toBe(0);
  const b = await order(request, "pickup", [{ id: "kebapcheta", q: 1 }]);
  await expect(card(page, b.no)).toBeVisible();
  await expect.poll(tones).toBe(2); /* two tones */
  await page.locator("[data-sound]").click();
  await expect(page.locator("[data-sound]")).toHaveText("Звук изкл.");
  const c = await order(request, "pickup", [{ id: "kebapcheta", q: 1 }]);
  await expect(card(page, c.no)).toBeVisible();
  await page.waitForTimeout(400);
  expect(await tones()).toBe(2);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop a finger: a tap ticks a line, a 1 s hold hands the order over, a sliding finger does not", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const o = await order(request, "pickup", [{ id: "kebapcheta", q: 1 }, { id: "svinski-vrat", q: 1 }]);
  await open(page);
  const c = card(page, o.no), btn = c.locator("[data-done]");
  await c.locator(".ln").first().tap();
  await expect(c.locator(".ln").first()).toHaveClass(/\bdone\b/);
  await expect(page.locator("[data-sound]")).toHaveText("Звук вкл."); /* the first touch anywhere */
  const cdp = await ctx.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x = 0, y = 0) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: Math.round(x), y: Math.round(y) }] });
  await btn.scrollIntoViewIfNeeded();
  const b = (await btn.boundingBox())!, x = b.x + b.width / 2, y = b.y + b.height / 2;
  /* the finger slides on the button: no "Готово", the hint in the prototype's words */
  await touch("touchStart", x, y); await page.waitForTimeout(150);
  await touch("touchMove", x + 20, y + 4); await touch("touchMove", x + 40, y + 6);
  await expect(btn.locator(".lbl small")).toHaveText("Задръжте, без да местите пръста");
  await page.waitForTimeout(1100); await touch("touchEnd");
  await expect(c).toBeVisible();
  expect((await ticket(ctx, o.no))!.lines[1].ks).toBe("wait");
  /* the finger rests for a second */
  await touch("touchStart", x, y);
  await expect(btn).toHaveClass(/holding/);
  await page.waitForTimeout(1150); await touch("touchEnd");
  await expect(c).toHaveCount(0);
  await expect(page.locator(".kt")).toContainText("Вземане № " + o.no + " · готово");
  await expect(page.locator(".kt")).toContainText("Известихме клиента.");
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop with reduced motion nothing blinks: the colour and the word „Нова“ stay", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser, { reduced: true });
  await open(page);
  const o = await order(request, "pickup", [{ id: "kebapcheta", q: 1 }]);
  const c = card(page, o.no);
  await expect(c.locator(".tag.new")).toHaveText("Нова · от сайта");
  await expect(page.locator(".knew")).toBeVisible();
  expect(await page.locator(".knew").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await c.locator(".tag.new").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await c.locator(".tag.new").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  await expect(c.locator(".tk-k")).toHaveText(/^Вземане в \d\d:\d\d$/);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Започни“ -> „Готви се“ for the customer; a line ready / not ready with the notice, „Върни · 10“ and the wet-hand guard", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 2 }, { id: "svinski-vrat", q: 1 }]);
  const cust = await tracking(browser, o);
  await expect(cust.now).toHaveText("Приета");
  await open(page);
  const c = card(page, o.no);
  await c.locator("[data-start]").click();
  await expect(c.locator(".tag.cook")).toHaveText(/^готви се от \d\d:\d\d$/);
  await expect(c.locator("[data-start]")).toHaveCount(0);
  await expect(c.locator(".tk-f")).toHaveClass(/\bone\b/);
  await expect(c).not.toHaveClass(/\bisnew\b/);
  await expect(cust.now).toHaveText("Готви се");
  await expect.poll(async () => (await ticket(ctx, o.no))!.status).toBe("cooking");
  /* a line: one touch = ready */
  const ln = c.locator(".ln").first();
  await expect(ln).toHaveAccessibleName(/^2\s×\s*Кебапчета\s*, натиснете за готово$/);
  /* a second touch within 0,8 s is ignored (a wet hand): the line stays ready */
  await ln.click(); await ln.click();
  await expect(ln).toHaveClass(/\bdone\b/); await expect(ln).toHaveAttribute("aria-pressed", "true");
  const kt = page.locator(".kt");
  await expect(kt).toContainText("2 × Кебапчета · готово"); await expect(kt).toContainText("Доставка № " + o.no);
  await expect(toastBtn(page)).toHaveText(/^Върни · (10|9)$/);
  await expect(toastBtn(page)).toHaveText(/^Върни · [0-8]$/, { timeout: 4000 }); /* it counts down */
  await expect(page.locator(".kt")).toHaveCount(1);
  /* the notice takes the place of the counters: one line, 52 px, never over a card or a button */
  const g = await page.evaluate(() => { const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, h: b.height }; }; return { kt: r(".kt"), count: r(".kcount"), tools: r(".ktools"), main: r(".kmain"), bar: r(".kbar"), pills: [...document.querySelectorAll(".kstrip > :not(.kcount)")].map((e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; }) }; });
  expect(g.kt.h).toBe(52);
  expect(g.kt.l).toBeGreaterThanOrEqual(g.count.l - 1); expect(g.kt.r).toBeLessThanOrEqual(g.tools.l);
  expect(g.kt.t).toBeGreaterThanOrEqual(g.bar.b); expect(g.kt.b).toBeLessThanOrEqual(g.main.t);
  for (const p of g.pills) expect(p.t >= g.kt.b - 0.5 || p.b <= g.kt.t + 0.5 || p.l >= g.kt.r - 0.5 || p.r <= g.kt.l + 0.5).toBe(true);
  await expect(ln).toHaveClass(/\bdone\b/);
  await expect.poll(async () => (await ticket(ctx, o.no))!.lines[0].ks).toBe("ready");
  /* later a touch takes it back: "Върнато: …", and "Върни" makes it ready again */
  await page.waitForTimeout(900);
  await ln.click();
  await expect(ln).not.toHaveClass(/\bdone\b/);
  await expect(kt).toContainText("Върнато: 2 × Кебапчета"); await expect(kt).toContainText("пак е за готвене");
  await expect.poll(async () => (await ticket(ctx, o.no))!.lines[0].ks).toBe("cook");
  await toastBtn(page).click();
  await expect(page.locator(".kt")).toHaveCount(0);
  await expect(ln).toHaveClass(/\bdone\b/);
  await expect.poll(async () => (await ticket(ctx, o.no))!.lines[0].ks).toBe("ready");
  await expect(cust.now).toHaveText("Готви се");
  expect(errs).toEqual([]);
  await cust.ctx.close(); await ctx.close();
});

test("@desktop „Готово“ with a 1 s hold: a short press and a slide do nothing; the order becomes „Готова“ for the customer; „Върни“ takes it back; the last ticked line hands it over too", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }, { id: "svinski-vrat", q: 1 }]);
  const cust = await tracking(browser, o);
  await open(page);
  const c = card(page, o.no), btn = c.locator("[data-done]");
  await expect(btn).toHaveAccessibleName(new RegExp("^Готово\\s*задръжте 1 сек\\.\\s*: Доставка № " + o.no + "$"));
  expect(await btn.evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
  expect((await btn.boundingBox())!.height).toBe(64);
  /* a short press: the fill starts and stops, nothing happens */
  await btn.scrollIntoViewIfNeeded();
  const b = (await btn.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await expect(btn).toHaveClass(/holding/);
  await page.waitForTimeout(350); await page.mouse.up();
  await expect(btn).not.toHaveClass(/holding/);
  /* the finger slides: "Задръжте, без да местите пръста", in ember, for 2 s */
  await page.mouse.down(); await page.waitForTimeout(200);
  await page.mouse.move(b.x + b.width / 2 + 30, b.y + b.height / 2 + 6, { steps: 4 });
  await expect(btn.locator(".lbl small")).toHaveText("Задръжте, без да местите пръста");
  await expect(btn).toHaveClass(/hint/);
  await page.waitForTimeout(1100); await page.mouse.up();
  await expect(c).toBeVisible();
  expect((await ticket(ctx, o.no))!.status).toBe("accepted");
  await expect(btn.locator(".lbl small")).toHaveText("задръжте 1 сек.", { timeout: 4000 });
  /* the real hold */
  const n = +(await page.locator("[data-qn]").textContent())!;
  await hold(page, btn, 1150);
  await expect(c).toHaveCount(0);
  const kt = page.locator(".kt");
  await expect(kt).toContainText("Доставка № " + o.no + " · готово");
  await expect(kt).toContainText("Известихме шофьора.");
  await expect(toastBtn(page)).toHaveText(/^Върни · \d+$/);
  await expect(cust.now).toHaveText("Готова");
  await expect.poll(async () => +(await page.locator("[data-qn]").textContent())!).toBeLessThan(n + 1);
  expect(await ticket(ctx, o.no)).toBeUndefined();
  /* "Върни": back in the queue as it was, the customer sees "Готви се" again */
  await toastBtn(page).click();
  await expect(c).toBeVisible();
  await expect(cust.now).toHaveText("Готви се");
  await expect.poll(async () => (await ticket(ctx, o.no))?.lines.map((l) => l.ks).join()).toBe("wait,wait");
  /* the keyboard: Enter confirms at once ("Върни" covers a mistake) */
  await btn.focus(); await page.keyboard.press("Enter");
  await expect(c).toHaveCount(0);
  await expect(kt).toContainText("Известихме шофьора.");
  await toastBtn(page).click();
  await expect(c).toBeVisible();
  /* the last ticked line hands the order over exactly as "Готово" does; "Върни" returns only that line */
  await c.locator(".ln").nth(0).click();
  await expect(c.locator(".ln").nth(0)).toHaveClass(/\bdone\b/);
  await c.locator(".ln").nth(1).click();
  await expect(c).toHaveCount(0);
  await expect(kt).toContainText("Доставка № " + o.no + " · готово"); await expect(kt).toContainText("Известихме шофьора.");
  await expect(cust.now).toHaveText("Готова");
  await toastBtn(page).click();
  await expect(c).toBeVisible();
  await expect.poll(async () => (await ticket(ctx, o.no))?.lines.map((l) => l.ks).join()).toBe("ready,wait");
  await expect(c.locator(".ln").nth(0)).toHaveClass(/\bdone\b/);
  await expect(c.locator(".ln").nth(1)).not.toHaveClass(/\bdone\b/);
  expect(errs).toEqual([]);
  await cust.ctx.close(); await ctx.close();
});

test("@desktop an order of two sections: the grill is ready, the oven still cooks: nobody is told yet; a pickup tells the customer", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }, { id: "pitsa-margarita", q: 1, mods: ["+ Гъби"] }]);
  const p = await order(request, "pickup", [{ id: "svinski-vrat", q: 1 }]);
  const cust = await tracking(browser, o);
  await open(page);
  await expect(card(page, o.no).locator(".tk-o")).toContainText("Пица Маргарита");
  await expect(card(page, o.no).locator(".tk-o .os")).toHaveText("Пещ · чака");
  await hold(page, card(page, o.no).locator("[data-done]"), 1150);
  await expect(card(page, o.no)).toHaveCount(0);
  await expect(page.locator(".kt")).toContainText("Чака още Пещ. Шофьорът ще бъде известен, когато всичко е готово.");
  await expect(cust.now).toHaveText("Готви се");
  /* the oven's tablet shows the same order with the add-on in its own line and the grill "готово" */
  const pe = await tablet(browser, { sec: "pesht" });
  await open(pe.page);
  const pc = card(pe.page, o.no);
  await expect(pc.locator(".ln .nm")).toHaveText("Пица Маргарита");
  await expect(pc.locator(".md.add")).toHaveText("+ Гъби");
  await expect(pc.locator(".tk-o .os")).toHaveText("Скара · готово");
  await pe.ctx.close();
  /* a pickup with one section: the customer is told */
  await hold(page, card(page, p.no).locator("[data-done]"), 1150);
  await expect(page.locator(".kt")).toContainText("Вземане № " + p.no + " · готово");
  await expect(page.locator(".kt")).toContainText("Известихме клиента.");
  await expect(page.locator(".kt")).toHaveCount(1); /* one notice: the new one took the place of the old */
  expect(errs).toEqual([]);
  await cust.ctx.close(); await ctx.close();
});

test("@desktop „По-късно“: an order for a later hour is not in the queue; the key counts it and lists for when and when it enters", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  await open(page);
  const o = await order(request, "pickup", [{ id: "kebapcheta", q: 3 }, { id: "tiramisu", q: 1 }], { sched: "утре", slot: "12:30" });
  const key = page.locator("[data-later]");
  await expect.poll(async () => (await queue(ctx)).later.some((l) => l.no === o.no)).toBe(true);
  const n = (await queue(ctx)).later.length;
  await expect(key).toHaveText(new RegExp("^По-късно\\s*" + n + "$")); /* live, no reload */
  await expect(card(page, o.no)).toHaveCount(0);
  await expect(key).toHaveAttribute("aria-expanded", "false");
  await key.click();
  const panel = page.locator(".kpanel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "dialog"); await expect(panel).toHaveAccessibleName("Поръчки за по-късно");
  await expect(panel).toBeFocused();
  await expect(panel.locator("p")).toHaveText("Влизат в опашката 20 мин преди часа си.");
  const row = panel.locator(".lrow2").filter({ hasText: "Вземане № " + o.no });
  await expect(row.locator("small").first()).toHaveText("3 × Кебапчета"); /* only the lines of this section */
  await expect(row.locator(".when")).toHaveText("утре 12:30влиза утре 12:10");
  await expect(page.locator(".kpanel .lrow2")).toHaveCount(n);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  /* Esc closes and the focus is back on the key; a touch outside closes too */
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(key).toBeFocused(); await expect(key).toHaveAttribute("aria-expanded", "false");
  await key.click(); await expect(panel).toBeVisible();
  await page.locator("[data-clock]").click();
  await expect(panel).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop no connection: the bar with the instructions, the last data stay, the actions are kept with their time and sent when the connection is back", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const a = await order(request, "delivery", [{ id: "kebapcheta", q: 2 }, { id: "svinski-vrat", q: 1 }]);
  const b = await order(request, "pickup", [{ id: "svinski-vrat", q: 1 }]);
  await open(page);
  await page.locator("[data-clock]").click(); /* the first touch: "Звук вкл." */
  await expect(page.locator(".net")).toHaveText("Онлайн");
  const ca = card(page, a.no), cb = card(page, b.no);
  await expect(ca).toBeVisible(); await expect(cb).toBeVisible();
  await ctx.setOffline(true);
  /* a line ticked while there is no connection */
  await ca.locator(".ln").first().click();
  const tickedAt = Date.now();
  const off = page.locator(".koff");
  await expect(off).toBeVisible();
  await expect(off).toHaveAttribute("role", "alert");
  await expect(off.locator("b").first()).toHaveText("Няма връзка. Новите поръчки не идват.");
  await expect(off.locator("p").first()).toHaveText(/^Данните са от \d\d:\d\d\. Таймерите вървят по часовника на таблета\. „Готово“ се запазва и се изпраща, щом връзката се върне\.$/);
  await expect(off.locator("li")).toHaveText(["Проверете Wi-Fi на таблета.", /^Ако до 2 мин няма връзка, кажете на управителя\./]);
  await expect(page.locator(".net")).toHaveText("Няма връзка"); await expect(page.locator(".net")).toHaveClass(/off/);
  /* the last data stay; the counters are under the bar; "Търси" and "Молив" stay; the keys of the row wait for the connection */
  await expect(ca.locator(".ln").first()).toHaveClass(/\bdone\b/);
  await expect(page.locator(".kcount")).toContainText("Чакат");
  await expect(page.locator("[data-sound], .knew, [data-later]")).toHaveCount(0);
  await expect(page.locator(".ktools [data-kfind]")).toBeVisible();
  const g = await page.evaluate(() => { const r = (s: string) => { const x = document.querySelector(s)!.getBoundingClientRect(); return { t: x.top, b: x.bottom, l: x.left, r: x.right }; }; return { off: r(".koff"), count: r(".kcount"), tools: r(".ktools"), main: r(".kmain"), over: document.documentElement.scrollWidth - innerWidth }; });
  expect(g.count.t).toBeGreaterThanOrEqual(g.off.b); expect(g.tools.t).toBeGreaterThanOrEqual(g.off.b); expect(g.main.t).toBeGreaterThanOrEqual(g.count.b - 1); expect(g.over).toBeLessThanOrEqual(0);
  await expect(page.locator(".kt")).toContainText("2 × Кебапчета · готово");
  /* the timers go on by the tablet's clock */
  const t0 = await ca.locator(".tmr b").textContent();
  await expect(ca.locator(".tmr b")).not.toHaveText(t0!, { timeout: 3000 });
  /* "Започни" and "Готово" work the same; the notice says it will be sent */
  await cb.locator("[data-start]").click();
  await expect(cb.locator(".tag.cook")).toHaveText(/^готви се от \d\d:\d\d$/);
  await hold(page, cb.locator("[data-done]"), 1150);
  await expect(cb).toHaveCount(0);
  await expect(page.locator(".kt")).toContainText("Вземане № " + b.no + " · готово");
  await expect(page.locator(".kt")).toContainText("Ще се изпрати, щом връзката се върне.");
  /* kept on the tablet, in order, each with its moment */
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("sk-outbox") || "[]") as { sec: string; at: number; a: { k: string; no: string } }[]);
  expect(kept.map((x) => [x.a.k, x.a.no, x.sec])).toEqual([["line", a.no, "skara"], ["start", b.no, "skara"], ["done", b.no, "skara"]]);
  expect(Math.abs(kept[0].at - tickedAt)).toBeLessThan(3000);
  expect((await ticket(ctx, a.no))!.lines[0].ks).toBe("wait"); /* the server has heard nothing yet */
  /* "Опитай пак" while there is still no connection: it says so, nothing is lost */
  await off.locator("[data-retry]").click();
  await expect(off.locator(".still")).toHaveText(/^Още няма връзка \(проверено в \d\d:\d\d\)\.$/);
  await page.waitForTimeout(2500);
  /* the connection is back */
  /* the tablet notices by itself (and "Опитай пак" asks at once) */
  await ctx.setOffline(false);
  const backAt = Date.now();
  await expect(off).toHaveCount(0, { timeout: 12_000 });
  await expect(page.locator(".net")).toHaveText("Онлайн");
  await expect(page.locator("[data-sound]")).toHaveText("Звук вкл.");
  expect(await page.evaluate(() => localStorage.getItem("sk-outbox"))).toBeNull();
  /* the server has them with the time they were MADE, not the time they were sent */
  const ta = (await ticket(ctx, a.no))!;
  expect(ta.lines[0].ks).toBe("ready");
  const readyAt = Date.parse(ta.lines[0].readyAt!);
  expect(Math.abs(readyAt - tickedAt)).toBeLessThan(3000);
  expect(backAt - readyAt).toBeGreaterThan(2000);
  expect(await ticket(ctx, b.no)).toBeUndefined();
  const pub = await (await request.get("/api/orders/" + b.no + "-" + b.key)).json() as { status: string };
  expect(pub.status).toBe("ready");
  await expect(ca.locator(".ln").first()).toHaveClass(/\bdone\b/);
  await expect(cb).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Търси“: number, dish in Latin letters, „×“, Enter goes to the card and frames it; from another screen through the address", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser, { reduced: true });
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 2 }, { id: "tiramisu", q: 1 }]);
  const lt = await order(request, "pickup", [{ id: "svinski-vrat", q: 1 }], { sched: "утре", slot: "12:30" });
  await open(page);
  const find = page.locator("[data-kfind]");
  await expect(find).toHaveAccessibleName("Търси в чакащите поръчки: номер, маса, ястие");
  await find.click();
  const dlg = page.locator(".kfind.on"), inp = dlg.locator("#kq");
  await expect(dlg).toHaveAttribute("role", "dialog"); await expect(dlg).toHaveAttribute("aria-modal", "true");
  await expect(inp).toBeFocused();
  await expect(dlg.locator(".fscope")).toHaveText("Търсите само в чакащите поръчки на Скара Bertha: номер, маса, ястие (и на латиница).");
  await expect(dlg.locator(".fchips button").filter({ hasText: "Доставки" })).toHaveCount(1);
  expect(await page.evaluate(() => (document.querySelector(".kd") as HTMLElement).inert)).toBe(true);
  /* the focus stays inside */
  for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement?.closest(".kfind"))).toBe(true); }
  /* the number */
  await inp.fill(o.no);
  const row = dlg.locator('.kfrow[data-go="' + o.no + '"]');
  await expect(row.locator("b")).toHaveText("Доставка № " + o.no);
  await expect(row.locator("span:not(.tm) > small")).toHaveText("2 × Кебапчета"); /* the lines of this section only */
  await expect(row.locator(".tm")).toHaveText(/^остават\d\d:\d\d$/);
  await expect(dlg.locator("h3").first()).toHaveText(/^Чакат\d+$/);
  expect(await serious(page)).toEqual([]);
  /* one "×": clears, the field keeps the focus; the browser's own button is hidden */
  const clr = dlg.locator("[data-clr]");
  await expect(clr).toBeVisible(); await expect(clr).toHaveAccessibleName("Изчисти търсенето");
  await clr.click();
  await expect(inp).toHaveValue(""); await expect(inp).toBeFocused(); await expect(clr).toBeHidden();
  await expect(dlg.locator(".fchips")).toBeVisible();
  /* a dish, in Latin letters: the found dish is bold */
  await inp.fill("kebap");
  await expect(row.locator("strong")).toHaveText("2 × Кебапчета");
  await inp.fill("доставка");
  await expect(row).toBeVisible();
  await expect(dlg.locator(".kfrow b").filter({ hasText: "Вземане" })).toHaveCount(0);
  /* "По-късно" is listed apart; a touch says when it enters the queue */
  await inp.fill(lt.no);
  const later = dlg.locator('.kfrow[data-go="' + lt.no + '"]');
  await expect(later.locator(".tm")).toHaveText("влиза утре в12:10");
  await expect(dlg.locator("h3")).toHaveText(/^По-късно1$/);
  await later.click();
  await expect(page.locator(".kfind")).toHaveCount(0);
  await expect(page.locator(".kt")).toHaveText(/Поръчката влиза в опашката утре в 12:10/);
  await expect(page.locator(".kt button")).toHaveCount(0);
  /* nothing found: where the search looks */
  await find.click();
  await inp.fill("зззз");
  await expect(dlg.locator(".kfempty b")).toHaveText("Няма „зззз“ в чакащите");
  await expect(dlg.locator(".kfempty p")).toHaveText("Търсите само в поръчките на Скара Bertha: номер, маса, доставка, вземане или ястие.");
  /* Esc closes, the focus is back on "Търси" */
  await page.keyboard.press("Escape");
  await expect(page.locator(".kfind")).toHaveCount(0);
  await expect(find).toBeFocused();
  expect(await page.evaluate(() => (document.querySelector(".kd") as HTMLElement).inert)).toBe(false);
  /* the number + Enter at once: to the card, framed for a moment */
  await find.click();
  await inp.fill(o.no); await page.keyboard.press("Enter");
  await expect(page.locator(".kfind")).toHaveCount(0);
  await expect(card(page, o.no)).toHaveClass(/\bfound\b/);
  await expect.poll(() => inView(page, o.no)).toBe(true);
  await expect(card(page, o.no)).not.toHaveClass(/\bfound\b/, { timeout: 5000 });
  /* from another screen: through the address of the queue */
  await page.goto("/kuhnya/izcherpano/");
  await expect(page.locator("[data-qn]")).toBeVisible();
  await find.click();
  await inp.fill(o.no);
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/kuhnya\/(#go=\d+)?$/);
  await expect(card(page, o.no)).toHaveClass(/\bfound\b/);
  await expect(page).toHaveURL(/\/kuhnya\/$/); /* the parameter is used once */
  /* the prototype's form of the parameter works too */
  await page.goto("/kuhnya/#go=d" + o.no);
  await expect(card(page, o.no)).toHaveClass(/\bfound\b/);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the empty queue: the polite text, „Звук: докоснете екрана …“ until the first touch, the last finished order", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser);
  await page.route("**/api/kitchen/queue*", async (r) => {
    const res = await r.fetch(); const q = await res.json();
    await r.fulfill({ response: res, json: { ...q, tickets: [], later: [], counts: { ...q.counts, wait: 0, late: 0, soon: 0, later: 0 }, lastDone: { text: "Доставка № 1040", hm: "19:40" } } });
  });
  await open(page);
  await expect(page.locator(".kempty h2")).toHaveText("Няма поръчки в момента");
  await expect(page.locator(".kempty p")).toHaveText(["Новите поръчки за Скара Bertha ще се появят тук сами.", "Звук: докоснете екрана, за да чувате новите поръчки.", "Последна изпълнена: Доставка № 1040 в 19:40"]);
  await expect(page.locator(".kcount")).toHaveText("Чакат 0");
  await expect(page.locator("[data-qn]")).toHaveText("0");
  await expect(page.locator("[data-later], .knew, .tk, .kmore:visible")).toHaveCount(0);
  await page.locator(".kempty h2").click();
  await expect(page.locator(".kempty p")).toHaveText(["Новите поръчки за Скара Bertha ще се появят тук сами, със звуков сигнал.", "Последна изпълнена: Доставка № 1040 в 19:40"]);
  await expect(page.locator("[data-sound]")).toHaveText("Звук вкл.");
  /* with the sound off nothing is promised */
  await page.locator("[data-sound]").click();
  await expect(page.locator(".kempty p").first()).toHaveText("Новите поръчки за Скара Bertha ще се появят тук сами.");
  expect(await serious(page)).toEqual([]);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the queue cannot be loaded: the error with „Опитай пак“, then the queue", async ({ browser }) => {
  const { ctx, page } = await tablet(browser);
  let fail = true;
  await page.route("**/api/kitchen/queue*", (r) => (fail ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "server", message: "Нещо се обърка. Опитайте пак." }) }) : r.continue()));
  await page.goto("/kuhnya/");
  await expect(page.locator(".kempty h2")).toHaveText("Не успяхме да заредим данните");
  fail = false;
  await page.locator("[data-again]").click();
  await loaded(page);
  await expect(page.locator(".kempty .bad")).toHaveCount(0);
  await ctx.close();
});

/* many orders: the widths of the prototype (3 whole cards + the edge of the next at 1280, 2 + edge at 1024 and 768, 4 + edge from 1400) */
const LAYOUT: [number, number, number, number][] = [[1280, 800, 3, 36], [1024, 768, 2, 24], [768, 1024, 2, 24], [1440, 900, 4, 48]];
test.describe("many orders", () => {
  test.describe.configure({ mode: "serial" });
  test("@desktop six orders of the section are made", async ({ request }) => {
    for (let i = 0; i < 6; i++) await order(request, i % 2 ? "delivery" : "pickup", [{ id: i % 3 ? "kebapcheta" : "svinski-vrat", q: 1 + (i % 2) }, { id: "parzheni-kartofi", q: 1 }]);
  });
  for (const [w, h, whole, gaps] of LAYOUT) for (const theme of (w === 1440 ? ["dark"] : ["dark", "light"]) as ("dark" | "light")[]) {
    test(`@desktop ${w} × ${h} ${theme}: ${whole} whole cards and the edge of the next, „+N още“, „← N по-стари“, the sizes for reading from 2 m`, async ({ browser }) => {
      const { ctx, page, errs } = await tablet(browser, { w, h, theme, reduced: true });
      await open(page);
      await expect(page.locator(".tk").nth(5)).toBeAttached();
      const g = await page.evaluate(() => {
        const q = document.querySelector("[data-q]") as HTMLElement, qr = q.getBoundingClientRect();
        const cards = [...q.querySelectorAll<HTMLElement>(".tk")].map((c) => c.getBoundingClientRect());
        const cs = (s: string, p: string) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p);
        const more = document.querySelector("[data-kmore]") as HTMLElement, mr = more.getBoundingClientRect(), first = q.querySelector(".tk")!;
        const tm = first.querySelector(".tmr")!.getBoundingClientRect(), tt = first.querySelector(".tk-t")!.getBoundingClientRect(), fr = first.getBoundingClientRect(), ft = first.querySelector(".tk-f")!.getBoundingClientRect();
        return {
          n: cards.length, w: cards[0].width, whole: cards.filter((c) => c.left >= qr.left - 1 && c.right <= qr.right + 1).length, edge: cards.filter((c) => c.left < qr.right - 8 && c.right > qr.right + 4).length,
          scroll: q.scrollWidth - q.clientWidth, over: document.documentElement.scrollWidth - innerWidth, bottom: Math.max(...cards.map((c) => c.bottom)), vh: innerHeight,
          more: { hidden: more.hidden, text: more.textContent, w: mr.width, r: mr.right, name: more.getAttribute("aria-label") },
          f: { t: cs(".tk-t", "font-size"), tm: cs(".tmr b", "font-size"), tms: cs(".tmr small", "font-size"), nm: cs(".ln .nm", "font-size"), q: cs(".ln .q", "font-size"), qn: cs(".ln .q", "font-variant-numeric"), k: cs(".tk-k", "font-size"), m: cs(".tk-m", "font-size"), kb: cs(".kb", "min-height"), ln: cs(".ln", "min-height") },
          timer: { r: tm.right, l: tm.left, titleR: tt.right, cardR: fr.right, cardL: fr.left }, foot: { b: ft.bottom, cardB: fr.bottom },
        };
      });
      expect(g.over).toBeLessThanOrEqual(0);
      expect(g.scroll).toBeGreaterThan(0);
      expect(g.w).toBeCloseTo((w - 32 - (w < 900 ? 40 : 76) - gaps) / whole, 0);
      expect(g.whole).toBe(whole); expect(g.edge).toBe(1);
      expect(g.bottom).toBeLessThanOrEqual(g.vh);
      /* "+N още" on the right edge, 60 px */
      expect(g.more.hidden).toBe(false); expect(g.more.w).toBe(60); expect(Math.round(g.more.r)).toBe(w);
      expect(g.more.text).toBe("+" + (g.n - whole) + " още");
      expect(g.more.name).toMatch(/^\+\d+ още поръчк[аи] вдясно$/);
      /* sizes: the source and the timer 40 px, the dishes 25 px, the quantities 26 px with tabular figures */
      expect(g.f).toMatchObject({ t: "40px", tm: "40px", tms: "16px", nm: "25px", q: "26px", qn: "tabular-nums", k: "17px", m: "16px", kb: "64px", ln: "72px" });
      /* the timer is never cut and never under the title */
      expect(g.timer.r).toBeLessThanOrEqual(g.timer.cardR - 12); expect(g.timer.l).toBeGreaterThanOrEqual(g.timer.titleR - 1);
      expect(g.foot.b).toBeLessThanOrEqual(g.foot.cardB);
      /* to the right and back: the left edge says how many older orders are out of sight */
      const less = page.locator("[data-kless]");
      await expect(less).toBeHidden();
      await page.locator("[data-kmore]").click();
      await expect(less).toBeVisible();
      await expect(less).toHaveText(/^\d+ по-стари( \d+\s*закъснява(т)?)?$/);
      await expect(less).toHaveAccessibleName(/^\d+ по-стари( \d+ закъснява(т)?)?\. Към началото на опашката$/);
      expect((await less.boundingBox())!.x).toBe(0);
      await less.click();
      await expect(less).toBeHidden();
      expect(await page.evaluate(() => (document.querySelector("[data-q]") as HTMLElement).scrollLeft)).toBe(0);
      expect(await serious(page), "axe").toEqual([]);
      expect(errs).toEqual([]);
      await ctx.close();
    });
  }
  test("@desktop 20 s without a touch: the queue returns to the oldest orders by itself", async ({ browser }) => {
    const { ctx, page } = await tablet(browser, { reduced: true });
    await page.clock.install();
    await open(page);
    await expect(page.locator(".tk").nth(5)).toBeAttached();
    await page.locator("[data-kmore]").click();
    await expect.poll(() => page.evaluate(() => (document.querySelector("[data-q]") as HTMLElement).scrollLeft)).toBeGreaterThan(40);
    await page.clock.runFor(15_000);
    expect(await page.evaluate(() => (document.querySelector("[data-q]") as HTMLElement).scrollLeft)).toBeGreaterThan(40);
    await page.clock.runFor(7_000);
    await expect.poll(() => page.evaluate(() => (document.querySelector("[data-q]") as HTMLElement).scrollLeft)).toBe(0);
    await ctx.close();
  });
});
