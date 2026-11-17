/* The hall live (core/floor*.ts): the sitting at a table for the guests (QR) and the waiter. Every rule and every right is
   in the core, so these tests call the core directly (the server routes and the demo call the same functions). The kitchen
   core is another module: here the tests set its line fields (`ks`, `readyAt`) straight in the store. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, type Audience, type Hasher, type Order, type RoleId, type StaffCtx, type TableSession } from "../../src/core/index.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1";
const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const T0 = Date.parse("2026-11-16T17:42:00Z"); /* Monday 19:42 in Sofia */
type Ev = { type: string; data: any; to: Audience };
function mk(clock = "19:42") {
  const t = { now: T0 }, events: Ev[] = [], repo = new MemoryRepo();
  const core = createCore({ repo, hasher, now: () => new Date(t.now), clock, emit: (type, data, to) => { events.push({ type, data, to }); } });
  return { core, repo, events, t, at: (clock: string) => createCore({ repo, hasher, now: () => new Date(t.now), clock, emit: (type, data, to) => { events.push({ type, data, to }); } }) };
}
async function people(core: ReturnType<typeof mk>["core"], extra: [string, RoleId][] = []) {
  const s = {} as Record<string, StaffCtx>;
  for (const [u, r] of [...ROLES.map((r) => [r, r] as [string, RoleId]), ...extra]) {
    await core.staff.upsert({ username: u, name: u === "waiter" ? "Сервитьор 1" : u === "waiter2" ? "Сервитьор 2" : u, role: r, password: PW });
    s[u] = (await core.staff.bySession((await core.staff.login(u, PW, "1.1.1." + u)).token))!;
  }
  return s;
}
/** the QR code of a table by its number */
async function codeOf(core: ReturnType<typeof mk>["core"], admin: StaffCtx, n: number) { return (await core.hall.qr(admin)).find((r) => r.n === n)!.code; }
const A = "a".repeat(32), B = "b".repeat(32);
const free = (cat: string, k = 0) => items.filter((x) => x.cat === cat && !x.t.includes("out") && !x.per100)[k];
const pizza = free("pitsi"), pizza2 = free("pitsi", 1), salad = free("salati"), dessert = free("deserti");
const steak = items.find((x) => x.per100)!, breakfast = items.find((x) => x.course === "breakfast")!, soldOut = items.find((x) => x.t.includes("out"))!;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** the kitchen marks every line of an order (the kitchen core will do this) */
async function kitchen(repo: MemoryRepo, no: string, ks: "cook" | "ready", t: number, only?: number[]) {
  const o = (await repo.get<Order>("orders", no))!;
  o.lines.forEach((l, i) => { if (!only || only.includes(i)) { l.ks = ks; if (ks === "ready") l.readyAt = new Date(t).toISOString(); } });
  o.status = o.lines.every((l) => l.ks === "ready") ? "ready" : "cooking";
  await repo.put("orders", o);
}
const err = (code: string, status?: number) => expect.objectContaining({ code, ...(status ? { status } : {}) });

