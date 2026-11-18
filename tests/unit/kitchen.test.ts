/* The kitchen (core/kitchen.ts): the section map, the queue and its timers, "Натоварено" only for new orders, "По-късно",
   the lines and the status, "Върни", "Изпълнени днес", "Изчерпано днес" in accepted orders, the rights, idempotence and
   the time of an action, the tablets, the search. Direct calls of the core with a fixed clock (no screen). */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, CoreError, K_MISSING, type Ctx, type Hasher, type Order, type StaffCtx, type RoleId, type Audience } from "../../src/core/index.ts";
import { secOfCat, kitchenConfig, DEFAULT_KITCHEN, stampKitchen } from "../../src/core/kitchen-base.ts";
import { timingOf, timerOf, shiftStart, actionAt } from "../../src/core/kitchen.ts";
import { cats } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1";
const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const DAY = "2026-11-16"; /* Monday; Sofia is UTC+2 */
type Ev = { type: string; data: Record<string, unknown>; to: Audience };

/** a core with a clock the test moves: at("19:55") */
async function mk(start = "19:42", extra: Partial<Ctx> = {}) {
  const events: Ev[] = [];
  const state = { now: new Date(0) };
  const ctx: Ctx = { repo: new MemoryRepo(), hasher, now: () => state.now, clock: start, smsDemo: true, emit: (type, data, to) => events.push({ type, data: data as Record<string, unknown>, to }), ...extra };
  const at = (hm: string, sec = 0, day = DAY) => { state.now = new Date(Date.parse(day + "T" + hm + ":00+02:00") + sec * 1000); ctx.clock = hm; return state.now; };
  at(start);
  const core = createCore(ctx);
  const s = {} as Record<RoleId, StaffCtx>;
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r, role: r, password: PW });
  for (const r of ROLES) s[r] = (await core.staff.bySession((await core.staff.login(r, PW, "1.1.1." + r)).token))!;
  const line = (id: string, q = 1, mods: string[] = []) => ({ key: id + mods.join(), id, q, mods, extra: 0 });
  const base = { name: "Иван", phone: "0888123456", pay: "cash" as const };
  const table = (tableId: string, lines: ReturnType<typeof line>[]) => core.orders.create({ ...base, cart: { mode: "pickup", lines }, channel: "waiter", table: tableId });
  const delivery = (lines: ReturnType<typeof line>[], more: Record<string, unknown> = {}) => core.orders.create({ ...base, cart: { mode: "delivery", lines }, addr: "ж.к. Дружба 2, бл. 311", ...more } as never);
  const pickup = (lines: ReturnType<typeof line>[], more: Record<string, unknown> = {}) => core.orders.create({ ...base, cart: { mode: "pickup", lines }, ...more } as never);
  const order = (no: string) => core.orders.get(no) as Promise<Order>;
  return { core, ctx, events, at, s, k: s.kitchen, line, table, delivery, pickup, order };
}
const code = async (p: Promise<unknown>): Promise<string> => { try { await p; return "ok"; } catch (e) { return e instanceof CoreError ? e.code + ":" + e.status : "throw:" + String(e); } };
const KEBAP = "kebapcheta", VRAT = "svinski-vrat", PIZZA = "pitsa-margarita", SALAD = "shopska-salata", FRIES = "parzheni-kartofi", SOUP = "pileshka-supa";

describe("sections", () => {
  it("the conditional map of the prototype: every category of the menu has a section; lunch and unknown categories go to „Топла“", async () => {
    const cfg = DEFAULT_KITCHEN;
    expect(cfg.sections.map((x) => [x.id, x.n, x.short])).toEqual([["topla", "Топла кухня", "Топла"], ["skara", "Скара Bertha", "Скара"], ["pesht", "Пещ за пици", "Пещ"], ["studeni", "Салати и студени", "Салати"]]);
    expect(secOfCat(cfg, "skara-bertha")).toBe("skara");
    expect(secOfCat(cfg, "pitsi")).toBe("pesht");
    expect(secOfCat(cfg, "hlebcheta")).toBe("pesht");
    expect(secOfCat(cfg, "garnituri")).toBe("topla");
    expect(secOfCat(cfg, "sosove")).toBe("studeni");
    expect(secOfCat(cfg, "deserti")).toBe("studeni");
    expect(secOfCat(cfg, "obedno")).toBe("topla");
    expect(secOfCat(cfg, "a-new-category")).toBe("topla");
    /* every category of today's menu is mapped on purpose, except the add-ons (they are never a line of their own) */
    const mapped = new Set(cfg.sections.flatMap((x) => x.cats));
    expect(cats.filter((c) => !mapped.has(c.id)).map((c) => c.id)).toEqual(["dobavki"]);
  });

  it("a new order: every line gets its section and ks „wait“ (also a table order and a changed pre-order); the config says what is [ЛИПСВА]", async () => {
    const { core, k, s, line, table, pickup, at, events } = await mk();
    const o = await table("S1", [line(KEBAP, 2, ["без лук"]), line(PIZZA, 1, ["+ Гъби"]), line(SALAD), line(FRIES)]);
    expect(o.lines.map((l) => [l.id, l.sec, l.ks])).toEqual([[KEBAP, "skara", "wait"], [PIZZA, "pesht", "wait"], [SALAD, "studeni", "wait"], [FRIES, "topla", "wait"]]);
    expect(o.kBusy).toBeUndefined();
    expect(events.find((e) => e.type === "order.new")!.data).toMatchObject({ no: o.no, channel: "waiter", table: "S1", secs: ["skara", "pesht", "studeni", "topla"] });
    const pre = await pickup([line(KEBAP)], { sched: "утре", slot: "12:00" });
    at("19:50");
    const changed = await core.orders.change(pre.no + "-" + pre.key, { slot: "13:15", cart: { mode: "pickup", lines: [line(PIZZA, 2)] } });
    expect(changed.lines.map((l) => [l.sec, l.ks])).toEqual([["pesht", "wait"]]);

    const c = await core.kitchen.config(k);
    expect(c.missing).toEqual([K_MISSING.sections, K_MISSING.norms]);
    expect(c).toMatchObject({ norm: { table: 20, pickup: 20, delivery: 20 }, soon: 5, enterBefore: 20, busyMin: 20, undoSec: 10, canEdit: false, stateText: { wait: "чака", cook: "готви се", ready: "готово" } });
    expect(c.all).toMatchObject({ id: "all", n: "Общ изглед", who: "Главен готвач" });
    /* the admin later: only a boss; a saved part is no longer [ЛИПСВА]; the map moves the NEXT orders */
    expect(await code(core.kitchen.setConfig(k, { soon: 4 }))).toBe("forbidden:403");
    expect(await code(core.kitchen.setConfig(s.manager, { soon: 30 }))).toBe("invalid:422");
    const secs = c.sections.map((x) => (x.id === "skara" ? { ...x, cats: [...x.cats, "garnituri"] } : x.id === "topla" ? { ...x, cats: x.cats.filter((y) => y !== "garnituri") } : x));
    const c2 = await core.kitchen.setConfig(s.manager, { sections: secs }, c.version);
    expect(c2.missing).toEqual([K_MISSING.norms]);
    expect(await code(core.kitchen.setConfig(s.manager, { soon: 4 }, c.version))).toBe("conflict:409");
    expect((await core.kitchen.setConfig(s.owner, { soon: 4 }, c2.version)).missing).toEqual([]);
    const o2 = await table("S2", [line(FRIES)]);
    expect(o2.lines[0].sec).toBe("skara");
    /* the order placed before keeps the section it was stamped with */
    expect((await core.orders.get(o.no))!.lines[3].sec).toBe("topla");
  });

  it("a lunch dish is cooked in „Топла“; a line from before the stamp (or made elsewhere) is read by its category", async () => {
    const { core, ctx, k, line, pickup } = await mk("12:00", { preview: true });
    const o = await pickup([line("l-supa-topcheta"), line(KEBAP)]);
    expect(o.lines.map((l) => l.sec)).toEqual(["topla", "skara"]);
    /* an old order without sec / ks */
    const raw = (await core.orders.get(o.no))!;
    raw.lines = raw.lines.map(({ sec: _s, ks: _k, ...l }) => l);
    await ctx.repo.put("orders", raw);
    const q = await core.kitchen.queue(k, "topla");
    expect(q.tickets.map((t) => [t.no, t.lines.map((l) => [l.name, l.ks])])).toEqual([[o.no, [["Супа топчета", "wait"]]]]);
    expect((await stampKitchen(ctx, raw)).lines.map((l) => [l.sec, l.ks])).toEqual([["topla", "wait"], ["skara", "wait"]]);
    /* the tiles of „Изчерпано“: the lunch menu is in its section on its day only */
    const lunchGroup = (await core.kitchen.soldOut(k, "topla")).groups.find((g) => g.cat === "obedno")!;
    expect(lunchGroup).toMatchObject({ n: "Обедно меню", note: "условно в „Топла кухня“", shared: false });
    expect(lunchGroup.items.map((x) => x.id)).toContain("l-supa-topcheta");
    expect((await core.kitchen.soldOut(k, "skara")).groups.some((g) => g.cat === "obedno")).toBe(false);
    expect(await core.kitchen.setOut(k, "l-supa-topcheta", true)).toMatchObject({ orders: 1, manager: true });
    expect((await kitchenConfig(ctx)).version).toBe(0);
  });
});

