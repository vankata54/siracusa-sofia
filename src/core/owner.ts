/* The owner's module ("Собственик": Днес · Тенденции · Финанси · Решения; design/pages-sobstvenik, README + _own.js +
   _history.js; decisions 16.11 and 17.11.2026). One core for the server and the demo; the rights are in every function:
   the owner and the main admin (by role); every other role 403, also with the sections.
   - The numbers come from THE history (core/history.ts), the same as "Отчети" in the admin: the same period gives the
     same numbers. "Днес: X € от N поръчки" is the admin dashboard's number (today's orders without the cancelled).
   - "Днес" compares with ONE base and ONE measure (decision 16.11): the turnover against "обичайното за <ден> до <час>"
     (the average of the same weekday in the last 4 weeks up to the same minute, answer 34); the alert at 20% or more
     either way (answer 33), only when the usual has at least 10 orders by that time; "Миналия <ден> по това време" is a
     sum on a second line, without a percent.
   - Money (every sum) only with "Финанси и гориво" (the owner and the main admin by default): without it the sums are
     null and `money` is false; "Финанси" itself answers 403 without it.
   - "Решения": the no-shows to block (core/reservations-admin.ts) and THE QUESTIONS of the agency (docs/OPEN-QUESTIONS.md,
     word for word, with the default; tests/unit/boss-core-owner.test.ts keeps the list in sync with the markdown). Only the
     owner answers ("Съгласен" / "Друго"); the main admin reads. An answer is a note kind "answer" in "Бележки" (one per
     question, a new answer replaces the old one with its history, status back to "new"); it changes nothing in the system
     until the main admin applies it. The e-mail reports: two switches stored here, the address [ЛИПСВА], the sending is
     stage E. Every action writes a line in the log. */
import { COL, emit, iso, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, type FeedbackNote, type NoteQuestion, type NoteStatus } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { audit } from "./audit.ts";
import { may, round2, invalid, RIGHTS_MSG } from "./rights.ts";
import * as H from "./history.ts";
import { FINISHED } from "./orders.ts";
import { hallLive } from "./floor-staff.ts";
import { notesWaiting, listNotes, saveAnswer, undoAnswer, ANSWER_APPLIED } from "./notes.ts";
import { blockList, blockDecide, type BlockRow } from "./reservations-admin.ts";
import { fuelReport, drivers as driversView, DRIVER_MISSING, type DriverShift, type FuelReport } from "./driver.ts";
import { liveZones } from "./zones.ts";
import { getSection } from "./site-data.ts";
import { HALL_MISSING } from "./hall.ts";
import type { TableSession } from "./floor.ts";
import { addDaysYmd } from "../lib/time.ts";
import { shiftDay } from "../lib/shift-day.ts";
import { fmt } from "../lib/format.ts";

/* ---------- rights, words ---------- */
export const OWNER_ROLES = ["owner", "admin"];
export const OWNER_MSG = {
  forbidden: "Модулът Собственик е за собственика и главния админ.",
  answerOnly: "На въпросите от агенцията отговаря само собственикът.",
  question: "Няма такъв въпрос.",
  text: "Напиши отговора си.",
  answer: "Избери „Съгласен“ или „Друго“.",
  noDefault: "Тук няма вариант по подразбиране: напиши отговора си.",
  applied: "Агенцията вече го е приложила. Новият отговор отива пак за преглед.",
  saved: "Отговорът е записан. Агенцията го прилага; нищо не се сменя, докато тя не го одобри.",
  replaced: "Отговорът е сменен. Агенцията го прилага; нищо не се сменя, докато тя не го одобри.",
  finance: "Финансите са само с раздела „Финанси и гориво“.",
};
export const OWNER_MISSING = {
  email: "[ЛИПСВА: имейл за отчетите]",
  cost: "[ЛИПСВА: себестойност на ястията]",
  views: "[ЛИПСВА: анализ на разглежданията]",
  fee: "[ЛИПСВА: такса в €]",
  driverCost: "[ЛИПСВА: разходи за шофьор и кола]",
  google: "[ЛИПСВА: достъп до Google Business Profile API]",
  rating: "[ЛИПСВА: рейтинг и линк за отзив]",
} as const;
/** the alert on "Днес": 20% either way (answer 33), only with at least 10 usual orders by that time */
export const ALERT_PCT = 20, ALERT_MIN_ORDERS = 10;
/** "Отмени" after an answer: the screen shows it 6 s, the core accepts it this long */
export const ANSWER_UNDO_MS = 15_000;

/** 401 without a session; 403 for every role but the owner and the main admin */
export function needOwner(s: StaffCtx | null | undefined): StaffCtx {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (!OWNER_ROLES.includes(s.user.role)) throw new CoreError("forbidden", OWNER_MSG.forbidden, 403);
  return s;
}
/** a part of a screen that needs a section the role may lack (the floor, the drivers, the no-shows): without it the part
    is left out (`hidden`), never the whole screen (the module is by role) */
async function part<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (e) { if (e instanceof CoreError && e.status === 403) return null; throw e; }
}
/** sums only with "Финанси и гориво" */
export const ownerMoney = (s: StaffCtx): boolean => may(s, "finance");
const M = (money: boolean) => (v: number): number | null => (money ? round2(v) : null);

