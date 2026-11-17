/* Helpers for the e2e of the waiter's screens (servitor-hall, servitor-calls, servitor-login): accounts from .env, a fresh
   waiter per test (the tests run in parallel on one database: every test has its own people and its own tables), the
   guests at a table through the masa API, the kitchen through its API, axe, the console. */
import { expect, request, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
export const E = env();
export const BASE = "http://localhost:" + (+(process.env.E2E_PORT || 8788));
/** the kitchen takes orders until 22:30: the API calls of the tests run on the shop clock 19:00 (test mode only) */
const CLOCK = { "x-sc-clock": "19:00" };
export const rnd = () => Math.random().toString(36).slice(2, 8);
export const tok = () => Array.from({ length: 32 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

export async function apiAs(username: string, password: string): Promise<APIRequestContext> {
  const r = await request.newContext({ baseURL: BASE, extraHTTPHeaders: CLOCK });
  const x = await r.post("/api/auth/login", { data: { username, password } });
  expect(x.status(), "sign-in " + username).toBe(200);
  return r;
}
export const admin = () => apiAs(E.ADMIN_USER || "admin", E.ADMIN_PASSWORD);
export const kitchen = () => apiAs("kitchen", E.KITCHEN_PASSWORD);

export interface Waiter { username: string; name: string; password: string; id: string; api: APIRequestContext }
/** a new waiter of this test (the admin's "Нов потребител") */
export async function newWaiter(a: APIRequestContext, name?: string): Promise<Waiter> {
  const username = "e2e.sv" + rnd(), password = "dlga-parola-" + rnd(), nm = name || "Сервитьор " + rnd().slice(0, 4).toUpperCase();
  const r = await a.post("/api/admin/staff", { data: { username, name: nm, role: "waiter", password } });
  expect(r.status(), "new waiter").toBe(201);
  const rows = ((await (await a.get("/api/admin/staff/list")).json()) as { rows: { id: string; username: string }[] }).rows;
  return { username, name: nm, password, id: rows.find((x) => x.username === username)!.id, api: await apiAs(username, password) };
}
/** the browser of a waiter: the session cookie in the context */
export async function signInCtx(ctx: BrowserContext, w: { username: string; password: string }) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: w.username, password: w.password } });
  expect(r.status(), "sign-in " + w.username).toBe(200);
}
export async function startShift(w: Waiter, tables: number[]) {
  const r = await w.api.post("/api/floor/shift/start", { data: { tables } });
  expect(r.status(), "shift " + tables.join(",")).toBe(200);
}
export async function endShift(w: Waiter) { try { await w.api.post("/api/floor/shift/end", { data: {} }); } catch { /* already out */ } }

/* ---------- the guests at a table (the QR code from the admin) ---------- */
let codes: Record<number, string> | null = null;
export async function codeOf(a: APIRequestContext, n: number): Promise<string> {
  if (!codes) codes = Object.fromEntries(((await (await a.get("/api/admin/qr")).json()) as { n: number; code: string }[]).map((r) => [r.n, r.code]));
  return codes[n];
}
export async function guest(a: APIRequestContext, n: number) {
  const code = await codeOf(a, n), g = tok();
  const post = async (path: string, data: Record<string, unknown> = {}) => { const r = await a.post("/api/floor/t/" + code + "/" + path, { data: { g, ...data } }); return { status: r.status(), body: await r.json() }; };
  const o = await post("open"); expect(o.status, "open table " + n).toBe(200);
  return { code, g, post, call: (kind: string) => post("call", { kind }) };
}
/** a table is free again (a sitting left by an earlier test on the same table: everything paid, closed) */
export async function freeTable(a: APIRequestContext, n: number) {
  const d = (await (await a.get("/api/floor/table/" + n)).json()) as { session: unknown; pending: unknown; calls: { id: string }[]; rest: number };
  if (!d.session) return;
  for (const c of d.calls) await a.post("/api/floor/call/" + c.id + "/done");
  if (d.pending) await a.post("/api/floor/table/" + n + "/qr/reject", { data: { reason: "test" } });
  if (d.rest > 0) await a.post("/api/floor/table/" + n + "/pay", { data: { how: "cash" } });
  await a.post("/api/floor/table/" + n + "/close", { data: { force: true } });
}
/** the kitchen cooks every line of an order */
export async function cook(k: APIRequestContext, no: string) {
  expect((await k.post("/api/kitchen/orders/" + no + "/start", { data: { sec: "all" } })).status()).toBe(200);
  expect((await k.post("/api/kitchen/orders/" + no + "/done", { data: { sec: "all" } })).status()).toBe(200);
}

export function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[1349]|net::ERR_/.test(m.text())) list.push(m.text()); });
  return list;
}
export async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
/** the screen is drawn from the data (the frame's waiting skeleton is gone) */
export async function ready(page: Page) {
  await expect(page.locator(".st-app:not([data-boot]) main [data-sv]")).toBeVisible();
}
/** what a careful designer checks on every screen: no horizontal scroll, no text under 14 px, targets of 48 px */
export async function layout(page: Page, at: string) {
  const g = await page.evaluate(() => {
    const small: string[] = [], tiny: string[] = [];
    document.querySelectorAll(".st-app *, .st-ov *").forEach((el) => {
      const b = el.getBoundingClientRect(); if (!b.width) return;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim()) && parseFloat(getComputedStyle(el).fontSize) < 14) small.push((el as HTMLElement).className + " " + el.textContent!.trim().slice(0, 20));
    });
    document.querySelectorAll("main a, main button, main select, main input, .st-nav a, .st-tools button").forEach((el) => {
      const b = el.getBoundingClientRect(); if (!b.width || (el as HTMLElement).closest(".pw")) return;
      if (b.height < 48) tiny.push(el.tagName + "." + (el as HTMLElement).className + " " + (el.textContent || "").trim().slice(0, 20) + " " + Math.round(b.height));
    });
    return { over: document.documentElement.scrollWidth - innerWidth, small, tiny };
  });
  expect(g.over, at + " horizontal scroll").toBeLessThanOrEqual(0);
  expect(g.small, at + " text under 14 px").toEqual([]);
  expect(g.tiny, at + " targets under 48 px").toEqual([]);
}
