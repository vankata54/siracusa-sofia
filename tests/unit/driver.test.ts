/* The driver's core (src/core/driver.ts): the shift, the whole delivery flow from a web order, "Отмени", a problem and
   its two endings, the question about an address outside the zones, the route, fuel and the cash, the end of the shift,
   what the manager and the owner see, the rights. Direct calls of the core (the server and the demo call the same). */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, publicOrder, DRIVER_MISSING, type Hasher, type Order, type StaffCtx, type RoleId, type PushPayload } from "../../src/core/index.ts";
import { items } from "../../src/lib/data.ts";
import { serial } from "../../src/core/rights.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const T0 = Date.parse("2026-11-16T17:42:00Z"); /* Monday 19:42 in Sofia */
const MINUTE = 60_000, PW = "a-long-password-1", PHONE = "0888123456";
type Ev = [string, Record<string, unknown>, Record<string, unknown>];
function mk() {
  const t = { now: T0 }, events: Ev[] = [], pushed: PushPayload[] = [];
  const core = createCore({ repo: new MemoryRepo(), hasher, now: () => new Date(t.now), clock: "19:42", smsDemo: true,
    emit: (type, data, to) => { events.push([type, data as Record<string, unknown>, to as Record<string, unknown>]); },
    push: async (_subs, payload) => { pushed.push(payload); return []; } });
  return { core, t, events, pushed };
}
type Core = ReturnType<typeof mk>["core"];
const USERS: [string, RoleId][] = [["admin", "admin"], ["owner", "owner"], ["manager", "manager"], ["waiter", "waiter"], ["kitchen", "kitchen"], ["marketing", "marketing"], ["driver", "driver"], ["driver2", "driver"]];
async function people(core: Core) {
  const s = {} as Record<string, StaffCtx>;
  for (const [u, r] of USERS) await core.staff.upsert({ username: u, name: u === "driver" ? "Шофьор 1" : u === "driver2" ? "Шофьор 2" : u, role: r, password: PW });
  for (const [u] of USERS) s[u] = (await core.staff.bySession((await core.staff.login(u, PW, "1.1.1." + u)).token))!;
  return s;
}
const dish = items.find((x) => x.cat === "pitsi" && !x.t.includes("out"))!;
const ADDR = { d1: "ж.к. Дружба 1, бл. 72", d2: "ж.к. Дружба 2, бл. 311", bus: "кв. Бусманци, ул. Първа 5", gor: "кв. Горубляне, ул. Самоковско шосе 1" };
const web = (core: Core, extra: Record<string, unknown> = {}) =>
  core.orders.create({ cart: { mode: "delivery", lines: [{ key: dish.id, id: dish.id, q: 2, mods: [], extra: 0 }] }, addr: ADDR.d2, name: "Иван Петров", phone: PHONE, email: "ivan@primer.bg", pay: "cash", note: "Звънецът не работи", ...extra } as never);
/** through the existing status rules: the kitchen's two steps */
async function ready(core: Core, s: Record<string, StaffCtx>, extra: Record<string, unknown> = {}): Promise<Order> {
  const o = await web(core, extra);
  await core.orders.setStatus(o.no, "cooking", "kitchen", s.kitchen);
  return core.orders.setStatus(o.no, "ready", "kitchen", s.kitchen);
}
const begin = (core: Core, who: StaffCtx, car = "a1", km: number | string = 48250, float: number | string | null = "20,00") => core.driver.start(who, { car, km, float });
const code = (c: string, status?: number) => expect.objectContaining({ code: c, ...(status ? { status } : {}) });

describe("the shift: the car, the km, the change", () => {
  it("after the sign-in: the two generic cars marked as missing; the start checks the car, the km and the change", async () => {
    const { core } = mk(), s = await people(core);
    const st = await core.driver.state(s.driver);
    expect(st.shift).toBeNull();
    expect(st.cars.map((c) => [c.n, c.plate, c.missing, c.lastKm])).toEqual([["Автомобил 1", null, "[ЛИПСВА: коли: марка, рег. №]", null], ["Автомобил 2", null, "[ЛИПСВА: коли: марка, рег. №]", null]]);
    expect(st.missing.float).toBe("[ЛИПСВА: колко ресто се дава]");
    await expect(core.driver.take(s.driver, ["1042"])).rejects.toEqual(code("no_shift", 409));
    await expect(core.driver.start(s.driver, { car: "nope", km: "", float: "abc" })).rejects.toMatchObject({ code: "invalid", status: 422, message: "Провери полетата.", fields: { car: "Избери кола.", km: "Въведи километража от таблото.", float: "Въведи сума в евро, например 20,00." } });
    const a = await begin(core, s.driver, "a1", "48 250");
    expect(a.shift).toMatchObject({ user: "driver", name: "Шофьор 1", kmStart: 48250, float: 20, nav: "google", parked: "", sinceAt: "19:42", car: { id: "a1", n: "Автомобил 1" } });
    await expect(begin(core, s.driver)).rejects.toEqual(code("shift_open", 409));
    /* the same car is not in two shifts; the change may stay empty */
    await expect(begin(core, s.driver2, "a1", 48300)).rejects.toMatchObject({ fields: { car: "Тази кола е в смяната на Шофьор 1." } });
    expect((await begin(core, s.driver2, "a2", 31540, null)).shift).toMatchObject({ float: null, car: { id: "a2" } });
    /* the navigation app and "Аз съм пътник" are remembered for the shift */
    const p = await core.driver.prefs(s.driver, { nav: "waze", parked: "passenger" });
    expect(p.shift).toMatchObject({ nav: "waze", navLabel: "Waze", parked: "passenger" });
    expect((await core.driver.state(s.driver)).shift).toMatchObject({ nav: "waze", parked: "passenger" });
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["driver.shift_start", "driver.prefs"]));
  });
  it("the km is checked against the last recorded km of that car; the most used car comes first", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver, "a2", 31540);
    await core.driver.end(s.driver, { km: 31600, handed: true });
    const st = await core.driver.state(s.driver);
    expect(st.shift).toBeNull();
    expect(st.cars[0]).toMatchObject({ id: "a2", mostUsed: true, lastKm: 31600 });
    await expect(begin(core, s.driver, "a2", 31599)).rejects.toMatchObject({ fields: { km: "По-малко е от последно записания (31 600 км). Провери таблото." } });
    expect((await begin(core, s.driver, "a2", 31600)).shift!.kmStart).toBe(31600);
  });
  it("a car change in the shift: the end of leg 1 and the start of leg 2, the km per car and in total", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver, "a1", 48250);
    await begin(core, s.driver2, "a2", 100);
    await expect(core.driver.changeCar(s.driver, { car: "a1", kmEnd: 48300, kmStart: 1 })).rejects.toMatchObject({ fields: { car: "Вече караш тази кола." } });
    await expect(core.driver.changeCar(s.driver, { car: "a2", kmEnd: 48300, kmStart: 200 })).rejects.toMatchObject({ fields: { car: "Тази кола е в смяната на Шофьор 2." } });
    await core.driver.end(s.driver2, { km: 31540, handed: true });
    await expect(core.driver.changeCar(s.driver, { car: "a2", kmEnd: 48249, kmStart: 31540 })).rejects.toMatchObject({ fields: { kmEnd: "Крайният км трябва да е поне 48 250." } });
    await expect(core.driver.changeCar(s.driver, { car: "a2", kmEnd: 48290, kmStart: 31539 })).rejects.toMatchObject({ fields: { kmStart: expect.stringContaining("По-малко е от последно записания за Автомобил 2 (31 540 км)") } });
    await expect(core.driver.changeCar(s.driver, { car: "a2", kmEnd: 48290, kmStart: 40000 })).rejects.toMatchObject({ fields: { kmStart: "Над 2 000 км повече от последния запис. Провери числото." } });
    const st = await core.driver.changeCar(s.driver, { car: "a2", kmEnd: 48290, kmStart: 31545 });
    expect(st.shift).toMatchObject({ car: { id: "a2" }, kmStart: 31545, legs: [{ car: "a1", n: "Автомобил 1", kmStart: 48250, kmEnd: 48290, km: 40 }] });
    const sum = await core.driver.shift(s.driver);
    expect(sum.km).toEqual({ legs: [{ car: "a1", n: "Автомобил 1", kmStart: 48250, kmEnd: 48290, km: 40 }, { car: "a2", n: "Автомобил 2", kmStart: 31545, kmEnd: null, km: null }], total: null });
    const end = await core.driver.end(s.driver, { km: 31575, handed: true });
    expect(end.km.total).toBe(70);
    expect(end.km.legs.map((l) => l.km)).toEqual([40, 30]);
    expect((await core.audit.list()).find((x) => x.action === "driver.car")!.data).toEqual({ from: "a1", kmEnd: 48290, to: "a2", kmStart: 31545 });
  });
  it("the cars are a setting the bosses change; a car in a shift is not removed", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    await expect(core.driver.saveCars(s.driver, [{ n: "Моята" }])).rejects.toEqual(code("forbidden", 403));
    await expect(core.driver.saveCars(s.manager, [{ id: "a2", n: "Автомобил 2" }])).rejects.toMatchObject({ fields: { cars: "Автомобил 1 е в смяна в момента и не може да се махне." } });
    const cars = await core.driver.saveCars(s.manager, [{ id: "a1", n: "Автомобил 1", plate: "cb 1234 ab" }, { id: "a2", n: "Автомобил 2" }]);
    expect(cars.find((c) => c.id === "a1")).toMatchObject({ plate: "CB 1234 AB", missing: null, lastKm: 48250 });
    expect(cars.find((c) => c.id === "a2")!.missing).toBe(DRIVER_MISSING.cars);
  });
});