/* ---------- "Днес" ---------- */
export interface OwnerToday {
  date: string; now: string; weekday: string; money: boolean; sample: boolean;
  /** "Днес: X € от N поръчки": exactly the admin dashboard's number (today's orders without the cancelled) */
  sales: { sum: number | null; n: number };
  /** "обичайното за понеделник до 19:42": the average of the same weekday in the last 4 weeks up to this minute */
  usual: { sum: number | null; orders: number; days: string[]; withData: number; label: string };
  /** the one comparison: the turnover against the usual (orders without money); null when the usual is 0 */
  vsUsual: { pct: number | null; measure: "revenue" | "orders" };
  /** at 20% or more either way, only with at least 10 usual orders by now */
  alert: { pct: number; dir: "up" | "down"; text: string; sub: string } | null;
  /** "Миналия понеделник по това време: X €" (a sum on a second line, no percent) */
  lastWeek: { date: string; sum: number | null; orders: number; label: string };
  avg: { value: number | null; usual: number | null };
  cancelled: number;
  /** the turnover from 10:00 cumulative, every 15 min, against the usual (money only; null without it) */
  byHour: { step: number; labels: string[]; cur: (number | null)[]; usual: number[]; nowIndex: number } | null;
  live: { inWork: number; tables: { busy: number; total: number; /** [ЛИПСВА] while the plan of the hall is the conditional one */ missing: string; /** the role lacks the floor's sections */ hidden?: boolean }; reservations: { n: number; people: number; ahead: number; aheadPeople: number } };
  byChannel: { key: H.Ch5; label: string; orders: number; revenue: number | null }[];
  /** the last 7 days (today included) and the 7 before them ("7 дни по-рано"; the day a week ago only up to this minute,
      as today: never a whole day against a part of one) */
  last7: { days: { date: string; short: string; orders: number; revenue: number | null; weekAgo: { date: string; orders: number; revenue: number | null } }[]; total: { orders: number; revenue: number | null }; weekAgo: { orders: number; revenue: number | null } };
  /** "Чака те" for the owner: no-shows to decide, the next question (the owner only), the notes */
  waits: OwnerWaits;
}
export interface OwnerWaits { blocks: number; next: { id: string; text: string } | null; unanswered: number; notes: Awaited<ReturnType<typeof notesWaiting>>; n: number }

async function waitsOf(ctx: Ctx, s: StaffCtx, notes?: FeedbackNote[]): Promise<OwnerWaits> {
  const bl = (await ctx.repo.list<{ id: string; status: string }>(COL.blocks)).filter((b) => b.status === "pending").length;
  const answered = answersById(notes || (await listNotes(ctx, { kind: "answer" })));
  const open = OWNER_QUESTIONS.filter((q) => !answered.has(q.id)), canAnswer = s.user.role === "owner";
  const nw = await notesWaiting(ctx, s), next = canAnswer && open[0] ? { id: open[0].id, text: open[0].text } : null;
  return { blocks: bl, next, unanswered: canAnswer ? open.length : 0, notes: nw, n: bl + (next ? 1 : 0) + nw.n };
}

export async function ownerToday(ctx: Ctx, s: StaffCtx): Promise<OwnerToday> {
  needOwner(s);
  const money = ownerMoney(s), m = M(money), h = await H.loadHistory(ctx), day = h.today, cut = h.now, now = H.hm(cut);
  const lw = addDaysYmd(day, -7);
  /* one read: the 14 days of "Последните 7 дни" and the 4 weeks of "обичайното" come from the cache by day */
  const [cur, u, lws, d7s, w7s] = await Promise.all([H.slice(h, day, day), H.usual(h, day, cut), H.slice(h, lw, lw, cut), H.slice(h, addDaysYmd(day, -6), day), H.slice(h, addDaysYmd(day, -13), addDaysYmd(day, -8))]);
  const t = H.totals(cur), lwt = H.totals(lws);
  const measure = money ? "revenue" : "orders", base = money ? u.revenue : u.orders, val = money ? t.revenue : t.orders;
  const p = H.pct(val, base), wd = H.dayName(day), label = "обичайното за " + wd + " до " + now;
  const alert = p != null && Math.abs(p) >= ALERT_PCT && u.orders >= ALERT_MIN_ORDERS
    ? { pct: Math.abs(p), dir: (p > 0 ? "up" : "down") as "up" | "down", text: (money ? "Оборотът днес е с " : "Поръчките днес са с ") + Math.abs(p) + "% " + (p > 0 ? "над " : "под ") + label,
      sub: money ? "Днес " + fmt(t.revenue) + ", обичайно " + fmt(u.revenue) : "Днес " + t.orders + ", обичайно " + u.orders } : null;
  /* the line of the turnover: every 15 min from 10:00 to 23:00 */
  let byHour: OwnerToday["byHour"] = null;
  if (money) {
    const labels: string[] = []; for (let x = 600; x <= 1380; x += 15) labels.push(H.hm(x));
    const days = await Promise.all(u.days.map(async (d) => H.cumulative(await H.slice(h, d, d)) as number[]));
    byHour = { step: 15, labels, cur: H.cumulative(cur, 15, cut), usual: labels.map((_, i) => round2(days.reduce((a, d) => a + d[i], 0) / days.length)), nowIndex: Math.max(-1, Math.min(labels.length - 1, Math.ceil((cut - 600) / 15))) };
  }
  /* live: "В работа" (the admin's tab), the tables, the reservations of the evening */
  const work = H.workOf(cur);
  const hall = await part(hallLive(ctx, s));
  const rs = cur.res.filter((r) => r.status === "new" || r.status === "confirmed" || r.status === "seated");
  const ahead = rs.filter((r) => r.status !== "seated" && +r.time.slice(0, 2) * 60 + +r.time.slice(3) >= cut);
  /* the last 7 days and the 7 before */
  const d7 = H.byDay(d7s), w7 = [...H.byDay(w7s), ...H.byDay(lws)];
  const plan = await getSection(ctx, "hall");
  const sumD = (l: H.DayRow[]) => ({ orders: l.reduce((a, d) => a + d.orders, 0), revenue: m(l.reduce((a, d) => a + d.revenue, 0)) });
  return {
    date: day, now, weekday: wd, money, sample: H.isSampleSlice(cur),
    sales: { sum: m(t.revenue), n: t.orders },
    usual: { sum: m(u.revenue), orders: u.orders, days: u.days, withData: u.withData, label },
    vsUsual: { pct: p, measure }, alert,
    lastWeek: { date: lw, sum: m(lwt.revenue), orders: lwt.orders, label: H.lastDayName(day) + " по това време" },
    avg: { value: money ? t.avg : null, usual: money ? (u.orders ? round2(u.revenue / u.orders) : 0) : null },
    cancelled: t.cancelled, byHour,
    live: { inWork: work, tables: hall ? { busy: hall.tables.filter((x) => x.state !== "free").length, total: hall.tables.length, missing: plan.version ? "" : HALL_MISSING } : { busy: 0, total: 0, missing: "", hidden: true }, reservations: { n: rs.length, people: rs.reduce((a, r) => a + r.people, 0), ahead: ahead.length, aheadPeople: ahead.reduce((a, r) => a + r.people, 0) } },
    byChannel: H.byChannel5(cur).map((c) => ({ ...c, revenue: m(c.revenue) })),
    last7: { days: d7.map((d, i) => ({ date: d.date, short: H.dayShort(d.date), orders: d.orders, revenue: m(d.revenue), weekAgo: { date: w7[i].date, orders: w7[i].orders, revenue: m(w7[i].revenue) } })), total: sumD(d7), weekAgo: sumD(w7) },
    waits: await waitsOf(ctx, s),
  };
}

