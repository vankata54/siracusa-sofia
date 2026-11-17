// Astro integration, runs after every build (server and demo), decision 12.11.2026:
//   1. the shared runtime (_astro/sc.*.js) is at most RUNTIME_BUDGET bytes, uncompressed; a bigger one fails the build;
//      the shared components (_astro/ui.*.js) and the sheet (_astro/sc-sheet.*.js) have their own budgets;
//   2. robots.txt and sitemap.xml: the sitemap lists every page WITHOUT noindex (not the cart, tracking, login, profile,
//      404); the demo (all pages noindex) gets a robots.txt that disallows everything and no sitemap.
// The same budget is checked by the unit tests (tests/unit/budget.test.ts) and the e2e smoke test.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** bytes, uncompressed (not KiB): docs/DECISIONS.md 12.11.2026 */
export const RUNTIME_BUDGET = 30000;
/** the shared components chunk (_astro/ui.*.js, lib/ui.ts, without icons): its own budget, uncompressed (DECISIONS 12.11.2026) */
export const UI_BUDGET = 6000;
/** the bottom sheet and its focus trap (_astro/sc-sheet.*.js, src/client/sc-sheet.ts): loaded by the pages that open a sheet;
    its own budget, uncompressed (DECISIONS 16.11.2026) */
export const SHEET_BUDGET = 4000;
/** meta description of an indexable page: at most this many characters (search results cut the rest) */
export const DESCRIPTION_MAX = 160;

/** the runtime chunk(s) in a build folder: [{file, bytes}] */
export function runtimeSizes(dir) {
  const a = path.join(dir, "_astro");
  if (!fs.existsSync(a)) return [];
  return fs.readdirSync(a).filter((f) => /^sc\.[\w-]+\.js$/.test(f)).map((f) => ({ file: f, bytes: fs.statSync(path.join(a, f)).size }));
}

/** the shared components chunk(s): [{file, bytes}] */
export function uiSizes(dir) {
  const a = path.join(dir, "_astro");
  if (!fs.existsSync(a)) return [];
  return fs.readdirSync(a).filter((f) => /^ui\.[\w-]+\.js$/.test(f)).map((f) => ({ file: f, bytes: fs.statSync(path.join(a, f)).size }));
}

/** the sheet chunk(s): [{file, bytes}] */
export function sheetSizes(dir) {
  const a = path.join(dir, "_astro");
  if (!fs.existsSync(a)) return [];
  return fs.readdirSync(a).filter((f) => /^sc-sheet\.[\w-]+\.js$/.test(f)).map((f) => ({ file: f, bytes: fs.statSync(path.join(a, f)).size }));
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** indexable pages (no noindex) whose meta description is longer than DESCRIPTION_MAX: [{page, length}] */
export function longDescriptions(dir) {
  return htmlFiles(dir).map((f) => {
    const h = fs.readFileSync(f, "utf8");
    if (/<meta name="robots" content="[^"]*noindex/.test(h)) return null;
    const m = /<meta name="description" content="([^"]*)"/.exec(h);
    const n = m ? decode(m[1]).length : 0;
    return n > DESCRIPTION_MAX ? { page: path.relative(dir, f), length: n } : null;
  }).filter(Boolean);
}

function htmlFiles(dir) {
  const out = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : f.endsWith(".html") && out.push(p); } })(dir);
  return out;
}

/** Pages whose FIRST load (the entry scripts of the HTML and everything they import statically) contains the shared file
    of the sheet (_astro/sc-sheet.*.js): one more request before the first paint (decision 17.11.2026). It must load only
    after a tap or after the page has drawn itself; a page that opens a sheet at once has its own copy
    (scripts/sheet-copies.mjs). @returns {string[]} */