describe("the dine-in flow: two phones, the first order waits, the kitchen, 'Сервирах', the bill by dishes, the close", () => {
  it("runs from the first scan to a free table", async () => {
    const { core, repo, events, t } = mk(), s = await people(core), code = await codeOf(core, s.admin, 12);
    /* the first scan opens the sitting; the second phone joins it */
    const v1 = await core.floor.open(code, A);
    expect(v1).toMatchObject({ status: "open", table: { n: 12, zone: "salon", zoneName: "Салон" }, me: { phone: 1, label: "Телефон 1" }, canOrder: true, cart: { n: 0, toWaiter: true } });
    const v2 = await core.floor.open(code, B);
    expect(v2.session).toBe(v1.session);
    expect(v2.me).toEqual({ phone: 2, label: "Телефон 2" });
    expect(v2.phones).toEqual([{ phone: 1, mine: false }, { phone: 2, mine: true }]);
    expect((await core.floor.open(code, A)).me!.phone).toBe(1); /* the same phone again: the same number */
    /* the waiter sees guests who wait to order */
    expect((await core.floor.hall(s.waiter)).tables.find((x) => x.n === 12)).toMatchObject({ state: "wait", label: "Чака поръчка", waits: true });

    /* the shared cart: everybody may change any line */
    await core.floor.cartAdd(code, A, { id: pizza.id });
    await core.floor.cartAdd(code, A, { id: pizza.id });
    let v = await core.floor.cartAdd(code, B, { id: salad.id, q: 2 });
    expect(v.cart.lines.map((l) => [l.id, l.q, l.phone, l.mine])).toEqual([[pizza.id, 2, 1, false], [salad.id, 2, 2, true]]);
    expect(v.cart.sum).toBe(r2(pizza.p * 2 + salad.p * 2));
    v = await core.floor.cartQty(code, B, v.cart.lines[0].key, 1); /* phone 2 changes the line of phone 1 */
    expect(v.cart.lines[0].q).toBe(1);
    const rm = await core.floor.cartRemove(code, A, v.cart.lines[1].key);
    expect(rm.view.cart.lines).toHaveLength(1);
    v = await core.floor.cartRestore(code, A, rm.gone!); /* "Отмени": the line is back with its own phone */
    expect(v.cart.lines.map((l) => [l.id, l.q, l.phone])).toEqual([[pizza.id, 1, 1], [salad.id, 2, 2]]);
    v = await core.floor.cartAdd(code, B, { id: dessert.id });

    /* the first order waits for the waiter: not an Order yet */
    const sent = await core.floor.send(code, B);
    expect(sent).toMatchObject({ to: "waiter", no: null });
    expect(sent.view.cart.lines).toHaveLength(0);
    expect(sent.view.pending).toMatchObject({ phone: 2, n: 4, sum: r2(pizza.p + salad.p * 2 + dessert.p) });
    expect(await repo.list("orders")).toHaveLength(0);
    const hall = await core.floor.hall(s.waiter);
    expect(hall.tables.find((x) => x.n === 12)).toMatchObject({ state: "qr", label: "QR поръчка" });
    expect(hall.qr).toHaveLength(1);
    expect(hall.counters.queue).toBe(1);

    /* "Потвърди и прати": a real Order, channel "qr", through the waiter */
    const conf = await core.floor.qrConfirm(s.waiter, 12);
    const o1 = (await repo.get<Order>("orders", conf.no))!;
    expect(o1).toMatchObject({ channel: "qr", mode: "pickup", table: "S12", session: v1.session, via: "waiter", bill: "Обща сметка", status: "accepted", name: "Маса 12", phone: "", total: r2(pizza.p + salad.p * 2 + dessert.p) });
    expect(o1.lines.map((l) => [l.id, l.q, l.guest, l.unit])).toEqual([[pizza.id, 1, "p1", pizza.p], [salad.id, 2, "p2", salad.p], [dessert.id, 1, "p2", dessert.p]]);
    expect(conf.pending).toBeNull();
    expect(conf.bills).toHaveLength(1);
    expect(conf.bills[0]).toMatchObject({ name: "Обща сметка", sum: o1.total });
    expect(conf.bills[0].orders[0].lines.map((l) => [l.st, l.guest])).toEqual([["accepted", "Телефон 1"], ["accepted", "Телефон 2"], ["accepted", "Телефон 2"]]);

    /* the next QR order goes straight to the kitchen */
    await core.floor.cartAdd(code, A, { id: pizza2.id });
    const sent2 = await core.floor.send(code, A);
    expect(sent2.to).toBe("kitchen");
    const o2 = (await repo.get<Order>("orders", sent2.no!))!;
    expect(o2).toMatchObject({ channel: "qr", via: "", session: v1.session });
    expect(sent2.view.orders.map((o) => [o.no, o.via])).toEqual([[o1.no, true], [o2.no, false]]);
    expect(events.filter((e) => e.type === "order.new").map((e) => e.data.no)).toEqual([o1.no, o2.no]);

    /* the kitchen cooks, then marks ready; the guests see Прието → Готви се, never the waiter's word "Готово" */
    await kitchen(repo, o1.no, "cook", t.now);
    expect((await core.floor.view(code, A)).orders[0].lines.map((l) => l.st)).toEqual(["cooking", "cooking", "cooking"]);
    expect((await core.floor.view(code, A)).orders[1].lines.map((l) => l.stLabel)).toEqual(["Прието"]);
    await expect(core.floor.serve(s.waiter, 12, [o1.no + ":0"])).rejects.toEqual(err("not_ready", 409));
    t.now += 10 * 60_000;
    await kitchen(repo, o1.no, "ready", t.now, [0, 1]);
    expect((await core.floor.hall(s.waiter)).tables.find((x) => x.n === 12)).toMatchObject({ state: "ready", since: new Date(t.now).toISOString() });
    const rd = await core.floor.ready(s.waiter);
    expect(rd).toHaveLength(1);
    expect(rd[0].lines.map((l) => l.key)).toEqual([o1.no + ":0", o1.no + ":1"]);
    expect((await core.floor.view(code, B)).orders[0].lines.map((l) => l.st)).toEqual(["cooking", "cooking", "cooking"]);

    /* "Сервирах" (every ready line of the table), "Отмени", again */
    let d = await core.floor.serve(s.waiter, 12);
    expect(d.served).toEqual([o1.no + ":0", o1.no + ":1"]);
    d = Object.assign(await core.floor.unserve(s.waiter, 12, [o1.no + ":1"]), { served: [] });
    expect(d.bills[0].orders[0].lines.map((l) => l.st)).toEqual(["served", "ready", "cooking"]);
    await core.floor.serve(s.waiter, 12, [o1.no + ":1"]);
    expect((await repo.get<Order>("orders", o1.no))!.status).toBe("cooking");
    await kitchen(repo, o1.no, "ready", t.now);
    await kitchen(repo, o2.no, "ready", t.now);
    await core.floor.serve(s.waiter, 12);
    /* all lines served: the order is "Взета", shown "Сервирана" */
    expect((await repo.get<Order>("orders", o1.no))!).toMatchObject({ status: "picked_up" });
    d = Object.assign(await core.floor.table(s.waiter, 12), { served: [] });
    expect(d.bills[0].orders.map((o) => o.statusLabel)).toEqual(["Сервирана", "Сервирана"]);
    expect(d.unserved).toEqual([]);
    expect((await core.floor.view(code, A)).orders.flatMap((o) => o.lines.map((l) => l.stLabel))).toEqual(["Сервирано", "Сервирано", "Сервирано", "Сервирано"]);
    /* "Отмени" on the last line: the order goes back to "Готова" */
    await core.floor.unserve(s.waiter, 12, [o2.no + ":0"]);
    expect((await repo.get<Order>("orders", o2.no))!.status).toBe("ready");
    await core.floor.serve(s.waiter, 12, [o2.no + ":0"]);
    t.now += 60_000;
    await expect(core.floor.unserve(s.waiter, 12, [o2.no + ":0"])).rejects.toEqual(err("undo_late", 409));

    /* the bill by dishes from two phones: the picks are shared, the sums are private */
    const k = { pz: o1.no + ":0", sal: o1.no + ":1", des: o1.no + ":2", pz2: o2.no + ":0" };
    const total = r2(o1.total + o2.total);
    await core.floor.pick(code, A, [k.pz, k.pz2], true);
    await expect(core.floor.pick(code, B, k.pz, true)).rejects.toEqual(err("picked", 409));
    v = await core.floor.pick(code, B, [k.sal, k.des], true);
    expect(v.bill.picks).toEqual({ [k.pz]: 1, [k.pz2]: 1, [k.sal]: 2, [k.des]: 2 });
    expect(v.bill.want!.dishes).toEqual({ keys: [k.sal, k.des], sum: r2(salad.p * 2 + dessert.p) });
    v = await core.floor.bill(code, A, { pay: "card", split: "dishes" });
    expect(v.bill.mine).toMatchObject({ pay: "card", split: "dishes", keys: [k.pz, k.pz2], sum: r2(pizza.p + pizza2.p) });
    expect(v.calls.active.map((c) => c.kind)).toEqual(["bill"]);
    const billAt = v.calls.active[0].at;
    t.now += 30_000;
    v = await core.floor.bill(code, B, { pay: "cash", split: "dishes" });
    expect(v.bill.mine).toMatchObject({ pay: "cash", keys: [k.sal, k.des], sum: r2(salad.p * 2 + dessert.p) });
    /* the other phone: a short row without a sum; the second request joined the same call, its time did not start again */
    expect(v.bill.others).toEqual([{ phone: 1, at: expect.any(String), pay: "card", split: "dishes" }]);
    expect(v.calls.active).toHaveLength(1);
    expect(v.calls.active[0].at).toBe(billAt);
    expect(v.bill.free).toEqual([]);
    expect((await core.floor.hall(s.waiter)).tables.find((x) => x.n === 12)).toMatchObject({ state: "bill", label: "Чака сметка", since: billAt });

    /* the payments: every payment keeps its lines, nothing twice, never more than the rest */
    d = Object.assign(await core.floor.table(s.waiter, 12), { served: [] });
    expect(d.requests.map((r) => [r.phone, r.sum])).toEqual([[1, r2(pizza.p + pizza2.p)], [2, r2(salad.p * 2 + dessert.p)]]);
    expect(d).toMatchObject({ total, paid: 0, rest: total, canClose: false });
    await expect(core.floor.close(s.waiter, 12)).rejects.toEqual(err("unpaid", 409));
    const p1 = await core.floor.pay(s.waiter, 12, { how: "card", keys: [k.pz, k.pz2] });
    expect(p1.payment).toMatchObject({ how: "card", sum: r2(pizza.p + pizza2.p), keys: [k.pz, k.pz2], label: "По ястия" });
    expect(p1).toMatchObject({ paid: r2(pizza.p + pizza2.p), rest: r2(total - pizza.p - pizza2.p) });
    await expect(core.floor.pay(s.waiter, 12, { how: "cash", keys: [k.pz] })).rejects.toEqual(err("paid", 409));
    expect(p1.calls.map((c) => c.kind)).toEqual(["bill"]); /* phone 2 still waits for its bill */
    const p2 = await core.floor.pay(s.waiter, 12, { how: "cash" }); /* "Една сметка": what is left */
    expect(p2.payment).toMatchObject({ sum: r2(salad.p * 2 + dessert.p), keys: [k.sal, k.des], label: "Една сметка" });
    expect(p2).toMatchObject({ paid: total, rest: 0, canClose: true, calls: [] });
    expect(r2(p2.payments.reduce((a, x) => a + x.sum, 0))).toBe(total);
    await expect(core.floor.pay(s.waiter, 12, { how: "cash" })).rejects.toEqual(err("invalid", 422));
    expect((await repo.get<Order>("orders", o1.no))!.lines.map((l) => l.paid)).toEqual([p1.payment.id, p2.payment.id, p2.payment.id]);
    expect((await core.floor.view(code, A))).toMatchObject({ total, paid: total, rest: 0 });

    /* the rating: a code per phone, the text only for the manager */
    const ra = await core.floor.rate(code, A, { happy: false, text: "Чакахме дълго." });
    expect(ra.code).toMatch(/^SC10-\d{10}$/);
    expect(ra).toMatchObject({ pct: 10, google: null, googleMissing: true });
    expect(ra.view.rating).toMatchObject({ happy: false, sent: true, code: ra.code });
    const rb = await core.floor.rate(code, B, { happy: true });
    expect(rb.code).not.toBe(ra.code);
    expect((await core.floor.rate(code, A, { happy: true })).code).toBe(ra.code); /* the answer changes, the code stays */
    expect((await core.floor.view(code, B)).rating).toMatchObject({ happy: true, sent: false, code: rb.code });
    expect(JSON.stringify(await core.floor.view(code, B))).not.toContain("Чакахме");
    expect((await core.codes.check(ra.code))).toMatchObject({ pct: 10, valid: true });
    expect((await core.floor.ratings(s.manager)).map((r) => [r.tableN, r.phone, r.text])).toEqual(expect.arrayContaining([[12, 1, "Чакахме дълго."], [12, 2, ""]]));
    await expect(core.floor.ratings(s.waiter)).rejects.toEqual(err("forbidden", 403));

    /* "Затвори масата": the sitting ends, the table is free, the guests see it */
    const closed = await core.floor.close(s.waiter, 12);
    expect(closed).toMatchObject({ state: "free", session: null, bills: [] });
    expect((await core.floor.hall(s.waiter)).tables.find((x) => x.n === 12)).toMatchObject({ state: "free", session: null });
    const after = await core.floor.open(code, A);
    expect(after).toMatchObject({ status: "closed", session: v1.session, canOrder: false, rest: 0 });
    await expect(core.floor.cartAdd(code, A, { id: pizza.id })).rejects.toEqual(err("session_closed", 409));
    await expect(core.floor.send(code, A)).rejects.toEqual(err("session_closed", 409));
    await expect(core.floor.call(code, A, "water")).rejects.toEqual(err("session_closed", 409));
    /* the rating still works after the close; a new scan opens a new sitting */
    expect((await core.floor.rate(code, B, { happy: false, text: "Студено." })).code).toBe(rb.code);
    const next = await core.floor.open(code, A, true);
    expect(next.status).toBe("open");
    expect(next.session).not.toBe(v1.session);
    expect(next).toMatchObject({ orders: [], total: 0, me: { phone: 1 } });
    /* the other phone of the closed sitting is not pulled into the new one: it keeps its closed view until it scans again */
    expect(await core.floor.open(code, B)).toMatchObject({ status: "closed", session: v1.session });
    expect((await core.floor.view(code, B)).session).toBe(v1.session);
    await expect(core.floor.cartAdd(code, B, { id: pizza.id })).rejects.toEqual(err("session_closed", 409));
    expect(await core.floor.open(code, B, true)).toMatchObject({ status: "open", session: next.session, me: { phone: 2 } });

    /* the log has a line for every staff action */
    const log = (await core.audit.list({ limit: 500 })).map((e) => e.action);
    for (const a of ["floor.qr_confirm", "floor.serve", "floor.unserve", "floor.pay", "floor.close"]) expect(log).toContain(a);
  });
});

