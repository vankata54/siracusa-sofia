/* Rules of the core added for v1 (core.agent.md): price only from the menu, hours, pickup time, zone from the address,
   tracking key and public view, rating codes, office group order, reservations, settings, subscriptions. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, publicOrder, type Ctx, type Order } from "../../src/core/index.ts";
import { lunch, items, isOut, byId } from "../../src/lib/data.ts";
import { price, parseMods, slotAllowed, pickupToday, slotBusy } from "../../src/lib/pricing.ts";
import { eta, setKitchen, KITCHEN_DEFAULT } from "../../src/lib/status.ts";
import { eventsJson } from "../../src/lib/events-json.ts";
import { sofiaEpoch, addDaysYmd } from "../../src/lib/time.ts";
import { validYmd } from "../../src/core/reservations.ts";
import { url, configureRoutes } from "../../src/lib/routes.ts";
import { mayReceive, pickEncoding } from "../../server/app.ts";

const NOW = new Date("2026-11-12T10:30:00Z"); /* 12:30 in Sofia */
const mk = (clock = "12:30", extra: Partial<Ctx> = {}) => {
  const events: [string, unknown, unknown][] = [];
  const core = createCore({ repo: new MemoryRepo(), clock, now: () => NOW, emit: (t, d, to) => events.push([t, d, to]), ...extra });
  return { core, events };
};
const pizza = byId["pitsa-margarita"] && !isOut(byId["pitsa-margarita"]) ? byId["pitsa-margarita"] : items.find((x) => x.cat === "pitsi" && !isOut(x))!;
const soldOut = items.find((x) => isOut(x))!;
const base = { name: "Иван Петров", phone: "0888 12 34 56" };
const pickup = (lines: unknown[]) => ({ mode: "pickup", lines }) as never;
const deliv = (lines: unknown[]) => ({ mode: "delivery", lines }) as never;
const L = (id: string, q = 1, mods: string[] = [], more: Record<string, unknown> = {}) => ({ key: id, id, q, mods, ...more });

describe("price only from the menu", () => {
  it("ignores extra / p / name from the client; add-ons priced from the 'dobavki' category", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["+ Кашкавал"], { extra: -3, p: 0.01, n: "x", unit: 0.01 })]) });
    expect(o.lines[0].unit).toBe(Math.round((pizza.p + byId["kashkaval"].p) * 100) / 100);
    expect(o.total).toBe(o.lines[0].unit);
  });
  it("unknown add-on, add-on on a dish without add-ons, duplicate: refused", async () => {
    const { core } = mk();
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["+ Злато"])]) })).rejects.toMatchObject({ code: "bad_mod", status: 422 });
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["+ Кашкавал", "+ Кашкавал"])]) })).rejects.toMatchObject({ code: "bad_mod" });
    const steak = items.find((x) => x.cat === "skara-bertha" && !isOut(x))!;
    await expect(core.orders.create({ ...base, cart: pickup([L(steak.id, 1, ["+ Кашкавал"])]) })).rejects.toMatchObject({ code: "bad_mod" });
    expect(parseMods(pizza, ["без лук"]).bad).toBeNull();
    expect(parseMods(pizza, ["нещо"]).bad).toBe("нещо");
  });
  it("q is a whole number 1..50; unknown and sold-out dishes refused; at most 40 lines", async () => {
    const { core } = mk();
    for (const q of [0, -1, 51, 1.5, "abc", 100000]) await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, q as number)]) })).rejects.toMatchObject({ code: "bad_qty" });
    await expect(core.orders.create({ ...base, cart: pickup([L("nyama-takova")]) })).rejects.toMatchObject({ code: "unknown_item" });
    await expect(core.orders.create({ ...base, cart: pickup([L(soldOut.id)]) })).rejects.toMatchObject({ code: "sold_out", status: 409 });
    const many = items.filter((x) => !isOut(x)).slice(0, 41).map((x) => L(x.id));
    await expect(core.orders.create({ ...base, cart: pickup(many) })).rejects.toMatchObject({ code: "too_many" });
    expect((await core.orders.create({ ...base, cart: pickup([L(pizza.id, 50)]) })).lines[0].q).toBe(50);
  });
});

describe("hours: delivery until 21:00, kitchen until 22:30, lunch only today", () => {
  it("21:30 delivery is refused with a clear error, never turned into pickup", async () => {
    const { core } = mk("21:30");
    await expect(core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "Дружба 2, бл. 311" }))
      .rejects.toMatchObject({ code: "delivery_closed", status: 409, message: "Доставката приключи за днес в 21:00. Поръчки за вземане до 22:30." });
    expect((await core.orders.create({ ...base, cart: pickup([L(pizza.id)]) })).mode).toBe("pickup");
  });
  it("before 10:00 its own text; 'днес' with a time works", async () => {
    const { core } = mk("08:30");
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id)]) })).rejects.toMatchObject({ code: "closed", message: "Кухнята отваря в 10:00. Поръчайте за днес с час от 10:30." });
    expect((await core.orders.create({ ...base, cart: pickup([L(pizza.id)]), sched: "днес", slot: "10:30" })).at).toBe("10:30");
    await expect(mk("12:30").core.orders.create({ ...base, cart: pickup([L(pizza.id)]), sched: "днес", slot: "13:00" })).rejects.toMatchObject({ code: "bad_sched" });
  });
  it("lunch: only when the menu is today's (or preview); -30% after 15:00 only for pickup", async () => {
    await expect(mk("12:30").core.orders.create({ ...base, cart: pickup([L(lunch[0].id)]) })).rejects.toMatchObject({ code: "lunch_stale" });
    const today = new Date(lunch.length ? "2026-11-02T10:30:00Z" : NOW);
    const o = await mk("16:30", { now: () => today }).core.orders.create({ ...base, cart: pickup([L(lunch[0].id)]) });
    expect(o.discKind).toBe("lunch");
    await expect(mk("12:30", { preview: true }).core.orders.create({ ...base, cart: pickup([L(lunch[0].id, 1, ["+ Кашкавал"])]) })).rejects.toMatchObject({ code: "bad_mod" });
  });
});

describe("pickup time", () => {
  const P = { mode: "pickup" as const, earliest: 770 }; /* 12:30 + 20 min */
  it("format, future, 15 min step, 20 min for the kitchen, 3 hours ahead, ready until 23:00 (decision 12.11.2026)", () => {
    expect(slotAllowed(P, "13:00", "12:30")).toBe(true);
    for (const s of ["xx", "3:00", "12:45", "13:10", "15:45", "23:45", "03:00", "", "asap"]) expect(slotAllowed(P, s, "12:30")).toBe(false);
    expect(slotAllowed(P, "15:30", "12:30")).toBe(true);
    expect(slotAllowed({ mode: "pickup", earliest: 1290 }, "22:30", "21:30")).toBe(true);
    expect(slotAllowed({ mode: "pickup", earliest: 1290 }, "23:00", "21:30")).toBe(true); /* accepted until 22:30, ready until closing */
    expect(slotAllowed({ mode: "pickup", earliest: 1290 }, "23:15", "21:30")).toBe(false);
    expect(slotAllowed(P, "10:30", "12:30", true)).toBe(true);
    expect(slotAllowed({ mode: "delivery", earliest: 750 }, "21:00", "12:30", true)).toBe(false);
  });
  it("the core refuses a bad slot with fields.slot; lunch only is ready at once", async () => {
    const { core } = mk();
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id)]), slot: "12:40" })).rejects.toMatchObject({ code: "invalid", fields: { slot: "Изберете час от списъка." } });
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id)]), sched: "утре", slot: "" })).rejects.toMatchObject({ fields: { slot: "Изберете час от списъка." } });
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id)]), sched: "утре", slot: "23:50" })).rejects.toMatchObject({ fields: { slot: "Изберете час от списъка." } });
    expect((await core.orders.create({ ...base, cart: pickup([L(pizza.id)]), slot: "13:00" })).at).toBe("13:00");
    const l = await mk("12:30", { preview: true }).core.orders.create({ ...base, cart: pickup([L(lunch[0].id)]) });
    expect(l.at).toBe("веднага");
  });
});

