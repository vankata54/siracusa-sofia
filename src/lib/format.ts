/* Formatting helpers shared by server (Astro) and browser. */

/** Price in euro: 10.2 -> "10,20 €" */
export function fmt(p: number): string {
  return (Math.round(p * 100) / 100).toFixed(2).replace(".", ",") + " €";
}

/** The same with a non-breaking space ("10,20\u00a0€"): for prices in running text, outside a .price span
    (fmt() keeps the normal space: HTML, JSON-LD and tests compare it; .price is already white-space:nowrap). */
export function fmtNb(p: number): string { return fmt(p).replace(" €", "\u00a0€"); }
/** "35 мин" with a non-breaking space */
export const mins = (n: number): string => n + "\u00a0мин";

/** HTML-escape for text and attribute values. */
export function esc(s: unknown): string {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** "1 ястие" / "3 ястия" (Bulgarian has one plural form for counts > 1). */
export function plural(n: number, one: string, many: string): string {
  return n + " " + (n === 1 ? one : many);
}

export const MON = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"];
export const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
export const DAYS = ["неделя", "понеделник", "вторник", "сряда", "четвъртък", "петък", "събота"];
export const DAYS_SHORT = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];

/** "сб, 28 ноември" */
export function dateLong(d: Date): string {
  return DAYS_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
}
/** "сб, 28 ное" */
export function dateShort(d: Date): string {
  return DAYS_SHORT[d.getDay()] + ", " + d.getDate() + " " + MON[d.getMonth()];
}
/** "събота, 28 ноември" */
export function dateFull(d: Date): string {
  return DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
}

/** "19:00" from minutes since midnight, {h,m} or a Date. */
export function hhmm(t: number | { h: number; m: number } | Date): string {
  let h: number, m: number;
  if (typeof t === "number") { h = Math.floor(t / 60) % 24; m = t % 60; }
  else if (t instanceof Date) { h = t.getHours(); m = t.getMinutes(); }
  else { h = t.h; m = t.m; }
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

/** Bulgarian phone: "0888123456" / "+359888123456" -> "0888123456", or null when invalid (10 digits starting with 0). */
export function normPhone(v: string): string | null {
  let d = String(v || "").replace(/[\s\-().\/]/g, "");
  if (/^00359/.test(d)) d = "+" + d.slice(2);
  if (/^\+359\d{9}$/.test(d)) return "0" + d.slice(4);
  return /^0\d{9}$/.test(d) ? d : null;
}

/** "0888123456" -> "0888 12 34 56" */
export function prettyPhone(d: string): string {
  const n = normPhone(d);
  return n ? n.slice(0, 4) + " " + n.slice(4, 6) + " " + n.slice(6, 8) + " " + n.slice(8) : d;
}
