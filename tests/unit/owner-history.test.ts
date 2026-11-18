/* The history after the review of the owner's module (reviews-code/sobstvenik.review-2.md; decisions of the chief):
   - the day and the hour of an order are the day and the hour it is for, the day starts at 04:00 (core/order-day.ts);
     "Днес" of the owner and of the dashboard leave out tomorrow's pre-order, the hours sum to the turnover;
   - "Месец" compares with the month before, never past its last day;
   - the SQLite repo reads a period by the day (never the whole table), the days are cached and a change of an order of a
     day (also written straight into the table, without the day) is seen; the numbers equal the memory repo's;
   - the answers: "Друго" goes through the filter of phones and e-mails, "Отмени" only for the one who gave the last answer,
     once, the answers are serialized; a section the role lacks leaves out its part, not the screen; the answers' events
     reach the office only. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, type Hasher, type RoleId, type StaffCtx, type Order } from "../../src/core/index.ts";
import { openDb } from "../../server/db/index.ts";
import { SqliteRepo } from "../../server/db/repo.ts";
import { mayReceive } from "../../server/app.ts";
import { histDay, hourOf, placedMin } from "../../src/core/order-day.ts";
import { compareRange } from "../../src/core/history.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1";
const T0 = Date.parse("2026-11-16T17:42:00Z"); /* Monday 19:42 in Sofia */
type Repo = MemoryRepo | SqliteRepo;
function mk(sql = false) {
  const t = { now: T0 }, repo: Repo = sql ? new SqliteRepo(openDb(":memory:").sqlite) : new MemoryRepo();
  const at = (clock: string, now?: number) => createCore({ repo, hasher, now: () => new Date(now ?? t.now), clock, smsDemo: true });
  return { core: at("19:42"), at, t, repo };
}
type Core = ReturnType<typeof mk>["core"];
async function people(core: Core, roles: RoleId[] = ["admin", "owner", "manager", "kitchen", "waiter"]) {
  const s = {} as Record<string, StaffCtx>;
  for (const r of roles) await core.staff.upsert({ username: r, name: r, role: r, password: PW });
  for (const r of roles) s[r] = (await core.staff.bySession((await core.staff.login(r, PW, "1.1.1." + r)).token))!;
  return s;
}
const pizza = items.find((x) => x.cat === "pitsi" && !x.t.includes("out") && !x.per100)!;
const order = (core: Core, extra: Record<string, unknown> = {}, phone = "0888123456") =>
  core.orders.create({ cart: { mode: "pickup", lines: [{ key: pizza.id, id: pizza.id, q: 1, mods: [], extra: 0 }] }, name: "Иван", phone, pay: "cash", ...extra } as never);
const r2 = (v: number) => Math.round(v * 100) / 100;

