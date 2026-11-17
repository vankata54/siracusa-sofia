/* The client of the hall live in the DEMO mode (src/client/api-floor.ts with the core in the browser): the same calls,
   the same results and the same error codes as the server (tests/unit/floor-server.test.ts), the demo bus for a table,
   the PIN on "this device" (the browser's own store). A tiny browser is put in place before the client is loaded. */
import { describe, it, expect, afterAll, beforeAll } from "vitest";

function store(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); }, clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } } as Storage;
}
const G = globalThis as Record<string, any>;
G.__DEMO__ = true;
G.document = { documentElement: { dataset: { demo: "1", root: "/" } } };
G.localStorage = store();
G.sessionStorage = store();

const PW = "a-long-password-1";
let api: typeof import("../../src/client/api.ts"), fl: typeof import("../../src/client/api-floor.ts"), demo: typeof import("../../src/client/api-demo.ts"), adm: typeof import("../../src/client/api-admin.ts");
let code = "", code2 = "", waiterId = "";

beforeAll(async () => {
  (await import("../../src/lib/time.ts")).setClock("19:42");
  api = await import("../../src/client/api.ts");
  fl = await import("../../src/client/api-floor.ts");
  demo = await import("../../src/client/api-demo.ts");
  adm = await import("../../src/client/api-admin.ts");
  await demo.local(async (c) => {
    await c.staff.upsert({ username: "admin", name: "Главен админ", role: "admin", password: PW });
    await c.staff.upsert({ username: "waiter", name: "Сервитьор 1", role: "waiter", password: PW });
    /* the codes of the tables and a PIN, as the admin sets them (a core session only: this browser stays signed out) */
    const s = (await c.staff.bySession((await c.staff.login("admin", PW, "setup", "f".repeat(48))).token))!;
    const qr = await c.hall.qr(s);
    code = qr.find((r) => r.n === 12)!.code; code2 = qr.find((r) => r.n === 13)!.code;
    waiterId = (await c.staffAdmin.list(s)).rows.find((r) => r.username === "waiter")!.id;
    await c.staffAdmin.setPin(s, waiterId, "4821");
  });
});
afterAll(() => { api.demoChannel()?.close(); });

