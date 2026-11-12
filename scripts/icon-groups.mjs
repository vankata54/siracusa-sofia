// Vite plugin: `import "sc-icons:moon,truck,info";` registers these icons from ONE generated module.
// The module is unique to that list, so Vite puts it into the importing page's own chunk (one request instead of a
// tiny shared chunk per icon, and other pages do not grow). Source: the generated src/lib/icons/<name>.ts files.
// An unknown name fails the build (no silent "?" icon).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = "sc-icons:";

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
    resolveId(id) { return id.startsWith(PREFIX) ? "\0" + id : null; },
    load(id) {
      if (!id.startsWith("\0" + PREFIX)) return null;
      const names = [...new Set(id.slice(PREFIX.length + 1).split(",").map((s) => s.trim()).filter(Boolean))].sort();
      const icons = path.join(root, "src/lib/icons.ts").split(path.sep).join("/");
      return `import { registerIcons } from ${JSON.stringify(icons)};\nregisterIcons(${JSON.stringify(iconSvgs(names))});\n`;
    },
  };
}
