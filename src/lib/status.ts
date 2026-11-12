/* Opening hours, the three states and the delivery estimate (port of SC.state / SC.status / SC.eta / SC.lastSaturday).
   Hours: open 10:00-23:00, kitchen until 22:30, delivery until 21:00, lunch 10:00-15:00, -30% lunch pickup 15:00-22:30,
   breakfast until 11:30. */
import { minutes, type ClockInput } from "./time.ts";

export interface State { open: boolean; kitchen: boolean; delivery: boolean; lunch: boolean; lunchDiscount: boolean; breakfast: boolean; m: number }

export function state(o?: ClockInput): State {
  const m = minutes(o);
  return {
    open: m >= 600 && m < 1380, kitchen: m >= 600 && m < 1350, delivery: m >= 600 && m < 1260,
    lunch: m >= 600 && m < 900, lunchDiscount: m >= 900 && m < 1350, breakfast: m >= 600 && m < 690, m,
  };
}

export interface Status { cls: "" | "ok" | "warn"; html: string }

export function status(o?: ClockInput): Status {
  const m = minutes(o);
  if (m < 600) return { cls: "", html: '<b>Затворено</b> <span class="nw">· отваряме в 10:00</span>' };
  if (m >= 1380) return { cls: "", html: '<b>Затворено</b> <span class="nw">· отваряме утре в 10:00</span>' };
  if (m < 1260) return { cls: "ok", html: '<b>Отворено до 23:00</b> <span class="nw">· Доставка до 21:00</span>' };
  if (m < 1350) return { cls: "warn", html: '<b>Доставката приключи за днес</b> <span class="nw">· Поръчки за вземане до 22:30</span>' };
  return { cls: "warn", html: '<b>Кухнята затвори</b> <span class="nw">· Отворено до 23:00</span>' };
}

export interface Eta { min: number; busy: boolean; text: string }
/* "Натоварено" is ONLY the manual switch in the kitchen (decision 04.11.2026): normally "около 35 мин", busy "около 55 мин".
   One source: the kitchen settings in the core (GET /api/status, or the demo store). The runtime (src/client/sc.ts) calls
   setKitchen()/setKitchenBusy() with them; the server does the same for its own process. */
export interface KitchenSettings { busy: boolean; etaMin: number; etaBusyMin: number }
export const KITCHEN_DEFAULT: KitchenSettings = { busy: false, etaMin: 35, etaBusyMin: 55 };
let kitchen: KitchenSettings = { ...KITCHEN_DEFAULT };
const okMin = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 240 ? (v as number) : d);
export function setKitchen(s: Partial<KitchenSettings> | null | undefined): KitchenSettings {
  const c = s || {};
  kitchen = { busy: c.busy == null ? kitchen.busy : !!c.busy, etaMin: okMin(c.etaMin, kitchen.etaMin), etaBusyMin: okMin(c.etaBusyMin, kitchen.etaBusyMin) };
  return kitchen;
}
export function getKitchen(): KitchenSettings { return { ...kitchen }; }
export function setKitchenBusy(b: boolean): void { kitchen = { ...kitchen, busy: !!b }; }
export function isKitchenBusy(): boolean { return kitchen.busy; }
/** Extra minutes while "Натоварено" is on (default 20), added to the zone times too. */
export function busyExtra(): number { return Math.max(0, kitchen.etaBusyMin - kitchen.etaMin); }
/** Non-breaking space between the number and "мин" (never "35 / мин" on two lines). */
export const NBSP = "\u00a0";
/** Honest delivery estimate: "около 35 мин", or "Възможни са закъснения · около 55 мин" while "Натоварено" is on. */
export function eta(_o?: ClockInput, busyOverride?: boolean): Eta {
  const busy = busyOverride ?? kitchen.busy;
  return busy ? { min: kitchen.etaBusyMin, busy: true, text: "Възможни са закъснения · около " + kitchen.etaBusyMin + NBSP + "мин" }
    : { min: kitchen.etaMin, busy: false, text: "около " + kitchen.etaMin + NBSP + "мин" };
}

/** The last Saturday of this month (or next month if it already passed) and the days until it. */
export function lastSaturday(today: Date = new Date()): { d: Date; days: number } {
  const y = today.getFullYear(), mo = today.getMonth();
  const ls = (y: number, mo: number) => { const d = new Date(y, mo + 1, 0); while (d.getDay() !== 6) d.setDate(d.getDate() - 1); return d; };
  let d = ls(y, mo);
  const t = new Date(y, mo, today.getDate());
  if (d < t) d = ls(mo === 11 ? y + 1 : y, (mo + 1) % 12);
  return { d, days: Math.round((d.getTime() - t.getTime()) / 864e5) };
}
