/* Menu data and constants (port of the data part of design/ds/sc.js). Pure: works in Node and the browser.
   The menu is the one built into the page (src/data/menu.json, or the published menu the server built the site with).
   setMenu() swaps it IN PLACE (the same arrays and objects), so every module that imported items / byId / cats sees the
   published menu without a restart (the server and the demo core after "Публикувай", decision 15.11.2026). */
import { MENU, type Dish, type Category, type Menu, type MenuOpts } from "../data/menu.ts";
import { ORDER_RULES } from "./consts.ts";
export * from "./consts.ts";
export type { Dish, Category, AllergenId, TagId, Course, Menu, MenuOpts, SwapGroup } from "../data/menu.ts";

export const menu = MENU;
/** the dishes of the menu (never the removed ones) */
export const items: Dish[] = [];
/** the categories shown on the site: only the ones with at least one dish (an empty one stays in the admin, decision 15.11.2026) */
export const cats: Category[] = [];

/** every dish that can be ordered or shown: the menu and today's lunch menu (not the removed ones) */
export const byId: Record<string, Dish> = {};
/** dishes taken off the menu, for reference only (a cart line says "… вече не е в менюто", the core refuses it) */
export const removedById: Record<string, Dish> = {};
/** The lunch menu joins the lookup (for cart and prices) but stays out of the main menu lists. */
export const lunch: Dish[] = [];
export const catById: Record<string, Category> = {};

/** "Добави" and "Смени" (the admin's menu settings); by default "Добави" for pizzas and burgers (ORDER_RULES.addonCats) */
export const defaultOpts = (): MenuOpts => ({ addon: { cats: [...ORDER_RULES.addonCats], dishes: {} }, swap: { on: false, groups: [], dishes: {} } });
export const menuOpts: MenuOpts = defaultOpts();

/** "Добави" for this dish: the admin's menu settings (decision 15.11.2026), the dish wins over its category; by default pizzas
    and burgers (ORDER_RULES.addonCats is only that default). The cart, the core and the dish page read this one rule. */
export const takesAddons = (x: { id: string; cat: string }): boolean => {
  const d = menuOpts.addon.dishes;
  return Object.prototype.hasOwnProperty.call(d, x.id) ? !!d[x.id] : menuOpts.addon.cats.indexOf(x.cat) > -1;
};

/** The date of the lunch menu in the data ("YYYY-MM-DD"); follows setMenu() (a live binding) */
export let MENU_LUNCH_DATE: string = MENU.lunch.date;

const lunchDish = (x: Menu["lunch"]["items"][number]): Dish => {
  const g = x.group;
  return {
    id: x.id, n: x.n, cat: "obedno", group: g,
    course: /Супи|Салати/.test(g) ? "starter" : /Десерти/.test(g) ? "dessert" : "main",
    comp: "", g: "", p: x.p as number, t: [], al: [], noOnion: false, share: false, lunch: true,
  };
};

const hooks: (() => void)[] = [];
/** run fn after every setMenu() (caches built from the menu: add-ons in pricing.ts, the search index in filters.ts) */
export function onMenuChange(fn: () => void): void { hooks.push(fn); }

const clear = (o: Record<string, unknown>) => { for (const k of Object.keys(o)) delete o[k]; };

/** Puts a menu in place of the current one (in place: the same arrays and objects). */
export function setMenu(m: Menu): void {
  if (m !== MENU) {
    MENU.updated = m.updated; MENU.source = m.source; MENU.cats = m.cats; MENU.items = m.items; MENU.lunch = m.lunch;
    MENU.opts = m.opts; MENU.removed = m.removed; MENU.redirects = m.redirects;
  }
  items.splice(0, items.length, ...m.items);
  const used = new Set(m.items.map((x) => x.cat));
  cats.splice(0, cats.length, ...m.cats.filter((c) => used.has(c.id)));
  clear(byId); clear(removedById); clear(catById);
  for (const x of items) byId[x.id] = x;
  for (const c of cats) catById[c.id] = c;
  lunch.splice(0, lunch.length, ...m.lunch.items.filter((x) => x.p).map(lunchDish));
  for (const x of lunch) byId[x.id] = x;
  for (const x of m.removed || []) if (!byId[x.id]) removedById[x.id] = x;
  const o = m.opts || defaultOpts();
  menuOpts.addon = { cats: [...o.addon.cats], dishes: { ...o.addon.dishes } };
  menuOpts.swap = { on: false, groups: o.swap.groups.map((g) => ({ ...g, opts: g.opts.map((v) => ({ ...v })), cats: [...g.cats] })), dishes: { ...o.swap.dishes } };
  MENU_LUNCH_DATE = m.lunch.date;
  hooks.forEach((f) => f());
}
setMenu(MENU);

/** Today's date in Sofia as "YYYY-MM-DD". */
export function sofiaDate(d: Date = new Date()): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}
/** The lunch menu is for today (preview / demo: always), one helper for every page: lib/lunch.ts */
export { lunchIsToday } from "./lunch.ts";

export function inCat(cat: string): Dish[] { return items.filter((x) => x.cat === cat); }
export function isOut(x: Dish): boolean { return x.t.indexOf("out") > -1; }
export function dish(x: Dish | string): Dish { return typeof x === "string" ? byId[x] : x; }
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
/** a dish of the menu, of the lunch menu or a removed one (for a cart line and an old order) */
export function findDish(id: string): Dish | undefined { return own(byId, id) ? byId[id] : own(removedById, id) ? removedById[id] : undefined; }

/** The first of these dishes that this menu has, else a hit, else the first dish: the picture or the example of a page that
    named a dish the published menu may not have (decision 15.11.2026, "Ново меню"). Never a lunch or removed dish. */
export function anyDish(...ids: string[]): Dish | undefined {
  for (const id of ids) if (own(byId, id) && !byId[id].lunch) return byId[id];
  const ok = items.filter((x) => !isOut(x));
  return ok.find((x) => x.t.indexOf("hit") > -1) || ok[0] || items[0];
}

/* let url.dish("id") and the cart find a dish by id once the menu is loaded */
import { setDishResolver } from "./registry.ts";
setDishResolver((id) => byId[id] || removedById[id]);
