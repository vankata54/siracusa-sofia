import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* "Часовник" of the waiter (/servitor/chasovnik/, src/modules/servitor/watch.ts) on the live data: a guest's call shows
   on both faces (round 232 px, rectangular 204 × 244 px; always dark) with "Отивам" → "Обслужено" (+ "Отмени"), and the
   phone vibrates 2 long; a ready order of the kitchen with "Сервирах"; the dots when several wait; no connection: "Дръж
   телефона с теб и провери Bluetooth"; text ≥ 14 px, the buttons 52-56 px; 360 and 390, light and dark; axe. The preview
   clock 19:30; the projects use their own tables (phone 12, desktop 13). Other calls of the parallel tests may wait too:
   the test swipes to its own table. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const PASS: Record<string, string> = { admin: E.ADMIN_PASSWORD, waiter: E.WAITER_PASSWORD, kitchen: E.KITCHEN_PASSWORD };
const CLOCK = { "x-sc-clock": "19:30" };
const Q = "?preview=1&t=19:30";
const tableOf = (page: Page) => ((page.viewportSize()?.width || 1440) < 700 ? 12 : 13);

async function signIn(ctx: BrowserContext | APIRequestContext, role: string) {
  const req = "request" in ctx ? ctx.request : ctx;
  const r = await req.post("/api/auth/login", { data: { username: role === "admin" ? E.ADMIN_USER || "admin" : role, password: PASS[role] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[1349]|net::ERR_|Failed to fetch/.test(m.text())) list.push(m.text()); });
  return list;
}
async function api<T = any>(req: APIRequestContext, method: "GET" | "POST", path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const r = await req.fetch("/api/" + path, { method, headers: CLOCK, data: data as object | undefined });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}
async function freeTable(w: APIRequestContext, n: number) {
  const d = (await api<any>(w, "GET", "floor/table/" + n)).body;
  if (!d.session) return;
  if (d.pending) await api(w, "POST", "floor/table/" + n + "/qr/reject", { reason: "test" });
  if (d.rest > 0) await api(w, "POST", "floor/table/" + n + "/pay", { how: "cash" });
  expect((await api(w, "POST", "floor/table/" + n + "/close", { force: true })).status).toBe(200);
}
async function open(page: Page, theme?: string) {
  await page.addInitScript((t) => {
    if (t) { try { localStorage.setItem("st-prefs", JSON.stringify({ theme: t })); } catch { /* ignore */ } }
    /* the vibrations the page asks for */
    const w = window as unknown as { __vib: unknown[] };
    w.__vib = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p: unknown) => { w.__vib.push(p); return true; } });
  }, theme || "");
  await page.goto("/servitor/chasovnik/" + Q);
  await expect(page.locator(".st-app:not([data-boot]) .st-top h1")).toHaveText("Часовник");
  await expect(page.locator("[data-pair] .w")).toHaveCount(2);
}
/** nothing sticks out of the phone column (the column clips, so scrollWidth alone would not show it) */
const clipped = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && el.offsetParent !== null && (r.right > innerWidth + 0.5 || r.left < -0.5) && !el.closest(".guests, .st-toast, .vh, .skip"); }).map((el) => el.tagName + "." + el.className));
/** swipe on the round face until it shows table n */
async function swipeTo(page: Page, n: number) {
  const face = page.locator(".w.round");
  for (let i = 0; i < 12; i++) {
    if (((await face.locator(".t").textContent()) || "").trim() === "Маса " + n) return;
    const b = (await face.boundingBox())!;
    await page.mouse.move(b.x + b.width - 30, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + 30, b.y + b.height / 2, { steps: 4 }); await page.mouse.up();
    await page.waitForTimeout(150);
  }
  await expect(face.locator(".t")).toHaveText("Маса " + n);
}

