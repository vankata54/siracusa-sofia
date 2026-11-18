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
   No personal data leaves this file: phones are compared by their hash (new and returning customers). */
import { COL, nowDate, phoneHash, type Ctx } from "./ctx.ts";
import { CoreError, type Channel, type Order, type Reservation } from "./types.ts";
import { round2 } from "./rights.ts";
import { validYmd } from "./reservations.ts";
import { sofiaYmd, addDaysYmd, minutes } from "../lib/time.ts";
import { DAYS, DAYS_SHORT } from "../lib/format.ts";

export type Period = "today" | "yesterday" | "7" | "30" | "month" | "custom";
export const PERIODS: Period[] = ["today", "yesterday", "7", "30", "month", "custom"];
export type Compare = "prev" | "year";
export const HISTORY_MAX_DAYS = 92;
/** "Миналата година": the same weekday, 52 weeks back */
export const YEAR_DAYS = 364;
/** "обичайното": the same weekday in the last 4 weeks (answer 34) */
export const USUAL_WEEKS = 4;
export const HISTORY_MSG = { range: "Изберете период от-до, до " + HISTORY_MAX_DAYS + " дни, не в бъдещето." };
/** the hours of the reports (10:00-22:59) */
export const HOURS = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/* ---------- small helpers (Sofia days, the shop clock) ---------- */
/* the Sofia day of an order, remembered per moment: the reports ask it for every order of every day of a period
   (92 days × hundreds of orders); Intl formatting each time made "Тенденции" take seconds */
const DAY_CACHE = new Map<number | string, string>();
export const dayOf = (o: Pick<Order, "ts" | "createdAt">): string => {
  const k = o.ts || o.createdAt;
  let d = DAY_CACHE.get(k);
  if (d === undefined) { d = sofiaYmd(new Date(k)); if (DAY_CACHE.size > 50_000) DAY_CACHE.clear(); DAY_CACHE.set(k, d); }
  return d;
};
/** the minute of the day the order was placed (the shop clock) */
export const minOf = (o: Pick<Order, "placedAt">): number => +o.placedAt.slice(0, 2) * 60 + +o.placedAt.slice(3);
export const span = (a: string, b: string): number => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5) + 1;
/** 0 = Sunday … 6 = Saturday */
export const weekday = (ymd: string): number => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))).getUTCDay();
export const dayName = (ymd: string): string => DAYS[weekday(ymd)];
export const dayShort = (ymd: string): string => DAYS_SHORT[weekday(ymd)];
/** "Миналия понеделник" / "Миналата сряда" */
export const lastDayName = (ymd: string): string => { const w = weekday(ymd); return (w === 0 || w === 3 || w === 6 ? "Миналата " : "Миналия ") + DAYS[w]; };
export const hm = (m: number): string => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
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
    previous month from its 1st for "Месец", else the days right before (as the approved prototypes) */
export function compareRange(p: Period, from: string, to: string, cmp: Compare = "prev"): { from: string; to: string } {
  if (cmp === "year") return { from: addDaysYmd(from, -YEAR_DAYS), to: addDaysYmd(to, -YEAR_DAYS) };
  if (p === "today" || p === "yesterday") return { from: addDaysYmd(from, -7), to: addDaysYmd(to, -7) };
  const n = span(from, to);
  if (p === "month") { const y = +from.slice(0, 4), m = +from.slice(5, 7), pa = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10); return { from: pa, to: addDaysYmd(pa, n - 1) }; }
  return { from: addDaysYmd(from, -n), to: addDaysYmd(from, -1) };
}

