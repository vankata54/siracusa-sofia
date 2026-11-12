/* Pickup and pre-order time slots WITHOUT the menu (safe for light pages: /vzemi-ot-myasto/ paints before the menu chunk).
   The one rule for the core (core/orders.ts), the cart and /vzemi-ot-myasto/. pricing.ts re-exports everything here. */
import { ORDER_RULES } from "./consts.ts";
import { state } from "./status.ts";
import { minutes, type ClockInput } from "./time.ts";
import { hhmm } from "./format.ts";

/** what the slot rules need from a priced cart: the earliest minute it can be ready, and the mode */
export interface SlotInput { earliest: number; mode: "delivery" | "pickup" }

/** Pickup slots every 15 min up to 3 hours ahead, not after 22:30 (pre-orders: the whole day). */
export function pickupSlots(p: SlotInput, o?: ClockInput, sched = false): number[] {
  const m = minutes(o);
  let a: number, b: number;
  const R = ORDER_RULES, step = R.slotStep;
  if (sched) { a = R.preorderFrom; b = p.mode === "delivery" ? R.preorderDeliveryUntil : R.pickupUntil; }
  else { if (p.mode === "delivery") return []; a = Math.ceil((p.earliest + 1) / step) * step; b = Math.min(m + R.horizonMin, R.pickupReadyUntil); }
  const out: number[] = [];
  for (let i = a; i <= b; i += step) out.push(i);
  return out;
}

/** Pickup TODAY, the one rule for the core and the screens (decision 12.11.2026): "Кухнята приема поръчки до 22:30" is the
    last minute to PLACE an order (state().kitchen), not the time it is ready. Until then "Възможно най-скоро" and the slots
    every 15 min, ready at the latest at closing (23:00) and never sooner than the lead time (20 min with dishes from the menu).
    From 22:30: nothing today ("Поръчай за утре"). */
export function pickupToday(p: SlotInput, o?: ClockInput): { ok: boolean; asap: boolean; slots: number[] } {
  const ok = state(o).kitchen && p.mode === "pickup";
  return { ok, asap: ok && p.earliest <= ORDER_RULES.pickupReadyUntil, slots: ok ? pickupSlots(p, o, false) : [] };
}

/** While the kitchen has "Натоварено" on, today's pickup slots in the next hour are full ("заето"). The one rule for the
    core, the cart and /vzemi-ot-myasto/ (t, m: minutes of the day; only for today, never for a pre-order). */
export const BUSY_FULL_MIN = 60;
export function slotBusy(t: number, m: number, busy: boolean): boolean {
  return busy && t < m + BUSY_FULL_MIN;
}

/** Is this "HH:MM" one of the allowed slots (format, future, opening hours, 15 min step, earliest, 3 hours ahead)? */
export function slotAllowed(p: SlotInput, slot: string, o?: ClockInput, sched = false): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot))) return false;
  const t = +slot.slice(0, 2) * 60 + +slot.slice(3);
  return pickupSlots(p, o, sched).indexOf(t) > -1;
}
export const slotLabel = (t: number): string => hhmm(t);

/** The kitchen lead time for a pickup: dishes from the menu need ORDER_RULES.pickupLeadMin, the lunch menu is ready at once
    (the same as price().earliest - now). */
export const leadMin = (hasTrad: boolean): number => (hasTrad ? ORDER_RULES.pickupLeadMin : 0);
