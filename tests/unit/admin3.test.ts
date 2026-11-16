/* The admin, part 3 (core): orders, reservations and the hall, zones, offers and vouchers, events, QR, customers, reports,
   staff, settings. Every rule and every right is checked in the core (the server and the demo call the same functions). */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, publicOrder, type Hasher, type Order, type StaffCtx, type RoleId } from "../../src/core/index.ts";
import { ZONES } from "../../src/lib/consts.ts";
import { TABLES } from "../../src/lib/tables.ts";
import { events } from "../../src/lib/events.ts";
import { eventsJson } from "../../src/lib/events-json.ts";
import { offers } from "../../src/lib/offers.ts";
import { settingsAllowed } from "../../src/core/settings-guard.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
let NOW = new Date("2026-11-16T17:42:00Z"); /* Monday 19:42 in Sofia */
const mk = (clock = "19:42") => createCore({ repo: new MemoryRepo(), hasher, now: () => NOW, clock, smsDemo: true });
const PW = "a-long-password-1";
const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
async function people(core: ReturnType<typeof mk>) {
  const s = {} as Record<RoleId, StaffCtx>, tok = {} as Record<RoleId, string>;
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r, role: r, password: PW });
  for (const r of ROLES) { tok[r] = (await core.staff.login(r, PW, "1.1.1." + r)).token; s[r] = (await core.staff.bySession(tok[r]))!; }
  return { s, tok };
}
const dish = items.find((x) => x.cat === "pitsi" && !x.t.includes("out"))!;
const cart = (mode: "delivery" | "pickup" = "delivery", q = 2) => ({ mode, lines: [{ key: dish.id, id: dish.id, q, mods: [], extra: 0 }] });
const web = (core: ReturnType<typeof mk>, extra: Record<string, unknown> = {}) =>
  core.orders.create({ cart: cart(), addr: "ж.к. Дружба 2, бл. 311", name: "Иван", phone: "0888123456", pay: "cash", ...extra } as never);
/** which roles pass a call (the rest must get 403 "forbidden") */
async function allowed(s: Record<RoleId, StaffCtx>, fn: (x: StaffCtx) => Promise<unknown>): Promise<RoleId[]> {
  const ok: RoleId[] = [];
  for (const r of ROLES) {
    try { await fn(s[r]); ok.push(r); }
    catch (e) { const c = (e as { code?: string; status?: number }); if (c.code === "forbidden" && c.status === 403) continue; ok.push(r); }
  }
  return ok;
}

describe("rights in the core: every section, every role (direct calls, no screen)", () => {
  it("each section allows exactly the roles of the default matrix; phone orders and blocking only the bosses", async () => {
    const core = mk(); const { s } = await people(core);
    const o = await web(core);
    const BOSS: RoleId[] = ["admin", "owner", "manager"];
    expect(await allowed(s, (x) => core.ordersAdmin.list(x))).toEqual(["admin", "owner", "manager", "waiter"]);
    expect(await allowed(s, (x) => core.ordersAdmin.phone(x, o.no))).toEqual(["admin", "owner", "manager", "waiter"]);
    expect(await allowed(s, (x) => core.ordersAdmin.phoneOrder(x, { phone: "0888", name: "", mode: "pickup", lines: [] }))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.resAdmin.day(x))).toEqual(["admin", "owner", "manager", "waiter"]);
    expect(await allowed(s, (x) => core.resAdmin.addBlock(x, { phone: "0888999888" }))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.hall.get(x))).toEqual(["admin", "owner", "manager", "waiter"]);
    expect(await allowed(s, (x) => core.hall.save(x, {}))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.hall.qr(x))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.zones.list(x))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.zones.save(x, "druzhba-2", {}))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.offersAdmin.list(x))).toEqual([...BOSS, "marketing"]);
    expect(await allowed(s, (x) => core.offersAdmin.createVouchers(x, { kind: "pct", value: 10, n: 1 }))).toEqual([...BOSS, "marketing"]);
    expect(await allowed(s, (x) => core.eventsAdmin.list(x))).toEqual([...BOSS, "marketing"]);
    expect(await allowed(s, (x) => core.customersAdmin.list(x))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.customersAdmin.feedback(x, "inquiries"))).toEqual([...BOSS, "marketing"]);
    expect(await allowed(s, (x) => core.reports.get(x))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.staffAdmin.list(x))).toEqual(BOSS);
    expect(await allowed(s, (x) => core.site.state(x))).toEqual([...BOSS, "marketing"]);
    /* without a session: 401 */
    await expect(core.zones.list(null as never)).rejects.toMatchObject({ code: "auth", status: 401 });
  });
  it("a section given in 'Роли и права' opens the core function; taken away closes it", async () => {
    const core = mk(); const { s, tok } = await people(core);
    await expect(core.zones.list(s.marketing)).rejects.toMatchObject({ status: 403 });
    await core.staff.setRole("marketing", ["dashboard", "zones"], "admin");
    expect((await core.zones.list((await core.staff.bySession(tok.marketing))!)).zones).toHaveLength(6);
    await core.staff.setRole("manager", ["dashboard", "orders"], "admin");
    await expect(core.zones.list((await core.staff.bySession(tok.manager))!)).rejects.toMatchObject({ status: 403 });
  });
});

