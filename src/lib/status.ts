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
  if (m < 1350) return { cls: "warn", html: '<b>Доставката приключи за днес</b> <span class="nw">· Вземане до 22:30</span>' };
  return { cls: "warn", html: '<b>Кухнята затвори</b> <span class="nw">· Отворено до 23:00</span>' };
}

export interface Eta { min: number; busy: boolean; text: string }
/* "Натоварено" is ONLY the manual switch in the kitchen (decision 04.11.2026); +20 min. The runtime sets it from the settings. */
let kitchenBusy = false;
export function setKitchenBusy(b: boolean): void { kitchenBusy = !!b; }
export function isKitchenBusy(): boolean { return kitchenBusy; }
/** Honest delivery estimate: "около 35 мин", or "около 55 мин" while the kitchen has switched on "Натоварено". */
export function eta(_o?: ClockInput, busyOverride?: boolean): Eta {
  const busy = busyOverride ?? kitchenBusy;
  return busy ? { min: 55, busy: true, text: "Възможни са закъснения · около 55 мин" } : { min: 35, busy: false, text: "около 35 мин" };
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
