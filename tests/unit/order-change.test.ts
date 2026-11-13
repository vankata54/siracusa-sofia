import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, publicOrder, CHANGE_BEFORE_MIN, orderDay } from "../../src/core/index.ts";
import { addLine, emptyCart } from "../../src/lib/cart.ts";
import { items, isOut } from "../../src/lib/data.ts";

/* 13.11.2026 (step 3): the time of every status, and a pre-order changed by the customer (core/orders.ts changeOrder). */
const NOW = new Date("2026-11-12T10:30:00Z"); /* 12:30 in Sofia */
const pizza = items.find((x) => x.cat === "pitsi" && !isOut(x))!;
const base = { name: "Иван", phone: "0888 12 34 56", pay: "cash" as const };
const pickup = (q = 1) => addLine({ ...emptyCart(), mode: "pickup" }, pizza.id, q);
const mk = (repo = new MemoryRepo(), clock = "12:30", now = NOW) => {
  const events: [string, unknown][] = [];
  return { repo, events, core: createCore({ repo, clock, now: () => now, emit: (t, d) => events.push([t, d]) }) };
};

describe("order status times", () => {
  it("each status keeps the time it was reached; the public view has them", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: pickup() });
    expect(o.times).toEqual({ accepted: NOW.toISOString() });
    const c = await core.orders.setStatus(o.no, "cooking");
    const r = await core.orders.setStatus(o.no, "ready");
    expect(Object.keys(r.times!)).toEqual(["accepted", "cooking", "ready"]);
    expect(c.times!.cooking).toBe(NOW.toISOString());
    expect(publicOrder(r).times).toEqual(r.times);
    /* an order from before the field: the public view still says when it was accepted */
    const old = { ...r, times: undefined };
    expect(publicOrder(old).times).toEqual({ accepted: r.createdAt });
  });
});

describe("change of a pre-order", () => {
  it("for tomorrow: a new time and more dishes with the key; the price comes from the menu", async () => {
    const { core, events } = mk();
    const o = await core.orders.create({ ...base, cart: pickup(), sched: "утре", slot: "12:00" });
    expect(orderDay(o)).toBe("2026-11-13");
    const id = o.no + "-" + o.key;
    const c = await core.orders.change(id, { slot: "13:15", cart: { ...pickup(2), lines: pickup(2).lines.map((l) => ({ ...l, extra: 99 })) } });
    expect(c).toMatchObject({ slot: "13:15", at: "13:15", changes: 1, total: pizza.p * 2, status: "accepted" });
    expect(c.lines[0].extra).toBe(0); /* never the price from the client */
    expect(events.map((e) => e[0])).toContain("order.changed");
    expect(publicOrder(c, true).changes).toBe(1);
  });
  it("never without the key, never a wrong key, never for an order for now, never after the kitchen started", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: pickup(), sched: "утре", slot: "12:00" });
    await expect(core.orders.change(o.no, { slot: "13:00" })).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(core.orders.change(o.no + "-wrongkey1", { slot: "13:00" })).rejects.toMatchObject({ code: "not_found" });
    const now = await core.orders.create({ ...base, cart: pickup() });
    await expect(core.orders.change(now.no + "-" + now.key, { slot: "13:00" })).rejects.toMatchObject({ code: "not_changeable", status: 409 });
    await core.orders.setStatus(o.no, "cooking");
    await expect(core.orders.change(o.no + "-" + o.key, { slot: "13:00" })).rejects.toMatchObject({ code: "not_changeable" });
  });
  it("the slot is checked as for a new order; nothing to change is refused", async () => {
    const { core } = mk();
    const o = await core.orders.create({ ...base, cart: pickup(), sched: "утре", slot: "12:00" });
    const id = o.no + "-" + o.key;
    await expect(core.orders.change(id, { slot: "12:07" })).rejects.toMatchObject({ code: "invalid", fields: { slot: "Изберете час от списъка." } });
    await expect(core.orders.change(id, { slot: "09:00" })).rejects.toMatchObject({ code: "invalid" });
    await expect(core.orders.change(id, {})).rejects.toMatchObject({ code: "invalid" });
  });
  it(`"за днес" before 10:00: until ${CHANGE_BEFORE_MIN} min before the old and the new time`, async () => {
    const repo = new MemoryRepo();
    const morning = new Date("2026-11-12T07:00:00Z"); /* 09:00 in Sofia */
    const o = await mk(repo, "09:00", morning).core.orders.create({ ...base, cart: pickup(), sched: "днес", slot: "11:00" });
    const id = o.no + "-" + o.key;
    /* 09:20: 10:30 is under an hour away, 11:30 is fine */
    const at920 = mk(repo, "09:20", new Date("2026-11-12T07:20:00Z")).core;
    await expect(at920.orders.change(id, { slot: "10:15" })).rejects.toMatchObject({ code: "invalid" });
    expect((await at920.orders.change(id, { slot: "11:30" })).slot).toBe("11:30");
    /* 10:31: 11:30 is 59 min away -> too late, by phone */
    const late = mk(repo, "10:31", new Date("2026-11-12T08:31:00Z")).core;
    await expect(late.orders.change(id, { slot: "12:00" })).rejects.toMatchObject({ code: "too_late", status: 409 });
    /* the next day it is in the past */
    const next = mk(repo, "08:00", new Date("2026-11-13T06:00:00Z")).core;
    await expect(next.orders.change(id, { slot: "12:00" })).rejects.toMatchObject({ code: "too_late" });
  });
});