describe("zones: settings in the core, the order reads them", () => {
  it("validation, the log, 409 for an old version; the summary", async () => {
    const core = mk(); const { s } = await people(core);
    const v = await core.zones.list(s.manager);
    expect(v.summary).toMatchObject({ free: 4, paid: 2, feeMissing: 2, minMissing: 6, eta: [25, 45], until: "21:00" });
    await expect(core.zones.save(s.manager, "gorublyane", { fee: "-1" })).rejects.toMatchObject({ code: "invalid", fields: { fee: expect.any(String) } });
    await expect(core.zones.save(s.manager, "gorublyane", { to: "21:30" })).rejects.toMatchObject({ fields: { to: expect.stringContaining("21:00") } });
    await expect(core.zones.save(s.manager, "gorublyane", { etaMin: 5 })).rejects.toMatchObject({ fields: { etaMin: expect.any(String) } });
    await expect(core.zones.save(s.manager, "nowhere", {})).rejects.toMatchObject({ code: "not_found" });
    const a = await core.zones.save(s.manager, "gorublyane", { fee: "2,50", min: 15, etaMin: 50 }, 0);
    expect(a.zones.find((z) => z.slug === "gorublyane")).toMatchObject({ fee: 2.5, min: 15, etaMin: 50 });
    await expect(core.zones.save(s.manager, "gorublyane", { fee: 3 }, 0)).rejects.toMatchObject({ code: "conflict", status: 409, version: 1 });
    expect((await core.audit.list()).find((x) => x.action === "zones.update")!.data).toMatchObject({ n: "Горубляне", changes: expect.arrayContaining([expect.objectContaining({ key: "fee", to: "2,50 €" })]) });
    /* the public list follows at once; the site's built-in array stays (the server rebuilds the site) */
    expect((await core.zones.public()).find((z) => z.slug === "gorublyane")).toMatchObject({ fee: 2.5, min: 15, etaMin: 50, eta: "около 50 мин" });
    expect(ZONES.find((z) => z.slug === "gorublyane")!.fee).toBeNull();
  });
  it("the order: the fee and minutes from the admin; off, the minimum and the hours refuse with a clear text", async () => {
    const core = mk(); const { s } = await people(core);
    await core.zones.save(s.admin, "gorublyane", { fee: 3, etaMin: 50 });
    const o = await web(core, { addr: "кв. Горубляне, ул. Самоковско шосе 1" });
    expect(o).toMatchObject({ zone: "Горубляне", fee: 3, eta: 50 });
    expect(o.total).toBeCloseTo(o.sub + 3, 2);
    await core.zones.save(s.admin, "druzhba-2", { min: 500 });
    await expect(web(core)).rejects.toMatchObject({ code: "invalid", fields: { addr: "Минималната поръчка за доставка до Дружба 2 е 500,00 €." } });
    await core.zones.save(s.admin, "druzhba-2", { min: null, on: false });
    await expect(web(core)).rejects.toMatchObject({ fields: { addr: "Временно не доставяме до Дружба 2. Изберете „Вземи от място“." } });
    await core.zones.save(s.admin, "druzhba-2", { on: true, to: "19:00" });
    await expect(web(core)).rejects.toMatchObject({ code: "delivery_closed", status: 409, message: expect.stringContaining("от 10:00 до 19:00") });
    /* a pickup is not touched */
    expect((await core.orders.create({ cart: cart("pickup"), name: "Иван", phone: "0888123456" } as never)).mode).toBe("pickup");
  });
});

describe("the hall and QR", () => {
  it("the plan: new tables, a removed one stays as off, joined tables, the garden; the log", async () => {
    const core = mk(); const { s } = await people(core);
    const h = await core.hall.get(s.manager);
    expect(h.tables).toHaveLength(TABLES.length);
    expect(h.capacity).toBeNull();
    const tables = h.tables.filter((t) => t.id !== "S12").map((t) => (t.id === "S6" ? { ...t, seats: 8 } : t));
    tables.push({ id: "new-1", zone: "salon", seats: 4 } as never);
    const v = await core.hall.save(s.manager, { tables, merges: [["S1", "S2"]], gardenOpen: false }, h.version);
    const s6 = v.tables.find((t) => t.id === "S6")!;
    expect(s6).toMatchObject({ seats: 8, shape: "rect" });
    expect(v.tables.find((t) => t.id === "S12")).toMatchObject({ off: true });
    const nt = v.tables.find((t) => t.id === "S13")!;
    expect(nt).toMatchObject({ zone: "salon", seats: 4, shape: "square", n: 21, walkin: true, off: false });
    expect(v.merges).toEqual([["S1", "S2"]]);
    expect(v.gardenOpen).toBe(false);
    const log = (await core.audit.list()).find((x) => x.action === "hall.update")!.data as Record<string, unknown>;
    expect(log).toMatchObject({ added: ["S13"], removed: ["S12"], gardenOpen: false });
    await expect(core.hall.save(s.manager, { tables: v.tables, merges: [["S1", "G1"]] })).rejects.toMatchObject({ fields: { merges: expect.any(String) } });
    await expect(core.hall.save(s.manager, { tables: [{ ...v.tables[0], seats: 20 }] })).rejects.toMatchObject({ fields: { "tables.0.seats": "Местата са от 1 до 12." } });
    await expect(core.hall.save(s.manager, {}, 0)).rejects.toMatchObject({ code: "conflict" });
    /* the reservations read the live hall: a joined pair holds both and takes their seats; the closed garden and S12 are taken */
    const date = "2026-11-20";
    const taken0 = await core.reservations.taken(date, "19:00");
    expect(taken0).toEqual(expect.arrayContaining(["S12", "G1", "G8"]));
    await expect(core.reservations.create({ date, time: "19:00", people: 2, table: "G1", name: "А", phone: "0888111222" })).rejects.toMatchObject({ fields: { table: "Градината е затворена. Изберете маса в салона." } });
    await expect(core.reservations.create({ date, time: "19:00", people: 2, table: "S12", name: "А", phone: "0888111222" })).rejects.toMatchObject({ fields: { table: "Няма такава маса." } });
    const r = await core.reservations.create({ date, time: "19:00", people: 4, table: "S1", name: "А", phone: "0888111222" });
    expect(r.table).toBe("S1");
    expect(await core.reservations.taken(date, "19:30")).toEqual(expect.arrayContaining(["S1", "S2"]));
  });
  it("QR: one stable random code per table, a new code stops the old one, the public lookup", async () => {
    const core = mk(); const { s } = await people(core);
    const a = await core.hall.qr(s.manager), b = await core.hall.qr(s.admin);
    expect(a).toHaveLength(TABLES.length);
    expect(a.map((x) => x.code)).toEqual(b.map((x) => x.code));
    expect(new Set(a.map((x) => x.code)).size).toBe(a.length);
    expect(a[0].code).toMatch(/^[a-km-np-z2-9]{8}$/);
    expect(a[0].url).toBe("/masa/" + a[0].code + "/");
    expect(await core.hall.byQr(a[0].code)).toMatchObject({ id: a[0].id, n: a[0].n });
    const n = await core.hall.qrRenew(s.manager, a[0].id);
    expect(n.code).not.toBe(a[0].code);
    await expect(core.hall.byQr(a[0].code)).rejects.toMatchObject({ code: "not_found", message: "Този код вече не работи. Попитайте сервитьора за новия." });
    expect((await core.audit.list()).some((x) => x.action === "qr.renew" && JSON.stringify(x.data).indexOf(n.code) < 0)).toBe(true);
  });
});

