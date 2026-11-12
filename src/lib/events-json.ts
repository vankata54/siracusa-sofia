/* eventsJson for the API (server and demo core): NOT in lib/events.ts, which is part of the shared runtime (size budget). */
import { events, type SiteEventJson } from "./events.ts";

/** The events with the date as "YYYY-MM-DD" (a Date would travel as UTC and lose a day at night). */
export function eventsJson(today: Date = new Date()): SiteEventJson[] {
  const ymd = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  return events(today).map((e) => ({ ...e, date: ymd(e.date) }));
}