describe("zone from the address (the server's own check)", () => {
  it("out of the zone is refused even with a free zone sent; the server's zone wins", async () => {
    const { core } = mk();
    await expect(core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "ж.к. Младост 1, бл. 5" })).rejects.toMatchObject({ fields: { addr: "Адресът е извън зоната ни. Изберете „Вземи от място“." } });
    const o = await core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "кв. Горубляне, ул. 1" });
    expect(o.zone).toBe("Горубляне");
    expect(o.fee).toBeNull();
  });
  it("'Дружба' asks 1 or 2 (the chosen one must be one of them); a block without quarter takes the chosen zone", async () => {
    const { core } = mk();
    expect((await core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 1", addr: "Дружба, бл. 72" })).zone).toBe("Дружба 1");
    await expect(core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Бусманци", addr: "Дружба, бл. 72" })).rejects.toMatchObject({ code: "invalid" });
    const b = await core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "бл. 311" });
    expect(b.addr).toBe("бл. 311, Дружба 2");
    await expect(core.orders.create({ ...base, cart: deliv([L(pizza.id)]), addr: "бл. 311" })).rejects.toMatchObject({ fields: { addr: "Добавете и квартала, например „Дружба 2, бл. 311“." } });
  });
});

describe("tracking: key and public view", () => {
  it("no name, phone, address, note; key needed when required", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "Дружба 2, бл. 311", note: "Звънец Петров", email: "a@b.bg" });
    expect(o.key).toMatch(/^[a-z2-9]{8}$/);
    const pub = await core.orders.track(o.no);
    for (const k of ["name", "phone", "email", "addr", "note", "userId", "marketing", "key", "code"]) expect(pub).not.toHaveProperty(k);
    expect((await core.orders.track(o.no + "-" + o.key)).key).toBe(o.key);
    await expect(core.orders.track(o.no + "-zzzzzzzz")).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(core.orders.track("abc")).rejects.toMatchObject({ code: "not_found" });
    const strict = createCore({ ...core.ctx, requireTrackKey: true });
    await expect(strict.orders.track(o.no)).rejects.toMatchObject({ code: "not_found" });
    expect(publicOrder(o as Order)).not.toHaveProperty("phone");
  });
  it("url.tracking with the key", () => {
    configureRoutes({ demo: false, root: "/" });
    expect(url.tracking(1042)).toBe("/porachka/1042/");
    expect(url.tracking({ no: "1042", key: "k7f3m2pq" })).toBe("/porachka/1042-k7f3m2pq/");
    expect(url.tracking("1042-k7f3m2pq")).toBe("/porachka/1042-k7f3m2pq/");
  });
  it("order.status goes only to that order's subscribers; office events only to that office", async () => {
    const { core, events } = mk();
    const o = await core.orders.create({ ...base, cart: pickup([L(pizza.id)]) });
    await core.orders.setStatus(o.no, "cooking");
    const st = events.find((e) => e[0] === "order.status")!;
    expect(st[2]).toEqual({ order: o.no });
    expect(events.find((e) => e[0] === "order.created")![2]).toEqual({});
    const sub = { staff: false, orders: new Set(["9999"]), offices: new Set<string>() };
    expect(mayReceive(sub, { order: o.no })).toBe(false);
    expect(mayReceive({ ...sub, orders: new Set([o.no]) }, { order: o.no })).toBe(true);
    expect(mayReceive(sub, {})).toBe(false);
    expect(mayReceive(sub, { public: true })).toBe(true);
    expect(mayReceive({ ...sub, staff: true }, {})).toBe(true);
    expect(mayReceive(sub, { office: "123456" })).toBe(false);
  });
});

describe("rating codes", () => {
  const done = async (core: ReturnType<typeof mk>["core"], mode: "pickup" | "delivery" = "pickup") => {
    const o = await core.orders.create({ ...base, cart: mode === "pickup" ? pickup([L(pizza.id, 2)]) : deliv([L(pizza.id, 2)]), ...(mode === "delivery" ? { zone: "Дружба 2", addr: "Дружба 2, бл. 311" } : {}) });
    await core.orders.setStatus(o.no, mode === "pickup" ? "picked_up" : "delivered");
    return o;
  };
  it("only a finished, existing order; one code per order; 10 digits", async () => {
    const { core } = mk();
    await expect(core.ratings.submit({ orderNo: "999999", happy: true })).rejects.toMatchObject({ code: "not_found", status: 404 });
    const fresh = await core.orders.create({ ...base, cart: pickup([L(pizza.id)]) });
    await expect(core.ratings.submit({ orderNo: fresh.no, happy: true })).rejects.toMatchObject({ code: "not_finished", status: 409 });
    const o = await done(core);
    const a = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: true });
    const b = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: false, text: "Студено" });
    expect(a.code).toMatch(/^SC10-\d{10}$/);
    expect(b.code).toBe(a.code);
    expect(b.rating.happy).toBe(false);
    expect(b.rating).not.toHaveProperty("phone", "0888123456");
  });
  it("check, use once (-10% on the dishes, not the fee), marked only by a saved order", async () => {
    const { core } = mk();
    const o = await done(core);
    const { code } = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: true });
    expect(await core.codes.check(code.toLowerCase().replace("-", " "))).toEqual({ code, pct: 10, valid: true });
    await expect(core.codes.check("SC10-0000000000")).rejects.toMatchObject({ code: "invalid", fields: { code: "Няма такъв код. Проверете цифрите, например SC10-4829163057." } });
    /* a failing order (bad phone) does not use the code */
    await expect(core.orders.create({ ...base, phone: "1", cart: pickup([L(pizza.id)]), code })).rejects.toMatchObject({ code: "invalid" });
    const p = await core.orders.create({ ...base, cart: pickup([L(pizza.id, 2)]), code });
    expect(p).toMatchObject({ code, discKind: "code", codeDisc: Math.round(pizza.p * 2 * 10) / 100 });
    expect(p.total).toBe(Math.round((p.sub - p.codeDisc!) * 100) / 100);
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id)]), code })).rejects.toMatchObject({ fields: { code: "Този код вече е използван." } });
    await expect(core.codes.check(code)).rejects.toMatchObject({ fields: { code: "Този код вече е използван." } });
  });
  it("never together with the lunch -30%: the better one wins and the code stays unused", async () => {
    const { core } = mk("16:30", { preview: true });
    const o = await done(core);
    const { code } = await core.ratings.submit({ orderNo: o.no + "-" + o.key, happy: true });
    const l = await core.orders.create({ ...base, cart: pickup([L(lunch[0].id, 2)]), code });
    expect(l.discKind).toBe("lunch");
    expect(l.code).toBeUndefined();
    expect((await core.codes.check(code)).valid).toBe(true);
    const P = price(pickup([L(lunch[0].id, 1), L(pizza.id, 3)]), { clock: "16:30", codePct: 10 });
    expect(P.discKind).toBe(P.codeDisc > P.lunchDisc ? "code" : "lunch");
    expect(P.disc).toBe(Math.max(P.codeDisc, P.lunchDisc));
  });
});

