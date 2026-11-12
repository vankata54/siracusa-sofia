/* Events (/sabitia/) and Event (/sabitia/<slug>/): the date of an evening and its Event JSON-LD, one approach for both pages.
   - The date comes from src/lib/events.ts (server: events(sofiaToday()) at build) or api.events() ("YYYY-MM-DD").
   - The server writes startDate with the build date; the browser rewrites the same <script type="application/ld+json">
     with today's date in Sofia, so the page never shows a past evening as upcoming. The HTML still needs a build at
     least once a week (after the last Saturday) for tools that do not run JS (reviews-code/events.agent.md).
   - No endDate: the end of the evening is not known (only the closing time of the restaurant). No offers while the
     price is [ЛИПСВА]. Tiny module (no icons, no menu) so both pages can ship it to the browser. */
import { RESTAURANT as R } from "../../lib/consts.ts";
import type { SiteEvent } from "../../lib/events.ts";
import { url } from "../../lib/routes.ts";

const pad = (n: number): string => (n < 10 ? "0" : "") + n;
/** local Date -> "YYYY-MM-DD" */
export const ymd = (d: Date): string => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
/** Today in Sofia as a local midnight Date (the build machine or the browser may be in another time zone). */
export function sofiaToday(now: Date = new Date()): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
/** "+02:00" / "+03:00" in Sofia on that day (EEST from the last Sunday of March to the last Sunday of October). */
export function sofiaOffset(d: Date): string {
  const y = d.getFullYear();
  const lastSun = (m: number) => { const x = new Date(y, m + 1, 0); while (x.getDay() !== 0) x.setDate(x.getDate() - 1); return x; };
  const day = new Date(y, d.getMonth(), d.getDate());
  return day >= lastSun(2) && day < lastSun(9) ? "+03:00" : "+02:00";
}
/** api.events() gives "YYYY-MM-DD" (older demo data: a Date): always a local midnight Date. */
export function normEvent(e: SiteEvent | (Omit<SiteEvent, "date"> & { date: string })): SiteEvent {
  const raw = e.date as Date | string;
  let d: Date;
  if (raw instanceof Date) d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  else {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw));
    d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : sofiaToday(new Date(raw));
  }
  return { ...(e as SiteEvent), date: d };
}

export const BREAD_EVENTS = "Събития и поводи";
const PLACE = (site: string) => ({
  "@type": "Restaurant", name: R.name, telephone: R.phoneIntl, url: new URL(url.home(), site).href,
  address: { "@type": "PostalAddress", streetAddress: R.street, postalCode: R.postalCode, addressLocality: R.city, addressCountry: "BG" },
});

/** Event JSON-LD with startDate (date of the evening + its time, Sofia offset). The themed nights repeat every
    last Saturday: they also get eventSchedule (start time only, the end is not known). */
export function eventLd(ev: SiteEvent, site: string): Record<string, unknown> {
  const page = new URL(url.event(ev.id), site).href;
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org", "@type": "Event", name: ev.n, description: ev.text, url: page,
    startDate: ymd(ev.date) + "T" + ev.time + ":00" + sofiaOffset(ev.date),
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", inLanguage: "bg",
    location: PLACE(site),
    organizer: { "@type": "Organization", name: R.name, url: new URL(url.home(), site).href },
  };
  if (ev.cat === "Тематични вечери") ld.eventSchedule = { "@type": "Schedule", repeatFrequency: "P1M", byDay: "https://schema.org/Saturday", byMonthWeek: -1, startTime: ev.time + ":00", scheduleTimezone: "Europe/Sofia" };
  if (ev.free || ev.price) ld.offers = { "@type": "Offer", price: ev.free ? 0 : ev.price, priceCurrency: "EUR", url: page };
  return ld;
}
/** BreadcrumbList: Начало > Събития и поводи [> the event] (the same name on both pages) */
export function crumbsLd(site: string, ev?: SiteEvent): Record<string, unknown> {
  const items = [{ "@type": "ListItem", position: 1, name: "Начало", item: new URL(url.home(), site).href },
    { "@type": "ListItem", position: 2, name: BREAD_EVENTS, item: new URL(url.events(), site).href }];
  if (ev) items.push({ "@type": "ListItem", position: 3, name: ev.n, item: new URL(url.event(ev.id), site).href });
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
}
/** the site origin in the browser: from <link rel="canonical"> (the address the server wrote), else this origin */
export function siteOrigin(): string {
  try { const c = document.querySelector<HTMLLinkElement>('link[rel="canonical"]'); if (c && c.href) return new URL(c.href).origin + "/"; } catch { /* ignore */ }
  return location.origin + "/";
}
