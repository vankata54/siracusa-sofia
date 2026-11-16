/* Helpers of the e2e tests of the section group "Продажби" (admin-zones, admin-offers, admin-events): every spec file starts
   ITS OWN server per project (a copy of the build in <DIST_DIR>-<name>-<project>, its own database, port E2E_PORT + n), so a
   change of the site data (and the rebuild it starts) never touches the server or the build of the other tests. */
import { expect, type Page, type BrowserContext, type TestInfo } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { readEnv } from "../../scripts/env.mjs";

export const env = readEnv() as Record<string, string | undefined>;
const USER: Record<string, [string, string | undefined]> = {
  admin: [env.ADMIN_USER || "admin", env.ADMIN_PASSWORD], owner: ["owner", env.OWNER_PASSWORD], manager: ["manager", env.MANAGER_PASSWORD],
  marketing: ["marketing", env.MARKETING_PASSWORD], driver: ["driver", env.DRIVER_PASSWORD],
};
export async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error("timeout: " + what);
    await new Promise((r) => setTimeout(r, 300));
  }
}
export interface Srv { base: string; stop(): Promise<void> }
/** its own server: name ("zones"), offsets of the port for the phone and the desktop project */
export async function ownServer(name: string, info: TestInfo, off: [number, number]): Promise<Srv> {
  const src = process.env.DIST_DIR || "dist-e2e", port = +(process.env.E2E_PORT || 8788) + (info.project.name === "phone" ? off[0] : off[1]);
  const dist = src + "-" + name + "-" + info.project.name, db = "data/e2e-" + name + "-" + port + ".db";
  const rmAll = () => { for (const d of [dist, dist + "-prev", dist + "-next"]) fs.rmSync(d, { recursive: true, force: true }); for (const f of [db, db + "-wal", db + "-shm"]) fs.rmSync(f, { force: true }); };
  rmAll();
  fs.cpSync(src, dist, { recursive: true });
  const srv: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), DIST_DIR: dist, DB_FILE: db, SC_PREVIEW_API: "1", SMS_DEMO: "1" }, stdio: "ignore",
  });
  const base = "http://localhost:" + port;
  await until(async () => (await fetch(base + "/api/health")).ok, 30_000, "server start");
  return { base, async stop() { if (srv.pid) { srv.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); } rmAll(); } };
}
export async function signIn(ctx: BrowserContext, base: string, role: keyof typeof USER = "admin") {
  await ctx.clearCookies();
  const r = await ctx.request.post(base + "/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
export function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[139]|422|429)/.test(m.text())) list.push(m.text()); });
  return list;
}
export const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
export async function toastHas(page: Page, text: string | RegExp) { await expect(page.locator(".sa-toast.on")).toContainText(text); }
/** "Отмени" in the toast (it waits a moment: a toast shown by a sheet that closes) */
export async function undo(page: Page) { await page.waitForTimeout(300); await page.locator(".sa-toast.on [data-tu]").click({ force: true }); }
/** a click in the middle of the screen (never under the floating bars of the phone) */
export async function tap(loc: ReturnType<Page["locator"]>) { await loc.evaluate((el) => el.scrollIntoView({ block: "center" })); await loc.click(); }
/** no horizontal scroll at 360 (the page column of the admin and the document) */
export async function noHScroll(page: Page) {
  const bad = await page.evaluate(() => { const sc = document.querySelector(".sa-scroller"), de = document.documentElement; return de.scrollWidth > de.clientWidth + 1 || (!!sc && sc.scrollWidth > sc.clientWidth + 1); });
  expect(bad, "horizontal scroll").toBe(false);
}
/** the rebuild of the site (server/publish.ts) after a change of the site data is done */
export async function rebuilt(ctx: BrowserContext, base: string) {
  return until(async () => { const r = await (await ctx.request.get(base + "/api/admin/site/state")).json() as { build: { state: string; error?: string } }; return r.build.state === "done" || r.build.state === "error" ? r.build : null; }, 240_000, "rebuild");
}
