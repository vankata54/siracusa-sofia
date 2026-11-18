/* The shift day of the restaurant: ONE rule for the kitchen, the waiter's shift, the sittings at the tables and the
   orders kept on a waiter's phone. It starts at 04:00 Sofia: a moment before 04:00 belongs to the day before (an order at
   23:58 and one at 00:30 are the same evening). No DOM; the server, the demo core and the screens use it. */
import { sofiaYmd, sofiaNow, addDaysYmd } from "./time.ts";

/** minutes after midnight (Sofia) when the shift day starts */
export const SHIFT_DAY_FROM = 240;
/** "YYYY-MM-DD" of the shift day of a moment (Sofia; before 04:00 it is the day before) */
export function shiftDay(d: Date = new Date()): string {
  const ymd = sofiaYmd(d), c = sofiaNow(d);
  return c.h * 60 + c.m >= SHIFT_DAY_FROM ? ymd : addDaysYmd(ymd, -1);
}
