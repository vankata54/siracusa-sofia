/* SC + the menu. Pages that show dishes import THIS instead of ./sc.ts:
     import { SC } from "../client/sc-menu.ts";
   It is the same object as window.SC, extended with the prototype's menu API (SC.items, SC.byId, SC.dishCard, SC.suggest ...).
   Vite puts the menu, the illustrations and these renderers into one shared chunk that only such pages load. */
import { SC as base } from "./sc.ts";
import * as D from "../lib/data.ts";
import { art, pic, badges, plusBtn, dishCard } from "../lib/render.ts";
import { kind } from "../lib/art.ts";
import { suggest, type ManualPairs } from "../lib/suggest.ts";
import { offers } from "../lib/offers.ts";

const MANUAL_PAIRS: ManualPairs = {};
const menuApi = {
  menu: D.menu, items: D.items, byId: D.byId, lunch: D.lunch, lunchIsToday: () => D.lunchIsToday(), cats: D.cats, catById: D.catById,
  inCat: D.inCat, isOut: D.isOut,
  MANUAL_PAIRS, suggest: (id: string, inCart?: string[]) => suggest(id, inCart, MANUAL_PAIRS),
  offers: () => offers(),
  kind, art, pic, badges, plusBtn, dishCard,
};
export const SC = Object.assign(base, menuApi);
export type SCMenu = typeof SC;
window.SC = SC;
export default SC;
