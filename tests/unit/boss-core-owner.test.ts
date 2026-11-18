/* The owner's module (core/owner.ts) and THE history (core/history.ts): the rights; "Днес" = the admin dashboard's
   number; the usual of the last 4 same weekdays and the 20% alert with the 10-orders floor; "Миналата година" = 364 days
   back; "Отчети" and the owner give the same numbers for the same period; the questions are the markdown's word for word;
   the answers (one note per question, history, "Отмени", only the owner answers); the money rule. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createCore, MemoryRepo, OWNER_QUESTIONS, type Hasher, type RoleId, type StaffCtx } from "../../src/core/index.ts";
import { items } from "../../src/lib/data.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1";
const T0 = Date.parse("2026-11-16T17:42:00Z"); /* Monday 19:42 in Sofia */
function mk() {
  const t = { now: T0 }, repo = new MemoryRepo();
  const at = (clock: string) => createCore({ repo, hasher, now: () => new Date(t.now), clock, smsDemo: true });
  return { core: at("19:42"), at, t, repo };
}
type Core = ReturnType<typeof mk>["core"];
const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
async function people(core: Core) {
  const s = {} as Record<string, StaffCtx>, tok = {} as Record<string, string>;
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r === "owner" ? "Собственик 1" : r, role: r, password: PW });
  for (const r of ROLES) { tok[r] = (await core.staff.login(r, PW, "1.1.1." + r)).token; s[r] = (await core.staff.bySession(tok[r]))!; }
  return { s, tok };
}
const pizza = items.find((x) => x.cat === "pitsi" && !x.t.includes("out") && !x.per100)!, salad = items.find((x) => x.cat === "salati" && !x.t.includes("out"))!;
const order = (core: Core, id = pizza.id, q = 1, mode: "pickup" | "delivery" = "pickup") =>
  core.orders.create({ cart: { mode, lines: [{ key: id, id, q, mods: [], extra: 0 }] }, addr: "ж.к. Дружба 2, бл. 311", name: "Иван", phone: "0888123456", pay: "cash" } as never);
/** n orders placed at 12:00 (Sofia) on a past day */
async function past(m: ReturnType<typeof mk>, ymd: string, n: number, id = pizza.id) {
  const [y, mo, d] = ymd.split("-").map(Number);
  m.t.now = Date.UTC(y, mo - 1, d, 9, 0); const c = m.at("12:00");
  for (let i = 0; i < n; i++) await order(c, id);
  m.t.now = T0;
}
const r2 = (v: number) => Math.round(v * 100) / 100;

describe("rights", () => {
  it("the owner and the main admin; every other role 403; finance needs 'Финанси и гориво'", async () => {
    const { core } = mk(), { s, tok } = await people(core);
    for (const fn of [(x: StaffCtx) => core.owner.today(x), (x: StaffCtx) => core.owner.trends(x, { period: "7" }), (x: StaffCtx) => core.owner.finance(x), (x: StaffCtx) => core.owner.decisions(x)]) {
      for (const r of ["owner", "admin"]) await expect(fn(s[r])).resolves.toBeTruthy();
      for (const r of ["manager", "waiter", "kitchen", "driver", "marketing"]) await expect(fn(s[r])).rejects.toMatchObject({ code: "forbidden", status: 403 });
    }
    await expect(core.owner.today(null as never)).rejects.toMatchObject({ status: 401 });
    /* the owner without "Финанси и гориво": no sum anywhere, finance 403 */
    await core.staff.setRole("owner", s.owner.sections.filter((x) => x !== "finance"), "admin");
    const o = (await core.staff.bySession(tok.owner))!;
    await order(core); await order(core, salad.id, 2);
    const t = await core.owner.today(o), tr = await core.owner.trends(o, { period: "7" });
    expect(t.money).toBe(false); expect(t.sales).toEqual({ sum: null, n: 2 }); expect(t.byHour).toBeNull();
    const sums: unknown[] = [];
    JSON.stringify([t, tr], (k, v) => { if (["revenue", "sum", "avg", "disc"].includes(k)) sums.push(v); return v; });
    expect(sums.length).toBeGreaterThan(10); expect(sums.filter((v) => v !== null && typeof v !== "object")).toEqual([]);
    await expect(core.owner.finance(o)).rejects.toMatchObject({ status: 403 });
  });
});

