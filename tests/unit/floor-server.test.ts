/* The hall live on the server (server/routes/floor.ts, server/app.ts): the guests' routes by the table code and the phone's
   token, the staff's routes with the rights of the core (401 / 403 by direct requests), the real-time stream of a table,
   the PIN on a known device (cookies), the static pages of the QR table, the limit for wrong codes. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.ts";
import { items } from "../../src/lib/data.ts";
import type { Order, RoleId } from "../../src/core/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-floor-"));
const dist = path.join(tmp, "dist");
for (const p of ["", "masa", "masa/menu", "masa/kolichka", "masa/povikvane", "masa/smetka"]) { fs.mkdirSync(path.join(dist, p), { recursive: true }); fs.writeFileSync(path.join(dist, p, "index.html"), "<p>page:" + (p || "home") + "</p>"); }
fs.writeFileSync(path.join(dist, "404.html"), "<p>404</p>");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const PW = "test-password-123", A = "a".repeat(32), B = "b".repeat(32);
const pizza = items.find((x) => x.cat === "pitsi" && !x.t.includes("out"))!;
const J = { "content-type": "application/json" };
/** the cookies a response sets, as a Cookie header */
const jar = (r: Response) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function boot(previewApi: boolean) {
  const x = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build: null, smsDemo: true, previewApi });
  for (const r of ROLES) await x.core.staff.upsert({ username: r, name: r === "waiter" ? "Сервитьор 1" : r, role: r, password: PW });
  const cookie: Record<string, string> = {}, set: Record<string, string[]> = {};
  for (const r of ROLES) { const res = await x.app.request("/api/auth/login", { method: "POST", headers: J, body: JSON.stringify({ username: r, password: PW }) }); cookie[r] = jar(res); set[r] = res.headers.getSetCookie(); }
  /* the kitchen is open at 19:42 on the page's clock (the test mode follows it) */
  const req = (method: string, url: string, who?: RoleId | null, body?: unknown, clock = "19:42") =>
    x.app.request(url, { method, headers: { ...J, ...(previewApi ? { "x-sc-clock": clock } : {}), ...(who ? { cookie: cookie[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const admin = (await x.core.staff.bySession(/sc_staff=([^;]+)/.exec(cookie.admin)![1]))!;
  const codeOf = async (n: number) => (await x.core.hall.qr(admin)).find((r) => r.n === n)!.code;
  const guest = (code: string, pathName: string, g: string, body: Record<string, unknown> = {}, clock?: string) => req("POST", "/api/floor/t/" + code + "/" + pathName, null, { g, ...body }, clock);
  return { ...x, cookie, set, req, codeOf, guest, admin };
}

describe("the hall live: routes", async () => {
  const S = await boot(true);
  const { app, core, req, guest } = S;

  const W: RoleId[] = ["admin", "owner", "manager", "waiter"], BOSS: RoleId[] = ["admin", "owner", "manager"];
  const ROUTES: [string, string, unknown, RoleId[]][] = [
    ["GET", "/api/floor/hall", null, W], ["GET", "/api/floor/ready", null, W], ["GET", "/api/floor/table/1", null, W], ["POST", "/api/floor/table/19/seat", null, W],
    ["POST", "/api/floor/table/1/order", { lines: [] }, W], ["POST", "/api/floor/table/1/qr/confirm", {}, W], ["POST", "/api/floor/table/1/qr/reject", { reason: "test" }, W],
    ["POST", "/api/floor/table/1/qr/undo", null, W], ["POST", "/api/floor/table/1/serve", {}, W], ["POST", "/api/floor/table/1/unserve", { keys: [] }, W],
    ["POST", "/api/floor/table/1/pay", { how: "cash" }, W], ["POST", "/api/floor/table/1/close", {}, W], ["POST", "/api/floor/call/nope/take", null, W],
    ["POST", "/api/floor/call/nope/done", null, W], ["POST", "/api/floor/call/nope/undo", null, W], ["GET", "/api/floor/shift", null, W],
    ["POST", "/api/floor/shift/start", { tables: [] }, W], ["GET", "/api/staff/search?q=12", null, W],
    ["GET", "/api/floor/shift/view", null, BOSS], ["POST", "/api/floor/shift/tables", { who: "waiter", tables: [1] }, BOSS], ["GET", "/api/floor/ratings", null, BOSS],
  ];
  it("the waiter's order over HTTP with the same rid twice is made once (the route passes the rid to the core)", async () => {
    const body = { rid: "srv-rid-" + "12345678", lines: [{ id: pizza.id, q: 1 }] };
    const a = await (await req("POST", "/api/floor/table/18/order", "waiter", body)).json();
    const b = await (await req("POST", "/api/floor/table/18/order", "waiter", body)).json();
    expect(b.orders).toEqual(a.orders);
    expect(a.orders).toHaveLength(1);
  });

  it("401 without a session and 403 for a role without the right on every staff route", async () => {
    for (const [m, u, b] of ROUTES) expect([m, u, (await req(m, u, null, b ?? undefined)).status]).toEqual([m, u, 401]);
    for (const [m, u, b, ok] of ROUTES) for (const r of ROLES) {
      const st = (await req(m, u, r, b ?? undefined)).status;
      expect([m, u, r, st === 403]).toEqual([m, u, r, !ok.includes(r)]);
    }
    /* the end of the shift is the waiter's own action too (checked apart: it signs the caller out) */
    expect((await req("POST", "/api/floor/shift/end", null, {})).status).toBe(401);
    expect((await req("POST", "/api/floor/shift/end", "kitchen", {})).status).toBe(403);
  });

  it("the guests: a wrong code is 404, a wrong token 403; the flow over HTTP; the same errors as the core", async () => {
    const code = await S.codeOf(12);
    const bad = await guest("zzzzzzzz", "open", A);
    expect(bad.status).toBe(404);
    expect(await bad.json()).toMatchObject({ error: "not_found", message: expect.stringContaining("Този код вече не работи") });
    expect((await guest(code, "open", "")).status).toBe(403);
    const v1 = await (await guest(code, "open", A)).json();
    expect(v1).toMatchObject({ status: "open", table: { n: 12 }, me: { phone: 1, label: "Телефон 1" }, canOrder: true });
    expect((await guest(code, "view", B)).status).toBe(403);
    expect((await (await guest(code, "open", B)).json()).me.phone).toBe(2);
    /* the kitchen hours come from the core: after 22:30 nothing is added */
    const late = await guest(code, "cart/add", A, { id: pizza.id }, "22:45");
    expect(late.status).toBe(409);
    expect((await late.json()).error).toBe("closed");
    let v = await (await guest(code, "cart/add", A, { id: pizza.id, q: 2 })).json();
    expect(v.cart).toMatchObject({ n: 2, sum: Math.round(pizza.p * 200) / 100, toWaiter: true });
    v = await (await guest(code, "cart/qty", B, { key: v.cart.lines[0].key, q: 1 })).json();
    const rm = await (await guest(code, "cart/remove", B, { key: v.cart.lines[0].key })).json();
    expect(rm.view.cart.n).toBe(0);
    expect((await (await guest(code, "cart/restore", B, { line: rm.gone })).json()).cart.lines[0]).toMatchObject({ id: pizza.id, q: 1, phone: 1 });
    const sent = await (await guest(code, "send", A)).json();
    expect(sent).toMatchObject({ to: "waiter", no: null, view: { pending: { n: 1 } } });
    /* the waiter: the hall, "Потвърди и прати" */
    const hall = await (await req("GET", "/api/floor/hall", "waiter")).json();
    expect(hall.tables.find((t: { n: number }) => t.n === 12)).toMatchObject({ state: "qr" });
    expect(hall.counters.queue).toBe(1);
    expect((await req("POST", "/api/floor/table/12/qr/reject", "waiter", {})).status).toBe(422);
    const conf = await (await req("POST", "/api/floor/table/12/qr/confirm", "waiter", {})).json();
    expect(conf.no).toMatch(/^\d+$/);
    expect(conf.bills[0]).toMatchObject({ name: "Обща сметка", sum: pizza.p });
    /* the kitchen marks the line ready (its own core does this), "Сервирах", the bill, the close */
    const o = (await core.ctx.repo.get<Order>("orders", conf.no))!;
    o.lines[0].ks = "ready"; o.lines[0].readyAt = new Date().toISOString();
    await core.ctx.repo.put("orders", o);
    expect((await (await req("GET", "/api/floor/ready", "waiter")).json())[0].lines[0].key).toBe(conf.no + ":0");
    expect((await (await req("POST", "/api/floor/table/12/serve", "waiter", {})).json()).served).toEqual([conf.no + ":0"]);
    v = await (await guest(code, "call", A, { kind: "other", note: "детско столче" })).json();
    expect(v.calls.active[0]).toMatchObject({ kind: "other", note: "детско столче" });
    const again = await guest(code, "call", B, { kind: "other" });
    expect([again.status, (await again.json()).error]).toEqual([409, "call_active"]);
    const callId = (await (await req("GET", "/api/floor/hall", "waiter")).json()).calls[0].id;
    expect((await (await req("POST", "/api/floor/call/" + callId + "/take", "waiter")).json()).calls[0].taken).toMatchObject({ name: "Сервитьор 1", mine: true });
    expect((await (await req("POST", "/api/floor/call/" + callId + "/done", "waiter")).json()).calls).toEqual([]);
    v = await (await guest(code, "bill", B, { pay: "card", split: "one" })).json();
    expect(v.bill.mine).toMatchObject({ pay: "card", split: "one", sum: pizza.p });
    expect((await req("POST", "/api/floor/table/12/close", "waiter", {})).status).toBe(409);
    const paid = await (await req("POST", "/api/floor/table/12/pay", "waiter", { how: "card" })).json();
    expect(paid).toMatchObject({ rest: 0, canClose: true, payment: { sum: pizza.p, how: "card" } });
    const rate = await (await guest(code, "rate", A, { happy: true })).json();
    expect(rate).toMatchObject({ code: expect.stringMatching(/^SC10-\d{10}$/), pct: 10, googleMissing: true });
    expect((await (await req("POST", "/api/floor/table/12/close", "waiter", {})).json()).state).toBe("free");
    const closed = await guest(code, "cart/add", A, { id: pizza.id });
    expect([closed.status, (await closed.json()).error]).toEqual([409, "session_closed"]);
    expect((await (await guest(code, "open", A)).json()).status).toBe("closed");
    expect((await (await guest(code, "open", A, { fresh: true })).json())).toMatchObject({ status: "open", orders: [] });
    /* the waiter's order and the search, over HTTP */
    const ord = await req("POST", "/api/floor/table/14/order", "waiter", { lines: [{ id: pizza.id, q: 1, guest: "Гост 1" }], note: "бързат" });
    expect(ord.status).toBe(201);
    const od = await ord.json();
    expect(od.bills[0]).toMatchObject({ name: "Гост 1" });
    const f = await (await req("GET", "/api/staff/search?q=" + od.orders[0], "waiter")).json();
    expect(f.orders[0]).toMatchObject({ no: od.orders[0], table: { n: 14 } });
  });

  it("the shift over HTTP: start, the manager's view, the end signs the waiter out", async () => {
    const st = await (await req("POST", "/api/floor/shift/start", "waiter", { tables: [3, 4] })).json();
    expect(st.shift.tables.map((t: { n: number }) => t.n)).toEqual([3, 4]);
    expect((await (await req("GET", "/api/floor/shift/view", "manager")).json()).waiters[0]).toMatchObject({ name: "Сервитьор 1", answered: 1, avgSec: expect.any(Number) }); /* the call he took in the test above */
    expect((await (await req("POST", "/api/floor/shift/tables", "manager", { who: "waiter", tables: [5] })).json()).waiters[0].tables.map((t: { n: number }) => t.n)).toEqual([5]);
    const end = await req("POST", "/api/floor/shift/end", "waiter", {});
    expect(await end.json()).toMatchObject({ ok: true });
    expect(end.headers.getSetCookie().join(";")).toMatch(/sc_staff=;/);
    expect((await req("GET", "/api/floor/hall", "waiter")).status).toBe(401);
  });

  it("the stream: a guest hears only the sitting of its own table; a wrong token hears nothing of it", async () => {
    const c15 = await S.codeOf(15), c16 = await S.codeOf(16);
    await guest(c15, "open", A); await guest(c16, "open", B);
    const open = async (url: string) => {
      const res = await app.request(url), reader = res.body!.getReader(), dec = new TextDecoder();
      let buf = "";
      const pump = async () => { for (;;) { const { value, done } = await reader.read(); if (done) return; buf += dec.decode(value, { stream: true }); } };
      void pump().catch(() => undefined);
      return { text: () => buf, close: () => reader.cancel().catch(() => undefined) };
    };
    const mine = await open("/api/stream?table=" + c15 + "&g=" + A), other = await open("/api/stream?table=" + c16 + "&g=" + B), thief = await open("/api/stream?table=" + c15 + "&g=" + B);
    const wait = () => new Promise((r) => setTimeout(r, 60));
    await wait();
    expect(mine.text()).toContain("event: hello");
    expect(JSON.parse(/event: hello\ndata: (.*)/.exec(thief.text())![1]).tables).toEqual([]);
    await guest(c15, "cart/add", A, { id: pizza.id });
    await wait();
    expect(mine.text()).toContain("event: floor.session");
    expect(mine.text()).toContain(pizza.id);
    expect(mine.text()).not.toContain(A);
    expect(other.text()).not.toContain("floor.session");
    expect(thief.text()).not.toContain("floor.session");
    /* a kitchen change of a table order (order.line to the staff) reaches the guests as floor.session */
    const od = await (await req("POST", "/api/floor/table/15/order", "manager", { lines: [{ id: pizza.id, q: 1 }] })).json();
    await wait();
    const before = mine.text().split("event: floor.session").length;
    core.ctx.emit!("order.line", { no: od.orders[0], kind: "ready", sec: "pesht", lines: [0], table: "G3", session: od.session.id, at: new Date().toISOString() }, {});
    await wait();
    expect(mine.text().split("event: floor.session").length).toBe(before + 1);
    expect(mine.text()).not.toContain("event: order.line");
    expect(other.text()).not.toContain("floor.session");
    await mine.close(); await other.close(); await thief.close();
  });

  it("the static pages of the QR table: /masa/<код>/ and /masa/<код>/<екран>/", async () => {
    const code = await S.codeOf(1);
    expect(await (await app.request("/masa/" + code + "/")).text()).toBe("<p>page:masa</p>");
    expect(await (await app.request("/masa/" + code)).text()).toBe("<p>page:masa</p>");
    for (const p of ["menu", "kolichka", "povikvane", "smetka"]) expect(await (await app.request("/masa/" + code + "/" + p + "/")).text()).toBe("<p>page:masa/" + p + "</p>");
    /* the folder of a screen is not a table code ("kolichka" has 8 letters) */
    expect(await (await app.request("/masa/kolichka/")).text()).toBe("<p>page:masa/kolichka</p>");
    expect((await app.request("/masa/" + code + "/admin/")).status).toBe(404);
  });
});

describe("the PIN on a known device and the limits", async () => {
  const S = await boot(false);
  const { app, core, req } = S;
  const rows = (await core.staffAdmin.list(S.admin)).rows, wid = rows.find((r) => r.username === "waiter")!.id, kid = rows.find((r) => r.username === "kitchen")!.id;
  await core.staffAdmin.setPin(S.admin, wid, "4821");
  await core.staffAdmin.setPin(S.admin, kid, "6094");

  it("a password sign-in sets the long-lived httpOnly device cookie; only with it the names and the PIN work", async () => {
    const dev = S.set.manager.find((c) => c.startsWith("sc_kd="))!;
    expect(dev).toMatch(/HttpOnly/i);
    expect(dev).toMatch(/SameSite=Lax/i);
    expect(+/Max-Age=(\d+)/i.exec(dev)![1]).toBeGreaterThan(300 * 24 * 3600);
    const known = dev.split(";")[0];
    /* an unknown device: no names, no sign-in */
    expect(await (await app.request("/api/auth/pin/people?module=waiter")).json()).toEqual({ known: false, module: "waiter", pinOnly: false, people: [] });
    const no = await app.request("/api/auth/pin", { method: "POST", headers: J, body: JSON.stringify({ module: "waiter", user: wid, pin: "4821" }) });
    expect([no.status, (await no.json()).error]).toEqual([403, "unknown_device"]);
    expect((await app.request("/api/auth/pin/people?module=boss", { headers: { cookie: known } })).status).toBe(422);
    /* the known device */
    expect(await (await app.request("/api/auth/pin/people?module=waiter", { headers: { cookie: known } })).json()).toEqual({ known: true, module: "waiter", pinOnly: false, people: [{ id: wid, name: "Сервитьор 1" }] });
    const wrong = await app.request("/api/auth/pin", { method: "POST", headers: { ...J, cookie: known }, body: JSON.stringify({ module: "waiter", user: wid, pin: "0000" }) });
    expect([wrong.status, (await wrong.json()).error]).toEqual([401, "bad_pin"]);
    const ok = await app.request("/api/auth/pin", { method: "POST", headers: { ...J, cookie: known }, body: JSON.stringify({ module: "waiter", user: wid, pin: "4821" }) });
    expect(await ok.json()).toMatchObject({ user: { username: "waiter", role: "waiter" }, home: "app:waiter" });
    const session = ok.headers.getSetCookie().find((c) => c.startsWith("sc_staff="))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(await (await app.request("/api/auth/me", { headers: { cookie: session.split(";")[0] } })).json()).toMatchObject({ user: { username: "waiter" }, home: "app:waiter" });
    expect((await app.request("/api/floor/hall", { headers: { cookie: session.split(";")[0] } })).status).toBe(200);
    /* the kitchen: the person + the PIN */
    const k = await app.request("/api/auth/pin", { method: "POST", headers: { ...J, cookie: known }, body: JSON.stringify({ module: "kitchen", user: kid, pin: "6094" }) });
    expect((await k.json()).user.username).toBe("kitchen");
    /* a wrong password leaves no device cookie */
    const bad = await app.request("/api/auth/login", { method: "POST", headers: J, body: JSON.stringify({ username: "waiter", password: "wrong-password-1" }) });
    expect(bad.status).toBe(401);
    expect(bad.headers.getSetCookie().join(";")).not.toContain("sc_kd");
    /* 5 wrong PINs lock the person on this device */
    for (let i = 0; i < 5; i++) await app.request("/api/auth/pin", { method: "POST", headers: { ...J, cookie: known }, body: JSON.stringify({ module: "waiter", user: wid, pin: "0000" }) });
    const locked = await app.request("/api/auth/pin", { method: "POST", headers: { ...J, cookie: known }, body: JSON.stringify({ module: "waiter", user: wid, pin: "4821" }) });
    expect(locked.status).toBe(429);
    expect(await locked.json()).toMatchObject({ error: "throttled", retryIn: expect.any(Number) });
  });

  it("wrong table codes are limited per address; right ones are not counted", async () => {
    const code = await S.codeOf(2);
    const g = (c: string) => req("POST", "/api/floor/t/" + c + "/open", null, { g: A });
    for (let i = 0; i < 40; i++) expect((await g(code)).status).toBe(200);
    for (let i = 0; i < 30; i++) expect((await g("zzzzzzz" + "abcdefghjkmnpqrstuvwxyz23456789"[i])).status).toBe(404);
    const r = await g("zzzzzzzz");
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: "throttled", retryIn: expect.any(Number) });
  });
});
