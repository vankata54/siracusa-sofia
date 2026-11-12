// Demo build: rewrites absolute site paths in dist/ to relative ones, so the site works from any sub-folder of a static
// server (e.g. https://host/some/folder/) without our Node server.
//   href="/menu/"         -> href="../menu/index.html"   (from /menu/pitsi/index.html: "../index.html")
//   src="/_astro/x.js"    -> src="../_astro/x.js"
//   url(/_astro/f.woff2)  -> url(../_astro/f.woff2)      (in HTML and CSS)
//   Vite's preload helper in _astro/*.js: "/" + "_astro/x.js" -> new URL("../_astro/x.js", import.meta.url)
//   (the chunks are all in _astro/, so the dynamic imports and their preload links work from any sub-folder)
// Absolute URLs (https:, tel:, mailto:, //) and #anchors are left alone. Usage: node scripts/relativize.mjs dist
import fs from "node:fs";
import path from "node:path";
import { runtimeSizes, uiSizes, RUNTIME_BUDGET, UI_BUDGET } from "./build-checks.mjs";

const dist = path.resolve(process.argv[2] || "dist");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : files.push(p); } })(dist);

function rel(fromFile, abs) {
  const m = /^([^?#]*)([?#].*)?$/.exec(abs);
  let p = m[1], tail = m[2] || "";
  const target = path.join(dist, p);
  if (p.endsWith("/")) p += "index.html";
  else if (!path.extname(p) && fs.existsSync(path.join(target, "index.html"))) p += "/index.html";
  let r = path.relative(path.dirname(fromFile), path.join(dist, p)).split(path.sep).join("/");
  if (!r.startsWith(".")) r = "./" + r;
  return r + tail;
}
const ABS = /^\/(?!\/)/;
let n = 0;
const PRELOAD = /function\((\w+)\)\{return`\/`\+\1\}/g;
let js = 0;
for (const f of files) {
  const ext = path.extname(f);
  if (ext === ".js") {
    const s = fs.readFileSync(f, "utf8");
    if (PRELOAD.test(s)) { fs.writeFileSync(f, s.replace(PRELOAD, (_, v) => `function(${v}){return new URL("../"+${v},import.meta.url).href}`)); js++; }
    PRELOAD.lastIndex = 0;
    continue;
  }
  if (ext !== ".html" && ext !== ".css") continue;
  let s = fs.readFileSync(f, "utf8");
  const before = s;
  if (ext === ".html") s = s.replace(/\b(href|src|action|poster|content)=("|')(\/[^"']*)\2/g, (all, a, q, v) => (ABS.test(v) && !(a === "content") ? `${a}=${q}${rel(f, v)}${q}` : all));
  s = s.replace(/url\((["']?)(\/[^)"']+)\1\)/g, (all, q, v) => (ABS.test(v) ? `url(${q}${rel(f, v)}${q})` : all));
  if (s !== before) { fs.writeFileSync(f, s); n++; }
}
console.log(`relativize: ${n} files rewritten (+${js} JS preload helper) in ${path.relative(process.cwd(), dist) || "."}`);
/* the budgets again, on the files that are uploaded: the preload helper above adds a few bytes after the build check (keen Д7) */
for (const [list, max, what] of [[runtimeSizes(dist), RUNTIME_BUDGET, "shared runtime"], [uiSizes(dist), UI_BUDGET, "shared components"]]) {
  for (const x of list) {
    if (x.bytes > max) throw new Error(`relativize: the ${what} ${x.file} is ${x.bytes} B after relativize, over the budget of ${max} B (docs/DECISIONS.md 12.11.2026)`);
    console.log(`relativize: ${what} ${x.file}: ${x.bytes} / ${max} B (as uploaded)`);
  }
}