describe("reservations in the admin", () => {
  it("the day: phones masked, the numbers, people by hour; 'Покажи' into the log", async () => {
    const core = mk(); const { s } = await people(core);
    await core.reservations.create({ date: "2026-11-16", time: "20:00", people: 4, table: "S3", name: "Мария", phone: "0888123456" });
    await core.reservations.create({ date: "2026-11-16", time: "21:00", people: 2, name: "Петър", phone: "0899000111", waitlist: true });
    const d = await core.resAdmin.day(s.waiter);
    expect(d.rows.map((r) => r.phone)).toEqual(["0888 •• •• 56", "0899 •• •• 11"]);
    expect(JSON.stringify(d)).not.toContain("0888123456");
    expect(d.stats).toMatchObject({ bookings: 1, people: 4, toConfirm: 1, waitlist: 1 });
    expect(d.byHour.find((h) => h.time === "21:00")!.people).toBe(4);
    expect(d.rows[0]).toMatchObject({ tableN: 3, statusLabel: "Нова", canArrive: true }); /* 20:00 at 19:42: within 30 min */
    expect(d.rows[1].canArrive).toBe(false);
    expect((await core.resAdmin.phone(s.waiter, d.rows[0].id)).phone).toBe("0888123456");
    expect((await core.audit.list()).find((x) => x.action === "reservation.phone_view")).toMatchObject({ actor: "waiter", target: d.rows[0].id });
    expect((await core.resAdmin.month(s.waiter, "2026-11")).days["2026-11-16"]).toEqual({ bookings: 1, toConfirm: 1 });
  });
  it("statuses: 'Дошли' / 'Неявили се' from 30 min before; 'Отмени' takes a no-show back; blocking after the limit", async () => {
    const core = mk("19:42"); const { s } = await people(core);
    const later = await core.reservations.create({ date: "2026-11-16", time: "21:00", people: 2, name: "Иво", phone: "0888555666" });
    await expect(core.resAdmin.setStatus(s.manager, later.id, "seated")).rejects.toMatchObject({ code: "too_early", status: 409 });
    expect((await core.resAdmin.setStatus(s.manager, later.id, "confirmed")).statusLabel).toBe("Потвърдена");
    const soon = createCore({ ...core.ctx, clock: "20:40" });
    expect((await soon.resAdmin.setStatus(s.manager, later.id, "no_show")).status).toBe("no_show");
    const back = await soon.resAdmin.setStatus(s.manager, later.id, "confirmed");
    expect(back.status).toBe("confirmed");
    expect((await core.resAdmin.blocks(s.manager)).rows).toHaveLength(0); /* the no-show was taken back */
    /* noShowLimit = 1: one no-show waits for a decision; only the bosses decide; a blocked number does not book online */
    await core.settings.update({ noShowLimit: 1 }, "admin");
    await soon.resAdmin.setStatus(s.manager, later.id, "no_show");
    const bl = await core.resAdmin.blocks(s.waiter);
    expect(bl).toMatchObject({ canDecide: false, limit: 1, rows: [{ status: "pending", phone: "0888 •• •• 66", count: 1 }] });
    expect(JSON.stringify(bl)).not.toContain("0888555666");
    await expect(core.resAdmin.decide(s.waiter, bl.rows[0].ref, "block")).rejects.toMatchObject({ status: 403 });
    expect((await core.resAdmin.decide(s.manager, bl.rows[0].ref, "block")).status).toBe("blocked");
    await expect(core.reservations.create({ date: "2026-11-18", time: "19:00", people: 2, name: "Иво", phone: "0888555666" })).rejects.toMatchObject({ code: "blocked", status: 403 });
    await expect(core.resAdmin.create(s.manager, { date: "2026-11-18", time: "19:00", people: 2, name: "Иво", phone: "0888555666" })).rejects.toMatchObject({ message: "Този номер е блокиран за резервации (неявили се). Отблокира го управителят." });
    expect((await core.resAdmin.decide(s.owner, bl.rows[0].ref, "clear")).status).toBe("cleared");
    expect((await core.reservations.create({ date: "2026-11-18", time: "19:00", people: 2, name: "Иво", phone: "0888555666" })).status).toBe("new");
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["block.block", "block.unblock"]));
    /* a number added by hand */
    expect((await core.resAdmin.addBlock(s.admin, { phone: "0877 11 22 33", name: "Х" })).status).toBe("blocked");
    await expect(core.resAdmin.addBlock(s.admin, { phone: "12" })).rejects.toMatchObject({ code: "invalid" });
  });
  it("'Нова резервация' from the staff: confirmed, never marketing, the same rules; 'Смени маса' / 'Дай маса' only to a free table", async () => {
    const core = mk(); const { s } = await people(core);
    const r = await core.resAdmin.create(s.waiter, { date: "2026-11-17", time: "19:00", people: 2, table: "S1", name: "Гост", phone: "0888777666", marketing: true });
    expect(r).toMatchObject({ status: "confirmed", by: "waiter", table: "S1" });
    const raw = (await core.reservations.list()).find((x) => x.id === r.id)!;
    expect(raw.marketing).toBe(false);
    await expect(core.resAdmin.create(s.waiter, { date: "2026-11-17", time: "19:30", people: 2, table: "S1", name: "Друг", phone: "0888777665" })).rejects.toMatchObject({ code: "taken" });
    await expect(core.resAdmin.create(s.waiter, { date: "2026-11-17", time: "23:00", people: 2, name: "Друг", phone: "0888777665" })).rejects.toMatchObject({ fields: { time: expect.any(String) } });
    const w = await core.resAdmin.create(s.waiter, { date: "2026-11-17", time: "19:00", people: 2, name: "Чака", phone: "0888777664", waitlist: true });
    expect(w.status).toBe("waitlist");
    await expect(core.resAdmin.setTable(s.waiter, w.id, "S1")).rejects.toMatchObject({ code: "taken", status: 409 });
    const free = await core.resAdmin.free(s.waiter, "2026-11-17", "19:00", 2);
    expect(free.some((t) => t.id === "S1")).toBe(false);
    const g = await core.resAdmin.setTable(s.waiter, w.id, free[0].id);
    expect(g).toMatchObject({ status: "confirmed", table: free[0].id, prevStatus: "waitlist" });
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["reservation.create", "reservation.table"]));
  });
});