/* ---------- "Тенденции" ---------- */
export interface TrendQuery { period?: H.Period; from?: string; to?: string; compare?: H.Compare; /** a dish card ("#dish=<id>") */ dish?: string }
type TotalsM = Omit<H.Totals, "revenue" | "avg"> & { revenue: number | null; avg: number | null };
export interface OwnerTrends {
  period: H.Period; from: string; to: string; days: number; until: string | null; money: boolean; sample: boolean;
  /** is there any order before today (a new restaurant: "Още събираме история") */
  history: boolean;
  /** what it is compared with: "prev" (for "Днес" / "Вчера" the same weekday last week) or "year" (364 days back) */
  cmp: { kind: H.Compare; from: string; to: string };
  totals: TotalsM; prev: TotalsM;
  /** by day (the comparison aligned by the index); for one day: by hour */
  byDay: { date: string; orders: number; revenue: number | null; reservations: number; noShows: number; cancelled: number; cmp: { date: string; orders: number; revenue: number | null } }[];
  byHour: { hour: number; orders: number; revenue: number | null; cmp: { orders: number; revenue: number | null } }[];
  byChannel: { channel: H.ChKey; label: string; orders: number; revenue: number | null; share: number; cmp: { orders: number; revenue: number | null } }[];
  peak: H.Peak;
  top: { byCount: { id: string; name: string; q: number; revenue: number | null }[]; byRevenue: { id: string; name: string; q: number; revenue: number | null }[] };
  together: H.Pair[];
  customers: { new: number; returning: number; total: number };
  times: H.Times;
  offers: { lunch: { orders: number; disc: number | null; revenue: number | null }; code: { orders: number; disc: number | null; revenue: number | null } };
  dish: { id: string; name: string; q: number; revenue: number | null; byDay: { date: string; q: number }[] } | null;
  /** "Изтегли CSV": the header first, "Примерни данни" the last line when there are example orders */
  csv: string[][];
  missing: { views: string; cost: string };
}
const totM = (t: H.Totals, money: boolean): TotalsM => ({ ...t, revenue: money ? t.revenue : null, avg: money ? t.avg : null });
const csvNum = (v: number) => v.toFixed(2).replace(".", ",");
async function ranges(h: H.History, q: TrendQuery) {
  const period = H.asPeriod(q && q.period), { from, to } = H.periodRange(h.today, period, q && q.from, q && q.to), kind: H.Compare = q && q.compare === "year" ? "year" : "prev";
  const c = H.compareRange(period, from, to, kind), onlyToday = from === h.today && to === h.today;
  const [cur, prev] = await Promise.all([H.slice(h, from, to), H.slice(h, c.from, c.to, onlyToday ? h.now : null)]);
  return { period, from, to, kind, c, onlyToday, cur, prev };
}

