// Astro is always static (docs/DECISIONS.md). DEMO=1 builds the static demo: data-demo on <html>, the client core runs
// on localStorage, staff passwords are verified in the browser against PBKDF2 hashes made here from .env.
import { defineConfig } from "astro/config";
import crypto from "node:crypto";
import { readEnv, staffFromEnv } from "./scripts/env.mjs";
import { iconGroups } from "./scripts/icon-groups.mjs";

const DEMO = process.env.DEMO === "1";
/* modules of the shared runtime (keep in sync with the imports of src/client/sc.ts) */
const RUNTIME = ["/src/client/sc.ts", "/src/lib/format.ts", "/src/lib/status.ts", "/src/lib/consts.ts", "/src/lib/cart.ts", "/src/lib/events.ts",
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

export default defineConfig({
  site: env.SITE_URL || "https://siracusa-sofia.com",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory", assets: "_astro" },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: {
    /* import "sc-icons:moon,truck,info": the page's icons in ONE module inside the page's own chunk (scripts/icon-groups.mjs) */
    plugins: [iconGroups()],
    /* the shared runtime (src/client/sc.ts and the small lib modules it needs) is ONE chunk on every page */
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const f = id.split("?")[0].replace(/\\/g, "/");
            if (RUNTIME.some((m) => f.endsWith(m))) return "sc";
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