describe("'Днес'", () => {
  it("'Днес: X € от N поръчки' is the admin dashboard's number; channels; the last 7 days", async () => {
    const m = mk(), { core } = m, { s } = await people(core);
    const a = await order(core), b = await order(core, salad.id, 2, "delivery"), c = await order(core);
    await core.orders.setStatus(c.no, "cancelled", "system");
    const t = await core.owner.today(s.owner), sum = (await core.admin.summary(s.owner)).today.sales!;
    expect(t.sales).toEqual({ sum: sum.sum, n: sum.n });
    expect(t.sales).toEqual({ sum: r2(a.total + b.total), n: 2 });
    expect(t.cancelled).toBe(1);
    expect(t.byChannel.map((x) => [x.key, x.orders])).toEqual([["delivery", 1], ["pickup", 1], ["phone", 0], ["table", 0], ["office", 0]]);
    expect(t.byChannel.find((x) => x.key === "pickup")!.label).toBe("Вземане от сайта");
    expect(t.last7.days).toHaveLength(7); expect(t.last7.days[6]).toMatchObject({ date: "2026-11-16", orders: 2, short: "пн", weekAgo: { date: "2026-11-09" } });
    expect(t.live.inWork).toBe((await core.ordersAdmin.list(s.owner)).counts.work);
    expect(t.byHour!.labels[0]).toBe("10:00"); expect(t.byHour!.cur[t.byHour!.nowIndex]).toBe(r2(a.total + b.total)); expect(t.byHour!.cur.at(-1)).toBeNull();
    expect(t.lastWeek.label).toBe("Миналия понеделник по това време");
  });
  it("the usual = the average of the same weekday in the last 4 weeks up to the minute; the alert at 20% with 10+ usual orders", async () => {
    const m = mk(), { core } = m, { s } = await people(core);
    for (const d of ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]) await past(m, d, 12);
    /* a Tuesday does not count */
    await past(m, "2026-11-10", 30);
    for (let i = 0; i < 12; i++) await order(core);
    let t = await core.owner.today(s.owner);
    expect(t.usual).toMatchObject({ orders: 12, sum: r2(12 * pizza.p), days: ["2026-11-09", "2026-11-02", "2026-10-26", "2026-10-19"], withData: 4, label: "обичайното за понеделник до 19:42" });
    expect(t.vsUsual).toEqual({ pct: 0, measure: "revenue" }); expect(t.alert).toBeNull();
    expect(t.lastWeek).toMatchObject({ date: "2026-11-09", sum: r2(12 * pizza.p), orders: 12 });
    /* up to the same minute: an order last Monday after 19:42 is not in the base */
    m.t.now = Date.UTC(2026, 10, 9, 19, 0); for (const _ of [1, 2, 3, 4]) await order(m.at("21:00")); m.t.now = T0;
    t = await core.owner.today(s.owner);
    expect(t.usual.orders).toBe(12); expect(t.lastWeek.orders).toBe(12);
    /* 9 of the usual 12 today: -25% -> the alert */
    const m2 = mk(), { s: s2 } = await people(m2.core);
    for (const d of ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]) await past(m2, d, 12);
    for (let i = 0; i < 9; i++) await order(m2.core);
    t = await m2.core.owner.today(s2.owner);
    expect(t.alert).toMatchObject({ pct: 25, dir: "down", text: "Оборотът днес е с 25% под обичайното за понеделник до 19:42" });
    expect(t.alert!.sub).toContain("обичайно");
    /* the floor: fewer than 10 usual orders by now -> no alert, even at -50% */
    const m3 = mk(), { s: s3 } = await people(m3.core);
    for (const d of ["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"]) await past(m3, d, 8);
    for (let i = 0; i < 4; i++) await order(m3.core);
    t = await m3.core.owner.today(s3.owner);
    expect(t.vsUsual.pct).toBe(-50); expect(t.alert).toBeNull();
  });
});

