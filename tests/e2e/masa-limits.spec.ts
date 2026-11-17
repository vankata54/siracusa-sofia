import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { assertPortFree } from "./_port.ts";
import { USER, E } from "./own-server.ts";
import { tok } from "./masa-helpers.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* as every spec of the hall (tests/e2e/_floor-lock.ts); this one has its own server */

/* QR маса · the limits on a server WITHOUT the test mode (the limits are off with SC_PREVIEW_API=1): only WRONG codes
   count against the address (30 in 10 minutes); a guest with a right code from the same Wi-Fi address is never stopped
   by them (decision 17.11.2026). Its own server, database and port (E2E_PORT + 8); stopped by its PID. */
test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("30 wrong codes from one address: the 31st is 429; a right code from the same address still works @phone", async ({ playwright }) => {
  test.setTimeout(90_000);
  const port = +(process.env.E2E_PORT || 8788) + 8, src = process.env.DIST_DIR || "dist-e2e", dist = src + "-lim", db = "data/e2e-masa-lim-" + port + ".db";
  await assertPortFree(port);
  const rm = () => { fs.rmSync(dist, { recursive: true, force: true }); for (const f of [db, db + "-wal", db + "-shm"]) fs.rmSync(f, { force: true }); };
  rm(); fs.cpSync(src, dist, { recursive: true });
  const env = { ...process.env, PORT: String(port), DIST_DIR: dist, DB_FILE: db, SMS_DEMO: "1" } as Record<string, string>;
  delete env.SC_PREVIEW_API;
  const srv: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], { env, stdio: "ignore" });
  const base = "http://localhost:" + port;
  const req = await playwright.request.newContext({ baseURL: base });
  try {
    for (let i = 0; ; i++) { try { if ((await fetch(base + "/api/health")).ok) break; } catch { /* not yet */ } if (i > 100) throw new Error("server start"); await new Promise((r) => setTimeout(r, 300)); }
    expect((await req.post("/api/auth/login", { data: { username: USER.admin[0], password: USER.admin[1] } })).status()).toBe(200);
    const code = ((await (await req.get("/api/admin/qr")).json()) as { n: number; code: string }[]).find((x) => x.n === 2)!.code;
    const A = tok("lim-a"), B = tok("lim-b");
    /* a right code first: it never counts */
    expect((await req.post("/api/floor/t/" + code + "/view", { data: { g: A } })).status()).toBe(403); /* not at the table yet */
    expect((await req.post("/api/floor/t/" + code + "/open", { data: { g: A } })).status()).toBe(200);
    for (let i = 0; i < 40; i++) expect((await req.post("/api/floor/t/" + code + "/view", { data: { g: A } })).status()).toBe(200);
    /* 30 wrong codes are 404, then 429 */
    const st: number[] = [];
    for (let i = 0; i < 32; i++) st.push((await req.post("/api/floor/t/zzzz" + String(1000 + i).replace(/[01]/g, "z") + "/view", { data: { g: A } })).status());
    expect(st.slice(0, 30).every((x) => x === 404)).toBe(true);
    expect(st.slice(30)).toEqual([429, 429]);
    /* the same address with a right code: still served (another phone too) */
    expect((await req.post("/api/floor/t/" + code + "/view", { data: { g: A } })).status()).toBe(200);
    expect((await req.post("/api/floor/t/" + code + "/open", { data: { g: B } })).status()).toBe(200);
  } finally {
    await req.dispose();
    if (srv.pid) { srv.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 500)); }
    rm();
  }
});
