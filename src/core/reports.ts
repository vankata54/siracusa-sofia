/* Reports (section "Отчети"; design/pages-admin/reports.html, README-3): for a period (today, yesterday, 7 days,
   30 days, this month, from-to up to 92 days) the orders (without the cancelled, "+N отказани"), the turnover (the
   orders' totals), the average bill, by channel, by hour, by day, the top dishes, the reservations and the no-shows,
   and the same numbers for the period before ("Сравни с предишния"; today: yesterday until the same time).
   No personal data (no names, phones, addresses). The cost of the dishes is [ЛИПСВА: себестойност] (null).
   Money (turnover, average bill, the sums by channel, hour, day and dish) only with the section "finance" (the main admin
   and the owner by default; decision 17.11.2026, OPEN-QUESTIONS 7: the manager is like the owner without finances): without
   it every sum is null and `money` is false, so the manager sees orders, reservations and no-shows, never a sum. */
import { COL, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, type Channel, type Order, type Reservation } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, may, round2 } from "./rights.ts";
import { validYmd } from "./reservations.ts";
import { CHANNEL_LABEL } from "./orders-admin.ts";
import { sofiaYmd, addDaysYmd, minutes } from "../lib/time.ts";

export type Period = "today" | "yesterday" | "7" | "30" | "month" | "custom";
export const REPORT_MAX_DAYS = 92;
export const REPORT_MSG = { range: "Изберете период от-до, до " + REPORT_MAX_DAYS + " дни, не в бъдещето." };

export interface Totals { orders: number; cancelled: number; revenue: number; avg: number; reservations: number; people: number; noShows: number; noShowPct: number }
export interface Report extends Totals {
  period: Period; from: string; to: string; days: number;
  /** today until this time (the comparison with yesterday goes to the same time) */
  until: string | null;
  byChannel: { channel: string; label: string; orders: number; revenue: number; share: number }[];
  byHour: { hour: number; orders: number; revenue: number }[];
  byDay: { date: string; orders: number; revenue: number; reservations: number; noShows: number }[];
  top: { id: string; name: string; q: number; revenue: number }[];
  prev: (Totals & { from: string; to: string }) | null;
  /** [ЛИПСВА: себестойност на ястията] */
  cost: null;
  sample: boolean;
  /** false without the section "finance": every sum above is null */
  money: boolean;
}
/** what a role without "finance" gets: the same report with every sum null */
type NoMoney<T> = { [K in keyof T]: K extends "revenue" | "avg" ? null : T[K] extends (infer U)[] ? NoMoney<U>[] : T[K] extends object | null ? NoMoney<T[K]> : T[K] };
export type ReportView = Report | (NoMoney<Report> & { money: false });

const dayOf = (o: Order) => sofiaYmd(new Date(o.ts || o.createdAt));
const minOf = (o: Order) => +o.placedAt.slice(0, 2) * 60 + +o.placedAt.slice(3);
const diff = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
const chKey = (c: Channel) => (c === "qr" || c === "waiter" ? "table" : c);
const CH_LABEL: Record<string, string> = { web: CHANNEL_LABEL.web, table: "Маса", phone: CHANNEL_LABEL.phone, office: CHANNEL_LABEL.office };

function totals(orders: Order[], res: Reservation[]): Totals {
  const ok = orders.filter((o) => o.status !== "cancelled"), revenue = round2(ok.reduce((a, o) => a + (o.total || 0), 0));
  const live = res.filter((r) => r.status !== "cancelled" && r.status !== "waitlist"), noShows = live.filter((r) => r.status === "no_show").length;
  return {
    orders: ok.length, cancelled: orders.length - ok.length, revenue, avg: ok.length ? round2(revenue / ok.length) : 0,
    reservations: live.length, people: live.reduce((a, r) => a + r.people, 0), noShows, noShowPct: live.length ? Math.round((noShows / live.length) * 100) : 0,
  };
}

/** the dates of a period (Sofia) */
export function periodRange(today: string, p: Period, from?: string, to?: string): { from: string; to: string } {
  switch (p) {
    case "yesterday": { const y = addDaysYmd(today, -1); return { from: y, to: y }; }
    case "7": return { from: addDaysYmd(today, -6), to: today };
    case "30": return { from: addDaysYmd(today, -29), to: today };
    case "month": return { from: today.slice(0, 8) + "01", to: today };
    case "custom": {
      if (!from || !to || !validYmd(from) || !validYmd(to) || from > to || to > today || diff(from, to) + 1 > REPORT_MAX_DAYS) throw Object.assign(new CoreError("invalid", REPORT_MSG.range, 422), { fields: { from: REPORT_MSG.range } });
      return { from, to };
    }
    default: return { from: today, to: today };
  }
}