export function sheetOnFirstLoad(dir) {
  const a = path.join(dir, "_astro");
  if (!fs.existsSync(a)) return [];
  const deps = new Map();
  /* static imports only: import{…}from"./x.js", import"./x.js", export…from"./x.js" (never import("./x.js")) */
  const imports = (f) => {
    if (!deps.has(f)) {
      const p = path.join(a, f), s = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
      deps.set(f, [...s.matchAll(/(?:import|export)\s*(?:[^"'()]*?from\s*)?["']\.\/([\w.\-@]+\.js)["']/g)].map((m) => m[1]));
    }
    return deps.get(f);
  };
  return htmlFiles(dir).filter((p) => {
    const seen = new Set(), go = (f) => { if (seen.has(f)) return; seen.add(f); imports(f).forEach(go); };
    for (const m of fs.readFileSync(p, "utf8").matchAll(/<script[^>]*\ssrc="[^"]*_astro\/([\w.\-@]+\.js)"/g)) go(m[1]);
    return [...seen].some((f) => /^sc-sheet\./.test(f));
  }).map((p) => path.relative(dir, p));
}

/** robots.txt + sitemap.xml for a build folder */
export function seoFiles(dir, site, demo) {
  if (demo) { fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /\n"); return { urls: 0 }; }
  const base = site.replace(/\/$/, "");
  const urls = htmlFiles(dir).filter((f) => {
    const h = fs.readFileSync(f, "utf8");
    return !/<meta name="robots" content="[^"]*noindex/.test(h) && /<link rel="canonical"/.test(h);
  }).map((f) => {
    const h = fs.readFileSync(f, "utf8"), m = /<link rel="canonical" href="([^"]+)"/.exec(h);
    return m ? m[1] : base + "/" + path.relative(dir, f).split(path.sep).join("/").replace(/index\.html$/, "");
  }).sort();
  const uniq = [...new Set(urls)];
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    uniq.map((u) => "  <url><loc>" + u.replace(/&/g, "&amp;") + "</loc></url>").join("\n") + "\n</urlset>\n";
  fs.writeFileSync(path.join(dir, "sitemap.xml"), xml);
  fs.writeFileSync(path.join(dir, "robots.txt"), "User-agent: *\nDisallow: /api/\n\nSitemap: " + base + "/sitemap.xml\n");
  return { urls: uniq.length };
}

