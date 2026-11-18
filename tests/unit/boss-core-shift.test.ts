/* The manager's module (core/shift.ts): the rights, the money rule (never a sum over several orders without "Финанси и
   гориво"), the pulse = the admin's numbers, "Проблеми сега" by urgency and every action (+ "Отмени"), "Приеми" straight
   to the kitchen, the three answers to a driver's question, "Залата" and "Екипът". Direct calls of the core: the server
   (server/routes/boss.ts) and the demo (src/client/api-boss.ts) call the same functions. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, publicOrder, DEFAULT_ROLES, type Audience, type Hasher, type Order, type RoleId, type StaffCtx } from "../../src/core/index.ts";
import { lateMinOf, sumsWithout, lateText } from "../../src/core/shift.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1", MIN = 60_000;
const T0 = Date.parse("2026-11-16T17:42:00Z"); /* Monday 19:42 in Sofia */
type Ev = { type: string; data: any; to: Audience };
function mk() {
  const t = { now: T0 }, events: Ev[] = [], repo = new MemoryRepo();
  const at = (clock: string) => createCore({ repo, hasher, now: () => new Date(t.now), clock, smsDemo: true, emit: (type, data, to) => { events.push({ type, data, to }); } });
  return { core: at("19:42"), at, repo, events, t };
}
type Core = ReturnType<typeof mk>["core"];
const USERS: [string, RoleId, string][] = [["admin", "admin", "admin"], ["owner", "owner", "owner"], ["manager", "manager", "Управител 1"], ["waiter", "waiter", "Сервитьор 1"], ["waiter2", "waiter", "Сервитьор 2"],
  ["kitchen", "kitchen", "kitchen"], ["driver", "driver", "Шофьор 1"], ["marketing", "marketing", "marketing"]];
async function people(core: Core) {
  const s = {} as Record<string, StaffCtx>, tok = {} as Record<string, string>;
  for (const [u, r, n] of USERS) await core.staff.upsert({ username: u, name: n, role: r, password: PW });
  for (const [u] of USERS) { tok[u] = (await core.staff.login(u, PW, "1.1.1." + u)).token; s[u] = (await core.staff.bySession(tok[u]))!; }
  return { s, tok };
}
const free = (cat: string, k = 0) => items.filter((x) => x.cat === cat && !x.t.includes("out") && !x.per100)[k];
const pizza = free("pitsi"), salad = free("salati"), pizza2 = free("pitsi", 1);
const web = (core: Core, o: { mode?: "delivery" | "pickup"; lines?: { id: string; q: number }[]; phone?: string } = {}) =>
  core.orders.create({ cart: { mode: o.mode || "delivery", lines: (o.lines || [{ id: pizza.id, q: 1 }]).map((l) => ({ key: l.id, id: l.id, q: l.q, mods: [], extra: 0 })) }, addr: "ж.к. Дружба 2, бл. 311",
    name: "Иван Петров", phone: o.phone || "0888123456", pay: "cash" } as never);
const r2 = (v: number) => Math.round(v * 100) / 100;
async function codeOf(core: Core, admin: StaffCtx, n: number) { return (await core.hall.qr(admin)).find((r) => r.n === n)!.code; }
const actions = async (core: Core) => (await core.audit.list()).map((x) => x.action);

