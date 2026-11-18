/* THE history (BUILD-TODO, step 6; decisions 16.11 and 17.11.2026): one source for "Отчети" in the admin
   (core/reports.ts) and for the owner's module (core/owner.ts). The same period gives the same numbers in both places.
   - The days are the real orders and reservations in the store (the past days AND today); there is no generator of
     past numbers in the code. An order marked `sample` (seeded example data) makes the answer "Примерни данни".
   - "Предишният период": for "Днес" and "Вчера" the same weekday last week (today up to the same minute); for "Месец"
     the previous month from its 1st, the same number of days; for 7, 30 and a custom range the days right before.
   - "Миналата година": the same weekdays 364 days back (never the same date).
   - "Обичайното": the average of the same weekday in the last 4 weeks (up to the same minute for today; answer 34).
   - Money (turnover, average bill, every sum by channel, hour, day and dish) only for a role with "Финанси и гориво";
     the functions here compute everything, the callers strip the sums (`money: false`, every sum null).
   - THE day of an order is the day it is for, the day starts at 04:00 (core/order-day.ts); its hour is the hour it is for.
   - SPEED (decision of the chief after the review of the owner's module, about 55 000 orders): no answer reads all the
     orders. The orders of a period are read by their day (the SQLite repo has the column `day` with an index, `range`),
     and every day's orders are kept in a small cache (at most CACHE_DAYS days, trimmed to the fields the numbers need)
     that holds while the day's stamp (how many, the last change, the size) is the same: a closed day is read once and
     again only when one of its orders changes. A repo without `range` (memory, the demo) reads the list as before.
   No personal data leaves this file: the phones are only compared (new and returning customers). */
import { COL, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, type Channel, type Order, type Reservation } from "./types.ts";
import type { Repo } from "./repo.ts";
import { round2 } from "./rights.ts";
import { validYmd } from "./reservations.ts";
import { addDaysYmd, minutes } from "../lib/time.ts";
import { shiftDay } from "../lib/shift-day.ts";
import { DAYS, DAYS_SHORT } from "../lib/format.ts";
import { histDay, placedMin, hourOf, shiftMin } from "./order-day.ts";

export type Period = "today" | "yesterday" | "7" | "30" | "month" | "custom";
export const PERIODS: Period[] = ["today", "yesterday", "7", "30", "month", "custom"];
export type Compare = "prev" | "year";
export const HISTORY_MAX_DAYS = 92;
/** "Миналата година": the same weekday, 52 weeks back */
export const YEAR_DAYS = 364;
/** "обичайното": the same weekday in the last 4 weeks (answer 34) */
export const USUAL_WEEKS = 4;
export const HISTORY_MSG = { range: "Изберете период от-до, до " + HISTORY_MAX_DAYS + " дни, не в бъдещето." };
/** the hours of the reports (10:00-22:59); an hour with orders outside them is shown too (the columns sum to the turnover) */
export const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/* ---------- small helpers (Sofia days, the shop clock) ---------- */
type DayOrder = Order & { _d?: string };
/** the day of an order in the history (the day it is for; core/order-day.ts) */
export const dayOf = (o: Pick<Order, "ts" | "createdAt" | "sched">): string => (o as DayOrder)._d || histDay(o);
/** the minute the order was placed, on the shift clock (00:30 = 24:30) */
export const minOf = (o: Pick<Order, "placedAt">): number => placedMin(o);
/** the hour (0-23) of a shift-clock hour (24 -> 0) */
export const hour24 = (h: number): number => h % 24;
export const span = (a: string, b: string): number => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5) + 1;
/** 0 = Sunday … 6 = Saturday */
export const weekday = (ymd: string): number => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay();
export const dayName = (ymd: string): string => DAYS[weekday(ymd)];
export const dayShort = (ymd: string): string => DAYS_SHORT[weekday(ymd)];
/** "Миналия понеделник" / "Миналата сряда" */
export const lastDayName = (ymd: string): string => { const w = weekday(ymd); return (w === 0 || w === 3 || w === 6 ? "Миналата " : "Миналия ") + DAYS[w]; };
export const hm = (m: number): string => String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const ok = (o: Order) => o.status !== "cancelled";
const live = (r: Reservation) => r.status !== "cancelled" && r.status !== "waitlist";
export const isSample = (o: Order): boolean => !!(o as Order & { sample?: boolean }).sample;