/* ---------- the data: one read for a whole answer ---------- */
export interface History {
  /** today (Sofia) and the minute of the shop clock now */
  today: string; now: number;
  orders: Order[]; reservations: Reservation[];
}
export async function loadHistory(ctx: Ctx): Promise<History> {
  const [orders, reservations] = await Promise.all([ctx.repo.list<Order>(COL.orders), ctx.repo.list<Reservation>(COL.reservations)]);
  return { today: sofiaYmd(nowDate(ctx)), now: minutes(ctx.clock), orders, reservations };
}
export interface Slice {
  from: string; to: string;
  /** every order of the days (the cancelled too) and the bookings of the days */
  orders: Order[]; res: Reservation[];
  /** only up to this minute of the day (today's comparison), else null */
  cut: number | null;
}
/** the orders and bookings of [from, to]; cut: only the orders placed up to that minute (the reservations of the day stay whole) */
export function slice(h: History, from: string, to: string, cut: number | null = null): Slice {
  const inR = (d: string) => d >= from && d <= to;
  return { from, to, cut, orders: h.orders.filter((o) => inR(dayOf(o)) && (cut == null || minOf(o) <= cut)), res: h.reservations.filter((r) => inR(r.date)), };
}

/* ---------- the numbers ---------- */
export interface Totals { orders: number; cancelled: number; revenue: number; avg: number; reservations: number; people: number; noShows: number; noShowPct: number }
export function totals(sl: Pick<Slice, "orders" | "res">): Totals {
  const good = sl.orders.filter(ok), revenue = round2(good.reduce((a, o) => a + (o.total || 0), 0));
  const l = sl.res.filter(live), noShows = l.filter((r) => r.status === "no_show").length;
  return {
    orders: good.length, cancelled: sl.orders.length - good.length, revenue, avg: good.length ? round2(revenue / good.length) : 0,
    reservations: l.length, people: l.reduce((a, r) => a + r.people, 0), noShows, noShowPct: l.length ? Math.round((noShows / l.length) * 100) : 0,
  };
}
const sum = (l: Order[]) => round2(l.reduce((a, o) => a + (o.total || 0), 0));
export interface ChannelRow { channel: ChKey; label: string; orders: number; revenue: number; share: number }
/** by channel; share = % of the turnover (the callers without money give the share of the orders) */
export function byChannel(sl: Pick<Slice, "orders">): ChannelRow[] {
  const good = sl.orders.filter(ok), all = sum(good);
  return CH_KEYS.map((c) => { const l = good.filter((o) => chKey(o.channel) === c), revenue = sum(l); return { channel: c, label: CH_LABEL[c], orders: l.length, revenue, share: all ? Math.round((revenue / all) * 100) : 0 }; });
}
export interface Ch5Row { key: Ch5; label: string; orders: number; revenue: number }
export function byChannel5(sl: Pick<Slice, "orders">): Ch5Row[] {
  const good = sl.orders.filter(ok);
  return CH5.map((k) => { const l = good.filter((o) => ch5(o) === k); return { key: k, label: CH5_LABEL[k], orders: l.length, revenue: sum(l) }; });
}
export interface HourRow { hour: number; orders: number; revenue: number }
export function byHour(sl: Pick<Slice, "orders">): HourRow[] {
  const good = sl.orders.filter(ok);
  return HOURS.map((h) => { const l = good.filter((o) => Math.floor(minOf(o) / 60) === h); return { hour: h, orders: l.length, revenue: sum(l) }; });
}
export interface DayRow { date: string; orders: number; revenue: number; reservations: number; noShows: number; cancelled: number }
export function byDay(sl: Slice): DayRow[] {
  const out: DayRow[] = [];
  for (let d = sl.from; d <= sl.to; d = addDaysYmd(d, 1)) {
    const all = sl.orders.filter((o) => dayOf(o) === d), l = all.filter(ok), r = sl.res.filter((x) => x.date === d && live(x));
    out.push({ date: d, orders: l.length, revenue: sum(l), reservations: r.length, noShows: r.filter((x) => x.status === "no_show").length, cancelled: all.length - l.length });
  }
  return out;
}
export interface DishRow { id: string; name: string; q: number; revenue: number }
/** every dish of the period (q = portions, revenue = unit × q of the lines); by "q" (then revenue) or "revenue" */
export function dishes(sl: Pick<Slice, "orders">, by: "q" | "revenue" = "q"): DishRow[] {
  const m = new Map<string, DishRow>();
  for (const o of sl.orders.filter(ok)) for (const l of o.lines) {
    if (l.out) continue;
    const x = m.get(l.id) || { id: l.id, name: l.name || l.id, q: 0, revenue: 0 };
    x.q += l.q; x.revenue = round2(x.revenue + (l.unit || 0) * l.q); m.set(l.id, x);
  }
  return [...m.values()].sort(by === "q" ? (a, b) => b.q - a.q || b.revenue - a.revenue || a.name.localeCompare(b.name, "bg") : (a, b) => b.revenue - a.revenue || b.q - a.q || a.name.localeCompare(b.name, "bg"));
}
/** the top 8 the way "Отчети" shows them (by portions) */
export const top8 = (sl: Pick<Slice, "orders">): DishRow[] => dishes(sl, "q").slice(0, 8);

