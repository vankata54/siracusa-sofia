/* "Изчерпано днес": the switch of the kitchen and the admin, one source for the site, the cart check, the kitchen and the admin.
   It lives in the core (settings collection, document "soldout") and holds only TODAY (Sofia date): the next day every
   switch is off again by itself and the menu data decides (the "out" tag in src/data/menu.json).
   The switch overrides the data for today both ways: "out" marks a dish sold out, "back" brings a dish of the data back.
   The dish stays visible everywhere as "Изчерпано днес" (CLAUDE.md); only ordering it is refused. */
import { COL, iso, nowDate, emit, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import { audit } from "./audit.ts";
import { byId, isOut, type Dish } from "../lib/data.ts";
import { sofiaYmd } from "../lib/time.ts";

export interface SoldOutDoc { id: "soldout"; date: string; out: Record<string, boolean>; updatedAt?: string }
/** today's switches: dish id -> sold out (true) or back on (false); a dish without a switch follows the menu data */
export type SoldOutToday = Record<string, boolean>;

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The switches set today. A document from another day counts as empty. */
export async function soldOutToday(ctx: Ctx): Promise<SoldOutToday> {
  const d = await ctx.repo.get<SoldOutDoc>(COL.settings, "soldout");
  return d && d.date === sofiaYmd(nowDate(ctx)) ? { ...d.out } : {};
}

/** Sold out now: today's switch, else the menu data. */
export function outNow(x: Dish, today: SoldOutToday): boolean {
  return has(today, x.id) ? !!today[x.id] : isOut(x);
}

/** The kitchen or the admin turns "Изчерпано днес" on or off for one dish (also a lunch dish). */
export async function setSoldOut(ctx: Ctx, dishId: string, out: boolean, actor = "system"): Promise<{ id: string; out: boolean }> {
  const id = String(dishId || "");
  if (!has(byId, id)) throw new CoreError("not_found", "Няма такова ястие в менюто.", 404);
  if (typeof out !== "boolean") throw Object.assign(new CoreError("invalid", "Изберете „Изчерпано днес“ или „Има“.", 422), { fields: { out: "Изберете „Изчерпано днес“ или „Има“." } });
  const today = await soldOutToday(ctx);
  /* the same as the data: no switch is needed (keeps the document small) */
  if (out === isOut(byId[id])) delete today[id];
  else today[id] = out;
  const doc: SoldOutDoc = { id: "soldout", date: sofiaYmd(nowDate(ctx)), out: today, updatedAt: iso(ctx) };
  await ctx.repo.put(COL.settings, doc);
  await audit(ctx, actor, out ? "menu.sold_out" : "menu.back", id);
  emit(ctx, "menu.soldout", { id, out }, { public: true });
  return { id, out };
}