describe("office group order", () => {
  const officeBase = { office: "Офис", addr: "Дружба 2, бл. 311", deadline: "11:30" };
  const lunchLine = () => ({ id: lunch[0].id, q: 1, mods: [], extra: 0 });
  it("deadline checked; the day follows the page's rule; the public view has no secrets", async () => {
    const { core } = mk("09:30", { preview: true, now: () => new Date("2026-11-12T07:30:00Z") });
    for (const d of ["99:99", "09:00", "14:30", "11:10", "x"]) await expect(core.office.create({ ...officeBase, deadline: d })).rejects.toMatchObject({ fields: { deadline: "Изберете краен час между 10:30 и 14:00." } });
    const o = await core.office.create(officeBase);
    expect(o.date).toBe("2026-11-12");
    expect(o.orgKey).toMatch(/^[0-9a-f]{24}$/);
    const late = await mk("11:15", { preview: true }).core.office.create(officeBase);
    expect(late.date).toBe("2026-11-13");
    const pub = await core.office.get(o.code);
    expect(pub).not.toHaveProperty("orgKey");
    expect(pub!.isOrg).toBe(false);
    expect((await core.office.get(o.code, o.orgKey))!.isOrg).toBe(true);
  });
  it("colleagues by personal token, not by name; only lunch dishes; organizer may edit anyone", async () => {
    const { core } = mk("09:30", { preview: true, now: () => new Date("2026-11-12T07:30:00Z") });
    const o = await core.office.create(officeBase);
    const me = await core.office.join(o.code, { name: "Мария", lines: [], orgKey: o.orgKey });
    const ivan = await core.office.join(o.code, { name: "Иван", lines: [lunchLine()] });
    expect(ivan.pid).toMatch(/^[0-9a-f]{24}$/);
    expect(ivan.participants.every((p) => !("pid" in p))).toBe(true);
    await expect(core.office.join(o.code, { name: "иван", lines: [] })).rejects.toMatchObject({ code: "name_taken", status: 409 });
    expect((await core.office.join(o.code, { name: "Иван", lines: [], pid: ivan.pid })).participants.find((p) => p.name === "Иван")!.lines).toEqual([]);
    await expect(core.office.join(o.code, { name: "Петя", lines: [{ id: pizza.id, q: 1, mods: [], extra: 0 }] })).rejects.toMatchObject({ code: "not_lunch" });
    expect((await core.office.join(o.code, { name: "Иван", lines: [lunchLine()], orgKey: o.orgKey })).participants).toHaveLength(2);
    expect(me.isOrg).toBe(true);
  });
  it("only the organizer sends, only once; lunch not today is refused", async () => {
    const { core } = mk("10:45", { preview: true, now: () => new Date("2026-11-12T08:45:00Z") });
    const o = await mk("09:30", { preview: true, now: () => new Date("2026-11-12T07:30:00Z"), repo: core.ctx.repo }).core.office.create(officeBase);
    await core.office.join(o.code, { name: "Иван", lines: [lunchLine()] });
    await expect(core.office.submit(o.code, { ...base })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const r = await core.office.submit(o.code, { ...base, orgKey: o.orgKey });
    expect(r.order.channel).toBe("office");
    await expect(core.office.submit(o.code, { ...base, orgKey: o.orgKey })).rejects.toMatchObject({ code: "closed", message: "Поръчката вече е изпратена (№ " + r.order.no + ")." });
    const real = mk("10:00");
    const o2 = await real.core.office.create({ ...officeBase, deadline: "12:00" });
    await expect(real.core.office.join(o2.code, { name: "Иван", lines: [lunchLine()] })).rejects.toMatchObject({ code: "lunch_stale" });
  });
  it("the deadline: the server sends with the organizer's contact; without it the order stays open with a reason", async () => {
    const repo = new MemoryRepo();
    const at = (clock: string, iso: string) => mk(clock, { preview: true, repo, now: () => new Date(iso) }).core;
    const a = await at("09:30", "2026-11-12T07:30:00Z").office.create({ ...officeBase, name: "Мария", phone: "0888 11 22 33" });
    const b = await at("09:30", "2026-11-12T07:30:00Z").office.create(officeBase);
    for (const x of [a, b]) await at("10:00", "2026-11-12T08:00:00Z").office.join(x.code, { name: "Иван", lines: [lunchLine()] });
    expect((await at("11:00", "2026-11-12T09:00:00Z").office.sendDue()).sent).toEqual([]);
    const late = at("11:31", "2026-11-12T09:31:00Z");
    await expect(late.office.join(a.code, { name: "Петя", lines: [] })).rejects.toMatchObject({ code: "deadline" });
    const r = await late.office.sendDue();
    expect(r.sent).toEqual([a.code]);
    expect(r.failed).toEqual([[b.code, "no_contact"]]);
    expect((await late.office.get(a.code))!.status).toBe("sent");
    expect((await late.office.get(b.code))!.autoFailed).toBe("no_contact");
    expect((await late.office.sendDue()).sent).toEqual([]);
  });
});

describe("pickup slots while the kitchen is busy („заето“)", () => {
  it("the next hour is full in the core too (the same helper as the screen); asap, later slots and tomorrow are not", async () => {
    const { core } = mk("12:30");
    await core.settings.update({ kitchen: { busy: true } });
    const o = (slot: string, more: Record<string, unknown> = {}) => core.orders.create({ ...base, cart: pickup([L(pizza.id)]), slot, ...more } as never);
    for (const s of ["13:00", "13:15"]) await expect(o(s)).rejects.toMatchObject({ code: "invalid", fields: { slot: "Този час вече е зает: кухнята е пълна." } });
    expect((await o("13:30")).at).toBe("13:30");
    expect((await o("asap")).mode).toBe("pickup");
    expect((await o("12:00", { sched: "утре" })).sched).toBe("утре");
    expect(slotBusy(13 * 60 + 29, 12 * 60 + 30, true)).toBe(true);
    expect(slotBusy(13 * 60 + 30, 12 * 60 + 30, true)).toBe(false);
    expect(slotBusy(13 * 60, 12 * 60 + 30, false)).toBe(false);
    await core.settings.update({ kitchen: { busy: false } });
    expect((await o("13:00")).at).toBe("13:00");
  });
});

describe("„Изчерпано днес“ (core/menu.ts)", () => {
  it("switch for today: order refused, tomorrow and the office of another day not; next day off by itself; back on for a dish of the data", async () => {
    let now = NOW;
    const repo = new MemoryRepo(), events: [string, unknown, unknown][] = [];
    const core = createCore({ repo, clock: "12:30", now: () => now, emit: (t, d, to) => events.push([t, d, to]) });
    const line = { ...base, cart: pickup([L(pizza.id)]) };
    expect(await core.menu.soldOutToday()).toEqual({});
    await core.menu.setSoldOut(pizza.id, true, "kitchen");
    expect(await core.menu.soldOutToday()).toEqual({ [pizza.id]: true });
    await expect(core.orders.create(line)).rejects.toMatchObject({ code: "sold_out", status: 409 });
    expect((await core.orders.create({ ...line, sched: "утре", slot: "12:00" } as never)).lines[0].id).toBe(pizza.id);
    expect(events.find((e) => e[0] === "menu.soldout")).toEqual(["menu.soldout", { id: pizza.id, out: true }, { public: true }]);
    expect((await core.audit.list()).some((a) => a.action === "menu.sold_out" && a.target === pizza.id && a.actor === "kitchen")).toBe(true);
    /* the next day: the switch is gone, the menu data decides again */
    now = new Date(NOW.getTime() + 24 * 3600_000);
    expect(await core.menu.soldOutToday()).toEqual({});
    expect((await core.orders.create(line)).lines[0].id).toBe(pizza.id);
    now = NOW;
    /* a dish sold out in the data can be brought back for today; turning it out again leaves no switch */
    await core.menu.setSoldOut(soldOut.id, false);
    expect((await core.orders.create({ ...base, cart: pickup([L(soldOut.id)]) })).lines[0].id).toBe(soldOut.id);
    await core.menu.setSoldOut(soldOut.id, true);
    expect(await core.menu.soldOutToday()).toEqual({ [pizza.id]: true });
    await expect(core.orders.create({ ...base, cart: pickup([L(soldOut.id)]) })).rejects.toMatchObject({ code: "sold_out" });
    await expect(core.menu.setSoldOut("no-such-dish", true)).rejects.toMatchObject({ code: "not_found" });
    await expect(core.menu.setSoldOut("__proto__", true)).rejects.toMatchObject({ code: "not_found" });
    await expect(core.menu.setSoldOut(pizza.id, "yes" as never)).rejects.toMatchObject({ code: "invalid" });
  });
});

describe("reservations", () => {
  const r0 = { name: "Иван", phone: "0888123456", people: 2 };
  it("date, time, seats validated", async () => {
    const { core } = mk();
    await expect(core.reservations.create({ ...r0, date: "2020-01-01", time: "19:00" })).rejects.toMatchObject({ fields: { date: "Изберете дата от днес до 3 месеца напред." } });
    await expect(core.reservations.create({ ...r0, date: "2027-06-01", time: "19:00" })).rejects.toMatchObject({ fields: { date: "Изберете дата от днес до 3 месеца напред." } });
    for (const t of ["03:17", "10:30", "22:00", "19:15"]) await expect(core.reservations.create({ ...r0, date: "2026-11-20", time: t })).rejects.toMatchObject({ fields: { time: "Изберете час между 11:00 и 21:30." } });
    await expect(core.reservations.create({ ...r0, date: "2026-11-12", time: "12:00" })).rejects.toMatchObject({ fields: { time: "Този час вече мина. Изберете по-късен." } });
    await expect(core.reservations.create({ ...r0, people: 12, table: "S1", date: "2026-11-20", time: "19:00" })).rejects.toMatchObject({ fields: { people: expect.stringContaining("Масата е за") } });
    expect((await core.reservations.create({ ...r0, date: "2026-11-12", time: "13:00" })).status).toBe("new");
  });
  it("the table is held 2 hours (setting); overlap refused; get and cancel with the key", async () => {
    const { core, events } = mk();
    const a = await core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "19:30" });
    expect(a.dur).toBe(120);
    expect(await core.reservations.taken("2026-11-22", "20:00")).toEqual(["S3"]);
    expect(await core.reservations.taken("2026-11-22", "18:00")).toEqual(["S3"]);
    expect(await core.reservations.taken("2026-11-22", "17:30")).toEqual([]);
    expect(await core.reservations.taken("2026-11-22", "21:30")).toEqual([]);
    await expect(core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "20:30" })).rejects.toMatchObject({ code: "taken" });
    await expect(core.reservations.get(a.id, "wrong")).rejects.toMatchObject({ code: "not_found" });
    expect((await core.reservations.get(a.id, a.key!)).id).toBe(a.id);
    expect((await core.reservations.cancel(a.id, a.key!)).status).toBe("cancelled");
    expect(await core.reservations.taken("2026-11-22", "20:00")).toEqual([]);
    const ev = events.filter((e) => e[0].startsWith("reservation."));
    expect(ev.every((e) => (e[2] as { public?: boolean }).public && !JSON.stringify(e[1]).includes("0888"))).toBe(true);
    await core.settings.update({ resMinutes: 90 });
    await core.reservations.create({ ...r0, table: "S4", date: "2026-11-22", time: "19:00" });
    expect(await core.reservations.taken("2026-11-22", "20:30")).toEqual([]);
  });
  it("a change: the own booking (id + key) is left out of taken, another booking on the same table is not", async () => {
    const { core } = mk();
    const own = await core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "19:00" });
    expect(await core.reservations.taken("2026-11-22", "20:00", own.id, own.key)).toEqual([]);
    /* a wrong key or an unknown id changes nothing (and says nothing) */
    expect(await core.reservations.taken("2026-11-22", "20:00", own.id, "wrong")).toEqual(["S3"]);
    expect(await core.reservations.taken("2026-11-22", "20:00", own.id)).toEqual(["S3"]);
    expect(await core.reservations.taken("2026-11-22", "20:00", "nope", own.key)).toEqual(["S3"]);
    /* another guest holds S3 later: the own booking is left out, the other one still takes the table */
    await core.reservations.create({ ...r0, phone: "0888654321", table: "S3", date: "2026-11-22", time: "21:00" });
    expect(await core.reservations.taken("2026-11-22", "20:00", own.id, own.key)).toEqual(["S3"]);
    expect(await core.reservations.taken("2026-11-22", "18:00", own.id, own.key)).toEqual([]);
    /* the change itself: moving to 18:00 on S3 works, to 20:00 it is refused */
    await expect(core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "20:00", replaces: { id: own.id, key: own.key! } })).rejects.toMatchObject({ code: "taken" });
    expect((await core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "18:00", replaces: { id: own.id, key: own.key! } })).table).toBe("S3");
  });
});