describe("the first QR order: 'Откажи' with a reason", () => {
  it("gives the dishes back, says why, and the next send waits for the waiter again; 'Отмени' within the window", async () => {
    const { core, repo, events, t } = mk(), s = await people(core), code = await codeOf(core, s.admin, 3);
    await core.floor.open(code, A); await core.floor.open(code, B);
    await core.floor.cartAdd(code, A, { id: pizza.id, q: 2 });
    await core.floor.cartAdd(code, B, { id: salad.id });
    await core.floor.send(code, A);
    /* a send while one waits joins it: the timer of the waiting order stays */
    t.now += 20_000;
    await core.floor.cartAdd(code, B, { id: dessert.id });
    const j = await core.floor.send(code, B);
    expect(j.to).toBe("waiter");
    expect(j.view.pending).toMatchObject({ at: new Date(T0).toISOString(), n: 4 });
    /* the reason is required and comes from the list */
    await expect(core.floor.qrReject(s.waiter, 3, "" as never)).rejects.toMatchObject({ code: "invalid", status: 422, fields: { reason: expect.any(String) } });
    await expect(core.floor.qrReject(s.waiter, 3, "because" as never)).rejects.toEqual(err("invalid", 422));
    const d = await core.floor.qrReject(s.waiter, 3, "manual");
    expect(d.pending).toBeNull();
    expect(d.reasons.map((r) => r.label)).toEqual(["Тестова или по грешка", "Гостите се отказаха", "Ще я въведа аз"]);
    let v = await core.floor.view(code, A);
    expect(v.rejected).toMatchObject({ reason: "manual", text: "Сервитьорът ще я приеме лично, на масата.", n: 4 });
    expect(v.cart.lines.map((l) => [l.id, l.q, l.phone])).toEqual([[pizza.id, 2, 1], [salad.id, 1, 2], [dessert.id, 1, 2]]);
    expect(v.cart.toWaiter).toBe(true);
    expect(await repo.list("orders")).toHaveLength(0);
    expect(events.filter((e) => e.type === "floor.qr").map((e) => e.data.state)).toEqual(["pending", "pending", "rejected"]);
    /* "Отмени" of the waiter: the order waits again with its old time */
    const u = await core.floor.qrRejectUndo(s.waiter, 3);
    expect(u.pending).toMatchObject({ at: new Date(T0).toISOString(), n: 4 });
    expect((await core.floor.view(code, A))).toMatchObject({ rejected: null, cart: { n: 0 } });
    await core.floor.qrReject(s.waiter, 3, "test");
    t.now += 16_000;
    await expect(core.floor.qrRejectUndo(s.waiter, 3)).rejects.toEqual(err("undo_late", 409));
    /* "Разбрах" hides the notice for the table; the next send waits for the waiter again */
    v = await core.floor.rejectedOk(code, B);
    expect(v.rejected).toBeNull();
    expect((await core.floor.send(code, A)).to).toBe("waiter");
    await expect(core.floor.qrConfirm(s.kitchen, 3)).rejects.toEqual(err("forbidden", 403));
    const c = await core.floor.qrConfirm(s.manager, 3);
    expect((await repo.get<Order>("orders", c.no))!.by).toBe("manager");
    await expect(core.floor.qrConfirm(s.waiter, 3)).rejects.toEqual(err("no_pending", 409));
  });
});