describe("the queue", () => {
  it("FIFO by arrival, only the section's lines, the source, the mods under the dish, „Други секции“", async () => {
    const { core, k, at, line, table, delivery, pickup } = await mk("19:18");
    const t12 = await table("S12", [line(KEBAP, 2, ["без лук"]), line(VRAT), line(FRIES), line(PIZZA, 1, ["+ Гъби"])]);
    at("19:26"); const d = await delivery([line(PIZZA), line(SOUP)], { note: "Без прибори" });
    at("19:30"); const g = await table("G1", [line(KEBAP, 3)]);
    at("19:33"); const p = await pickup([line(VRAT)]);
    at("19:42");
    const q = await core.kitchen.queue(k, "skara");
    expect(q.tickets.map((t) => t.no)).toEqual([t12.no, g.no, p.no]); /* the delivery has nothing for the grill */
    expect(q.counts).toMatchObject({ wait: 3, late: 1, soon: 0, later: 0 });
    const a = q.tickets[0];
    expect(a.src).toMatchObject({ kind: "table", k: "Салон", t: "Маса 12", text: "Маса 12", who: "сервитьора" });
    expect(q.tickets[1].src).toMatchObject({ k: "Градина", t: "Маса 13" });
    expect(q.tickets[2].src).toMatchObject({ kind: "pickup", k: "Вземане в 19:53", t: "№ " + p.no, text: "Вземане № " + p.no, who: "клиента" });
    expect(a).toMatchObject({ arrivedHm: "19:18", dueHm: "19:38", timer: "late", left: -240, isNew: true, web: false, busyMin: 0, startedAt: null, sched: false });
    expect(a.lines.map((l) => [l.i, l.q, l.name, l.no, l.ks])).toEqual([[0, 2, "Кебапчета", ["лук"], "wait"], [1, 1, "Свински врат", [], "wait"]]);
    expect(a.others.map((x) => [x.q, x.name, x.short, x.state])).toEqual([[1, "Пържени картофи", "Топла", "wait"], [1, "Пица Маргарита", "Пещ", "wait"]]);
    expect(a.secs.map((x) => [x.id, x.state])).toEqual([["topla", "wait"], ["skara", "wait"], ["pesht", "wait"]]);
    /* the oven: the add-on is under the pizza, never a line; the delivery says when the driver leaves and carries the note */
    const oven = await core.kitchen.queue(k, "pesht");
    expect(oven.tickets.map((t) => t.no)).toEqual([t12.no, d.no]);
    expect(oven.tickets[0].lines).toHaveLength(1);
    expect(oven.tickets[0].lines[0]).toMatchObject({ name: "Пица Маргарита", add: [{ n: "Гъби", out: false }], no: [] });
    expect(oven.tickets[1]).toMatchObject({ src: { kind: "delivery", k: "Доставка", t: "№ " + d.no, text: "Доставка № " + d.no, who: "шофьора" }, driverHm: "19:46", note: "Без прибори", web: true, timer: "soon", left: 240 });
    /* the head chef sees every line of every order */
    const all = await core.kitchen.queue(k, "all");
    expect(all.tickets.map((t) => [t.no, t.lines.length, t.others.length])).toEqual([[t12.no, 4, 0], [d.no, 2, 0], [g.no, 1, 0], [p.no, 1, 0]]);
    expect(await code(core.kitchen.queue(k, "bar"))).toBe("bad_sec:422");
  });

  it("the timer: remaining, „наближава“ 5 min before, „закъснява“ after the deadline (computed from timestamps)", async () => {
    const { core, k, at, line, table } = await mk("19:00");
    const o = await table("S1", [line(KEBAP)]);
    const t = async () => { const x = (await core.kitchen.queue(k, "skara")).tickets[0]; return [x.timer, x.left]; };
    expect(await t()).toEqual(["ok", 1200]);
    at("19:14", 59); expect(await t()).toEqual(["ok", 301]);
    at("19:15"); expect(await t()).toEqual(["soon", 300]);
    at("19:20"); expect(await t()).toEqual(["soon", 0]);
    at("19:20", 1); expect(await t()).toEqual(["late", -1]);
    at("19:24", 1); expect(await t()).toEqual(["late", -241]);
    const cfg = DEFAULT_KITCHEN, tm = timingOf(await core.orders.get(o.no) as Order, cfg);
    expect(tm.due - tm.arrived).toBe(20 * 60_000);
    expect(timerOf(tm.due, tm.due - 5 * 60_000 - 1000, cfg).timer).toBe("ok");
  });

  it("„Нова“ until opened, started or a line ticked", async () => {
    const { core, k, line, table, events } = await mk();
    const a = await table("S1", [line(KEBAP), line(VRAT)]), b = await table("S2", [line(KEBAP)]), c = await table("S3", [line(KEBAP), line(VRAT)]);
    const news = async () => (await core.kitchen.queue(k, "skara")).tickets.map((t) => t.isNew);
    expect(await news()).toEqual([true, true, true]);
    expect(await core.kitchen.seen(k, a.no, "skara")).toEqual({ ok: true, same: false });
    expect(await core.kitchen.seen(k, a.no, "skara")).toEqual({ ok: true, same: true });
    await core.kitchen.start(k, b.no, "skara");
    await core.kitchen.line(k, c.no, 0, true, { sec: "skara" });
    expect(await news()).toEqual([false, false, false]);
    /* another view has not opened it yet */
    expect((await core.kitchen.queue(k, "all")).tickets[0].isNew).toBe(true);
    expect(events.filter((e) => e.type === "order.line" && e.data.kind === "seen")).toHaveLength(1);
  });
});