/** the channels of "Отчети": Сайт (delivery and pickup from the site), Телефон, Маса (QR and waiter), Офис */
export type ChKey = "web" | "phone" | "table" | "office";
export const CH_KEYS: ChKey[] = ["web", "phone", "table", "office"];
export const CH_LABEL: Record<ChKey, string> = { web: "Сайт", phone: "Телефон", table: "Маса", office: "Офис" };
export const chKey = (c: Channel): ChKey => (c === "qr" || c === "waiter" ? "table" : c);
/** the owner's five channels on "Днес" */
export type Ch5 = "delivery" | "pickup" | "phone" | "table" | "office";
export const CH5: Ch5[] = ["delivery", "pickup", "phone", "table", "office"];
export const CH5_LABEL: Record<Ch5, string> = { delivery: "Доставка от сайта", pickup: "Вземане от сайта", phone: "По телефона", table: "На маса", office: "Офис" };
export const ch5 = (o: Pick<Order, "channel" | "mode">): Ch5 => (o.channel === "web" ? (o.mode === "pickup" ? "pickup" : "delivery") : chKey(o.channel) as Ch5);

/* ---------- the periods ---------- */
/** the dates of a period (Sofia); 422 for a custom range in the future, reversed or over 92 days */
export function periodRange(today: string, p: Period, from?: string, to?: string): { from: string; to: string } {
  switch (p) {
    case "yesterday": { const y = addDaysYmd(today, -1); return { from: y, to: y }; }
    case "7": return { from: addDaysYmd(today, -6), to: today };
    case "30": return { from: addDaysYmd(today, -29), to: today };
    case "month": return { from: today.slice(0, 8) + "01", to: today };
    case "custom": {
      if (!from || !to || !validYmd(from) || !validYmd(to) || from > to || to > today || span(from, to) > HISTORY_MAX_DAYS) throw Object.assign(new CoreError("invalid", HISTORY_MSG.range, 422), { fields: { from: HISTORY_MSG.range } });
      return { from, to };
    }
    default: return { from: today, to: today };
  }
}
export const asPeriod = (p: unknown): Period => (PERIODS.includes(p as Period) ? (p as Period) : "today");
/** the range to compare with: "year" = 364 days back; "prev": the same weekday last week for "Днес" / "Вчера", the
    previous month from its 1st for "Месец" (the same number of days, never past its last day), else the days right before */
export function compareRange(p: Period, from: string, to: string, cmp: Compare = "prev"): { from: string; to: string } {
  if (cmp === "year") return { from: addDaysYmd(from, -YEAR_DAYS), to: addDaysYmd(to, -YEAR_DAYS) };
  if (p === "today" || p === "yesterday") return { from: addDaysYmd(from, -7), to: addDaysYmd(to, -7) };
  const n = span(from, to);
  if (p === "month") { const pa = addDaysYmd(from.slice(0, 8) + "01", -1).slice(0, 8) + "01", end = addDaysYmd(from.slice(0, 8) + "01", -1), t = addDaysYmd(pa, n - 1); return { from: pa, to: t < end ? t : end }; }
  return { from: addDaysYmd(from, -n), to: addDaysYmd(from, -1) };
}

/* ---------- the data: one aggregate per day (sums, never whole orders), the closed days cached ---------- */
export interface History {
  /** today (the shift day, from 04:00) and the minute of the shop clock now (on the shift clock: 00:30 = 24:30) */
  today: string; now: number;
  ctx: Ctx;
}
export async function loadHistory(ctx: Ctx): Promise<History> {
  return { today: shiftDay(nowDate(ctx)), now: shiftMin(minutes(ctx.clock)), ctx };
}
/** the fast path of the SQLite repo (server/db/repo.ts): the documents whose indexed key is in [from, to], one stamp per
    key value (changes when a document of it changes), the first order of every phone */
