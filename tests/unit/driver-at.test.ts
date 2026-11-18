/* The driver's core (src/core/driver.ts): a step kept on the phone with no connection is sent later with the moment it
   was made (`at`), like the kitchen's actions: the times of the order, the log and the window of "Отмени" follow it. */
import { describe, it, expect } from "vitest";
import { staffMayHear } from "../../server/app.ts";
import { COL } from "../../src/core/ctx.ts";
import { imageDims } from "../../src/core/driver.ts";
import { createCore, MemoryRepo, publicOrder, type Hasher, type Order, type StaffCtx, type RoleId, type PushPayload } from "../../src/core/index.ts";
import { items } from "../../src/lib/data.ts";

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

const web = (core: Core, extra: Record<string, unknown> = {}) =>
  core.orders.create({ cart: { mode: "delivery", lines: [{ key: dish.id, id: dish.id, q: 2, mods: [], extra: 0 }] }, addr: "ж.к. Дружба 2, бл. 311", name: "Иван Петров", phone: PHONE, email: "ivan@primer.bg", pay: "cash", note: "Звънецът не работи", ...extra } as never);
/** through the existing status rules: the kitchen's two steps */
async function ready(core: Core, s: Record<string, StaffCtx>, extra: Record<string, unknown> = {}): Promise<Order> {
  const o = await web(core, extra);
  await core.orders.setStatus(o.no, "cooking", "kitchen", s.kitchen);
  return core.orders.setStatus(o.no, "ready", "kitchen", s.kitchen);
}
const begin = (core: Core, who: StaffCtx, car = "a1", km: number | string = 48250, float: number | string | null = "20,00") => core.driver.start(who, { car, km, float });
const code = (c: string, status?: number) => expect.objectContaining({ code: c, ...(status ? { status } : {}) });

describe("the moment of a step (at)", () => {
  it("a step sent later keeps its moment; the undo window counts from it; the future and the time before the shift are refused", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver);
    const o = await ready(core, s);
    t.now = T0 + 20 * MINUTE;
    const took = T0 + 10 * MINUTE;
    const r = await core.driver.take(s.driver, [o.no], { at: took });
    expect(r.deliveries[0].pickedAt).toBe(new Date(took).toISOString());
    /* made 10 minutes ago: "Отмени" is long over */
    await expect(core.driver.undo(s.driver, r.undo.id)).rejects.toEqual(code("undo_late", 409));
    const went = new Date(T0 + 12 * MINUTE).toISOString();
    const g = await core.driver.go(s.driver, [o.no], { at: went });
    expect(g.deliveries[0].onWayAt).toBe(went);
    const ar = await core.driver.arrive(s.driver, o.no, { at: T0 + 15 * MINUTE });
    expect(ar.deliveries[0].arrivedAt).toBe(new Date(T0 + 15 * MINUTE).toISOString());
    const d = await core.driver.deliver(s.driver, o.no, { at: T0 + 16 * MINUTE });
    expect(d.deliveries[0].deliveredAt).toBe(new Date(T0 + 16 * MINUTE).toISOString());
    const log = (await core.audit.list()).filter((x) => x.action === "driver.arrive");
    expect(log[0].at).toBe(new Date(T0 + 15 * MINUTE).toISOString());
    /* the log keeps both moments: when it was made and when the server received it */
    expect(log[0].data).toMatchObject({ receivedAt: new Date(T0 + 20 * MINUTE).toISOString(), offline: true });
    /* never before the last change of the order, never after now */
    const o2 = await ready(core, s);
    /* before the order was ready (its previous step): refused; a few seconds before (the phone's clock): moved to it */
    await expect(core.driver.take(s.driver, [o2.no], { at: T0 + 1 })).rejects.toMatchObject({ code: "bad_at", status: 422, message: "Записът за №\u00a0" + o2.no + " е отпреди предишната ѝ стъпка и не се записва." });
    const r2 = await core.driver.take(s.driver, [o2.no], { at: t.now - 20_000 });
    expect(Date.parse(r2.deliveries[0].pickedAt!)).toBeGreaterThanOrEqual(Date.parse(o2.updatedAt));
    await expect(core.driver.go(s.driver, [o2.no], { at: t.now + 5 * MINUTE })).rejects.toMatchObject({ code: "bad_at", status: 422, message: "Часовникът на телефона е напред. Провери го и опитай пак." });
    await expect(core.driver.go(s.driver, [o2.no], { at: T0 - 60 * MINUTE })).rejects.toMatchObject({ code: "bad_at", message: "Действието е отпреди началото на смяната и не се записва." });
    await expect(core.driver.go(s.driver, [o2.no], { at: "вчера" })).rejects.toMatchObject({ code: "bad_at", message: "Часът на действието е невалиден." });
    /* fuel entered with no connection */
    const f = await core.driver.fuelAdd(s.driver, { litres: "40", sum: "60", km: 48300, at: T0 + 18 * MINUTE });
    expect(f.entry.at).toBe(new Date(T0 + 18 * MINUTE).toISOString());
  });
});