describe("api-floor in the demo", () => {
  it("is the demo build", () => { expect(api.DEMO).toBe(true); });

  it("the guests: the phone's token stays in the tab, the calls return the view, the errors keep their codes", async () => {
    const tok = fl.masaApi.token();
    expect(tok).toMatch(/^[0-9a-f]{32}$/);
    expect(G.sessionStorage.getItem("sc-masa-g")).toBe(tok); /* the demo: per tab, so two tabs are two phones */
    expect(G.localStorage.getItem("sc-masa-g")).toBeNull();
    await expect(fl.masaApi.open("zzzzzzzz")).rejects.toMatchObject({ name: "Error", code: "not_found", status: 404, message: expect.stringContaining("Този код вече не работи") });
    const v = await fl.masaApi.open(code);
    expect(v).toMatchObject({ status: "open", table: { n: 12 }, me: { phone: 1, label: "Телефон 1" }, canOrder: true });
    await expect(fl.masaApi.cartAdd(code, "l-supa-topcheta")).rejects.toMatchObject({ code: "lunch_table", status: 409 });
    await expect(fl.masaApi.cartAdd(code, "nope")).rejects.toBeInstanceOf(fl.ApiError);
    /* real time: only the sitting this page follows */
    const seen: [string, any][] = [];
    const off = fl.masaApi.on((type, data) => seen.push([type, data]));
    const { items } = await import("../../src/lib/data.ts"), pizza = items.find((x) => x.cat === "pitsi" && !x.t.includes("out"))!;
    const v2 = await fl.masaApi.cartAdd(code, pizza.id, { q: 2 });
    expect(v2.cart).toMatchObject({ n: 2, toWaiter: true });
    expect(seen.map((x) => x[0])).toEqual(["floor.session"]);
    expect(seen[0][1]).toMatchObject({ id: v.session, view: { me: null, cart: { n: 2 } } });
    expect(JSON.stringify(seen[0][1])).not.toContain(tok);
    api.busFire("floor.session", { id: "other" }, { table: "other" });
    api.busFire("floor.call", { table: "S12" }, {});
    expect(seen).toHaveLength(1);
    /* the kitchen's line change of this sitting's order is let through to the table (the demo has no server to pass it on) */
    api.busFire("order.line", { no: "1042", session: v.session, lines: [0] }, {});
    api.busFire("order.line", { no: "1043", session: "other", lines: [0] }, {});
    expect(seen.map((x) => x[0])).toEqual(["floor.session", "order.line"]);
    const rm = await fl.masaApi.cartRemove(code, v2.cart.lines[0].key);
    expect((await fl.masaApi.cartRestore(code, rm.gone!)).cart.n).toBe(2);
    const sent = await fl.masaApi.send(code);
    expect(sent).toMatchObject({ to: "waiter", no: null, view: { pending: { n: 2 } } });
    expect((await fl.masaApi.call(code, "water")).calls.state.water.state).toBe("active");
    await expect(fl.masaApi.call(code, "water")).rejects.toMatchObject({ code: "call_active", status: 409 });
    off();
  });

  it("the staff: 401 without a session; the PIN works only after a password sign-in in this browser; the hall, the shift", async () => {
    await expect(fl.floorApi.hall()).rejects.toMatchObject({ code: "auth", status: 401 });
    /* a new browser: nobody has signed in with a password here */
    expect(await fl.pinApi.people("waiter")).toEqual({ known: false, module: "waiter", pinOnly: false, people: [] });
    await expect(fl.pinApi.login("waiter", "4821", waiterId)).rejects.toMatchObject({ code: "unknown_device", status: 403 });
    await adm.staffApi.login("admin", PW);
    await adm.staffApi.logout();
    expect(await fl.pinApi.people("waiter")).toEqual({ known: true, module: "waiter", pinOnly: false, people: [{ id: waiterId, name: "Сервитьор 1" }] });
    await expect(fl.pinApi.login("waiter", "0000", waiterId)).rejects.toMatchObject({ code: "bad_pin", status: 401 });
    expect(await fl.pinApi.login("waiter", "4821", waiterId)).toMatchObject({ user: { username: "waiter", role: "waiter" }, home: "app:waiter" });
    expect((await adm.staffApi.me())!.user.username).toBe("waiter");
    /* the same core as the guests': the QR order and the call wait in the hall */
    const hall = await fl.floorApi.hall();
    expect(hall.tables.find((x) => x.n === 12)).toMatchObject({ state: "call", label: "Вика · Вода / прибори" });
    expect(hall.counters.queue).toBe(2);
    expect((await fl.shiftApi.start([12, 13])).shift!.tables.map((x) => x.n)).toEqual([12, 13]);
    await expect(fl.shiftApi.view()).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect((await fl.floorApi.callDone(hall.calls[0].id)).calls).toEqual([]);
    const d = await fl.floorApi.qrConfirm(12);
    expect(d.no).toMatch(/^\d+$/);
    expect((await fl.masaApi.get(code)).orders[0]).toMatchObject({ no: d.no, via: true });
    await expect(fl.floorApi.qrReject(12, "nope" as never)).rejects.toMatchObject({ code: "invalid", status: 422, fields: { reason: expect.any(String) } });
    const o = await fl.floorApi.order(13, { lines: [{ id: (await fl.masaApi.get(code)).orders[0].lines[0].id, q: 1 }] });
    expect(o.orders).toHaveLength(1);
    expect((await fl.floorApi.search(o.orders[0])).orders[0].table.n).toBe(13);
    expect((await fl.masaApi.open(code2)).orders[0].lines[0].who).toBe("Сервитьор");
    /* the end of the shift signs this browser out */
    expect(await fl.shiftApi.end()).toMatchObject({ ok: true, handed: [12, 13], to: null });
    expect(await adm.staffApi.me()).toBeNull();
    await expect(fl.floorApi.hall()).rejects.toMatchObject({ code: "auth", status: 401 });
  });
});