describe("calls", () => {
  it("one active per kind, the cooldown from 'Обслужено', the manager's flag, the cancel", async () => {
    const { core, events, t } = mk(), s = await people(core, [["waiter2", "waiter"]]), code = await codeOf(core, s.admin, 7);
    await core.floor.open(code, A); await core.floor.open(code, B);
    await expect(core.floor.call(code, A, "coffee" as never)).rejects.toMatchObject({ code: "invalid", fields: { kind: expect.any(String) } });
    let v = await core.floor.call(code, A, "water");
    expect(v.calls.state.water).toMatchObject({ state: "active", at: new Date(T0).toISOString() });
    expect(v.calls.active).toEqual([{ kind: "water", label: "Вода или прибори", note: "", at: new Date(T0).toISOString(), taken: false, manager: false }]);
    expect(v.settings).toEqual({ callCooldown: 3, callManager: 5 });
    /* the same call from another phone: it already waits; another kind is free */
    await expect(core.floor.call(code, B, "water")).rejects.toEqual(err("call_active", 409));
    await core.floor.call(code, B, "other", "  детско   столче ");
    let hall = await core.floor.hall(s.waiter);
    expect(hall.calls.map((c) => [c.kind, c.label, c.note, c.phone, c.late, c.forMe])).toEqual([["water", "Вода / прибори", "", 1, false, true], ["other", "Друго", "детско столче", 2, false, true]]);
    expect(hall.tables.find((x) => x.n === 7)).toMatchObject({ state: "call", label: "Вика · Вода / прибори", reason: "water" });
    expect(hall.counters).toMatchObject({ queue: 2, calls: 2 });
    /* after the manager's minutes without "Отивам": flagged for the manager, for the guests too */
    t.now += 5 * 60_000;
    hall = await core.floor.hall(s.manager);
    expect(hall.calls.map((c) => [c.warn, c.late])).toEqual([[true, true], [true, true]]);
    expect((await core.floor.view(code, A)).calls.active.map((c) => c.manager)).toEqual([true, true]);
    /* "Отивам": the colleagues see who took it; a taken call is no longer for the manager */
    const waterId = hall.calls[0].id, otherId = hall.calls[1].id;
    hall = await core.floor.callTake(s.waiter, waterId);
    expect(hall.calls[0].taken).toMatchObject({ by: "waiter", name: "Сервитьор 1", mine: true });
    expect(hall.calls[0].late).toBe(false);
    const h2 = await core.floor.hall(s.waiter2);
    expect(h2.calls[0]).toMatchObject({ taken: { name: "Сервитьор 1", mine: false }, forMe: false });
    expect(h2.counters.queue).toBe(1);
    await expect(core.floor.callTake(s.waiter2, waterId)).rejects.toMatchObject({ code: "taken", status: 409, message: expect.stringContaining("Сервитьор 1") });
    await expect(core.floor.callDone(s.waiter2, waterId)).rejects.toEqual(err("taken", 409));
    expect((await core.floor.view(code, A)).calls.active[0]).toMatchObject({ kind: "water", taken: true, manager: false });
    /* "Отмени" of "Отивам" within the window, then again "Отивам" and "Обслужено" */
    hall = await core.floor.callUndo(s.waiter, waterId);
    expect(hall.calls[0].taken).toBeNull();
    await core.floor.callTake(s.waiter, waterId);
    hall = await core.floor.callDone(s.waiter, waterId);
    expect(hall.calls.map((c) => c.kind)).toEqual(["other"]);
    /* "Отмени" of "Обслужено": the call waits again with its old time */
    hall = await core.floor.callUndo(s.waiter, waterId);
    expect(hall.calls[0]).toMatchObject({ kind: "water", at: new Date(T0).toISOString() });
    await core.floor.callDone(s.waiter, waterId);
    const servedAt = t.now;
    /* the same kind is locked callCooldown minutes AFTER "Обслужено"; the other kinds work */
    v = await core.floor.view(code, A);
    expect(v.calls.state.water).toEqual({ state: "cool", at: null, until: new Date(servedAt + 3 * 60_000).toISOString() });
    t.now += 2 * 60_000;
    await expect(core.floor.call(code, B, "water")).rejects.toMatchObject({ code: "call_cooldown", status: 409, retryIn: 60 });
    await expect(core.floor.callUndo(s.waiter, waterId)).rejects.toEqual(err("undo_late", 409));
    await core.floor.call(code, B, "order");
    t.now += 60_000;
    v = await core.floor.call(code, B, "water");
    expect(v.calls.state.water.state).toBe("active");
    /* the guest cancels: free again at once; "Отмени" brings the same call back */
    v = await core.floor.callCancel(code, B, "water");
    expect(v.calls.state.water.state).toBe("free");
    v = await core.floor.callRestore(code, B, "water");
    expect(v.calls.state.water).toMatchObject({ state: "active", at: new Date(t.now).toISOString() });
    v = await core.floor.callCancel(code, A, "water"); /* any phone of the table */
    expect((await core.floor.call(code, A, "water")).calls.state.water.state).toBe("active");
    await expect(core.floor.callCancel(code, A, "bill")).rejects.toEqual(err("not_found", 404));
    /* a manager may mark a call a waiter took; the kitchen may not touch calls */
    await core.floor.callTake(s.waiter2, otherId);
    await expect(core.floor.callTake(s.kitchen, otherId)).rejects.toEqual(err("forbidden", 403));
    expect((await core.floor.callDone(s.manager, otherId)).calls.some((c) => c.id === otherId)).toBe(false);
    expect(events.filter((e) => e.type === "floor.call").every((e) => !e.to.table && !e.to.public)).toBe(true);
    const log = (await core.audit.list({ limit: 500 })).map((e) => e.action);
    for (const a of ["floor.call_take", "floor.call_done", "floor.call_undo"]) expect(log).toContain(a);
  });
  it("the bill call: a repeated request joins it; the cooldown after 'Обслужено'; a cancel takes only the phone's own request back", async () => {
    const { core, t } = mk(), s = await people(core), code = await codeOf(core, s.admin, 5);
    await core.floor.open(code, A); await core.floor.open(code, B);
    await expect(core.floor.bill(code, A, { pay: "cash", split: "one" })).rejects.toEqual(err("nothing_ordered", 409));
    await core.floor.cartAdd(code, A, { id: pizza.id }); await core.floor.cartAdd(code, B, { id: salad.id });
    await core.floor.send(code, A);
    const no = (await core.floor.qrConfirm(s.waiter, 5)).no;
    await expect(core.floor.bill(code, A, { pay: "x" as never, split: "y" as never })).rejects.toMatchObject({ code: "invalid", fields: { pay: expect.any(String), split: expect.any(String) } });
    let v = await core.floor.bill(code, A, { pay: "cash", split: "guests" });
    expect(v.bill.mine).toMatchObject({ split: "guests", keys: [no + ":0"], sum: pizza.p });
    const at = v.calls.active[0].at;
    t.now += 40_000;
    v = await core.floor.bill(code, A, { pay: "card", split: "guests" }); /* the same phone again: the call keeps its time */
    expect(v.calls.active[0].at).toBe(at);
    expect(v.bill.mine!.pay).toBe("card");
    /* phone 2 asks for "Една сметка": only what is left, never the dish of phone 1 */
    v = await core.floor.bill(code, B, { pay: "cash", split: "one" });
    expect(v.bill.mine).toMatchObject({ split: "one", keys: [no + ":1"], sum: salad.p });
    expect(v.calls.active).toHaveLength(1);
    /* phone 2 takes its request back: the call stays for phone 1 */
    v = await core.floor.callCancel(code, B, "bill");
    expect(v.bill.mine).toBeNull();
    expect(v.calls.state.bill.state).toBe("active");
    v = await core.floor.callCancel(code, A, "bill");
    expect(v.calls.state.bill.state).toBe("free");
    /* everything asked for by one phone: nothing left for the other */
    await core.floor.bill(code, A, { pay: "cash", split: "one" });
    await expect(core.floor.bill(code, B, { pay: "cash", split: "one" })).rejects.toMatchObject({ code: "bill_nothing", message: "Всичко вече е поискано." });
    await expect(core.floor.bill(code, B, { pay: "cash", split: "guests" })).rejects.toEqual(err("bill_nothing", 409));
    await expect(core.floor.pick(code, B, no + ":1", true)).rejects.toEqual(err("pick_gone", 409));
    await expect(core.floor.pick(code, A, no + ":1", true)).rejects.toEqual(err("bill_asked", 409));
    /* the waiter brings the bill ("Обслужено") without marking it paid: the same request waits like every call */
    const hall = await core.floor.hall(s.waiter);
    await core.floor.callDone(s.waiter, hall.calls[0].id);
    await expect(core.floor.bill(code, A, { pay: "cash", split: "one" })).rejects.toMatchObject({ code: "call_cooldown", retryIn: 180 });
    t.now += 3 * 60_000;
    v = await core.floor.bill(code, A, { pay: "cash", split: "one" });
    expect(v.calls.active.map((c) => c.kind)).toEqual(["bill"]);
  });
});