export async function ownerTrends(ctx: Ctx, s: StaffCtx, q: TrendQuery = {}): Promise<OwnerTrends> {
  needOwner(s);
  const money = ownerMoney(s), m = M(money), h = await H.loadHistory(ctx), R = await ranges(h, q);
  /* the hours of both periods (10-22 and every hour with orders), so that the comparison is aligned */
  const hs = H.hoursOf(R.cur, R.prev);
  const cd = H.byDay(R.cur), pd = H.byDay(R.prev), ch = H.byChannel(R.cur), pch = H.byChannel(R.prev), hr = H.byHour(R.cur, hs), phr = H.byHour(R.prev, hs);
  const nOrd = ch.reduce((a, c) => a + c.orders, 0), off = H.offers(R.cur);
  const dishRow = (d: H.DishRow) => ({ id: d.id, name: d.name, q: d.q, revenue: m(d.revenue) });
  let dish: OwnerTrends["dish"] = null;
  if (q && q.dish) {
    const all = H.dishes(R.cur), x = all.find((d) => d.id === q.dish);
    const byDay = H.dishByDay(R.cur, String(q.dish));
    dish = { id: String(q.dish), name: x ? x.name : String(q.dish), q: x ? x.q : 0, revenue: m(x ? x.revenue : 0), byDay };
  }
  const head = money ? ["Ден", "Поръчки", "Отказани", "Оборот €", "Среден бон €", "Резервации", "Неявили се", "Сравнение: ден", "Сравнение: поръчки", "Сравнение: оборот €"] : ["Ден", "Поръчки", "Отказани", "Резервации", "Неявили се", "Сравнение: ден", "Сравнение: поръчки"];
  const csv = [head, ...cd.map((d, i) => { const p = pd[i];
    return money ? [d.date, String(d.orders), String(d.cancelled), csvNum(d.revenue), csvNum(d.orders ? d.revenue / d.orders : 0), String(d.reservations), String(d.noShows), p ? p.date : "", p ? String(p.orders) : "", p ? csvNum(p.revenue) : ""]
      : [d.date, String(d.orders), String(d.cancelled), String(d.reservations), String(d.noShows), p ? p.date : "", p ? String(p.orders) : ""]; })];
  const sample = H.isSampleSlice(R.cur) || H.isSampleSlice(R.prev);
  if (sample) csv.push(["Примерни данни"]);
  return {
    period: R.period, from: R.from, to: R.to, days: H.span(R.from, R.to), until: R.onlyToday ? H.hm(h.now) : null, money, sample, history: await H.hasBefore(ctx, h.today),
    cmp: { kind: R.kind, from: R.c.from, to: R.c.to },
    totals: totM(H.totals(R.cur), money), prev: totM(H.totals(R.prev), money),
    byDay: cd.map((d, i) => ({ date: d.date, orders: d.orders, revenue: m(d.revenue), reservations: d.reservations, noShows: d.noShows, cancelled: d.cancelled, cmp: { date: pd[i] ? pd[i].date : "", orders: pd[i] ? pd[i].orders : 0, revenue: m(pd[i] ? pd[i].revenue : 0) } })),
    byHour: hr.map((x, i) => ({ hour: x.hour, orders: x.orders, revenue: m(x.revenue), cmp: { orders: phr[i].orders, revenue: m(phr[i].revenue) } })),
    byChannel: ch.map((c, i) => ({ channel: c.channel, label: c.label, orders: c.orders, revenue: m(c.revenue), share: money ? c.share : nOrd ? Math.round((c.orders / nOrd) * 100) : 0, cmp: { orders: pch[i].orders, revenue: m(pch[i].revenue) } })),
    peak: H.peak(R.cur),
    top: { byCount: H.dishes(R.cur, "q").slice(0, 8).map(dishRow), byRevenue: money ? H.dishes(R.cur, "revenue").slice(0, 8).map(dishRow) : [] },
    together: H.together(R.cur), customers: await H.customers(h, R.cur), times: await H.times(ctx, R.cur),
    offers: { lunch: { orders: off.lunch.orders, disc: m(off.lunch.disc), revenue: m(off.lunch.revenue) }, code: { orders: off.code.orders, disc: m(off.code.disc), revenue: m(off.code.revenue) } },
    dish, csv, missing: { views: OWNER_MISSING.views, cost: OWNER_MISSING.cost },
  };
}