/** the menu the build used: MENU_FILE (the server's rebuild after "Публикувай", server/publish.ts) or src/data/menu.json */
export function buildMenu() {
  const f = process.env.MENU_FILE || fileURLToPath(new URL("../src/data/menu.json", import.meta.url));
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

/** The 301 table of the menu (redirects.json): old dish addresses (cut ids) -> new ones (slug), decision 12.11.2026, and the
    addresses the menu editor took off the site (menu.redirects: a removed dish -> its category or /menu/, a moved dish ->
    its new address, an emptied category -> /menu/; decision 15.11.2026). Only dishes in a shown category have a page.
    @returns {Record<string, string>} */
export function redirectMap(menu) {
  const used = new Set(menu.items.map((x) => x.cat)), known = new Set(menu.cats.map((c) => c.id));
  /** @type {Record<string, string>} */
  const map = {};
  for (const x of menu.items) if (x.slug && known.has(x.cat) && used.has(x.cat)) map["/menu/" + x.cat + "/" + x.id + "/"] = "/menu/" + x.cat + "/" + x.slug + "/";
  for (const [from, to] of Object.entries(menu.redirects || {})) if (!map[from]) map[from] = to;
  return map;
}

/** Server build: writes redirects.json for the 301s of server/app.ts and checks that every new address was built and no old
    one was. Demo build (no server): checks that every old address of a cut id is a copy with canonical to the new one.
    Both: an empty category has no page (decision 15.11.2026). */
export function dishRedirects(dir, site, demo) {
  const menu = buildMenu();
  const map = redirectMap(menu);
  const html = (p) => path.join(dir, p, "index.html");
  const used = new Set(menu.items.map((x) => x.cat));
  for (const c of menu.cats) if (!used.has(c.id) && fs.existsSync(html("/menu/" + c.id + "/"))) throw new Error("build-checks: the empty category /menu/" + c.id + "/ was built");
  const slugs = new Set(menu.items.filter((x) => x.slug).map((x) => "/menu/" + x.cat + "/" + x.id + "/"));
  for (const [from, to] of Object.entries(map)) {
    if (!fs.existsSync(html(to))) throw new Error("build-checks: the page " + to + " (the target of " + from + ") was not built");
    if (!demo && fs.existsSync(html(from))) throw new Error("build-checks: the old address " + from + " was built; the server answers it with 301");
    if (demo && slugs.has(from)) {
      const h = fs.existsSync(html(from)) ? fs.readFileSync(html(from), "utf8") : "";
      if (!h.includes('<link rel="canonical" href="' + site.replace(/\/$/, "") + to + '"')) throw new Error("build-checks: the demo copy " + from + " has no canonical to " + to);
    }
  }
  if (!demo) fs.writeFileSync(path.join(dir, "redirects.json"), JSON.stringify(map, null, 1) + "\n");
  return Object.keys(map).length;
}

export function buildChecks({ site, demo }) {
  return {
    name: "siracusa-build-checks",
    hooks: {
      "astro:build:done": ({ dir, logger }) => {
        const d = fileURLToPath(dir);
        const sizes = runtimeSizes(d);
        if (!sizes.length) throw new Error("build-checks: no _astro/sc.*.js runtime chunk in " + d);
        for (const s of sizes) {
          if (s.bytes > RUNTIME_BUDGET) throw new Error("build-checks: the shared runtime " + s.file + " is " + s.bytes + " B, over the budget of " + RUNTIME_BUDGET + " B (docs/DECISIONS.md 12.11.2026)");
          logger.info("runtime " + s.file + ": " + s.bytes + " / " + RUNTIME_BUDGET + " B");
        }
        for (const s of uiSizes(d)) {
          if (s.bytes > UI_BUDGET) throw new Error("build-checks: the shared components chunk " + s.file + " is " + s.bytes + " B, over the budget of " + UI_BUDGET + " B (docs/DECISIONS.md 12.11.2026)");
          logger.info("components " + s.file + ": " + s.bytes + " / " + UI_BUDGET + " B");
        }
        const sheets = sheetSizes(d);
        if (!sheets.length) throw new Error("build-checks: no _astro/sc-sheet.*.js chunk in " + d + " (the sheet must stay out of the shared runtime, docs/DECISIONS.md 16.11.2026)");
        for (const s of sheets) {
          if (s.bytes > SHEET_BUDGET) throw new Error("build-checks: the sheet chunk " + s.file + " is " + s.bytes + " B, over the budget of " + SHEET_BUDGET + " B (docs/DECISIONS.md 16.11.2026)");
          logger.info("sheet " + s.file + ": " + s.bytes + " / " + SHEET_BUDGET + " B");
        }
        const early = sheetOnFirstLoad(d);
        if (early.length) throw new Error("build-checks: the shared sheet file is in the first load of " + early.slice(0, 5).join(", ") + (early.length > 5 ? " and " + (early.length - 5) + " more" : "") + " (one more request before the first paint; docs/DECISIONS.md 17.11.2026)");
        if (!demo) {
          const long = longDescriptions(d);
          if (long.length) throw new Error("build-checks: meta description over " + DESCRIPTION_MAX + " characters: " + long.map((x) => x.page + " (" + x.length + ")").join(", "));
        }
        const moved = dishRedirects(d, site, demo);
        logger.info(demo ? "old dish addresses: " + moved + " copies with canonical (demo)" : "redirects.json: " + moved + " old dish addresses -> 301");
        const r = seoFiles(d, site, demo);
        logger.info(demo ? "robots.txt: Disallow: / (demo)" : "sitemap.xml: " + r.urls + " pages, robots.txt");
      },
    },
  };
}
