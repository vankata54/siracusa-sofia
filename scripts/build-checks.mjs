// Astro integration, runs after every build (server and demo), decision 12.11.2026:
//   1. the shared runtime (_astro/sc.*.js) is at most RUNTIME_BUDGET bytes, uncompressed; a bigger one fails the build;
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
        if (!demo) {
          const long = longDescriptions(d);
          if (long.length) throw new Error("build-checks: meta description over " + DESCRIPTION_MAX + " characters: " + long.map((x) => x.page + " (" + x.length + ")").join(", "));
        }
        const r = seoFiles(d, site, demo);
        logger.info(demo ? "robots.txt: Disallow: / (demo)" : "sitemap.xml: " + r.urls + " pages, robots.txt");
      },
    },
  };
}
