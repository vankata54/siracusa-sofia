/* The speed of the operational screens with a year and a half of old orders (decision of the chief: after a year every
   screen is fast; the pattern of tests/unit/history-speed.test.ts): about 60 000 old orders in SQLite and today's work
   on top. Every answer below 100 ms: the kitchen (the queue, "Изпълнени", "Общ изглед", "Изчерпано"), the manager ("Сега",
   "Залата", "Екипът", the search), the waiter's hall and the shift view, the drivers, the admin's "Поръчки" (today and
   "Всички дни") and "Клиенти", the search, the tracking, the month of the reservations. The numbers are printed.
   Before (f6df8e7, the same data): see the report; the slowest read the whole table every time. */
import { describe, it, expect } from "vitest";
import { createCore, type Hasher, type StaffCtx } from "../../src/core/index.ts";
import { openDb } from "../../server/db/index.ts";
import { SqliteRepo } from "../../server/db/repo.ts";
import { histDay } from "../../src/core/order-day.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s", hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const T0 = Date.parse("2026-11-16T10:30:00Z"); /* Monday 12:30 in Sofia */
const N_DAYS = 550, PER_DAY = 110;

describe("the operational screens with about 60 000 old orders", () => {
  it("every answer < 100 ms", async () => {
    const { sqlite } = openDb(":memory:"), repo = new SqliteRepo(sqlite);
    const core = createCore({ repo, hasher, now: () => new Date(T0), clock: "12:30", smsDemo: true });
    await core.staff.upsert({ username: "admin", name: "Админ", role: "admin", password: "a-long-password-1" });
    const s: StaffCtx = (await core.staff.bySession((await core.staff.login("admin", "a-long-password-1", "1.1.1.1")).token))!;
    const dishes = items.filter((x) => !x.per100 && !x.t.includes("out")).slice(0, 40), CH = ["web", "web", "web", "phone", "waiter", "qr", "office"];
    const ins = sqlite.prepare(`INSERT INTO orders (id, data, created_at, updated_at, no, mode, status, phone, total, channel, day) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    let no = 10000, seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    sqlite.transaction(() => {
      for (let d = 1; d <= N_DAYS; d++) for (let k = 0; k < PER_DAY; k++) {
        const min = 600 + Math.floor(rnd() * 760), ts = T0 - d * 864e5 + (min - 750) * 60e3, iso = new Date(ts).toISOString();
        const lines = [0, 1, 2].slice(0, 1 + Math.floor(rnd() * 3)).map(() => { const x = dishes[Math.floor(rnd() * dishes.length)]; return { id: x.id, name: x.n, unit: x.p, q: 1, mods: [], extra: 0, sec: "skara", ks: "ready", readyAt: iso }; });
        const total = Math.round(lines.reduce((a, l) => a + l.unit * l.q, 0) * 100) / 100, channel = CH[Math.floor(rnd() * CH.length)], id = String(++no), mode = rnd() < 0.5 ? "delivery" : "pickup";
        const o = { id, no: id, key: "k" + id, mode, channel, lines, sub: total, disc: 0, fee: 0, total, pay: "cash", status: rnd() < 0.04 ? "cancelled" : mode === "delivery" ? "delivered" : "picked_up",
          placedAt: String(Math.floor(min / 60) % 24).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"), ts, sched: "", slot: "asap", phone: "0888" + String(100000 + Math.floor(rnd() * 20000)), name: "Клиент " + (k % 50), addr: "", zone: "", times: {}, createdAt: iso, updatedAt: iso };
        ins.run(id, JSON.stringify(o), iso, iso, no, o.mode, o.status, o.phone, total, channel, histDay(o));
      }
    })();
    /* today's work: orders through the core (the kitchen queue, the manager's problems) */
    const pizza = dishes.find((x) => x.cat === "pitsi") || dishes[0];
    let first = "";
    for (let i = 0; i < 30; i++) { const o = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: pizza.id, id: pizza.id, q: 1, mods: [], extra: 0 }] }, name: "Иван", phone: "0888123" + String(100 + i), pay: "cash" } as never); if (!first) first = o.no + "-" + (o as { key?: string }).key; }
    const n = (sqlite.prepare("SELECT count(*) AS n FROM orders").get() as { n: number }).n;
    const ms = async (fn: () => Promise<unknown>) => { await fn(); const t = performance.now(); await fn(); return Math.round(performance.now() - t); };
    const cfg = await core.kitchen.config(s) as { sections: { id: string }[] }, sec = cfg.sections[0].id;
    const r: Record<string, number> = {
      kitchenQueue: await ms(() => core.kitchen.queue(s, sec)), kitchenDone: await ms(() => core.kitchen.doneToday(s, sec)), kitchenSummary: await ms(() => core.kitchen.summary(s)), kitchenSoldOut: await ms(() => core.kitchen.soldOut(s, sec)),
      managerNow: await ms(() => core.shift.now(s)), managerHall: await ms(() => core.shift.hall(s)), managerTeam: await ms(() => core.shift.team(s)), managerSearch: await ms(() => core.shift.search(s, "Иван")),
      waiterHall: await ms(() => core.floor.hall(s)), shiftView: await ms(() => core.floor.shiftView(s)), drivers: await ms(() => core.driver.drivers(s)),
      ordersToday: await ms(() => core.ordersAdmin.list(s, {})), ordersAll: await ms(() => core.ordersAdmin.list(s, { day: "all" })), ordersAllSearch: await ms(() => core.ordersAdmin.list(s, { day: "all", q: "1042" })),
      customers: await ms(() => core.customersAdmin.list(s, {})), adminSearch: await ms(() => core.admin.search(s, "Клиент 7")), summary: await ms(() => core.admin.summary(s)),
      tracking: await ms(() => core.orders.track(first)), resMonth: await ms(() => core.resAdmin.month(s, "2026-11")),
    };
    console.log("operational speed, " + n + " orders: " + JSON.stringify(r) + " ms");
    expect(n).toBeGreaterThanOrEqual(60000);
    for (const [k, v] of Object.entries(r)) expect(v, k).toBeLessThan(100);
  }, 180_000);
});