describe("the bill of the waiter", () => {
  it("separate guests: one order per bill; by guest, by dish, one bill; the sum is never more than the rest", async () => {
    const { core, repo } = mk(), s = await people(core);
    await expect(core.floor.order(s.waiter, 14, { lines: [{ id: pizza.id, q: 1, guest: "Иван" }] })).rejects.toMatchObject({ code: "invalid", fields: { "lines.0.guest": expect.any(String) } });
    await expect(core.floor.order(s.waiter, 14, { lines: [] })).rejects.toMatchObject({ code: "empty", message: "Поръчката е празна." });
    /* a free table gets a sitting from the waiter's first action; nothing is saved when a line is wrong */
    await expect(core.floor.order(s.waiter, 14, { lines: [{ id: pizza.id, q: 1 }, { id: steak.id, q: 1 }] })).rejects.toMatchObject({ code: "invalid", status: 422, fields: { "lines.1.grams": expect.stringContaining("100") } });
    await expect(core.floor.order(s.waiter, 14, { lines: [{ id: steak.id, q: 1, grams: 2050 }] })).rejects.toMatchObject({ fields: { "lines.0.grams": expect.any(String) } });
    expect(await repo.list("orders")).toHaveLength(0);
    expect((await core.floor.table(s.waiter, 14)).session).toBeNull();
    const d = await core.floor.order(s.waiter, 14, { note: "бързат", lines: [
      { id: pizza.id, q: 2, guest: "Гост 1", note: "без  лук   моля", mods: ["без лук"] }, { id: steak.id, q: 1, grams: 500, guest: "Гост 1" },
      { id: salad.id, q: 1, guest: "Гост 2" }, { id: dessert.id, q: 1 },
    ] });
    expect(d.orders).toHaveLength(3);
    expect(d.session).toMatchObject({ by: "waiter", phones: 0 });
    expect(d.bills.map((b) => [b.name, b.sum])).toEqual([["Обща сметка", dessert.p], ["Гост 1", r2(pizza.p * 2 + steak.p * 5)], ["Гост 2", salad.p]]);
    const o = (await repo.list<Order>("orders")).find((x) => x.bill === "Гост 1")!;
    expect(o).toMatchObject({ channel: "waiter", mode: "pickup", table: "G2", by: "waiter", note: "бързат", via: "", payLabel: "На масата", addr: "", zone: "" });
    expect(o.lines).toEqual([
      expect.objectContaining({ id: pizza.id, q: 2, mods: ["без лук"], note: "без лук моля", guest: "Гост 1", unit: pizza.p }),
      expect.objectContaining({ id: steak.id, q: 1, grams: 500, unit: r2(steak.p * 5), guest: "Гост 1" }),
    ]);
    const total = r2(dessert.p + pizza.p * 2 + steak.p * 5 + salad.p);
    expect(d).toMatchObject({ total, rest: total, state: "busy" });
    /* by guest */
    let p = await core.floor.pay(s.waiter, 14, { how: "card", bill: "Гост 2" });
    expect(p.payment).toMatchObject({ sum: salad.p, label: "Гост 2", how: "card" });
    await expect(core.floor.pay(s.waiter, 14, { how: "card", bill: "Гост 2" })).rejects.toEqual(err("invalid", 422));
    await expect(core.floor.pay(s.waiter, 14, { how: "bitcoin" as never })).rejects.toMatchObject({ fields: { how: expect.any(String) } });
    /* by dish: an unknown line and a paid line are refused, nothing is half paid */
    const g1 = d.bills[1].orders[0].lines.map((l) => l.key), sal = d.bills[2].orders[0].lines[0].key;
    await expect(core.floor.pay(s.waiter, 14, { how: "cash", keys: [g1[0], "9999:0"] })).rejects.toEqual(err("not_found", 404));
    await expect(core.floor.pay(s.waiter, 14, { how: "cash", keys: [g1[0], sal] })).rejects.toEqual(err("paid", 409));
    p = await core.floor.pay(s.waiter, 14, { how: "cash", keys: [g1[1]] });
    expect(p.payment.sum).toBe(r2(steak.p * 5));
    expect(p.bills[1]).toMatchObject({ paid: r2(steak.p * 5), rest: r2(pizza.p * 2) });
    /* one bill: exactly the rest */
    p = await core.floor.pay(s.waiter, 14, { how: "cash" });
    expect(p.payment.sum).toBe(r2(dessert.p + pizza.p * 2));
    expect(p).toMatchObject({ paid: total, rest: 0, canClose: true });
    expect(r2(p.payments.reduce((a, x) => a + x.sum, 0))).toBe(total);
    /* unserved dishes are listed; "Затвори въпреки това" closes */
    await expect(core.floor.close(s.waiter, 14)).rejects.toMatchObject({ code: "unserved", status: 409, lines: expect.arrayContaining(["1× " + steak.n + " · 500 гр.", "2× " + pizza.n]) });
    const c = await core.floor.close(s.waiter, 14, true);
    expect(c.state).toBe("free");
    expect((await repo.list<Order>("orders")).map((x) => x.status)).toEqual(["picked_up", "picked_up", "picked_up"]);
    expect((await repo.list<TableSession>("table_sessions"))[0]).toMatchObject({ status: "closed", closedBy: "waiter" });
    await expect(core.floor.close(s.waiter, 14)).rejects.toEqual(err("no_session", 409));
  });
  it("a line the kitchen marked sold out after the order is not charged and not served; the waiter's order serves the call 'Поръчка'", async () => {
    const { core, repo } = mk(), s = await people(core), code = await codeOf(core, s.admin, 2);
    await core.floor.open(code, A);
    await core.floor.call(code, A, "order");
    const d = await core.floor.order(s.waiter, 2, { lines: [{ id: pizza.id, q: 1 }, { id: salad.id, q: 1 }] });
    expect(d.calls).toEqual([]);
    expect((await core.floor.view(code, A)).calls.state.order.state).toBe("cool");
    const o = (await repo.get<Order>("orders", d.orders[0]))!;
    o.lines[1].out = true; o.lines[0].ks = "ready"; o.lines[0].readyAt = new Date(T0).toISOString();
    await repo.put("orders", o);
    const v = await core.floor.view(code, A);
    expect(v.total).toBe(pizza.p);
    expect(v.orders[0].lines.map((l) => [l.out, l.sum, l.who])).toEqual([[false, pizza.p, "Сервитьор"], [true, 0, "Сервитьор"]]);
    await core.floor.serve(s.waiter, 2);
    expect((await repo.get<Order>("orders", o.no))!.status).toBe("picked_up");
    const p = await core.floor.pay(s.waiter, 2, { how: "cash" });
    expect(p.payment).toMatchObject({ sum: pizza.p, keys: [o.no + ":0"] });
    expect((await repo.get<Order>("orders", o.no))!).toMatchObject({ total: pizza.p, sub: pizza.p }); /* the reports count what was paid */
    expect((await core.floor.close(s.waiter, 2)).state).toBe("free");
  });
});