describe("the delivery flow", () => {
  it("a web order: ready -> Взех -> Тръгвам -> Пристигнах -> Доставена · взех X €", async () => {
    const { core, events, pushed } = mk(), s = await people(core);
    await begin(core, s.driver);
    const w = await web(core);
    expect((await core.driver.list(s.driver)).waiting).toEqual([]); /* not ready yet */
    await core.push.subscribe(w.no + "-" + w.key, { endpoint: "https://push.example.com/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } });
    await core.orders.setStatus(w.no, "cooking", "kitchen", s.kitchen);
    await core.orders.setStatus(w.no, "ready", "kitchen", s.kitchen);
    const l0 = await core.driver.list(s.driver);
    expect(l0.waiting).toHaveLength(1);
    expect(l0.waiting[0]).toMatchObject({ no: w.no, st: "wait", stLabel: "В ресторанта", mine: false, zone: "Дружба 2", addr: w.addr, name: "Иван Петров", note: "Звънецът не работи", pay: "cash", payLabel: "В брой", total: w.total, cashDue: w.total, feeKnown: true, dueAt: "20:07", late: 0, outzone: false, ask: null });
    expect(l0.waiting[0].lines).toEqual([{ id: dish.id, name: dish.n, q: 2, mods: [], unit: dish.p, sum: Math.round(dish.p * 200) / 100 }]);
    expect(l0).toMatchObject({ active: [], done: [], next: null, sum: { active: 0, cash: 0, done: 0 } });

    events.length = 0;
    const tk = await core.driver.take(s.driver, [w.no]);
    expect(tk.deliveries[0]).toMatchObject({ st: "picked", stLabel: "Взета", mine: true, driver: "driver", n: 1, locked: false });
    expect(tk.undo.until).toBe(T0 + 10_000);
    let o = (await core.orders.get(w.no))!;
    expect(o).toMatchObject({ driver: "driver", status: "ready", pickedAt: new Date(T0).toISOString() });
    expect(o.course).toMatch(/^[0-9a-f]{12}$/);
    expect(events.map((e) => e[0])).toEqual(["driver.course"]);
    expect(events[0][1]).toMatchObject({ driver: "driver", kind: "take", orders: [w.no] });
    expect(events[0][2]).toEqual({}); /* the staff only */
    expect((await core.driver.list(s.driver))).toMatchObject({ waiting: [], next: w.no, sum: { active: 1, cash: w.total } });
    /* "Доставена" before "Тръгвам" is refused; "Пристигнах" too */
    await expect(core.driver.deliver(s.driver, w.no)).rejects.toMatchObject({ code: "bad_state", message: "Първо натисни „Тръгвам“ за № " + w.no + "." });
    await expect(core.driver.arrive(s.driver, w.no)).rejects.toEqual(code("bad_state", 409));

    events.length = 0; pushed.length = 0;
    const g = await core.driver.go(s.driver);
    expect(g.deliveries[0]).toMatchObject({ st: "road", stLabel: "На път", locked: true });
    expect(g.skipped).toEqual([]);
    o = (await core.orders.get(w.no))!;
    expect(o.status).toBe("on_way");
    expect(events.find((e) => e[0] === "order.status")).toEqual(["order.status", { no: w.no, status: "on_way", at: o.times!.on_way }, { order: w.no }]);
    expect(pushed.map((p) => p.body)).toEqual(["Шофьорът е на път към вас."]);
    expect((await core.driver.state(s.driver)).shift!.driving).toBe(w.no);

    events.length = 0;
    const ar = await core.driver.arrive(s.driver, w.no);
    expect(ar.notified).toEqual({ page: true, push: 1, sms: null, smsMissing: "[ЛИПСВА: доставчик за SMS]" });
    o = (await core.orders.get(w.no))!;
    expect(o.arrivedAt).toBe(new Date(T0).toISOString());
    expect(events.find((e) => e[0] === "order.status")).toEqual(["order.status", { no: w.no, status: "on_way", at: o.arrivedAt, arrivedAt: o.arrivedAt }, { order: w.no }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(pushed[1]).toMatchObject({ title: "Поръчка № " + w.no + " · Siracusa", body: "Шофьорът е пред входа.", url: "/porachka/" + w.no + "-" + w.key + "/" });
    /* the customer's page: the time, nothing about the driver */
    const pub = publicOrder(o);
    expect(pub.arrivedAt).toBe(o.arrivedAt);
    expect(JSON.stringify(pub)).not.toMatch(/"driver"|Шофьор 1|pickedAt|collected/);
    for (const k of ["driver", "course", "pickedAt", "problem", "staffNotes", "name", "phone", "addr"]) expect(pub).not.toHaveProperty(k);

    events.length = 0;
    const dl = await core.driver.deliver(s.driver, w.no);
    expect(dl.deliveries[0]).toMatchObject({ st: "done", stLabel: "Доставена", collected: { pay: "cash", payLabel: "В брой", sum: w.total, feeMissing: false } });
    o = (await core.orders.get(w.no))!;
    expect(o).toMatchObject({ status: "delivered", collected: { pay: "cash", sum: w.total, by: "driver" } });
    expect(publicOrder(o).arrivedAt).toBeUndefined();
    expect(events.map((e) => e[0])).toEqual(["order.status", "driver.course"]);
    const l1 = await core.driver.list(s.driver);
    expect(l1).toMatchObject({ waiting: [], active: [], next: null, sum: { active: 0, cash: 0, done: 1 } });
    expect(l1.done.map((d) => d.no)).toEqual([w.no]);
    expect((await core.driver.shift(s.driver))).toMatchObject({ delivered: 1, cash: { rows: [{ no: w.no, zone: "Дружба 2", sum: w.total }], sum: w.total }, float: 20, handover: Math.round((w.total + 20) * 100) / 100, owe: false });
    /* every action is in the log, the status steps through the existing rules with the driver as the actor */
    const log = (await core.audit.list()).filter((x) => x.target === w.no).map((x) => [x.actor, x.action]).reverse();
    expect(log).toEqual([["kitchen", "order.status"], ["kitchen", "order.status"], ["driver", "driver.take"], ["driver", "order.status"], ["driver", "driver.arrive"], ["driver", "order.status"], ["driver", "driver.deliver"]]);
  });
  it("card and voucher are recorded as such; the cash sum may be the one really taken; a paid zone without a fee is marked", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s, { pay: "card" }), b = await ready(core, s, { pay: "voucher" }), c = await ready(core, s, { addr: ADDR.gor });
    expect(c.fee).toBeNull();
    await core.driver.take(s.driver, [a.no, b.no, c.no]);
    await core.driver.go(s.driver);
    await core.driver.deliver(s.driver, a.no);
    await core.driver.deliver(s.driver, b.no, { sum: 1 }); /* a sum means nothing for a voucher */
    await expect(core.driver.deliver(s.driver, c.no, { sum: "abc" })).rejects.toMatchObject({ code: "invalid", fields: { sum: "Въведи сумата, която взе, например 24,50." } });
    const d = await core.driver.deliver(s.driver, c.no, { sum: "25,00" });
    expect(d.deliveries[0].collected).toMatchObject({ pay: "cash", sum: 25, feeMissing: true });
    const sum = await core.driver.shift(s.driver);
    expect(sum).toMatchObject({ delivered: 3, cards: { n: 1, sum: a.total }, vouchers: { n: 1, sum: b.total }, cash: { sum: 25, feeMissing: true, rows: [{ no: c.no, sum: 25, feeMissing: true }] }, handover: 45 });
  });
  it("two drivers cannot take the same order; several are taken at once; all or none", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver); await begin(core, s.driver2, "a2", 100);
    const a = await ready(core, s), b = await ready(core, s), c = await ready(core, s);
    const r = await Promise.allSettled([core.driver.take(s.driver, [a.no]), core.driver.take(s.driver2, [a.no])]);
    expect(r.map((x) => x.status).sort()).toEqual(["fulfilled", "rejected"]);
    const lost = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "taken", status: 409, message: "№ " + a.no + " вече е взета от друг шофьор.", fields: { [a.no]: "№ " + a.no + " вече е взета от друг шофьор." } });
    expect((await core.orders.get(a.no))!.driver).toBe("driver");
    /* one taken order in the list: nothing is taken */
    await expect(core.driver.take(s.driver2, [b.no, a.no, c.no])).rejects.toEqual(code("taken", 409));
    expect((await core.orders.get(b.no))!.driver).toBeUndefined();
    const two = await core.driver.take(s.driver2, [b.no, c.no]);
    expect(two.deliveries.map((d) => [d.no, d.st, d.driver])).toEqual([[b.no, "picked", "driver2"], [c.no, "picked", "driver2"]]);
    expect(new Set([(await core.orders.get(b.no))!.course, (await core.orders.get(c.no))!.course]).size).toBe(1);
    /* an order that is not ready, a number that is not a delivery */
    const w = await web(core), p = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: dish.id, id: dish.id, q: 1, mods: [], extra: 0 }] }, name: "Иван", phone: PHONE } as never);
    await expect(core.driver.take(s.driver, [w.no])).rejects.toMatchObject({ code: "not_ready", message: "№ " + w.no + " още не е готова." });
    await expect(core.driver.take(s.driver, [p.no])).rejects.toEqual(code("not_found", 404));
    await expect(core.driver.take(s.driver, [])).rejects.toEqual(code("nothing", 422));
  });
  it("a driver never sees another driver's delivery, and never a customer's phone or e-mail", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver); await begin(core, s.driver2, "a2", 100);
    const a = await ready(core, s), b = await ready(core, s);
    await core.driver.take(s.driver, [a.no]);
    await core.driver.take(s.driver2, [b.no]);
    await core.driver.go(s.driver); await core.driver.go(s.driver2);
    const l = await core.driver.list(s.driver);
    expect([...l.waiting, ...l.active, ...l.done].map((d) => d.no)).toEqual([a.no]);
    await expect(core.driver.get(s.driver, b.no)).rejects.toMatchObject({ code: "not_found", status: 404, message: "Няма такава доставка." });
    await expect(core.driver.arrive(s.driver, b.no)).rejects.toEqual(code("not_found", 404));
    await expect(core.driver.deliver(s.driver, b.no)).rejects.toEqual(code("not_found", 404));
    await expect(core.driver.problem(s.driver, b.no, "nobody")).rejects.toEqual(code("not_found", 404));
    await expect(core.driver.go(s.driver, [b.no])).rejects.toEqual(code("not_found", 404));
    expect((await core.driver.search(s.driver, b.no))).toMatchObject({ act: [], done: [] });
    expect((await core.driver.route(s.driver)).stops.map((d) => d.no)).toEqual([a.no]);
    await expect(core.driver.list(s.driver, { all: true })).rejects.toEqual(code("forbidden", 403));
    /* everything a driver's screen gets */
    const seen = JSON.stringify([l, await core.driver.get(s.driver, a.no), await core.driver.search(s.driver, "дружба"), await core.driver.route(s.driver), await core.driver.shift(s.driver), await core.driver.state(s.driver),
      await core.driver.deliver(s.driver, a.no), await core.driver.list(s.driver)]);
    expect(seen).toContain("Иван Петров");
    expect(seen).not.toMatch(/0888|ivan@primer\.bg|"phone"|"email"/);
    expect(seen).not.toContain(a.key!); /* nor the customer's tracking key */
    /* the bosses see all (and no phone either) */
    const all = await core.driver.list(s.manager, { all: true });
    expect(all.active.map((d) => [d.no, d.driverName, d.mine])).toEqual([[b.no, "Шофьор 2", false]]);
    expect(all.done.map((d) => d.no)).toEqual([a.no]);
    expect((await core.driver.get(s.owner, b.no)).driver).toBe("driver2");
    expect(JSON.stringify(all)).not.toMatch(/0888|"phone"/);
  });
  it("Тръгвам from the list starts all taken ones, from one delivery only that one; nothing changes silently", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s), c = await ready(core, s);
    await core.driver.take(s.driver, [a.no, b.no, c.no]);
    const one = await core.driver.go(s.driver, [b.no]);
    expect(one.deliveries.map((d) => [d.no, d.st])).toEqual([[b.no, "road"]]);
    expect((await core.orders.list()).filter((o) => o.status === "on_way").map((o) => o.no)).toEqual([b.no]);
    const rest = await core.driver.go(s.driver);
    expect(rest.deliveries.map((d) => d.no).sort()).toEqual([a.no, c.no]);
    expect((await core.orders.list()).every((o) => o.status === "on_way")).toBe(true); /* several on the way at once */
    await expect(core.driver.go(s.driver)).rejects.toMatchObject({ code: "nothing", message: "Няма взети поръчки за тръгване." });
    /* delivering one leaves the others as they are */
    await core.driver.deliver(s.driver, b.no);
    expect((await core.orders.list()).map((o) => [o.no, o.status]).sort()).toEqual([[a.no, "on_way"], [b.no, "delivered"], [c.no, "on_way"]]);
  });
});