export interface RangeRepo extends Repo {
  range<T>(col: string, key: string, from: string, to: string): Promise<T[]>;
  stamps(col: string, key: string, from: string, to: string): Promise<Record<string, string>>;
  firstOrderTs(phones: string[]): Promise<Record<string, number>>;
}
const fast = (r: Repo): r is RangeRepo => typeof (r as Partial<RangeRepo>).range === "function" && typeof (r as Partial<RangeRepo>).stamps === "function";

/** THE aggregate of one day (decision of the chief, 18.11: the cache keeps sums by day, not orders). Every number of the
    screens comes from it; the few rows per order are numbers only (the minute and the hour, the channel, the total), for
    "до същата минута" and the hours. */
export interface DayAgg {
  date: string;
  /* one entry per order, the cancelled too: the minute placed and the hour it is for (shift clock), the channel (CH5
     index), the total, 1 = not cancelled */
  m: number[]; h: number[]; c: number[]; t: number[]; ok: number[];
  /** the dishes of the not cancelled orders (lines not "Изчерпано"): id -> [name, portions, turnover] */
  dishes: Record<string, [string, number, number]>;
  /** pairs of different dishes in one order: "a|b" -> how many orders; multi: the orders with 2+ dishes */
  pairs: Record<string, number>; multi: number;
  /** the phones of the not cancelled orders: phone -> the first moment that day */
  phones: Record<string, number>;
  /** the sums and the counts of the cooking and the delivery minutes */
  cook: [number, number]; del: [number, number];
  /** the offers: [orders, discount, turnover] */
  lunch: [number, number, number]; code: [number, number, number];
  /** the payment of the not cancelled orders: online cash, card, voucher, and the turnover of the table orders */
  pay: [number, number, number, number];
  /** still in work (not finished, not cancelled), the delivered deliveries, any example order */
  work: number; delivered: number; sample: boolean;
}
const CH5_IDX: Record<Ch5, number> = { delivery: 0, pickup: 1, phone: 2, table: 3, office: 4 };
/** the aggregate of the orders of one day */
export function aggOf(date: string, orders: Order[]): DayAgg {
  const a: DayAgg = { date, m: [], h: [], c: [], t: [], ok: [], dishes: {}, pairs: {}, multi: 0, phones: {}, cook: [0, 0], del: [0, 0], lunch: [0, 0, 0], code: [0, 0, 0], pay: [0, 0, 0, 0], work: 0, delivered: 0, sample: false };
  for (const o of orders) {
    const good = ok(o), total = o.total || 0;
    a.m.push(minOf(o)); a.h.push(hourOf(o)); a.c.push(CH5_IDX[ch5(o)] ?? 0); a.t.push(total); a.ok.push(good ? 1 : 0);
    if (isSample(o)) a.sample = true;
    if (!FINISHED_ST.includes(o.status) && good) a.work++;
    if (o.mode === "delivery" && o.status === "delivered") a.delivered++;
    if (!good) continue;
    const lines = (o.lines || []).filter((l) => !l.out);
    for (const l of lines) { const x = a.dishes[l.id] || (a.dishes[l.id] = [l.name || l.id, 0, 0]); x[1] += l.q; x[2] = round2(x[2] + (l.unit || 0) * l.q); }
    const ids = [...new Set(lines.map((l) => l.id))].sort((x, y) => (x < y ? -1 : 1));
    if (ids.length >= 2) { a.multi++; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const k = ids[i] + "|" + ids[j]; a.pairs[k] = (a.pairs[k] || 0) + 1; } }
    if (o.phone) a.phones[o.phone] = Math.min(a.phones[o.phone] ?? Infinity, o.ts);
    const tt = o.times || {};
    const start = [tt.cooking, ...(o.lines || []).map((l) => l.cookAt)].filter((x): x is string => !!x).map(Date.parse).sort((x, y) => x - y)[0];
    if (tt.ready && start != null && !o.sched) { const v = (Date.parse(tt.ready) - start) / 60_000; if (v >= 0) { a.cook[0] += v; a.cook[1]++; } }
    if (tt.on_way && tt.delivered) { const v = (Date.parse(tt.delivered) - Date.parse(tt.on_way)) / 60_000; if (v >= 0) { a.del[0] += v; a.del[1]++; } }
    if (o.discKind === "lunch") { a.lunch[0]++; a.lunch[1] += o.disc || 0; a.lunch[2] += total; }
    if (o.discKind === "code" || !!o.code) { a.code[0]++; a.code[1] += o.disc || 0; a.code[2] += total; }
    if (chKey(o.channel) === "table") a.pay[3] += total; else a.pay[o.pay === "card" ? 1 : o.pay === "voucher" ? 2 : 0] += total;
  }
  return a;
}
const FINISHED_ST = ["delivered", "picked_up"];
const daysOf = (from: string, to: string) => { const l: string[] = []; for (let d = from; d <= to; d = addDaysYmd(d, 1)) l.push(d); return l; };
/** how many closed days the cache keeps (sums only: a few KB a day) */
export const CACHE_DAYS = 400;
interface DayEntry { stamp: string; agg: DayAgg }
const CACHE = new WeakMap<Repo, Map<string, DayEntry>>();
/** every order (the cancelled too) of the days [from, to], read now (today's numbers, the dashboard; never cached) */
export async function ordersOfDays(ctx: Ctx, from: string, to: string): Promise<Order[]> {
  const repo = ctx.repo;
  if (fast(repo)) return (await repo.range<Order>(COL.orders, "day", from, to)).filter((o) => { const d = histDay(o); return d >= from && d <= to; });
  return (await repo.list<Order>(COL.orders)).filter((o) => { const d = dayOf(o); return d >= from && d <= to; });
}
/** the aggregates of the days [from, to]: a closed day from the cache while its stamp holds, today always from its orders */
export async function aggsOfDays(h: History, from: string, to: string): Promise<DayAgg[]> {
  const repo = h.ctx.repo, days = daysOf(from, to);
  if (!fast(repo)) {
    const by = new Map<string, Order[]>(days.map((d) => [d, []]));
    for (const o of await repo.list<Order>(COL.orders)) { const l = by.get(dayOf(o)); if (l) l.push(o); }
    return days.map((d) => aggOf(d, by.get(d)!));
  }
  let m = CACHE.get(repo); if (!m) { m = new Map(); CACHE.set(repo, m); }
  const cache = m, st = await repo.stamps(COL.orders, "day", from, to);
  /* what this answer uses: taken from the cache now, so that no eviction below can take it away */
  const got = new Map<string, DayAgg>();
  const need: string[] = [];
  for (const d of days) {
    if (!st[d]) { got.set(d, aggOf(d, [])); cache.delete(d); continue; }
    const e = d !== h.today ? cache.get(d) : undefined;
    if (e && e.stamp === st[d]) { got.set(d, e.agg); cache.delete(d); cache.set(d, e); } else need.push(d);
  }
  if (need.length) {
    const by = new Map<string, Order[]>(need.map((d) => [d, []]));
    /* one read per run of consecutive days (a cached day in between is not read again) */
    const runs: [string, string][] = [];
    for (const d of need) { const r = runs[runs.length - 1]; if (r && addDaysYmd(r[1], 1) === d) r[1] = d; else runs.push([d, d]); }
    const keep = (d: string, agg: DayAgg) => { got.set(d, agg); if (d !== h.today) { cache.delete(d); cache.set(d, { stamp: st[d], agg }); } };
    const each = (repo as RangeRepo & { rangeEach?: (c: string, k: string, f: string, t: string, fn: (o: Order) => void) => Promise<void> }).rangeEach;
    if (each) {
      /* day by day in the order of the index: only one day's orders are held at a time */
      for (const [a, b] of runs) {
        let cur = "", buf: Order[] = [];
        const flush = () => { if (cur && by.has(cur)) keep(cur, aggOf(cur, buf)); buf = []; };
        await each.call(repo, COL.orders, "day", a, b, (o: Order) => { const d = histDay(o); if (d !== cur) { flush(); cur = d; } buf.push(o); });
        flush();
      }
      for (const d of need) if (!got.has(d)) keep(d, aggOf(d, []));
    } else {
      for (const [a, b] of runs) for (const o of await repo.range<Order>(COL.orders, "day", a, b)) { const l = by.get(histDay(o)); if (l) l.push(o); }
      for (const d of need) keep(d, aggOf(d, by.get(d)!));
    }
    /* the oldest days go first (a Map keeps the order of use) */
    while (cache.size > CACHE_DAYS) cache.delete(cache.keys().next().value as string);
  }
  return days.map((d) => got.get(d)!);
}
/** the bookings of the days [from, to] */
async function resOfDays(ctx: Ctx, from: string, to: string): Promise<Reservation[]> {
  const repo = ctx.repo;
  if (fast(repo)) return repo.range<Reservation>(COL.reservations, "date", from, to);
  return (await repo.list<Reservation>(COL.reservations)).filter((r) => r.date >= from && r.date <= to);
}
/** is there an order before `day` (a new restaurant has none: "Още събираме история") */
export async function hasBefore(ctx: Ctx, day: string): Promise<boolean> {
  const repo = ctx.repo, y = addDaysYmd(day, -1);
  if (fast(repo)) return Object.keys(await repo.stamps(COL.orders, "day", "0000-01-01", y)).length > 0;
  return (await repo.list<Order>(COL.orders)).some((o) => dayOf(o) <= y);
}
export interface Slice {
  from: string; to: string;
  /** the aggregates of the days and the bookings of the days */
  days: DayAgg[]; res: Reservation[];
  /** only the orders placed up to this minute of the day (today's comparison), else null */
  cut: number | null;
}
/** the days and bookings of [from, to]; cut: only the orders placed up to that minute (the reservations stay whole) */
export async function slice(h: History, from: string, to: string, cut: number | null = null): Promise<Slice> {
  const [days, res] = await Promise.all([aggsOfDays(h, from, to), resOfDays(h.ctx, from, to)]);
  return { from, to, cut, days, res };
}
/** the order rows of a slice (within the cut): [minute, hour, channel, total, the day] of the not cancelled, and the count of the cancelled */
function rows(sl: Pick<Slice, "days" | "cut">, all = false): { m: number; h: number; c: number; t: number; d: DayAgg }[] {
  const out: { m: number; h: number; c: number; t: number; d: DayAgg }[] = [];
  for (const d of sl.days) for (let i = 0; i < d.m.length; i++) if ((all || d.ok[i]) && (sl.cut == null || d.m[i] <= sl.cut)) out.push({ m: d.m[i], h: d.h[i], c: d.c[i], t: d.t[i], d });
  return out;
}
const cancelledOf = (sl: Pick<Slice, "days" | "cut">) => { let n = 0; for (const d of sl.days) for (let i = 0; i < d.m.length; i++) if (!d.ok[i] && (sl.cut == null || d.m[i] <= sl.cut)) n++; return n; };
export const isSampleSlice = (sl: Pick<Slice, "days">): boolean => sl.days.some((d) => d.sample);

