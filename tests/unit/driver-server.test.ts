/* The driver on the server (server/routes/driver.ts): every route answers 401 without a session and 403 for a role
   without the right (direct requests, no screen); the whole flow over HTTP; the customer's public view; the photo of a
   fuel receipt goes through the same checks as a photo of the menu. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.ts";
import { items } from "../../src/lib/data.ts";
import type { RoleId } from "../../src/core/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-driver-"));
const dist = path.join(tmp, "dist"), media = path.join(tmp, "media");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), "<p>start</p>");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const PW = "test-password-123";
/* a png header with its size (512 x 256): the core reads the size, a signature alone is not a picture */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0, 8, 2, 0, 0, 0]);

describe("the driver: routes", async () => {
  const { app, core } = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build: null, smsDemo: true, previewApi: true, mediaDir: media });
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r === "driver" ? "Шофьор 1" : r, role: r, password: PW });
  const cookie: Record<string, string> = {};
  for (const r of ROLES) cookie[r] = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: r, password: PW }) })).headers.get("set-cookie")!.split(";")[0];
  /* a second driver: a receipt is only for the one who took the photo */
  await core.staff.upsert({ username: "driver2", name: "Шофьор 2", role: "driver", password: PW });
  cookie.driver2 = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "driver2", password: PW }) })).headers.get("set-cookie")!.split(";")[0];
  const req = (method: string, url: string, who?: RoleId, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(url, { method, headers: { "content-type": "application/json", ...(who ? { cookie: cookie[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const dish = items.find((x) => x.cat === "pitsi" && !x.t.includes("out"))!;
  /** a web order at 12:30 (the test clock of the server), moved to "Готова" by the kitchen through the existing route */
  async function ready(extra: Record<string, unknown> = {}) {
    const r = await req("POST", "/api/orders", undefined, { cart: { mode: "delivery", lines: [{ id: dish.id, q: 1, mods: [] }] }, zone: "Дружба 2", addr: "бл. 311", name: "Иван Петров", phone: "0888123456", pay: "cash", ...extra }, { "x-sc-clock": "12:30" });
    expect(r.status).toBe(201);
    const o = await r.json();
    for (const status of ["cooking", "ready"]) expect((await req("PATCH", "/api/admin/orders/" + o.no, "kitchen", { status })).status).toBe(200);
    return o as { no: string; key: string; total: number };
  }

  const D: RoleId[] = ["admin", "owner", "manager", "driver"], BOSS: RoleId[] = ["admin", "owner", "manager"], FIN: RoleId[] = ["admin", "owner"];
  /* [method, url, body, the roles that pass the rights check] */
  const ROUTES: [string, string, unknown, RoleId[]][] = [
    ["GET", "/api/driver/state", null, D],
    ["POST", "/api/driver/start", {}, D],
    ["POST", "/api/driver/prefs", { nav: "waze" }, D],
    ["POST", "/api/driver/car", {}, D],
    ["GET", "/api/driver/list", null, D],
    ["GET", "/api/driver/list?all=1", null, BOSS],
    ["GET", "/api/driver/deliveries/9999", null, D],
    ["POST", "/api/driver/take", { nos: ["9999"] }, D],
    ["POST", "/api/driver/go", {}, D],
    ["POST", "/api/driver/deliveries/9999/arrive", null, D],
    ["POST", "/api/driver/deliveries/9999/deliver", {}, D],
    ["POST", "/api/driver/deliveries/9999/problem", { kind: "nobody" }, D],
    ["POST", "/api/driver/deliveries/9999/returned", null, D],
    ["POST", "/api/driver/deliveries/9999/ask", {}, D],
    ["POST", "/api/driver/undo", { id: "x" }, D],
    ["GET", "/api/driver/route", null, D],
    ["POST", "/api/driver/route", { pick: "B" }, D],
    ["POST", "/api/driver/route/move", { no: "9999", dir: "up" }, D],
    ["GET", "/api/driver/fuel", null, D],
    ["POST", "/api/driver/fuel", {}, D],
    ["POST", "/api/driver/receipt", null, D],
    ["GET", "/api/driver/shift", null, D],
    ["POST", "/api/driver/end", {}, D],
    ["GET", "/api/driver/search?q=1", null, D],
    ["GET", "/api/driver/drivers", null, BOSS],
    ["GET", "/api/driver/asks", null, BOSS],
    ["POST", "/api/driver/asks/nope/answer", { answer: "deliver" }, BOSS],
    ["POST", "/api/driver/asks/nope/undo", null, BOSS],
    ["PUT", "/api/driver/cars", { cars: [] }, BOSS],
    ["GET", "/api/driver/fuel/report", null, FIN],
  ];
  it("401 without a session on every route", async () => {
    for (const [m, u, b] of ROUTES) expect([m, u, (await req(m, u, undefined, b ?? undefined)).status]).toEqual([m, u, 401]);
  });
  it("403 for every role without the right, never 403 for a role with it (each route, each role)", async () => {
    for (const [m, u, b, ok] of ROUTES) for (const r of ROLES) {
      const st = (await req(m, u, r, b ?? undefined)).status;
      expect([m, u, r, st === 403]).toEqual([m, u, r, !ok.includes(r)]);
    }
  });

  it("the flow over HTTP: start, Взех, Тръгвам, Пристигнах (the customer's view), Доставена, the end; the same error shape", async () => {
    const o = await ready();
    expect((await req("POST", "/api/driver/take", "driver", { nos: [o.no] })).status).toBe(409); /* no shift yet */
    const bad = await req("POST", "/api/driver/start", "driver", { car: "", km: "" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "invalid", message: "Провери полетата.", fields: { car: "Избери кола.", km: "Въведи километража от таблото." } });
    const st = await req("POST", "/api/driver/start", "driver", { car: "a1", km: 48250, float: "20,00" });
    expect(st.status).toBe(201);
    expect((await st.json()).shift).toMatchObject({ name: "Шофьор 1", kmStart: 48250, float: 20 });
    const l = await (await req("GET", "/api/driver/list", "driver")).json();
    expect(l.waiting.map((d: { no: string }) => d.no)).toEqual([o.no]);
    expect(JSON.stringify(l)).not.toMatch(/0888|"phone"/);
    const tk = await (await req("POST", "/api/driver/take", "driver", { nos: [o.no] })).json();
    expect(tk.deliveries[0]).toMatchObject({ no: o.no, st: "picked", mine: true });
    expect((await (await req("POST", "/api/driver/go", "driver", {})).json()).deliveries[0].st).toBe("road");
    expect((await (await req("GET", "/api/orders/" + o.no + "-" + o.key)).json())).toMatchObject({ status: "on_way" });
    const ar = await req("POST", "/api/driver/deliveries/" + o.no + "/arrive", "driver");
    expect(ar.status).toBe(200);
    expect((await ar.json()).notified).toMatchObject({ page: true, sms: null, smsMissing: "[ЛИПСВА: доставчик за SMS]" });
    /* the customer's public view: "Шофьорът е пред входа" since; nothing about the driver */
    const pub = await (await req("GET", "/api/orders/" + o.no + "-" + o.key)).json();
    expect(pub.arrivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.stringify(pub)).not.toMatch(/"driver"|Шофьор 1|pickedAt/);
    /* the manager sees the driver on the way */
    const m = await (await req("GET", "/api/driver/drivers", "manager")).json();
    expect(m.drivers[0]).toMatchObject({ user: "driver", name: "Шофьор 1", status: "road", statusLabel: "На път", position: null });
    expect(m.drivers[0].course.stops.map((x: { no: string; next: boolean }) => [x.no, x.next])).toEqual([[o.no, true]]);
    const end0 = await req("POST", "/api/driver/end", "driver", { km: 48300, handed: true });
    expect(end0.status).toBe(409);
    expect(await end0.json()).toMatchObject({ error: "unfinished", fields: { [o.no]: "На път" } });
    const dl = await (await req("POST", "/api/driver/deliveries/" + o.no + "/deliver", "driver", {})).json();
    expect(dl.deliveries[0]).toMatchObject({ st: "done", collected: { pay: "cash", sum: o.total } });
    expect((await (await req("POST", "/api/driver/undo", "driver", { id: dl.undo.id })).json()).deliveries[0].st).toBe("road");
    await req("POST", "/api/driver/deliveries/" + o.no + "/deliver", "driver", { sum: o.total });
    expect((await (await req("GET", "/api/orders/" + o.no + "-" + o.key)).json())).toMatchObject({ status: "delivered" });
    const end = await (await req("POST", "/api/driver/end", "driver", { km: 48300, handed: true })).json();
    expect(end).toMatchObject({ closed: true, delivered: 1, handover: Math.round((o.total + 20) * 100) / 100, km: { total: 50 } });
    expect((await (await req("GET", "/api/driver/state", "driver")).json()).shift).toBeNull();
    /* the shifts, the fuel and the questions are stored (migration 0007) */
    expect(await core.ctx.repo.list("shifts", { role: "driver", status: "closed" } as never)).toHaveLength(1);
  });

  it("the question about an address: the manager answers over HTTP; the fuel report only with the right", async () => {
    await req("POST", "/api/driver/start", "driver", { car: "a1", km: 48300 });
    const o = await ready();
    const q = await req("POST", "/api/driver/deliveries/" + o.no + "/ask", "driver", { note: "зад околовръстното" });
    expect(q.status).toBe(201);
    const ask = await q.json();
    expect((await (await req("GET", "/api/driver/asks", "manager")).json()).map((a: { id: string }) => a.id)).toEqual([ask.id]);
    expect((await req("POST", "/api/driver/take", "driver", { nos: [o.no] })).status).toBe(409);
    expect((await req("POST", "/api/driver/asks/" + ask.id + "/answer", "manager", { answer: "nope" })).status).toBe(422);
    expect((await (await req("POST", "/api/driver/asks/" + ask.id + "/answer", "manager", { answer: "deliver" })).json())).toMatchObject({ status: "answered", answerLabel: "Да я достави" });
    expect((await req("POST", "/api/driver/take", "driver", { nos: [o.no] })).status).toBe(200);
    expect((await (await req("GET", "/api/driver/search?q=" + o.no, "driver")).json()).act.map((d: { no: string }) => d.no)).toEqual([o.no]);
    const f = await req("POST", "/api/driver/fuel", "driver", { litres: "30", sum: "45", km: 48400, full: true });
    expect(f.status).toBe(201);
    expect((await f.json()).entry).toMatchObject({ litres: 30, sum: 45, perLitre: 1.5, km: 48400 });
    expect((await (await req("GET", "/api/driver/fuel/report", "owner")).json()).total).toEqual({ n: 1, litres: 30, sum: 45 });
  });

  it("the photo of a receipt: a driver in a shift, png / jpeg / webp by content and header, up to 5 MB, kept apart and never public", async () => {
    const up = (who: RoleId, body: Uint8Array, type = "image/png", len?: number) => app.request("/api/driver/receipt", { method: "POST", headers: { "content-type": type, cookie: cookie[who], ...(len ? { "content-length": String(len) } : {}) }, body: body as unknown as BodyInit });
    expect((await up("waiter", PNG)).status).toBe(403);
    expect((await up("manager", PNG)).status).toBe(409); /* a boss without a shift: no_shift */
    expect((await up("driver", new Uint8Array(0))).status).toBe(422);
    const html = await up("driver", new TextEncoder().encode("<html><script>alert(1)</script></html>"), "image/png");
    expect(html.status).toBe(415);
    expect(await html.json()).toMatchObject({ error: "unsupported", message: "Трябва снимка в JPEG, PNG или WebP." });
    expect((await up("driver", PNG, "image/png", 6 * 1024 * 1024)).status).toBe(413);
    const ok = await up("driver", PNG, "text/plain"); /* the header means nothing, the content decides */
    expect(ok.status).toBe(201);
    const j = await ok.json();
    expect(j).toMatchObject({ type: "image/png", bytes: PNG.length });
    expect(j.url).toMatch(/^\/api\/driver\/receipts\/[a-f0-9]{64}\.png$/);
    expect(fs.existsSync(path.join(tmp, "receipts", j.url.split("/").pop()))).toBe(true);
    /* never public: without a session 401, a waiter 403; the driver and the bosses see it (private cache, sandboxed) */
    expect((await app.request(j.url)).status).toBe(401);
    expect((await app.request(j.url, { headers: { cookie: cookie.waiter } })).status).toBe(403);
    const got = await app.request(j.url, { headers: { cookie: cookie.driver } });
    expect([got.status, got.headers.get("content-type"), got.headers.get("x-content-type-options"), got.headers.get("cache-control")]).toEqual([200, "image/png", "nosniff", "private, max-age=31536000, immutable"]);
    expect((await app.request(j.url, { headers: { cookie: cookie.manager } })).status).toBe(200);
    /* another driver neither sees it nor uses it */
    expect((await app.request(j.url, { headers: { cookie: cookie.driver2 } })).status).toBe(403);
    expect((await app.request("/api/driver/start", { method: "POST", headers: { "content-type": "application/json", cookie: cookie.driver2 }, body: JSON.stringify({ car: "a2", km: 31540 }) })).status).toBe(201);
    const theirs = await app.request("/api/driver/fuel", { method: "POST", headers: { "content-type": "application/json", cookie: cookie.driver2 }, body: JSON.stringify({ litres: 5, sum: 8, km: 31600, photo: j.url }) });
    expect([theirs.status, (await theirs.json()).fields]).toEqual([422, { photo: "Снимката не се качи. Снимай бележката пак." }]);
    /* a png signature followed by html is not a picture */
    expect((await up("driver", new Uint8Array([...PNG.slice(0, 8), ...new TextEncoder().encode("<html><script>alert(1)</script>")]))).status).toBe(415);
    /* fuel takes only a photo that is really there */
    const miss = await req("POST", "/api/driver/fuel", "driver", { litres: 5, sum: 8, km: 48500, photo: "/api/driver/receipts/" + "c".repeat(64) + ".png" });
    expect(miss.status).toBe(422);
    expect((await miss.json()).fields).toEqual({ photo: "Снимката не се качи. Снимай бележката пак." });
    const withPhoto = await req("POST", "/api/driver/fuel", "driver", { litres: 5, sum: 8, km: 48500, photo: j.url });
    expect((await withPhoto.json()).entry).toMatchObject({ photo: j.url, noPhoto: false });
    /* one photo, one entry */
    const twice = await req("POST", "/api/driver/fuel", "driver", { litres: 5, sum: 8, km: 48510, cash: false, photo: j.url });
    expect([twice.status, (await twice.json()).fields]).toEqual([422, { photo: "Тази снимка вече е в друго зареждане. Снимай бележката на това." }]);
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["fuel.receipt", "fuel.add"]));
  });
});
