/* The routes of the manager's and the owner's modules (server/routes/boss.ts): 401 without a session, 403 for a role
   without the right (direct requests, no screen); the main admin reads the questions, only the owner answers. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.ts";
import type { RoleId } from "../../src/core/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-boss-"));
const dist = path.join(tmp, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), "<p>start</p>");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const PW = "test-password-123";

describe("the boss routes", async () => {
  const { app, core } = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build: null, smsDemo: true, previewApi: true, mediaDir: path.join(tmp, "media") });
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r, role: r, password: PW });
  const cookie: Record<string, string> = {};
  for (const r of ROLES) cookie[r] = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: r, password: PW }) })).headers.get("set-cookie")!.split(";")[0];
  const req = (method: string, url: string, who?: RoleId, body?: unknown) =>
    app.request(url, { method, headers: { "content-type": "application/json", "x-sc-clock": "19:42", ...(who ? { cookie: cookie[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const BOSS: RoleId[] = ["admin", "owner", "manager"], OWN: RoleId[] = ["admin", "owner"];
  const ROUTES: [string, string, unknown, RoleId[]][] = [
    ["GET", "/api/boss/now", null, BOSS], ["GET", "/api/boss/hall", null, BOSS], ["GET", "/api/boss/team", null, BOSS], ["GET", "/api/boss/search?q=12", null, BOSS],
    ["GET", "/api/boss/hall/12", null, BOSS], ["POST", "/api/boss/kitchen/busy", { on: false }, BOSS],
    ["GET", "/api/owner/today", null, OWN], ["GET", "/api/owner/trends?period=7&compare=year", null, OWN], ["GET", "/api/owner/finance?period=30", null, OWN], ["GET", "/api/owner/decisions", null, OWN],
    ["POST", "/api/owner/questions/r8", { answer: "default" }, ["owner"]], ["PUT", "/api/owner/mail", { monthly: true }, OWN],
  ];
  it("401 without a session, 403 for the others", async () => {
    for (const [m, url, body, ok] of ROUTES) {
      expect([url, (await req(m, url, undefined, body)).status]).toEqual([url, 401]);
      for (const r of ROLES) { const st = (await req(m, url, r, body)).status; expect([url, r, st === 403]).toEqual([url, r, !ok.includes(r)]); }
    }
  });
  it("the answers over HTTP and the notes filter 'Отговори на въпроси'", async () => {
    const a = await (await req("POST", "/api/owner/questions/m1", "owner", { answer: "other", text: "4 мин" })).json();
    expect(a).toMatchObject({ question: { id: "m1", answer: { answer: "other", other: "4 мин" } } });
    const answers = await (await req("GET", "/api/admin/notes?kind=answer", "admin")).json();
    expect(answers.map((n: { q: { id: string } }) => n.q.id).sort()).toEqual(["m1", "r8"]);
    expect(await (await req("GET", "/api/admin/notes?kind=note", "admin")).json()).toEqual([]);
    expect((await req("POST", "/api/owner/questions/m1/undo", "owner")).status).toBe(200);
    expect((await (await req("GET", "/api/owner/decisions", "admin")).json()).canAnswer).toBe(false);
  });
});
