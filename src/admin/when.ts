/* Times of the admin screens "Бележки", "Роли и права", "Дневник" (as A.ago / A.hm / A.fmtDate in
   design/pages-admin/_admin.js), always by the real time in Sofia:
   "току-що", "преди 5 мин", "преди 1 ч. 40 мин" (the same format up to 24 hours), "вчера в 18:40", "сб, 7 ноември в 12:10";
   the hour "19:42"; the day "Днес · нд, 15 ноември", "Вчера · сб, 14 ноември", "пт, 13 ноември". */
import { sofiaYmd, fmtYmd } from "./a.ts";

const pad = (n: number) => String(n).padStart(2, "0");
/** "19:42" in Sofia */
export function hmOf(iso: string | Date): string {
  const d = iso instanceof Date ? iso : new Date(iso);
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":");
    return pad(+p[0] % 24) + ":" + p[1];
  } catch { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
}
/** "YYYY-MM-DD" in Sofia of a moment */
export const ymdOf = (iso: string | Date) => sofiaYmd(iso instanceof Date ? iso : new Date(iso));
/** whole days between two "YYYY-MM-DD" (b - a) */
export function dayDiff(a: string, b: string): number {
  const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
/** "току-що", "преди 12 мин", "преди 1 ч. 35 мин", "вчера в 18:40", "сб, 7 ноември в 12:10" */
export function ago(iso: string, now: Date = new Date()): string {
  const d = new Date(iso), diff = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diff < 1) return "току-що";
  if (diff < 60) return "преди " + diff + " мин";
  if (diff < 1440) { const h = Math.floor(diff / 60), m = diff % 60; return "преди " + h + " ч." + (m ? " " + m + " мин" : ""); }
  const a = ymdOf(d), b = ymdOf(now);
  return (dayDiff(a, b) === 1 ? "вчера" : fmtYmd(a)) + " в " + hmOf(d);
}
/** the heading of a day: "Днес · нд, 15 ноември", "Вчера · сб, 14 ноември", "пт, 13 ноември" */
export function dayTitle(iso: string, now: Date = new Date()): string {
  const a = ymdOf(iso), dd = dayDiff(a, ymdOf(now));
  return (dd === 0 ? "Днес · " : dd === 1 ? "Вчера · " : "") + fmtYmd(a);
}
