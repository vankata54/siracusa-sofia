/* The kitchen, the part every other core file may read (orders.ts, settings.ts) without importing core/kitchen.ts:
   - the kitchen's own settings (one document "kitchen" in `settings`, changeable later from the admin): the sections, the
     map category -> section, the norms for time. The defaults are the CONDITIONAL ones of the approved prototype
     (design/pages-kuhnya/_kitchen.js: K.SECTIONS, K.NORM, K.SOON) and are marked [ЛИПСВА] until someone saves them;
   - the stamp of a new order: every line gets its section (`sec`) and `ks: "wait"`; an order placed while "Натоварено" is
     on keeps the extra minutes (`kBusy`), so a later switch never moves a deadline that was already given;
   - the day's log of "Натоварено" (who, when, on / off), written by settings.ts at every switch, also from the admin.
   No import of settings.ts, orders.ts or kitchen.ts here (they import this file). */
import { COL, type Ctx } from "./ctx.ts";
import type { Iso, Order, OrderLine } from "./types.ts";
import { findDish, ORDER_RULES } from "../lib/data.ts";
import { isLunchId } from "../lib/lunch-id.ts";

/** a section of the kitchen (a tablet): `short` is the name in "Други секции" and in "Кухня · Скара" */
export interface KSectionDef { id: string; n: string; short: string; icon: string; cats: string[] }
export interface KitchenConfig {
  id: "kitchen";
  sections: KSectionDef[];
  /** the section of the lunch menu, and of a category nobody mapped (a new category of a new menu, an add-on ordered alone) */
  lunch: string; other: string;
  /** minutes from the order to "ready in the kitchen", per channel */
  norm: { table: number; pickup: number; delivery: number };
  /** "наближава": minutes before the deadline; an order for an hour enters the queue this many minutes before it */
  soon: number; enterBefore: number;
  /** who confirmed what: false = still the conditional defaults of the prototype ([ЛИПСВА]) */
  confirmed: { sections: boolean; norms: boolean };
  version: number; at: Iso | null; by: string | null;
}
/** the head chef's view of every section ("Общ изглед") */
export const K_ALL = "all";
export const K_MISSING = { sections: "[ЛИПСВА: секции на кухнята]", norms: "[ЛИПСВА: норми за време]" };
/** the lunch dishes have this category in the data (lib/data.ts lunchDish) */
export const LUNCH_CAT = "obedno";

/* [ЛИПСВА: секции на кухнята]: the conditional map of the prototype (K.SECTIONS): the side dishes in "Топла", the breads
   in "Пещ", the sauces and the desserts in "Салати и студени", the lunch menu in "Топла" */