describe("orders in the admin", () => {
  it("the list (masked, filters, late), the detail, 'Покажи телефона' into the log, 'Откажи' with a reason the customer sees", async () => {
    const core = mk(); const { s } = await people(core);
    const a = await web(core), b = await core.orders.create({ cart: cart("pickup"), name: "Мария", phone: "0899111222" } as never);
    const l = await core.ordersAdmin.list(s.waiter, { status: "work" });
    expect(l.rows.map((r) => r.no)).toEqual([b.no, a.no]);
    expect(l.rows[1]).toMatchObject({ phone: "0888 •• •• 56", channelLabel: "Сайт", statusLabel: "Приета", next: "cooking", late: false });
    expect(JSON.stringify(l)).not.toContain("0888123456");
    expect((await core.ordersAdmin.list(s.waiter, { q: "3456" })).rows.map((r) => r.no)).toEqual([a.no]);
    expect((await core.ordersAdmin.list(s.waiter, { day: "2026-11-15" })).rows).toHaveLength(0);
    const late = createCore({ ...core.ctx, clock: "21:00" });
    expect((await late.ordersAdmin.list(s.waiter)).rows.find((r) => r.no === b.no)!.late).toBe(true);
    const d = await core.ordersAdmin.get(s.manager, a.no);
    expect(d).toMatchObject({ addr: "ж.к. Дружба 2, бл. 311", phone: "0888 •• •• 56", steps: [{ status: "accepted", label: "Приета" }, { status: "cooking", at: null }, expect.anything(), expect.anything(), expect.anything()] });
    expect((await core.ordersAdmin.phone(s.manager, a.no)).phone).toBe("0888123456");
    expect((await core.audit.list()).find((x) => x.action === "order.phone_view")).toMatchObject({ actor: "manager", target: a.no });
    await expect(core.ordersAdmin.cancel(s.manager, a.no, " ")).rejects.toMatchObject({ code: "invalid", fields: { reason: expect.any(String) } });
    await expect(core.ordersAdmin.step(s.manager, a.no, "cancelled")).rejects.toMatchObject({ code: "reason_required" });
    const c = await core.ordersAdmin.cancel(s.manager, a.no, "Изчерпано ястие");
    expect(c).toMatchObject({ status: "cancelled", reason: "Изчерпано ястие" });
    expect(publicOrder((await core.orders.get(a.no))!).reason).toBe("Изчерпано ястие");
    /* "Отмени": back to the status before, the reason goes */
    const back = await core.ordersAdmin.step(s.manager, a.no, "accepted") as Order;
    expect(back.status).toBe("accepted");
    expect((await core.orders.get(a.no))!.reason).toBeUndefined();
    /* the kitchen: its own steps, not the list */
    expect(await core.ordersAdmin.step(s.kitchen, b.no, "cooking")).toEqual({ no: b.no, status: "cooking" });
    await expect(core.ordersAdmin.step(s.kitchen, b.no, "picked_up")).rejects.toMatchObject({ code: "bad_step" });
  });
  it("'Нова поръчка по телефон': the core's price and rules, channel phone, no marketing, no bonus, the log", async () => {
    const core = mk(); const { s } = await people(core);
    const o = await core.ordersAdmin.phoneOrder(s.manager, { phone: "0888 12 34 99", name: "Обаждане", mode: "delivery", addr: "Дружба 2, бл. 402", lines: [{ id: dish.id, q: 1, p: 0.01 } as never], pay: "card" });
    expect(o).toMatchObject({ channel: "phone", channelLabel: "Телефон", by: "manager", payLabel: "Карта при получаване", sub: dish.p });
    const raw = (await core.orders.get(o.no))!;
    expect(raw).toMatchObject({ marketing: false, userId: null, channel: "phone", by: "manager" });
    expect((await core.audit.list()).find((x) => x.action === "order.create")).toMatchObject({ actor: "manager", target: o.no });
    /* a later time today: every 15 min, after the zone's minutes, until 20:45 */
    const later = await core.ordersAdmin.phoneOrder(s.owner, { phone: "0888123499", name: "Х", mode: "delivery", addr: "Дружба 2, бл. 402", slot: "20:30", lines: [{ id: dish.id, q: 1 }] });
    expect(later).toMatchObject({ at: "20:30" });
    await expect(core.ordersAdmin.phoneOrder(s.owner, { phone: "0888123499", name: "Х", mode: "delivery", addr: "Дружба 2, бл. 402", slot: "20:00", lines: [{ id: dish.id, q: 1 }] })).rejects.toMatchObject({ fields: { slot: expect.any(String) } });
    await expect(core.ordersAdmin.phoneOrder(s.owner, { phone: "0888123499", name: "Х", mode: "delivery", addr: "Дружба 2", lines: [{ id: dish.id, q: 1 }] })).rejects.toMatchObject({ fields: { addr: expect.stringContaining("улица или блок") } });
    const night = createCore({ ...core.ctx, clock: "21:30" });
    await expect(night.ordersAdmin.phoneOrder(s.owner, { phone: "0888123499", name: "Х", mode: "delivery", addr: "Дружба 2, бл. 402", lines: [{ id: dish.id, q: 1 }] })).rejects.toMatchObject({ code: "delivery_closed" });
    await expect(core.ordersAdmin.phoneOrder(s.waiter, { phone: "0888123499", name: "Х", mode: "pickup", lines: [{ id: dish.id, q: 1 }] })).rejects.toMatchObject({ status: 403 });
  });
});