describe("„Натоварено“", () => {
  it("+20 min only for orders placed while it is on; accepted orders keep their deadline; an order for an hour keeps the hour", async () => {
    const { core, k, s, at, line, table, pickup, events } = await mk("19:00");
    const before = await table("S1", [line(KEBAP)]);
    at("19:05");
    const on = await core.kitchen.setBusy(k, true, { sec: "skara" });
    expect(on).toMatchObject({ on: true, same: false, atHm: "19:05", by: "Кухня · Скара", extra: 20, remind: false });
    expect(on.customer.normal).toMatch(/^около 35/);
    expect(on.customer.busy).toMatch(/^Възможни са закъснения · около 55/);
    expect(on.zone).toMatchObject({ n: "Дружба 2", etaMin: 25, busyMin: 45 });
    at("19:06");
    const during = await table("S2", [line(KEBAP)]);
    expect(during.kBusy).toBe(20);
    const slot = await pickup([line(KEBAP)], { slot: "20:15" });
    at("19:10");
    const off = await core.kitchen.setBusy(s.manager, false);
    expect(off).toMatchObject({ on: false, by: null, at: null, same: false });
    const after = await table("S3", [line(KEBAP)]);
    const q = await core.kitchen.queue(k, "skara");
    expect(q.tickets.map((t) => [t.no, t.dueHm, t.busyMin])).toEqual([[before.no, "19:20", 0], [during.no, "19:46", 20], [after.no, "19:30", 0]]);
    expect(q.later.map((t) => [t.no, t.forHm, t.enterHm])).toEqual([[slot.no, "20:15", "19:55"]]);
    /* the day's log, who and when; a repeat changes nothing */
    expect(off.log).toEqual([{ on: on.at, onHm: "19:05", off: new Date(Date.parse(DAY + "T19:10:00+02:00")).toISOString(), offHm: "19:10", by: "Кухня · Скара", offBy: "Управител" }]);
    expect((await core.kitchen.setBusy(k, false)).same).toBe(true);
    const ev = events.filter((e) => e.type === "kitchen.busy");
    expect(ev.map((e) => [e.data.busy, e.to])).toEqual([[true, { public: true }], [false, { public: true }]]);
    expect(JSON.stringify(ev)).not.toMatch(/Кухня|Скара|kitchen"|manager/); /* public: no names */
    expect(Object.keys(ev[0].data).sort()).toEqual(["at", "busy", "etaBusyMin", "etaMin", "extra"]);
  });

  it("who switched it: the section, the head chef, the role of a boss; the settings view of the admin shows it; the reminder after 60 min", async () => {
    const { core, k, s, at } = await mk("18:00");
    expect((await core.kitchen.setBusy(k, true, { sec: "all" })).by).toBe("Главен готвач");
    expect((await core.settings.view()).kitchen).toMatchObject({ busy: true, busyBy: "Главен готвач" });
    await core.kitchen.setBusy(k, false, { sec: "all" });
    /* from the admin's "Настройки" (settings.update): the role of the account, the same log and event */
    const st = await core.settings.update({ kitchen: { busy: true } }, "manager");
    expect(st.kitchen.busyBy).toBe("Управител");
    at("18:59"); expect((await core.kitchen.busy(k)).remind).toBe(false);
    at("19:00"); expect(await core.kitchen.busy(k)).toMatchObject({ on: true, by: "Управител", remind: true, remindAfterMin: 60 });
    /* the minutes changed in the admin do not change who switched it on */
    expect((await core.settings.update({ kitchen: { etaMin: 30 } }, "owner")).kitchen).toMatchObject({ busy: true, busyBy: "Управител", etaMin: 30 });
    expect((await core.kitchen.busy(k)).log.map((x) => [x.by, x.offBy, x.offHm])).toEqual([["Управител", "", ""], ["Главен готвач", "Главен готвач", "18:00"]]);
    expect((await core.audit.list({ action: "kitchen.busy" })).map((a) => [a.action, a.actor, (a.data as { by: string }).by])).toEqual(expect.arrayContaining([["kitchen.busy_on", "kitchen", "Главен готвач"], ["kitchen.busy_off", "kitchen", "Главен готвач"], ["kitchen.busy_on", "manager", "Управител"]]));
  });
});

describe("„По-късно“", () => {
  it("an order for an hour waits, enters the queue 20 min before the hour, its deadline is the hour", async () => {
    const { core, k, at, line, pickup, table } = await mk("19:30");
    const tomorrow = await pickup([line(KEBAP)], { sched: "утре", slot: "12:30" });
    const slot = await pickup([line(KEBAP), line(PIZZA)], { slot: "20:15" });
    at("19:40"); const now = await table("S1", [line(KEBAP)]);
    let q = await core.kitchen.queue(k, "skara");
    expect(q.tickets.map((t) => t.no)).toEqual([now.no]);
    expect(q.later.map((t) => [t.no, t.forHm, t.enterHm, t.tomorrow, t.lines.map((l) => l.name)])).toEqual([[slot.no, "20:15", "19:55", false, ["Кебапчета"]], [tomorrow.no, "12:30", "12:10", true, ["Кебапчета"]]]);
    expect(q.counts.later).toBe(2);
    at("19:54", 59);
    expect((await core.kitchen.queue(k, "skara")).tickets.map((t) => t.no)).toEqual([now.no]);
    at("19:55");
    q = await core.kitchen.queue(k, "skara");
    expect(q.tickets.map((t) => t.no)).toEqual([now.no, slot.no]); /* its place in the FIFO is the moment it entered */
    expect(q.tickets[1]).toMatchObject({ sched: true, forHm: "20:15", dueHm: "20:15", enterHm: "19:55", arrivedHm: "19:30", timer: "ok", left: 1200, src: { k: "Вземане" } });
    expect(q.later.map((t) => t.no)).toEqual([tomorrow.no]);
    /* the next day */
    at("12:09", 0, "2026-11-17");
    expect((await core.kitchen.queue(k, "skara")).later.map((t) => [t.no, t.tomorrow])).toEqual([[tomorrow.no, false]]);
    at("12:10", 0, "2026-11-17");
    expect((await core.kitchen.queue(k, "skara")).tickets.map((t) => [t.no, t.dueHm])).toContainEqual([tomorrow.no, "12:30"]);
    expect((await core.kitchen.summary(k)).totals.later).toBe(0);
  });
});

describe("lines, sections, the status", () => {
  it("„Започни“ -> „Готви се“; a line ready; the last line = the section is ready; every section ready = „Готова“", async () => {
    const { core, k, at, line, table, order, events } = await mk("19:00");
    const o = await table("S12", [line(KEBAP, 2), line(VRAT), line(PIZZA)]);
    at("19:02");
    const st = await core.kitchen.start(k, o.no, "skara");
    expect(st).toMatchObject({ same: false, status: "cooking", changed: [0, 1], secReady: false, orderReady: false, notify: [] });
    expect(st.ticket).toMatchObject({ startedHm: "19:02", isNew: false, status: "cooking" });
    expect((await order(o.no)).lines.map((l) => [l.ks, l.cookAt ? "c" : ""])).toEqual([["cook", "c"], ["cook", "c"], ["wait", ""]]);
    expect((await order(o.no)).times!.cooking).toBe(new Date(Date.parse(DAY + "T19:02:00+02:00")).toISOString());
    expect((await core.kitchen.start(k, o.no, "skara")).same).toBe(true);
    /* the oven sees the grill as „готви се“ */
    expect((await core.kitchen.queue(k, "pesht")).tickets[0].others.map((x) => [x.short, x.state])).toEqual([["Скара", "cook"], ["Скара", "cook"]]);

    at("19:10");
    const l0 = await core.kitchen.line(k, o.no, 0, true, { sec: "skara" });
    expect(l0).toMatchObject({ same: false, changed: [0], secReady: false, orderReady: false, notify: [], msg: "" });
    expect(l0.ticket!.lines.map((l) => l.ks)).toEqual(["ready", "cook"]);
    at("19:15");
    const l1 = await core.kitchen.line(k, o.no, 1, true, { sec: "skara" });
    /* the last line of the grill: the ticket leaves its queue exactly as with „Готово“, the waiter is told */
    expect(l1).toMatchObject({ secReady: true, orderReady: false, status: "cooking", ticket: null, notify: ["waiter"], waiting: ["Пещ"], msg: "Известихме сервитьора. Още чака: Пещ." });
    expect((await core.kitchen.queue(k, "skara")).tickets).toEqual([]);
    expect((await core.kitchen.queue(k, "pesht")).tickets[0].others.map((x) => x.state)).toEqual(["ready", "ready"]);
    const ready = events.filter((e) => e.type === "order.line" && e.data.kind === "sec_ready");
    expect(ready).toHaveLength(1);
    expect(ready[0].data).toMatchObject({ no: o.no, sec: "skara", table: "S12", notify: ["waiter"], orderReady: false, lines: [1] });

    at("19:18");
    const fin = await core.kitchen.done(k, o.no, "pesht");
    expect(fin).toMatchObject({ changed: [2], secReady: true, orderReady: true, status: "ready", ticket: null, notify: ["waiter"], waiting: [], msg: "Известихме сервитьора." });
    const end = await order(o.no);
    expect(end.status).toBe("ready");
    expect(end.times!.ready).toBe(new Date(Date.parse(DAY + "T19:18:00+02:00")).toISOString());
    expect(end.lines.map((l) => [l.ks, !!l.readyAt])).toEqual([["ready", true], ["ready", true], ["ready", true]]);
    expect(events.filter((e) => e.type === "order.status").map((e) => e.data.status)).toEqual(["cooking", "ready"]);
    expect((await core.kitchen.done(k, o.no, "pesht")).same).toBe(true);
    expect((await core.kitchen.queue(k, "all")).tickets).toEqual([]);
  });

  it("delivery and pickup: the driver and the customer are told only when every section is ready; a ticked line without „Започни“ starts the order", async () => {
    const { core, k, line, delivery, pickup, order, events } = await mk("19:00");
    const d = await delivery([line(KEBAP), line(PIZZA)]);
    const a = await core.kitchen.line(k, d.no, 0, true, { sec: "skara" });
    expect(a).toMatchObject({ sec: "skara", secReady: true, orderReady: false, status: "cooking", notify: [], waiting: ["Пещ"], msg: "Чака още Пещ. Шофьорът ще бъде известен, когато всичко е готово." });
    expect((await order(d.no)).lines.map((l) => l.ks)).toEqual(["ready", "wait"]);
    const b = await core.kitchen.done(k, d.no, "all");
    expect(b).toMatchObject({ orderReady: true, status: "ready", notify: ["driver", "customer"], msg: "Известихме шофьора." });
    const p = await pickup([line(KEBAP), line(SALAD)]);
    expect((await core.kitchen.done(k, p.no, "studeni")).msg).toBe("Чака още Скара. Клиентът ще бъде известен, когато всичко е готово.");
    expect(await core.kitchen.done(k, p.no, "skara")).toMatchObject({ status: "ready", notify: ["customer"], msg: "Известихме клиента." });
    expect(events.filter((e) => e.type === "order.line" && e.data.kind === "sec_ready").map((e) => [e.data.no, e.data.sec, e.data.notify])).toEqual([
      [d.no, "skara", []], [d.no, "pesht", ["driver", "customer"]], [p.no, "studeni", []], [p.no, "skara", ["customer"]]]);
    /* a line of another section, an unknown line, an unknown order */
    const x = await pickup([line(KEBAP), line(SALAD)]);
    expect(await code(core.kitchen.line(k, x.no, 1, true, { sec: "skara" }))).toBe("bad_line:422");
    expect(await code(core.kitchen.line(k, x.no, 7, true, { sec: "skara" }))).toBe("bad_line:422");
    expect(await code(core.kitchen.done(k, "999", "skara"))).toBe("not_found:404");
  });
});

describe("„Върни“", () => {
  it("back to the queue with the same call; an order that became „Готова“ returns to „Готви се“", async () => {
    const { core, k, at, line, table, order, events } = await mk("19:00");
    const o = await table("S1", [line(KEBAP), line(VRAT), line(PIZZA)]);
    await core.kitchen.start(k, o.no, "skara");
    at("19:05"); await core.kitchen.line(k, o.no, 0, true, { sec: "skara" });
    at("19:10");
    const fin = await core.kitchen.done(k, o.no, "skara");
    expect(fin.changed).toEqual([1]);
    /* exactly the lines „Готово“ changed: the line ticked before stays ready */
    const back = await core.kitchen.back(k, o.no, "skara", { lines: fin.changed });
    expect(back).toMatchObject({ same: false, changed: [1], secReady: false, status: "cooking", notify: ["waiter"], msg: "Известихме сервитьора, че поръчката още не е готова." });
    expect(back.ticket!.lines.map((l) => [l.ks, l.readyAt != null])).toEqual([["ready", true], ["cook", false]]);
    expect((await core.kitchen.back(k, o.no, "skara", { lines: [1] })).same).toBe(true);
    /* a single line back and forth (the second tap within 0,8 s is the screen's job; the core only sets a state) */
    expect((await core.kitchen.line(k, o.no, 0, false, { sec: "skara" })).ticket!.lines.map((l) => l.ks)).toEqual(["cook", "cook"]);
    await core.kitchen.done(k, o.no, "skara");
    await core.kitchen.done(k, o.no, "pesht");
    expect((await order(o.no)).status).toBe("ready");
    at("19:12");
    const b2 = await core.kitchen.back(k, o.no, "pesht");
    expect(b2).toMatchObject({ status: "cooking", changed: [2], notify: ["waiter"] });
    expect(b2.ticket!.lines.map((l) => l.ks)).toEqual(["wait"]); /* the oven never pressed „Започни“ */
    expect((await order(o.no)).status).toBe("cooking");
    expect(events.filter((e) => e.type === "order.status").map((e) => e.data.status)).toEqual(["cooking", "ready", "cooking"]);
    expect(await code(core.kitchen.back(k, o.no, "skara", { lines: [2] }))).toBe("bad_line:422");
  });

  it("a clear error once somebody served or took it", async () => {
    const { core, ctx, k, s, line, table, delivery, order } = await mk("19:00");
    /* the waiter served a line of the grill */
    const t = await table("S1", [line(KEBAP), line(PIZZA)]);
    await core.kitchen.done(k, t.no, "all");
    const served = await order(t.no);
    served.lines[0].servedAt = new Date(ctx.now!()).toISOString();
    await ctx.repo.put("orders", served);
    expect(await code(core.kitchen.back(k, t.no, "skara"))).toBe("served:409");
    expect(await code(core.kitchen.line(k, t.no, 0, false, { sec: "skara" }))).toBe("served:409");
    expect((await core.kitchen.back(k, t.no, "pesht")).status).toBe("cooking"); /* the pizza is still on the pass */
    /* „Взех“ of the driver, then on the way */
    const d = await delivery([line(KEBAP)]);
    await core.kitchen.done(k, d.no, "skara");
    const taken = await order(d.no);
    taken.pickedAt = new Date(ctx.now!()).toISOString();
    await ctx.repo.put("orders", taken);
    const e1 = await core.kitchen.back(k, d.no, "skara").catch((e) => e as CoreError);
    expect(e1).toMatchObject({ code: "taken", status: 409, message: "Шофьорът вече взе поръчката и тя не може да се върне в опашката." });
    await core.orders.setStatus(d.no, "on_way", "driver", s.driver);
    const e2 = await core.kitchen.back(k, d.no, "skara").catch((e) => e as CoreError);
    expect(e2).toMatchObject({ code: "closed", status: 409, message: "Поръчката вече е на път и не може да се върне в опашката." });
    expect((await core.kitchen.doneToday(k, "skara")).rows.map((r) => [r.no, r.canBack])).toEqual([[d.no, false], [t.no, false]]);
    /* a repeat of „Готово“ on a closed order changes nothing and is not an error (an action sent twice) */
    expect((await core.kitchen.done(k, d.no, "skara")).same).toBe(true);
  });
});

describe("„Изпълнени днес“", () => {
  it("newest first: when, the section's lines, „за 19 мин · навреме“ / „с 3 мин закъснение“, „Върни в опашката“", async () => {
    const { core, k, at, line, table, delivery } = await mk("19:00");
    const a = await table("S11", [line(KEBAP, 2), line(PIZZA)]);
    at("19:05"); const b = await delivery([line(VRAT)]);
    at("19:19"); await core.kitchen.done(k, a.no, "skara");
    at("19:28"); await core.kitchen.done(k, b.no, "skara");
    at("19:30");
    const d = await core.kitchen.doneToday(k, "skara");
    expect(d.counts).toEqual({ n: 2, onTime: 1 });
    expect(d.rows.map((r) => [r.no, r.doneHm, r.src.text, r.text, r.lateText, r.onTime, r.canBack, r.lines.map((l) => l.q + " × " + l.name)])).toEqual([
      [b.no, "19:28", "Доставка № " + b.no, "за 23 мин", "с 3 мин закъснение", false, true, ["1 × Свински врат"]],
      [a.no, "19:19", "Маса 11", "за 19 мин", "навреме", true, true, ["2 × Кебапчета"]],
    ]);
    expect((await core.kitchen.doneToday(k, "pesht")).rows).toEqual([]); /* the oven has not finished its pizza */
    /* „Върни в опашката“: the same call as „Върни“ */
    const back = await core.kitchen.back(k, a.no, "skara");
    expect(back.ticket!.no).toBe(a.no);
    expect((await core.kitchen.doneToday(k, "skara")).rows.map((r) => r.no)).toEqual([b.no]);
    /* the next shift day starts empty */
    at("10:00", 0, "2026-11-17");
    expect((await core.kitchen.doneToday(k, "skara")).rows).toEqual([]);
    /* the empty queue says what was finished last */
    at("19:31");
    await core.kitchen.done(k, a.no, "all");
    expect((await core.kitchen.queue(k, "skara")).lastDone).toEqual({ text: "Маса 11", hm: "19:31" });
  });
});

describe("„Изчерпано днес“", () => {
  it("one switch for everyone; accepted, unfinished orders with the dish are marked; the result says who is told", async () => {
    const { core, k, s, at, line, table, delivery, pickup, order, events } = await mk("19:00");
    const t = await table("S3", [line(KEBAP, 3), line(FRIES)]);
    const d = await delivery([line(KEBAP), line(PIZZA)]);
    const done = await table("S4", [line(KEBAP)]);
    await core.kitchen.done(k, done.no, "skara"); /* already cooked: not touched */
    const other = await table("S5", [line(VRAT)]);
    const tomorrow = await pickup([line(KEBAP)], { sched: "утре", slot: "12:00" });
    at("19:05");
    const r = await core.kitchen.setOut(k, KEBAP, true, { sec: "skara" });
    expect(r).toMatchObject({ same: false, id: KEBAP, n: "Кебапчета", out: true, orders: 2, nos: [t.no, d.no], waiter: true, manager: true, who: "сервитьора и управителя (доставка и вземане)",
      msg: "В 2 приети поръчки · известихме сервитьора и управителя." });
    expect((await order(t.no)).lines.map((l) => !!l.out)).toEqual([true, false]);
    expect((await order(d.no)).lines.map((l) => !!l.out)).toEqual([true, false]);
    for (const no of [done.no, other.no, tomorrow.no]) expect((await order(no)).lines.some((l) => l.out)).toBe(false);
    expect(events.filter((e) => e.type === "order.line" && e.data.kind === "out").map((e) => [e.data.no, e.data.notify, e.data.out])).toEqual([[t.no, ["waiter"], true], [d.no, ["manager"], true]]);
    expect(events.filter((e) => e.type === "menu.soldout").map((e) => [e.data, e.to])).toEqual([[{ id: KEBAP, out: true }, { public: true }]]);
    /* the one source: the cart check refuses it, the menu of the site says it */
    expect(await code(table("S6", [line(KEBAP)]))).toBe("sold_out:409");
    expect(await core.menu.soldOutToday()).toEqual({ [KEBAP]: true });
    /* the ticket and „Други секции“ carry the label */
    expect((await core.kitchen.queue(k, "skara")).tickets.map((x) => [x.no, x.lines.map((l) => l.out)])).toEqual([[t.no, [true]], [d.no, [true]], [other.no, [false]]]);
    expect((await core.kitchen.queue(k, "pesht")).tickets[0].others.map((x) => [x.name, x.out])).toEqual([["Кебапчета", true]]);
    /* a repeat marks nothing twice and tells nobody again */
    const again = await core.kitchen.setOut(k, KEBAP, true, { sec: "skara" });
    expect(again).toMatchObject({ same: true, orders: 2 });
    expect(events.filter((e) => e.type === "order.line" && e.data.kind === "out")).toHaveLength(2);
    /* the list: who and when; the tiles of the section + the shared add-ons */
    const v = await core.kitchen.soldOut(k, "skara");
    expect(v.list.find((x) => x.id === KEBAP)).toMatchObject({ n: "Кебапчета", sec: "skara", secName: "Скара Bertha", atHm: "19:05", by: "Кухня · Скара", mine: true });
    expect(v.groups.map((g) => [g.n, g.shared])).toEqual([["Скара Bertha", false], ["Добавки", true]]);
    expect(v.groups[0].items.find((x) => x.id === KEBAP)!.out).toBe(true);
    expect(v.resets).toBe("В полунощ се връща в менюто всичко, отбелязано днес тук.");
    expect(v.list.find((x) => x.id === KEBAP)!.menu).toBe(false);
    expect((await core.kitchen.soldOut(k, "topla")).groups.map((g) => g.n)).toEqual(["Супи", "Топли предястия", "Основни ястия", "Паста и ризото", "Гарнитури", "Бургери", "Закуски", "Добавки"]);
    expect((await core.kitchen.soldOut(k, "topla")).list.find((x) => x.id === KEBAP)!.mine).toBe(false);
    expect((await core.kitchen.queue(k, "skara")).counts).toMatchObject({ out: v.counts.mine, outAll: v.counts.all });
    /* „Върни“ clears the flag */
    const back = await core.kitchen.setOut(s.manager, KEBAP, false);
    expect(back).toMatchObject({ same: false, out: false, orders: 2, waiter: false, manager: false, who: "", msg: "Бутонът „+“ се върна навсякъде." });
    expect((await order(t.no)).lines.some((l) => l.out)).toBe(false);
    expect((await order(d.no)).lines.some((l) => l.out)).toBe(false);
    expect(await code(core.kitchen.setOut(k, "no-such-dish", true))).toBe("not_found:404");
  });

  it("a sold-out add-on marks the dishes that carry it („+ гъби · изчерпано днес“); one order: only the waiter or only the manager", async () => {
    const { core, k, line, table, delivery, order } = await mk("19:00");
    const t = await table("S1", [line(PIZZA, 1, ["+ Гъби"]), line(PIZZA)]);
    const r = await core.kitchen.setOut(k, "gabi", true, { sec: "pesht" });
    expect(r).toMatchObject({ orders: 1, waiter: true, manager: false, who: "сервитьора", msg: "В 1 приета поръчка · известихме сервитьора." });
    expect((await order(t.no)).lines.map((l) => !!l.out)).toEqual([true, false]);
    const tk = (await core.kitchen.queue(k, "pesht")).tickets[0];
    expect(tk.lines.map((l) => [l.out, l.add])).toEqual([[false, [{ n: "Гъби", out: true }]], [false, []]]);
    expect((await core.kitchen.soldOut(k, "skara")).list.map((x) => [x.id, x.sec, x.mine])).toContainEqual(["gabi", "shared", true]);
    /* the pizza too: the line stays marked until both are back */
    await core.kitchen.setOut(k, PIZZA, true);
    await core.kitchen.setOut(k, "gabi", false);
    expect((await order(t.no)).lines.map((l) => !!l.out)).toEqual([true, true]);
    const d = await delivery([line(SALAD)]);
    expect(await core.kitchen.setOut(k, SALAD, true)).toMatchObject({ orders: 1, nos: [d.no], waiter: false, manager: true, who: "управителя (доставка и вземане)" });
    expect(await core.kitchen.setOut(k, SOUP, true)).toMatchObject({ orders: 0, msg: "Сайт, QR и сервитьор: без „+“. Wolt и Foodpanda: скрито." });
  });

  it("today only: at midnight (Sofia) the dish is back and the label is gone", async () => {
    const { core, k, at, line, table } = await mk("22:00");
    await table("S1", [line(KEBAP)]);
    await core.kitchen.setOut(k, KEBAP, true);
    at("23:59");
    expect((await core.kitchen.queue(k, "skara")).tickets[0].lines[0].out).toBe(true);
    at("00:00", 0, "2026-11-17");
    expect((await core.kitchen.queue(k, "skara")).tickets[0].lines[0].out).toBe(false);
    expect((await core.kitchen.soldOut(k, "skara")).list.find((x) => x.id === KEBAP)).toBeUndefined();
  });
});

describe("rights", () => {
  it("the section „Кухня“ and the bosses; the waiter, the driver and marketing get 403, no session 401", async () => {
    const { core, s, line, table } = await mk();
    const o = await table("S1", [line(KEBAP)]);
    const calls: [string, (x: StaffCtx) => Promise<unknown>][] = [
      ["config", (x) => core.kitchen.config(x)], ["queue", (x) => core.kitchen.queue(x, "skara")], ["start", (x) => core.kitchen.start(x, o.no, "skara")],
      ["line", (x) => core.kitchen.line(x, o.no, 0, true, { sec: "skara" })], ["done", (x) => core.kitchen.done(x, o.no, "skara")], ["back", (x) => core.kitchen.back(x, o.no, "skara")],
      ["seen", (x) => core.kitchen.seen(x, o.no, "skara")], ["doneToday", (x) => core.kitchen.doneToday(x, "skara")], ["summary", (x) => core.kitchen.summary(x)],
      ["soldOut", (x) => core.kitchen.soldOut(x, "skara")], ["setOut", (x) => core.kitchen.setOut(x, SALAD, true)], ["busy", (x) => core.kitchen.busy(x)],
      ["setBusy", (x) => core.kitchen.setBusy(x, false)], ["beat", (x) => core.kitchen.beat(x, "skara")], ["tablets", (x) => core.kitchen.tablets(x)], ["search", (x) => core.kitchen.search(x, "skara", "маса")],
    ];
    for (const [name, fn] of calls) {
      const ok: RoleId[] = [];
      for (const r of ROLES) { const c = await code(fn(s[r])); if (c !== "forbidden:403") ok.push(r); expect(["ok", "forbidden:403"], name + " " + r).toContain(c); }
      expect(ok, name).toEqual(["admin", "owner", "manager", "kitchen"]);
      expect(await code(fn(null as never)), name).toBe("auth:401");
    }
    /* a manager whose role lost the section still may (the bosses may do everything in the kitchen) */
    await core.staff.setRole("manager", ["dashboard", "orders"], "admin");
    const m = (await core.staff.bySession((await core.staff.login("manager", PW, "9.9.9.9")).token))!;
    expect(m.sections).not.toContain("kitchen");
    expect((await core.kitchen.queue(m, "all")).tickets.map((t) => t.no)).toEqual([o.no]);
  });

  it("the kitchen moves only „Приета“ -> „Готви се“ -> „Готова“: never ready -> on_way", async () => {
    const { core, k, s, line, delivery, order } = await mk();
    const d = await delivery([line(KEBAP)]);
    await core.kitchen.done(k, d.no, "skara");
    expect((await order(d.no)).status).toBe("ready");
    expect(await code(core.ordersAdmin.step(k, d.no, "on_way"))).toBe("bad_step:409");
    expect(await code(core.orders.setStatus(d.no, "on_way", "kitchen", k))).toBe("bad_step:409");
    expect((await order(d.no)).status).toBe("ready");
    /* the driver does; then the kitchen's actions on it are refused clearly */
    await core.orders.setStatus(d.no, "on_way", "driver", s.driver);
    const e = await core.kitchen.line(k, d.no, 0, false, { sec: "skara" }).catch((x) => x as CoreError);
    expect(e).toMatchObject({ code: "closed", status: 409 });
  });
});

describe("idempotence and the time of an action", () => {
  it("a repeat changes nothing and writes nothing; the log has one line per action", async () => {
    const { core, k, line, table, events } = await mk("19:00");
    const o = await table("S1", [line(KEBAP), line(VRAT)]);
    const a = await core.kitchen.line(k, o.no, 0, true, { sec: "skara" });
    const n = events.length;
    const b = await core.kitchen.line(k, o.no, 0, true, { sec: "skara" });
    expect([a.same, b.same, b.changed]).toEqual([false, true, []]);
    expect(events.length).toBe(n);
    await core.kitchen.done(k, o.no, "skara");
    await core.kitchen.done(k, o.no, "skara");
    await core.kitchen.start(k, o.no, "skara"); /* nothing waits any more */
    const log = (await core.audit.list({ action: "kitchen." })).map((x) => [x.action, x.actor, x.target]);
    expect(log.sort()).toEqual([["kitchen.done", "kitchen", o.no], ["kitchen.line", "kitchen", o.no]]);
  });

  it("`at`: an action kept offline keeps its real time; not in the future, not before the shift day", async () => {
    const { core, ctx, k, at, line, table, order } = await mk("19:00");
    const o = await table("S1", [line(KEBAP), line(VRAT)]);
    at("19:30"); /* the connection is back at 19:30; the lines were ticked at 19:12 and 19:14 */
    const t1 = Date.parse(DAY + "T19:12:00+02:00"), t2 = new Date(Date.parse(DAY + "T19:14:00+02:00")).toISOString();
    await core.kitchen.line(k, o.no, 0, true, { sec: "skara", at: t1 });
    await core.kitchen.line(k, o.no, 1, true, { sec: "skara", at: t2 });
    const r = await order(o.no);
    expect(r.lines.map((l) => l.readyAt)).toEqual([new Date(t1).toISOString(), t2]);
    expect(r.times).toMatchObject({ cooking: new Date(t1).toISOString(), ready: t2 });
    expect((await core.kitchen.doneToday(k, "skara")).rows[0]).toMatchObject({ doneHm: "19:14", text: "за 14 мин", lateText: "навреме" });
    /* a tablet whose clock runs behind: never before the order itself */
    const o0 = await table("S9", [line(KEBAP)]);
    await core.kitchen.done(k, o0.no, "skara", { at: Date.parse(DAY + "T19:20:00+02:00") });
    expect((await order(o0.no)).lines[0].readyAt).toBe(o0.createdAt);
    /* a tablet a few seconds ahead is fine (the server's now is used); a minute ahead is refused */
    const now = ctx.now!().getTime();
    expect(actionAt(ctx, now + 30_000).getTime()).toBe(now);
    const o2 = await table("S2", [line(KEBAP)]);
    for (const bad of [now + 61_000, "not a time", Date.parse(DAY + "T03:59:00+02:00"), "2026-11-15T19:00:00+02:00"]) {
      const e = await core.kitchen.line(k, o2.no, 0, true, { sec: "skara", at: bad as never }).catch((x) => x as CoreError & { fields?: Record<string, string> });
      expect(e, String(bad)).toMatchObject({ code: "bad_at", status: 422 });
      expect((e as { fields?: Record<string, string> }).fields!.at).toBeTruthy();
    }
    expect(await code(core.kitchen.start(k, o2.no, "skara", { at: now + 3_600_000 }))).toBe("bad_at:422");
    expect(await code(core.kitchen.done(k, o2.no, "skara", { at: "x" }))).toBe("bad_at:422");
    expect(await code(core.kitchen.setBusy(k, true, { at: now + 3_600_000 }))).toBe("bad_at:422");
    expect(await code(core.kitchen.setOut(k, SALAD, true, { at: now + 3_600_000 }))).toBe("bad_at:422");
    expect((await order(o2.no)).lines[0].ks).toBe("wait");
    /* the shift day starts at 04:00: an action made at 23:58 and sent at 00:02 counts */
    expect(new Date(shiftStart(new Date(Date.parse("2026-11-17T00:02:00+02:00")))).toISOString()).toBe(new Date(Date.parse(DAY + "T04:00:00+02:00")).toISOString());
    at("00:02", 0, "2026-11-17");
    expect((await core.kitchen.line(k, o2.no, 0, true, { sec: "skara", at: Date.parse(DAY + "T23:58:00+02:00") })).same).toBe(false);
    expect((await core.kitchen.setBusy(k, true, { sec: "skara", at: Date.parse(DAY + "T23:50:00+02:00") })).atHm).toBe("23:50");
  });
});

describe("tablets and „Общ изглед“", () => {
  it("the heartbeat: „Таблетът работи“, then „без връзка от 19:37“; only the kitchen's own account counts", async () => {
    const { core, k, s, at, events } = await mk("19:37");
    expect((await core.kitchen.tablets(s.manager)).map((t) => [t.sec, t.online, t.text])).toEqual([["topla", false, "Няма таблет днес"], ["skara", false, "Няма таблет днес"], ["pesht", false, "Няма таблет днес"], ["studeni", false, "Няма таблет днес"], ["all", false, "Няма таблет днес"]]);
    expect(await core.kitchen.beat(k, "skara", { device: "tab-1" })).toMatchObject({ ok: true, counted: true });
    expect(await core.kitchen.beat(s.manager, "pesht")).toMatchObject({ counted: false });
    at("19:38", 30);
    const t1 = await core.kitchen.tablets(s.manager);
    expect(t1.find((t) => t.sec === "skara")).toMatchObject({ n: "Скара Bertha", online: true, lastHm: "19:37", text: "Таблетът работи" });
    expect(t1.find((t) => t.sec === "pesht")).toMatchObject({ online: false, text: "Няма таблет днес" });
    at("19:38", 31);
    expect((await core.kitchen.tablets(s.manager)).find((t) => t.sec === "skara")).toMatchObject({ online: false, lastHm: "19:37", text: "без връзка от 19:37" });
    expect((await core.kitchen.summary(k)).totals.tabletsOnline).toBe(0);
    await core.kitchen.beat(k, "skara");
    await core.kitchen.beat(k, "skara");
    expect((await core.kitchen.summary(k)).sections.find((x) => x.id === "skara")!.tablet).toMatchObject({ online: true, text: "Таблетът работи" });
    /* the manager's screen hears a tablet coming back (twice: the first beat and the one after the gap) */
    expect(events.filter((e) => e.type === "shift.update").map((e) => [e.data.what, e.data.sec, e.data.online])).toEqual([["tablet", "skara", true], ["tablet", "skara", true]]);
    expect(await code(core.kitchen.beat(k, "bar"))).toBe("bad_sec:422");
  });

  it("the summary: per section how many wait, are late, are close, the oldest, sold out; the orders in work with the state per section", async () => {
    const { core, k, at, line, table, delivery, pickup } = await mk("19:18");
    const a = await table("S12", [line(KEBAP), line(PIZZA), line(SALAD)]);
    at("19:26"); const d = await delivery([line(PIZZA), line(SOUP)]);
    await pickup([line(KEBAP)], { slot: "20:15" });
    at("19:30");
    await core.kitchen.start(k, a.no, "skara");
    await core.kitchen.done(k, a.no, "studeni");
    await core.kitchen.setOut(k, KEBAP, true);
    await core.kitchen.setBusy(k, true, { sec: "all" });
    at("19:42");
    const v = await core.kitchen.summary(k);
    expect(v.sections.map((x) => [x.id, x.wait, x.late, x.soon, x.oldestMin, x.out])).toEqual([["topla", 1, 0, 1, 16, 0], ["skara", 1, 1, 0, 24, 2], ["pesht", 2, 1, 1, 24, 0], ["studeni", 0, 0, 0, null, 0]]);
    expect(v.totals).toMatchObject({ orders: 2, late: 1, soon: 1, later: 1, tabletsOnline: 0 });
    expect(v.totals.out).toBe(2); /* „Плескавица“ is sold out in the menu data, „Кебапчета“ by the switch */
    expect(v.rows.map((r) => [r.no, r.src.text, r.arrivedHm, r.dueHm, r.timer, r.left, r.secs.map((x) => x.short + " · " + x.state)])).toEqual([
      [a.no, "Маса 12", "19:18", "19:38", "late", -240, ["Скара · cook", "Пещ · wait", "Салати · ready"]],
      [d.no, "Доставка № " + d.no, "19:26", "19:46", "soon", 240, ["Топла · wait", "Пещ · wait"]],
    ]);
    expect(v.busy).toMatchObject({ on: true, by: "Главен готвач", atHm: "19:30", extra: 20 });
    expect(v.missing).toEqual([K_MISSING.sections, K_MISSING.norms]);
  });
});

describe("„Търси“", () => {
  it("only the waiting orders of the section: number, table, channel, late / close, dish (also in Latin letters), „По-късно“", async () => {
    const { core, k, at, line, table, delivery, pickup } = await mk("19:18");
    const t12 = await table("S12", [line(KEBAP, 2), line(PIZZA)]);
    at("19:26"); const d = await delivery([line(VRAT), line(SALAD)]);
    at("19:30"); const p = await pickup([line(KEBAP)]);
    const later = await pickup([line(KEBAP), line(SALAD)], { slot: "20:15" });
    const done = await table("S3", [line(KEBAP)]);
    await core.kitchen.done(k, done.no, "skara"); /* finished: not in the search */
    at("19:42");
    const f = async (q: string, sec = "skara") => { const r = await core.kitchen.search(k, sec, q); return [r.act.map((x) => x.no), r.later.map((x) => x.no)]; };
    expect(await f(d.no)).toEqual([[d.no], []]);
    expect(await f("маса 12")).toEqual([[t12.no], []]);
    expect(await f("12")).toEqual([[t12.no], []]);
    expect(await f("доставка")).toEqual([[d.no], []]);
    expect(await f("вземане")).toEqual([[p.no], [later.no]]);
    expect(await f("закъснява")).toEqual([[t12.no], []]);
    expect(await f("наближава")).toEqual([[d.no], []]);
    expect(await f("кебап")).toEqual([[t12.no, p.no], [later.no]]);
    expect(await f("kebap")).toEqual([[t12.no, p.no], [later.no]]);
    expect(await f("")).toEqual([[], []]);
    expect(await f("xyzq")).toEqual([[], []]);
    /* the section is checked in the core: the grill does not find the pizza or the salad of its own orders */
    expect(await f("пица")).toEqual([[], []]);
    expect(await f("шопска")).toEqual([[], []]);
    expect(await f("пица", "pesht")).toEqual([[t12.no], []]);
    expect(await f("шопска", "all")).toEqual([[d.no], [later.no]]);
    const r = await core.kitchen.search(k, "skara", "кебап");
    expect(r.act[0]).toMatchObject({ src: { text: "Маса 12" }, lines: [{ q: 2, name: "Кебапчета", hit: true }], timer: "late", left: -240, later: false });
    expect(r.later[0]).toMatchObject({ later: true, enterHm: "19:55", timer: "", lines: [{ q: 1, name: "Кебапчета", hit: true }] });
    expect(r.dish).toContain(KEBAP);
  });
});

describe("проверка 2 на кухнята (decisions of the chief 18.11)", () => {
  it("„Изчерпано“ after „Започни“: only the waiting lines are marked; a line being cooked or ready is made and paid; back in the menu clears every mark of today", async () => {
    const { core, k, at, line, table, order } = await mk("19:00");
    const cooking = await table("S1", [line(KEBAP, 2), line(PIZZA)]);
    await core.kitchen.start(k, cooking.no, "pesht"); /* the last dough goes into this pizza */
    const waiting = await table("S2", [line(PIZZA)]);
    at("19:05");
    const r = await core.kitchen.setOut(k, PIZZA, true, { sec: "pesht" });
    expect(r).toMatchObject({ orders: 1, nos: [waiting.no] });
    expect((await order(cooking.no)).lines.map((l) => [l.ks, !!l.out])).toEqual([["wait", false], ["cook", false]]);
    expect((await order(waiting.no)).lines.map((l) => !!l.out)).toEqual([true]);
    /* the tablet shows "Изчерпано днес" only on the waiting line */
    const pq = (await core.kitchen.queue(k, "pesht")).tickets;
    expect(pq.find((x) => x.no === cooking.no)!.lines[0].out).toBe(false);
    expect(pq.find((x) => x.no === waiting.no)!.lines[0].out).toBe(true);
    /* the cooking pizza goes on to "Готово" normally */
    await core.kitchen.done(k, cooking.no, "pesht");
    expect((await order(cooking.no)).lines[1]).toMatchObject({ ks: "ready" });
    expect((await order(cooking.no)).lines[1].out).toBeUndefined();
    /* a mark set while the line waited stays after it is started and ready; back in the menu clears it in any state */
    await core.kitchen.done(k, waiting.no, "pesht");
    expect((await order(waiting.no)).lines[0].out).toBe(true);
    at("19:10");
    expect(await core.kitchen.setOut(k, PIZZA, false, { sec: "pesht" })).toMatchObject({ out: false, orders: 1, nos: [waiting.no] });
    expect((await order(waiting.no)).lines[0].out).toBeUndefined();
  });

  it("what the tablet saw: an old offline action loses to a newer change of another tablet (409 „Друг таблет промени поръчката“); a repeat or the same result is fine", async () => {
    const { core, k, at, line, delivery, order } = await mk("19:00");
    const d = await delivery([line(KEBAP)]);
    await core.kitchen.start(k, d.no, "skara");
    const t0 = at("19:05").getTime();               /* tablet A, offline, presses "Готово" (it saw the line cooking) */
    at("19:05", 30); await core.kitchen.done(k, d.no, "skara", { saw: { 0: "cook" } });   /* tablet B */
    at("19:05", 50); await core.kitchen.back(k, d.no, "skara", { saw: { 0: "ready" } });  /* B: not right after all */
    at("19:06");
    const e = await core.kitchen.done(k, d.no, "skara", { at: t0, saw: { 0: "cook" } }).catch((x) => x as CoreError & { fields?: Record<string, string> });
    expect(e).toMatchObject({ code: "conflict", status: 409, message: "Друг таблет промени поръчката. Виж я отново на екрана." });
    expect((await order(d.no)).status).toBe("cooking");
    /* the state the tablet saw changed by another tablet: refused too */
    expect(await code(core.kitchen.line(k, d.no, 0, true, { sec: "skara", saw: { 0: "wait" } }))).toBe("conflict:409");
    /* the same result already there (two tablets pressed "Готово"): no conflict, nothing to write */
    await core.kitchen.done(k, d.no, "skara", { saw: { 0: "cook" } });
    expect((await core.kitchen.done(k, d.no, "skara", { at: t0, saw: { 0: "cook" } })).same).toBe(true);
    /* one tablet's own queue, sent in order: each action sees the result of the one before */
    const p = await delivery([line(VRAT)]);
    const a1 = at("19:10").getTime(), a2 = at("19:11").getTime();
    at("19:12");
    await core.kitchen.line(k, p.no, 0, true, { sec: "skara", at: a1, saw: { 0: "wait" } });
    expect((await core.kitchen.line(k, p.no, 0, false, { sec: "skara", at: a2, saw: { 0: "ready" } })).same).toBe(false);
    /* the section is required for a line (a screen of one section acts only on its lines) */
    expect(await code(core.kitchen.line(k, p.no, 0, true))).toBe("bad_sec:422");
  });

  it("a status from „Поръчки“ moves the kitchen's lines: „Готова“ = every line ready, back to „Готви се“ = cooked again; „Изпълнени“, never lost from the queues", async () => {
    const { core, k, s, line, delivery, order, events } = await mk("19:00");
    const d = await delivery([line(KEBAP), line(SALAD)]);
    await core.ordersAdmin.step(s.manager, d.no, "cooking");
    expect((await core.kitchen.queue(k, "skara")).tickets.map((t) => t.no)).toContain(d.no);
    await core.ordersAdmin.step(s.manager, d.no, "ready");
    expect((await order(d.no)).lines.map((l) => l.ks)).toEqual(["ready", "ready"]);
    expect((await core.kitchen.queue(k, "skara")).tickets.map((t) => t.no)).not.toContain(d.no);
    expect((await core.kitchen.doneToday(k, "skara")).rows.map((r) => r.no)).toContain(d.no);
    expect(events.some((e) => e.type === "order.line" && e.data.kind === "status" && e.data.no === d.no)).toBe(true);
    await core.ordersAdmin.step(s.manager, d.no, "cooking");
    expect((await order(d.no)).lines.map((l) => l.ks)).toEqual(["cook", "cook"]);
    expect((await core.kitchen.queue(k, "studeni")).tickets.map((t) => t.no)).toContain(d.no);
    await core.ordersAdmin.step(s.manager, d.no, "accepted");
    expect((await order(d.no)).lines.map((l) => [l.ks, l.cookAt])).toEqual([["wait", undefined], ["wait", undefined]]);
    /* the kitchen's own partial "Върни" keeps the other section ready */
    await core.kitchen.done(k, d.no, "all");
    await core.kitchen.back(k, d.no, "skara");
    expect((await order(d.no)).lines.map((l) => l.ks)).toEqual(["wait", "ready"]); /* never started after "Приета": waits */
  });

  it("„Натоварено“ for 60 min: the queue and „Общ изглед“ remind too; „под 1 мин“ in „Изпълнени“; a tablet never seen today", async () => {
    const { core, k, s, at, line, delivery } = await mk("19:00");
    await core.kitchen.setBusy(k, true, { sec: "skara" });
    at("19:59");
    expect((await core.kitchen.queue(k, "skara")).busy.remind).toBe(false);
    at("20:00");
    expect((await core.kitchen.queue(k, "skara")).busy.remind).toBe(true);
    expect((await core.kitchen.summary(k)).busy.remind).toBe(true);
    expect((await core.kitchen.busy(k)).remind).toBe(true);
    const d = await delivery([line(KEBAP)]);
    at("20:00", 40);
    await core.kitchen.done(k, d.no, "skara");
    expect((await core.kitchen.doneToday(k, "skara")).rows.find((r) => r.no === d.no)).toMatchObject({ text: "под 1 мин", onTime: true });
    await core.kitchen.beat(k, "pesht");
    at("23:00", 0, "2026-11-17"); /* the next shift day: yesterday's tablet is not "без връзка от …" */
    expect((await core.kitchen.tablets(s.manager)).find((t) => t.sec === "pesht")).toMatchObject({ online: false, text: "Няма таблет днес" });
  });
});

describe("проверка 1, кръг 2", () => {
  it("a sold-out add-on is counted the same in a section's tab and in its card of „Общ изглед“", async () => {
    const { core, k } = await mk("19:00");
    await core.kitchen.setOut(k, "gabi", true, { sec: "pesht" });
    await core.kitchen.setOut(k, PIZZA, true, { sec: "pesht" });
    const sum = await core.kitchen.summary(k);
    for (const sec of ["topla", "skara", "pesht", "studeni"]) expect(sum.sections.find((x) => x.id === sec)!.out).toBe((await core.kitchen.queue(k, sec)).counts.out);
    expect(sum.sections.find((x) => x.id === "pesht")!.out).toBe(2);
  });
});

describe("кръг 3: a sold-out line waits for a decision (decision of the chief 18.11)", () => {
  it("delivery: „Започни“ and „Готово“ leave the sold-out line, the order never becomes „Готова“ with it; the manager decides after „Започни“ (and „Отмени“)", async () => {
    const { core, k, s, line, delivery, order, events } = await mk("19:00");
    const d = await delivery([line(KEBAP), line(VRAT), line(SALAD)]);
    await core.kitchen.setOut(k, VRAT, true, { sec: "skara" });
    /* the kitchen starts before the manager decides: the sold-out line stays waiting */
    await core.kitchen.start(k, d.no, "skara");
    expect((await order(d.no)).lines.map((l) => l.ks)).toEqual(["cook", "wait", "wait"]);
    expect(await code(core.kitchen.line(k, d.no, 1, true, { sec: "skara" }))).toBe("out_wait:409");
    const r = await core.kitchen.done(k, d.no, "skara");
    expect(r.msg).toBe("В поръчката има изчерпано ястие: чака решение.");
    expect(r.ticket!.lines.map((l) => [l.name, l.ks, l.out])).toEqual([["Кебапчета", "ready", false], ["Свински врат", "wait", true]]);
    await core.kitchen.done(k, d.no, "studeni");
    expect((await order(d.no)).status).toBe("cooking");   /* not "Готова": the sold-out line waits */
    /* the manager still sees the problem with "Приеми без него" (also after "Започни" and after "Обади се") */
    await core.shift.ack(s.manager, "out:" + d.no, "called");
    const p = (await core.shift.now(s.manager)).problems.find((x) => x.key === "out:" + d.no)!;
    expect(p.actions).toEqual(["call", "without"]);
    expect(await code(core.shift.accept(s.manager, d.no))).toBe("has_out:409");
    const a = await core.shift.accept(s.manager, d.no, { without: true });
    expect(a).toMatchObject({ status: "ready", without: ["Свински врат"] });
    const o = await order(d.no);
    expect(o.lines.map((l) => [!!l.dropped, l.ks])).toEqual([[false, "ready"], [true, "wait"], [false, "ready"]]);
    expect(o.total).toBeLessThan(d.total);
    expect((await core.shift.now(s.manager)).problems.some((x) => x.key === "out:" + d.no)).toBe(false);
    expect(events.some((e) => e.type === "order.line" && e.data.kind === "drop" && e.data.no === d.no)).toBe(true);
    /* a dropped line cannot be ticked through the API */
    expect(await code(core.kitchen.line(k, d.no, 1, true, { sec: "skara" }))).toBe("bad_line:422");
    /* back in the menu: the left-out line stays out of the order */
    await core.kitchen.setOut(k, VRAT, false, { sec: "skara" });
    expect((await order(d.no)).lines[1]).toMatchObject({ dropped: true, out: true, ks: "wait" });
  });

  it("„Отмени“ after „Приеми без него“ of a started order: the line waits for the decision again, the status stays", async () => {
    const { core, k, s, line, delivery, order } = await mk("19:00");
    const d = await delivery([line(KEBAP), line(VRAT)]);
    await core.kitchen.setOut(k, VRAT, true, { sec: "skara" });
    await core.kitchen.start(k, d.no, "skara");
    const a = await core.shift.accept(s.manager, d.no, { without: true });
    expect(a.status).toBe("cooking");
    expect(await core.shift.acceptUndo(s.manager, a.undo.id)).toMatchObject({ status: "cooking" });
    const o = await order(d.no);
    expect(o.lines[1].dropped).toBeUndefined();
    expect(o.total).toBe(d.total);
  });

  it("a table: the waiter „Махни“ the sold-out line of a sent order; the order becomes „Готова“; not for a line the kitchen started or a line that is not sold out", async () => {
    const { core, k, s, order } = await mk("19:00");
    const t = await core.floor.order(s.waiter, 7, { lines: [{ id: PIZZA, q: 1 }, { id: "pitsa-kaprichoza", q: 1 }] });
    const no = t.bills[0].orders[0].no;
    await core.kitchen.setOut(k, PIZZA, true, { sec: "pesht" });
    await core.kitchen.start(k, no, "pesht");
    await core.kitchen.done(k, no, "pesht");
    expect((await order(no)).status).toBe("cooking");
    const v = await core.floor.table(s.waiter, 7), ls = v.bills.flatMap((b) => b.orders.flatMap((x) => x.lines));
    expect(ls.map((l) => [l.name, l.decide])).toEqual([["Пица Маргарита", true], [expect.any(String), false]]);
    expect(await code(core.floor.outDrop(s.waiter, 7, ls[1].key))).toBe("not_out:409");
    expect(await code(core.floor.outDrop(s.kitchen, 7, ls[0].key))).toBe("forbidden:403");
    const after = await core.floor.outDrop(s.waiter, 7, ls[0].key);
    expect(after.bills.flatMap((b) => b.orders.flatMap((x) => x.lines)).map((l) => [l.out, l.decide, l.sum > 0])).toEqual([[true, false, false], [false, false, true]]);
    expect((await order(no)).status).toBe("ready");
    expect((await core.audit.list({ limit: 50 })).some((e) => e.action === "floor.out_drop")).toBe(true);
    expect(await code(core.floor.outDrop(s.waiter, 7, ls[0].key))).toBe("not_out:409");
  });

  it("an old action without `saw` (an outbox from before) never wins over a newer „Върни“", async () => {
    const { core, k, at, line, delivery, order } = await mk("19:00");
    const d = await delivery([line(KEBAP)]);
    const t0 = at("19:02").getTime();
    at("19:03"); await core.kitchen.done(k, d.no, "skara");
    at("19:04"); await core.kitchen.back(k, d.no, "skara");
    at("19:05");
    expect(await code(core.kitchen.done(k, d.no, "skara", { at: t0 }))).toBe("conflict:409");
    expect((await order(d.no)).status).toBe("cooking");
    /* a fresh one without `saw` is fine */
    expect((await core.kitchen.done(k, d.no, "skara")).status).toBe("ready");
  });
});
