// Reads design/data/menu.js (which sets window.SC_MENU) and writes src/data/menu.json.
// Run: node scripts/gen-menu.mjs  (also runs before dev/build)
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "design/data/menu.js"), "utf8");
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const M = ctx.window.SC_MENU;
if (!M || !Array.isArray(M.items)) throw new Error("design/data/menu.js did not set window.SC_MENU");
const out = path.join(root, "src/data/menu.json");
const json = JSON.stringify(M, null, 1) + "\n";
if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== json) fs.writeFileSync(out, json);
console.log(`menu.json: ${M.cats.length} categories, ${M.items.length} items, lunch ${M.lunch.date}`);