describe("settings, subscriptions, events, time", () => {
  it("kitchen busy: 55 min, zones +20; the minutes from the admin", async () => {
    const { core } = mk();
    await core.settings.update({ kitchen: { busy: true } });
    expect(eta().text).toBe("Възможни са закъснения · около 55 мин");
    const o = await core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "Дружба 2, бл. 311" });
    expect(o.eta).toBe(45);
    await expect(core.settings.update({ kitchen: { etaMin: 60, etaBusyMin: 50 } })).rejects.toMatchObject({ code: "invalid" });
    await core.settings.update({ kitchen: { busy: false, etaMin: 30, etaBusyMin: 50 } });
    expect(eta().text).toBe("около 30 мин");
    setKitchen(KITCHEN_DEFAULT);
  });
  it("subscribe keeps the chosen topics", async () => {
    const { core } = mk();
    const s = await core.subscriptions.subscribe("A@b.bg", true, ["Тематични вечери", "нещо"]);
    expect(s.topics).toEqual(["Тематични вечери"]);
    expect((await core.subscriptions.subscribe("a@b.bg", true, ["Жива музика"])).topics).toEqual(["Тематични вечери", "Жива музика"]);
    expect((await core.subscriptions.subscribe("c@b.bg", true)).topics).toEqual([]);
  });
  it("events with YYYY-MM-DD; Sofia time helpers", () => {
    expect(eventsJson(new Date(2026, 10, 12))[0].date).toBe("2026-11-28");
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(validYmd("2026-02-30")).toBe(false);
    expect(new Date(sofiaEpoch("2026-11-12", 690)).toISOString()).toBe("2026-11-12T09:30:00.000Z");
    expect(new Date(sofiaEpoch("2026-07-01", 690)).toISOString()).toBe("2026-07-01T08:30:00.000Z");
  });
  it("compression choice", () => {
    expect(pickEncoding("gzip, deflate, br")).toBe("br");
    expect(pickEncoding("gzip")).toBe("gzip");
    expect(pickEncoding(undefined)).toBeNull();
  });
});