describe("one writer per order", () => {
  it("the driver writes an order only under serial(repo, 'order:<№>'), as the kitchen does", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s), seq: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    const other = serial(core.ctx.repo, "order:" + b.no, async () => { seq.push("kitchen in"); await held; seq.push("kitchen out"); });
    const mine = core.driver.take(s.driver, [b.no, a.no]).then(() => { seq.push("driver took"); });
    await new Promise((r) => setTimeout(r, 20));
    expect(seq).toEqual(["kitchen in"]);
    expect((await core.orders.get(a.no))!.driver).toBeUndefined(); /* all or none: nothing is written while one is held */
    release();
    await Promise.all([other, mine]);
    expect(seq).toEqual(["kitchen in", "kitchen out", "driver took"]);
    /* every later step takes the same lock and lets it go */
    await core.driver.go(s.driver);
    await core.driver.arrive(s.driver, a.no);
    const d = await core.driver.deliver(s.driver, a.no);
    await core.driver.undo(s.driver, d.undo.id);
    await core.driver.problem(s.driver, b.no, "nobody");
    await core.driver.returned(s.driver, b.no);
    await expect(serial(core.ctx.repo, "order:" + a.no, async () => "free")).resolves.toBe("free");
  });
});

describe("Отмени: one step back inside the window, while nobody else acted", () => {
  it("every step goes back; the customer's page hears it", async () => {
    const { core, events } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s);
    const tk = await core.driver.take(s.driver, [a.no]);
    expect((await core.driver.state(s.driver)).shift!.undo).toMatchObject({ id: tk.undo.id, kind: "take", orders: [a.no] });
    const back = await core.driver.undo(s.driver, tk.undo.id);
    expect(back.deliveries.map((d) => [d.no, d.st])).toEqual([[a.no, "wait"]]);
    let o = (await core.orders.get(a.no))!;
    expect([o.driver, o.course, o.pickedAt, o.status]).toEqual([undefined, undefined, undefined, "ready"]);
    await expect(core.driver.undo(s.driver, tk.undo.id)).rejects.toMatchObject({ code: "undo_gone", message: "Вече не може да се отмени." });

    await core.driver.take(s.driver, [a.no]);
    const g = await core.driver.go(s.driver);
    events.length = 0;
    await core.driver.undo(s.driver, g.undo.id);
    o = (await core.orders.get(a.no))!;
    expect(o.status).toBe("ready");
    expect(o.times!.on_way).toBeUndefined();
    expect(o.driver).toBe("driver");
    expect(events.find((e) => e[0] === "order.status")).toMatchObject(["order.status", { no: a.no, status: "ready", arrivedAt: null }, { order: a.no }]);
    expect((await core.driver.state(s.driver)).shift!.driving).toBeNull();

    await core.driver.go(s.driver);
    const ar = await core.driver.arrive(s.driver, a.no);
    events.length = 0;
    await core.driver.undo(s.driver, ar.undo.id);
    o = (await core.orders.get(a.no))!;
    expect([o.status, o.arrivedAt]).toEqual(["on_way", undefined]);
    expect(events.find((e) => e[0] === "order.status")![1]).toMatchObject({ status: "on_way", arrivedAt: null });

    const dl = await core.driver.deliver(s.driver, a.no);
    await core.driver.undo(s.driver, dl.undo.id);
    o = (await core.orders.get(a.no))!;
    expect([o.status, o.collected, o.times!.delivered]).toEqual(["on_way", undefined, undefined]);
    expect((await core.driver.shift(s.driver))).toMatchObject({ delivered: 0, cash: { sum: 0 } });
    expect((await core.audit.list()).filter((x) => x.action === "driver.undo").map((x) => (x.data as { step: string }).step).reverse()).toEqual(["take", "go", "arrive", "deliver"]);
  });
  it("not after the window, not an older step, not after somebody else acted", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s);
    const t1 = await core.driver.take(s.driver, [a.no]);
    const t2 = await core.driver.take(s.driver, [b.no]);
    await expect(core.driver.undo(s.driver, t1.undo.id)).rejects.toEqual(code("undo_gone", 409));
    t.now += 15_001;
    await expect(core.driver.undo(s.driver, t2.undo.id)).rejects.toMatchObject({ code: "undo_late", message: "Времето за „Отмени“ изтече." });
    const g = await core.driver.go(s.driver, [a.no]);
    await core.ordersAdmin.cancel(s.manager, a.no, "Клиентът се отказа");
    await expect(core.driver.undo(s.driver, g.undo.id)).rejects.toMatchObject({ code: "undo_changed", message: "Някой друг вече промени № " + a.no + ". Не може да се отмени." });
    /* the cancelled order: shown as such, with the reason; it does not block the end of the shift */
    const l = await core.driver.list(s.driver);
    expect(l.done.find((d) => d.no === a.no)).toMatchObject({ st: "cancelled", stLabel: "Отказана", reason: "Клиентът се отказа" });
    expect(l.active.map((d) => d.no)).toEqual([b.no]);
  });
});