describe("offers and vouchers", () => {
  it("the switch: -30% locked, -5% needs the days, the loyalty card its rule; a Google review is never an offer", async () => {
    const core = mk(); const { s } = await people(core);
    const v = await core.offersAdmin.list(s.marketing);
    expect(v.offers.map((o) => o.id)).toEqual(["lunch30", "signup", "rating", "birthday", "celebration", "loyalty", "voucher"]);
    expect(v.offers.find((o) => o.id === "celebration")!.blocked).toContain("[ЛИПСВА: колко дни]");
    await expect(core.offersAdmin.toggle(s.marketing, "lunch30", false)).rejects.toMatchObject({ code: "locked", status: 409 });
    await expect(core.offersAdmin.toggle(s.marketing, "celebration", true)).rejects.toMatchObject({ code: "missing" });
    await expect(core.offersAdmin.toggle(s.marketing, "loyalty", true)).rejects.toMatchObject({ code: "missing" });
    await core.settings.update({ earlyDays: 14 }, "owner");
    expect((await core.offersAdmin.toggle(s.marketing, "celebration", true)).offers.find((o) => o.id === "celebration")!.on).toBe(true);
    await expect(core.offersAdmin.create(s.marketing, { title: "-15% за отзив в Google", pct: 15, r: v.offers[1].r })).rejects.toMatchObject({ fields: { title: expect.stringContaining("Google") } });
    await expect(core.offersAdmin.save(s.marketing, "birthday", { text: "Оставете review и вземете торта" })).rejects.toMatchObject({ fields: { title: expect.stringContaining("Google") } });
    await expect(core.offersAdmin.save(s.marketing, "birthday", { r: { days: [], from: "12:00", to: "11:00", ch: [], dish: ["nope"] } })).rejects.toMatchObject({ fields: { "r.days": expect.any(String), "r.from": expect.any(String), "r.ch": expect.any(String), "r.dish": expect.any(String) } });
    const c = await core.offersAdmin.create(s.marketing, { title: "Вторник с паста", pct: 15, r: { days: [2], from: "12:00", to: "16:00", ch: ["pickup"], dish: "all" } });
    expect(c.offers.find((o) => o.id === c.id)).toMatchObject({ custom: true, on: false, pct: 15, sub: "-15%" });
    const rm = await core.offersAdmin.remove(s.marketing, c.id);
    expect(rm.offers.some((o) => o.id === c.id)).toBe(false);
    expect((await core.offersAdmin.restore(s.marketing, rm.removed)).offers.some((o) => o.id === c.id)).toBe(true);
    await expect(core.offersAdmin.remove(s.marketing, "signup")).rejects.toMatchObject({ status: 403 });
    /* off: the banner hides it at once (/api/offers), the built-in site list changes only at the rebuild */
    await core.offersAdmin.toggle(s.marketing, "birthday", false);
    expect((await core.offersAdmin.public()).some((o) => o.id === "birthday")).toBe(false);
    expect(offers().some((o) => o.id === "birthday")).toBe(true);
    expect((await core.site.build()).offersOff).toEqual(["birthday"]);
  });
  it("the rules are applied to the rating code and the profile bonus (on / off, the channel)", async () => {
    const core = mk(); const { s } = await people(core);
    const o = await web(core);
    await core.orders.setStatus(o.no, "delivered", "system");
    const { code } = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: true });
    await core.offersAdmin.toggle(s.marketing, "rating", false);
    await expect(web(core, { code })).rejects.toMatchObject({ fields: { code: "Тази отстъпка е изключена в момента." } });
    await core.offersAdmin.toggle(s.marketing, "rating", true);
    const r0 = (await core.offersAdmin.list(s.marketing)).offers.find((x) => x.id === "rating")!.r;
    await core.offersAdmin.save(s.marketing, "rating", { r: { ...r0, ch: ["pickup"] } });
    await expect(web(core, { code })).rejects.toMatchObject({ fields: { code: "Кодът не важи за тази поръчка (ден, час, канал или ястия)." } });
    expect((await core.orders.create({ cart: cart("pickup"), name: "Иван", phone: "0888123456", code } as never)).discKind).toBe("code");
  });
  it("codes: SC10- and SCV- check, 'Нови кодове', 'Използван' once; the log has no codes of the batch", async () => {
    const core = mk(); const { s } = await people(core);
    const vs = await core.offersAdmin.createVouchers(s.owner, { kind: "sum", value: "25,00", n: 3, note: "Коледа" });
    expect(vs).toHaveLength(3);
    expect(vs[0]).toMatchObject({ kind: "sum", sum: 25, pct: null, usedBy: null });
    expect(vs[0].code).toMatch(/^SCV-\d{10}$/);
    await expect(core.offersAdmin.createVouchers(s.owner, { kind: "pct", value: 80, n: 51 })).rejects.toMatchObject({ fields: { value: expect.any(String), n: expect.any(String) } });
    const chk = await core.offersAdmin.checkCode(s.owner, vs[0].code.toLowerCase().replace("-", " "));
    expect(chk).toMatchObject({ kind: "voucher", status: "valid", sum: 25 });
    expect((await core.offersAdmin.checkCode(s.owner, "sc10 4829 163 057"))).toMatchObject({ code: "SC10-4829163057", kind: "rating", status: "unknown" });
    await expect(core.offersAdmin.useVoucher(s.kitchen, vs[0].code)).rejects.toMatchObject({ status: 403 });
    expect((await core.offersAdmin.useVoucher(s.waiter, vs[0].code)).usedBy).toBe("waiter"); /* at the till: "Поръчки" is enough */
    await expect(core.offersAdmin.useVoucher(s.manager, vs[0].code)).rejects.toMatchObject({ code: "used", status: 409 });
    expect((await core.offersAdmin.checkCode(s.owner, vs[0].code)).status).toBe("used");
    const log = (await core.audit.list()).find((x) => x.action === "code.create")!;
    expect(JSON.stringify(log)).not.toContain(vs[1].code);
  });
});