describe("shared pickup constants and lunchPrice", () => {
  it("lunch -30% only with the discount state and pickup", async () => {
    const { lunchPrice } = await import("../../src/lib/pricing.ts");
    const { ORDER_RULES, RESTAURANT } = await import("../../src/lib/consts.ts");
    const x = { p: 2.4, lunch: true };
    expect(lunchPrice(x, { lunchDiscount: true })).toEqual({ p: 1.68, old: 2.4, disc: 0.72 });
    expect(lunchPrice(x, { lunchDiscount: true }, "delivery")).toEqual({ p: 2.4, old: null, disc: 0 });
    expect(lunchPrice(x, { lunchDiscount: false })).toEqual({ p: 2.4, old: null, disc: 0 });
    expect([ORDER_RULES.pickupLeadMin, ORDER_RULES.slotStep, ORDER_RULES.horizonMin]).toEqual([20, 15, 180]);
    expect(RESTAURANT.payment[2]).toBe("Ваучер");
    expect(RESTAURANT.postalCode).toBe("1582");
  });
});

describe("feedback, cookies, 404, non-breaking spaces", () => {
  it("feedback: validated with fields name / contact / message, kept in the core", async () => {
    const { core } = mk();
    await expect(core.feedback.create({ name: "", contact: "", message: "" })).rejects.toMatchObject({ code: "invalid", status: 422, fields: {
      name: "Напишете името си.", contact: "Напишете телефон (10 цифри, например 0888 12 34 56) или имейл (например ime@primer.bg).", message: "Напишете съобщението си (поне няколко думи)." } });
    await expect(core.feedback.create({ name: "И", contact: "123", message: "Здравейте" })).rejects.toMatchObject({ fields: { contact: "Телефонът трябва да е 10 цифри, например 0888 12 34 56." } });
    await expect(core.feedback.create({ name: "И", contact: "a@b", mode: "email", message: "Здравейте" })).rejects.toMatchObject({ fields: { contact: "Проверете имейла, например ime@primer.bg." } });
    const a = await core.feedback.create({ name: "Иван", contact: "0888 12 34 56", message: "Имате ли паркинг?", topic: "Въпрос" });
    const b = await core.feedback.create({ name: "Мария", contact: "Ime@Primer.bg", message: "Здравейте!" });
    expect(a).toMatchObject({ contact: "0888123456", mode: "phone", status: "new", topic: "Въпрос" });
    expect(b).toMatchObject({ contact: "ime@primer.bg", mode: "email" });
    expect(await core.feedback.list()).toHaveLength(2);
  });
  it("cookie settings keep the stored choice; url.notFound; fromProto 404", async () => {
    const { cookieBanner, footer } = await import("../../src/lib/chrome.ts");
    const { cookieSettings } = await import("../../src/lib/chrome-sheets.ts");
    const { fromProto } = await import("../../src/lib/routes.ts");
    expect(cookieSettings({ analytics: true, marketing: false })).toMatch(/name="analytics" checked/);
    expect(cookieSettings({ analytics: true, marketing: false })).not.toMatch(/name="marketing" checked/);
    expect(cookieBanner()).toContain('href="/biskvitki/"');
    expect(cookieBanner()).toContain('href="/poveritelnost/"');
    expect(footer()).toContain('<a href="/biskvitki/">Бисквитки</a>');
    expect(footer()).toContain("data-cookie-settings>Настройки на бисквитките</button>");
    configureRoutes({ demo: false, root: "/" });
    expect(url.notFound()).toBe("/404.html");
    expect(fromProto("404.html")).toBe("/404.html");
    configureRoutes({ demo: true, root: "../../" });
    expect(url.notFound()).toBe("../../404.html");
    configureRoutes({ demo: false, root: "/" });
  });
  it("non-breaking space helpers", async () => {
    const { fmt, fmtNb, mins } = await import("../../src/lib/format.ts");
    expect(fmt(10.22)).toBe("10,22 €");
    expect(fmtNb(10.22)).toBe("10,22 €");
    expect(mins(35)).toBe("35 мин");
  });
});

describe("office: optional name, hasContact, update by the organizer", () => {
  it("the organizer adds a phone later and the order then leaves at the deadline", async () => {
    const repo = new MemoryRepo();
    const at = (clock: string, iso: string) => mk(clock, { preview: true, repo, now: () => new Date(iso) }).core;
    const c0 = at("09:30", "2026-11-12T07:30:00Z");
    const o = await c0.office.create({ office: "", addr: "Дружба 2, бл. 311", deadline: "11:30" });
    expect(o.office).toBe("");
    expect((await c0.office.get(o.code))!.hasContact).toBe(false);
    await c0.office.join(o.code, { name: "Иван", lines: [{ id: lunch[0].id, q: 1, mods: [], extra: 0 }] });
    const late = at("11:31", "2026-11-12T09:31:00Z");
    expect((await late.office.sendDue()).failed).toEqual([[o.code, "no_contact"]]);
    await expect(late.office.update(o.code, "wrong", { phone: "0888112233" })).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(late.office.update(o.code, o.orgKey!, { phone: "123" })).rejects.toMatchObject({ fields: { phone: "Телефонът трябва да е 10 цифри, например 0888 12 34 56." } });
    const u = await late.office.update(o.code, o.orgKey!, { name: "Мария", phone: "0888 11 22 33", pay: "card" });
    expect(u.hasContact).toBe(true);
    expect(u).not.toHaveProperty("contact");
    expect((await late.office.sendDue()).sent).toEqual([o.code]);
    const sent = (await late.office.get(o.code))!;
    expect(sent.status).toBe("sent");
    expect((await late.orders.get(sent.orderNo!))!.pay).toBe("card");
  });
});

