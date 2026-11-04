// Screenshots of a route of the code (analogue of design/tools/shoot.js).
// Usage:
//   node scripts/shoot.mjs /menu/ shots/menu [--time=21:30] [--click="sel|sel"] [--scroll=800] [--base=http://localhost:8787] [--dist] [--only=390,1440]
//   Server mode (default): npm run build && npm run serve, then shoot http://localhost:8787<route>.
//   --dist: serve dist/ with a tiny built-in static server (no API); good for the demo build (npm run build:demo).
// Makes: 360 light, 390 light, 390 dark, 1440 light, full-page 390; prints console errors and horizontal overflow.
// The clock (--time, default 12:30) works through ?preview=1&t=HH:MM (preview mode, see src/client/sc.ts).
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require("/opt/node-tools/node_modules/playwright")); }

const args = process.argv.slice(2);
const route = args[0] || "/";
const out = args[1] && !args[1].startsWith("--") ? args[1] : "shots";
const opt = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => { const i = a.indexOf("="); return i < 0 ? [a.slice(2), "1"] : [a.slice(2, i), a.slice(i + 1)]; }));
fs.mkdirSync(out, { recursive: true });

let server, base = opt.base || "http://localhost:8787";
if (opt.dist) {
  const root = path.resolve(opt.dist === "1" ? "dist" : opt.dist);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
  server = http.createServer((q, s) => {
    let p = path.join(root, decodeURIComponent(q.url.split("?")[0].split("#")[0]));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
    if (!fs.existsSync(p)) { s.writeHead(404); return s.end("not found"); }
    s.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" }); fs.createReadStream(p).pipe(s);
  });
  await new Promise((r) => server.listen(0, r));
  base = "http://localhost:" + server.address().port;
}
const time = opt.time || "12:30";
const [p0, hash] = route.split("#");
const url = base + p0 + (p0.includes("?") ? "&" : "?") + "preview=1&t=" + time + (hash ? "#" + hash : "");
const name = (route.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home");

const runs = [["360-light", 360, 780, "light"], ["390-light", 390, 844, "light"], ["390-dark", 390, 844, "dark"], ["1440-light", 1440, 900, "light"]]
  .filter((r) => !opt.only || opt.only.split(",").includes(String(r[1])));
const b = await chromium.launch();
const errors = [];
for (const [tag, w, h, theme] of runs) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: theme, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(tag + ": " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push(tag + ": " + m.text()); });
  await p.addInitScript(([theme]) => { localStorage.setItem("sc-prefs", JSON.stringify({ theme })); localStorage.setItem("sc-cookie", '"min"'); }, [theme]);
  await p.goto(url, { waitUntil: "networkidle" });
  await p.waitForTimeout(900);
  if (opt.click) for (const sel of opt.click.split("|")) { await p.click(sel).catch(() => errors.push("click failed: " + sel)); await p.waitForTimeout(500); }
  if (opt.scroll) { await p.evaluate((y) => window.scrollTo(0, +y), opt.scroll); await p.waitForTimeout(800); }
  const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (over > 0) errors.push(`${tag}: horizontal overflow ${over}px`);
  await p.screenshot({ path: `${out}/${name}-${tag}.png` });
  if (tag === "390-light") await p.screenshot({ path: `${out}/${name}-full.png`, fullPage: true });
  await ctx.close();
}
await b.close();
server && server.close();
console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
console.log("screenshots in", out, "(" + url + ")");