export const DEFAULT_KITCHEN: KitchenConfig = {
  id: "kitchen",
  sections: [
    { id: "topla", n: "Топла кухня", short: "Топла", icon: "cooking-pot", cats: ["supi", "topli-predyastia", "osnovni-yastia", "pasta-i-rizoto", "burgeri", "garnituri", "zakuski"] },
    { id: "skara", n: "Скара Bertha", short: "Скара", icon: "fire", cats: ["skara-bertha"] },
    { id: "pesht", n: "Пещ за пици", short: "Пещ", icon: "pizza", cats: ["pitsi", "hlebcheta"] },
    { id: "studeni", n: "Салати и студени", short: "Салати", icon: "bowl-food", cats: ["salati", "studeni-predyastia", "sosove", "deserti"] },
  ],
  lunch: "topla", other: "topla",
  /* [ЛИПСВА: норми за време]: 20 min for every channel, "наближава" 5 min before, an order for an hour enters 20 min before */
  norm: { table: 20, pickup: 20, delivery: 20 }, soon: 5, enterBefore: 20,
  confirmed: { sections: false, norms: false },
  version: 0, at: null, by: null,
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** the kitchen's settings: the saved document over the defaults (a document from an older version keeps working) */
export async function kitchenConfig(ctx: Ctx): Promise<KitchenConfig> {
  const d = await ctx.repo.get<KitchenConfig>(COL.settings, "kitchen");
  const base = clone(DEFAULT_KITCHEN);
  if (!d) return base;
  return {
    ...base, ...d, id: "kitchen",
    sections: Array.isArray(d.sections) && d.sections.length ? d.sections : base.sections,
    norm: { ...base.norm, ...(d.norm || {}) }, confirmed: { ...base.confirmed, ...(d.confirmed || {}) },
  };
}
export const hasSec = (cfg: KitchenConfig, id: unknown): id is string => typeof id === "string" && cfg.sections.some((s) => s.id === id);
/** the section of a category: the map, the lunch menu, else the "other" section */
export function secOfCat(cfg: KitchenConfig, cat: string | undefined | null): string {
  const fallback = hasSec(cfg, cfg.other) ? cfg.other : cfg.sections[0].id;
  if (!cat) return fallback;
  if (cat === LUNCH_CAT) return hasSec(cfg, cfg.lunch) ? cfg.lunch : fallback;
  const s = cfg.sections.find((x) => x.cats.includes(cat));
  return s ? s.id : fallback;
}
/** the section of a line: the one stamped at the order (while that section exists), else by the category of the dish */
export function secOfLine(cfg: KitchenConfig, l: Pick<OrderLine, "id" | "cat" | "sec">): string {
  if (hasSec(cfg, l.sec)) return l.sec;
  const cat = l.cat || (isLunchId(l.id) ? LUNCH_CAT : findDish(l.id)?.cat);
  return secOfCat(cfg, cat);
}
/** add-ons have no line of their own on the ticket: they are written under the main dish ("+ Гъби") */
export const isAddonCat = (cat: string | undefined | null): boolean => cat === ORDER_RULES.addonCat;

/** A new (or changed) order for the kitchen: every line gets its section and `ks: "wait"` (a line the kitchen already
    moved keeps its state); `busyMin` > 0: the order was placed while "Натоварено" was on (+ that many minutes to its
    deadline, for good). Called by createOrder / changeOrder right before the order is saved. */
export async function stampKitchen(ctx: Ctx, o: Order, busyMin = 0): Promise<Order> {
  const cfg = await kitchenConfig(ctx);
  o.lines = o.lines.map((l) => ({ ...l, sec: secOfCat(cfg, l.cat || (isLunchId(l.id) ? LUNCH_CAT : findDish(l.id)?.cat)), ks: l.ks || "wait" }));
  if (busyMin > 0) o.kBusy = Math.round(busyMin);
  return o;
}

/* ---------- the day's log of "Натоварено" ---------- */
/** one period: `by` is the name shown ("Кухня · Скара", "Главен готвач", "Управител"), `user` the account (for the log) */
export interface BusyLogItem { on: Iso; off: Iso | null; by: string; user: string; offBy?: string; offUser?: string }
export interface BusyLogDoc { id: "kitchen:busy"; items: BusyLogItem[]; updatedAt?: Iso }
export const BUSY_LOG_KEEP = 60;
export async function busyLog(ctx: Ctx): Promise<BusyLogItem[]> {
  const d = await ctx.repo.get<BusyLogDoc>(COL.modState, "kitchen:busy");
  return d && Array.isArray(d.items) ? d.items : [];
}
/** settings.ts calls it when the switch really changes (newest first) */
export async function busyLogged(ctx: Ctx, on: boolean, at: Iso, by: string, user: string): Promise<void> {
  const items = await busyLog(ctx);
  const open = items.find((x) => !x.off);
  if (on) { if (!open) items.unshift({ on: at, off: null, by, user }); }
  else if (open) { open.off = at; open.offBy = by; open.offUser = user; }
  await ctx.repo.put<BusyLogDoc>(COL.modState, { id: "kitchen:busy", items: items.slice(0, BUSY_LOG_KEEP), updatedAt: at });
}