/* ---------- the numbers ---------- */
export interface Totals { orders: number; cancelled: number; revenue: number; avg: number; reservations: number; people: number; noShows: number; noShowPct: number }
export function totals(sl: Pick<Slice, "days" | "res" | "cut">): Totals {
  const good = rows(sl), revenue = round2(good.reduce((a, o) => a + o.t, 0));
  const l = sl.res.filter(live), noShows = l.filter((r) => r.status === "no_show").length;
  return {
    orders: good.length, cancelled: cancelledOf(sl), revenue, avg: good.length ? round2(revenue / good.length) : 0,
    reservations: l.length, people: l.reduce((a, r) => a + r.people, 0), noShows, noShowPct: l.length ? Math.round((noShows / l.length) * 100) : 0,
  };
}
const sumT = (l: { t: number }[]) => round2(l.reduce((a, o) => a + o.t, 0));
export interface ChannelRow { channel: ChKey; label: string; orders: number; revenue: number; share: number }
const CH4_OF = [0, 0, 1, 2, 3]; /* CH5 index -> CH_KEYS index (web = delivery + pickup) */
/** by channel; share = % of the turnover (the callers without money give the share of the orders) */
export function byChannel(sl: Pick<Slice, "days" | "cut">): ChannelRow[] {
  const good = rows(sl), all = sumT(good);
  return CH_KEYS.map((c, i) => { const l = good.filter((o) => CH4_OF[o.c] === i), revenue = sumT(l); return { channel: c, label: CH_LABEL[c], orders: l.length, revenue, share: all ? Math.round((revenue / all) * 100) : 0 }; });
}
export interface Ch5Row { key: Ch5; label: string; orders: number; revenue: number }
export function byChannel5(sl: Pick<Slice, "days" | "cut">): Ch5Row[] {
  const good = rows(sl);
  return CH5.map((k) => { const l = good.filter((o) => o.c === CH5_IDX[k]); return { key: k, label: CH5_LABEL[k], orders: l.length, revenue: sumT(l) }; });
}
/** the hours to show: 10-22 and every other hour with orders (on the shift clock, 24 = 00:00 after midnight) */
export function hoursOf(...sls: Pick<Slice, "days" | "cut">[]): number[] {
  const s = new Set(HOURS);
  for (const sl of sls) for (const o of rows(sl)) s.add(o.h);
  return [...s].sort((a, b) => a - b);
}
export interface HourRow { hour: number; orders: number; revenue: number }
/** by hour (the hour the order is for); `hour` is 0-23; the columns sum to the turnover */
export function byHour(sl: Pick<Slice, "days" | "cut">, hours = hoursOf(sl)): HourRow[] {
  const good = rows(sl);
  return hours.map((h) => { const l = good.filter((o) => o.h === h); return { hour: hour24(h), orders: l.length, revenue: sumT(l) }; });
}
export interface DayRow { date: string; orders: number; revenue: number; reservations: number; noShows: number; cancelled: number }
export function byDay(sl: Slice): DayRow[] {
  const rd = new Map<string, Reservation[]>();
  for (const r of sl.res) (rd.get(r.date) || rd.set(r.date, []).get(r.date)!).push(r);
  return sl.days.map((d) => {
    const one = { days: [d], cut: sl.cut }, l = rows(one), r = (rd.get(d.date) || []).filter(live);
    return { date: d.date, orders: l.length, revenue: sumT(l), reservations: r.length, noShows: r.filter((x) => x.status === "no_show").length, cancelled: cancelledOf(one) };
  });
}
export interface DishRow { id: string; name: string; q: number; revenue: number }
/** every dish of the period (q = portions, revenue = unit × q of the lines); by "q" (then revenue) or "revenue" */
export function dishes(sl: Pick<Slice, "days">, by: "q" | "revenue" = "q"): DishRow[] {
  const m = new Map<string, DishRow>();
  for (const d of sl.days) for (const [id, [name, q, rev]] of Object.entries(d.dishes)) {
    const x = m.get(id) || { id, name, q: 0, revenue: 0 };
    x.q += q; x.revenue = round2(x.revenue + rev); m.set(id, x);
  }
  return [...m.values()].sort(by === "q" ? (a, b) => b.q - a.q || b.revenue - a.revenue || a.name.localeCompare(b.name, "bg") : (a, b) => b.revenue - a.revenue || b.q - a.q || a.name.localeCompare(b.name, "bg"));
}
/** the top 8 the way "Отчети" shows them (by portions) */
export const top8 = (sl: Pick<Slice, "days">): DishRow[] => dishes(sl, "q").slice(0, 8);
/** the portions of one dish on every day of the slice */
export const dishByDay = (sl: Pick<Slice, "days">, id: string): { date: string; q: number }[] => sl.days.map((d) => ({ date: d.date, q: d.dishes[id] ? d.dishes[id][1] : 0 }));

