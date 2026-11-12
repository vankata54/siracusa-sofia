/* Order pricing (port of cart.html info()): -30% on lunch items after 15:00 ONLY for pickup, zone fee
   (free zones 0, paid zones unknown = [ЛИПСВА: такса], so the total is shown without the fee + a note).
   The price ALWAYS comes from the menu: the unit price is the dish price + the add-ons named in `mods`
   ("+ Кашкавал" -> the dish "Кашкавал" of the "dobavki" category). `extra`, `p` and `n` saved in a cart line are
   never used for the order (they are only a hint for the runtime without the menu). */
import { byId, isOut, items, ORDER_RULES, type Dish, type Zone } from "./data.ts";
import { state, eta, busyExtra } from "./status.ts";
import { minutes, type ClockInput } from "./time.ts";
import { hhmm } from "./format.ts";
import { zoneMin } from "./zones.ts";
import type { Cart, Mode } from "./cart.ts";

import { LUNCH_PICKUP_DISCOUNT } from "./lunch.ts";
export { LUNCH_PICKUP_DISCOUNT };
export const FEE_MISSING = "[ЛИПСВА: такса в €]";

export interface PricedRow { key: string; x: Dish; q: number; mods: string[]; unit: number; tot: number; out: boolean; disc: number; badMod: string | null }
export interface Priced {
  mode: Mode; rows: PricedRow[]; n: number; outN: number; sub: number; disc: number; fee: number | null; feeUnknown: boolean;
  total: number; hasLunch: boolean; hasTrad: boolean; deliveryOk: boolean; closed: boolean;
  /** "" | "delivery" (lunch cannot be delivered after 15:00) | "sched" (kitchen closed / pre-order with lunch items) */
  conflict: "" | "delivery" | "sched";
  etaMin: number; busy: boolean; earliest: number;
  /** which discount is applied: none, the lunch -30% (pickup after 15:00) or a code; never both (the better one wins) */
  discKind: "" | "lunch" | "code" | "profile";
  /** what each would give (for the cart: "Отстъпка с код: -X €" or why the code is not used) */
  lunchDisc: number; codeDisc: number; profileDisc: number;
}

/** Is the -30% lunch discount active for this mode and time? */
export function lunchDiscountActive(mode: Mode, o?: ClockInput): boolean {
  return state(o).lunchDiscount && mode === "pickup";
}

export function round2(v: number): number { return Math.round(v * 100) / 100; }

export { lunchPrice } from "./lunch.ts";

/** Fee for a zone: 0 free, null unknown (paid zones until the owner gives the fee). */
export function zoneFee(z: Zone | null): number | null {
  if (!z) return 0;
  return z.free ? 0 : (z.fee ?? null);
}

/* ---------- add-ons and removals ---------- */
const norm = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
let addonIdx: Record<string, Dish> | null = null;
/** Add-ons by id and by name (lower case): only the "dobavki" category. */
export function addonLookup(): Record<string, Dish> {
  if (addonIdx) return addonIdx;
  const m: Record<string, Dish> = {};
  for (const x of items) if (x.cat === ORDER_RULES.addonCat) { m[x.id] = x; m[norm(x.n)] = x; }
  return (addonIdx = m);
}
export const ingredients = (x: Dish): string[] => (x.comp ? x.comp.split(",").map((s) => s.trim()).filter(Boolean) : []);
export const takesAddons = (x: Dish): boolean => (ORDER_RULES.addonCats as readonly string[]).indexOf(x.cat) > -1;

/** Checks the modifications of one line against the menu. extra = the add-ons' prices from the menu.
    bad = the first modification that is not allowed (unknown add-on, an ingredient the dish does not have, a duplicate). */
export function parseMods(x: Dish, mods: string[]): { extra: number; adds: string[]; bad: string | null; mods: string[] } {
  /* normalized: "+кашкавал", "+  КАШКАВАЛ " and "+ Кашкавал" are the same add-on (by id), "без  Лук" = "без лук";
     a repeated add-on or removal is refused, so nothing is charged twice. mods = the clean form ("+ Кашкавал", "без лук"). */
  const A = addonLookup(), seen = new Set<string>(), adds: string[] = [], out: string[] = [];
  let extra = 0, bad: string | null = null;
  for (const raw of mods) {
    const m = String(raw).trim().replace(/\s+/g, " ");
    if (bad) break;
    if (!m || m.length > 120) { bad = m || "(празно)"; break; }
    if (m.startsWith("+")) {
      const a = A[norm(m.slice(1))];
      if (!a || x.lunch || !takesAddons(x) || isOut(a) || seen.has("add:" + a.id)) { bad = m; break; }
      seen.add("add:" + a.id); adds.push(a.id); extra += a.p; out.push("+ " + a.n);
    } else if (/^без\s+\S/i.test(m)) {
      /* removals are free (no price effect): the dish's own ingredients or a short wish such as "без лук" */
      const what = m.replace(/^без\s+/i, "").trim(), key = "rem:" + norm(what);
      if (m.length > 60 || /[<>{}]/.test(m) || seen.has(key)) { bad = m; break; }
      seen.add(key); out.push("без " + what);
    } else bad = m;
  }
  return { extra: round2(extra), adds, bad, mods: out };
}

