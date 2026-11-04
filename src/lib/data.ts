/* Menu data and constants (port of the data part of design/ds/sc.js). Pure: works in Node and the browser. */
import { MENU, type Dish, type Category } from "../data/menu.ts";
export * from "./consts.ts";
export type { Dish, Category, AllergenId, TagId, Course, Menu } from "../data/menu.ts";

export const menu = MENU;
export const items: Dish[] = MENU.items;
export const cats: Category[] = MENU.cats;

export const byId: Record<string, Dish> = {};
for (const x of items) byId[x.id] = x;

/* The lunch menu joins the lookup (for cart and prices) but stays out of the main menu lists. */
export const lunch: Dish[] = MENU.lunch.items
  .filter((x) => x.p)
  .map((x) => {
    const g = x.group;
    const it: Dish = {
      id: x.id, n: x.n, cat: "obedno", group: g,
      course: /Супи|Салати/.test(g) ? "starter" : /Десерти/.test(g) ? "dessert" : "main",
      comp: "", g: "", p: x.p as number, t: [], al: [], noOnion: false, share: false, lunch: true,
    };
    byId[it.id] = it;
    return it;
  });

/** Today's date in Sofia as "YYYY-MM-DD". */
export function sofiaDate(d: Date = new Date()): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}
/** The lunch menu in the data is for one date; never present it as "today" on another day. */
export function lunchIsToday(d: Date = new Date()): boolean {
  return sofiaDate(d) === MENU.lunch.date;
}

export const catById: Record<string, Category> = {};
for (const c of cats) catById[c.id] = c;

export function inCat(cat: string): Dish[] { return items.filter((x) => x.cat === cat); }
export function isOut(x: Dish): boolean { return x.t.indexOf("out") > -1; }
export function dish(x: Dish | string): Dish { return typeof x === "string" ? byId[x] : x; }

/* let url.dish("id") and the cart find a dish by id once the menu is loaded */
import { setDishResolver } from "./registry.ts";
setDishResolver((id) => byId[id]);