describe("the one history: 'Отчети' and the owner, the same numbers; 364 days", () => {
  it("every period: the totals and the previous period are the same in both", async () => {
    const m = mk(), { core } = m, { s } = await people(core);
    for (const [d, n] of [["2026-11-09", 3], ["2026-11-15", 2], ["2026-11-08", 4], ["2026-11-03", 5], ["2026-10-16", 6], ["2026-10-02", 1], ["2025-11-17", 2]] as [string, number][]) await past(m, d, n);
    await order(core); await order(core, salad.id, 3);
    for (const period of ["today", "yesterday", "7", "30", "month"] as const) {
      const rep = await core.reports.get(s.owner, { period }), tr = await core.owner.trends(s.owner, { period });
      const pick = (x: Record<string, unknown>) => ({ orders: x.orders, cancelled: x.cancelled, revenue: x.revenue, avg: x.avg, reservations: x.reservations, noShows: x.noShows });
      expect([period, pick(tr.totals as never)]).toEqual([period, pick(rep as never)]);
      expect([period, pick(tr.prev as never), tr.cmp.from, tr.cmp.to]).toEqual([period, pick(rep.prev as never), rep.prev!.from, rep.prev!.to]);
      expect(tr.byDay.map((d) => d.orders)).toEqual(rep.byDay.map((d) => d.orders));
      expect(tr.top.byCount.map((d) => [d.id, d.q])).toEqual(rep.top.map((d) => [d.id, d.q]));
    }
    /* "Днес" and "Вчера": the same weekday last week */
    expect((await core.owner.trends(s.owner, { period: "today" })).prev.orders).toBe(3);
    expect((await core.owner.trends(s.owner, { period: "yesterday" })).cmp).toEqual({ kind: "prev", from: "2026-11-08", to: "2026-11-08" });
    /* "Миналата година": 364 days back, the same weekday (not the same date) */
    const y = await core.owner.trends(s.owner, { period: "today", compare: "year" });
    expect(y.cmp).toEqual({ kind: "year", from: "2025-11-17", to: "2025-11-17" });
    expect(new Date(y.cmp.from).getUTCDay()).toBe(new Date("2026-11-16").getUTCDay());
    expect(y.prev.orders).toBe(2);
    expect((await core.owner.trends(s.owner, { period: "7", compare: "year" })).cmp).toEqual({ kind: "year", from: "2025-11-11", to: "2025-11-17" });
    /* the extras: peak hours, together, customers, CSV */
    const tr = await core.owner.trends(s.owner, { period: "30" });
    expect(tr.peak.cells.flat().reduce((a, b) => a + b, 0)).toBe(tr.totals.orders);
    expect(tr.customers).toEqual({ new: 0, returning: 1, total: 1 });
    expect(tr.csv[0][0]).toBe("Ден"); expect(tr.csv).toHaveLength(31);
    expect(tr.times.cookMin).toBeNull();
  });
});

