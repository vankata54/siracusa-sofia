// Astro is always static (docs/DECISIONS.md). DEMO=1 builds the static demo: data-demo on <html>, the client core runs
// on localStorage, staff passwords are verified in the browser against PBKDF2 hashes made here from .env.
import { defineConfig } from "astro/config";
import crypto from "node:crypto";
import { readEnv, staffFromEnv } from "./scripts/env.mjs";

const DEMO = process.env.DEMO === "1";
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
    /* demo from any sub-folder: Vite's preload helper builds "/_astro/..." links for the dynamic imports;
       scripts/relativize.mjs rewrites it to a URL relative to the chunk (no 404 from a sub-folder). */
    define: {
      __DEMO__: JSON.stringify(DEMO),
      __DEMO_STAFF__: JSON.stringify(demoStaff()),
    },
  },
});
