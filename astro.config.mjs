// Astro is always static (docs/DECISIONS.md). DEMO=1 builds the static demo: data-demo on <html>, the client core runs
// on localStorage, staff passwords are verified in the browser against PBKDF2 hashes made here from .env.
import { defineConfig } from "astro/config";
import crypto from "node:crypto";
import { readEnv, staffFromEnv } from "./scripts/env.mjs";
import { iconGroups } from "./scripts/icon-groups.mjs";
import { buildChecks } from "./scripts/build-checks.mjs";
import { siteFile } from "./scripts/site-file.mjs";
import fs from "node:fs";

const DEMO = process.env.DEMO === "1";
/* modules of the shared runtime (keep in sync with the imports of src/client/sc.ts) */
const RUNTIME = ["/src/client/sc.ts", "/src/lib/format.ts", "/src/lib/status.ts", "/src/lib/consts.ts", "/src/lib/zones-data.ts", "/src/lib/cart.ts", "/src/lib/events.ts",
  "/src/lib/chrome-core.ts", "/src/lib/icons.ts", "/src/lib/icons/x.ts", "/src/lib/icons/check.ts", "/src/lib/icons/caret-right.ts", "/src/lib/icons/phone.ts",
  "/src/lib/icons/question.ts", "/src/lib/routes.ts", "/src/lib/time.ts", "/src/lib/registry.ts", "/src/lib/lunch.ts", "/src/lib/lunch-date.ts", "/src/lib/load.ts"];
const env = { ...readEnv(), ...process.env };

function demoStaff() {
  if (!DEMO) return [];
  return staffFromEnv(env).map((s) => {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.pbkdf2Sync(s.password, salt, 120000, 32, "sha256").toString("hex");
    return { username: s.username, name: s.name, role: s.role, salt, hash, algo: "pbkdf2" };
  });
}

const SITE = env.SITE_URL || "https://siracusa-sofia.com";

/* MENU_FILE (the server's rebuild after "Публикувай" in the admin, server/publish.ts): the published menu takes the place of
   src/data/menu.json and src/lib/lunch-date.ts in this build; scripts/build-checks.mjs reads the same file. */
function menuFile() {
  const f = process.env.MENU_FILE;
  return {
    name: "siracusa-menu-file",
    enforce: "pre",
    load(id) {
      if (!f) return null;
      const p = id.split("?")[0].replace(/\\/g, "/");
      if (p.endsWith("/src/data/menu.json")) return fs.readFileSync(f, "utf8");
      if (p.endsWith("/src/lib/lunch-date.ts")) {
        const m = JSON.parse(fs.readFileSync(f, "utf8"));
        return "export const LUNCH_DATE = " + JSON.stringify(m.lunch.date) + ";\nexport const LUNCH_DAY_NAME = " + JSON.stringify(m.lunch.dayName || "") + ";\n";
      }
      return null;
    },
  };
}

export default defineConfig({
  site: SITE,
  /* after the build: the runtime budget (30 000 B) and robots.txt + sitemap.xml (scripts/build-checks.mjs) */
  integrations: [buildChecks({ site: SITE, demo: DEMO })],
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", assets: "_astro" },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    /* import "sc-icons:moon,truck,info": the page's icons in ONE module inside the page's own chunk (scripts/icon-groups.mjs) */
    /* SITE_FILE (the server's rebuild after a change of the zones, hall, events or offers in the admin, server/publish.ts):
       the site data takes the place of src/lib/zones-data.ts, tables.ts, events.ts, events-extra.ts, offers-data.ts */
    plugins: [menuFile(), siteFile(), iconGroups()],
    /* the shared runtime (src/client/sc.ts and the small lib modules it needs) is ONE chunk on every page */
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const f = id.split("?")[0].replace(/\\/g, "/");
            if (RUNTIME.some((m) => f.endsWith(m))) return "sc";
            /* the scrub of personal data goes with the pencil's pure part (one chunk, one name less in the runtime's preload list) */
            if (f.endsWith("/src/core/scrub.ts") || f.endsWith("/src/admin/pen-core.ts")) return "pen-core";
            return undefined;
          },
        },
      },
    },
    /* demo from any sub-folder: Vite's preload helper builds "/_astro/..." links for the dynamic imports;
       scripts/relativize.mjs rewrites it to a URL relative to the chunk (no 404 from a sub-folder). */
    define: {
      __DEMO__: JSON.stringify(DEMO),
      __DEMO_STAFF__: JSON.stringify(demoStaff()),
    },
  },
});
