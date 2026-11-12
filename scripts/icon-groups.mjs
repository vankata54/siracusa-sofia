// Vite plugin: `import "sc-icons:moon,truck,info";` registers these icons from ONE generated module.
// The module is unique to that list, so Vite puts it into the importing page's own chunk (one request instead of a
// tiny shared chunk per icon, and other pages do not grow). Source: the generated src/lib/icons/<name>.ts files.
// An unknown name fails the build (no silent "?" icon).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "sc-icons:";
/* the icons the shared runtime registers itself (src/lib/chrome-core.ts, src/lib/icons.ts): in the browser a group leaves them
   out, so no page ships them twice. On the server (SSR, Astro frontmatter, vitest) the group keeps them. */
export const RUNTIME_ICONS = ["x", "check", "caret-right", "phone", "question"];

export function iconSvgs(names) {
  const out = {};
  for (const n of names) {
    const f = path.join(root, "src/lib/icons", n + ".ts");
    if (!/^[a-z0-9-]+$/.test(n) || !fs.existsSync(f)) throw new Error(`sc-icons: no icon "${n}" in src/lib/icons/`);
    const m = /registerIcons\((\{[\s\S]*\})\);?\s*$/.exec(fs.readFileSync(f, "utf8"));
    Object.assign(out, JSON.parse(m[1]));
  }
  return out;
}

export function iconGroups() {
  return {
    name: "sc-icon-groups",
    enforce: "pre",
    /* one module per importer (the same list in two files would otherwise become a tiny shared chunk of its own) */
    resolveId(id, importer) { return id.startsWith(PREFIX) ? "\0" + id + "|" + String(importer || "").replace(/[^a-zA-Z0-9]+/g, "_").slice(-60) : null; },
    load(id, opts) {
      if (!id.startsWith("\0" + PREFIX)) return null;
      const all = [...new Set(id.slice(PREFIX.length + 1).split("|")[0].split(",").map((s) => s.trim()).filter(Boolean))].sort();
      iconSvgs(all); /* an unknown name fails the build also when it is left out below */
      const names = opts && opts.ssr ? all : all.filter((n) => !RUNTIME_ICONS.includes(n));
      if (!names.length) return "export {};\n";
      const icons = path.join(root, "src/lib/icons.ts").split(path.sep).join("/");
      return `import { registerIcons } from ${JSON.stringify(icons)};\nregisterIcons(${JSON.stringify(iconSvgs(names))});\n`;
    },
  };
}
