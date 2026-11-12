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

/** For the API (server and demo): the date as "YYYY-MM-DD" (a Date would travel as UTC and lose a day at night).
    The function is in events-json.ts (this module is in the shared runtime, size budget). */
export type SiteEventJson = Omit<SiteEvent, "date"> & { date: string };
