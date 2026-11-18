/* THE day and hour of an order in the history ("Днес", "Отчети", the owner's module, the dashboard), one rule
   (decision of the chief after the review of the owner's module):
   - the day the order is FOR: a pre-order "за утре" is in tomorrow (orderDay, core/orders.ts), any other order in the
     shift day of the moment it was placed (the day starts at 04:00 Sofia, src/lib/shift-day.ts: 00:30 is still the
     evening before, as for the kitchen and the waiter);
   - the hour: the hour it is for (`slot` "12:00") when it has one, else the hour it was placed;
   - the minute of placing on the shift clock (00:30 = 24:30), for "до същата минута".
   Pure (no DOM, no repo): the server's SQLite repo fills its `day` column with it. */
import { addDaysYmd, sofiaYmd } from "../lib/time.ts";
import { shiftDay, SHIFT_DAY_FROM } from "../lib/shift-day.ts";

export interface DayFields { ts?: number; createdAt?: string; sched?: string; slot?: string; placedAt?: string }
const at = (o: DayFields) => new Date(o.ts || o.createdAt || 0);
/** "YYYY-MM-DD": the day the order is for */
export function histDay(o: DayFields): string {
  return o.sched === "утре" ? addDaysYmd(sofiaYmd(new Date(o.createdAt || o.ts || 0)), 1) : shiftDay(at(o));
}
/** minutes on the shift clock: before 04:00 counts after midnight of the evening (00:30 -> 1470) */
export const shiftMin = (m: number): number => (m < SHIFT_DAY_FROM ? m + 1440 : m);
const hhmm = (v: string | undefined) => (/^\d{2}:\d{2}$/.test(v || "") ? +v!.slice(0, 2) * 60 + +v!.slice(3) : null);
/** the minute the order was placed, on the shift clock */
export const placedMin = (o: DayFields): number => shiftMin(hhmm(o.placedAt) ?? 0);
/** the hour of the order (the hour it is for when it has a slot), on the shift clock: 0-3 -> 24-27 */
export function hourOf(o: DayFields): number {
  const m = hhmm(o.slot) ?? hhmm(o.placedAt) ?? 0;
  return Math.floor(shiftMin(m) / 60);
}
