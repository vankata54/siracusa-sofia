/* Events: only real or pack-defined items. */
import { lastSaturday } from "./status.ts";

export interface SiteEvent { id: string; n: string; cat: string; date: Date; time: string; price: number | null; free: boolean; seatsLeft: number | null; text: string; note: string }

export function events(today: Date = new Date()): SiteEvent[] {
  const ls = lastSaturday(today);
  return [{
    id: "gratska-vecher", n: "Гръцка вечер", cat: "Тематични вечери", date: ls.d, time: "19:00", price: null, free: false, seatsLeft: null,
    text: "Всяка последна събота от месеца кухнята сменя посоката. Този път: Гърция.", note: "[ЛИПСВА: програма, меню и цена]",
  }];
}
export const EVENT_SLUGS = ["gratska-vecher"];

/** For the API (server and demo): the date as "YYYY-MM-DD" (a Date would travel as UTC and lose a day at night). */
export type SiteEventJson = Omit<SiteEvent, "date"> & { date: string };
export function eventsJson(today: Date = new Date()): SiteEventJson[] {
  const ymd = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return events(today).map((e) => ({ ...e, date: ymd(e.date) }));
}