/** "Пикови часове": weekday (Monday first) × hour (10-22), the orders */
export interface Peak { days: string[]; hours: number[]; cells: number[][]; max: number }
export function peak(sl: Pick<Slice, "orders">): Peak {
  const order = [1, 2, 3, 4, 5, 6, 0], cells = order.map(() => HOURS.map(() => 0));
  for (const o of sl.orders.filter(ok)) {
    const r = order.indexOf(weekday(dayOf(o))), c = HOURS.indexOf(Math.floor(minOf(o) / 60));
    if (r > -1 && c > -1) cells[r][c]++;
  }
  return { days: order.map((w) => DAYS_SHORT[w]), hours: HOURS.slice(), cells, max: Math.max(0, ...cells.flat()) };
}
/** "Често поръчвани заедно": pairs of different dishes in one order (the real orders), the most frequent first */
export interface Pair { a: { id: string; name: string }; b: { id: string; name: string }; n: number; /** % of the orders with 2+ dishes */ share: number }
export function together(sl: Pick<Slice, "orders">, limit = 6): Pair[] {
  const m = new Map<string, Pair>(); let multi = 0;
  for (const o of sl.orders.filter(ok)) {
    const ids = [...new Map(o.lines.filter((l) => !l.out).map((l) => [l.id, l.name || l.id])).entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1));
    if (ids.length < 2) continue;
    multi++;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const k = ids[i][0] + "|" + ids[j][0], p = m.get(k) || { a: { id: ids[i][0], name: ids[i][1] }, b: { id: ids[j][0], name: ids[j][1] }, n: 0, share: 0 };
      p.n++; m.set(k, p);
    }
  }
  return [...m.values()].filter((p) => p.n >= 2).sort((x, y) => y.n - x.n || x.a.name.localeCompare(y.a.name, "bg")).slice(0, limit)
    .map((p) => ({ ...p, share: multi ? Math.round((p.n / multi) * 100) : 0 }));
}
/** new and returning customers: the distinct phones of the period (orders with a phone: site, phone, office); returning =
    the phone has an order before its first one in the period. Compared by a hash, never by the number. */
export async function customers(h: History, sl: Pick<Slice, "orders" | "from">): Promise<{ new: number; returning: number; total: number }> {
  const key = new Map<string, string>();
  const k = async (p: string) => { let v = key.get(p); if (!v) { v = await phoneHash("sc-cust:" + p); key.set(p, v); } return v; };
  const first = new Map<string, number>();
  for (const o of sl.orders.filter(ok)) if (o.phone) { const x = await k(o.phone); first.set(x, Math.min(first.get(x) ?? Infinity, o.ts)); }
  const before = new Map<string, number>();
  for (const o of h.orders.filter(ok)) if (o.phone) { const x = await k(o.phone); if (first.has(x)) before.set(x, Math.min(before.get(x) ?? Infinity, o.ts)); }
  let ret = 0; for (const [x, t] of first) if ((before.get(x) ?? Infinity) < t) ret++;
  return { new: first.size - ret, returning: ret, total: first.size };
}
/** the average times of the period, from the real timestamps; null without data:
    cooking (the kitchen: from "Готви се" or the first line started, to "Готова"), delivery ("На път" -> "Доставена"),
    the answer to a call at a table (the call -> "Отивам", or -> "Обслужено" without it; not the automatic ones) */
