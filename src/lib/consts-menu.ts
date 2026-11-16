/* Menu constants: the tags, the menu filters and the names of the courses. OUT of the shared runtime (src/client/sc.ts):
   only the pages with dishes need them (decision 16.11.2026, the runtime budget).
   IMPORT THEM FROM lib/data.ts, never from this file: while lib/data.ts is the only importer, the bundler keeps this
   module in the chunk of the menu (no tiny chunk of its own, no extra request). lib/consts.ts must not re-export it:
   every module the runtime imports lands in the runtime chunk. In the browser SC.TAGS, SC.FILTERS and SC.COURSE_NAME
   exist after src/client/sc-menu.ts. */
import type { Dish, TagId } from "../data/menu.ts";

export const TAGS: Record<TagId, [string, string]> = {
  hit: ["Хит", "fire"], new: ["Ново", "sparkle"], veg: ["Вегетарианско", "leaf"], hot: ["Люто", "pepper"], out: ["Изчерпано днес", "clock"],
};

export interface Filter { id: string; n: string; icon: string; test: (x: Dish) => boolean; needs?: string }
/* Menu filters. Data-driven: a filter is shown only if at least one item matches. */
export const FILTERS: Filter[] = [
  { id: "veg", n: "Вегетарианско", icon: "leaf", test: (x) => x.t.indexOf("veg") > -1 },
  { id: "hot", n: "Люто", icon: "pepper", test: (x) => x.t.indexOf("hot") > -1 },
  { id: "noonion", n: "Без лук", icon: "plant", test: (x) => x.noOnion },
  { id: "share", n: "За споделяне", icon: "users-three", test: (x) => x.share },
  { id: "bertha", n: "От фурната Bertha", icon: "fire", test: (x) => x.cat === "skara-bertha" },
  { id: "nogluten", n: "Без глутен", icon: "grains", test: (x) => !!x.comp && x.al.indexOf("gluten") < 0 },
  { id: "nomilk", n: "Без мляко", icon: "drop", test: (x) => !!x.comp && x.al.indexOf("milk") < 0 },
  { id: "protein", n: "Протеиново", icon: "barbell", test: (x) => !!x.protein && x.protein >= 30, needs: "хранителни данни" },
  { id: "light", n: "Леко до 500 ккал", icon: "leaf", test: (x) => !!x.kcal && x.kcal <= 500, needs: "хранителни данни" },
];

export const COURSE_NAME: Record<string, string> = {
  salad: "Салата", starter: "Предястие", main: "Основно", side: "Гарнитура", sauce: "Сос", dessert: "Десерт", drink: "Напитка", addon: "Добавка", breakfast: "Закуска",
};
