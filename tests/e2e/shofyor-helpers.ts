/* Helpers of the driver's specs (tests/e2e/shofyor-*.spec.ts): real orders from the site's API (the customer), the
   kitchen's API makes them ready, the driver's own server (a copy of the build, its own database: "Взех N поръчки" takes
   every ready order, so no other spec may see these). */
import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import { E } from "./own-server.ts";

export const PW: Record<string, [string, string]> = { driver: ["driver", E.DRIVER_PASSWORD], kitchen: ["kitchen", E.KITCHEN_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD] };
export type Made = { no: string; key: string };
type Line = { id: string; q: number };

/** the customer orders from the site (12:30 on the shop's clock: delivery is open; the times are real) */
export async function order(request: APIRequestContext, base: string, o: { addr?: string; pay?: "cash" | "card" | "voucher"; lines?: Line[]; note?: string } = {}): Promise<Made> {
  const lines = o.lines || [{ id: "kebapcheta", q: 3 }, { id: "svinski-vrat", q: 1 }];
  const r = await request.post(base + "/api/orders", { headers: { "x-sc-clock": "12:30" }, data: {
    cart: { mode: "delivery", lines: lines.map((l) => ({ key: l.id, extra: 0, mods: [], ...l })) }, addr: o.addr || "ж.к. Дружба 2, бл. 311, вх. Б", name: "Иван Петров", phone: "0888 12 34 56", pay: o.pay || "cash", note: o.note || "",
  } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as Made;
}
export async function login(ctx: BrowserContext | APIRequestContext, base: string, who: string, pw?: string) {
  const req = "request" in ctx ? ctx.request : ctx;
  const r = await req.post(base + "/api/auth/login", { data: { username: PW[who] ? PW[who][0] : who, password: pw || PW[who][1] } });
  expect(r.status(), "sign-in " + who).toBe(200);
}
/** the kitchen's "Готово" (kebapcheta and svinski-vrat are on the grill) */
export async function ready(kitchen: APIRequestContext, base: string, no: string) {
  const r = await kitchen.post(base + "/api/kitchen/orders/" + no + "/done", { data: { sec: "skara" } });
  expect(r.status(), await r.text()).toBe(200);
}
/** the driver's shift through the API (a test that is not about the sign-in) */
export async function shift(req: APIRequestContext, base: string, car = "a1", km = 48250, float: number | null = 20) {
  const s = await (await req.get(base + "/api/driver/state")).json();
  if (s.shift) return s;
  const r = await req.post(base + "/api/driver/start", { data: { car, km, float } });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}
/** a second driver (the main admin creates him) */
export async function driver2(admin: APIRequestContext, base: string, username = "shofyor2"): Promise<[string, string]> {
  const pw = "Shofyor-2-test-" + Math.random().toString(36).slice(2, 8);
  const r = await admin.post(base + "/api/admin/staff", { data: { username, name: "Шофьор 2", role: "driver", password: pw } });
  expect([201, 409]).toContain(r.status());
  return [username, pw];
}
/** an order outside the zones (the site never accepts one: the test moves the address in the server's database) */
export function moveOut(db: string, no: string) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const d = new Database(db);
  d.prepare(`UPDATE orders SET data = json_set(data, '$.zone', 'Нови Искър', '$.addr', 'Нови Искър, ул. Охрид 3') WHERE no = ?`).run(+no);
  d.close();
}
export function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  /* a request that fails while the test cut the connection, and the refusals the test asks for, are the point of the test */
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[13489]|422|429)|ERR_INTERNET_DISCONNECTED|Failed to load resource: net::/.test(m.text())) list.push(m.text()); });
  return list;
}
export async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
/** the screen is drawn (not the waiting skeleton) */
export async function drawn(page: Page) {
  await expect(page.locator(".st-app:not([data-boot]) .st-top")).toBeVisible();
  await expect(page.locator("main .st-skel")).toHaveCount(0);
}
export const toast = (page: Page) => page.locator(".st-toast.on");
export const bar = (page: Page) => page.locator(".st-bar");
export async function noHScroll(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0); }
/** every visible button and link of the screen is at least 48 px high (inline links in text excepted) */
export async function targets(page: Page) {
  const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".st-app button, .st-app a.pill, .st-ov button, .st-ov a, .st-app .drow2, .st-app .chip"))
    .filter((el) => el.offsetParent !== null && !el.closest(".vh") && !(el.matches("a.link") && el.closest("p, span")))
    .map((el) => ({ t: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30), h: el.getBoundingClientRect().height }))
    .filter((x) => x.h > 0 && x.h < 47.5));
  expect(small).toEqual([]);
}
/** every card stays inside its column (the frame clips what runs out, so the scroll test cannot see it), every chip inside
    its card, every button of the bar holds its words, and on "Следваща" the word and the sum never overlap */
export async function inside(page: Page, where = "") {
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const right = (el: Element) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.right - parseFloat(cs.paddingRight || "0"); };
    document.querySelectorAll<HTMLElement>("main .st-sec").forEach((sec) => {
      const edge = right(sec) + 0.5;
      sec.querySelectorAll<HTMLElement>(".drow2, .next, .acard, .stops, .rc, .icard, .cashbox, .notice, .money, .client, .carline, .dsum").forEach((el) => {
        if (el.offsetParent && el.getBoundingClientRect().right > edge) out.push(el.className + " " + Math.round(el.getBoundingClientRect().right) + " > " + Math.round(edge));
      });
    });
    document.querySelectorAll<HTMLElement>(".drow2 .stt, .next .stt, .notice .pill").forEach((el) => {
      const box = el.closest(".drow2, .next, .notice")!;
      if (el.getBoundingClientRect().right > box.getBoundingClientRect().right + 0.5) out.push("chip " + (el.textContent || "").trim().slice(0, 30));
    });
    document.querySelectorAll<HTMLElement>(".st-bar .pill").forEach((el) => { if (el.scrollWidth > el.clientWidth + 1) out.push("bar " + (el.textContent || "").trim()); });
    document.querySelectorAll<HTMLElement>(".next .money").forEach((m) => {
      const w = m.querySelector(".w"), p = m.querySelector(".price");
      if (w && p && w.getBoundingClientRect().right > p.getBoundingClientRect().left + 0.5) out.push("money overlaps");
      const word = m.querySelector(".w span:last-child") as HTMLElement | null;
      if (word && word.scrollWidth > word.clientWidth + 1) out.push("money word cut: " + word.textContent);
    });
    return out;
  });
  expect(bad, where).toEqual([]);
}
