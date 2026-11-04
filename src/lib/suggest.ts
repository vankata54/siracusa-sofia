/* "Върви добре с" (hand-off 10.12): fills in by course, never a second main, max 3, most expensive first
   (pizzas last, so desserts come before sweet pizzas), skips a course without items (no drinks in the menu). */
import { items, byId, isOut, type Dish } from "./data.ts";

export const PLAN: Record<string, string[]> = {
  pitsi: ["salad", "drink", "dessert"], "skara-bertha": ["side", "drink", "salad"], "osnovni-yastia": ["salad", "drink", "dessert"],
  "pasta-i-rizoto": ["salad", "drink", "dessert"], burgeri: ["side", "drink", "dessert"],
  salati: ["main", "drink", "dessert"], supi: ["main", "drink"], "studeni-predyastia": ["drink", "sauce", "main"], "topli-predyastia": ["drink", "sauce", "main"],
  garnituri: ["main", "sauce"], hlebcheta: ["main", "sauce"], sosove: ["main"], deserti: ["drink"], zakuski: ["drink"],
};

export function courseOf(x: Dish): string { return x.cat === "salati" ? "salad" : x.course; }

/** Owner's manual pairings from the admin: {dishId: {course: itemId}} */
export type ManualPairs = Record<string, Record<string, string>>;

export interface Suggestion { c: string; id: string }

export function suggest(id: string, inCart: string[] = [], manual: ManualPairs = {}): Suggestion[] {
  const d = byId[id];
  if (!d) return [];
  const plan = PLAN[d.cat] || ["salad", "drink", "dessert"];
  const mine = courseOf(d);
  const cartCourses = inCart.map((k) => byId[k] && courseOf(byId[k]));
  return plan
    .filter((c) => c !== mine && cartCourses.indexOf(c) < 0)
    .map((c): Suggestion | null => {
      const man = manual[id] && manual[id][c];
      if (man && byId[man]) return { c, id: man };
      const best = items
        .filter((x) => x.id !== id && courseOf(x) === c && !isOut(x) && x.cat !== "dobavki" &&
          !(d.t.indexOf("veg") > -1 && x.comp && x.t.indexOf("veg") < 0 && c !== "drink"))
        .sort((a, b) => (Number(a.cat === "pitsi") - Number(b.cat === "pitsi")) || (b.p - a.p))[0];
      return best ? { c, id: best.id } : null;
    })
    .filter((s): s is Suggestion => !!s)
    .slice(0, 3);
}
