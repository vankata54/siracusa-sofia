import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, KVRepo, CoreError, type Hasher } from "../../src/core/index.ts";
import { addLine, emptyCart } from "../../src/lib/cart.ts";
import { lunch, items, isOut } from "../../src/lib/data.ts";

/* fake hasher (the real ones are scrypt on the server and PBKDF2 in the demo) */
const hasher: Hasher = {
  async hash(p) { return { salt: "s", hash: "h:" + p, algo: "scrypt" }; },
  async verify(p, _s, h) { return h === "h:" + p; },
};
/* a fixed day (the lunch menu in the data is for 02.11.2026, so lunch tests run in preview) */
const NOW = new Date("2026-11-12T10:30:00Z");
const mk = (clock = "12:30", preview = false) => {
  const events: [string, unknown][] = [];
  const core = createCore({ repo: new MemoryRepo(), clock, hasher, now: () => NOW, preview, smsDemo: true, emit: (t, d) => events.push([t, d]) });
  return { core, events };
};
const pizza = items.find((x) => x.cat === "pitsi" && !isOut(x))!;
const base = { name: "Иван", phone: "0888 12 34 56", pay: "cash" as const };

describe("orders", () => {
  it("numbers start at № 1042 and increase", async () => {
    const { core, events } = mk();
    const c = addLine({ ...emptyCart(), mode: "pickup" }, pizza.id, 2);
    const a = await core.orders.create({ ...base, cart: c });
    const b = await core.orders.create({ ...base, cart: c });
    expect(a.no).toBe("1042");
    expect(b.no).toBe("1043");
    expect(a).toMatchObject({ mode: "pickup", status: "accepted", phone: "0888123456", marketing: false, payLabel: "В брой", total: pizza.p * 2 });
    expect(a.lines[0]).toMatchObject({ id: pizza.id, q: 2 });
    expect(events[0][0]).toBe("order.created");
    expect((await core.orders.get("1042"))!.no).toBe("1042");
  });
  it("delivery needs an address in a zone; ETA by zone", async () => {
    const { core } = mk("16:30");
    const c = addLine(emptyCart(), pizza.id);
    await expect(core.orders.create({ ...base, cart: c, zone: "Младост", addr: "Младост 1" })).rejects.toBeInstanceOf(CoreError);
    const o = await core.orders.create({ ...base, cart: c, zone: "Дружба 2", addr: "Дружба 2, бл. 311" });
    expect(o).toMatchObject({ mode: "delivery", zone: "Дружба 2", eta: 25, fee: 0 });
  });
  it("lunch after 15:00: -30% for pickup, refused for delivery", async () => {
    const { core } = mk("16:30", true);
    const p = await core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, lunch[0].id) });
    expect(p.disc).toBe(Math.round(lunch[0].p * 30) / 100);
    await expect(core.orders.create({ ...base, cart: addLine(emptyCart(), lunch[0].id), zone: "Дружба 2", addr: "Дружба 2, бл. 311" })).rejects.toMatchObject({ code: "lunch_delivery" });
    /* not in preview: the lunch menu in the data is not today's */
    await expect(mk("12:30").core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, lunch[0].id) })).rejects.toMatchObject({ code: "lunch_stale", status: 409 });
  });
  it("closed kitchen refuses today, invalid phone refused", async () => {
    const { core } = mk("23:30");
    await expect(core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, pizza.id) })).rejects.toMatchObject({ code: "closed" });
    const o = await core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, pizza.id), sched: "утре", slot: "12:00" });
    expect(o.at).toBe("12:00");
    await expect(core.orders.create({ ...base, phone: "123", cart: addLine({ ...emptyCart(), mode: "pickup" }, pizza.id), sched: "утре", slot: "12:00" })).rejects.toMatchObject({ code: "invalid" });
  });
  it("status flow", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, pizza.id) });
    expect((await core.orders.setStatus(o.no, "cooking")).status).toBe("cooking");
    await expect(core.orders.setStatus(o.no, "on_way")).rejects.toMatchObject({ code: "bad_status" });
  });
});

