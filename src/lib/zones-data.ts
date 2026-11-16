/* The delivery zones of the site (part of the shared runtime). The admin edits them in the core (core/zones.ts); the
   server's rebuild of the site puts the published zones in place of this file (astro.config.mjs, SITE_FILE). */
import type { Zone } from "./consts.ts";

export const ZONES: Zone[] = [
  { n: "Дружба 1", slug: "druzhba-1", etaMin: 30, free: true, eta: "около 30\u00a0мин" },
  { n: "Дружба 2", slug: "druzhba-2", etaMin: 25, free: true, eta: "около 25\u00a0мин" },
  { n: "НПЗ Искър", slug: "npz-iskar", etaMin: 35, free: true, eta: "около 35\u00a0мин" },
  { n: "Бусманци", slug: "busmantsi", etaMin: 40, free: true, eta: "около 40\u00a0мин" },
  { n: "Горубляне", slug: "gorublyane", etaMin: 40, free: false, fee: null, eta: "около 40\u00a0мин" },
  { n: "Гара Искър", slug: "gara-iskar", etaMin: 45, free: false, fee: null, eta: "около 45\u00a0мин" },
];