describe("the rules of a table order", () => {
  it("the kitchen is closed after 22:30 and before 10:00: nothing can be ordered, calls still work", async () => {
    const { core, at } = mk("19:42"), s = await people(core), code = await codeOf(core, s.admin, 1);
    await core.floor.open(code, A);
    await core.floor.cartAdd(code, A, { id: pizza.id });
    const late = at("22:31");
    expect(await late.floor.view(code, A)).toMatchObject({ canOrder: false, kitchen: { open: false, before: false } });
    await expect(late.floor.cartAdd(code, A, { id: salad.id })).rejects.toMatchObject({ code: "closed", status: 409, message: expect.stringContaining("22:30") });
    await expect(late.floor.send(code, A)).rejects.toEqual(err("closed", 409));
    await expect(late.floor.order(s.waiter, 1, { lines: [{ id: pizza.id, q: 1 }] })).rejects.toMatchObject({ code: "closed", message: expect.stringContaining("управителят") });
    expect((await late.floor.call(code, A, "bill")).calls.state.bill.state).toBe("active");
    const early = at("09:30");
    expect((await early.floor.view(code, A)).kitchen).toMatchObject({ open: false, before: true });
    await expect(early.floor.send(code, A)).rejects.toMatchObject({ code: "closed", message: expect.stringContaining("10:00") });
    /* a QR order sent in time and confirmed after 22:30 is refused too: the waiter rejects it */
    await at("22:29").floor.send(code, A);
    await expect(late.floor.qrConfirm(s.waiter, 1)).rejects.toEqual(err("closed", 409));
    expect((await at("22:29").floor.qrConfirm(s.waiter, 1)).no).toMatch(/^\d+$/);
  });
  it("sold out, removed, unknown, breakfast after 11:30, the lunch menu, the quantity, the add-ons", async () => {
    const { core, repo, at } = mk("11:20"), s = await people(core), code = await codeOf(core, s.admin, 4);
    await core.floor.open(code, A);
    await expect(core.floor.cartAdd(code, A, { id: soldOut.id })).rejects.toMatchObject({ code: "sold_out", status: 409, lines: [soldOut.id] });
    await expect(core.floor.cartAdd(code, A, { id: "nope" })).rejects.toEqual(err("unknown_item", 422));
    await expect(core.floor.cartAdd(code, A, { id: "l-supa-topcheta" })).rejects.toMatchObject({ code: "lunch_table", status: 409 });
    await expect(core.floor.order(s.waiter, 4, { lines: [{ id: "l-supa-topcheta", q: 1 }] })).rejects.toMatchObject({ code: "lunch_table", message: expect.stringContaining("[ЛИПСВА: обедно меню от масата]") });
    await expect(core.floor.cartAdd(code, A, { id: pizza.id, q: 51 })).rejects.toEqual(err("bad_qty", 422));
    await expect(core.floor.cartAdd(code, A, { id: salad.id, mods: ["+ Кашкавал"] })).rejects.toEqual(err("bad_mod", 422));
    /* breakfast: in the cart before 11:30, refused at 11:31 (the line is marked, the send is refused) */
    let v = await core.floor.cartAdd(code, A, { id: breakfast.id });
    expect(v.kitchen.breakfast).toBe(true);
    const noon = at("11:31");
    await expect(noon.floor.cartAdd(code, A, { id: breakfast.id })).rejects.toMatchObject({ code: "breakfast_closed", status: 409 });
    v = await noon.floor.view(code, A);
    expect(v.cart.lines[0].block).toBe("breakfast");
    await expect(noon.floor.send(code, A)).rejects.toMatchObject({ code: "breakfast_closed", message: expect.stringContaining("11:30") });
    await expect(noon.floor.order(s.waiter, 4, { lines: [{ id: breakfast.id, q: 1 }] })).rejects.toEqual(err("breakfast_closed", 409));
    await noon.floor.cartQty(code, A, v.cart.lines[0].key, 0);
    /* a dish sold out after it went into the cart: marked in the cart, the send is refused; the kitchen brings it back */
    await noon.floor.cartAdd(code, A, { id: pizza.id });
    await core.menu.setSoldOut(pizza.id, true, "kitchen");
    expect((await noon.floor.view(code, A)).cart.lines[0].block).toBe("sold_out");
    await expect(noon.floor.send(code, A)).rejects.toEqual(err("sold_out", 409));
    await expect(noon.floor.order(s.waiter, 4, { lines: [{ id: pizza.id, q: 1 }] })).rejects.toMatchObject({ code: "sold_out", message: expect.stringContaining("Махни го от поръчката.") });
    await core.menu.setSoldOut(pizza.id, false, "kitchen");
    expect((await noon.floor.send(code, A)).to).toBe("waiter");
    expect(await repo.list("orders")).toHaveLength(0);
  });
  it("a steak 'за 100 гр.' from the table always waits for the waiter, who enters the grams", async () => {
    const { core, repo } = mk(), s = await people(core), code = await codeOf(core, s.admin, 6);
    await core.floor.open(code, A);
    await core.floor.cartAdd(code, A, { id: pizza.id });
    await core.floor.send(code, A);
    await core.floor.qrConfirm(s.waiter, 6); /* the first order is confirmed: the next ones go to the kitchen */
    await core.floor.cartAdd(code, A, { id: salad.id });
    let v = await core.floor.cartAdd(code, A, { id: steak.id });
    expect(v.cart).toMatchObject({ open: true, sum: salad.p, toWaiter: true });
    expect(v.cart.lines[1]).toMatchObject({ per100: true, unit: null, sum: null });
    const sent = await core.floor.send(code, A);
    expect(sent.to).toBe("waiter");
    const d = await core.floor.table(s.waiter, 6);
    expect(d.pending).toMatchObject({ open: true, sum: salad.p });
    expect(d.pending!.lines[1]).toMatchObject({ per100: true, price100: steak.p, unit: null });
    const key = d.pending!.lines[1].key;
    await expect(core.floor.qrConfirm(s.waiter, 6)).rejects.toMatchObject({ code: "invalid", status: 422, fields: { ["grams." + key]: expect.stringContaining("грамажа") } });
    await expect(core.floor.qrConfirm(s.waiter, 6, { [key]: 50 })).rejects.toMatchObject({ fields: { ["grams." + key]: expect.any(String) } });
    const c = await core.floor.qrConfirm(s.waiter, 6, { [key]: 450 });
    const o = (await repo.get<Order>("orders", c.no))!;
    expect(o.lines[1]).toMatchObject({ id: steak.id, grams: 450, unit: r2(steak.p * 4.5) });
    expect(o.total).toBe(r2(salad.p + steak.p * 4.5));
    v = await core.floor.view(code, A);
    expect(v.orders[1].lines[1]).toMatchObject({ grams: 450, sum: r2(steak.p * 4.5) });
    /* without a steak the next order goes straight to the kitchen again */
    await core.floor.cartAdd(code, A, { id: dessert.id });
    expect((await core.floor.send(code, A)).to).toBe("kitchen");
  });
});