describe("a problem and its two endings", () => {
  it("only for a taken order or one on the way; the restaurant hears it; Върнах я / Доставих все пак", async () => {
    const { core, events } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s), c = await ready(core, s);
    await expect(core.driver.problem(s.driver, a.no, "nobody")).rejects.toEqual(code("not_found", 404)); /* not his yet */
    await core.driver.take(s.driver, [a.no, b.no]);
    await expect(core.driver.problem(s.driver, a.no, "lost" as never)).rejects.toMatchObject({ code: "invalid", fields: { kind: expect.stringContaining("Няма никой") } });
    await core.driver.go(s.driver, [a.no]);
    events.length = 0;
    const p = await core.driver.problem(s.driver, a.no, "nobody", "  Никой не   отваря ");
    expect(p.deliveries[0]).toMatchObject({ st: "prob", stLabel: "Проблем", problem: { kind: "nobody", label: "Няма никой", note: "Никой не отваря", solved: "" } });
    expect((await core.orders.get(a.no))!).toMatchObject({ status: "on_way", problem: { kind: "nobody", note: "Никой не отваря", solved: "" } });
    expect(events.find((e) => e[0] === "driver.course")![1]).toMatchObject({ driver: "driver", kind: "problem", orders: [a.no], problem: "nobody" });
    expect(events.find((e) => e[0] === "order.status")).toMatchObject(["order.status", { no: a.no, hold: true }, { order: a.no }]);
    /* the customer's page: a neutral state, never which problem */
    const pub = publicOrder((await core.orders.get(a.no))!);
    expect(pub.hold).toBe(true);
    expect(JSON.stringify(pub)).not.toMatch(/nobody|Никой|problem/);
    /* the manager sees it; what happens with the food is not decided yet */
    const m = await core.driver.drivers(s.manager);
    expect(m.problems).toEqual([expect.objectContaining({ no: a.no, driver: "driver", driverName: "Шофьор 1", kind: "nobody", label: "Няма никой", note: "Никой не отваря", solved: "", missing: "[ЛИПСВА: колко чака шофьорът и какво става с храната]" })]);
    expect(m.drivers[0]).toMatchObject({ status: "road", problems: 1 });
    await expect(core.driver.problem(s.driver, a.no, "refused")).rejects.toEqual(code("has_problem", 409));
    await expect(core.driver.end(s.driver, { km: 48300, handed: true })).rejects.toMatchObject({ code: "unfinished", fields: { [a.no]: "Проблем: Няма никой", [b.no]: "Взета" } });
    /* ending 1: back in the restaurant; the status stays for the restaurant's decision */
    const r = await core.driver.returned(s.driver, a.no);
    expect(r.deliveries[0]).toMatchObject({ st: "prob", problem: { solved: "returned", solvedAt: expect.any(String) } });
    expect((await core.orders.get(a.no))!.status).toBe("on_way");
    await expect(core.driver.returned(s.driver, a.no)).rejects.toEqual(code("no_problem", 409));
    await expect(core.driver.deliver(s.driver, a.no)).rejects.toEqual(code("bad_state", 409));
    let l = await core.driver.list(s.driver);
    expect(l.active.map((d) => d.no)).toEqual([b.no]);
    expect(l.done.map((d) => d.no)).toEqual([a.no]);
    /* ending 2: delivered after all (also for a taken one that never left) */
    await core.driver.problem(s.driver, b.no, "refused");
    const d = await core.driver.deliver(s.driver, b.no);
    expect(d.deliveries[0]).toMatchObject({ st: "done", problem: { kind: "refused", solved: "delivered" }, collected: { pay: "cash", sum: b.total } });
    expect((await core.orders.get(b.no))!.status).toBe("delivered");
    expect(publicOrder((await core.orders.get(b.no))!).hold).toBeUndefined();
    l = await core.driver.list(s.driver);
    expect(l.active).toEqual([]);
    expect((await core.driver.shift(s.driver))).toMatchObject({ delivered: 1, problems: 1, unfinished: [] });
    /* a problem can be taken back like every step */
    await core.driver.take(s.driver, [c.no]);
    const pc = await core.driver.problem(s.driver, c.no, "address", "няма такъв вход");
    await core.driver.undo(s.driver, pc.undo.id);
    expect((await core.orders.get(c.no))!.problem).toBeUndefined();
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["driver.problem", "driver.problem_end"]));
  });
});

