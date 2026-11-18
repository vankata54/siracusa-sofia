/* The driver's core (src/core/driver.ts): a step kept on the phone with no connection is sent later with the moment it
   was made (`at`), like the kitchen's actions: the times of the order, the log and the window of "Отмени" follow it. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, type Hasher, type Order, type StaffCtx, type RoleId, type PushPayload } from "../../src/core/index.ts";
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
    /* never before the last change of the order, never after now */
    const o2 = await ready(core, s);
    const r2 = await core.driver.take(s.driver, [o2.no], { at: T0 + 1 });
    expect(Date.parse(r2.deliveries[0].pickedAt!)).toBeGreaterThanOrEqual(Date.parse(o2.updatedAt));
    await expect(core.driver.go(s.driver, [o2.no], { at: t.now + 5 * MINUTE })).rejects.toMatchObject({ code: "bad_at", status: 422, message: "Часовникът на телефона е напред. Провери го и опитай пак." });
    await expect(core.driver.go(s.driver, [o2.no], { at: T0 - 60 * MINUTE })).rejects.toMatchObject({ code: "bad_at", message: "Действието е отпреди началото на смяната и не се записва." });
    await expect(core.driver.go(s.driver, [o2.no], { at: "вчера" })).rejects.toMatchObject({ code: "bad_at", message: "Часът на действието е невалиден." });
    /* fuel entered with no connection */
    const f = await core.driver.fuelAdd(s.driver, { litres: "40", sum: "60", km: 48300, at: T0 + 18 * MINUTE });
    expect(f.entry.at).toBe(new Date(T0 + 18 * MINUTE).toISOString());
  });
});
