/* The rules of the offers applied where the core gives a discount (orders.ts): the profile bonus ("signup") and the rating
   code ("rating") need the offer on and the order inside its days, hours, channel and dishes. Edited in offers-admin.ts. */
import { nowDate, type Ctx } from "./ctx.ts";
import { getSection, type OfferRow, type OfferChannel } from "./site-data.ts";
import { minutes, sofiaYmd } from "../lib/time.ts";

export async function liveOffers(ctx: Ctx): Promise<OfferRow[]> { return (await getSection(ctx, "offers")).data; }

export interface OfferContext { day: number; min: number; channel: OfferChannel; dishes: string[] }
/** is the offer on and the order inside its rules (day of the week 0-6 Sunday first, the minutes, the channel, a dish) */
export function offerApplies(o: OfferRow | undefined, c: OfferContext): boolean {
  if (!o) return true; /* an offer the data does not know: the old behaviour */
  if (!o.on) return false;
  const r = o.r, hm = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
  if (!r.days.includes(c.day) || c.min < hm(r.from) || c.min > hm(r.to) || !r.ch.includes(c.channel)) return false;
  if (r.dish === "lunch") return c.dishes.some((id) => id.startsWith("l-"));
  if (Array.isArray(r.dish)) return c.dishes.some((id) => (r.dish as string[]).includes(id));
  return true;
}

/** the context of an order for the rules (orders.ts): the day and the minutes of the order (a pre-order: its slot) */
export function orderOfferContext(ctx: Ctx, o: { mode: "delivery" | "pickup"; channel: string; sched: string; slot: string; lines: { id: string }[] }): OfferContext {
  let day = new Date(sofiaYmd(nowDate(ctx)) + "T12:00:00Z").getUTCDay();
  if (o.sched === "утре") day = (day + 1) % 7;
  const min = o.sched && /^\d{2}:\d{2}$/.test(o.slot) ? +o.slot.slice(0, 2) * 60 + +o.slot.slice(3) : minutes(ctx.clock);
  const channel: OfferChannel = o.channel === "qr" || o.channel === "waiter" ? "table" : o.channel === "office" ? "office" : o.mode;
  return { day, min, channel, dishes: o.lines.map((l) => l.id) };
}