describe("reservations: change and cancel deadline, change in one step", () => {
  const r0 = { name: "Иван", phone: "0888123456", people: 2 };
  it("cancel until 2 h before an evening booking (from 17:00), 1 h before a day booking", async () => {
    const { core } = mk("12:30");
    const day = await core.reservations.create({ ...r0, table: "S1", date: "2026-11-12", time: "13:00" });
    await expect(core.reservations.cancel(day.id, day.key!)).rejects.toMatchObject({ code: "too_late", status: 409, message: expect.stringContaining("до 2 часа преди резервация след 17:00 и до 1 час преди през деня") });
    const day2 = await core.reservations.create({ ...r0, table: "S2", date: "2026-11-12", time: "14:00" });
    expect((await core.reservations.cancel(day2.id, day2.key!)).status).toBe("cancelled");
    const eve = await core.reservations.create({ ...r0, table: "S3", date: "2026-11-12", time: "17:00" });
    const at1500 = createCore({ ...core.ctx, clock: "15:01" });
    await expect(at1500.reservations.cancel(eve.id, eve.key!)).rejects.toMatchObject({ code: "too_late" });
    expect((await createCore({ ...core.ctx, clock: "14:59" }).reservations.cancel(eve.id, eve.key!)).status).toBe("cancelled");
    const tomorrow = await core.reservations.create({ ...r0, table: "S1", date: "2026-11-13", time: "11:00" });
    expect((await createCore({ ...core.ctx, clock: "22:00" }).reservations.cancel(tomorrow.id, tomorrow.key!)).status).toBe("cancelled");
  });
  it("replaces: the old booking is cancelled in the same step and its table counts as free", async () => {
    const { core } = mk("12:30");
    const a = await core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "19:00" });
    await expect(core.reservations.create({ ...r0, people: 3, table: "S3", date: "2026-11-22", time: "19:30" })).rejects.toMatchObject({ code: "taken" });
    await expect(core.reservations.create({ ...r0, table: "S3", date: "2026-11-22", time: "19:30", replaces: { id: a.id, key: "wrong" } })).rejects.toMatchObject({ code: "not_found" });
    const b = await core.reservations.create({ ...r0, people: 3, table: "S3", date: "2026-11-22", time: "19:30", replaces: { id: a.id, key: a.key! } });
    expect(b.table).toBe("S3");
    expect((await core.reservations.get(a.id, a.key!)).status).toBe("cancelled");
    expect(await core.reservations.taken("2026-11-22", "19:00")).toEqual(["S3"]);
  });
});

describe("round 3: nouns, SMS limits, profile bonus, celebration, offers", () => {
  it("nouns: count form, 'Всички ...'", async () => {
    const { noun, allOf } = await import("../../src/lib/filters.ts");
    expect(noun("studeni-predyastia", 10)).toBe("10 предястия");
    expect(noun("burgeri", 3)).toBe("3 бургера");
    expect(noun("hlebcheta", 3)).toBe("3 хлебчета");
    expect(noun("sosove", 1)).toBe("1 сос");
    expect(noun("skara-bertha", 9)).toBe("9 ястия");
    expect(allOf("burgeri")).toBe("Всички бургери");
    expect(allOf("sosove")).toBe("Всички сосове");
    expect(allOf("pasta-i-rizoto")).toBe("Всички ястия");
  });
  it("SMS: no provider -> 503; 30 s between codes; 5 an hour; known", async () => {
    await expect(mk().core.customers.requestCode("0888123456")).rejects.toMatchObject({ code: "sms_unavailable", status: 503 });
    let t = Date.parse("2026-11-12T10:30:00Z");
    const core = createCore({ repo: new MemoryRepo(), clock: "12:30", now: () => new Date(t), smsDemo: true });
    const a = await core.customers.requestCode("0888123456");
    expect(a).toMatchObject({ known: false, resendIn: 30 });
    t += 10_000;
    await expect(core.customers.requestCode("0888123456")).rejects.toMatchObject({ code: "too_soon", status: 429, retryIn: 20, message: "Нов код може след 20 сек." });
    for (let i = 0; i < 4; i++) { t += 31_000; await core.customers.requestCode("0888123456"); }
    t += 31_000;
    await expect(core.customers.requestCode("0888123456")).rejects.toMatchObject({ code: "too_many" });
    t += 3600_000;
    const b = await core.customers.requestCode("0888123456");
    await core.customers.verifyCode("0888123456", b.demoCode!);
    t += 31_000;
    expect((await core.customers.requestCode("0888123456")).known).toBe(true);
  });
  it("profile -10%: once, signed in with the profile's phone, the better discount wins", async () => {
    const core = createCore({ repo: new MemoryRepo(), clock: "12:30", now: () => NOW, smsDemo: true });
    const s = await core.customers.requestCode("0888123456");
    const v = await core.customers.verifyCode("0888123456", s.demoCode!, { name: "Мария" });
    const cart = pickup([L(pizza.id, 2)]);
    const other = await core.orders.create({ ...base, phone: "0888999999", cart, userId: v.customer.id });
    expect(other.discKind).toBe("");
    const o = await core.orders.create({ ...base, phone: "0888 12 34 56", cart, userId: v.customer.id });
    expect(o).toMatchObject({ discKind: "profile", profileDisc: Math.round(pizza.p * 2 * 10) / 100 });
    expect(o.total).toBe(Math.round((o.sub - o.profileDisc!) * 100) / 100);
    expect((await core.customers.bySession(v.token))!.coupons[0]).toMatchObject({ used: true, orderNo: o.no });
    expect((await core.orders.create({ ...base, cart, userId: v.customer.id })).discKind).toBe("");
    expect((await core.orders.track(o.no + "-" + o.key)).profileDisc).toBe(o.profileDisc);
  });
  it("celebration: date ahead, guests 1..300, early only with the setting", async () => {
    const { core } = mk();
    const c0 = { kind: "Рожден ден", name: "Иван", phone: "0888123456" };
    await expect(core.celebrations.create({ ...c0, people: 0, date: "2026-11-12" })).rejects.toMatchObject({ fields: { people: "Изберете брой гости (от 1 до 300).", date: "Изберете дата от утре до една година напред." } });
    await expect(core.celebrations.create({ ...c0, people: 2.5, date: "2028-01-01" })).rejects.toMatchObject({ fields: { people: expect.any(String), date: expect.any(String) } });
    await expect(core.celebrations.create({ ...c0, people: 20, date: "2026-12-12", time: "25:00" })).rejects.toMatchObject({ fields: { time: "Изберете начален час." } });
    const a = await core.celebrations.create({ ...c0, people: 20, date: "2026-12-12", time: "19:00", cake: true, cakeNote: "шоколад", wishes: "балони", early: true });
    expect(a).toMatchObject({ early: false, time: "19:00", cakeNote: "шоколад", wishes: "балони" });
    await core.settings.update({ earlyDays: 14, celebrationPrice: "estimate" });
    expect((await core.celebrations.create({ ...c0, people: 20, date: "2026-12-12" })).early).toBe(true);
    expect((await core.celebrations.create({ ...c0, people: 20, date: "2026-11-20" })).early).toBe(false);
    expect((await core.settings.get()).celebrationPrice).toBe("estimate");
    await expect(core.settings.update({ celebrationPrice: "x" as never })).rejects.toMatchObject({ code: "invalid" });
  });
  it("offers: -30% only when the lunch menu is today's (or in preview)", async () => {
    const { offers } = await import("../../src/lib/offers.ts");
    const { setPreview } = await import("../../src/lib/time.ts");
    expect(offers("16:30", new Date("2026-11-12T12:00:00Z"))[0].id).toBe("tomorrow");
    expect(offers("16:30", new Date("2026-11-02T12:00:00Z"))[0].id).toBe("lunch30");
    setPreview(true);
    expect(offers("16:30", new Date("2026-11-12T12:00:00Z"))[0].id).toBe("lunch30");
    setPreview(false);
  });
});