describe("the rules of review 2 (flows)", () => {
  it("at most 30 minutes back (decision 18.11)", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver);
    const o = await ready(core, s);
    t.now = T0 + 45 * MINUTE;
    await expect(core.driver.take(s.driver, [o.no], { at: T0 + 2 * MINUTE })).rejects.toMatchObject({ code: "bad_at", message: "Записът е по-стар от 30 минути и не се записва. Кажи на управителя какво е станало." });
    expect((await core.driver.take(s.driver, [o.no], { at: T0 + 20 * MINUTE })).deliveries[0].pickedAt).toBe(new Date(T0 + 20 * MINUTE).toISOString());
  });
  it("a km more than 2 000 over the last record is refused at the start, in fuel and at the end; the bosses correct a car's km", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver, "a1", 48250);
    const HIGH = "Над 2 000 км повече от последния запис. Провери числото.";
    await expect(core.driver.fuelAdd(s.driver, { litres: 30, sum: 50, km: 98250 })).rejects.toMatchObject({ status: 422, fields: { km: HIGH } });
    await expect(core.driver.end(s.driver, { km: 98250, handed: true })).rejects.toMatchObject({ status: 422, fields: { km: HIGH } });
    await core.driver.fuelAdd(s.driver, { litres: 30, sum: 50, km: 48300 });
    await core.driver.end(s.driver, { km: 48400, handed: true });
    await expect(begin(core, s.driver, "a1", 98400)).rejects.toMatchObject({ status: 422, fields: { km: HIGH } });
    /* a wrong record is corrected by the main admin, the owner or the manager (with a line in the log); never the driver */
    await expect(core.driver.setCarKm(s.driver, "a1", 48000)).rejects.toEqual(code("forbidden", 403));
    /* an open shift keeps its start km: the record never goes below it */
    await begin(core, s.driver2, "a2", 31540);
    await expect(core.driver.setCarKm(s.manager, "a2", 10)).rejects.toMatchObject({ status: 422, fields: { km: "Смяната на Шофьор 2 започна с 31\u00a0540 км. Километражът не може да е по-малко, докато е отворена." } });
    expect((await core.driver.state(s.driver2)).shift!.kmStart).toBe(31540);
    const cars = await core.driver.setCarKm(s.manager, "a1", 48390);
    expect(cars.find((c) => c.id === "a1")!.lastKm).toBe(48390);
    expect((await core.audit.list()).find((x) => x.action === "driver.car_km")).toMatchObject({ actor: "manager", target: "a1", data: { from: 48400, to: 48390 } });
    expect((await begin(core, s.driver, "a1", 48395)).shift!.kmStart).toBe(48395);
  });
  it("another driver's open question: „чака се отговор“; one undelivered order: „Достави я“", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver); await begin(core, s.driver2, "a2", 31540);
    const o = await ready(core, s, { addr: "ж.к. Дружба 2, бл. 311" });
    await core.driver.ask(s.driver2, o.no);
    await expect(core.driver.take(s.driver, [o.no])).rejects.toMatchObject({ message: "№\u00a0" + o.no + ": чака се отговор от управителя за адреса." });
    await expect(core.driver.take(s.driver2, [o.no])).rejects.toMatchObject({ message: "№\u00a0" + o.no + ": чакаш отговор от управителя за адреса." });
    const p = await ready(core, s);
    await core.driver.take(s.driver, [p.no]);
    await expect(core.driver.end(s.driver, { km: 48300, handed: true })).rejects.toMatchObject({ message: "Имаш недоставена поръчка: №\u00a0" + p.no + ". Достави я или я върни в ресторанта, преди да приключиш." });
  });
  it("the customer's page with a problem: no „пред входа“, only the neutral hold", async () => {
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    const o = await ready(core, s);
    await core.driver.take(s.driver, [o.no]); await core.driver.go(s.driver, [o.no]); await core.driver.arrive(s.driver, o.no);
    expect(publicOrder((await core.ctx.repo.get(COL.orders, o.no)) as Order).arrivedAt).toBeTruthy();
    await core.driver.problem(s.driver, o.no, "nobody");
    const p1 = publicOrder((await core.ctx.repo.get(COL.orders, o.no)) as Order) as unknown as Record<string, unknown>;
    expect([p1.arrivedAt, p1.hold, JSON.stringify(p1).includes("nobody")]).toEqual([undefined, true, false]);
    await core.driver.returned(s.driver, o.no);
    const p2 = publicOrder((await core.ctx.repo.get(COL.orders, o.no)) as Order) as unknown as Record<string, unknown>;
    expect([p2.arrivedAt, p2.hold]).toEqual([undefined, true]);
  });
  it("a receipt is a picture: its size is read from the header", async () => {
    const png = (body: number[]) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...body]);
    const ihdr = png([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0, 8, 2, 0, 0, 0]);
    expect(imageDims(ihdr, "png")).toEqual({ w: 512, h: 256 });
    expect(imageDims(png([...new TextEncoder().encode("<html><script>alert(1)</script></html>")]), "png")).toBeNull();
    const { core } = mk(), s = await people(core);
    await begin(core, s.driver);
    await expect(core.driver.receiptCheck(s.driver, { bytes: 46, ext: "png", data: png([...new TextEncoder().encode("<html><script>alert(1)</script></html>")]) })).rejects.toEqual(code("unsupported", 415));
    await expect(core.driver.receiptCheck(s.driver, { bytes: ihdr.length, ext: "png", data: ihdr })).resolves.toEqual({ ok: true });
  });
  it("the driver's phone hears only what it needs", () => {
    const d = { role: "driver", sections: ["driver"] };
    expect(["driver.course", "driver.ask", "order.status", "order.new", "menu.soldout", "kitchen.busy"].map((t) => staffMayHear(d, t))).toEqual([true, true, true, true, true, true]);
    expect(["order.created", "note.created", "feedback.created", "owner.answer", "shift.update", "floor.call"].map((t) => staffMayHear(d, t))).toEqual([false, false, false, false, false, false]);
    expect(staffMayHear({ role: "manager", sections: [] }, "order.created")).toBe(true);
  });
});

