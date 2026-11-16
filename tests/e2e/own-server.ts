/* An own server for one spec and one project (tests/e2e/admin-reservations.spec.ts, admin-hall.spec.ts): a copy of the build
   (<DIST_DIR>-<tag>), its own database and port, so a saved plan (it rebuilds the site) or a changed role never touches the
   server the other tests use. Stopped by its PID; the copies are removed. */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import { expect, type BrowserContext } from "@playwright/test";

export function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
export const E = env();
export const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD] };

export interface Own { base: string; db: string; stop(): Promise<void> }
async function until(fn: () => Promise<boolean>, ms: number, what: string) {
  const end = Date.now() + ms;
  for (;;) { try { if (await fn()) return; } catch { /* not yet */ } if (Date.now() > end) throw new Error("timeout: " + what); await new Promise((r) => setTimeout(r, 300)); }
}
export async function ownServer(tag: string, offset: number): Promise<Own> {
  const port = +(process.env.E2E_PORT || 8788) + offset, src = process.env.DIST_DIR || "dist-e2e", dist = src + "-" + tag, db = "data/e2e-" + tag + "-" + port + ".db";
  const rm = () => { for (const d of [dist, dist + "-prev", dist + "-next"]) fs.rmSync(d, { recursive: true, force: true }); for (const f of [db, db + "-wal", db + "-shm"]) fs.rmSync(f, { force: true }); };
  rm(); fs.cpSync(src, dist, { recursive: true });
  const srv: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), DIST_DIR: dist, DB_FILE: db, SC_PREVIEW_API: "1", SMS_DEMO: "1" }, stdio: "ignore",
  });
  const base = "http://localhost:" + port;
  await until(async () => (await fetch(base + "/api/health")).ok, 30_000, "server start");
  return { base, db, stop: async () => { if (srv.pid) { srv.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 400)); } rm(); } };
}
export async function signIn(ctx: BrowserContext, base: string, role: string) {
  const r = await ctx.request.post(base + "/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
/** writes a document straight into the server's database (a booking at a time the API never accepts: earlier today) */
export function dbPut(db: string, table: string, doc: Record<string, unknown>, cols: Record<string, unknown> = {}) {
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const d = new Database(db), now = new Date().toISOString(), k = ["id", "data", "created_at", "updated_at", ...Object.keys(cols)];
  d.prepare(`INSERT OR REPLACE INTO "${table}" (${k.map((c) => `"${c}"`).join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(doc.id, JSON.stringify(doc), now, now, ...Object.values(cols));
  d.close();
}
export function errors(page: import("@playwright/test").Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[13489]|422|429)/.test(m.text())) list.push(m.text()); });
  return list;
}