describe("payAnswer: one answer about payment from RESTAURANT.payment", () => {
  it("HTML with [ЛИПСВА] for the voucher name, plain text without it", async () => {
    const { payAnswer, payAnswerText } = await import("../../src/lib/pay.ts");
    /* three ways (site.review-consistency Б2): the gift card is part of "Ваучер", never a fourth way */
    expect(payAnswer()).toBe('В брой, карта при получаване (Visa, Mastercard; при доставка <span class="missing">[ЛИПСВА: терминал за карти в колата]</span>) или ваучер (и подаръчна карта) <span class="missing">[ЛИПСВА: името на ваучерите]</span>. Онлайн плащане засега няма: плащате, когато получите поръчката.');
    expect(payAnswerText()).toBe("В брой, карта при получаване (Visa, Mastercard) в ресторанта или ваучер (и подаръчна карта). За карта при доставка ни попитайте по телефона. Онлайн плащане засега няма: плащате, когато получите поръчката.");
    expect(payAnswer()).not.toMatch(/Sodexo/);
  });
});

describe("round 6: bonus once per phone, mods normalized, street needed, office per person", () => {
  const signIn = async (core: ReturnType<typeof createCore>, phone = "0888123456") => {
    const s = await core.customers.requestCode(phone);
    return core.customers.verifyCode(phone, s.demoCode!, { name: "Мария" });
  };
  it("profile bonus: shown before the order (profileBonus), used once per phone for ever, also after deleting the profile", async () => {
    const core = createCore({ repo: new MemoryRepo(), clock: "12:30", now: () => NOW, smsDemo: true });
    const v = await signIn(core);
    expect((await core.customers.view(v.customer))!.profileBonus).toBe(true);
    const cart = pickup([L(pizza.id, 2)]);
    const P = price(cart, { clock: "12:30", profilePct: 10 });
    const o = await core.orders.create({ ...base, cart, userId: v.customer.id });
    expect(o.discKind).toBe(P.discKind);
    expect(o.profileDisc).toBe(P.profileDisc);
    expect((await core.customers.view((await core.customers.bySession(v.token))!))!.profileBonus).toBe(false);
    await core.customers.remove(v.customer.id);
    const again = await signIn(core);
    expect(again.customer.coupons).toEqual([]);
    expect((await core.customers.view(again.customer))!.profileBonus).toBe(false);
    expect((await core.orders.create({ ...base, cart, userId: again.customer.id })).discKind).toBe("");
    /* nothing personal is kept: only the hash */
    const kept = await core.ctx.repo.list<{ id: string }>("bonus_used");
    expect(kept).toHaveLength(1);
    expect(JSON.stringify(kept)).not.toContain("0888123456");
    expect(kept[0].id).toMatch(/^[0-9a-f]{64}$/);
  });
  it("notify is {order, reservation}; old records keep `order`", async () => {
    const core = createCore({ repo: new MemoryRepo(), clock: "12:30", now: () => NOW, smsDemo: true });
    const v = await signIn(core);
    await core.ctx.repo.put("users", { ...v.customer, notify: { order: true, events: true, offers: true } } as never);
    const old = (await core.customers.view((await core.customers.bySession(v.token))!))!;
    expect(old.notify).toEqual({ order: true, reservation: false });
    const u = await core.customers.update(v.customer.id, { notify: { reservation: true } });
    expect(u.notify).toEqual({ order: true, reservation: true });
  });
  it("mods: the same add-on written differently is refused (never charged twice); the stored form is clean", async () => {
    const { core } = mk();
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["+ Кашкавал", "+кашкавал"])]) })).rejects.toMatchObject({ code: "bad_mod" });
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["+  КАШКАВАЛ ", "+ кашкавал"])]) })).rejects.toMatchObject({ code: "bad_mod" });
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["без лук", "без  Лук"])]) })).rejects.toMatchObject({ code: "bad_mod" });
    const o = await core.orders.create({ ...base, cart: pickup([L(pizza.id, 1, ["+кашкавал", "без  лук"])]) });
    expect(o.lines[0].mods).toEqual(["+ Кашкавал", "без лук"]);
  });
  it("a web order: no table from the body; the address needs a street or block", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: pickup([L(pizza.id)]), table: "S1" });
    expect(o.table).toBeNull();
    await expect(core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "Дружба 2" })).rejects.toMatchObject({ fields: { addr: "Добавете улица или блок, например „Дружба 2, бл. 311“, за да ви намери шофьорът." } });
    await expect(core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "Дружба" })).rejects.toMatchObject({ fields: { addr: expect.stringContaining("улица или блок") } });
    expect((await core.orders.create({ ...base, cart: deliv([L(pizza.id)]), zone: "Дружба 2", addr: "ул. Обиколна, Дружба 2" })).zone).toBe("Дружба 2");
  });
  it("office: up to 10 dishes per person; 21 colleagues x 2 dishes send as merged lines; the order time for all devices", async () => {
    const repo = new MemoryRepo();
    const at = (clock: string, iso: string) => mk(clock, { preview: true, repo, now: () => new Date(iso) }).core;
    const c0 = at("09:30", "2026-11-12T07:30:00Z");
    const o = await c0.office.create({ office: "", addr: "Дружба 2, бл. 311", deadline: "11:30", name: "Мария", phone: "0888112233" });
    const L2 = (id: string) => ({ id, q: 1, mods: [], extra: 0 });
    await expect(c0.office.join(o.code, { name: "Много", lines: Array.from({ length: 11 }, () => L2(lunch[0].id)) })).rejects.toMatchObject({ code: "too_many", message: "До 10 порции на човек." });
    for (let i = 0; i < 21; i++) await c0.office.join(o.code, { name: "Колега " + i, lines: [L2(lunch[0].id), L2(lunch[1].id)] });
    const r = await at("10:45", "2026-11-12T08:45:00Z").office.submit(o.code, { orgKey: o.orgKey } as never);
    expect(r.order.lines.map((l) => l.q)).toEqual([21, 21]);
    expect(r.order.name).toBe("Мария");
    const pub = await c0.office.get(o.code);
    expect(pub).toMatchObject({ status: "sent", orderAt: r.order.at, orderTotal: r.order.total });
  });
  it("office: autoFailed 'empty' clears when a dish comes; offices made in the server preview are left to the preview", async () => {
    const repo = new MemoryRepo();
    const prev = (clock: string, iso: string) => createCore({ repo, clock, preview: true, now: () => new Date(iso) });
    const o = await prev("09:30", "2026-11-12T07:30:00Z").office.create({ office: "", addr: "Дружба 2, бл. 311", deadline: "10:30" });
    expect(o.preview).toBe(true);
    const real = createCore({ repo, clock: "11:00", now: () => new Date("2026-11-12T09:00:00Z") });
    expect(await real.office.sendDue()).toEqual({ sent: [], failed: [] });
    const p2 = prev("10:31", "2026-11-12T08:31:00Z");
    expect((await p2.office.sendDue()).failed).toEqual([[o.code, "empty"]]);
    await p2.office.join(o.code, { name: "Иван", lines: [{ id: lunch[0].id, q: 1, mods: [], extra: 0 }], orgKey: o.orgKey });
    expect((await p2.office.get(o.code))!.autoFailed).toBeUndefined();
  });
});