describe("events", () => {
  it("the built-in Greek night is the published row; /api/events = eventsJson with the same data", async () => {
    const core = mk(); const { s } = await people(core);
    const pub = await core.eventsAdmin.public();
    const lib = eventsJson(NOW);
    expect(pub.map(({ prog: _p, menu: _m, ...e }) => e)).toEqual(lib);
    const l = await core.eventsAdmin.list(s.marketing);
    expect(l.rows[0]).toMatchObject({ id: "gratska-vecher", recur: "last-sat", status: "published", note: "[ЛИПСВА: програма, меню и цена]", url: "/sabitia/gratska-vecher/" });
  });
  it("CRUD: validation, the address once, draft / publish, delete with 'Отмени', 301 for a gone address", async () => {
    const core = mk(); const { s } = await people(core);
    await expect(core.eventsAdmin.create(s.marketing, { n: "Х", cat: "Нещо", date: "2026-11-01", time: "25:00", priceMode: "price", price: "abc" as never })).rejects.toMatchObject({
      fields: { n: expect.any(String), cat: expect.any(String), date: expect.any(String), time: expect.any(String), price: expect.any(String) } });
    const e = await core.eventsAdmin.create(s.marketing, { n: "Италианска вечер", cat: "Тематични вечери", date: "2026-12-12", time: "19:30", priceMode: "free", seats: 40, publish: true });
    expect(e).toMatchObject({ id: "italianska-vecher", status: "published", phase: "upcoming", days: 26, note: "[ЛИПСВА: програма и меню]" });
    const u = await core.eventsAdmin.update(s.marketing, e.id, { n: "Италианска вечер с вино", prog: "Музика", menu: "Паста" }, e.version);
    expect(u).toMatchObject({ id: "italianska-vecher", n: "Италианска вечер с вино", note: "" });
    await expect(core.eventsAdmin.update(s.marketing, e.id, { n: "Друго" }, e.version)).rejects.toMatchObject({ code: "conflict" });
    await expect(core.eventsAdmin.update(s.marketing, "gratska-vecher", { date: "2026-12-05" })).rejects.toMatchObject({ fields: { date: expect.any(String) } });
    const d = await core.eventsAdmin.create(s.marketing, { n: "Италианска вечер", cat: "Тематични вечери", date: "2026-12-19", time: "19:30" });
    expect(d).toMatchObject({ id: "italianska-vecher-2", status: "draft" });
    let b = await core.site.build();
    expect(b.events.map((x) => x.id)).toEqual(["gratska-vecher", "italianska-vecher"]);
    expect(b.eventExtra["italianska-vecher"]).toEqual({ prog: "Музика", menu: "Паста" });
    const rm = await core.eventsAdmin.remove(s.marketing, e.id);
    b = await core.site.build();
    expect(b.redirects).toEqual({ "/sabitia/italianska-vecher/": "/sabitia/" });
    expect((await core.eventsAdmin.restore(s.marketing, rm.removed)).id).toBe("italianska-vecher");
    expect((await core.site.build()).redirects).toEqual({});
    await core.eventsAdmin.publish(s.marketing, "italianska-vecher", false);
    expect((await core.site.build()).redirects).toEqual({ "/sabitia/italianska-vecher/": "/sabitia/" });
    expect((await core.audit.list(100)).map((x) => x.action)).toEqual(expect.arrayContaining(["event.create", "event.update", "event.delete", "event.restore", "event.unpublish"]));
    /* the monthly evening is part of the shared runtime: it stays, short */
    await expect(core.eventsAdmin.remove(s.marketing, "gratska-vecher")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("не се изтрива") });
    await expect(core.eventsAdmin.publish(s.marketing, "gratska-vecher", false)).rejects.toMatchObject({ status: 409 });
    await expect(core.eventsAdmin.update(s.marketing, "gratska-vecher", { text: "д".repeat(91) })).rejects.toMatchObject({ fields: { text: expect.stringContaining("90") } });
    expect((await core.eventsAdmin.update(s.marketing, "gratska-vecher", { priceMode: "price", price: "30" })).note).toBe("[ЛИПСВА: програма и меню]");
  });
});

describe("the site build of a fresh database is the built-in site", () => {
  it("zones, tables, events, offers: nothing changed", async () => {
    const core = mk();
    const b = await core.site.build();
    expect(b.zones).toEqual(ZONES);
    expect(b.tables).toEqual(TABLES);
    expect(b.offersOff).toEqual([]);
    expect(b.redirects).toEqual({});
    const ev = events(NOW)[0];
    expect(b.events).toEqual([{ id: ev.id, n: ev.n, cat: ev.cat, date: null, recur: "last-sat", time: ev.time, price: ev.price, free: ev.free, seatsLeft: ev.seatsLeft, text: ev.text, note: ev.note }]);
    expect(await core.site.version()).toBe(0);
  });
  it("a change tells the server (onSite) with the new data", async () => {
    const seen: unknown[] = [];
    const core = createCore({ repo: new MemoryRepo(), hasher, now: () => NOW, clock: "19:42", onSite: (s) => seen.push(s) });
    await core.staff.upsert({ username: "a", name: "a", role: "admin", password: PW });
    const s = (await core.staff.bySession((await core.staff.login("a", PW)).token))!;
    await core.zones.save(s, "druzhba-1", { etaMin: 33 });
    expect(seen).toHaveLength(1);
    expect((seen[0] as { zones: { slug: string; etaMin: number; eta: string }[] }).zones[0]).toMatchObject({ slug: "druzhba-1", etaMin: 33, eta: "около 33 мин" });
  });
});

describe("customers (GDPR) and messages", () => {
  async function withCustomer(core: ReturnType<typeof mk>) {
    const { demoCode } = await core.customers.requestCode("0888123456");
    const { customer } = await core.customers.verifyCode("0888123456", demoCode!, { name: "Иван", marketing: false });
    await web(core);
    await core.reservations.create({ date: "2026-11-20", time: "19:00", people: 2, name: "Иван", phone: "0888123456" });
    return customer;
  }
  it("the list and the profile masked; 'Покажи' and 'Изтегли данните' into the log", async () => {
    const core = mk(); const { s } = await people(core); const c = await withCustomer(core);
    const l = await core.customersAdmin.list(s.manager);
    expect(l.rows[0]).toMatchObject({ id: c.id, phone: "0888 •• •• 56", orders: 1, consent: { marketing: false } });
    expect(JSON.stringify(l)).not.toContain("0888123456");
    expect((await core.customersAdmin.list(s.manager, { filter: "offers" })).rows).toHaveLength(0);
    const d = await core.customersAdmin.get(s.manager, c.id);
    expect(d).toMatchObject({ reservations: 1, noShows: 0, profileBonus: "unused", stamps: null, lastOrders: [expect.objectContaining({ lines: [{ name: dish.n, q: 2 }] })] });
    expect((await core.customersAdmin.contact(s.manager, c.id)).phone).toBe("0888123456");
    const ex = await core.customersAdmin.export(s.manager, c.id) as { profile: { id: string }; orders: unknown[] };
    expect(ex.profile.id).toBe(c.id);
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["customer.phone_view", "customer.export"]));
  });
  it("'Изтрий' waits for the window: 'Отмени' keeps the profile; after it the profile goes and the orders lose the personal data", async () => {
    const core = mk(); const { s } = await people(core); const c = await withCustomer(core);
    const r = await core.customersAdmin.remove(s.manager, c.id);
    expect(r.until).toBe(NOW.getTime() + 10_000);
    expect(await core.customersAdmin.purge()).toBe(0);
    expect((await core.customersAdmin.restore(s.manager, c.id)).ok).toBe(true);
    await core.customersAdmin.remove(s.manager, c.id);
    const t0 = NOW;
    NOW = new Date(t0.getTime() + 11_000);
    expect(await core.customersAdmin.purge()).toBe(1);
    await expect(core.customersAdmin.restore(s.manager, c.id)).rejects.toMatchObject({ code: "gone", status: 410 });
    const o = (await core.orders.list())[0];
    expect(o).toMatchObject({ name: "Изтрит клиент", phone: "", addr: "Дружба 2" });
    expect((await core.reservations.list())[0]).toMatchObject({ name: "Изтрит клиент", phone: "" });
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["customer.delete_request", "customer.restore", "customer.delete"]));
    NOW = t0;
  });
  it("messages and inquiries: masked, statuses, 'Покажи' into the log; inquiries also for 'Оферти'", async () => {
    const core = mk(); const { s } = await people(core);
    const a = await core.feedback.create({ name: "Иван", contact: "0888123456", message: "Ваучер за 50 €", topic: "voucher" });
    const b = await core.feedback.create({ name: "Мария", contact: "maria@primer.bg", message: "Имате ли паркинг?" });
    const iq = await core.customersAdmin.feedback(s.marketing, "inquiries");
    expect(iq).toMatchObject({ newN: 1, rows: [{ id: a.id, contact: "0888 •• •• 56", inquiry: true }] });
    await expect(core.customersAdmin.feedback(s.marketing, "feedback")).rejects.toMatchObject({ status: 403 });
    await expect(core.customersAdmin.feedbackStatus(s.marketing, b.id, "done")).rejects.toMatchObject({ status: 403 });
    expect((await core.customersAdmin.feedbackStatus(s.marketing, a.id, "called")).status).toBe("called");
    expect((await core.customersAdmin.feedback(s.manager)).rows[0].contact).toBe("m•••@primer.bg");
    expect((await core.customersAdmin.feedbackContact(s.manager, b.id)).contact).toBe("maria@primer.bg");
    expect((await core.audit.list()).find((x) => x.action === "customer.phone_view")!.target).toBe("feedback:" + b.id);
  });
});