/** "Пикови часове": weekday (Monday first) × hour (10-22 and every hour with orders; `hours` 0-23), the orders */
export interface Peak { days: string[]; hours: number[]; cells: number[][]; max: number }
export function peak(sl: Pick<Slice, "days" | "cut">): Peak {
  const order = [1, 2, 3, 4, 5, 6, 0], hs = hoursOf(sl), cells = order.map(() => hs.map(() => 0));
  for (const o of rows(sl)) {
    const r = order.indexOf(weekday(o.d.date)), c = hs.indexOf(o.h);
    if (r > -1 && c > -1) cells[r][c]++;
  }
  return { days: order.map((w) => DAYS_SHORT[w]), hours: hs.map(hour24), cells, max: Math.max(0, ...cells.flat()) };
}
/** "Често поръчвани заедно": pairs of different dishes in one order (the real orders), the most frequent first */
export interface Pair { a: { id: string; name: string }; b: { id: string; name: string }; n: number; /** % of the orders with 2+ dishes */ share: number }
export function together(sl: Pick<Slice, "days">, limit = 6): Pair[] {
  const m = new Map<string, number>(), names = new Map<string, string>(); let multi = 0;
  for (const d of sl.days) {
    multi += d.multi;
    for (const [k, n] of Object.entries(d.pairs)) m.set(k, (m.get(k) || 0) + n);
    for (const [id, x] of Object.entries(d.dishes)) if (!names.has(id)) names.set(id, x[0]);
  }
  return [...m.entries()].filter(([, n]) => n >= 2).map(([k, n]) => { const [a, b] = k.split("|"); return { a: { id: a, name: names.get(a) || a }, b: { id: b, name: names.get(b) || b }, n, share: 0 }; })
    .sort((x, y) => y.n - x.n || x.a.name.localeCompare(y.a.name, "bg")).slice(0, limit)
    .map((p) => ({ ...p, share: multi ? Math.round((p.n / multi) * 100) : 0 }));
}
/** new and returning customers: the distinct phones of the period (orders with a phone: site, phone, office); returning =
    the phone has an order before its first one in the period (one query: the first order of every phone) */