/* ---------- "Финанси и гориво" ---------- */
export interface PayBlock { online: { cash: number; card: number; voucher: number }; table: { cash: number; card: number; unpaid: number }; total: number }
export interface OwnerFinance {
  period: H.Period; from: string; to: string; days: number; until: string | null; sample: boolean;
  /** is there any order before today (a new restaurant: "Още събираме история") */
  history: boolean;
  cmp: { kind: H.Compare; from: string; to: string };
  revenue: { cur: number; prev: number };
  /** the km driven: the finished legs of the drivers' shifts started in the period (null without any) */
  km: { cur: number | null; prev: number | null };
  /** by payment: online (site, phone, office) "В брой" / "Карта при получаване" / "Ваучер"; at the tables cash / card from the
      waiter's payments (unpaid: the tables' orders not paid yet) */
  pay: PayBlock; prevPay: PayBlock;
  /** fuel by day, driver and car (core/driver.ts fuelReport) for the period; prev: the total of the comparison */
  fuel: Pick<FuelReport, "total" | "byDay" | "byDriver" | "byCar">; prevFuel: FuelReport["total"];
  /** the fuel of the comparison by day (aligned by the index with the days of the period) */
  prevFuelDays: { date: string; n: number; litres: number; sum: number }[];
  /** one delivery: the fuel of the period per delivered order against the fee of each quarter ([ЛИПСВА] where unknown) */
  delivery: { delivered: number; fuelPer: number | null; prevFuelPer: number | null; fees: { zone: string; free: boolean; fee: number | null; missing: string | null }[]; driverCost: string };
  /** the drivers' cash today: still to hand over (open shifts) and handed over (closed today) */
  cash: { date: string; rows: { user: string; name: string; open: boolean; toHand: number; handed: number | null }[]; toHand: number; handed: number; handTo: string; /** the role lacks "Шофьор" / "Персонал": the drivers on shift are not shown */ hidden?: boolean };
  cost: string; csv: string[][];
}
/** the km of the drivers' shifts started in [from, to]: the finished legs and the last leg of a closed shift */
function kmOf(shifts: DriverShift[], from: string, to: string): number | null {
  let km = 0, any = false;
  for (const x of shifts) {
    const d = shiftDay(new Date(x.startedAt)); if (d < from || d > to) continue;
    for (const l of x.legs || []) { km += Math.max(0, l.kmEnd - l.kmStart); any = true; }
    if (x.status === "closed" && typeof x.kmEnd === "number") { km += Math.max(0, x.kmEnd - x.kmStart); any = true; }
  }
  return any ? km : null;
}
function payOf(sl: Pick<H.Slice, "days" | "from" | "to">, sessions: TableSession[]): PayBlock {
  const r = (n: number) => round2(n), p = H.payOfDays(sl), o = { cash: p.cash, card: p.card, voucher: p.voucher }, t = { cash: 0, card: 0, unpaid: 0 };
  const tableRev = p.table;
  for (const s of sessions) for (const p of s.payments || []) { const d = shiftDay(new Date(p.at)); if (d >= sl.from && d <= sl.to) t[p.how === "card" ? "card" : "cash"] += p.sum; }
  t.unpaid = Math.max(0, tableRev - t.cash - t.card);
  return { online: { cash: r(o.cash), card: r(o.card), voucher: r(o.voucher) }, table: { cash: r(t.cash), card: r(t.card), unpaid: r(t.unpaid) }, total: r(o.cash + o.card + o.voucher + tableRev) };
}
export async function ownerFinance(ctx: Ctx, s: StaffCtx, q: TrendQuery = {}): Promise<OwnerFinance> {
  needOwner(s);
  if (!ownerMoney(s)) throw new CoreError("forbidden", OWNER_MSG.finance, 403);
  const h = await H.loadHistory(ctx), R = await ranges(h, q);
  const [sessions, prevSessions] = (await Promise.all([H.sessionsOf(ctx, R.from, R.to), H.sessionsOf(ctx, R.c.from, R.c.to)])) as TableSession[][];
  const fr = await fuelReport(ctx, s, { from: R.from, to: R.to }), pf = await fuelReport(ctx, s, { from: R.c.from, to: R.c.to });
  const delivered = H.deliveredOf(R.cur), prevDelivered = H.deliveredOf(R.prev);
  const zones = await liveZones(ctx);
  /* the cash of the drivers today */
  const day = h.today, dv = await part(driversView(ctx, s)), staff = new Map((await ctx.repo.list<{ id: string; username: string; name: string }>(COL.staff)).map((u) => [u.username, u.name]));
  const shifts = (await ctx.repo.list<DriverShift>(COL.shifts)).filter((x) => x.role === "driver");
  const closed = shifts.filter((x) => x.status === "closed" && !!x.endedAt && shiftDay(new Date(x.endedAt)) === day && !!x.closing);
  const rows = [...(dv ? dv.drivers : []).map((d) => ({ user: d.user, name: d.name, open: true, toHand: round2(d.cash), handed: null as number | null })),
    ...closed.map((x) => ({ user: x.user, name: staff.get(x.user) || x.name, open: false, toHand: 0, handed: round2(x.closing!.handover) }))];
  const pay = payOf(R.cur, sessions), prevPay = payOf(R.prev, prevSessions);
  const byDay = H.byDay(R.cur), prevDays = H.byDay(R.prev), fuelDay = new Map(fr.byDay.map((d) => [d.date, d])), prevFuelDay = new Map(pf.byDay.map((d) => [d.date, d]));
  const fuelOf = (m: typeof fuelDay, date: string) => m.get(date) || { date, n: 0, litres: 0, sum: 0 };
  const prevFuelDays = prevDays.map((d) => fuelOf(prevFuelDay, d.date));
  /* "Изтегли CSV": by day the revenue, the payment, the fuel and the comparison (the same columns as "Тенденции") */
  const lit = (v: number) => String(Math.round(v * 10) / 10).replace(".", ",");
  const csv = [["Ден", "Оборот €", "Поръчки", "В брой €", "Карта при получаване €", "Ваучер €", "На маса €", "Гориво €", "Литри", "Сравнение: ден", "Сравнение: оборот €", "Сравнение: гориво €"],
    ...byDay.map((d, i) => {
      const p = payOf({ from: d.date, to: d.date, days: R.cur.days.filter((x) => x.date === d.date) }, sessions), f = fuelOf(fuelDay, d.date), c = prevDays[i], cf = prevFuelDays[i];
      return [d.date, csvNum(d.revenue), String(d.orders), csvNum(p.online.cash), csvNum(p.online.card), csvNum(p.online.voucher), csvNum(p.table.cash + p.table.card + p.table.unpaid), csvNum(f.sum), lit(f.litres),
        c ? c.date : "", c ? csvNum(c.revenue) : "", cf ? csvNum(cf.sum) : ""];
    })];
  const sample = H.isSampleSlice(R.cur);
  if (sample) csv.push(["Примерни данни"]);
  return {
    period: R.period, from: R.from, to: R.to, days: H.span(R.from, R.to), until: R.onlyToday ? H.hm(h.now) : null, sample, history: await H.hasBefore(ctx, h.today),
    cmp: { kind: R.kind, from: R.c.from, to: R.c.to },
    revenue: { cur: H.totals(R.cur).revenue, prev: H.totals(R.prev).revenue },
    km: { cur: kmOf(shifts, R.from, R.to), prev: kmOf(shifts, R.c.from, R.c.to) },
    pay, prevPay,
    fuel: { total: fr.total, byDay: fr.byDay, byDriver: fr.byDriver, byCar: fr.byCar }, prevFuel: pf.total, prevFuelDays,
    delivery: { delivered, fuelPer: delivered && fr.total.sum ? round2(fr.total.sum / delivered) : null, prevFuelPer: prevDelivered && pf.total.sum ? round2(pf.total.sum / prevDelivered) : null,
      fees: zones.map((z) => ({ zone: z.n, free: z.free, fee: z.free ? 0 : z.fee, missing: !z.free && z.fee == null ? OWNER_MISSING.fee : null })), driverCost: OWNER_MISSING.driverCost },
    cash: { date: day, rows, toHand: round2(rows.reduce((a, x) => a + x.toHand, 0)), handed: round2(rows.reduce((a, x) => a + (x.handed || 0), 0)), handTo: DRIVER_MISSING.handTo, ...(dv ? {} : { hidden: true }) },
    cost: OWNER_MISSING.cost, csv,
  };
}

/* ---------- "Решения": the questions of the agency (docs/OPEN-QUESTIONS.md, word for word) ----------
   [id, n, group, text, default]: "r…" = "За собственика: решения" (+ "v1": the vouchers' row of the table "За Поли" that is
   for the owner), "m…" = "За собственика: модулите" (the group is the bold subheading). The solved ones (~~…~~) are not
   here. A unit test parses the markdown and compares this list with it (a change there fails the test until it is here). */
