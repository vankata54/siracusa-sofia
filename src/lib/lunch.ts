/* Lunch helpers WITHOUT the menu (safe for the shared runtime and light pages):
   lunchIsToday() from the generated date of the lunch menu, lunchPrice() for the -30% after 15:00 (pickup only). */
import { ORDER_RULES } from "./consts.ts";
import { sofiaYmd, isPreview } from "./time.ts";
import { LUNCH_DATE } from "./lunch-date.ts";

export { LUNCH_DATE, LUNCH_DAY_NAME } from "./lunch-date.ts";
export const LUNCH_PICKUP_DISCOUNT = ORDER_RULES.lunchPickupDiscount;

/** The lunch menu in the data is for one date; never present it as "today" on another day. In the preview and the demo
    (isPreview) the lunch menu in the data always counts as today's, on every page (decision 12.11.2026). */
export function lunchIsToday(d: Date = new Date()): boolean { return isPreview() || sofiaYmd(d) === LUNCH_DATE; }

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Price of a lunch dish now: -30% after 15:00 for pickup (st = state(); mode default pickup). Same rounding as price(). */
export function lunchPrice(x: { p: number; lunch?: boolean }, st: { lunchDiscount: boolean }, mode: "delivery" | "pickup" = "pickup"): { p: number; old: number | null; disc: number } {
  if (!x.lunch || !st.lunchDiscount || mode !== "pickup") return { p: x.p, old: null, disc: 0 };
  const disc = Math.round(x.p * Math.round(LUNCH_PICKUP_DISCOUNT * 100)) / 100;
  return { p: r2(x.p - disc), old: x.p, disc };
}