describe("rights and the guests' keys", () => {
  it("a wrong or replaced code is 404; a wrong token is 403; up to 7 phones; nothing personal leaves the sitting", async () => {
    const { core, events } = mk(), s = await people(core), code = await codeOf(core, s.admin, 9);
    await expect(core.floor.open("zzzzzzzz", A)).rejects.toMatchObject({ code: "not_found", status: 404, message: expect.stringContaining("Този код вече не работи") });
    await expect(core.floor.open(code, "short")).rejects.toEqual(err("guest", 403));
    await core.floor.open(code, A);
    await expect(core.floor.view(code, B)).rejects.toMatchObject({ code: "guest", status: 403, message: "Сканирайте кода на масата отново." });
    await expect(core.floor.cartAdd(code, B, { id: pizza.id })).rejects.toEqual(err("guest", 403));
    await expect(core.floor.send(code, B)).rejects.toEqual(err("guest", 403));
    await expect(core.floor.call(code, B, "water")).rejects.toEqual(err("guest", 403));
    await expect(core.floor.bill(code, B, { pay: "cash", split: "one" })).rejects.toEqual(err("guest", 403));
    await expect(core.floor.rate(code, B, { happy: true })).rejects.toEqual(err("guest", 403));
    expect(await core.floor.stream(code, B)).toBeNull();
    expect(await core.floor.stream("zzzzzzzz", A)).toBeNull();
    /* the code of another table does not open this sitting */
    const other = await codeOf(core, s.admin, 10);
    await expect(core.floor.view(other, A)).rejects.toEqual(err("guest", 403));
    /* the real-time payload: only for the guests of this sitting, without tokens and without anything personal */
    const sid = (await core.floor.view(code, A)).session;
    expect(await core.floor.stream(code, A)).toBe(sid);
    await core.floor.cartAdd(code, A, { id: pizza.id });
    const ev = events.filter((e) => e.type === "floor.session");
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) { expect(e.to).toEqual({ table: sid }); expect(JSON.stringify(e.data)).not.toContain(A); expect(e.data.view.me).toBeNull(); expect(e.data.view.bill.want).toBeNull(); }
    expect(JSON.stringify(await core.floor.view(code, A))).not.toContain(A);
    /* up to 7 phones */
    for (let i = 2; i <= 7; i++) expect((await core.floor.open(code, String(i).repeat(32))).me!.phone).toBe(i);
    await expect(core.floor.open(code, "8".repeat(32))).rejects.toEqual(err("table_full", 409));
    /* "Нов код": the old label stops working at once */
    await core.hall.qrRenew(s.admin, "S9");
    await expect(core.floor.view(code, A)).rejects.toEqual(err("not_found", 404));
    await expect(core.floor.cartAdd(code, A, { id: pizza.id })).rejects.toEqual(err("not_found", 404));
  });
  it("the waiter's functions: the section 'Сервитьор', and the main admin, the owner and the manager; never the kitchen, the driver, marketing", async () => {
    const { core } = mk(), s = await people(core);
    const calls: [string, (x: StaffCtx) => Promise<unknown>][] = [
      ["hall", (x) => core.floor.hall(x)], ["table", (x) => core.floor.table(x, 1)], ["ready", (x) => core.floor.ready(x)], ["search", (x) => core.floor.search(x, "12")],
      ["seat", (x) => core.floor.seat(x, 20)], ["order", (x) => core.floor.order(x, 1, { lines: [] })], ["serve", (x) => core.floor.serve(x, 1)], ["unserve", (x) => core.floor.unserve(x, 1, [])],
      ["pay", (x) => core.floor.pay(x, 1, { how: "cash" })], ["close", (x) => core.floor.close(x, 1)], ["qrConfirm", (x) => core.floor.qrConfirm(x, 1)], ["qrReject", (x) => core.floor.qrReject(x, 1, "test")],
      ["qrRejectUndo", (x) => core.floor.qrRejectUndo(x, 1)], ["callTake", (x) => core.floor.callTake(x, "nope")], ["callDone", (x) => core.floor.callDone(x, "nope")], ["callUndo", (x) => core.floor.callUndo(x, "nope")],
      ["shiftMine", (x) => core.floor.shiftMine(x)], ["shiftStart", (x) => core.floor.shiftStart(x, [])], ["shiftEnd", (x) => core.floor.shiftEnd(x)],
    ];
    for (const [name, fn] of calls) {
      const ok: string[] = [];
      for (const r of ROLES) { try { await fn(s[r]); ok.push(r); } catch (e) { if ((e as { status?: number }).status !== 403) ok.push(r); } }
      expect(ok, name).toEqual(["admin", "owner", "manager", "waiter"]);
      await expect(fn(null as never), name).rejects.toEqual(err("auth", 401));
    }
    /* the manager's functions: never a waiter */
    for (const [name, fn] of [["shiftView", (x: StaffCtx) => core.floor.shiftView(x)], ["shiftSetTables", (x: StaffCtx) => core.floor.shiftSetTables(x, "waiter", [1])], ["ratings", (x: StaffCtx) => core.floor.ratings(x)]] as [string, (x: StaffCtx) => Promise<unknown>][]) {
      const ok: string[] = [];
      for (const r of ROLES) { try { await fn(s[r]); ok.push(r); } catch (e) { if ((e as { status?: number }).status !== 403) ok.push(r); } }
      expect(ok, name).toEqual(["admin", "owner", "manager"]);
    }
    /* the section can be given in "Роли и права" */
    await core.staff.setRole("marketing", ["dashboard", "waiter"], "admin");
    const mk2 = (await core.staff.bySession((await core.staff.login("marketing", PW, "9.9.9.9")).token))!;
    expect((await core.floor.hall(mk2)).tables.length).toBe(20);
    /* seating without an order */
    expect(await core.floor.seat(s.waiter, 20)).toMatchObject({ state: "wait", label: "Чака поръчка", session: { by: "waiter" } });
    await expect(core.floor.table(s.waiter, 99)).rejects.toEqual(err("not_found", 404));
  });
});

describe("many phones at once", () => {
  it("parallel changes of one table never lose a line; a line is paid once even when two waiters press together", async () => {
    const { core, repo } = mk(), s = await people(core, [["waiter2", "waiter"]]), code = await codeOf(core, s.admin, 17);
    const toks = Array.from({ length: 6 }, (_, i) => String(i + 1).repeat(32));
    await Promise.all(toks.map((t) => core.floor.open(code, t)));
    const v0 = await core.floor.view(code, toks[0]);
    expect(v0.phones.map((p) => p.phone)).toEqual([1, 2, 3, 4, 5, 6]);
    await Promise.all(toks.flatMap((t) => [core.floor.cartAdd(code, t, { id: pizza.id }), core.floor.cartAdd(code, t, { id: salad.id })]));
    const v = await core.floor.view(code, toks[0]);
    expect(v.cart).toMatchObject({ n: 12, sum: r2((pizza.p + salad.p) * 6) });
    expect(v.rev).toBeGreaterThan(v0.rev);
    /* two sends at the same moment: one waiting order, nothing twice */
    const sends = await Promise.allSettled([core.floor.send(code, toks[0]), core.floor.send(code, toks[1])]);
    expect(sends.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await core.floor.view(code, toks[0])).pending).toMatchObject({ n: 12 });
    const c = await Promise.allSettled([core.floor.qrConfirm(s.waiter, 17), core.floor.qrConfirm(s.waiter2, 17)]);
    expect(c.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await repo.list("orders")).toHaveLength(1);
    const total = r2((pizza.p + salad.p) * 6);
    const pays = await Promise.allSettled([core.floor.pay(s.waiter, 17, { how: "cash" }), core.floor.pay(s.waiter2, 17, { how: "card" })]);
    expect(pays.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const d = await core.floor.table(s.waiter, 17);
    expect(d).toMatchObject({ total, paid: total, rest: 0 });
    expect(d.payments).toHaveLength(1);
  });
});

describe("a sitting ends with the day", () => {
  it("an open sitting from yesterday with nothing unpaid is closed by the next scan; with an unpaid bill it stays", async () => {
    const { core, t } = mk(), s = await people(core), code = await codeOf(core, s.admin, 11), code2 = await codeOf(core, s.admin, 8);
    const v = await core.floor.open(code, A);
    await core.floor.cartAdd(code, A, { id: pizza.id });
    await core.floor.open(code2, A);
    await core.floor.order(s.waiter, 8, { lines: [{ id: pizza.id, q: 1 }] });
    t.now += 24 * 3600_000;
    const hall = await core.floor.hall(s.waiter);
    expect(hall.tables.find((x) => x.n === 11)!.state).toBe("free");
    expect(hall.tables.find((x) => x.n === 8)!.state).toBe("busy");
    const n = await core.floor.open(code, B);
    expect(n.session).not.toBe(v.session);
    expect(n).toMatchObject({ status: "open", cart: { n: 0 }, me: { phone: 1 } });
    /* yesterday's guest scans again: a new sitting, not yesterday's closed one */
    expect((await core.floor.open(code, A)).session).toBe(n.session);
  });
});