export async function customers(h: History, sl: Pick<Slice, "days" | "from">): Promise<{ new: number; returning: number; total: number }> {
  const first = new Map<string, number>();
  for (const d of sl.days) for (const [p, t] of Object.entries(d.phones)) first.set(p, Math.min(first.get(p) ?? Infinity, t));
  let before: Record<string, number> = {};
  const repo = h.ctx.repo;
  if (first.size && fast(repo)) before = await repo.firstOrderTs([...first.keys()]);
  else if (first.size) for (const o of (await repo.list<Order>(COL.orders)).filter(ok)) if (o.phone && first.has(o.phone)) before[o.phone] = Math.min(before[o.phone] ?? Infinity, o.ts);
  let ret = 0; for (const [x, t] of first) if ((before[x] ?? Infinity) < t) ret++;
  return { new: first.size - ret, returning: ret, total: first.size };
}
/** the average times of the period, from the real timestamps; null without data:
    cooking (the kitchen: from "Готви се" or the first line started, to "Готова"), delivery ("На път" -> "Доставена"),
    the answer to a call at a table (the call -> "Отивам", or -> "Обслужено" without it; not the automatic ones) */
export interface Times { cookMin: number | null; deliveryMin: number | null; callSec: number | null; n: { cook: number; delivery: number; call: number } }
export async function times(ctx: Ctx, sl: Pick<Slice, "days" | "from" | "to">): Promise<Times> {
  let cs = 0, cn = 0, ds = 0, dn = 0;
  for (const d of sl.days) { cs += d.cook[0]; cn += d.cook[1]; ds += d.del[0]; dn += d.del[1]; }
  const call: number[] = [];
  type Call = { at: string; taken?: { at: string } | null; done?: { how: string; at: string; auto?: boolean } | null };
  for (const s of await sessionsOf(ctx, sl.from, sl.to)) for (const c of (s as { calls?: Call[] }).calls || []) {
    const d = shiftDay(new Date(c.at));
    if (d < sl.from || d > sl.to) continue;
    const at = c.taken ? c.taken.at : c.done && c.done.how === "served" && !c.done.auto ? c.done.at : null;
    if (at) call.push(Math.max(0, (Date.parse(at) - Date.parse(c.at)) / 1000));
  }
  const a = call.length ? call.reduce((x, y) => x + y, 0) / call.length : null;
  return { cookMin: cn ? Math.round((cs / cn) * 10) / 10 : null, deliveryMin: dn ? Math.round((ds / dn) * 10) / 10 : null, callSec: a == null ? null : Math.round(a), n: { cook: cn, delivery: dn, call: call.length } };
}
/** the sittings at the tables that may have a call or a payment in [from, to] (opened from the day before to the day after) */
export async function sessionsOf(ctx: Ctx, from: string, to: string): Promise<{ id: string; createdAt?: string }[]> {
  const repo = ctx.repo;
  if (fast(repo)) return repo.range(COL.tableSessions, "createdAt", addDaysYmd(from, -1) + "T00:00:00.000Z", addDaysYmd(to, 2) + "T00:00:00.000Z");
  return repo.list(COL.tableSessions);
}
/** the offers' effect: the lunch -30% after 15:00 (pickup) and the -10% code from the internal rating */
export interface Offers { lunch: { orders: number; disc: number; revenue: number }; code: { orders: number; disc: number; revenue: number } }
export function offers(sl: Pick<Slice, "days">): Offers {
  const part = (k: "lunch" | "code") => { let n = 0, disc = 0, rev = 0; for (const d of sl.days) { n += d[k][0]; disc += d[k][1]; rev += d[k][2]; } return { orders: n, disc: round2(disc), revenue: round2(rev) }; };
  return { lunch: part("lunch"), code: part("code") };
}
/** the payment of the days: online cash, card, voucher and the turnover of the table orders */
export function payOfDays(sl: Pick<Slice, "days">): { cash: number; card: number; voucher: number; table: number } {
  const p = [0, 0, 0, 0]; for (const d of sl.days) for (let i = 0; i < 4; i++) p[i] += d.pay[i];
  return { cash: p[0], card: p[1], voucher: p[2], table: p[3] };
}
/** the orders still in work and the delivered deliveries of the days */
export const workOf = (sl: Pick<Slice, "days">) => sl.days.reduce((a, d) => a + d.work, 0);
export const deliveredOf = (sl: Pick<Slice, "days">) => sl.days.reduce((a, d) => a + d.delivered, 0);

