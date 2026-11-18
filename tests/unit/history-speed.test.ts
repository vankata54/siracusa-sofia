/* The speed of THE history with a real volume (decision of the chief after reviews-code/sobstvenik.review-2.md, the
   blocking point): about 60 000 orders in SQLite (110 a day for a year and a half). "Днес" under 300 ms, "Тенденции" and
   "Финанси" for 92 days under 1 s (the first time, with an empty cache), the dashboard's summary, and the memory of the
   process under 300 MB. Before the change (the review): "Днес" 39 775 ms at 54 000 orders, "Финанси" for 92 days ran out
   of memory (12 GB). The numbers are printed (npm test shows them). */
import { describe, it, expect } from "vitest";
import { createCore, type Hasher, type StaffCtx } from "../../src/core/index.ts";
import { openDb } from "../../server/db/index.ts";
import { SqliteRepo } from "../../server/db/repo.ts";
import { histDay } from "../../src/core/order-day.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s", hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const T0 = Date.parse("2026-11-16T17:42:00Z");
const N_DAYS = 550, PER_DAY = 110;

describe("the history with about 60 000 orders", () => {
  it("'Днес' < 300 ms, 'Тенденции' and 'Финанси' for 92 days < 1 s, the summary, memory < 300 MB", async () => {
    const { sqlite } = openDb(":memory:"), repo = new SqliteRepo(sqlite);
    const core = createCore({ repo, hasher, now: () => new Date(T0), clock: "19:42", smsDemo: true });
    for (const r of ["admin", "owner"] as const) await core.staff.upsert({ username: r, name: r, role: r, password: "a-long-password-1" });
    const s: StaffCtx = (await core.staff.bySession((await core.staff.login("owner", "a-long-password-1", "1.1.1.1")).token))!;
    const dishes = items.filter((x) => !x.per100).slice(0, 40), CH = ["web", "web", "web", "phone", "waiter", "qr", "office"];
    const ins = sqlite.prepare(`INSERT INTO orders (id, data, created_at, updated_at, no, mode, status, phone, total, channel, day) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    let no = 10000, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    sqlite.transaction(() => {
      for (let d = 0; d < N_DAYS; d++) for (let k = 0; k < PER_DAY; k++) {
        const min = 600 + Math.floor(rnd() * 760), ts = T0 - d * 864e5 + (min - 1182) * 60e3, iso = new Date(ts).toISOString();
        const lines = [0, 1, 2].slice(0, 1 + Math.floor(rnd() * 3)).map(() => { const x = dishes[Math.floor(rnd() * dishes.length)]; return { id: x.id, name: x.n, unit: x.p, q: 1 + Math.floor(rnd() * 2), mods: [], extra: 0 }; });
        const total = Math.round(lines.reduce((a, l) => a + l.unit * l.q, 0) * 100) / 100, channel = CH[Math.floor(rnd() * CH.length)], id = String(++no);
        const o = { id, no: id, key: "k" + id, mode: rnd() < 0.5 ? "delivery" : "pickup", channel, lines, sub: total, disc: 0, fee: 0, total, pay: "cash", status: rnd() < 0.04 ? "cancelled" : "picked_up",
          placedAt: String(Math.floor(min / 60) % 24).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"), ts, sched: "", slot: "asap", phone: "0888" + String(100000 + Math.floor(rnd() * 20000)), name: "Клиент", times: {}, createdAt: iso, updatedAt: iso };
        ins.run(id, JSON.stringify(o), iso, iso, no, o.mode, o.status, o.phone, total, channel, histDay(o));
      }
    })();
    const n = (sqlite.prepare("SELECT count(*) AS n FROM orders").get() as { n: number }).n;
    const ms = async (fn: () => Promise<unknown>) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t); };
    const to = "2026-11-16", from = "2026-08-17";
    const r = {
      todayCold: await ms(() => core.owner.today(s)), todayWarm: await ms(() => core.owner.today(s)),
      trends92: await ms(() => core.owner.trends(s, { period: "custom", from, to })), trends92Year: await ms(() => core.owner.trends(s, { period: "custom", from, to, compare: "year" })),
      trends92Warm: await ms(() => core.owner.trends(s, { period: "custom", from, to })),
      finance92: await ms(() => core.owner.finance(s, { period: "custom", from, to })), summary: await ms(() => core.admin.summary(s)),
      reports30: await ms(() => core.reports.get(s, { period: "30" } as never)),
    };
    const rss = Math.round(process.memoryUsage().rss / 1048576);
    console.log("history speed, " + n + " orders: " + JSON.stringify(r) + " ms, rss " + rss + " MB");
    expect(n).toBeGreaterThanOrEqual(60000);
    expect(r.todayWarm).toBeLessThan(300);
    expect(r.trends92).toBeLessThan(1000); expect(r.trends92Year).toBeLessThan(1000); expect(r.finance92).toBeLessThan(1000);
    expect(r.summary).toBeLessThan(300);
    expect(rss).toBeLessThan(300 + 400); /* vitest itself takes a few hundred MB; the server alone is measured in the report */
  }, 120_000);
});