describe("rights: the main admin, the owner and the manager; the sections of the tabs", () => {
  it("now / hall / team / search: others 403; 'Залата' needs hall or reservations, 'Екипът' staff", async () => {
    const { core } = mk(), { s, tok } = await people(core);
    for (const fn of [(x: StaffCtx) => core.shift.now(x), (x: StaffCtx) => core.shift.hall(x), (x: StaffCtx) => core.shift.team(x), (x: StaffCtx) => core.shift.search(x, "12")]) {
      for (const r of ["admin", "owner", "manager"]) await expect(fn(s[r])).resolves.toBeTruthy();
      for (const r of ["waiter", "kitchen", "driver", "marketing"]) await expect(fn(s[r])).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
    await expect(core.shift.now(null as never)).rejects.toMatchObject({ status: 401 });
    const man = s.manager.sections;
    await core.staff.setRole("manager", man.filter((x) => x !== "staff"), "admin");
    await expect(core.shift.team((await core.staff.bySession(tok.manager))!)).rejects.toMatchObject({ status: 403 });
    await core.staff.setRole("manager", man.filter((x) => x !== "hall" && x !== "reservations"), "admin");
    await expect(core.shift.hall((await core.staff.bySession(tok.manager))!)).rejects.toMatchObject({ status: 403 });
    await expect(core.shift.accept(s.waiter, "1042")).rejects.toMatchObject({ status: 403 });
  });
});

describe("money: never a sum over several orders without 'Финанси и гориво'", () => {
  it("now, hall, team, search carry one order's total and one table's sum, never the day's; with the section the sums come", async () => {
    const { core } = mk(), { s, tok } = await people(core);
    const a = await web(core, { lines: [{ id: pizza.id, q: 1 }] }), b = await web(core, { mode: "pickup", lines: [{ id: salad.id, q: 3 }], phone: "0888123457" });
    const both = r2(a.total + b.total);
    expect(both).not.toBe(a.total);
    const answers = [await core.shift.now(s.manager), await core.shift.hall(s.manager), await core.shift.team(s.manager), await core.shift.search(s.manager, "оборот"), await core.shift.search(s.manager, "1042")];
    for (const x of answers) {
      const j = JSON.stringify(x);
      expect(j).not.toContain(String(both));
      expect(j).not.toMatch(/"(revenue|sales|turnover)"/);
    }
    const now = answers[0] as Awaited<ReturnType<typeof core.shift.now>>;
    expect(now.money).toBe(false); expect(now.today).toBeNull();
    expect((answers[1] as Awaited<ReturnType<typeof core.shift.hall>>).tablesSum).toBeNull();
    expect((answers[3] as Awaited<ReturnType<typeof core.shift.search>>).today).toBeNull();
    /* one order's own sum is allowed */
    expect(now.waits.orders!.map((o) => o.total).sort()).toEqual([a.total, b.total].sort());
    /* the owner and the main admin (finance by default), and the manager once the main admin gives him the section */
    expect((await core.shift.now(s.owner)).today).toEqual({ sum: both, n: 2 });
    await core.staff.setRole("manager", [...s.manager.sections, "finance"], "admin");
    const fin = (await core.staff.bySession(tok.manager))!;
    expect((await core.shift.now(fin)).today).toEqual({ sum: both, n: 2 });
    expect((await core.shift.search(fin, "оборот")).today).toEqual({ sum: both, n: 2 });
    expect((await core.shift.hall(fin)).tablesSum).toBe(0);
  });
});

describe("the pulse: the same numbers as the admin", () => {
  it("'В работа' = the tab of the admin, 'Закъсняват' = the admin's rule, the tables, the reservations of the next 2 hours", async () => {
    const { core, at, t } = mk(), { s } = await people(core);
    const d = await web(core), p = await web(core, { mode: "pickup", lines: [{ id: salad.id, q: 1 }] });
    await web(core, { lines: [{ id: pizza2.id, q: 2 }] });
    await core.reservations.create({ date: "2026-11-16", time: "20:30", people: 4, name: "Мария", phone: "0899111222" });
    await core.reservations.create({ date: "2026-11-16", time: "21:00", people: 2, name: "Петър", phone: "0899111223" });
    const code = await codeOf(core, s.admin, 12);
    await core.floor.open(code, "a".repeat(32));
    t.now += 48 * MIN;
    const c2 = at("20:30");
    const n = await c2.shift.now(s.manager), list = await c2.ordersAdmin.list(s.manager);
    expect(n.pulse.inWork).toBe(list.counts.work);
    expect(n.pulse.late.n).toBe(list.rows.filter((r) => r.late).length);
    expect(n.pulse.late).toMatchObject({ n: 3, open: 3, seen: 0 });
    expect(n.pulse.tables).toMatchObject({ busy: 1, salon: 1, garden: 0 });
    expect(n.pulse.tables.total).toBe((await c2.floor.hall(s.manager)).tables.length);
    expect(n.pulse.reservations).toEqual({ n: 2, people: 6, until: "22:30" });
    expect(n.fresh).toEqual([d.no, p.no, String(+p.no + 1)]);
    /* a pickup that is ready is not late (the rule: if not ready) */
    await c2.orders.setStatus(p.no, "cooking", "kitchen", s.kitchen); await c2.orders.setStatus(p.no, "ready", "kitchen", s.kitchen);
    expect(lateMinOf((await c2.orders.get(p.no))!, "2026-11-16", 1230, new Map())).toBe(0);
    expect(lateMinOf((await c2.orders.get(d.no))!, "2026-11-16", 1230, new Map([["Дружба 2", 25]]))).toBeGreaterThan(0);
  });
});

describe("'Проблеми сега': by urgency, every action and its 'Отмени'", () => {
  it("the order of the problems; a late delivery grows twice as fast; the solved ones stay at the bottom", async () => {
    const { core, at, t } = mk(), { s } = await people(core);
    await core.floor.shiftStart(s.waiter, [3, 12]); await core.floor.shiftStart(s.waiter2, [8]);
    /* a delivery, a pickup, an accepted order with a sold-out dish (placed at 19:42) */
    const d = await web(core), p = await web(core, { mode: "pickup", lines: [{ id: salad.id, q: 1 }] }), out = await web(core, { lines: [{ id: pizza2.id, q: 1 }, { id: salad.id, q: 1 }] });
    await core.kitchen.setOut(s.kitchen, pizza2.id, true);
    const r = await web(core, { lines: [{ id: salad.id, q: 2 }] });
    await core.orders.setStatus(r.no, "cooking", "kitchen", s.kitchen); await core.orders.setStatus(r.no, "ready", "kitchen", s.kitchen);
    await core.driver.start(s.driver, { car: "a1", km: 1000 });
    t.now += 42 * MIN;
    /* 6 minutes before 20:30: a call at table 3, a QR order at table 8, a driver asks about an address */
    const c3 = await codeOf(core, s.admin, 3), c8 = await codeOf(core, s.admin, 8), A = "a".repeat(32), B = "b".repeat(32);
    await core.floor.open(c3, A); await core.floor.call(c3, A, "order");
    await core.floor.open(c8, B); await core.floor.cartAdd(c8, B, { id: pizza.id }); await core.floor.send(c8, B);
    await core.driver.ask(s.driver, r.no, "зад околовръстното");
    t.now += 6 * MIN;
    const c2 = at("20:30"), n = await c2.shift.now(s.manager);
    const P = n.problems;
    expect(P.map((x) => x.sev)).toEqual([...P.map((x) => x.sev)].sort((a, b) => b - a));
    const late = P.filter((x) => x.kind === "late");
    const ld = late.find((x) => x.ref.no === d.no)!, lp = late.find((x) => x.ref.no === p.no)!;
    expect(ld.sev).toBe(70 + 2 * ld.lateMin!); expect(lp.sev).toBe(60 + lp.lateMin!);
    expect(ld.title).toBe("Доставка № " + d.no + " · закъснява " + lateText(ld.lateMin!)); expect(ld.actions).toEqual(["call"]);
    expect(P[0].key).toBe("late:" + d.no); /* 23 min late: "Първо това" */
    const kinds = new Set(P.map((x) => x.kind));
    expect([...kinds].sort()).toEqual(["ask", "call", "late", "out", "qr"]);
    const call = P.find((x) => x.kind === "call")!, qr = P.find((x) => x.kind === "qr")!, ask = P.find((x) => x.kind === "ask")!, o = P.find((x) => x.kind === "out")!;
    expect(call).toMatchObject({ title: "Маса 3 · Вика", meta: "Сервитьор 1 не е отговорил · изпратено на теб", actions: ["go", "assign"], tone: "hot" });
    expect(qr).toMatchObject({ title: "Маса 8 · QR поръчка", actions: ["confirm", "assign"] });
    expect(ask).toMatchObject({ title: "Шофьор 1 · адрес извън зоните", actions: ["return", "pickup", "deliver"] });
    expect(o).toMatchObject({ key: "out:" + out.no, sev: 95, actions: ["call", "without"] });
    expect(o.title).toContain("Изчерпано: " + pizza2.n);
    /* the badge counts the order with a sold-out dish once */
    expect(n.counts.now).toBe(n.counts.problems + n.counts.waits - 1);

    /* "Видях" is not for a delivery; "Готово, обадих се" is remembered for the shift and goes to the bottom */
    const after = await c2.shift.ack(s.manager, "late:" + d.no, "called");
    const solved = after.problems.find((x) => x.key === "late:" + d.no)!;
    expect(solved).toMatchObject({ sev: -1, tone: "solved", actions: [], done: { what: "called" } });
    expect(after.problems[after.problems.length - 1].key).toBe("late:" + d.no);
    expect(after.pulse.late).toMatchObject({ open: after.pulse.late.n - 1, seen: 1 });
    expect(await actions(c2)).toContain("order.call");
    const back = await c2.shift.ackUndo(s.manager, "late:" + d.no);
    expect(back.problems.find((x) => x.key === "late:" + d.no)!.done).toBeNull();
    /* "Обади се на клиента": the whole number, logged */
    expect((await c2.shift.callCustomer(s.manager, d.no)).phone).toBe("0888123456");
    expect((await c2.audit.list({ action: "order.call" })).length).toBeGreaterThanOrEqual(3);
  });

  it("calls: 'Отивам' / 'Възложи на…' and 'Отмени'; QR: 'Възложи на…' and 'Потвърди и прати'; the three answers", async () => {
    const { core, t } = mk(), { s } = await people(core);
    await core.floor.shiftStart(s.waiter, [3]); await core.floor.shiftStart(s.waiter2, [8]);
    const c3 = await codeOf(core, s.admin, 3), c8 = await codeOf(core, s.admin, 8), A = "a".repeat(32), B = "b".repeat(32);
    await core.floor.open(c3, A); await core.floor.call(c3, A, "bill");
    await core.floor.open(c8, B); await core.floor.cartAdd(c8, B, { id: pizza.id }); await core.floor.send(c8, B);
    t.now += 6 * MIN;
    let n = await core.shift.now(s.manager);
    const call = n.problems.find((x) => x.kind === "call")!, qr = n.problems.find((x) => x.kind === "qr")!;
    expect(call.title).toBe("Маса 3 · Сметка");
    n = await core.shift.callAssign(s.manager, call.ref.call!, "waiter2");
    expect(n.problems.find((x) => x.kind === "call")).toBeUndefined();
    let hall = await core.floor.hall(s.waiter2);
    expect(hall.calls.find((c) => c.id === call.ref.call)!.taken).toMatchObject({ by: "waiter2", mine: true });
    n = await core.shift.callUndo(s.manager, call.ref.call!);
    expect(n.problems.find((x) => x.kind === "call")).toBeTruthy();
    n = await core.shift.callGo(s.manager, call.ref.call!);
    hall = await core.floor.hall(s.waiter);
    expect(hall.calls.find((c) => c.id === call.ref.call)!.taken).toMatchObject({ by: "manager" });
    n = await core.shift.callUndo(s.manager, call.ref.call!);
    expect(n.problems.find((x) => x.kind === "call")).toBeTruthy();
    expect((await core.audit.list({ action: "call.take" })).length).toBe(4);
    /* QR: given to a waiter (the timer stays), "Отмени", then "Потвърди и прати" */
    n = await core.shift.qrAssign(s.manager, qr.ref.session!, "waiter");
    expect(n.problems.find((x) => x.kind === "qr")!.meta).toContain("възложена на Сервитьор 1");
    expect(n.problems.find((x) => x.kind === "qr")!.since).toBe(qr.since);
    n = await core.shift.qrAssignUndo(s.manager, qr.ref.session!);
    expect(n.problems.find((x) => x.kind === "qr")!.meta).not.toContain("възложена");
    const conf = await core.shift.qrConfirm(s.manager, qr.ref.table!.id);
    expect(conf.now.problems.find((x) => x.kind === "qr")).toBeUndefined();
    expect((await core.orders.get(conf.no))!).toMatchObject({ channel: "qr", table: qr.ref.table!.id });
    /* the three answers to "адрес извън зоните" (answer 30) */
    await core.driver.start(s.driver, { car: "a1", km: 1000 });
    const asks: string[] = [];
    for (let i = 0; i < 3; i++) {
      const o = await web(core); await core.orders.setStatus(o.no, "cooking", "kitchen", s.kitchen); await core.orders.setStatus(o.no, "ready", "kitchen", s.kitchen);
      asks.push((await core.driver.ask(s.driver, o.no)).id);
    }
    const labels: string[] = [];
    for (const [i, a] of (["return", "pickup", "deliver"] as const).entries()) labels.push((await core.shift.answer(s.manager, asks[i], a)).answer);
    expect(labels).toEqual(["Върни я в ресторанта", "Предложи вземане от място", "Да я достави"]);
    expect((await core.driver.asks(s.manager, { all: true })).map((a) => a.answer)).toEqual(["return", "pickup", "deliver"]);
    n = await core.shift.answerUndo(s.manager, asks[2]);
    expect(n.problems.filter((x) => x.kind === "ask").map((x) => x.ref.ask)).toEqual([asks[2]]);
  });

  it("'Приеми' goes straight to 'Готви се'; with a sold-out dish: 409, then 'Приеми без него' (the sums again); 'Отмени'", async () => {
    const { core } = mk(), { s } = await people(core);
    const a = await web(core), c = await web(core, { lines: [{ id: pizza2.id, q: 1 }] });
    const r = await core.shift.accept(s.manager, a.no);
    expect(r).toMatchObject({ no: a.no, status: "cooking", without: [] });
    expect((await core.orders.get(a.no))!.status).toBe("cooking");
    await core.shift.acceptUndo(s.manager, r.undo.id);
    const back = (await core.orders.get(a.no))!;
    expect(back.status).toBe("accepted"); expect(back.times!.accepted).toBe(a.times!.accepted); expect(back.times!.cooking).toBeUndefined();
    /* a sold-out line */
    const b = await web(core, { lines: [{ id: pizza2.id, q: 1 }, { id: salad.id, q: 2 }] });
    await core.kitchen.setOut(s.kitchen, pizza2.id, true);
    await expect(core.shift.accept(s.manager, b.no)).rejects.toMatchObject({ code: "has_out", status: 409, out: [pizza2.n] });
    const w = await core.shift.accept(s.manager, b.no, { without: true });
    const o = (await core.orders.get(b.no))!;
    expect(w.without).toEqual([pizza2.n]);
    expect(o).toMatchObject({ status: "cooking", sub: r2(salad.p * 2) });
    expect(o.total).toBe(r2(salad.p * 2 + (o.fee || 0)));
    expect(o.lines).toHaveLength(2); /* the kitchen's line numbers stay */
    expect(o.staffNotes!.at(-1)!.text).toBe("Без „" + pizza2.n + "“ (изчерпано днес), клиентът е уведомен.");
    expect(await actions(core)).toEqual(expect.arrayContaining(["order.note", "order.status"]));
    expect((await core.shift.now(s.manager)).problems.find((x) => x.key === "out:" + b.no)).toBeUndefined();
    await core.shift.acceptUndo(s.manager, w.undo.id);
    expect((await core.orders.get(b.no))!).toMatchObject({ status: "accepted", total: b.total, sub: b.sub });
    /* all sold out: to the admin */
    await expect(core.shift.accept(s.manager, c.no, { without: true })).rejects.toMatchObject({ code: "all_out" });
    expect(sumsWithout({ ...o, lines: o.lines.map((l) => ({ ...l, out: false })) } as Order).sub).toBe(r2(pizza2.p + salad.p * 2));
  });
});

describe("'Залата' and 'Екипът'", () => {
  it("tiles with 'Резервирана' and the lock; the sheet; the waiter of a table; 'Смени масите' and its exact 'Отмени'", async () => {
    const { core } = mk(), { s } = await people(core);
    await core.floor.shiftStart(s.waiter, [1, 2, 3]); await core.floor.shiftStart(s.waiter2, [4, 5]);
    const t5 = (await core.hall.get(s.admin)).tables.find((x) => x.n === 5)!;
    await core.reservations.create({ date: "2026-11-16", time: "20:30", people: 2, name: "Мария", phone: "0899111222" });
    await core.resAdmin.setTable(s.admin, (await core.reservations.list({ date: "2026-11-16" } as never))[0].id, t5.id);
    let h = await core.shift.hall(s.manager);
    expect(h.tiles.find((x) => x.n === 5)).toMatchObject({ state: "res", label: "Резервирана", waiter: { username: "waiter2" }, walkin: true, next: { time: "20:30", people: 2 } });
    expect(h.tonight.map((r) => [r.time, r.tableN, r.lateMin])).toEqual([["20:30", 5, null]]);
    let tb = await core.shift.walkin(s.manager, 5, false);
    expect(tb).toMatchObject({ walkin: false, next: { time: "20:30" } });
    expect(await actions(core)).toContain("hall.update");
    tb = await core.shift.setWaiter(s.manager, 5, "waiter");
    expect(tb.waiter).toMatchObject({ username: "waiter" });
    /* "Смени масите": Сервитьор 1 gets 4, gives 1 to the colleague; "Отмени" puts every table back */
    const before = await core.shift.team(s.manager);
    const r = await core.shift.setTables(s.manager, "waiter", [2, 3, 4, 5]);
    expect(r.team.waiters.map((w) => [w.username, w.tables.map((x) => x.n)])).toEqual([["waiter", [2, 3, 4, 5]], ["waiter2", [1]]]);
    await expect(core.shift.setTables(s.manager, "waiter", [])).rejects.toMatchObject({ status: 422 });
    const undone = await core.shift.setTablesUndo(s.manager, r.undo.id);
    expect(undone.waiters.map((w) => w.tables.map((x) => x.n))).toEqual(before.waiters.map((w) => w.tables.map((x) => x.n)));
    expect(undone.drivers).toEqual([]);
    expect(undone.kitchen.sections.length).toBeGreaterThan(0);
  });
  it("'Натоварено' and 'Върни' through the kitchen's one switch; shift.update for the screens", async () => {
    const { core, events } = mk(), { s } = await people(core);
    let k = await core.shift.busy(s.manager, true);
    expect(k.busy).toMatchObject({ on: true, by: "Управител" });
    await core.kitchen.setOut(s.kitchen, pizza.id, true);
    k = (await core.shift.now(s.manager)).kitchen;
    expect(k.soldOut.map((x) => x.id)).toContain(pizza.id);
    k = await core.shift.backIn(s.manager, pizza.id);
    expect(k.soldOut.map((x) => x.id)).not.toContain(pizza.id);
    expect(await actions(core)).toEqual(expect.arrayContaining(["kitchen.busy_on", "menu.back"]));
    expect(events.filter((e) => e.type === "shift.update").map((e) => e.data.what)).toEqual(expect.arrayContaining(["kitchen.busy", "soldout"]));
  });
});

describe("review 1: what waits for 'Приеми', one rule for a delay, the driver's cash", () => {
  it("'Чака те' has only the orders that wait for 'Приеми' (web, phone), never a table order the waiter sent or a confirmed QR order", async () => {
    const { core } = mk(), { s } = await people(core);
    await core.floor.shiftStart(s.waiter, [3, 4]);
    const w = await web(core, { mode: "pickup" });
    const c3 = await codeOf(core, s.admin, 3), A = "a".repeat(32);
    await core.floor.open(c3, A); await core.floor.cartAdd(c3, A, { id: pizza.id }); await core.floor.send(c3, A);
    const q = await core.floor.qrConfirm(s.waiter, 3);
    const t = await core.floor.order(s.waiter, 4, { lines: [{ id: salad.id, q: 1 }] });
    const now = await core.shift.now(s.manager), nos = now.waits.orders!.map((o) => o.no);
    expect(nos).toEqual([w.no]);
    expect(nos).not.toContain(q.no);
    for (const no of t.orders) expect(nos).not.toContain(no);
    /* the badge counts the same */
    expect(now.waits.n).toBe(1);
  });
  it("a delivery on the road has ONE delay: the same number in 'Проблеми сега' and in the driver's course ('Екипът'); over an hour in hours", async () => {
    const { core, at, t } = mk(), { s } = await people(core);
    const d = await web(core);
    await core.orders.setStatus(d.no, "cooking", "kitchen", s.kitchen); await core.orders.setStatus(d.no, "ready", "kitchen", s.kitchen);
    await core.driver.start(s.driver, { car: "a1", km: 1000 });
    await core.driver.take(s.driver, [d.no]); await core.driver.go(s.driver, [d.no]);
    for (const [mins, clock] of [[48, "20:30"], [110, "21:32"]] as [number, string][]) {
      t.now = T0 + mins * MIN;
      const c = at(clock), n = await c.shift.now(s.manager), tm = await c.shift.team(s.manager);
      const p = n.problems.find((x) => x.key === "late:" + d.no)!;
      const stop = tm.drivers.flatMap((x) => x.course.stops).find((x) => x.no === d.no)!;
      expect(p.lateMin).toBeGreaterThan(0);
      expect(stop.late).toBe(p.lateMin);
      expect(stop.lateLabel).toBe("+" + lateText(p.lateMin!));
      expect(p.title).toContain("закъснява " + lateText(p.lateMin!));
    }
    expect(lateText(47)).toBe("47\u00a0мин"); expect(lateText(407)).toBe("6\u00a0ч\u00a047\u00a0мин"); expect(lateText(120)).toBe("2\u00a0ч");
  });
  it("the driver's cash says what it is: the cash orders + the start float - the fuel in cash", async () => {
    const { core } = mk(), { s } = await people(core);
    await core.driver.start(s.driver, { car: "a1", km: 1000, float: 20 });
    const tm = await core.shift.team(s.manager), d = tm.drivers[0];
    expect(d.cashParts).toEqual({ orders: 0, float: 20, fuel: 0 });
    expect(d.cash).toBe(20);
  });
});

const MANAGER_SECTIONS = DEFAULT_ROLES.find((r) => r.id === "manager")!.sections;
describe("review 2 (decisions 18.11): 'Приеми без него', 'Възложи на…', the exact 'Отмени', the sections of every action", () => {
  it("'Приеми без него': the line stays only for reference (no ticket, not waited for, not charged, shown to the customer); 'Върни' never puts it back", async () => {
    const { core } = mk(), { s } = await people(core);
    const b = await web(core, { mode: "pickup", lines: [{ id: pizza2.id, q: 1 }, { id: salad.id, q: 2 }] });
    await core.kitchen.setOut(s.kitchen, pizza2.id, true);
    await core.shift.accept(s.manager, b.no, { without: true });
    const pizzaSec = (await core.kitchen.config(s.kitchen)).sections.find((x) => x.cats.includes(pizza2.cat))!.id;
    const saladSec = (await core.kitchen.config(s.kitchen)).sections.find((x) => x.cats.includes(salad.cat))!.id;
    expect((await core.kitchen.queue(s.kitchen, pizzaSec)).tickets.map((t) => t.no)).not.toContain(b.no);
    expect((await core.kitchen.queue(s.kitchen, saladSec)).tickets.map((t) => t.no)).toContain(b.no);
    const done = await core.kitchen.done(s.kitchen, b.no, saladSec);
    expect((done as unknown as { orderReady: boolean }).orderReady).toBe(true);
    expect((await core.orders.get(b.no))!.status).toBe("ready");
    /* the customer: the line is there as "out", the lines make the total */
    const p = publicOrder((await core.orders.get(b.no))!);
    const line = p.lines.find((l) => l.id === pizza2.id)!;
    expect(line.out).toBe(true);
    expect(r2(p.lines.filter((l) => !l.out).reduce((a, l) => a + (l.unit || 0) * l.q, 0) + (p.fee || 0) - (p.disc || 0))).toBe(p.total);
    /* the dish is back in the menu: this order keeps it out */
    await core.shift.backIn(s.manager, pizza2.id, true);
    const o = (await core.orders.get(b.no))!;
    expect(o.lines.find((l) => l.id === pizza2.id)).toMatchObject({ out: true, dropped: true });
  });
  it("'Възложи на…': the QR order and the call are the chosen waiter's ('За мен'), never the other's; 'Отмени' gives them back", async () => {
    const { core, t } = mk(), { s } = await people(core);
    await core.floor.shiftStart(s.waiter, [3, 8]); await core.floor.shiftStart(s.waiter2, [5]);
    const c8 = await codeOf(core, s.admin, 8), c3 = await codeOf(core, s.admin, 3), A = "a".repeat(32), B = "b".repeat(32);
    await core.floor.open(c8, A); await core.floor.cartAdd(c8, A, { id: pizza.id }); await core.floor.send(c8, A);
    await core.floor.open(c3, B); await core.floor.call(c3, B, "order");
    t.now += 10 * MIN;
    const n = await core.shift.now(s.manager), qr = n.problems.find((x) => x.kind === "qr")!, call = n.problems.find((x) => x.kind === "call")!;
    await core.shift.qrAssign(s.manager, qr.ref.session!, "waiter2");
    await core.shift.callAssign(s.manager, call.ref.call!, "waiter2");
    const h2 = await core.floor.hall(s.waiter2), h1 = await core.floor.hall(s.waiter);
    expect(h2.qr.find((q) => q.table.n === 8)).toMatchObject({ forMe: true, to: { username: "waiter2" } });
    expect(h1.qr.find((q) => q.table.n === 8)!.forMe).toBe(false);
    expect(h2.calls.find((c) => c.table.n === 3)!.taken).toMatchObject({ mine: true, assigned: true });
    await core.shift.qrAssignUndo(s.manager, qr.ref.session!);
    expect((await core.floor.hall(s.waiter)).qr.find((q) => q.table.n === 8)!.forMe).toBe(true);
    expect((await core.floor.hall(s.waiter2)).qr.find((q) => q.table.n === 8)!.forMe).toBe(false);
  });
  it("'Отмени' after 'Смени масите' returns only its own tables, and refuses when someone changed them meanwhile", async () => {
    const { core } = mk(), { s } = await people(core);
    await core.floor.shiftStart(s.waiter, [1, 2]); await core.floor.shiftStart(s.waiter2, [3, 4]);
    const nums = async () => (await core.shift.team(s.manager)).waiters.map((w) => [w.username, w.tables.map((x) => x.n)]);
    const r = await core.shift.setTables(s.manager, "waiter", [1, 2, 3]);
    /* the owner changes another table meanwhile: the manager's "Отмени" leaves it */
    await core.shift.setTables(s.owner, "waiter2", [4, 6]);
    await core.shift.setTablesUndo(s.manager, r.undo.id);
    expect(await nums()).toEqual([["waiter", [1, 2]], ["waiter2", [3, 4, 6]]]);
    /* someone moved the same table: 409, nothing touched */
    const r2b = await core.shift.setTables(s.manager, "waiter", [1, 2, 3]);
    await core.shift.setTables(s.owner, "waiter2", [3, 4, 6]);
    await expect(core.shift.setTablesUndo(s.manager, r2b.undo.id)).rejects.toMatchObject({ status: 409, code: "changed" });
    expect(await nums()).toEqual([["waiter", [1, 2]], ["waiter2", [3, 4, 6]]]);
  });
  it("every action of 'Сега' needs the section of its object; the problems carry only the actions the role may do; 'Отмени' only by the one who did it", async () => {
    const { core, t } = mk(), { s, tok } = await people(core);
    await core.floor.shiftStart(s.waiter, [3]);
    const c3 = await codeOf(core, s.admin, 3), A = "a".repeat(32);
    await core.floor.open(c3, A); await core.floor.call(c3, A, "order");
    t.now += 10 * MIN;
    await core.staff.setRole("manager", ["dashboard", "notes"], "admin");
    const m = (await core.staff.bySession(tok.manager))!;
    await expect(core.shift.busy(m, true)).rejects.toMatchObject({ status: 403 });
    await expect(core.shift.backIn(m, pizza.id, true)).rejects.toMatchObject({ status: 403 });
    const n = await core.shift.now(m), call = n.problems.find((x) => x.kind === "call")!;
    expect(call.actions).toEqual([]);
    expect(n.kitchen).toMatchObject({ canBusy: false, canBack: false });
    await expect(core.shift.callGo(m, call.ref.call!)).rejects.toMatchObject({ status: 403 });
    await expect(core.shift.callAssign(m, call.ref.call!, "waiter")).rejects.toMatchObject({ status: 403 });
    await expect(core.shift.qrConfirm(m, 3)).rejects.toMatchObject({ status: 403 });
    /* the driver's answer: the owner cannot take back the manager's */
    const full = (await core.staff.setRole("manager", MANAGER_SECTIONS, "admin"), (await core.staff.bySession(tok.manager))!);
    const d = await web(core); await core.orders.setStatus(d.no, "cooking", "kitchen", s.kitchen); await core.orders.setStatus(d.no, "ready", "kitchen", s.kitchen);
    await core.driver.start(s.driver, { car: "a1", km: 1000 });
    const ask = await core.driver.ask(s.driver, d.no);
    await core.shift.answer(full, ask.id, "pickup");
    await expect(core.shift.answerUndo(s.owner, ask.id)).rejects.toMatchObject({ status: 409, code: "undo_late" });
    await expect(core.shift.answerUndo(full, ask.id)).resolves.toBeTruthy();
  });
});