describe("an address outside the zones: the question to the manager", () => {
  it("the three answers; Взех needs „Да я достави“; the driver hears the answer at once", async () => {
    const { core, events } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s), c = await ready(core, s);
    events.length = 0;
    const q = await core.driver.ask(s.driver, a.no, "адресът е зад околовръстното");
    expect(q).toMatchObject({ type: "outzone", order: a.no, driver: "driver", driverName: "Шофьор 1", status: "open", answer: null, mine: true, zone: "Дружба 2", note: "адресът е зад околовръстното" });
    expect(events).toEqual([["driver.ask", { id: q.id, type: "outzone", order: a.no, driver: "driver", status: "open", answer: null }, {}]]);
    expect((await core.driver.ask(s.driver, a.no)).id).toBe(q.id); /* one open question per order */
    /* the manager's list; nobody else answers */
    expect((await core.driver.asks(s.manager)).map((x) => [x.id, x.status, x.waitMin])).toEqual([[q.id, "open", 0]]);
    expect((await core.driver.drivers(s.manager)).asks.map((x) => x.id)).toEqual([q.id]);
    for (const who of ["driver", "waiter", "kitchen", "marketing"]) await expect(core.driver.answer(s[who], q.id, "deliver")).rejects.toEqual(code("forbidden", 403));
    await expect(core.driver.asks(s.driver)).rejects.toEqual(code("forbidden", 403));
    await expect(core.driver.take(s.driver, [a.no])).rejects.toMatchObject({ code: "ask_required", status: 409, message: "№ " + a.no + ": чакаш отговор от управителя за адреса." });
    expect((await core.driver.get(s.driver, a.no)).ask).toMatchObject({ id: q.id, status: "open" });
    await expect(core.driver.answer(s.manager, q.id, "maybe" as never)).rejects.toMatchObject({ code: "invalid", fields: { answer: "Избери един от трите отговора." } });
    events.length = 0;
    const ans = await core.driver.answer(s.manager, q.id, "deliver");
    expect(ans).toMatchObject({ status: "answered", answer: "deliver", answerLabel: "Да я достави", answeredBy: "manager", undoUntil: T0 + 10_000 });
    expect(events).toEqual([["driver.ask", { id: q.id, type: "outzone", order: a.no, driver: "driver", status: "answered", answer: "deliver" }, {}]]);
    await expect(core.driver.answer(s.owner, q.id, "return")).rejects.toMatchObject({ code: "answered", status: 409 });
    expect((await core.orders.get(a.no))!.staffNotes).toEqual([{ at: new Date(T0).toISOString(), by: "manager", text: "Адрес извън зоните: Да я достави." }]);
    expect((await core.audit.list()).find((x) => x.action === "driver.answer")).toMatchObject({ actor: "manager", target: a.no, data: { ask: q.id, answer: "deliver", driver: "driver" } });
    expect((await core.driver.take(s.driver, [a.no])).deliveries[0]).toMatchObject({ st: "picked", ask: { answer: "deliver" } });
    /* "Върни я в ресторанта" and "Предложи вземане от място": not taken */
    const qb = await core.driver.ask(s.driver, b.no), qc = await core.driver.ask(s.driver, c.no);
    await core.driver.answer(s.owner, qb.id, "return");
    await core.driver.answer(s.admin, qc.id, "pickup");
    await expect(core.driver.take(s.driver, [b.no])).rejects.toMatchObject({ code: "ask_required", message: "№ " + b.no + ": управителят каза да остане в ресторанта." });
    await expect(core.driver.take(s.driver, [c.no])).rejects.toMatchObject({ code: "ask_required", message: "№ " + c.no + ": управителят предлага вземане от място. Не я карай." });
    expect((await core.driver.list(s.driver)).waiting.map((d) => [d.no, d.ask!.answerLabel])).toEqual([[b.no, "Върни я в ресторанта"], [c.no, "Предложи вземане от място"]]);
    expect((await core.driver.asks(s.manager))).toEqual([]);
    expect((await core.driver.asks(s.manager, { all: true })).map((x) => x.answer)).toEqual(["deliver", "return", "pickup"]);
  });
  it("asked after Взех: the order waits for the answer; „Върни я“ ends with Върнах я; the manager's Отмени", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s);
    await core.driver.take(s.driver, [a.no, b.no]);
    const q = await core.driver.ask(s.driver, a.no);
    /* "Тръгвам" from the list starts the other one and says why this one stays */
    const g = await core.driver.go(s.driver);
    expect(g.deliveries.map((d) => d.no)).toEqual([b.no]);
    expect(g.skipped).toEqual([{ no: a.no, why: "№ " + a.no + ": чакаш отговор от управителя за адреса." }]);
    await expect(core.driver.go(s.driver, [a.no])).rejects.toEqual(code("ask_required", 409));
    await expect(core.driver.returned(s.driver, a.no)).rejects.toEqual(code("no_problem", 409));
    const ans = await core.driver.answer(s.manager, q.id, "return");
    /* the manager takes the answer back, then answers again */
    expect((await core.driver.answerUndo(s.manager, ans.id))).toMatchObject({ status: "open", answer: null });
    expect((await core.orders.get(a.no))!.staffNotes).toEqual([]);
    await core.driver.answer(s.manager, q.id, "return");
    t.now += 15_001;
    await expect(core.driver.answerUndo(s.manager, q.id)).rejects.toEqual(code("undo_late", 409));
    const r = await core.driver.returned(s.driver, a.no);
    expect(r.deliveries[0]).toMatchObject({ st: "prob", problem: { kind: "address", solved: "returned", note: "Адрес извън зоните: Върни я в ресторанта" } });
    expect((await core.driver.list(s.driver)).active.map((d) => d.no)).toEqual([b.no]);
  });
  it("an order whose quarter is not a zone we deliver to cannot be taken without the manager", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s);
    const raw = (await core.ctx.repo.get<Order>("orders", a.no))!;
    await core.ctx.repo.put("orders", { ...raw, zone: "Младост 1", addr: "ж.к. Младост 1, бл. 20" });
    const d = await core.driver.get(s.driver, a.no);
    expect(d).toMatchObject({ outzone: true, eta: null });
    await expect(core.driver.take(s.driver, [a.no])).rejects.toMatchObject({ code: "ask_required", message: "№ " + a.no + " е с адрес извън зоните. Питай управителя, преди да я вземеш." });
    const q = await core.driver.ask(s.driver, a.no);
    await core.driver.answer(s.manager, q.id, "deliver");
    expect((await core.driver.take(s.driver, [a.no])).deliveries[0].st).toBe("picked");
  });
});

