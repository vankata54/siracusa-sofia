/* The dishes' illustrations for "Отчети" → "Най-поръчвани ястия" (loaded after the first drawing). Only these names: a dynamic
   import of lib/data.ts itself would keep all its re-exports alive and add exports to the shared runtime chunk (dishes.ts). */
export { byId } from "../lib/data.ts";
export { artSvg } from "../lib/art.ts";