describe("the day and the hour of an order", () => {
  it("the day it is for (tomorrow's pre-order: tomorrow), the day from 04:00, the hour it is for", () => {
    const ts = (iso: string) => Date.parse(iso);
    /* 00:30 Sofia on the 17th belongs to the evening of the 16th */
    expect(histDay({ ts: ts("2026-11-16T22:30:00Z"), createdAt: "2026-11-16T22:30:00Z" })).toBe("2026-11-16");
    expect(histDay({ ts: ts("2026-11-17T02:30:00Z"), createdAt: "2026-11-17T02:30:00Z" })).toBe("2026-11-17");
    expect(histDay({ ts: ts("2026-11-16T17:00:00Z"), createdAt: "2026-11-16T17:00:00Z", sched: "утре" })).toBe("2026-11-17");
    expect(hourOf({ placedAt: "07:30", slot: "12:00" })).toBe(12);
    expect(hourOf({ placedAt: "00:30", slot: "asap" })).toBe(24);
    expect(placedMin({ placedAt: "00:30" })).toBe(1470);
    /* placed at 01:00 Sofia on the 17th: "за днес 12:00" is the 17th (as the kitchen cooks it), "възможно най-скоро" the evening of the 16th */
    expect(histDay({ ts: ts("2026-11-16T23:00:00Z"), createdAt: "2026-11-16T23:00:00Z", sched: "днес", slot: "12:00" })).toBe("2026-11-17");
    expect(histDay({ ts: ts("2026-11-16T23:00:00Z"), createdAt: "2026-11-16T23:00:00Z", sched: "", slot: "asap" })).toBe("2026-11-16");
  });
  it("'Месец' compares with the month before, never past its last day", () => {
    expect(compareRange("month", "2026-12-01", "2026-12-31")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(compareRange("month", "2027-03-01", "2027-03-31")).toEqual({ from: "2027-02-01", to: "2027-02-28" });
    expect(compareRange("month", "2026-11-01", "2026-11-16")).toEqual({ from: "2026-10-01", to: "2026-10-16" });
  });
  for (const sql of [false, true]) it("'Днес' (owner and dashboard) without tomorrow's pre-order; the hours sum to the turnover (" + (sql ? "SQLite" : "memory") + ")", async () => {
    const m = mk(sql), s = await people(m.core);
    /* placed at 07:30 for 12:00 today, at 19:42 for tomorrow 12:00, and two now */
    const early = await order(m.at("07:30", Date.parse("2026-11-16T05:30:00Z")), { sched: "днес", slot: "12:00" });
    const tomorrow = await order(m.core, { sched: "утре", slot: "12:00" });
    const a = await order(m.core), b = await order(m.core);
    const t = await m.core.owner.today(s.owner), sum = (await m.core.admin.summary(s.owner)).today.sales!;
    expect(t.sales).toEqual({ sum: r2(early.total + a.total + b.total), n: 3 });
    expect(sum).toMatchObject({ sum: t.sales.sum, n: 3 });
    const tr = await m.core.owner.trends(s.owner, { period: "today" });
    expect(tr.totals.orders).toBe(3);
    expect(r2(tr.byHour.reduce((x, h) => x + (h.revenue || 0), 0))).toBe(tr.totals.revenue);
    expect(tr.byHour.find((h) => h.hour === 12)!.orders).toBe(1);
    expect(tr.peak.cells.flat().reduce((x, y) => x + y, 0)).toBe(3);
    const rep = await m.core.reports.get(s.owner, { period: "today" } as never) as { orders: number; revenue: number; byHour: { revenue: number }[] };
    expect(rep.orders).toBe(3); expect(r2(rep.byHour.reduce((x, h) => x + h.revenue, 0))).toBe(rep.revenue);
    /* tomorrow it is in tomorrow */
    const tm = createCore({ repo: m.repo, hasher, now: () => new Date(T0 + 864e5), clock: "19:42", smsDemo: true });
    expect((await tm.owner.today(s.owner)).sales.n).toBe(1);
    void tomorrow;
  });
});

describe("the SQLite repo: by day, cached, the same numbers", () => {
  it("the numbers equal the memory repo's; a change of a closed day and a row written without the day are seen", async () => {
    const mem = mk(false), sql = mk(true), sm = await people(mem.core), ss = await people(sql.core);
    for (const [m, n] of [[mem, 0], [sql, 0]] as [ReturnType<typeof mk>, number][]) {
      void n;
      for (const d of [1, 2, 3, 8, 9, 30, 364]) { m.t.now = T0 - d * 864e5 - 7 * 3600e3; const c = m.at("12:00"); await order(c, {}, "08881234" + String(10 + d).slice(-2)); await order(c, {}, "0888123499"); }
      m.t.now = T0; await order(m.core, {}, "0888123499");
    }
    for (const q of [{ period: "7" }, { period: "30" }, { period: "7", compare: "year" }, { period: "yesterday" }] as const) {
      const a = await mem.core.owner.trends(sm.owner, q), b = await sql.core.owner.trends(ss.owner, q);
      expect(b.totals).toEqual(a.totals); expect(b.prev).toEqual(a.prev); expect(b.byDay).toEqual(a.byDay); expect(b.customers).toEqual(a.customers); expect(b.byHour).toEqual(a.byHour);
    }
    expect((await sql.core.owner.today(ss.owner)).last7).toEqual((await mem.core.owner.today(sm.owner)).last7);
    expect((await sql.core.owner.finance(ss.owner, { period: "30" })).revenue).toEqual((await mem.core.owner.finance(sm.owner, { period: "30" })).revenue);
    /* a closed day changes: the cache sees it */
    const before = (await sql.core.owner.trends(ss.owner, { period: "7" })).totals;
    const two = (await sql.repo.list<Order>("orders")).find((o) => histDay(o) === "2026-11-14")!;
    await sql.repo.put("orders", { ...two, status: "cancelled", updatedAt: new Date().toISOString() });
    const after = (await sql.core.owner.trends(ss.owner, { period: "7" })).totals;
    expect(after.orders).toBe(before.orders - 1); expect(after.cancelled).toBe(before.cancelled + 1);
    /* a row written straight into the table (no day column): it gets its day and is counted */
    const db = (sql.repo as SqliteRepo).db, o = { ...two, id: "raw-1", no: "99999", status: "picked_up", updatedAt: new Date().toISOString() };
    db.prepare(`INSERT INTO orders (id, data, created_at, updated_at, no, mode, status, phone, total, channel) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(o.id, JSON.stringify(o), o.createdAt, o.updatedAt, 99999, o.mode, o.status, o.phone, o.total, o.channel);
    expect((await sql.core.owner.trends(ss.owner, { period: "7" })).totals.orders).toBe(after.orders + 1);
  });
});

describe("the answers", () => {
  it("'Друго' goes through the filter of phones and e-mails (the note and NOTES.json)", async () => {
    const m = mk(), s = await people(m.core);
    await m.core.owner.answer(s.owner, "r5", { answer: "other", text: "Обадете се на Иван 0888 123 456 или ivan@abv.bg" });
    await m.core.notes.setStatus((await m.core.notes.list({ kind: "answer" }))[0].id, "approved", "admin", { who: "admin" });
    const all = JSON.stringify([await m.core.notes.list({ kind: "answer" }), await m.core.notes.approved()]);
    expect(all).not.toMatch(/0888\s?123\s?456|ivan@abv\.bg/);
  });
  it("'Отмени': only the one who gave the last answer, once; the answers are one at a time", async () => {
    const m = mk(), s = await people(m.core);
    await m.core.staff.upsert({ username: "owner2", name: "Собственик 2", role: "owner", password: PW });
    const o2 = (await m.core.staff.bySession((await m.core.staff.login("owner2", PW, "1.1.1.9")).token))!;
    await m.core.owner.answer(s.owner, "r8", { answer: "default" });
    await m.core.owner.answer(o2, "r8", { answer: "other", text: "след 3" });
    await expect(m.core.owner.answerUndo(s.owner, "r8")).rejects.toMatchObject({ status: 409 });
    const back = await m.core.owner.answerUndo(o2, "r8");
    expect(back.answer).toMatchObject({ answer: "default" });
    /* once: the second "Отмени" does not take away the first answer too */
    await expect(m.core.owner.answerUndo(o2, "r8")).rejects.toMatchObject({ status: 409 });
    await expect(m.core.owner.answerUndo(s.owner, "r8")).rejects.toMatchObject({ status: 409 });
    expect((await m.core.owner.decisions(s.owner)).questions.find((q) => q.id === "r8")!.answer).toMatchObject({ answer: "default" });
    /* three answers at once: one note */
    await Promise.all([1, 2, 3].map((i) => m.core.owner.answer(s.owner, "r1", { answer: "other", text: "отговор " + i })));
    expect((await m.core.notes.list({ kind: "answer" })).filter((n) => n.q!.id === "r1")).toHaveLength(1);
  });
  it("a section the role lacks leaves out its part, not the screen; the answers' events reach the office only", async () => {
    const m = mk(), s = await people(m.core);
    await m.core.staff.setRole("owner", s.owner.sections.filter((x) => !["driver", "staff", "reservations", "customers", "hall", "waiter", "orders", "qr"].includes(x)), "admin");
    const o = (await m.core.staff.bySession((await m.core.staff.login("owner", PW, "1.1.1.8")).token))!;
    const f = await m.core.owner.finance(o, { period: "7" });
    expect(f.cash.hidden).toBe(true);
    const d = await m.core.owner.decisions(o);
    expect(d.blocks.hidden).toBe(true); expect(d.canAnswer).toBe(true); expect(d.questions.length).toBeGreaterThan(40);
    /* the floor is open to the owner by role: "Днес" keeps its tables */
    expect((await m.core.owner.today(o)).live.tables.hidden).toBeUndefined();
    const sub = (role: string, sections: string[] = []) => ({ staff: true, orders: new Set<string>(), offices: new Set<string>(), role, sections });
    const to = { office_only: true };
    expect(["admin", "owner", "manager"].map((r) => mayReceive(sub(r), to, "owner.answer"))).toEqual([true, true, true]);
    expect([sub("kitchen", ["kitchen"]), sub("waiter", ["waiter"]), sub("driver", ["driver"])].map((x) => mayReceive(x, to, "note.status"))).toEqual([false, false, false]);
    expect(mayReceive(sub("marketing", ["notes"]), to, "note.created")).toBe(true);
    expect(mayReceive({ ...sub("waiter"), staff: false }, to, "owner.answer")).toBe(false);
  });
});

describe("'Днес' against the same minute a week ago: every number of the comparison is cut", () => {
  for (const sql of [false, true]) it("the money by payment, the deliveries, the fuel and the km of last week only up to now (" + (sql ? "SQLite" : "memory") + ")", async () => {
    const m = mk(sql), s = await people(m.core);
    /* last Monday (2026-11-09): one cash pickup at 12:00 and one delivered delivery paid by card at 21:00 (after 19:42) */
    const raw = (id: string, at: string, placedAt: string, extra: Record<string, unknown>) => {
      const ts = Date.parse(at);
      return m.repo.put("orders", { id, no: id, key: "k" + id, mode: "pickup", channel: "web", lines: [{ id: pizza.id, name: pizza.n, unit: 10, q: 1, mods: [], extra: 0 }], sub: 10, disc: 0, fee: 0, total: 10, pay: "cash",
        status: "picked_up", placedAt, ts, sched: "", slot: "asap", phone: "0888123400", name: "К", times: {}, createdAt: new Date(ts).toISOString(), updatedAt: new Date(ts).toISOString(), ...extra });
    };
    await raw("9001", "2026-11-09T10:00:00Z", "12:00", {});
    await raw("9002", "2026-11-09T19:00:00Z", "21:00", { mode: "delivery", status: "delivered", pay: "card", total: 20, sub: 20 });
    /* fuel last Monday at 12:00 and at 21:00 */
    for (const [id, at] of [["f1", "2026-11-09T10:00:00Z"], ["f2", "2026-11-09T19:00:00Z"]]) await m.repo.put("fuel_logs", { id, user: "driver", name: "Шофьор", shift: "x", car: "c1", litres: 10, sum: 15, km: 1000, full: false, cash: false, photo: null, noPhoto: true, at, createdAt: at, updatedAt: at });
    await order(m.core);
    const f = await m.core.owner.finance(s.owner, { period: "today" });
    expect(f.revenue.prev).toBe(10);
    expect(f.prevPay.total).toBe(f.revenue.prev);
    expect(f.prevPay.online).toEqual({ cash: 10, card: 0, voucher: 0 });
    expect(f.prevFuel).toMatchObject({ n: 1, sum: 15 });
    const t = await m.core.owner.trends(s.owner, { period: "today" });
    expect(t.prev.revenue).toBe(10);
    expect(r2(t.byChannel.reduce((a, c) => a + (c.cmp.revenue || 0), 0))).toBe(10);
    expect(r2(t.byHour.reduce((a, c) => a + (c.cmp.revenue || 0), 0))).toBe(10);
    /* the whole day when it is not "Днес": both orders */
    const y = await m.core.owner.finance(s.owner, { period: "custom", from: "2026-11-09", to: "2026-11-09" });
    expect(y.revenue.cur).toBe(30); expect(y.pay.online).toEqual({ cash: 10, card: 20, voucher: 0 }); expect(y.delivery.delivered).toBe(1);
  });
});
