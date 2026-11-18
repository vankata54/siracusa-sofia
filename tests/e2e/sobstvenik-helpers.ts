/* Helpers for the specs of the owner's module (tests/e2e/sobstvenik-*.spec.ts): the accounts from .env, the sign-in
   through the API, orders through the site's API, two no-shows of one phone (the bookings written straight into the test
   database 40+ minutes ago, as tests/e2e/admin-reservations.spec.ts does, then "Неявили се" through the admin's API),
   axe, the console errors, the layout checks (no horizontal scroll, no text under 14 px, targets of 48 px). */
import { expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E, dbPut } from "./own-server.ts";

export const USER: Record<string, [string, string]> = {
  admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], waiter: ["waiter", E.WAITER_PASSWORD],
};
export const DB = "data/e2e-" + (process.env.E2E_PORT || 8788) + ".db";
export async function signIn(ctx: BrowserContext, role: string): Promise<void> {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
export const rnd = () => Math.random().toString(36).slice(2, 8);
export const phone = () => "0899 " + String(100000 + Math.floor(Math.random() * 899999)).replace(/(\d{2})(\d{2})(\d{2})/, "$1 $2 $3");
/** a pickup order from the site (the shop clock 12:30, so the kitchen takes it at any real hour) */
export async function webOrder(ctx: BrowserContext, lines: { id: string; q: number }[] = [{ id: "kebapcheta", q: 1 }]): Promise<{ no: string; total: number }> {
  const r = await ctx.request.post("/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode: "pickup", lines }, name: "Иван Петров", phone: phone() } });
  expect(r.status(), "order").toBe(201);
  return (await r.json()) as { no: string; total: number };
}
function sofia() {
  const d = new Date(), ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d);
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":");
  return { ymd, min: (+p[0] % 24) * 60 + +p[1] };
}
const pad = (n: number) => String(n).padStart(2, "0");
/** two no-shows of one phone: the number waits for a decision (the admin's API marks them) */
export async function twoNoShows(ctx: BrowserContext, name: string): Promise<void> {
  const s = sofia(), ph = phone().replace(/\s/g, ""), t = Math.max(0, Math.floor((s.min - 40) / 30) * 30), time = pad(Math.floor(t / 60)) + ":" + pad(t % 60), now = new Date().toISOString();
  for (let i = 0; i < 2; i++) {
    const id = "own" + rnd();
    dbPut(DB, "reservations", { id, date: s.ymd, time, people: 2, table: null, zone: null, name, phone: ph, marketing: false, status: "confirmed", createdAt: now, updatedAt: now, dur: 120, key: "k" + rnd() },
      { date: s.ymd, time, table_id: null, phone: ph, status: "confirmed" });
    const r = await ctx.request.post("/api/admin/reservations/" + id + "/status", { data: { status: "no_show" } });
    expect(r.status(), "no-show").toBe(200);
  }
}
export function errors(page: Page): string[] {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) list.push(m.text()); });
  return list;
}
/** axe: the serious and critical violations */
export async function axe(page: Page): Promise<string[]> {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
/** the screen is drawn (the frame and the content, not the skeleton) */
export async function ready(page: Page, title: string, sel = ".ow-card, .ow-empty"): Promise<void> {
  await expect(page.locator(".bs-top h1")).toHaveText(title);
  await expect(page.locator(".bs-main " + sel).first()).toBeVisible();
  await expect(page.locator(".bs-main .skel")).toHaveCount(0);
}
/** no horizontal scroll, no text under 14 px, no target under 48 px (the switches are 64 × 48 with the input over them) */
export async function layout(page: Page): Promise<{ side: boolean; tiny: string[]; small: string[] }> {
  return page.evaluate(() => {
    const o = { side: document.documentElement.scrollWidth > innerWidth + 1, tiny: [] as string[], small: [] as string[] };
    document.querySelectorAll<HTMLElement>(".bs-app *, .bs-ov *").forEach((el) => {
      if (el.children.length || !el.textContent!.trim() || el.closest(".vh") || !el.getClientRects().length) return;
      const f = parseFloat(getComputedStyle(el).fontSize); if (f < 14) o.tiny.push(f + " " + el.textContent!.slice(0, 30));
    });
    document.querySelectorAll<HTMLElement>(".bs-app a[href], .bs-app button, .bs-ov a[href], .bs-ov button").forEach((el) => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[inert]") || el.classList.contains("scrim")) return;
      if (r.width < 47.5 || r.height < 47.5) o.small.push((el.className || el.tagName) + " " + Math.round(r.width) + "x" + Math.round(r.height) + " " + (el.textContent || "").trim().slice(0, 24));
    });
    return o;
  });
}
export const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 900;
/** "10,22 €" */
export const eur = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",") + " €";
/** one order 3 days ago, written straight into the test database (the API takes no order for an earlier day): the
    restaurant has history, so "Тенденции" and "Финанси" show their numbers (a new restaurant: sobstvenik-fresh.spec.ts) */
export function seedPast(db = DB): void {
  const ts = Date.now() - 3 * 864e5, day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(ts)), at = Date.parse(day + "T12:00:00+02:00");
  const o = { id: "own-past-1", no: "6999", key: "kpast", mode: "pickup", channel: "web", lines: [{ id: "kebapcheta", name: "Кебапчета", unit: 7.61, q: 1, mods: [], extra: 0 }], sub: 7.61, disc: 0, fee: 0, total: 7.61,
    pay: "cash", payLabel: "В брой", status: "picked", placedAt: "12:00", ts: at, phone: "0888123400", name: "Клиент", zone: "", addr: "", times: {}, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() };
  dbPut(db, "orders", o, { no: 6999, mode: o.mode, status: o.status, phone: o.phone, total: o.total, channel: o.channel });
}