describe("the route", () => {
  it("Път А by the promised time, Път Б the near quarters first, Моят ред; the delivery he drives to stays first; no invented km", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s, { addr: ADDR.d1 });  /* Дружба 1: 30 min, promised T0 + 30 */
    t.now += MINUTE;
    const b = await ready(core, s, { addr: ADDR.bus }); /* Бусманци: 40 min, promised T0 + 41 */
    t.now += 9 * MINUTE;
    const c = await ready(core, s, { addr: ADDR.d2 });  /* Дружба 2: 25 min, promised T0 + 35 */
    /* a new course: the ready ones before "Взех", in the proposed order, without moves (review 1 of the driver) */
    const pre = await core.driver.route(s.driver);
    expect(pre).toMatchObject({ preview: true, locked: null, pick: "A" });
    expect(pre.stops.map((d) => [d.no, d.n, d.eta])).toEqual([[a.no, 0, null], [c.no, 0, null], [b.no, 0, null]]);
    await expect(core.driver.routeMove(s.driver, c.no, "up")).rejects.toEqual(code("not_found", 404));
    await core.driver.take(s.driver, [a.no, b.no, c.no]);
    let r = await core.driver.route(s.driver);
    expect(r.pick).toBe("A");
    expect(r.options.map((o) => [o.key, o.title, o.order])).toEqual([["A", "Път А · по срока", [a.no, c.no, b.no]], ["B", "Път Б · по-кратък", [c.no, a.no, b.no]]]);
    expect(r.options[1].zones).toEqual(["Дружба 2", "Дружба 1", "Бусманци"]);
    for (const o of r.options) expect([o.km, o.minutes, o.fuel, o.note]).toEqual([null, null, null, "[ЛИПСВА: маршрути от OSRM]"]);
    expect(r).toMatchObject({ same: false, locked: null, note: "[ЛИПСВА: маршрути от OSRM]" });
    expect(JSON.stringify(r)).not.toMatch(/"km":\s*\d|"minutes":\s*\d/);
    /* the estimated arrival: the zone's minutes + 2 min per previous address, from now while he has not left */
    const now = t.now;
    expect(r.stops.map((d) => [d.no, d.n, d.eta])).toEqual([[a.no, 1, now + 30 * MINUTE], [c.no, 2, now + 27 * MINUTE], [b.no, 3, now + 44 * MINUTE]]);
    expect(r.stops.map((d) => [d.dueAt, d.etaAt, d.etaLate])).toEqual([["20:12", "20:22", 10], ["20:17", "20:19", 2], ["20:23", "20:36", 13]]);

    r = await core.driver.routePick(s.driver, "B");
    expect(r.pick).toBe("B");
    expect(r.stops.map((d) => d.no)).toEqual([c.no, a.no, b.no]);
    expect((await core.driver.list(s.driver)).active.map((d) => d.no)).toEqual([c.no, a.no, b.no]);
    await expect(core.driver.routePick(s.driver, "C" as never)).rejects.toMatchObject({ code: "invalid", fields: { pick: expect.any(String) } });
    /* "По-късно" on the first: his own order, kept in the shift */
    r = await core.driver.routeMove(s.driver, c.no, "down");
    expect(r.pick).toBe("own");
    expect(r.options.map((o) => o.key)).toEqual(["A", "B", "own"]);
    expect(r.options[2]).toMatchObject({ title: "Моят ред", order: [a.no, c.no, b.no], km: null, minutes: null, fuel: null });
    r = await core.driver.routeMove(s.driver, b.no, "up");
    expect(r.stops.map((d) => d.no)).toEqual([a.no, b.no, c.no]);
    await expect(core.driver.routeMove(s.driver, a.no, "up")).rejects.toEqual(code("edge", 409));
    await expect(core.driver.routeMove(s.driver, c.no, "down")).rejects.toEqual(code("edge", 409));
    expect((await core.driver.state(s.driver)).shift!.route).toBe("own");

    /* he leaves with one: it is locked first in every variant */
    await core.driver.go(s.driver, [c.no]);
    r = await core.driver.route(s.driver);
    expect(r.locked).toBe(c.no);
    expect(r.options.map((o) => o.order[0])).toEqual([c.no, c.no, c.no]);
    expect(r.options.map((o) => o.order)).toEqual([[c.no, a.no, b.no], [c.no, a.no, b.no], [c.no, a.no, b.no]]);
    expect(r.stops.map((d) => [d.no, d.locked])).toEqual([[c.no, true], [a.no, false], [b.no, false]]);
    await expect(core.driver.routeMove(s.driver, c.no, "down")).rejects.toMatchObject({ code: "locked", status: 409, message: "Караш към № " + c.no + " сега: остава първа." });
    await expect(core.driver.routeMove(s.driver, a.no, "up")).rejects.toEqual(code("edge", 409));
    r = await core.driver.routeMove(s.driver, b.no, "up");
    expect(r.stops.map((d) => d.no)).toEqual([c.no, b.no, a.no]);
    r = await core.driver.routePick(s.driver, "A");
    expect(r.stops.map((d) => d.no)).toEqual([c.no, a.no, b.no]);
    /* the others leave too: the lock stays; when it is delivered, the next "На път" of the chosen order is locked */
    await core.driver.go(s.driver);
    expect((await core.driver.route(s.driver)).locked).toBe(c.no);
    expect((await core.driver.list(s.driver)).next).toBe(c.no);
    await core.driver.deliver(s.driver, c.no);
    r = await core.driver.route(s.driver);
    expect([r.locked, r.stops.map((d) => d.no)]).toEqual([a.no, [a.no, b.no]]);
    /* "Пристигнах" at another address makes it the one he drives to */
    await core.driver.arrive(s.driver, b.no);
    expect((await core.driver.route(s.driver)).stops.map((d) => [d.no, d.locked])).toEqual([[b.no, true], [a.no, false]]);
    /* past the estimate there is nothing honest to say */
    t.now += 3 * 60 * MINUTE;
    const late = await core.driver.route(s.driver);
    expect(late.stops.map((d) => d.eta)).toEqual([null, null]);
    expect(late.stops[0].late).toBeGreaterThan(120);
    expect((await core.audit.list()).filter((x) => x.action === "driver.route").length).toBe(5);
  });
});