const Q: [string, string, string, string, string][] = [
  ["r1","1","","Онлайн плащания (виртуален POS) или само на място?","само на място"],
  ["r2","2","","Депозит за резервации и празници?","няма"],
  ["r3","3","","Калкулатор на празник: показва ли ориентировъчна цена?","превключвател в админа"],
  ["r4","4","","Каса и СУПТО: коя система ползвате и може ли тя сама да получава поръчките от сайта?","поръчките се печатат / виждат в кухнята, касовата бележка се издава на място"],
  ["r5","5","","„Двете бази“: каква е била идеята?","не се прави"],
  ["r6","6","","Отзиви в Google: приема ли логиката линк към всички, отстъпка само за вътрешната оценка?","да"],
  ["r8","8","","Блокиране на неявили се: след колко неявявания, как се отблокира?","след 2, отблокира управителят"],
  ["r9","9","","Смяна на съставка: безплатно, по-скъпата цена или само някои?","групата „Смени“ е скрита"],
  ["r11","11","","Резервации от Google (Reserve with Google) или само собствената система?","само собствената"],
  ["r12","12","","Размери на отстъпките: регистрация, ранна резервация, рожден ден.","-10%, -5%, -10% или торта"],
  ["r12a","12а","","Бонусът -10% при регистрация: има ли срок на валидност?","без срок, еднократен, за първата поръчка след регистрацията"],
  ["r13","13","","Колко дни по-рано е „ранна резервация“ за празник?","[ЛИПСВА]"],
  ["r14","14","","-5% важи ли и за тематични вечери (Гръцка вечер)?","не, само празник"],
  ["r15","15","","Печати за лоялност: за какво се дава печат и каква е наградата при 10?","[ЛИПСВА]"],
  ["r16","16","","Ваучери: валидност; комбинират ли се отстъпките?","не се комбинират; валидност [ЛИПСВА]"],
  ["r17","17","","Обща поръчка за офиса: ръчно изпращане след крайния час? Колегите без профил? Отделно плащане на шофьора?","автоматично в крайния час; без профил е позволено; едно плащане"],
  ["r18","18","","Часове за резервации и правило за маса (колко души на маса).","11:00-21:30 през 30 мин; масата е за броя места"],
  ["r17a","17а","","Горна граница на една онлайн поръчка (над нея: „обадете се“) и на обща поръчка за офиса.","60 порции и 500 € на поръчка; офис: до 10 порции на човек, до 60 души, до 500 €; агенцията ги сменя при нужда"],
  ["r18a","18а","","Колко време се пази масата при резервация (кога се освобождава за следващи гости)?","2 часа; настройка в админа"],
  ["r19","19","","Резервен интернет за кухнята и персонала.","екран „Няма връзка“ с указания"],
  ["r20","20","","Маршрутите на шофьора: с трафика в реално време (платена услуга на Google) или безплатни, без трафика?","безплатни, без трафика"],
  ["r21","21","","Кога кухнята е „натоварена“ и с колко минути расте времето.","ръчен превключвател в кухнята, +20 мин: „около 35 мин“ → „около 55 мин“; минутите се сменят от админа"],
  ["r22","22","","Пекат ли се пиците във фурната Bertha?","текстът не го твърди"],
  ["r23","23","","„Изчерпано днес“: да се нулира ли само на следващия ден, или ястието остава изчерпано, докато някой не го върне ръчно?","нулира се само в полунощ по София; ключът е за днешния ден; поръчка „за утре“ не се засяга"],
  ["v1","","","Ваучерите (подаръчните карти на ресторанта), за собственика: колко време са валидни? Онлайн не се приемат.","Предложение: 12 месеца; дотогава валидност [ЛИПСВА]"],
  ["m1","1","QR маса и сервитьор","Повикване: колко минути между две еднакви повиквания и след колко минути без отговор отива при управителя? Едно и също за всички причини или по-кратко за „Сметка“?","3 мин интервал; цвят след 2 и 5 мин, при управителя след 5 мин, еднакво за всички"],
  ["m2","2","QR маса и сервитьор","Втори праг за поето, но неотбелязано „Обслужено“ повикване?","няма"],
  ["m3","3","QR маса и сервитьор","Може ли сервитьор да поеме повикване от чужда маса?","да, ако никой не го е поел"],
  ["m5","5","QR маса и сервитьор","Може ли всеки на масата да променя и маха ястията на другите в общата количка?","да, вижда се на всички телефони"],
  ["m6","6","QR маса и сервитьор","Поръчва ли се обедното меню от масата до 15:00?","[ЛИПСВА] в менюто на масата"],
  ["m7","7","QR маса и сервитьор","Стековете Black Angus („за 100 гр.“): кой въвежда точния грамаж след рязане, кухнята или сервитьорът, и как става при поръчка от масата?","сервитьорът, лист „Грамаж“ 300-600 гр. или друг"],
  ["m8","8","QR маса и сервитьор","Сметка „По ястия“: нужна ли е, или стига „По гости“? Една касова бележка с отделни плащания или бележка за всеки?","и трите начина; бележка за всяко плащане"],
  ["m9","9","QR маса и сервитьор","Плащане с ваучер на масата?","няма"],
  ["m10","10","QR маса и сервитьор","Кодът -10% от оценката за гост без профил: само на телефона или срещу телефонен номер („веднъж на номер“)?","само на телефона"],
  ["m11","11","QR маса и сервитьор","Причина при отказ на QR поръчка: задължителна ли е?","да"],
  ["m12","12","QR маса и сервитьор","„Отивам“ и за готово ястие, за да не тръгнат двама?","само „Сервирах“"],
  ["m13","13","QR маса и сервитьор","Нощна тема за персонала от 18:00 като стандарт?","изборът е на телефона; „По часа“ е тъмна 18:00-07:00"],
  ["m14","14","QR маса и сервитьор","Кои часовници поддържаме: Wear OS, Apple Watch или само известия от телефона?","само известия от телефона"],
  ["m15","15","Кухня","Кой може да включва „Натоварено“: всяка секция или само главният готвач? Напомняне след 60 мин?","всяка секция, с напомняне"],
  ["m16","16","Кухня","Срок за всяко ястие или за канал? Колко минути преди срока е „наближава“?","20 мин за канал, „наближава“ 5 мин преди"],
  ["m17","17","Кухня","Поръчка за час: влиза в кухнята 20 мин преди часа или според ястието?","20 мин преди"],
  ["m18","18","Кухня","Изчерпаното днес: кога се връща в менюто, в полунощ или утре в 10:00?","в полунощ по София, както в т. 23 от „Решения за ресторанта“"],
  ["m19","19","Кухня","При изчерпване в приета поръчка за доставка или вземане: кой се обажда на клиента?","управителят"],
  ["m20","20","Кухня","Поръчка от няколко секции: сервитьорът се известява за всяка готова секция, а шофьорът и клиентът, когато всичко е готово?","да"],
  ["m21","21","Кухня","Печат на бон в кухнята при срив или само екран?","само екран"],
  ["m22","22","Шофьор","Кара ли всеки шофьор една и съща кола?","колата се избира при вход, смяна в смяната е позволена"],
  ["m23","23","Шофьор","Колко чака шофьорът при „Няма никой“ и какво става с храната (връща се, плаща ли клиентът)?","[ЛИПСВА], решава ресторантът по телефона"],
  ["m24","24","Шофьор","Има ли терминал за карти в колата?","„Карта при получаване“ е [ЛИПСВА: терминал]"],
  ["m25","25","Шофьор","Парите се предават на управителя или на касата; в края на смяната или след всеки курс?","в края на смяната, на кого е [ЛИПСВА]"],
  ["m26","26","Шофьор","Може ли горивото да се плаща в брой от събраните пари?","да, вади се от „За предаване“"],
  ["m27","27","Шофьор","Може ли шофьорът сам да смени реда на адресите?","да, „Моят ред“"],
  ["m28","28","Шофьор","Екран „Колата е в движение“ (по GPS скоростта)?","да"],
  ["m29","29","Шофьор","Снимката на касовата бележка при зареждане задължителна ли е?","по желание, с „ще дам бележката на управителя“"],
  ["m30","30","Шофьор","Поръчка, която шофьорът е върнал („Няма никой“, „Отказ“): кара ли се пак с друг курс и плаща ли клиентът?","остава за решение на ресторанта по телефона, отказва се от „Поръчки“ в админа"],
  ["m32","32","Кухня","Кога тръгва шофьорът спрямо „Готово“?","часът на шофьора в билета е срокът в кухнята"],
  ["m33","33","Кухня","При „Натоварено“: +20 мин важат ли и за вземане „възможно най-скоро“?","да, едно правило за сайта и кухнята"],
];
export interface OwnerQuestion { id: string; n: string; sec: "r" | "m"; group: string; text: string; def: string;
  /** "Съгласен" is offered: a real default (not only [ЛИПСВА]) and not a question about a fact */ hasDefault: boolean }
