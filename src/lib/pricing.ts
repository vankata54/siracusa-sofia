/* Order pricing (port of cart.html info()): -30% on lunch items after 15:00 ONLY for pickup, zone fee
   (free zones 0, paid zones unknown = [ЛИПСВА: такса], so the total is shown without the fee + a note). */
import { byId, isOut, type Dish, type Zone } from "./data.ts";
import { state, eta } from "./status.ts";
import { minutes, type ClockInput } from "./time.ts";
import { zoneMin } from "./zones.ts";
import type { Cart, Mode } from "./cart.ts";

export const LUNCH_PICKUP_DISCOUNT = 0.3;
export const FEE_MISSING = "[ЛИПСВА: такса за доставка]";

export interface PricedRow { key: string; x: Dish; q: number; mods: string[]; unit: number; tot: number; out: boolean; disc: number }
export interface Priced {
  mode: Mode; rows: PricedRow[]; n: number; outN: number; sub: number; disc: number; fee: number | null; feeUnknown: boolean;
  total: number; hasLunch: boolean; hasTrad: boolean; deliveryOk: boolean; closed: boolean;
  /** "" | "delivery" (lunch cannot be delivered after 15:00) | "sched" (kitchen closed / pre-order with lunch items) */
  conflict: "" | "delivery" | "sched";
  etaMin: number; busy: boolean; earliest: number;
}

/** Is the -30% lunch discount active for this mode and time? */
export function lunchDiscountActive(mode: Mode, o?: ClockInput): boolean {
  return state(o).lunchDiscount && mode === "pickup";
}

export function round2(v: number): number { return Math.round(v * 100) / 100; }

/** Fee for a zone: 0 free, null unknown (paid zones until the owner gives the fee). */
export function zoneFee(z: Zone | null): number | null {
  if (!z) return 0;
  return z.free ? 0 : (z.fee ?? null);
}

export function price(cart: Cart, opts: { zone?: Zone | null; scheduled?: boolean; clock?: ClockInput } = {}): Priced {
  const s = state(opts.clock), m = minutes(opts.clock), sched = !!opts.scheduled, today = !sched;
  const deliveryOk = sched ? true : s.delivery;
  const mode: Mode = cart.mode === "pickup" || !deliveryOk ? "pickup" : "delivery";
  const rows: PricedRow[] = [];
  let sub = 0, n = 0, outN = 0, hasLunch = false, hasTrad = false;
  for (const l of cart.lines) {
    const x = byId[l.id];
    if (!x) continue;
    const unit = x.p + (l.extra || 0);
    const r: PricedRow = { key: l.key, x, q: l.q, mods: l.mods, unit, tot: unit * l.q, out: isOut(x), disc: 0 };
    rows.push(r);
    if (r.out) { outN++; continue; }
    n += l.q; sub += r.tot;
    if (x.lunch) hasLunch = true; else hasTrad = true;
  }
  const lunchDisc = today && s.lunchDiscount && mode === "pickup";
  let disc = 0;
  for (const r of rows) if (!r.out && r.x.lunch && lunchDisc) { r.disc = Math.round(r.tot * 30) / 100; disc += r.disc; }
  const closed = today && !s.kitchen;
  const conflict = !hasLunch ? "" : closed || sched ? "sched" : mode === "delivery" && !s.lunch ? "delivery" : "";
  const zone = mode === "delivery" ? opts.zone || null : null;
  const fee = mode === "delivery" ? zoneFee(zone) : 0;
  const e = eta(opts.clock);
  const etaMin = zone ? zoneMin(zone) + (e.busy ? 20 : 0) : e.min;
  return {
    mode, rows, n, outN, sub: round2(sub), disc: round2(disc), fee, feeUnknown: mode === "delivery" && fee === null,
    total: round2(sub - disc + (fee || 0)), hasLunch, hasTrad, deliveryOk, closed, conflict,
    etaMin, busy: e.busy, earliest: m + (hasTrad ? 20 : 0),
  };
}

/** Pickup slots every 15 min up to 3 hours ahead, not after 22:30 (pre-orders: the whole day). */
export function pickupSlots(p: Pick<Priced, "earliest" | "mode">, o?: ClockInput, sched = false): number[] {
  const m = minutes(o);
  let a: number, b: number;
  if (sched) { a = 630; b = p.mode === "delivery" ? 1245 : 1350; }
  else { if (p.mode === "delivery") return []; a = Math.ceil((p.earliest + 1) / 15) * 15; b = Math.min(m + 180, 1350); }
  const out: number[] = [];
  for (let i = a; i <= b; i += 15) out.push(i);
  return out;
}