test.beforeAll(() => { test.skip(!E.WAITER_PASSWORD || !E.KITCHEN_PASSWORD || !E.ADMIN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("a live call: „Отивам“ → „Обслужено“, the vibration; a ready order: „Сервирах“; no connection", async ({ page, context, playwright, baseURL }) => {
  const errs = errors(page), n = tableOf(page);
  await signIn(context, "waiter");
  const w = context.request;
  const admin = await playwright.request.newContext({ baseURL }); await signIn(admin, "admin");
  const kitchen = await playwright.request.newContext({ baseURL }); await signIn(kitchen, "kitchen");
  const anon = await playwright.request.newContext({ baseURL });
  await freeTable(w, n);
  await open(page);
  await expect(page.locator(".wnote")).toContainText("Изгледът за браузъра на часовника и за известията на телефона.");
  await expect(page.locator(".wnote .missing")).toHaveText("[ЛИПСВА: кои часовници поддържаме]");
  /* the page was touched (the browser lets a page vibrate only after that): "Пробвай" a vibration */
  await expect(page.locator("[data-vib]")).toHaveText([/Повикване.*2 дълги/, /Готово от кухнята.*3 кратки/, /Закъснява.*повтаря се/]);
  await page.locator('[data-vib="call"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __vib: unknown[] }).__vib.length)).toBe(1);

  /* a guest asks for the bill */
  const code = (await api<{ n: number; code: string }[]>(admin, "GET", "admin/qr")).body.find((x) => x.n === n)!.code, g = "c".repeat(31) + (n % 10);
  expect((await api(anon, "POST", "floor/t/" + code + "/open", { g, fresh: true })).status).toBe(200);
  expect((await api(anon, "POST", "floor/t/" + code + "/call", { g, kind: "bill" })).status).toBe(200);
  await swipeTo(page, n);
  for (const sel of [".w.round", ".w.rect"]) {
    const f = page.locator(sel + " .face");
    await expect(f).toHaveClass(/call/);
    await expect(f.locator(".t")).toHaveText("Маса " + n);
    await expect(f.locator(".why")).toHaveText("Сметка");
    await expect(f.locator(".tm")).toHaveText(/^\d+:\d\d$/);
    await expect(f.locator(".btn")).toHaveText("Отивам");
  }
  await expect.poll(() => page.evaluate(() => JSON.stringify((window as unknown as { __vib: unknown[] }).__vib))).toContain("[400,200,400]");
  const dots = page.locator(".w.round .pager");
  if (await dots.count()) await expect(dots).toHaveAttribute("aria-label", /^\d+ от \d+$/);
  await page.locator(".w.round .btn").click();
  for (const sel of [".w.round", ".w.rect"]) {
    await expect(page.locator(sel + " .face")).toHaveClass(/ok/);
    await expect(page.locator(sel + " .btn")).toHaveText("Обслужено");
  }
  await expect(page.locator(".w.rect .face")).toContainText("Отивам");
  await page.locator(".w.rect .btn").click();
  await expect(page.locator(".st-toast.on")).toContainText("Обслужено");
  const left = (await api<any>(w, "GET", "floor/table/" + n)).body.calls;
  expect(left).toEqual([]);

  /* a ready order of the kitchen: "Сервирах" */
  const o = (await api<{ orders: string[] }>(w, "POST", "floor/table/" + n + "/order", { lines: [{ id: "pitsa-margarita", q: 2 }] })).body.orders[0];
  expect((await api(kitchen, "POST", "kitchen/orders/" + o + "/done", { sec: "all" })).status).toBe(200);
  await swipeTo(page, n);
  await expect(page.locator(".w.round .face")).toHaveClass(/ready/);
  await expect(page.locator(".w.round .muted")).toHaveText("2× Пица Маргарита");
  await expect(page.locator(".w.round .btn")).toHaveText("Сервирах");
  await page.locator(".w.round .btn").click();
  await expect(page.locator(".st-toast.on")).toContainText("Сервирано · Маса " + n);
  await expect.poll(async () => (await api<any>(w, "GET", "floor/table/" + n)).body.unserved.length).toBe(0);

  /* no connection */
  await context.setOffline(true);
  for (const sel of [".w.round", ".w.rect"]) await expect(page.locator(sel + " .face")).toContainText("Няма връзкаДръж телефона с теб и провери Bluetooth");
  await context.setOffline(false);
  await expect(page.locator(".w.round .face")).not.toContainText("Няма връзка", { timeout: 15_000 });
  expect(errs).toEqual([]);
  await Promise.all([admin.dispose(), kitchen.dispose(), anon.dispose()]);
});

test("360 and 390, light and dark: always dark faces, text ≥ 14 px, buttons 52-56 px, no horizontal scroll, axe @phone", async ({ browser, baseURL }) => {
  for (const [width, theme] of [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, baseURL });
    await signIn(ctx, "waiter");
    const page = await ctx.newPage(), errs = errors(page);
    await open(page, theme);
    const box = async (s: string) => (await page.locator(s).boundingBox())!;
    expect(Math.round((await box(".w.round")).width)).toBe(232);
    const r = await box(".w.rect"); expect([Math.round(r.width), Math.round(r.height)]).toEqual([204, 244]);
    /* the face is dark in both themes */
    expect(await page.locator(".w.round .face").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(18, 18, 17)");
    const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main *")).filter((el) => el.offsetParent !== null && [...el.childNodes].some((x) => x.nodeType === 3 && x.textContent!.trim()) && parseFloat(getComputedStyle(el).fontSize) < 14).map((el) => el.textContent));
    expect(small).toEqual([]);
    for (const b of await page.locator(".face .btn").all()) { const h = (await b.boundingBox())!.height; expect(h).toBeGreaterThanOrEqual(52); expect(h).toBeLessThanOrEqual(56); }
    const tiny = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main button, main a, .st-top a, .st-top button")).filter((el) => el.offsetParent !== null).map((el) => el.getBoundingClientRect()).filter((x) => x.width < 48 || x.height < 48).length);
    expect(tiny).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await clipped(page)).toEqual([]);
    const ax = await new AxeBuilder({ page }).analyze();
    expect(ax.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((x) => x.target.join(" ")).join(", "))).toEqual([]);
    expect(errs).toEqual([]);
    await ctx.close();
  }
});