/** every sum to null (revenue, avg; share by turnover becomes the share by orders) */
export function withoutMoney(r: Report): ReportView {
  const t = (x: object): Record<string, unknown> => { const o: Record<string, unknown> = { ...x }; if ("revenue" in o) o.revenue = null; if ("avg" in o) o.avg = null; return o; };
  const n = r.byChannel.reduce((a, c) => a + c.orders, 0);
  return {
    ...t(r), money: false,
    byChannel: r.byChannel.map((c) => ({ ...t(c), share: n ? Math.round((c.orders / n) * 100) : 0 })),
    byHour: r.byHour.map(t), byDay: r.byDay.map(t), top: r.top.map(t), prev: r.prev ? t(r.prev) : null,
  } as unknown as ReportView;
}

export async function report(ctx: Ctx, s: StaffCtx, q: { period?: Period; from?: string; to?: string; compare?: boolean } = {}): Promise<ReportView> {
  need(s, "reports");
  const today = sofiaYmd(nowDate(ctx)), period: Period = (["today", "yesterday", "7", "30", "month", "custom"] as Period[]).includes(q.period as Period) ? (q.period as Period) : "today";
  const { from, to } = periodRange(today, period, q.from, q.to);
  const days = diff(from, to) + 1;
  const all = await ctx.repo.list<Order>(COL.orders), res = await ctx.repo.list<Reservation>(COL.reservations);
  const now = minutes(ctx.clock), onlyToday = from === today && to === today;
  const inR = (d: string, a: string, b: string) => d >= a && d <= b;
  const orders = all.filter((o) => inR(dayOf(o), from, to)), bookings = res.filter((r) => inR(r.date, from, to));
  const ok = orders.filter((o) => o.status !== "cancelled");
  const t = totals(orders, bookings);
  const byChannel = ["web", "phone", "table", "office"].map((c) => {
    const l = ok.filter((o) => chKey(o.channel) === c), revenue = round2(l.reduce((a, o) => a + (o.total || 0), 0));
    return { channel: c, label: CH_LABEL[c], orders: l.length, revenue, share: t.revenue ? Math.round((revenue / t.revenue) * 100) : 0 };
  });
  const byHour: Report["byHour"] = [];
  for (let h = 10; h <= 22; h++) { const l = ok.filter((o) => Math.floor(minOf(o) / 60) === h); byHour.push({ hour: h, orders: l.length, revenue: round2(l.reduce((a, o) => a + (o.total || 0), 0)) }); }
  const byDay: Report["byDay"] = [];
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) {
    const l = ok.filter((o) => dayOf(o) === d), r = bookings.filter((x) => x.date === d && x.status !== "cancelled" && x.status !== "waitlist");
    byDay.push({ date: d, orders: l.length, revenue: round2(l.reduce((a, o) => a + (o.total || 0), 0)), reservations: r.length, noShows: r.filter((x) => x.status === "no_show").length });
  }
  const dish = new Map<string, { id: string; name: string; q: number; revenue: number }>();
  for (const o of ok) for (const l of o.lines) {
    const x = dish.get(l.id) || { id: l.id, name: l.name || l.id, q: 0, revenue: 0 };
    x.q += l.q; x.revenue = round2(x.revenue + (l.unit || 0) * l.q); dish.set(l.id, x);
  }
  const top = [...dish.values()].sort((a, b) => b.q - a.q || b.revenue - a.revenue).slice(0, 8);
  let prev: Report["prev"] = null;
  if (q.compare !== false) {
    const pf = addDaysYmd(from, -days), pt = addDaysYmd(to, -days);
    /* today: yesterday until the same time */
    const po = all.filter((o) => inR(dayOf(o), pf, pt) && (!onlyToday || minOf(o) <= now));
    prev = { ...totals(po, res.filter((r) => inR(r.date, pf, pt))), from: pf, to: pt };
  }
  const full: Report = {
    period, from, to, days, until: onlyToday ? String(Math.floor(now / 60)).padStart(2, "0") + ":" + String(now % 60).padStart(2, "0") : null,
    ...t, byChannel, byHour, byDay, top, prev, cost: null, sample: orders.some((o) => (o as Order & { sample?: boolean }).sample), money: true,
  };
  return may(s, "finance") ? full : withoutMoney(full);
}
