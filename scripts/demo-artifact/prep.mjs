/* Prepares the demo (npm run build:demo -> dist/) for publishing as a claude.ai Artifact (docs/HANDOFF-NEXT.md, step 7):
   - the artifact service refuses published paths that start with "_": _astro/ -> assets/, and _file.js -> u_file.js;
   - the artifact's own page is scripts/demo-artifact/start.html (the doors into the site and every module): the site's
     home goes to nachalo.html (its links stay relative, the logo's "index.html" leads back to the doors);
   - writes the file lists in parts of at most 254 files (one publish takes 255 with the page).
   Usage: node scripts/demo-artifact/prep.mjs <outDir>   then publish <outDir>/index.html with root <outDir>/site and
   the files of parts-1.json, then of parts-2.json, to the same artifact url. */
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] || "demo-artifact-out");
const site = path.join(out, "site");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync("dist", site, { recursive: true });
fs.renameSync(path.join(site, "index.html"), path.join(site, "nachalo.html"));
fs.renameSync(path.join(site, "_astro"), path.join(site, "assets"));
const under = fs.readdirSync(path.join(site, "assets")).filter((f) => f.startsWith("_"));
for (const f of under) fs.renameSync(path.join(site, "assets", f), path.join(site, "assets", "u" + f));
const all = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(d, e.name)) : [path.join(d, e.name)]));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
for (const file of all(site)) {
  if (!/\.(html|js|css|json|txt|svg)$/.test(file)) continue;
  let t = fs.readFileSync(file, "utf8"), t0 = t;
  t = t.replaceAll("_astro/", "assets/");
  for (const f of under) t = t.replace(new RegExp("([/\"'])" + esc(f), "g"), "$1u" + f);
  if (t !== t0) fs.writeFileSync(file, t);
}
fs.copyFileSync("scripts/demo-artifact/start.html", path.join(out, "index.html"));
const list = all(site).map((f) => path.relative(site, f).split(path.sep).join("/")).sort();
const left = list.filter((f) => f.startsWith("_") || f.includes("/_") && f.startsWith("assets/"));
if (left.length) throw new Error("paths still starting with _: " + left.join(", "));
for (let i = 0, k = 1; i < list.length; i += 254, k++) fs.writeFileSync(path.join(out, "parts-" + k + ".json"), JSON.stringify(list.slice(i, i + 254)));
console.log(list.length + " files in " + Math.ceil(list.length / 254) + " parts -> " + out);