describe("the waiter's shift", () => {
  it("start with 'Моите маси днес', a colleague's table is refused, the manager moves tables, the end hands the occupied ones over", async () => {
    const { core, events, t } = mk(), s = await people(core, [["waiter2", "waiter"]]);
    await expect(core.floor.shiftStart(s.waiter, [])).rejects.toMatchObject({ code: "invalid", fields: { tables: "Избери поне една маса." } });
    await expect(core.floor.shiftStart(s.waiter, [99])).rejects.toEqual(err("invalid", 422));
    let m = await core.floor.shiftStart(s.waiter, [3, 4, 7, "S12"]);
    expect(m.shift).toMatchObject({ since: new Date(T0).toISOString() });
    expect(m.shift!.tables.map((x) => x.n)).toEqual([3, 4, 7, 12]);
    await expect(core.floor.shiftStart(s.waiter2, [7, 8])).rejects.toMatchObject({ code: "taken", status: 409, message: "Маса 7 вече е при Сервитьор 1. Управителят може да я премести." });
    m = await core.floor.shiftStart(s.waiter2, [8, 9]);
    expect(m.tables.find((x) => x.n === 7)).toMatchObject({ owner: { name: "Сервитьор 1" }, mine: false });
    expect(m.colleagues).toEqual([{ username: "waiter", name: "Сервитьор 1", tables: 4 }]);
    /* whose table it is, in the hall; the calls of my tables and the free ones are in my queue */
    const code = await codeOf(core, s.admin, 8);
    await core.floor.open(code, A);
    await core.floor.call(code, A, "water");
    let h1 = await core.floor.hall(s.waiter), h2 = await core.floor.hall(s.waiter2);
    expect(h1.me).toMatchObject({ onShift: true, tables: [3, 4, 7, 12] });
    expect(h1.tables.find((x) => x.n === 8)).toMatchObject({ owner: { username: "waiter2", name: "Сервитьор 2" }, mine: false });
    expect(h2.tables.find((x) => x.n === 8)!.mine).toBe(true);
    expect([h1.calls[0].mine, h1.calls[0].forMe, h2.calls[0].mine]).toEqual([false, true, true]);
    expect(h1.counters.queue).toBe(h2.counters.queue);
    /* the manager: the answer times come from the real calls; null without data */
    t.now += 90_000;
    await core.floor.callTake(s.waiter2, h2.calls[0].id);
    let sv = await core.floor.shiftView(s.manager);
    expect(sv.waiters.map((w) => [w.name, w.tables.map((x) => x.n), w.waiting, w.avgSec, w.answered])).toEqual([["Сервитьор 1", [3, 4, 7, 12], 0, null, 0], ["Сервитьор 2", [8, 9], 0, 90, 1]]);
    expect(sv.unassigned).toHaveLength(14);
    /* the manager changes the tables: at least one stays, a given table leaves its old waiter, a taken one goes to the colleague */
    await expect(core.floor.shiftSetTables(s.manager, "waiter", [])).rejects.toMatchObject({ code: "invalid", message: "Сервитьор 1 трябва да има поне една маса." });
    await expect(core.floor.shiftSetTables(s.manager, "nobody", [1])).rejects.toEqual(err("not_found", 404));
    events.length = 0;
    sv = await core.floor.shiftSetTables(s.manager, "waiter", [3, 4, 9, 1]);
    expect(sv.waiters.map((w) => w.tables.map((x) => x.n))).toEqual([[1, 3, 4, 9], [7, 8, 12]]);
    expect(events.filter((e) => e.type === "shift.update").map((e) => e.data.username).sort()).toEqual(["waiter", "waiter2"]);
    expect(events.every((e) => !e.to.public && !e.to.table)).toBe(true);
    expect((await core.floor.shiftMine(s.waiter)).shift!.tables.map((x) => x.n)).toEqual([1, 3, 4, 9]);
    /* the end: the occupied tables go to the colleague, the free ones stay without a waiter */
    await expect(core.floor.shiftEnd(s.waiter2, "nobody")).rejects.toMatchObject({ code: "invalid", fields: { to: expect.any(String) } });
    expect(await core.floor.shiftEnd(s.waiter2, "waiter")).toEqual({ ok: true, handed: [8], to: "waiter" });
    sv = await core.floor.shiftView(s.owner);
    expect(sv.waiters.map((w) => [w.name, w.tables.map((x) => x.n)])).toEqual([["Сервитьор 1", [1, 3, 4, 8, 9]]]);
    expect((await core.floor.shiftMine(s.waiter2)).shift).toBeNull();
    expect(await core.floor.shiftEnd(s.waiter2)).toEqual({ ok: true, handed: [], to: null });
    const log = (await core.audit.list({ limit: 500 })).map((e) => e.action);
    for (const a of ["shift.start", "shift.tables", "shift.end"]) expect(log).toContain(a);
    /* a shift never continues on the next day */
    t.now += 24 * 3600_000;
    expect((await core.floor.shiftView(s.manager)).waiters).toEqual([]);
    expect((await core.floor.hall(s.waiter)).me.onShift).toBe(false);
  });
});

describe("the waiter's search", () => {
  it("tables, orders at the tables, today's reservations with masked phones, sold out today", async () => {
    const { core } = mk(), s = await people(core), code = await codeOf(core, s.admin, 12);
    await core.floor.shiftStart(s.waiter, [12, 13]);
    await core.floor.open(code, A);
    await core.floor.call(code, A, "water");
    const d = await core.floor.order(s.waiter, 12, { lines: [{ id: pizza.id, q: 2 }] });
    const r = await core.reservations.create({ date: "2026-11-16", time: "20:30", people: 2, name: "Мария Петрова", phone: "0888123456", table: "S5", zone: "salon" } as never);
    expect(r.id).toBeTruthy();
    let f = await core.floor.search(s.waiter, "12");
    expect(f.tables.map((x) => [x.n, x.state, x.mine])).toEqual([[12, "call", true]]);
    f = await core.floor.search(s.waiter, "свободни градина");
    expect(f.tables.map((x) => x.n)).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect((await core.floor.search(s.waiter, "моите")).tables.map((x) => x.n)).toEqual([12, 13]);
    expect((await core.floor.search(s.waiter, "вика")).tables.map((x) => x.n)).toEqual([12]);
    /* an order by its number or by a dish in it */
    f = await core.floor.search(s.waiter, d.orders[0]);
    expect(f.orders.map((o) => [o.no, o.table.n, o.lines[0].q])).toEqual([[d.orders[0], 12, 2]]);
    f = await core.floor.search(s.waiter, pizza.n.split(" ").slice(0, 2).join(" "));
    expect(f.orders.map((o) => o.no)).toEqual([d.orders[0]]);
    /* reservations: the hour, the digits of the phone, the name; the phone is masked */
    for (const q of ["20:30", "3456", "мария", "резервации"]) {
      f = await core.floor.search(s.waiter, q);
      expect(f.reservations, q).toEqual([{ id: r.id, time: "20:30", people: 2, tableN: 5, name: "Мария Петрова", phone: "0888 •• •• 56", note: "", status: expect.any(String) }]);
    }
    expect(JSON.stringify(await core.floor.search(s.waiter, "мария"))).not.toContain("0888123456");
    expect((await core.floor.search(s.waiter, "19:00")).reservations).toEqual([]);
    /* sold out today: the data and today's switch */
    await core.menu.setSoldOut(pizza2.id, true, "kitchen");
    f = await core.floor.search(s.waiter, "изчерпано");
    expect(f.soldOut.map((x) => x.id).sort()).toEqual([soldOut.id, pizza2.id].sort());
    /* without the section "Резервации" the reservations are not searched at all */
    await core.staff.setRole("waiter", ["dashboard", "waiter"], "admin");
    const w = (await core.staff.bySession((await core.staff.login("waiter", PW, "8.8.8.8")).token))!;
    expect((await core.floor.search(w, "мария")).reservations).toBeNull();
    expect(await core.floor.search(w, "")).toEqual({ tables: [], orders: [], reservations: null, soldOut: [] });
  });
});