describe("reservations, SMS login, profile, rating", () => {
  it("reservation; blocked number gets a polite refusal; table cannot be taken twice", async () => {
    const { core } = mk();
    const r = await core.reservations.create({ date: "2026-11-28", time: "19:00", people: 4, table: "S3", ...base });
    expect(r.marketing).toBe(false);
    expect(r.key).toMatch(/^[0-9a-f]{24}$/);
    await expect(core.reservations.create({ date: "2026-11-28", time: "19:00", people: 2, table: "S3", ...base })).rejects.toMatchObject({ code: "taken" });
    await expect(core.reservations.create({ date: "2026-11-28", time: "19:00", people: 2, ...base, phone: "0888 000 000" })).rejects.toMatchObject({ code: "blocked", status: 403 });
    expect(await core.reservations.taken("2026-11-28", "19:00")).toEqual(["S3"]);
  });
  it("SMS code (demo: returned), new profile with marketing off and -10% coupon", async () => {
    const { core } = mk();
    const s = await core.customers.requestCode("0888123456");
    expect(s.demoCode).toMatch(/^\d{6}$/);
    await expect(core.customers.verifyCode("0888123456", "000000x")).rejects.toMatchObject({ code: "wrong_code" });
    const v = await core.customers.verifyCode("0888123456", s.demoCode!, { name: "Мария" });
    expect(v.isNew).toBe(true);
    expect(v.customer.consent.marketing).toBe(false);
    expect(v.customer.coupons[0].note).toContain("следващата поръчка");
    expect((await core.customers.bySession(v.token))!.name).toBe("Мария");
    const u = await core.customers.toggleFav(v.customer.id, pizza.id);
    expect(u.favs).toEqual([pizza.id]);
    await core.customers.remove(v.customer.id);
    expect(await core.customers.bySession(v.token)).toBeNull();
  });
  it("rating: same -10% for yes and no, Google link field in both", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, pizza.id) });
    await core.orders.setStatus(o.no, "picked_up");
    const yes = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: true });
    const no = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: false, text: "Студено" });
    expect(yes.pct).toBe(10);
    expect(no.pct).toBe(10);
    expect(no.code).toBe(yes.code);
    expect("google" in yes && "google" in no).toBe(true);
  });
});

describe("pencil notes, staff and roles", () => {
  it("notes: create, filter, status", async () => {
    const { core, events } = mk();
    const n = await core.notes.create({ module: "site", url: "/menu/", selector: "main h1", editId: "menu-h1", text: "По-голямо заглавие", elementText: "Меню", viewport: { w: 390, h: 844 } }, "admin");
    expect(n).toMatchObject({ status: "new", author: "admin", screenshot: null });
    await expect(core.notes.create({ module: "site", url: "/", selector: "", text: " ", viewport: { w: 1, h: 1 } }, "admin")).rejects.toMatchObject({ code: "invalid" });
    await core.notes.setStatus(n.id, "doing", "admin");
    expect(await core.notes.list({ status: "new" })).toHaveLength(0);
    expect(await core.notes.list({ status: "doing", module: "site" })).toHaveLength(1);
    expect(events.map((e) => e[0])).toContain("note.created");
  });
  it("staff login, sessions, role matrix", async () => {
    const { core } = mk();
    await core.staff.upsert({ username: "admin", name: "Главен админ", role: "admin", password: "very-long-secret" });
    await core.staff.upsert({ username: "kitchen", name: "Кухня", role: "kitchen", password: "kitchen-secret-1" });
    await expect(core.staff.login("admin", "wrong")).rejects.toMatchObject({ code: "bad_login", status: 401 });
    const s = await core.staff.login("admin", "very-long-secret");
    expect(s.user).not.toHaveProperty("hash");
    expect((await core.staff.bySession(s.token))!.sections).toContain("roles");
    expect(await core.staff.can("kitchen", "kitchen")).toBe(true);
    expect(await core.staff.can("kitchen", "menu")).toBe(false);
    await core.staff.setRole("kitchen", ["dashboard", "kitchen", "menu"], "admin");
    expect(await core.staff.can("kitchen", "menu")).toBe(true);
    await expect(core.staff.setRole("admin", [], "admin")).rejects.toMatchObject({ code: "forbidden" });
    expect((await core.audit.list()).some((a) => a.action === "staff.login_failed")).toBe(true);
  });
});

describe("KVRepo (demo storage)", () => {
  it("works over a localStorage-like store", async () => {
    const m = new Map<string, string>();
    const kv = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    const core = createCore({ repo: new KVRepo(kv), clock: "12:30", now: () => NOW });
    const o = await core.orders.create({ ...base, cart: addLine({ ...emptyCart(), mode: "pickup" }, pizza.id) });
    expect(o.no).toBe("1042");
    expect(JSON.parse(m.get("sc-db-orders")!)["1042"].no).toBe("1042");
  });
});