/* the open questions of docs/OPEN-QUESTIONS.md, parsed the way core/owner.ts has them */
function parseMarkdown(md: string) {
  const clean = (x: string) => x.replace(/\*\*/g, "").replace(/`/g, "").replace(/^\(\d{1,2}\.\d{1,2}[^)]*\)\s*/, "").replace(/\s+/g, " ").trim();
  const split = (b: string) => { const r = /^(.*?)\s*\*\((.*)\)\*\s*$/.exec(b); return r ? { text: clean(r[1]), def: clean(r[2]).replace(/^по подразбиране:\s*/, "") } : { text: clean(b), def: "" }; };
  const out: { id: string; n: string; group: string; text: string; def: string }[] = []; let sec: string | null = null, group = "";
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) { sec = line.startsWith("## За собственика: решения") ? "r" : line.startsWith("## За собственика: модулите") ? "m" : line.startsWith("## За Поли") ? "p" : null; group = ""; continue; }
    if (sec === "m") { const g = /^\*\*(.+)\*\*\s*$/.exec(line.trim()); if (g) { group = g[1].replace(/\s*\(.*\)\s*$/, "").trim(); continue; } }
    if (sec === "r" || sec === "m") { const r = /^(\d+а?)\.\s+(.*)$/.exec(line.trim()); if (!r || r[2].includes("~~")) continue; out.push({ id: sec + r[1].replace("а", "a"), n: r[1], group: sec === "r" ? "Решения" : group, ...split(r[2]) }); }
    if (sec === "p" && /за собственика:/.test(line) && line.trim().startsWith("|")) { const c = line.split("|").map((x) => x.trim()).filter(Boolean); out.push({ id: "v1", n: "", group: "Решения", text: clean(c[0]), def: clean(c[1]) }); }
  }
  return out;
}

describe("'Решения': the questions and the answers", () => {
  it("the list is docs/OPEN-QUESTIONS.md word for word (the solved ones left out)", () => {
    const md = parseMarkdown(fs.readFileSync("docs/OPEN-QUESTIONS.md", "utf8"));
    const mine = OWNER_QUESTIONS.map((q) => ({ id: q.id, n: q.n, group: q.group, text: q.text, def: q.def }));
    expect([...mine].sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual([...md].sort((a, b) => (a.id < b.id ? -1 : 1)));
    expect(mine.find((q) => q.id === "r7" || q.id === "r10" || q.id === "m4")).toBeUndefined();
    expect(new Set(mine.map((q) => q.id)).size).toBe(mine.length);
  });
  it("only the owner answers; a new answer replaces with history; 'Отмени'; the filter 'Отговори на въпроси'", async () => {
    const { core, t } = mk(), { s } = await people(core);
    await expect(core.owner.answer(s.admin, "r8", { answer: "default" })).rejects.toMatchObject({ status: 403, message: "На въпросите от агенцията отговаря само собственикът." });
    expect((await core.owner.decisions(s.admin)).canAnswer).toBe(false);
    await expect(core.owner.answer(s.owner, "r4", { answer: "default" })).rejects.toMatchObject({ status: 422 }); /* a question about a fact */
    await expect(core.owner.answer(s.owner, "r8", { answer: "other", text: "  " })).rejects.toMatchObject({ status: 422, fields: { text: "Напиши отговора си." } });
    const a = await core.owner.answer(s.owner, "r8", { answer: "default" });
    expect(a).toMatchObject({ replaced: false, applied: false, question: { id: "r8", answer: { answer: "default", status: "new" } } });
    let notes = await core.notes.list({ kind: "answer" });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "answer", module: "owner", status: "new", q: { id: "r8", answer: "default" }, url: "/sobstvenik/reshenia/#q=r8" });
    expect(notes[0].text).toBe("Отговор на въпрос от агенцията (За собственика: решения, т. 8): „Блокиране на неявили се: след колко неявявания, как се отблокира?“ Съгласен с варианта по подразбиране: „след 2, отблокира управителят“.");
    expect(await core.notes.list({ kind: "note" })).toHaveLength(0);
    /* the agency applied it; a new answer goes back to review: the same note, the earlier one in its history */
    await core.notes.setStatus(notes[0].id, "approved", "admin");
    t.now += 60_000;
    const b = await core.owner.answer(s.owner, "r8", { answer: "other", text: "след 3, отблокира собственикът" });
    expect(b).toMatchObject({ replaced: true, applied: true, msg: "Агенцията вече го е приложила. Новият отговор отива пак за преглед." });
    notes = await core.notes.list({ kind: "answer" });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ status: "new", q: { answer: "other", other: "след 3, отблокира собственикът" } });
    expect(notes[0].answers).toHaveLength(1); expect(notes[0].answers![0]).toMatchObject({ status: "approved", q: { answer: "default" } });
    /* "Отмени": the earlier answer exactly; once more: no answer at all */
    const u = await core.owner.answerUndo(s.owner, "r8");
    expect(u.answer).toMatchObject({ answer: "default", status: "approved" });
    const d = await core.owner.decisions(s.owner);
    expect(d.counts).toEqual({ total: OWNER_QUESTIONS.length, open: OWNER_QUESTIONS.length - 1, answered: 1 });
    expect(d.next).toBe("r1");
    expect((await core.audit.list()).map((x) => x.action)).toEqual(expect.arrayContaining(["note.create", "note.update"]));
    await core.owner.answer(s.owner, "m1", { answer: "default" });
    expect((await core.owner.answerUndo(s.owner, "m1")).answer).toBeNull();
    expect(await core.notes.list({ kind: "answer" })).toHaveLength(1);
    /* the e-mail reports: both on by default (answer 35), the address [ЛИПСВА] */
    expect(d.mail).toMatchObject({ weekly: true, monthly: true, email: "[ЛИПСВА: имейл за отчетите]" });
    expect(await core.owner.setMail(s.owner, { weekly: false })).toMatchObject({ weekly: false, monthly: true });
    expect((await core.owner.today(s.owner)).waits.next).toMatchObject({ id: "r1" });
    expect((await core.owner.today(s.admin)).waits.next).toBeNull();
  });
});

describe("'Финанси'", () => {
  it("by payment, fuel, one delivery against the fee, the drivers' cash", async () => {
    const { core } = mk(), { s } = await people(core);
    const a = await order(core), b = await order(core, salad.id, 1, "delivery");
    const f = await core.owner.finance(s.owner, { period: "today" });
    expect(f.pay.online).toEqual({ cash: r2(a.total + b.total), card: 0, voucher: 0 });
    expect(f.revenue.cur).toBe(r2(a.total + b.total));
    expect(f.fuel.total).toEqual({ n: 0, litres: 0, sum: 0 });
    expect(f.delivery.fuelPer).toBeNull();
    expect(f.delivery.fees.some((z) => z.missing === "[ЛИПСВА: такса в €]")).toBe(true);
    expect(f.cash).toMatchObject({ rows: [], toHand: 0, handed: 0, handTo: "[ЛИПСВА: на кого се предават парите]" });
    expect(f.cost).toBe("[ЛИПСВА: себестойност на ястията]");
  });
});

describe("after the review of the owner's screens", () => {
  it("'На живо' says [ЛИПСВА] while the plan of the hall is the conditional one; a new restaurant has no history", async () => {
    const m = mk(), { core } = m, { s } = await people(core);
    await order(core);
    const t = await core.owner.today(s.owner);
    expect(t.live.tables.missing).toBe("[ЛИПСВА: истински маси и план]");
    expect((await core.owner.trends(s.owner, { period: "7" })).history).toBe(false);
    expect((await core.owner.finance(s.owner, { period: "7" })).history).toBe(false);
    await past(m, "2026-11-10", 1);
    expect((await core.owner.trends(s.owner, { period: "7" })).history).toBe(true);
    expect((await core.owner.finance(s.owner, { period: "7" })).history).toBe(true);
  });
  it("'Последните 7 дни': the day a week ago only up to this minute (as today), the days before it whole", async () => {
    const m = mk(), { core } = m, { s } = await people(core);
    await past(m, "2026-11-09", 2); await past(m, "2026-11-08", 1);
    /* the same Monday at 21:00 (after 19:42): not in the comparison of today */
    m.t.now = Date.UTC(2026, 10, 9, 19, 0); await order(m.at("21:00")); m.t.now = T0;
    const t = await core.owner.today(s.owner), d = t.last7.days;
    expect(d[6].weekAgo).toMatchObject({ date: "2026-11-09", orders: 2 });
    expect(d[5].weekAgo).toMatchObject({ date: "2026-11-08", orders: 1 });
    expect(t.last7.weekAgo.orders).toBe(3);
  });
  it("'Финанси': the km (null without shifts), the fuel of the comparison by day, the CSV by day with the payment and the comparison; the blocked count", async () => {
    const { core } = mk(), { s } = await people(core);
    await order(core);
    const f = await core.owner.finance(s.owner, { period: "7" });
    expect(f.km).toEqual({ cur: null, prev: null });
    expect(f.prevFuelDays).toHaveLength(7); expect(f.prevFuelDays[0]).toMatchObject({ date: f.cmp.from, sum: 0 });
    expect(f.delivery.prevFuelPer).toBeNull();
    expect(f.csv[0]).toEqual(["Ден", "Оборот €", "Поръчки", "В брой €", "Карта при получаване €", "Ваучер €", "На маса €", "Гориво €", "Литри", "Сравнение: ден", "Сравнение: оборот €", "Сравнение: гориво €"]);
    expect(f.csv).toHaveLength(8); expect(f.csv[7][0]).toBe("2026-11-16"); expect(f.csv[7][3]).toBe(f.csv[7][1]); expect(f.csv[7][9]).toBe("2026-11-09");
    expect((await core.owner.decisions(s.owner)).blocks.blocked).toBe(0);
  });
  it("'Изминати км': the finished legs and the closed shifts started in the period", async () => {
    const m = mk(), { core } = m, { s } = await people(core);
    const sh = (id: string, startedAt: string, extra: Record<string, unknown>) => m.repo.put("shifts", { id, role: "driver", user: "u", name: "Шофьор 1", car: "c2", float: null, nav: "google", parked: "", route: { pick: "fast", own: null }, driving: null, last: null, createdAt: startedAt, updatedAt: startedAt, legFrom: startedAt, startedAt, ...extra });
    await sh("a", "2026-11-15T08:00:00Z", { status: "closed", kmStart: 1100, kmEnd: 1180, legs: [{ car: "c1", kmStart: 500, kmEnd: 540, from: "2026-11-15T08:00:00Z", to: "2026-11-15T12:00:00Z" }] });
    await sh("b", "2026-11-16T08:00:00Z", { status: "open", kmStart: 2000, legs: [] });
    await sh("c", "2026-11-05T08:00:00Z", { status: "closed", kmStart: 100, kmEnd: 130, legs: [] });
    const f = await core.owner.finance(s.owner, { period: "7" });
    expect(f.km).toEqual({ cur: 120, prev: 30 });
  });
});