describe("fuel paid from the cash waits for „Видях бележката“ (decision 18.11, round 4)", () => {
  it("off „За предаване“ only after a boss saw the receipt; the rights; undo; the cash on hand counts what waits", async () => {
    const { core, t } = mk(), s = await people(core);
    await begin(core, s.driver, "a1", 48250, "50,00");
    const f = await core.driver.fuelAdd(s.driver, { litres: 1, sum: "29,93", km: 48260, cash: true, noPhoto: true });
    expect(f.entry).toMatchObject({ cash: true, pending: true, confirmed: null });
    let sh = await core.driver.shift(s.driver);
    expect([sh.fuelCash, sh.fuelCashPending, sh.handover]).toEqual([0, 29.93, 50]);
    /* the cash on hand counts what waits: the same money never pays two entries */
    expect(f.cashOnHand).toBe(20.07);
    await expect(core.driver.fuelAdd(s.driver, { litres: 1, sum: "29,93", km: 48261, cash: true })).rejects.toMatchObject({ fields: { sum: expect.stringContaining("Имаш 20,07") } });
    /* the manager sees it at the driver */
    const row = (await core.driver.drivers(s.manager)).drivers.find((d) => d.user === "driver")!;
    expect(row.cashParts).toEqual({ orders: 0, float: 50, fuel: 0, fuelPending: 29.93 });
    expect(row.fuelPending).toEqual([expect.objectContaining({ id: f.entry.id, sum: 29.93, litres: 1, photo: null, noPhoto: true, atClock: "19:42" })]);
    /* the rights: the main admin, the owner, the manager; never the driver, the waiter, the kitchen */
    for (const who of ["driver", "driver2", "waiter", "kitchen", "marketing"]) await expect(core.driver.confirmFuel(s[who], f.entry.id)).rejects.toMatchObject({ status: 403 });
    const ok = await core.driver.confirmFuel(s.manager, f.entry.id);
    expect(ok).toMatchObject({ pending: false, confirmed: { by: "manager" } });
    sh = await core.driver.shift(s.driver);
    expect([sh.fuelCash, sh.fuelCashPending, sh.handover]).toEqual([29.93, 0, 20.07]);
    await expect(core.driver.confirmFuel(s.owner, f.entry.id)).rejects.toEqual(code("confirmed", 409));
    expect((await core.audit.list()).find((x) => x.action === "fuel.confirm")).toMatchObject({ actor: "manager", target: f.entry.id, data: { driver: "driver", sum: 29.93 } });
    /* "Отмени" inside the window, by the one who confirmed */
    await expect(core.driver.confirmFuelUndo(s.owner, f.entry.id)).rejects.toEqual(code("undo_gone", 409));
    await core.driver.confirmFuelUndo(s.manager, f.entry.id);
    expect((await core.driver.shift(s.driver)).fuelCashPending).toBe(29.93);
    await core.driver.confirmFuel(s.owner, f.entry.id);
    t.now += 20_000;
    await expect(core.driver.confirmFuelUndo(s.owner, f.entry.id)).rejects.toEqual(code("undo_late", 409));
    /* fuel paid by card is not the cash */
    const card = await core.driver.fuelAdd(s.driver, { litres: 10, sum: 15, km: 48270 });
    await expect(core.driver.confirmFuel(s.manager, card.entry.id)).rejects.toEqual(code("not_cash", 409));
  });
});
