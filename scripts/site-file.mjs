// The site data from the admin (zones, tables, events, offers) for the server's rebuild of the site (server/publish.ts),
// like MENU_FILE for the menu: astro.config.mjs puts these generated modules in place of the source files when SITE_FILE
// is set. Without SITE_FILE the source files are used unchanged (the shared runtime stays byte for byte the same).
// The data comes from the core (src/core/site-data.ts siteBuild): only published rows, only the fields the pages use.
import fs from "node:fs";

/** the modules the site data replaces: path suffix -> code */
export const SITE_MODULES = ["/src/lib/zones-data.ts", "/src/lib/tables.ts", "/src/lib/events.ts", "/src/lib/events-all.ts", "/src/lib/events-extra.ts", "/src/lib/offers-data.ts"];

const j = (v) => JSON.stringify(v);
/** an event as an object literal in the shape of lib/events.ts SiteEvent, the date as code */
const obj = (e, date) => "{ id: " + j(e.id) + ", n: " + j(e.n) + ", cat: " + j(e.cat) + ", date: " + date + ", time: " + j(e.time) + ", price: " + j(e.price) +
  ", free: " + j(e.free) + ", seatsLeft: " + j(e.seatsLeft) + ", text: " + j(e.text) + ", note: " + j(e.note) + " }";
const order = (list) => list.filter((e) => e.recur).concat(list.filter((e) => !e.recur).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));

/** The code of one replaced module, or null. `status` is the import of lib/status.ts (relative in the build). */
export function siteModule(suffix, site, status = "./status.ts") {
  switch (suffix) {
    case "/src/lib/zones-data.ts": return "export const ZONES = " + j(site.zones) + ";\n";
    case "/src/lib/tables.ts": return "export const TABLES = " + j(site.tables) + ";\n";
    case "/src/lib/events-extra.ts": return "export const EVENT_EXTRA = " + j(site.eventExtra || {}) + ";\n";
    case "/src/lib/offers-data.ts": return "export const OFFER_OFF = " + j(site.offersOff || []) + ";\n";
    case "/src/lib/events.ts": {
      /* the shared runtime (SC.events()): only the monthly evening(s), in the same shape as the source file (size budget) */
      const rec = site.events.filter((e) => e.recur);
      return "import { lastSaturday } from " + j(status) + ";\n" +
        "export function events(today = new Date()) {\n  const ls = lastSaturday(today);\n  return [" + rec.map((e) => obj(e, "ls.d")).join(", ") + "];\n}\n" +
        "export const EVENT_SLUGS = " + j(rec.map((e) => e.id)) + ";\n";
    }
    case "/src/lib/events-all.ts":
      /* every published event for the pages at build time: the monthly evening(s) first, then by date (the past ones too) */
      return "import { lastSaturday } from " + j(status) + ";\n" +
        "const day = (s) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));\n" +
        "export function events(today = new Date()) {\n  const ls = lastSaturday(today);\n  return [" + order(site.events).map((e) => obj(e, e.recur ? "ls.d" : "day(" + j(e.date) + ")")).join(", ") + "];\n}\n" +
        "export const EVENT_SLUGS = " + j(order(site.events).map((e) => e.id)) + ";\n";
    default: return null;
  }
}

/** the Vite plugin for astro.config.mjs: SITE_FILE (JSON from the core) replaces the site data modules in this build */
export function siteFile() {
  const f = process.env.SITE_FILE;
  let site = null;
  return {
    name: "siracusa-site-file",
    enforce: "pre",
    load(id) {
      if (!f) return null;
      const p = id.split("?")[0].replace(/\\/g, "/");
      const suffix = SITE_MODULES.find((m) => p.endsWith(m));
      if (!suffix) return null;
      if (!site) site = JSON.parse(fs.readFileSync(f, "utf8"));
      return siteModule(suffix, site);
    },
  };
}