export interface Times { cookMin: number | null; deliveryMin: number | null; callSec: number | null; n: { cook: number; delivery: number; call: number } }
export async function times(ctx: Ctx, sl: Pick<Slice, "orders" | "from" | "to">): Promise<Times> {
  const cook: number[] = [], del: number[] = [], call: number[] = [];
  for (const o of sl.orders.filter(ok)) {
    const t = o.times || {};
    const start = [t.cooking, ...o.lines.map((l) => l.cookAt)].filter((x): x is string => !!x).map(Date.parse).sort((a, b) => a - b)[0];
    if (t.ready && start != null && !o.sched) { const v = (Date.parse(t.ready) - start) / 60_000; if (v >= 0) cook.push(v); }
    if (t.on_way && t.delivered) { const v = (Date.parse(t.delivered) - Date.parse(t.on_way)) / 60_000; if (v >= 0) del.push(v); }
  }
  type Call = { at: string; taken?: { at: string } | null; done?: { how: string; at: string; auto?: boolean } | null };
  for (const s of await ctx.repo.list<{ id: string; calls?: Call[] }>(COL.tableSessions)) for (const c of s.calls || []) {
    const d = sofiaYmd(new Date(c.at));
    if (d < sl.from || d > sl.to) continue;
    const at = c.taken ? c.taken.at : c.done && c.done.how === "served" && !c.done.auto ? c.done.at : null;
    if (at) call.push(Math.max(0, (Date.parse(at) - Date.parse(c.at)) / 1000));
  }
  const avg = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
  const c = avg(cook), d = avg(del), a = avg(call);
  return { cookMin: c == null ? null : Math.round(c * 10) / 10, deliveryMin: d == null ? null : Math.round(d * 10) / 10, callSec: a == null ? null : Math.round(a), n: { cook: cook.length, delivery: del.length, call: call.length } };
}
/** the offers' effect: the lunch -30% after 15:00 (pickup) and the -10% code from the internal rating */
export interface Offers { lunch: { orders: number; disc: number; revenue: number }; code: { orders: number; disc: number; revenue: number } }
export function offers(sl: Pick<Slice, "orders">): Offers {
  const good = sl.orders.filter(ok), part = (l: Order[]) => ({ orders: l.length, disc: round2(l.reduce((a, o) => a + (o.disc || 0), 0)), revenue: sum(l) });
  return { lunch: part(good.filter((o) => o.discKind === "lunch")), code: part(good.filter((o) => o.discKind === "code" || !!o.code)) };
}

/* ---------- "обичайното" ---------- */
/** the same weekday in the last `weeks` weeks (the oldest last) */
export const usualDays = (day: string, weeks = USUAL_WEEKS): string[] => Array.from({ length: weeks }, (_, i) => addDaysYmd(day, -7 * (i + 1)));
export interface Usual { days: string[]; orders: number; revenue: number; /** the days with at least one order */ withData: number }
/** the average of the same weekday in the last 4 weeks, up to `cut` minutes (null: the whole day) */
export function usual(h: History, day: string, cut: number | null, weeks = USUAL_WEEKS): Usual {
  const days = usualDays(day, weeks);
  let orders = 0, revenue = 0, withData = 0;
  for (const d of days) { const t = totals(slice(h, d, d, cut)); orders += t.orders; revenue += t.revenue; if (t.orders) withData++; }
  return { days, orders: Math.round((orders / weeks) * 10) / 10, revenue: round2(revenue / weeks), withData };
}
/** the turnover up to every step of `step` minutes from 10:00 to 23:00 (cumulative); with `upTo` (now) the points after the
    first one at or after now are null (that point holds everything up to now) */
export function cumulative(orders: Order[], step = 15, upTo: number | null = null, from = 600, to = 1380): (number | null)[] {
  const good = orders.filter(ok), out: (number | null)[] = [];
  for (let t = from; t <= to; t += step) out.push(upTo != null && t - step >= upTo ? null : round2(good.filter((o) => minOf(o) <= t).reduce((a, o) => a + (o.total || 0), 0)));
  return out;
}
/** % change, rounded (null when the base is 0) */
export const pct = (cur: number, base: number): number | null => (base ? Math.round(((cur - base) / base) * 100) : null);
