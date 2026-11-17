/* Reports (section "Отчети"; design/pages-admin/reports.html, README-3): for a period (today, yesterday, 7 days,
   30 days, this month, from-to up to 92 days) the orders (without the cancelled, "+N отказани"), the turnover (the
   orders' totals), the average bill, by channel, by hour, by day, the top dishes, the reservations and the no-shows,
   and the same numbers for the period before ("Сравни с предишния").
   THE NUMBERS come from the one history (core/history.ts), the same as the owner's module: the same period gives the
   same numbers in both. "Предишният период" (the same base as the owner's module, BUILD-TODO step 6): "Днес" = the same
   weekday last week up to the same minute, "Вчера" = the same weekday last week, "Месец" = the previous month from its
   1st (the same number of days), 7 / 30 / custom = the days right before.
   No personal data (no names, phones, addresses). The cost of the dishes is [ЛИПСВА: себестойност] (null).
   Money (turnover, average bill, the sums by channel, hour, day and dish) only with the section "finance" (the main admin
   and the owner by default; decision 17.11.2026, OPEN-QUESTIONS 7: the manager is like the owner without finances): without
   it every sum is null and `money` is false, so the manager sees orders, reservations and no-shows, never a sum. */
import type { Ctx } from "./ctx.ts";
import type { StaffCtx } from "./staff.ts";
import { need, may } from "./rights.ts";
import { loadHistory, slice, totals, byChannel, byHour, byDay, top8, periodRange, compareRange, asPeriod, hm, isSample, HISTORY_MAX_DAYS, HISTORY_MSG, span, type Period, type Totals } from "./history.ts";

export type { Period, Totals };
export { periodRange };
export const REPORT_MAX_DAYS = HISTORY_MAX_DAYS;
export const REPORT_MSG = HISTORY_MSG;

export interface Report extends Totals {
  period: Period; from: string; to: string; days: number;
  /** today until this time (the comparison goes to the same minute of the same weekday last week) */
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

/** The whole report with every sum, for one period (the owner's module calls the same: core/owner.ts). */
export async function reportFull(ctx: Ctx, q: { period?: Period; from?: string; to?: string; compare?: boolean } = {}): Promise<Report> {
  const h = await loadHistory(ctx), period = asPeriod(q.period);
  const { from, to } = periodRange(h.today, period, q.from, q.to);
  const onlyToday = from === h.today && to === h.today, cur = slice(h, from, to);
  let prev: Report["prev"] = null;
  if (q.compare !== false) {
    const c = compareRange(period, from, to, "prev");
    prev = { ...totals(slice(h, c.from, c.to, onlyToday ? h.now : null)), from: c.from, to: c.to };
  }
  return {
    period, from, to, days: span(from, to), until: onlyToday ? hm(h.now) : null,
    ...totals(cur), byChannel: byChannel(cur), byHour: byHour(cur), byDay: byDay(cur).map(({ cancelled: _c, ...d }) => d), top: top8(cur), prev,
    cost: null, sample: cur.orders.some(isSample), money: true,
  };
}

export async function report(ctx: Ctx, s: StaffCtx, q: { period?: Period; from?: string; to?: string; compare?: boolean } = {}): Promise<ReportView> {
  need(s, "reports");
  const full = await reportFull(ctx, q);
  return may(s, "finance") ? full : withoutMoney(full);
}