describe("fuel and the cash", () => {
  it("the checks, the price per litre, the history; paid in cash comes out of the cash to hand over", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver, "a1", 48250, "20,00");
    const page0 = await core.driver.fuel(s.driver);
    expect(page0).toMatchObject({ car: { id: "a1", n: "Автомобил 1", missing: DRIVER_MISSING.cars }, lastKm: 48250, cashOnHand: 20, entries: [], lastPerLitre: null });
    await expect(core.driver.fuelAdd(s.driver, { litres: "", sum: "", km: "" })).rejects.toMatchObject({ code: "invalid", fields: { litres: "Въведи литрите от бележката.", sum: "Въведи сумата в евро.", km: "Въведи километража от таблото." } });
    await expect(core.driver.fuelAdd(s.driver, { litres: 130, sum: 50, km: 48300 })).rejects.toMatchObject({ fields: { litres: "Провери литрите: повече от 120 л." } });
    await expect(core.driver.fuelAdd(s.driver, { litres: 30, sum: 45, km: 48249 })).rejects.toMatchObject({ fields: { km: "По-малко е от последно записания (48 250 км). Провери таблото." } });
    await expect(core.driver.fuelAdd(s.driver, { litres: 30, sum: 45, km: 48300, cash: true })).rejects.toMatchObject({ fields: { sum: "Имаш 20,00 € в брой. Останалото плати с карта или питай управителя." } });
    await expect(core.driver.fuelAdd(s.driver, { litres: 30, sum: 45, km: 48300, photo: "javascript:alert(1)" })).rejects.toMatchObject({ fields: { photo: "Снимката не се качи. Снимай бележката пак." } });
    const f1 = await core.driver.fuelAdd(s.driver, { litres: "30,5", sum: "45,75", km: "48 300", full: true, photo: "/media/" + "a".repeat(64) + ".jpg" });
    expect(f1.entry).toMatchObject({ car: "a1", carName: "Автомобил 1", litres: 30.5, sum: 45.75, perLitre: 1.5, km: 48300, full: true, cash: false, photo: "/media/" + "a".repeat(64) + ".jpg", atClock: "19:42" });
    expect(f1.lastKm).toBe(48300);
    await expect(core.driver.fuelAdd(s.driver, { litres: 10, sum: 15, km: 48299 })).rejects.toMatchObject({ fields: { km: expect.stringContaining("48 300") } });
    /* a delivered cash order, then fuel paid from the collected money */
    const a = await ready(core, s), b = await ready(core, s, { pay: "card" });
    await core.driver.take(s.driver, [a.no, b.no]); await core.driver.go(s.driver);
    await core.driver.deliver(s.driver, a.no); await core.driver.deliver(s.driver, b.no);
    t.now += MINUTE;
    const f2 = await core.driver.fuelAdd(s.driver, { litres: 10, sum: 15, km: 48400, cash: true, noPhoto: true });
    expect(f2.entries.map((e) => [e.litres, e.cash, e.noPhoto])).toEqual([[10, true, true], [30.5, false, false]]);
    const sum = await core.driver.shift(s.driver);
    /* cash from the delivered orders + the start change - fuel paid in cash */
    expect(sum).toMatchObject({ fuel: 2, cash: { sum: a.total, rows: [{ no: a.no, sum: a.total }] }, float: 20, fuelCash: 15, handover: Math.round((a.total + 20 - 15) * 100) / 100, owe: false, cards: { n: 1, sum: b.total }, vouchers: { n: 0, sum: 0 }, handTo: "[ЛИПСВА: на кого се предават парите]" });
    expect((await core.driver.fuel(s.driver)).cashOnHand).toBe(sum.handover);
    expect((await core.driver.drivers(s.manager)).drivers[0]).toMatchObject({ cash: sum.handover, cashTo: "[ЛИПСВА: на кого се предават парите]" });
    expect((await core.audit.list()).filter((x) => x.action === "fuel.add")).toHaveLength(2);
    /* the end needs a km that is not below the last fuel entry */
    await expect(core.driver.end(s.driver, { km: 48399, handed: true })).rejects.toMatchObject({ fields: { km: expect.stringContaining("48 400") } });
  });
  it("the fuel report: per day, driver and car, l/100 km between two full tanks; only the owner or „Финанси и гориво“", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver, "a1", 48000);
    await core.driver.fuelAdd(s.driver, { litres: 40, sum: 60, km: 48000, full: true });
    await core.driver.fuelAdd(s.driver, { litres: 15, sum: 22.5, km: 48250 });
    await core.driver.end(s.driver, { km: 48260, handed: true });
    t.now += 24 * 60 * MINUTE;
    await begin(core, s.driver2, "a1", 48260);
    await core.driver.fuelAdd(s.driver2, { litres: 25, sum: 40, km: 48500, full: true });
    for (const who of ["manager", "driver", "waiter", "kitchen", "marketing"]) await expect(core.driver.fuelReport(s[who])).rejects.toEqual(code("forbidden", 403));
    await expect(core.driver.fuelReport(null as never)).rejects.toEqual(code("auth", 401));
    const r = await core.driver.fuelReport(s.owner);
    expect(r).toMatchObject({ from: "2026-10-19", to: "2026-11-17", total: { n: 3, litres: 80, sum: 122.5 } });
    expect(r.byDay).toEqual([{ date: "2026-11-16", n: 2, litres: 55, sum: 82.5 }, { date: "2026-11-17", n: 1, litres: 25, sum: 40 }]);
    expect(r.byDriver).toEqual([{ user: "driver", name: "Шофьор 1", n: 2, litres: 55, sum: 82.5 }, { user: "driver2", name: "Шофьор 2", n: 1, litres: 25, sum: 40 }]);
    /* 48 000 (full) -> 48 500 (full): 15 + 25 litres for 500 km */
    expect(r.byCar).toEqual([{ car: "a1", n: "Автомобил 1", entries: 3, litres: 80, sum: 122.5, km: 500, per100: 8 }]);
    expect(r.rows.map((x) => x.name)).toEqual(["Шофьор 2", "Шофьор 1", "Шофьор 1"]);
    expect((await core.driver.fuelReport(s.admin, { from: "2026-11-17", to: "2026-11-17" })).total).toEqual({ n: 1, litres: 25, sum: 40 });
    await expect(core.driver.fuelReport(s.owner, { from: "2026-01-01", to: "2026-11-17" })).rejects.toEqual(code("invalid", 422));
    /* the manager with "Финанси и гориво" given in "Роли и права" */
    await core.staff.setRole("manager", [...s.manager.sections, "finance"], "admin");
    const m2 = (await core.staff.bySession((await core.staff.login("manager", PW, "9.9.9.9")).token))!;
    expect((await core.driver.fuelReport(m2)).total.n).toBe(3);
  });
});

describe("the end of the shift", () => {
  it("blocked while a taken order is not delivered (a clear list); then the km and Предадох; the shift is closed", async () => {
    const { core, events } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s), b = await ready(core, s);
    await core.driver.take(s.driver, [a.no, b.no]);
    await core.driver.go(s.driver, [a.no]);
    const sum = await core.driver.shift(s.driver);
    expect(sum.unfinished.map((d) => [d.no, d.st])).toEqual([[a.no, "road"], [b.no, "picked"]]);
    await expect(core.driver.end(s.driver, { km: 48300, handed: true })).rejects.toMatchObject({
      code: "unfinished", status: 409, fields: { [a.no]: "На път", [b.no]: "Взета" },
      message: "Имаш недоставени поръчки: № " + a.no + ", № " + b.no + ". Достави ги или ги върни в ресторанта, преди да приключиш.",
    });
    await core.driver.go(s.driver);
    await core.driver.deliver(s.driver, a.no); await core.driver.deliver(s.driver, b.no);
    await expect(core.driver.end(s.driver, { km: "", handed: false })).rejects.toMatchObject({ code: "invalid", fields: { km: "Въведи километража от таблото.", handed: "Отбележи, че си предал парите." } });
    await expect(core.driver.end(s.driver, { km: 48249, handed: true })).rejects.toMatchObject({ fields: { km: expect.stringContaining("48 250") } });
    events.length = 0;
    const end = await core.driver.end(s.driver, { km: 48290, handed: true });
    expect(end).toMatchObject({ closed: true, delivered: 2, handover: Math.round((a.total + b.total + 20) * 100) / 100, km: { total: 40 }, unfinished: [] });
    expect(events).toEqual([["driver.course", { driver: "driver", kind: "shift_end", orders: [] }, {}]]);
    expect((await core.audit.list()).find((x) => x.action === "driver.shift_end")!.data).toMatchObject({ km: 40, delivered: 2, cash: Math.round((a.total + b.total) * 100) / 100, float: 20, handover: end.handover, handed: true });
    /* closed: no shift, the session stays (the screen signs out) */
    expect((await core.driver.state(s.driver)).shift).toBeNull();
    await expect(core.driver.shift(s.driver)).rejects.toEqual(code("no_shift", 409));
    await expect(core.driver.end(s.driver, { km: 48300, handed: true })).rejects.toEqual(code("no_shift", 409));
    expect((await core.driver.list(s.driver))).toMatchObject({ shift: null, active: [], done: [] });
    expect((await core.driver.drivers(s.manager)).drivers).toEqual([]);
  });
});