export interface PriceOpts { zone?: Zone | null; scheduled?: boolean; clock?: ClockInput; busy?: boolean; codePct?: number;
  /** the one-time -10% for a new profile (first order after sign-up, signed in, the profile's phone) */
  profilePct?: number }

export function price(cart: Cart, opts: PriceOpts = {}): Priced {
  const s = state(opts.clock), m = minutes(opts.clock), sched = !!opts.scheduled, today = !sched;
  const deliveryOk = sched ? true : s.delivery;
  const mode: Mode = cart.mode === "pickup" || !deliveryOk ? "pickup" : "delivery";
  const rows: PricedRow[] = [];
  let sub = 0, n = 0, outN = 0, hasLunch = false, hasTrad = false;
  for (const l of cart.lines) {
    const x = byId[l.id];
    if (!x) continue;
    const pm = parseMods(x, l.mods || []);
    const unit = round2(x.p + pm.extra);
    const r: PricedRow = { key: l.key, x, q: l.q, mods: l.mods, unit, tot: round2(unit * l.q), out: isOut(x), disc: 0, badMod: pm.bad };
    rows.push(r);
    if (r.out) { outN++; continue; }
    n += l.q; sub += r.tot;
    if (x.lunch) hasLunch = true; else hasTrad = true;
  }
  const lunchOn = today && s.lunchDiscount && mode === "pickup";
  let lunchDisc = 0;
  if (lunchOn) for (const r of rows) if (!r.out && r.x.lunch) { r.disc = Math.round(r.tot * Math.round(LUNCH_PICKUP_DISCOUNT * 100)) / 100; lunchDisc += r.disc; }
  lunchDisc = round2(lunchDisc);
  const codeDisc = opts.codePct && opts.codePct > 0 ? round2((sub * opts.codePct) / 100) : 0;
  const profileDisc = opts.profilePct && opts.profilePct > 0 ? round2((sub * opts.profilePct) / 100) : 0;
  /* never together: the best one for the customer. Ties: lunch (no code or bonus spent), then the code typed by the
     customer, then the profile bonus (it stays for a later order). */
  const best = Math.max(lunchDisc, codeDisc, profileDisc);
  const discKind: Priced["discKind"] = best <= 0 ? "" : lunchDisc === best ? "lunch" : codeDisc === best ? "code" : "profile";
  if (discKind === "code" || discKind === "profile") rows.forEach((r) => { r.disc = 0; });
  const disc = discKind === "" ? 0 : best;
  const closed = today && !s.kitchen;
  const conflict = !hasLunch ? "" : closed || sched ? "sched" : mode === "delivery" && !s.lunch ? "delivery" : "";
  const zone = mode === "delivery" ? opts.zone || null : null;
  const fee = mode === "delivery" ? zoneFee(zone) : 0;
  const e = eta(opts.clock, opts.busy);
  const etaMin = zone ? zoneMin(zone) + (e.busy ? busyExtra() : 0) : e.min;
  return {
    mode, rows, n, outN, sub: round2(sub), disc: round2(disc), fee, feeUnknown: mode === "delivery" && fee === null,
    total: round2(sub - disc + (fee || 0)), hasLunch, hasTrad, deliveryOk, closed, conflict,
    etaMin, busy: e.busy, earliest: m + (hasTrad ? ORDER_RULES.pickupLeadMin : 0), discKind, lunchDisc, codeDisc, profileDisc,
  };
}

/** Pickup slots every 15 min up to 3 hours ahead, not after 22:30 (pre-orders: the whole day). */
export function pickupSlots(p: Pick<Priced, "earliest" | "mode">, o?: ClockInput, sched = false): number[] {
  const m = minutes(o);
  let a: number, b: number;
  const R = ORDER_RULES, step = R.slotStep;
  if (sched) { a = R.preorderFrom; b = p.mode === "delivery" ? R.preorderDeliveryUntil : R.pickupUntil; }
  else { if (p.mode === "delivery") return []; a = Math.ceil((p.earliest + 1) / step) * step; b = Math.min(m + R.horizonMin, R.pickupUntil); }
  const out: number[] = [];
  for (let i = a; i <= b; i += step) out.push(i);
  return out;
}

/** Is this "HH:MM" one of the allowed slots (format, future, opening hours, 15 min step, earliest, 3 hours ahead)? */
export function slotAllowed(p: Pick<Priced, "earliest" | "mode">, slot: string, o?: ClockInput, sched = false): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot))) return false;
  const t = +slot.slice(0, 2) * 60 + +slot.slice(3);
  return pickupSlots(p, o, sched).indexOf(t) > -1;
}
export const slotLabel = (t: number): string => hhmm(t);