describe("round 8: order size limits, office per person / people / sum", () => {
  it("a web order over 60 portions or 500 € goes by phone; the office has its own limits", async () => {
    const { ORDER_RULES } = await import("../../src/lib/consts.ts");
    expect([ORDER_RULES.maxPortions, ORDER_RULES.maxTotal, ORDER_RULES.officePortionsPerPerson, ORDER_RULES.officeMaxPeople]).toEqual([60, 500, 10, 60]);
    const { core } = mk();
    await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 50), L(items.find((x) => x.cat === "salati" && !isOut(x))!.id, 11)]) })).rejects.toMatchObject({ code: "too_big", status: 422, message: expect.stringContaining("0894 36 55 77") });
    const steak = items.filter((x) => !isOut(x)).sort((a, b) => b.p - a.p)[0];
    await expect(core.orders.create({ ...base, cart: pickup([L(steak.id, Math.ceil(501 / steak.p))]) })).rejects.toMatchObject({ code: "too_big" });
    expect((await core.orders.create({ ...base, cart: pickup([L(pizza.id, 30)]) })).lines[0].q).toBe(30);
  });
  it("office: 10 portions per person (sum of q), 60 people, the sum of the whole order", async () => {
    const { core } = mk("09:30", { preview: true, now: () => new Date("2026-11-12T07:30:00Z") });
    const o = await core.office.create({ office: "", addr: "Дружба 2, бл. 311", deadline: "11:30" });
    const ln = (q: number) => ({ id: lunch[0].id, q, mods: [], extra: 0 });
    await expect(core.office.join(o.code, { name: "А", lines: [ln(11)] })).rejects.toMatchObject({ code: "too_many" });
    expect((await core.office.join(o.code, { name: "А", lines: [ln(10)] })).participants).toHaveLength(1);
    for (let i = 0; i < 59; i++) await core.ctx.repo.get("office_orders", o.id).then(async (d) => { const x = d as unknown as { participants: unknown[] }; x.participants.push({ name: "П" + i, lines: [], pid: "p" + i }); await core.ctx.repo.put("office_orders", x as never); });
    await expect(core.office.join(o.code, { name: "Шейсет и едно", lines: [] })).rejects.toMatchObject({ code: "full", status: 409 });
    const o2 = await core.office.create({ office: "", addr: "Дружба 2, бл. 311", deadline: "11:30" });
    const priciest = lunch.slice().sort((a, b) => b.p - a.p)[0];
    let n = 0;
    await expect((async () => { for (; n < 60; n++) await core.office.join(o2.code, { name: "К" + n, lines: [{ id: priciest.id, q: 10, mods: [], extra: 0 }] }); })()).rejects.toMatchObject({ code: "too_big" });
    expect(n * 10 * priciest.p).toBeLessThanOrEqual(500);
  });
});

describe("pickup today: one rule for the core and the cart (decision 12.11.2026, kitchen accepts until 22:30)", () => {
  const pk = (clock: string) => price(pickup([L(pizza.id, 1)]), { clock });
  it("22:09 and 22:17: 'Възможно най-скоро' and slots every 15 min up to 23:00, never sooner than 20 min", () => {
    const a = pickupToday(pk("22:09"), "22:09");
    expect(a).toEqual({ ok: true, asap: true, slots: [22 * 60 + 30, 22 * 60 + 45, 23 * 60] });
    const b = pickupToday(pk("22:17"), "22:17");
    expect(b).toEqual({ ok: true, asap: true, slots: [22 * 60 + 45, 23 * 60] });
    expect(slotAllowed(pk("22:17"), "22:45", "22:17")).toBe(true);
    expect(slotAllowed(pk("22:17"), "22:30", "22:17")).toBe(false); /* sooner than 20 min */
    expect(slotAllowed(pk("22:17"), "23:15", "22:17")).toBe(false); /* after closing */
  });
  it("22:30 and 22:31: nothing today", () => {
    for (const t of ["22:30", "22:31"]) expect(pickupToday(pk(t), t)).toEqual({ ok: false, asap: false, slots: [] });
  });
  it("the core: 22:09 and 22:17 accept 'asap' and a slot, 22:30 and 22:31 refuse with 'closed'", async () => {
    for (const t of ["22:09", "22:17"]) {
      const { core } = mk(t);
      const o = await core.orders.create({ ...base, cart: pickup([L(pizza.id, 1)]), slot: "asap" });
      expect(o.at).toMatch(/^22:[2-5]\d$/);
      const o2 = await core.orders.create({ ...base, phone: "0888 12 34 57", cart: pickup([L(pizza.id, 1)]), slot: "23:00" });
      expect(o2.at).toBe("23:00");
    }
    for (const t of ["22:30", "22:31"]) {
      const { core } = mk(t);
      await expect(core.orders.create({ ...base, cart: pickup([L(pizza.id, 1)]), slot: "asap" })).rejects.toMatchObject({ code: "closed" });
    }
  });
});

describe("pickup tomorrow: the same rule as today, ready at the latest at 23:00 (decision 12.11.2026, кръг 4)", () => {
  it("pre-order slots for pickup run from 10:30 to 23:00, for delivery to 20:45", () => {
    const P = { mode: "pickup" as const, earliest: 0 };
    expect(slotAllowed(P, "10:30", "22:35", true)).toBe(true);
    expect(slotAllowed(P, "22:45", "22:35", true)).toBe(true);
    expect(slotAllowed(P, "23:00", "22:35", true)).toBe(true);
    expect(slotAllowed(P, "23:15", "22:35", true)).toBe(false);
    expect(slotAllowed({ mode: "delivery", earliest: 0 }, "21:00", "22:35", true)).toBe(false);
  });
  it("the core takes a pickup for tomorrow at 23:00 and refuses 23:15", async () => {
    const { core } = mk("22:35");
    expect((await core.orders.create({ ...base, cart: pickup([L(pizza.id)]), sched: "утре", slot: "23:00" })).at).toBe("23:00");
    await expect(core.orders.create({ ...base, phone: "0888 12 34 57", cart: pickup([L(pizza.id)]), sched: "утре", slot: "23:15" })).rejects.toMatchObject({ fields: { slot: "Изберете час от списъка." } });
  });
});
