/* The dishes for "Търси навсякъде" (loaded on the first search). Only these names: a dynamic import of lib/data.ts itself
   would keep all its re-exports (consts.ts) alive and add exports to the shared runtime chunk. */
export { items, catById } from "../lib/data.ts";
export { searchDishes } from "../lib/search.ts";