describe("reports", () => {
  it("today: orders without the cancelled, turnover, average, channels, hours, top, reservations; no personal data", async () => {
    const core = mk(); const { s } = await people(core);
    const a = await web(core), b = await web(core, { phone: "0888123457" }), c = await web(core, { phone: "0888123458" });
    await core.orders.setStatus(c.no, "cancelled", "system");
    await core.reservations.create({ date: "2026-11-16", time: "20:00", people: 3, name: "Х", phone: "0899111222" });
    const r = await core.reports.get(s.owner);
    expect(r).toMatchObject({ period: "today", from: "2026-11-16", orders: 2, cancelled: 1, revenue: Math.round((a.total + b.total) * 100) / 100, reservations: 1, people: 3, cost: null, until: "19:42" });
    expect(r.avg).toBeCloseTo((a.total + b.total) / 2, 2);
    expect(r.byChannel.find((x) => x.channel === "web")).toMatchObject({ orders: 2, share: 100 });
    expect(r.byHour.find((h) => h.hour === 19)!.orders).toBe(2);
    expect(r.top[0]).toMatchObject({ id: dish.id, q: 4 });
    expect(r.prev).toMatchObject({ from: "2026-11-15", orders: 0 });
    expect(JSON.stringify(r)).not.toMatch(/0888|Иван|Дружба/);
    expect((await core.reports.get(s.owner, { period: "7" })).byDay).toHaveLength(7);
    await expect(core.reports.get(s.owner, { period: "custom", from: "2026-01-01", to: "2026-11-16" })).rejects.toMatchObject({ code: "invalid" });
    await expect(core.reports.get(s.owner, { period: "custom", from: "2026-11-10", to: "2026-11-20" })).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("staff", () => {
  it("who manages whom: the main admin all; the others only lower roles, never themselves, never the last main admin", async () => {
    const core = mk(); const { s, tok } = await people(core);
    const l = await core.staffAdmin.list(s.manager);
    expect(l.roles.filter((r) => r.manageable).map((r) => r.id)).toEqual(["waiter", "kitchen", "driver", "marketing"]);
    expect(JSON.stringify(l)).not.toMatch(/"hash"|"salt"/);
    const id = (r: RoleId) => l.rows.find((u) => u.role === r)!.id;
    await expect(core.staffAdmin.create(s.manager, { username: "boss2", name: "Б", role: "owner", password: PW })).rejects.toMatchObject({ status: 403 });
    await expect(core.staffAdmin.update(s.manager, id("owner"), { name: "X" })).rejects.toMatchObject({ status: 403 });
    await expect(core.staffAdmin.update(s.manager, id("waiter"), { role: "manager" })).rejects.toMatchObject({ status: 403 });
    await expect(core.staffAdmin.setActive(s.owner, id("owner"), false)).rejects.toMatchObject({ status: 403 });
    await expect(core.staffAdmin.setActive(s.admin, id("admin"), false)).rejects.toMatchObject({ status: 403 });
    await core.staffAdmin.create(s.admin, { username: "admin2", name: "Втори", role: "admin", password: PW });
    const a2 = (await core.staffAdmin.list(s.admin)).rows.find((u) => u.username === "admin2")!;
    expect((await core.staffAdmin.setActive(s.admin, a2.id, false)).active).toBe(false);
    await expect(core.staffAdmin.update(s.admin, id("admin"), { role: "owner" })).rejects.toMatchObject({ code: "forbidden" });
    /* the last active main admin cannot be demoted by another main admin */
    await core.staffAdmin.setActive(s.admin, a2.id, true);
    const t2 = (await core.staff.login("admin2", PW)).token, s2 = (await core.staff.bySession(t2))!;
    await core.staffAdmin.setActive(s2, id("admin"), false);
    await expect(core.staffAdmin.update(s.owner, a2.id, { role: "owner" })).rejects.toMatchObject({ status: 403 });
    await expect(core.staffAdmin.setActive(s.owner, a2.id, false)).rejects.toMatchObject({ status: 403 });
    /* deactivating closes the sessions */
    expect(await core.staff.bySession(tok.admin)).toBeNull();
    const w = await core.staffAdmin.setActive(s.manager, id("waiter"), false);
    expect(w.active).toBe(false);
    expect(await core.staff.bySession(tok.waiter)).toBeNull();
    await expect(core.staffAdmin.create(s.manager, { username: "Ив Ан", name: "", role: "waiter", password: "short" })).rejects.toMatchObject({ fields: { username: expect.any(String), name: expect.any(String), password: "Паролата трябва да е поне 10 знака." } });
    await expect(core.staffAdmin.create(s.manager, { username: "kitchen", name: "К", role: "kitchen", password: PW })).rejects.toMatchObject({ fields: { username: "Този потребител вече съществува." } });
    expect((await core.audit.list(200)).map((x) => x.action)).toEqual(expect.arrayContaining(["staff.create", "staff.active"]));
  });
  it("the password: one's own without the section, others by the rule; the log never has it", async () => {
    const core = mk(); const { s, tok } = await people(core);
    const l = await core.staffAdmin.list(s.admin), id = (r: RoleId) => l.rows.find((u) => u.role === r)!.id;
    expect((await core.staffAdmin.setPassword(s.kitchen, id("kitchen"), "new-password-123", tok.kitchen)).ok).toBe(true);
    expect(await core.staff.bySession(tok.kitchen)).not.toBeNull();
    await expect(core.staffAdmin.setPassword(s.kitchen, id("driver"), "new-password-123")).rejects.toMatchObject({ status: 403 });
    await core.staffAdmin.setPassword(s.manager, id("driver"), "new-password-456");
    expect(await core.staff.bySession(tok.driver)).toBeNull();
    expect((await core.staff.login("driver", "new-password-456")).user.username).toBe("driver");
    expect(JSON.stringify(await core.audit.list(200))).not.toMatch(/new-password/);
  });
  it("the PIN: only for the staff apps, hashed, random by default, 'Изберете друг ПИН.' for easy or taken, refused choices limited", async () => {
    const core = mk(); const { s } = await people(core);
    const l = await core.staffAdmin.list(s.manager), id = (r: RoleId) => l.rows.find((u) => u.role === r)!.id;
    await expect(core.staffAdmin.setPin(s.manager, id("marketing"))).rejects.toMatchObject({ fields: { pin: "ПИН имат само сервитьор, кухня и шофьор." } });
    const p1 = await core.staffAdmin.setPin(s.manager, id("waiter"), "4817");
    expect(p1.pin).toBe("4817");
    const raw = (await core.ctx.repo.list<{ id: string; username: string; pin?: { hash: string } }>("staff_users")).find((u) => u.username === "waiter")!;
    expect(raw.pin!.hash).toBe("h:4817");
    expect(JSON.stringify(await core.staffAdmin.list(s.manager))).not.toContain("4817");
    /* taken: the same words as an easy one, never "whose" */
    const e1 = await core.staffAdmin.setPin(s.manager, id("kitchen"), "4817").catch((e) => e);
    const e2 = await core.staffAdmin.setPin(s.manager, id("kitchen"), "1111").catch((e) => e);
    expect(e1).toMatchObject({ code: "invalid", message: "Изберете друг ПИН.", fields: { pin: "Изберете друг ПИН." } });
    expect(e2.message).toBe(e1.message);
    const r = await core.staffAdmin.setPin(s.manager, id("kitchen"));
    expect(r.pin).toMatch(/^\d{4}$/);
    expect(r.pin).not.toBe("4817");
    for (const p of ["1234", "0000", "9876"]) await core.staffAdmin.setPin(s.manager, id("driver"), p).catch(() => undefined);
    await expect(core.staffAdmin.setPin(s.manager, id("driver"), "4321")).rejects.toMatchObject({ code: "throttled", status: 429 });
    expect((await core.staffAdmin.setPin(s.manager, id("driver"))).pin).toMatch(/^\d{4}$/); /* the random one still works */
    const log = await core.audit.list(200);
    expect(log.filter((x) => x.action === "staff.pin")).toHaveLength(3);
    expect(JSON.stringify(log)).not.toMatch(/4817/);
    expect((await core.staffAdmin.removePin(s.manager, id("waiter"))).pin).toBe("none");
  });
});

describe("settings: the open questions that are settings", () => {
  it("noShowLimit, callCooldown, callManager, busyAt; who may change what", async () => {
    const core = mk(); const { s } = await people(core);
    const st = await core.settings.get();
    expect(st).toMatchObject({ noShowLimit: 2, callCooldown: 3, callManager: 5 });
    expect((await core.settings.view()).hours).toEqual({ open: "10:00", close: "23:00", kitchen: "22:30", delivery: "21:00", lunchUntil: "15:00", reservations: { from: "11:00", to: "21:30", step: 30, daysAhead: 92 } });
    await expect(core.settings.update({ noShowLimit: 9, callCooldown: 0 }, "admin")).rejects.toMatchObject({ fields: { noShowLimit: expect.any(String), callCooldown: expect.any(String) } });
    const a = await core.settings.update({ kitchen: { busy: true } }, "kitchen");
    expect(a.kitchen.busyAt).toBe(NOW.toISOString());
    expect((await core.settings.update({ kitchen: { busy: false } }, "kitchen")).kitchen.busyAt).toBeNull();
    expect(() => settingsAllowed(s.waiter, { noShowLimit: 3 })).toThrow();
    expect(() => settingsAllowed(s.marketing, { callCooldown: 3 })).toThrow();
    expect(() => settingsAllowed(s.manager, { noShowLimit: 3, callManager: 6 })).not.toThrow();
  });

describe("part 3, flows review round 1", () => {
  it("GDPR also clears an order made with another phone while signed in", async () => {
    const core = mk(); const { s } = await people(core);
    const { demoCode } = await core.customers.requestCode("0888123456");
    const { customer } = await core.customers.verifyCode("0888123456", demoCode!, { name: "Иван", marketing: false });
    await web(core, { phone: "0899555444", name: "Иван Другият", note: "звънец 3", userId: customer.id });
    expect((await core.customersAdmin.list(s.manager)).rows[0].orders).toBe(1);
    await core.customersAdmin.remove(s.manager, customer.id);
    const t0 = NOW; NOW = new Date(t0.getTime() + 11_000);
    await core.customersAdmin.purge();
    NOW = t0;
    expect((await core.orders.list())[0]).toMatchObject({ name: "Изтрит клиент", phone: "", userId: null });
  });
  it("a cancelled reservation does not come back on a table given to someone else meanwhile", async () => {
    const core = mk(); const { s } = await people(core);
    const a = await core.reservations.create({ date: "2026-11-20", time: "19:00", people: 2, table: "S1", name: "А", phone: "0888111222" });
    await core.resAdmin.setStatus(s.manager, a.id, "cancelled");
    await core.reservations.create({ date: "2026-11-20", time: "19:00", people: 2, table: "S1", name: "Б", phone: "0888333444" });
    await expect(core.resAdmin.setStatus(s.manager, a.id, "confirmed")).rejects.toMatchObject({ code: "taken", status: 409 });
  });
  it("offers: 'G00gle' and spaced letters are refused too", async () => {
    const core = mk(); const { s } = await people(core);
    for (const title of ["-10% за G00gle", "Оставете о т з и в", "Ревю = подарък"]) await expect(core.offersAdmin.create(s.manager, { title, text: "", pct: 10 } as never)).rejects.toMatchObject({ code: "invalid" });
  });
});
});
