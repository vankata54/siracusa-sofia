/* The modules together, on the real cores (no line fields set by hand): a QR table orders, the waiter confirms, the kitchen
   cooks with "Започни" and "Готово", the waiter serves; a delivery from the site goes through the kitchen to the driver and
   the customer's tracking view follows every step. The e2e tests do the same in several browsers (tests/e2e/flow-*.spec.ts). */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, type Audience, type Hasher, type Order, type RoleId, type StaffCtx } from "../../src/core/index.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1";
const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver"];
const T0 = Date.parse("2026-11-16T16:30:00Z"); /* Monday 18:30 in Sofia */
type Ev = { type: string; data: any; to: Audience };

function mk() {
  const t = { now: T0 }, events: Ev[] = [], repo = new MemoryRepo();
  const core = createCore({ repo, hasher, now: () => new Date(t.now), clock: "18:30", emit: (type, data, to) => { events.push({ type, data, to }); } });
  return { core, repo, events, t };
}
async function people(core: ReturnType<typeof mk>["core"]) {
  const s = {} as Record<string, StaffCtx>;
  for (const r of ROLES) {
    await core.staff.upsert({ username: r, name: r, role: r, password: PW });
    s[r] = (await core.staff.bySession((await core.staff.login(r, PW, "1.1.1." + r)).token))!;
  }
  return s;
}
const free = (cat: string, k = 0) => items.filter((x) => x.cat === cat && !x.t.includes("out") && !x.per100)[k];
const pizza = free("pitsi"), salad = free("salati");
const G = "c".repeat(32);

describe("the modules together on the real cores", () => {
  it("QR table → waiter confirms → kitchen 'Започни' / 'Готово' → the waiter's 'Готови' → 'Сервирах' → the guest sees 'Сервирано'", async () => {
    const { core, repo, events } = mk(), s = await people(core);
    const code = (await core.hall.qr(s.admin)).find((r) => r.n === 12)!.code;
    await core.floor.open(code, G);
    await core.floor.cartAdd(code, G, { id: pizza.id });
    await core.floor.cartAdd(code, G, { id: salad.id });
    expect((await core.floor.send(code, G)).to).toBe("waiter");
    const conf = await core.floor.qrConfirm(s.waiter, 12);
    const o = (await repo.get<Order>("orders", conf.no))!;
    /* the table order is stamped for the kitchen like every order */
    expect(o.lines.every((l) => l.sec && l.ks === "wait")).toBe(true);
    const secs = [...new Set(o.lines.map((l) => l.sec!))];
    expect(events.find((e) => e.type === "order.new" && e.data.no === o.no)!.data).toMatchObject({ channel: "qr", table: "S12", secs: expect.arrayContaining(secs) });

    /* every section sees the ticket, cooks and finishes it */
    for (const sec of secs) {
      const q = await core.kitchen.queue(s.kitchen, sec);
      expect(q.tickets.map((t) => t.no)).toContain(o.no);
      await core.kitchen.start(s.kitchen, o.no, sec);
    }
    expect((await core.floor.view(code, G)).orders[0].lines.every((l) => l.st === "cooking")).toBe(true);
    for (const sec of secs) await core.kitchen.done(s.kitchen, o.no, sec);
    expect((await repo.get<Order>("orders", o.no))!.status).toBe("ready");

    /* the waiter's "Готови" has the table; "Сервирах" serves it and the order is finished ("Сервирана") */
    const ready = await core.floor.ready(s.waiter);
    expect(ready.map((g) => g.table.n)).toContain(12);
    await core.floor.serve(s.waiter, 12);
    expect((await repo.get<Order>("orders", o.no))!.status).toBe("picked_up");
    const v = await core.floor.view(code, G);
    expect(v.orders[0].lines.every((l) => l.st === "served")).toBe(true);
    /* the guests of the sitting heard the changes */
    expect(events.some((e) => e.type === "floor.session" && e.to.table === o.session)).toBe(true);
  });

  it("delivery from the site → kitchen → driver → the customer's tracking view follows every step", async () => {
    const { core, repo } = mk(), s = await people(core);
    const o = await core.orders.create({ cart: { mode: "delivery", lines: [{ key: pizza.id, id: pizza.id, q: 1, mods: [], extra: 0 }] } as never, zone: "Дружба 2", addr: "бл. 311, вх. А", name: "Клиент", phone: "0888123456", pay: "cash", marketing: false });
    const track = () => core.orders.track(o.no + "-" + o.key);
    expect((await track()).status).toBe("accepted");
    const sec = (await repo.get<Order>("orders", o.no))!.lines[0].sec!;
    await core.kitchen.start(s.kitchen, o.no, sec);
    expect((await track()).status).toBe("cooking");
    await core.kitchen.done(s.kitchen, o.no, sec);
    expect((await track()).status).toBe("ready");

    await core.driver.start(s.driver, { car: (await core.driver.state(s.driver)).cars[0].id, km: 1000 });
    expect((await core.driver.list(s.driver)).waiting.map((d) => d.no)).toContain(o.no);
    await core.driver.take(s.driver, [o.no]);
    await core.driver.go(s.driver, [o.no]);
    expect((await track()).status).toBe("on_way");
    await core.driver.arrive(s.driver, o.no);
    expect((await track()).arrivedAt).toBeTruthy();
    await core.driver.deliver(s.driver, o.no, {});
    const end = await track();
    expect(end.status).toBe("delivered");
    /* the driver never got the customer's phone */
    expect(JSON.stringify(await core.driver.get(s.driver, o.no))).not.toContain("0888123456");
  });

  it("the waiter's order sent twice with the same id (a lost answer, the offline outbox) is made only once", async () => {
    const { core, repo } = mk(), s = await people(core);
    const input = { rid: "r-" + "a1b2c3d4e5f6", lines: [{ id: pizza.id, q: 1 }] };
    const a = await core.floor.order(s.waiter, 7, input);
    const b = await core.floor.order(s.waiter, 7, input);
    expect(b.orders).toEqual(a.orders);
    expect((await repo.list<Order>("orders")).filter((o) => o.table && o.channel === "waiter")).toHaveLength(1);
    /* a new id is a new order */
    const c = await core.floor.order(s.waiter, 7, { ...input, rid: "r-" + "f6e5d4c3b2a1" });
    expect(c.orders).not.toEqual(a.orders);
  });
});
