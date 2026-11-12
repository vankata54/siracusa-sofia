/* The icons the lunch page draws in the browser, in ONE request instead of 13 tiny shared chunks (review "потоци", Важни 2).
   The generated files in lib/icons/ stay the single source: they are read here as text (?raw, so Vite inlines them in
   this page's script) and their registerIcons({...}) map is registered. phone, check and x come with the runtime. */
import { registerIcons } from "../../lib/icons.ts";

const files = import.meta.glob(
  "../../lib/icons/{fork-knife,storefront,moped,warning,calendar-blank,calendar-dots,arrow-right,clock,warning-circle,bowl-food,caret-down,eye,plus}.ts",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

for (const src of Object.values(files)) {
  const m = /registerIcons\((\{[\s\S]*\})\);?\s*$/.exec(src);
  try { if (m) registerIcons(JSON.parse(m[1]) as Record<string, string>); } catch { /* unexpected format: SC.ic falls back to its default icon */ }
}