describe("what the manager and the owner see", () => {
  it("the drivers on shift: status, the course in order, late or on time, delivered today, the cash, the car; no position", async () => {
    const { core, t } = mk(), s = await people(core);
    expect((await core.driver.drivers(s.manager))).toEqual({ drivers: [], waiting: 0, asks: [], problems: [] });
    await begin(core, s.driver);
    const a = await ready(core, s, { addr: ADDR.d1 }), b = await ready(core, s);
    let v = await core.driver.drivers(s.manager);
    expect(v.waiting).toBe(2);
    expect(v.drivers).toEqual([expect.objectContaining({ user: "driver", name: "Шофьор 1", sinceAt: "19:42", status: "restaurant", statusLabel: "В ресторанта", course: { id: null, stops: [] }, deliveredToday: 0, cash: 20, position: null,
      car: { id: "a1", n: "Автомобил 1", plate: null, missing: "[ЛИПСВА: коли: марка, рег. №]" } })]);
    await core.driver.take(s.driver, [a.no, b.no]);
    expect((await core.driver.drivers(s.owner)).drivers[0]).toMatchObject({ status: "restaurant" });
    await core.driver.go(s.driver);
    t.now += 28 * MINUTE; /* b (25 min) is 3 min late, a (30 min) is on time */
    v = await core.driver.drivers(s.manager);
    expect(v.drivers[0]).toMatchObject({ status: "road", statusLabel: "На път" });
    expect(v.drivers[0].course.stops).toEqual([
      { no: b.no, n: 1, zone: "Дружба 2", addr: b.addr, st: "road", stLabel: "На път", late: 3, lateLabel: "+3 мин", next: true, arrivedAt: null },
      { no: a.no, n: 2, zone: "Дружба 1", addr: a.addr, st: "road", stLabel: "На път", late: 0, lateLabel: "навреме", next: false, arrivedAt: null },
    ]);
    await core.driver.deliver(s.driver, b.no);
    v = await core.driver.drivers(s.manager);
    expect(v.drivers[0].course.stops.map((x) => [x.no, x.st, x.lateLabel, x.next])).toEqual([[b.no, "done", "+3 мин", false], [a.no, "road", "навреме", true]]);
    await core.driver.deliver(s.driver, a.no);
    v = await core.driver.drivers(s.admin);
    /* the course is delivered and no new one is taken yet */
    expect(v.drivers[0]).toMatchObject({ status: "back", statusLabel: "Връща се", deliveredToday: 2, cash: Math.round((a.total + b.total + 20) * 100) / 100 });
    expect(v.drivers[0].course.stops.map((x) => x.st)).toEqual(["done", "done"]);
    expect(JSON.stringify(v)).not.toMatch(/0888|"phone"/);
    const c = await ready(core, s);
    await core.driver.take(s.driver, [c.no]);
    v = await core.driver.drivers(s.manager);
    expect(v.drivers[0]).toMatchObject({ status: "restaurant" });
    expect(v.drivers[0].course.stops.map((x) => x.no)).toEqual([c.no]);
    expect((await core.orders.get(c.no))!.course).not.toBe((await core.orders.get(a.no))!.course); /* a new trip */
  });
});

describe("the search and the rights", () => {
  it("the search: only his deliveries of the shift, by number, address, quarter, state", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver); await begin(core, s.driver2, "a2", 100);
    const a = await ready(core, s, { addr: ADDR.d1 }), b = await ready(core, s), c = await ready(core, s), w = await ready(core, s);
    await core.driver.take(s.driver, [a.no, b.no]); await core.driver.take(s.driver2, [c.no]);
    await core.driver.go(s.driver, [b.no]); await core.driver.deliver(s.driver, b.no);
    const nos = async (q: string) => { const r = await core.driver.search(s.driver, q); return [r.act.map((d) => d.no), r.done.map((d) => d.no)]; };
    expect(await nos(a.no)).toEqual([[a.no], []]);
    expect(await nos("№ " + b.no)).toEqual([[], [b.no]]);
    expect(await nos("дружба")).toEqual([[a.no], [b.no]]);
    expect(await nos("druzhba")).toEqual([[a.no], [b.no]]);
    expect(await nos("бл. 72")).toEqual([[a.no], []]);
    expect(await nos("бл 311")).toEqual([[], [b.no]]);
    expect(await nos("доставени")).toEqual([[], [b.no]]);
    expect(await nos("взета")).toEqual([[a.no], []]);
    expect(await nos(c.no)).toEqual([[], []]); /* another driver's */
    expect(await nos(w.no)).toEqual([[], []]); /* nobody's yet */
    expect(await nos("   ")).toEqual([[], []]);
  });
  it("waiter, kitchen and marketing get 403 everywhere; no session 401; the manager's views only for the bosses", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    const a = await ready(core, s);
    const calls: ((x: StaffCtx) => Promise<unknown>)[] = [
      (x) => core.driver.state(x), (x) => core.driver.start(x, { car: "a2", km: 1 }), (x) => core.driver.prefs(x, { nav: "waze" }), (x) => core.driver.changeCar(x, { car: "a2", kmEnd: 1, kmStart: 1 }),
      (x) => core.driver.list(x), (x) => core.driver.get(x, a.no), (x) => core.driver.take(x, [a.no]), (x) => core.driver.go(x), (x) => core.driver.arrive(x, a.no), (x) => core.driver.deliver(x, a.no),
      (x) => core.driver.problem(x, a.no, "nobody"), (x) => core.driver.returned(x, a.no), (x) => core.driver.undo(x, "x"), (x) => core.driver.ask(x, a.no), (x) => core.driver.route(x), (x) => core.driver.routePick(x, "B"),
      (x) => core.driver.routeMove(x, a.no, "up"), (x) => core.driver.fuel(x), (x) => core.driver.fuelAdd(x, { litres: 1, sum: 1, km: 1 }), (x) => core.driver.shift(x), (x) => core.driver.end(x, { km: 1, handed: true }),
      (x) => core.driver.search(x, "1"), (x) => core.driver.drivers(x), (x) => core.driver.asks(x), (x) => core.driver.answer(x, "x", "deliver"), (x) => core.driver.answerUndo(x, "x"), (x) => core.driver.saveCars(x, []), (x) => core.driver.fuelReport(x),
    ];
    for (const who of ["waiter", "kitchen", "marketing"]) for (const f of calls) await expect(f(s[who])).rejects.toEqual(code("forbidden", 403));
    for (const f of calls) await expect(f(null as never)).rejects.toEqual(code("auth", 401));
    /* the manager's views: the bosses only */
    for (const f of [(x: StaffCtx) => core.driver.drivers(x), (x: StaffCtx) => core.driver.asks(x)]) {
      for (const who of ["admin", "owner", "manager"]) await expect(f(s[who])).resolves.toBeDefined();
      for (const who of ["driver", "driver2"]) await expect(f(s[who])).rejects.toEqual(code("forbidden", 403));
    }
    /* "Шофьор" taken from the role in "Роли и права" closes the driver's functions */
    await core.staff.setRole("driver", ["dashboard"], "admin");
    const d2 = (await core.staff.bySession((await core.staff.login("driver", PW, "9.9.9.9")).token))!;
    await expect(core.driver.list(d2)).rejects.toEqual(code("forbidden", 403));
  });
});
