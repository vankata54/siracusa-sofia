// Vite plugin: a page script that opens a bottom sheet itself (import "../client/sc-sheet.ts") gets its OWN copy of
// src/client/sc-sheet.ts inside the page's own chunk. Without it the bundler makes sc-sheet.*.js a shared chunk, and
// every such page loads one more file before its first paint (Lighthouse on a phone: FCP +35-80 ms, LCP up to +150 ms on
// /menu/ and the categories). The on-demand chunks of the runtime (src/client/*.ts: "Още", "Бисквитки", the assistant,
// "Предложи подобрение") and a page that loads the sheet later with import() (/praznik/) keep the shared sc-sheet.*.js
// (decision 17.11.2026).
// The module is safe to run twice on one page: only the first copy sets SC.sheet and listens for Escape.
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHEET = path.join(root, "src/client/sc-sheet.ts").split(path.sep).join("/");
const CLIENT = path.join(root, "src/client/").split(path.sep).join("/");
/* Pages that share one copy. The first JS file of a page is downloaded before the browser even sees the files it imports,
   so a bigger first file delays the whole page (the categories: LCP +130 ms with the copy in their first file). /menu/ and
   the categories already share the chunk of src/pages/menu/_menu.ts, loaded in the second wave: a copy with the same two
   importers joins that chunk (no extra file, the first file stays as before). Checked by scripts/build-checks.mjs. */
const GROUPS = { "src/pages/menu/index.astro": "menu", "src/pages/menu/[kategoria]/index.astro": "menu" };

export function sheetCopies() {
  return {
    name: "sc-sheet-copies",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (!importer || !/(^|\/)sc-sheet\.ts$/.test(source)) return null;
      /* import("…/sc-sheet.ts") (a page that loads the sheet later, /praznik/) gets the shared file */
      if (opts && opts.kind === "dynamic-import") return null;
      const from = importer.split("?")[0].split(path.sep).join("/");
      if (from.startsWith(CLIENT)) return null;
      const r = await this.resolve(source, importer, { ...opts, skipSelf: true });
      if (!r || r.id.split("?")[0].split(path.sep).join("/") !== SHEET) return r;
      /* one module per importer (the bundler keeps it in the importer's chunk), or per group */
      const rel = path.relative(root, from).split(path.sep).join("/");
      return SHEET + "?sheet-copy=" + (GROUPS[rel] ? "group-" + GROUPS[rel] : from.replace(/[^a-zA-Z0-9]+/g, "_").slice(-80));
    },
  };
}
