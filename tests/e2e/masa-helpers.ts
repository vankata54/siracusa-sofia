/* QR маса e2e: the table codes from the admin's QR list, the phones (a browser context = a phone, its token in
   localStorage "sc-masa-g"), the waiter / the kitchen through their API, the guests' API for a quick setup.
   Every test uses its own table; the two projects use different tables (they run at the same time on one server).
   The page and the API follow the preview clock 19:42 (SC_PREVIEW_API=1), so the kitchen is open at any real hour. */
import { expect, type Browser, type BrowserContext, type Page, type APIRequestContext } from "@playwright/test";
import { E, USER } from "./own-server.ts";

export const CLOCK = "19:42";
export const PV = "?preview=1&t=" + CLOCK;
const H = { "x-sc-clock": CLOCK };
export type QrRow = { id: string; n: number; zone: string; code: string };
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
/* admin-qr.spec.ts renews the codes of S5 / S6: never those */
const PHONE = [1, 2, 3, 4, 7, 8, 9], DESK = [13, 14, 15, 16, 17, 18, 19];
/** the table number for test slot i of this project */
export const tableN = (page: Page, i: number) => (isPhone(page) ? PHONE : DESK)[i];

export async function signIn(req: APIRequestContext, who: "admin" | "waiter" | "kitchen" | "manager", base = "") {
  const u = who === "waiter" ? ["waiter", E.WAITER_PASSWORD] : who === "kitchen" ? ["kitchen", E.KITCHEN_PASSWORD] : USER[who];
  const r = await req.post(base + "/api/auth/login", { data: { username: u[0], password: u[1] } });
  expect(r.status(), "sign-in " + who).toBe(200);
}
/** the table's code from /api/admin/qr */
export async function codeOf(browser: Browser, baseURL: string, n: number): Promise<QrRow> {
  const ctx = await browser.newContext({ baseURL });
  await signIn(ctx.request, "admin");
  const rows = (await (await ctx.request.get("/api/admin/qr")).json()) as QrRow[];
  await ctx.close();
  const r = rows.find((x) => x.n === n);
  expect(r, "table " + n).toBeTruthy();
  return r!;
}
/** a phone at the table: its own context (its own token), the same size as the test's page */
export async function phone(browser: Browser, page: Page, baseURL: string, tok?: string): Promise<{ ctx: BrowserContext; page: Page; errors: string[] }> {
  const vp = page.viewportSize() || { width: 390, height: 844 };
  const ctx = await browser.newContext({ baseURL, viewport: vp, isMobile: vp.width < 700, hasTouch: vp.width < 700 });
  if (tok) await ctx.addInitScript((t) => { try { localStorage.setItem("sc-masa-g", t); } catch { /* ignore */ } }, tok);
  const p = await ctx.newPage();
  return { ctx, page: p, errors: watch(p) };
}
export function watch(page: Page): string[] {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[13489]|422|429)|net::ERR_INTERNET_DISCONNECTED|Failed to fetch|ERR_NETWORK/.test(m.text())) list.push(m.text()); });
  return list;
}
export const tokenOf = async (page: Page) => page.evaluate(() => localStorage.getItem("sc-masa-g") || "");
/** a new phone token for a test (32 hex; never the same in two runs on one database) */
export const tok = (_seed: string) => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

/** the waiter (and the kitchen) through their API, on the preview clock */
export async function staff(browser: Browser, baseURL: string, who: "waiter" | "kitchen" | "admin" | "manager" = "waiter") {
  const ctx = await browser.newContext({ baseURL, extraHTTPHeaders: H });
  await signIn(ctx.request, who);
  const r = ctx.request;
  const ok = async (p: Promise<import("@playwright/test").APIResponse>) => { const x = await p; expect(x.ok(), x.url() + " " + (await x.text()).slice(0, 200)).toBe(true); return x.json(); };
  return {
    ctx, r, ok,
    table: (n: number) => ok(r.get("/api/floor/table/" + n)),
    confirm: (n: number) => ok(r.post("/api/floor/table/" + n + "/qr/confirm", { data: {} })),
    reject: (n: number, reason: string) => ok(r.post("/api/floor/table/" + n + "/qr/reject", { data: { reason } })),
    serve: (n: number) => ok(r.post("/api/floor/table/" + n + "/serve", { data: {} })),
    pay: (n: number, how = "card") => ok(r.post("/api/floor/table/" + n + "/pay", { data: { how } })),
    close: (n: number) => ok(r.post("/api/floor/table/" + n + "/close", { data: { force: true } })),
    /** the end of a test: the waiting order refused, the rest paid, the table closed (the next test starts clean) */
    clear: async (n: number) => {
      await r.post("/api/floor/table/" + n + "/qr/reject", { data: { reason: "test" } });
      await r.post("/api/floor/table/" + n + "/pay", { data: { how: "cash" } });
      await r.post("/api/floor/table/" + n + "/close", { data: { force: true } });
    },
    hall: () => ok(r.get("/api/floor/hall")),
    start: (no: string) => ok(r.post("/api/kitchen/orders/" + no + "/start", { data: { sec: "all" } })),
    ready: (no: string, i: number) => ok(r.post("/api/kitchen/orders/" + no + "/line", { data: { i, ready: true, sec: "all" } })),
  };
}
/** the guests' API with a known token (a quick setup before the pages open) */
export function guest(req: APIRequestContext, code: string, g: string) {
  const post = async (path: string, body: Record<string, unknown> = {}) => { const x = await req.post("/api/floor/t/" + code + "/" + path, { headers: H, data: { g, ...body } }); expect(x.ok(), path + " " + (await x.text()).slice(0, 200)).toBe(true); return x.json(); };
  return { post, open: (fresh = false) => post("open", { fresh }), add: (id: string, q = 1) => post("cart/add", { id, q }), send: () => post("send"), call: (kind: string) => post("call", { kind }) };
}
export const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
/** every visible button, link and field of the page is at least 48 px high (the text links in a sentence excepted) */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>("main a[href], main button, main input:not([type=checkbox]), main textarea, .ov a[href], .ov button, .top a, .top button")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest("[inert]"); })
    .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 47.5 && !el.closest("p, .missing") && !el.classList.contains("skip"); })
    .map((el) => (el.className || el.tagName) + ": " + (el.textContent || "").trim().slice(0, 30) + " " + Math.round(el.getBoundingClientRect().height)));
}
