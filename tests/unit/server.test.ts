import { describe, it, expect } from "vitest";
import { createApp } from "../../server/app.ts";

describe("server API (in-memory SQLite)", async () => {
  const { app, core } = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, trustProxy: true });
  await core.staff.upsert({ username: "admin", name: "Главен админ", role: "admin", password: "test-password-123" });
  const json = (method: string, body?: unknown, cookie?: string) => ({ method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it("GET /api/menu from the database", async () => {
    const r = await app.request("/api/menu");
    const m = await r.json();
    expect(m.items).toHaveLength(127);
    expect(m.cats).toHaveLength(15);
  });
  it("staff login sets an httpOnly cookie; admin routes need it", async () => {
    expect((await app.request("/api/admin/notes")).status).toBe(401);
    const bad = await app.request("/api/auth/login", json("POST", { username: "admin", password: "x" }));
    expect(bad.status).toBe(401);
    const r = await app.request("/api/auth/login", json("POST", { username: "admin", password: "test-password-123" }));
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    const cookie = sc.split(";")[0];
    const n = await app.request("/api/admin/notes", json("POST", { module: "site", url: "/", selector: "h1", text: "Смени", viewport: { w: 390, h: 844 } }, cookie));
    expect(n.status).toBe(201);
    const list = await (await app.request("/api/admin/notes?status=new", { headers: { cookie } })).json();
    expect(list[0].text).toBe("Смени");
  });
  it("orders: numbers from 1042, public view without personal data", async () => {
    const o = await (await app.request("/api/orders", json("POST", { cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] }, name: "Иван Петров", phone: "0888123456", sched: "утре", slot: "12:00" }))).json();
    expect(o.no).toBe("1042");
    const pub = await (await app.request("/api/orders/1042-" + o.key)).json();
    expect(pub.phone).toBeUndefined();
    expect(pub.name).toBeUndefined();
    expect(pub.key).toBe(o.key);
    /* without the key (the default) or with a wrong one: like an unknown number, 200 {found:false} */
    for (const id of ["1042", "1042-wrongkey", "999999", "abc"]) {
      const r = await app.request("/api/orders/" + id);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ found: false });
    }
    const open = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, requireTrackKey: false });
    const o2 = await (await open.app.request("/api/orders", json("POST", { cart: { mode: "pickup", lines: [{ id: "pitsa-dyavolo", q: 1 }] }, name: "И", phone: "0888123456", sched: "утре", slot: "12:00" }))).json();
    expect((await (await open.app.request("/api/orders/" + o2.no)).json()).no).toBe(o2.no);
  });
  it("cross-origin POST is refused", async () => {
    const r = await app.request("http://localhost/api/subscribe", { method: "POST", headers: { origin: "https://evil.example", host: "localhost", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
  it("status carries the kitchen settings; only staff change them", async () => {
    const st = await (await app.request("/api/status")).json();
    expect(st.kitchen).toEqual({ busy: false, etaMin: 35, etaBusyMin: 55 });
    expect((await app.request("/api/admin/settings", json("PATCH", { kitchen: { busy: true } }))).status).toBe(401);
  });
  it("office: the public view has no organizer token; submit needs it", async () => {
    const r = await app.request("/api/office", json("POST", { office: "Офис", addr: "Дружба 2, бл. 311", deadline: "14:00" }));
    expect(r.status).toBe(201);
    const o = await r.json();
    expect(o.orgKey).toBeTruthy();
    const pub = await (await app.request("/api/office/" + o.code)).json();
    expect(pub.orgKey).toBeUndefined();
    expect(pub.contact).toBeUndefined();
    expect((await app.request("/api/office/" + o.code + "/submit", json("POST", { name: "Иван", phone: "0888123456" }))).status).toBe(403);
  });
  it("events: dates as YYYY-MM-DD; /api/menu compressed when asked", async () => {
    const ev = await (await app.request("/api/events")).json();
    expect(ev[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const m = await app.request("/api/menu", { headers: { "accept-encoding": "gzip" } });
    expect(m.headers.get("content-encoding")).toBe("gzip");
  });
  it("preview clock header is ignored without SC_PREVIEW_API", async () => {
    const r = await app.request("/api/orders", json("POST", { cart: { mode: "pickup", lines: [{ id: "pitsa-dyavolo", q: 1 }] }, name: "И", phone: "0888123456", sched: "утре", slot: "10:30" }));
    expect(r.status).toBe(201);
    const t = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, previewApi: true });
    const late = await t.app.request("/api/orders", { method: "POST", headers: { "content-type": "application/json", "x-sc-clock": "23:30" }, body: JSON.stringify({ cart: { mode: "pickup", lines: [{ id: "pitsa-dyavolo", q: 1 }] }, name: "И", phone: "0888123456" }) });
    expect(late.status).toBe(409);
  });
  it("an invalid code is 200 with valid:false (no console error), same message and fields", async () => {
    const r = await app.request("/api/codes/check", json("POST", { code: "SC10-0000000000" }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ valid: false, error: { code: "invalid", message: "Няма такъв код. Проверете цифрите, например SC10-4829163057.", fields: { code: "Няма такъв код. Проверете цифрите, например SC10-4829163057." } } });
  });
  it("code checks are limited per IP", async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await app.request("/api/codes/check", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "9.9.9.9" }, body: JSON.stringify({ code: "SC10-0000000000" }) })).status;
    expect(last).toBe(429);
  });
  it("feedback: 201, same fields as the core, at most 5 per IP in 10 min", async () => {
    const send = (b: unknown) => app.request("/api/feedback", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "8.8.8.8" }, body: JSON.stringify(b) });
    const bad = await send({ name: "", contact: "x", message: "" });
    expect(bad.status).toBe(422);
    expect(Object.keys((await bad.json()).fields).sort()).toEqual(["contact", "message", "name"]);
    for (let i = 0; i < 5; i++) expect((await send({ name: "Иван", contact: "0888123456", message: "Здравейте " + i })).status).toBe(201);
    expect((await send({ name: "Иван", contact: "0888123456", message: "Още едно" })).status).toBe(429);
    expect((await app.request("/api/admin/feedback")).status).toBe(401);
  });
  it("office: unknown invite codes are limited per IP", async () => {
    let last = 0;
    const first = await app.request("/api/office/100000", { headers: { "x-forwarded-for": "7.7.7.7" } });
    const cookie = (first.headers.get("set-cookie") || "").split(";")[0];
    for (let i = 1; i < 21; i++) last = (await app.request("/api/office/" + (100000 + i), { headers: { "x-forwarded-for": "7.7.7.7", cookie } })).status;
    expect(last).toBe(429);
  });
  it("a web order never takes a table from the body", async () => {
    const o = await (await app.request("/api/orders", json("POST", { cart: { mode: "pickup", lines: [{ id: "pitsa-dyavolo", q: 1 }] }, name: "И", phone: "0888123456", sched: "утре", slot: "12:00", table: "7" }))).json();
    expect(o.table).toBeNull();
  });
  it("rate limits: reservations per IP and per phone, subscribe and celebrations per IP (429 throttled)", async () => {
    const post = (path: string, b: unknown, ipAddr: string) => app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ipAddr }, body: JSON.stringify(b) });
    const res = (phone: string) => ({ date: "2026-12-20", time: "19:00", people: 2, name: "И", phone });
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await post("/api/reservations", res("0888555444"), "1.1.1." + i)).status;
    expect(last).toBe(429);
    const r = await post("/api/reservations", res("0888555444"), "1.1.2.1");
    expect(await r.json()).toMatchObject({ error: "throttled" });
    for (let i = 0; i < 11; i++) last = (await post("/api/reservations", res("08887770" + String(i).padStart(2, "0")), "2.2.2.2")).status;
    expect(last).toBe(429);
    for (let i = 0; i < 11; i++) last = (await post("/api/subscribe", { email: "a" + i + "@b.bg", consent: true }, "3.3.3.3")).status;
    expect(last).toBe(429);
    for (let i = 0; i < 6; i++) last = (await post("/api/celebrations", { kind: "Рожден ден", people: 10, date: "2026-12-20", name: "И", phone: "0888123456" }, "4.4.4.4")).status;
    expect(last).toBe(429);
    /* the test mode has no limits */
    const t = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, previewApi: true });
    for (let i = 0; i < 12; i++) last = (await t.app.request("/api/subscribe", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "5.5.5.5" }, body: JSON.stringify({ email: "x" + i + "@b.bg", consent: true }) })).status;
    expect(last).toBe(201);
  });
  it("orders: per IP and per phone in 10 min; X-Forwarded-For only with trustProxy", async () => {
    const t = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, trustProxy: true });
    const order = (phone: string, ipAddr: string) => t.app.request("/api/orders", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ipAddr },
      body: JSON.stringify({ cart: { mode: "pickup", lines: [{ id: "pitsa-dyavolo", q: 1 }] }, name: "И", phone, sched: "утре", slot: "12:00" }) });
    let last = 0;
    for (let i = 0; i < 6; i++) last = (await order("0888111222", "9.0.0." + i)).status;
    expect(last).toBe(429);
    for (let i = 0; i < 21; i++) last = (await order("08881000" + String(i).padStart(2, "0"), "9.9.0.1")).status;
    expect(last).toBe(429);
    /* without trustProxy the header is ignored: every request is the same client */
    const u = createApp({ dbFile: ":memory:", distDir: "dist", timers: false });
    for (let i = 0; i < 21; i++) last = (await u.app.request("/api/codes/check", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3." + i }, body: JSON.stringify({ code: "SC10-0000000000" }) })).status;
    expect(last).toBe(200);
    for (let i = 0; i < 15; i++) last = (await u.app.request("/api/codes/check", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "1.2.4." + i }, body: JSON.stringify({ code: "SC10-0000000000" }) })).status;
    expect(last).toBe(429);
  });
  it("office: unknown and someone else's code answer the same on update / submit and count as wrong tries; a right link passes for another device", async () => {
    const t = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, trustProxy: true });
    const o = await (await t.app.request("/api/office", json("POST", { office: "", addr: "Дружба 2, бл. 311", deadline: "14:00" }))).json();
    const req = (path: string, b: unknown, cookie = "") => t.app.request(path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "6.6.6.6", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(b) });
    const a = await req("/api/office/999999/submit", { name: "И", phone: "0888123456" });
    const b = await req("/api/office/" + o.code + "/submit", { name: "И", phone: "0888123456", orgKey: "wrong" });
    expect(a.status).toBe(403);
    expect(await a.json()).toEqual(await b.json());
    const dev = (a.headers.get("set-cookie") || "").split(";")[0];
    let last = 0;
    for (let i = 0; i < 20; i++) last = (await req("/api/office/" + (200000 + i) + "/update", { orgKey: "x" }, dev)).status;
    expect(last).toBe(429);
    /* another device on the same IP still opens the right link */
    const other = await t.app.request("/api/office/" + o.code, { headers: { "x-forwarded-for": "6.6.6.6" } });
    expect(other.status).toBe(200);
  });
  it("without TRUST_PROXY a forged X-Forwarded-For changes nothing; refused-as-invalid reservations do not use the quota", async () => {
    const t = createApp({ dbFile: ":memory:", distDir: "dist", timers: false });
    const post = (b: unknown, fwd: string) => t.app.request("/api/reservations", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": fwd }, body: JSON.stringify(b) });
    /* 15 invalid requests (422) from "different" forged addresses: none counts */
    for (let i = 0; i < 15; i++) expect((await post({ date: "2020-01-01", time: "19:00", people: 2, name: "И", phone: "08882000" + String(i).padStart(2, "0") }, "10.0.0." + i)).status).toBe(422);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await post({ date: "2026-12-21", time: "13:00", people: 2, name: "И", phone: "08883000" + String(i).padStart(2, "0") }, "10.1.0." + i)).status;
    expect(last).toBe(201);
    /* the 11th valid one from the same connection is refused, whatever the forged header says */
    expect((await post({ date: "2026-12-21", time: "13:30", people: 2, name: "И", phone: "0888399999" }, "10.2.0.1")).status).toBe(429);
  });
  it("„Изчерпано днес“: kitchen / menu roles switch it; /api/menu and the order check follow; tomorrow is not touched", async () => {
    await core.staff.upsert({ username: "k1", name: "Кухня", role: "kitchen", password: "test-password-123" });
    await core.staff.upsert({ username: "w1", name: "Сервитьор", role: "waiter", password: "test-password-123" });
    const login = async (u: string) => (await app.request("/api/auth/login", json("POST", { username: u, password: "test-password-123" }))).headers.get("set-cookie")!.split(";")[0];
    const k = await login("k1"), w = await login("w1");
    const put = (id: string, out: unknown, cookie?: string) => app.request("/api/admin/menu/" + id + "/sold-out", json("PUT", { out }, cookie));
    expect((await put("pitsa-dyavolo", true)).status).toBe(401);
    expect((await put("pitsa-dyavolo", true, w)).status).toBe(403);
    expect((await put("no-such-dish", true, k)).status).toBe(404);
    expect((await put("pitsa-dyavolo", "yes", k)).status).toBe(422);
    expect(await (await put("pitsa-dyavolo", true, k)).json()).toEqual({ id: "pitsa-dyavolo", out: true });
    const menu = await (await app.request("/api/menu")).json();
    expect(menu.items.find((x: { id: string }) => x.id === "pitsa-dyavolo").t).toContain("out");
    const order = (sched?: string) => app.request("/api/orders", json("POST", { cart: { mode: "pickup", lines: [{ id: "pitsa-dyavolo", q: 1 }] }, name: "Иван Петров", phone: "0888123499", ...(sched ? { sched, slot: "12:00" } : {}) }));
    /* the order for today is refused in the core (tests/unit/rules.test.ts, fixed clock); here: tomorrow is not touched */
    expect((await order("утре")).status).toBe(201);
    expect((await core.ctx.repo.list("audit_log", { actor: "k1" } as never)).length).toBeGreaterThan(0);
    expect(await (await put("pitsa-dyavolo", false, k)).json()).toEqual({ id: "pitsa-dyavolo", out: false });
    expect((await (await app.request("/api/menu")).json()).items.find((x: { id: string }) => x.id === "pitsa-dyavolo").t).not.toContain("out");
  });
});