/** questions about a fact or still "остава за решение": only "Твоят отговор" (the approved prototype, decision 16.11) */
export const FACT_QUESTIONS = ["r4", "r5", "r22", "m6", "m18", "m24"];
export const OWNER_GROUPS: [string, string][] = [["r", "Решения за ресторанта"], ["m", "Модулите: QR маса и сервитьор, кухня, шофьор"]];
export const OWNER_QUESTIONS: OwnerQuestion[] = Q.map(([id, n, group, text, def]) => ({
  id, n, sec: id.startsWith("m") ? "m" : "r", group: group || "Решения", text, def,
  hasDefault: !!def && !FACT_QUESTIONS.includes(id) && !/^\[ЛИПСВА[^\]]*\]$/.test(def.trim()),
}));

export interface QuestionView extends OwnerQuestion {
  answer: { answer: "default" | "other"; other: string; at: string; status: NoteStatus; noteId: string; applied: boolean; changed: number } | null;
}
function answersById(notes: FeedbackNote[]): Map<string, FeedbackNote> {
  const m = new Map<string, FeedbackNote>();
  for (const n of [...notes].sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1))) if (n.kind === "answer" && n.q && n.q.id) m.set(n.q.id, n);
  return m;
}
function qView(q: OwnerQuestion, n: FeedbackNote | undefined): QuestionView {
  return { ...q, answer: n && n.q ? { answer: n.q.answer, other: n.q.other, at: n.updatedAt, status: n.status, noteId: n.id, applied: ANSWER_APPLIED.includes(n.status), changed: (n.answers || []).length } : null };
}
export interface MailSettings { weekly: boolean; monthly: boolean; email: string; format: "PDF"; when: { weekly: string; monthly: string }; sending: "soon"; at: string | null; by: string | null }
interface MailDoc { id: "owner:mail"; weekly: boolean; monthly: boolean; at: string; by: string }
async function mailOf(ctx: Ctx): Promise<MailSettings> {
  const d = await ctx.repo.get<MailDoc>(COL.modState, "owner:mail");
  /* answer 35: both reports by default; the address is the owner's, [ЛИПСВА]; the sending is stage E */
  return { weekly: d ? d.weekly : true, monthly: d ? d.monthly : true, email: OWNER_MISSING.email, format: "PDF", when: { weekly: "всеки понеделник в 6:00, за миналата седмица", monthly: "на 1-во число, за миналия месец" }, sending: "soon", at: d ? d.at : null, by: d ? d.by : null };
}
export interface OwnerDecisions {
  /** only the owner answers; the main admin reads */
  canAnswer: boolean;
  questions: QuestionView[]; groups: [string, string][];
  counts: { total: number; open: number; answered: number };
  /** the first question without an answer */
  next: string | null;
  /** the no-shows that wait for a decision (the phone masked) */
  /** blocked: how many numbers are blocked now ("1 блокиран номер.") */
  blocks: { rows: BlockRow[]; canDecide: boolean; limit: number; blocked: number; /** the role lacks "Резервации" / "Клиенти" */ hidden?: boolean };
  mail: MailSettings;
  google: { missing: string[] };
  waits: OwnerWaits;
}
export async function ownerDecisions(ctx: Ctx, s: StaffCtx): Promise<OwnerDecisions> {
  needOwner(s);
  const notes = await listNotes(ctx, { kind: "answer" }), a = answersById(notes), bl = await part(blockList(ctx, s));
  const qs = OWNER_QUESTIONS.map((q) => qView(q, a.get(q.id))), open = qs.filter((q) => !q.answer);
  return {
    canAnswer: s.user.role === "owner", questions: qs, groups: OWNER_GROUPS,
    counts: { total: qs.length, open: open.length, answered: qs.length - open.length }, next: open[0] ? open[0].id : null,
    blocks: bl ? { rows: bl.rows.filter((r) => r.status === "pending"), canDecide: bl.canDecide, limit: bl.limit, blocked: bl.rows.filter((r) => r.status === "blocked").length } : { rows: [], canDecide: false, limit: 2, blocked: 0, hidden: true },
    mail: await mailOf(ctx), google: { missing: [OWNER_MISSING.google, OWNER_MISSING.rating] }, waits: await waitsOf(ctx, s, notes),
  };
}
export interface AnswerInput { answer: "default" | "other"; text?: string }
export interface AnswerResult { question: QuestionView; replaced: boolean; applied: boolean; msg: string; undoUntil: number }
const QUESTION_URL = (id: string) => "/sobstvenik/reshenia/#q=" + id;
/** "Съгласен" (default) or "Друго" (text): ONLY the owner (the main admin 403). One note per question in "Бележки". */
export async function ownerAnswer(ctx: Ctx, s: StaffCtx, qid: string, input: AnswerInput): Promise<AnswerResult> {
  needOwner(s);
  if (s.user.role !== "owner") throw new CoreError("forbidden", OWNER_MSG.answerOnly, 403);
  const q = OWNER_QUESTIONS.find((x) => x.id === String(qid || ""));
  if (!q) throw new CoreError("not_found", OWNER_MSG.question, 404);
  const i = input && typeof input === "object" ? input : ({} as AnswerInput);
  if (i.answer !== "default" && i.answer !== "other") invalid({ answer: OWNER_MSG.answer }, OWNER_MSG.answer);
  if (i.answer === "default" && !q.hasDefault) invalid({ text: OWNER_MSG.noDefault }, OWNER_MSG.noDefault);
  const other = i.answer === "other" ? String(i.text || "").replace(/\s+/g, " ").trim().slice(0, 2000) : "";
  if (i.answer === "other" && !other) invalid({ text: OWNER_MSG.text }, OWNER_MSG.text);
  const where = q.sec === "m" ? "Модулите: " + q.group + ", т. " + q.n : "За собственика: решения" + (q.n ? ", т. " + q.n : "");
  const text = "Отговор на въпрос от агенцията (" + where + "): „" + q.text + "“ " + (i.answer === "default" ? "Съгласен с варианта по подразбиране: „" + q.def + "“." : "Друго: „" + other + "“.");
  const nq: NoteQuestion = { id: q.id, n: q.n, sec: q.sec, group: q.group, text: q.text, def: q.def, answer: i.answer, other };
  const r = await saveAnswer(ctx, s, nq, text, QUESTION_URL(q.id));
  emit(ctx, "owner.answer", { id: q.id, answer: i.answer, note: r.note.id }, { office_only: true });
  return { question: qView(q, r.note), replaced: r.replaced, applied: r.applied, msg: r.applied ? OWNER_MSG.applied : r.replaced ? OWNER_MSG.replaced : OWNER_MSG.saved, undoUntil: nowDate(ctx).getTime() + ANSWER_UNDO_MS };
}
/** "Отмени" after an answer (the owner, within ANSWER_UNDO_MS): the earlier answer comes back (or none) */
export async function ownerAnswerUndo(ctx: Ctx, s: StaffCtx, qid: string): Promise<QuestionView> {
  needOwner(s);
  if (s.user.role !== "owner") throw new CoreError("forbidden", OWNER_MSG.answerOnly, 403);
  const q = OWNER_QUESTIONS.find((x) => x.id === String(qid || ""));
  if (!q) throw new CoreError("not_found", OWNER_MSG.question, 404);
  const n = await undoAnswer(ctx, s, q.id, ANSWER_UNDO_MS);
  emit(ctx, "owner.answer", { id: q.id, undo: true }, { office_only: true });
  return qView(q, n || undefined);
}
/** "Блокирай" / "Не блокирай" a no-show (no "Отмени", decision 16.11); the log is written by reservations-admin.ts */
export async function ownerBlock(ctx: Ctx, s: StaffCtx, ref: string, action: "block" | "clear"): Promise<BlockRow> {
  needOwner(s);
  return blockDecide(ctx, s, ref, action);
}
/** the two switches of the e-mail reports (the owner and the main admin). Log: owner.mail. */
export async function ownerSetMail(ctx: Ctx, s: StaffCtx, p: { weekly?: boolean; monthly?: boolean }): Promise<MailSettings> {
  needOwner(s);
  const cur = await mailOf(ctx), i = p && typeof p === "object" ? p : {};
  if ((i.weekly !== undefined && typeof i.weekly !== "boolean") || (i.monthly !== undefined && typeof i.monthly !== "boolean")) invalid({ weekly: "Избери включено или изключено." });
  const d: MailDoc = { id: "owner:mail", weekly: i.weekly ?? cur.weekly, monthly: i.monthly ?? cur.monthly, at: iso(ctx), by: s.user.username };
  await ctx.repo.put(COL.modState, d);
  await audit(ctx, s.user.username, "owner.mail", "owner:mail", { weekly: d.weekly, monthly: d.monthly });
  return mailOf(ctx);
}