/* ---------- "обичайното" ---------- */
/** the same weekday in the last `weeks` weeks (the oldest last) */
export const usualDays = (day: string, weeks = USUAL_WEEKS): string[] => Array.from({ length: weeks }, (_, i) => addDaysYmd(day, -7 * (i + 1)));
export interface Usual { days: string[]; orders: number; revenue: number; /** the days with at least one order */ withData: number }
/** the average of the same weekday in the last 4 weeks, up to `cut` minutes (null: the whole day) */
export async function usual(h: History, day: string, cut: number | null, weeks = USUAL_WEEKS): Promise<Usual> {
  const days = usualDays(day, weeks);
  let orders = 0, revenue = 0, withData = 0;
  for (const d of days) { const t = totals(await slice(h, d, d, cut)); orders += t.orders; revenue += t.revenue; if (t.orders) withData++; }
  return { days, orders: Math.round((orders / weeks) * 10) / 10, revenue: round2(revenue / weeks), withData };
}
/** the turnover up to every step of `step` minutes from 10:00 to 23:00 (cumulative; the last point holds the whole day,
    the orders placed after 23:00 too); with `upTo` (now) the points after the first one at or after now are null */
export function cumulative(sl: Pick<Slice, "days">, step = 15, upTo: number | null = null, from = 600, to = 1380): (number | null)[] {
  const good = rows({ days: sl.days, cut: null }), out: (number | null)[] = [];
  for (let t = from; t <= to; t += step) out.push(upTo != null && t - step >= upTo ? null : round2(good.filter((o) => t + step > to || o.m <= t).reduce((a, o) => a + o.t, 0)));
  return out;
}
/** % change, rounded (null when the base is 0) */
export const pct = (cur: number, base: number): number | null => (base ? Math.round(((cur - base) / base) * 100) : null);
