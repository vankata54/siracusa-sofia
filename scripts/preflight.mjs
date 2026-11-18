/* The check before the site takes real customers, and after every change of the server (docs/DEPLOY.md):
     node scripts/preflight.mjs                 the settings in .env, the database, the built site, the backups, the local server
     node scripts/preflight.mjs --url https://siracusa-sofia.com     also from outside: HTTPS, HTTP/2, the redirect from http,
                                                                    the security headers, the live stream through the proxy
   Every line is OK, WARN (works, but look at it) or FAIL (do not go live). Exit code 1 when anything fails.
   Never prints a value from .env. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { readEnv, STAFF } from "./env.mjs";
import { stampOf } from "./backup.mjs";

/** The checks of the settings (pure: the tests call it). env: the keys of .env; mode: the file's permission bits or null.
    @param {Record<string, string | undefined>} env @param {number | null} [mode]
    @returns {{ level: "OK" | "WARN" | "FAIL", text: string }[]} */
export function checkEnv(env, mode = null) {
  const out = [], add = (level, text) => out.push({ level, text });
  const has = (k) => typeof env[k] === "string" && env[k].trim() !== "";
  if (mode != null) add(mode & 0o077 ? "FAIL" : "OK", mode & 0o077 ? ".env can be read by other users of the server: chmod 600 .env" : ".env is private (mode 600)");
  add(env.COOKIE_SECURE === "1" ? "OK" : "FAIL", env.COOKIE_SECURE === "1" ? "COOKIE_SECURE=1: the sign-in cookies travel only over HTTPS" : "COOKIE_SECURE=1 is missing: the sign-in cookies could travel without HTTPS");
  add(env.TRUST_PROXY === "1" || env.TRUST_PROXY === "cloudflare" ? "OK" : "FAIL", env.TRUST_PROXY === "1" || env.TRUST_PROXY === "cloudflare" ? "TRUST_PROXY=" + env.TRUST_PROXY + ": the limits see the real address of each visitor" : "TRUST_PROXY is missing (1 behind nginx, cloudflare behind Cloudflare): every visitor would count as one address and the limits would lock everybody out");
  const site = has("SITE_URL") ? env.SITE_URL.trim() : "";
  add(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(site) && !/localhost/.test(site) ? "OK" : "FAIL", site ? (/^https:\/\//.test(site) ? "SITE_URL is an https address" + (/localhost/.test(site) ? " but it is localhost" : "") : "SITE_URL must start with https://") : "SITE_URL is missing (the addresses in the sitemap and in the pages come from it)");
  if (env.SC_PREVIEW_API === "1") add("FAIL", "SC_PREVIEW_API=1 is the test mode (no limits, the page sets the clock): remove it");
  if (env.TRACK_KEY_REQUIRED === "0") add("FAIL", "TRACK_KEY_REQUIRED=0: anyone could open an order by its number alone: remove it");
  add(env.SMS_DEMO === "1" ? "FAIL" : "OK", env.SMS_DEMO === "1" ? "SMS_DEMO=1 shows the sign-in code on the screen instead of sending it: remove it before real customers" : "SMS_DEMO is off (the sign-in code is never shown on the screen)");
  /* the staff passwords: all there, long, none used twice */
  const pw = STAFF.map((s) => s[3]), missing = pw.filter((k) => !has(k)), short = pw.filter((k) => has(k) && env[k].length < 14);
  const seen = new Map(); let twice = false;
  for (const k of pw) if (has(k)) { if (seen.has(env[k])) twice = true; seen.set(env[k], k); }
  add(missing.length ? "FAIL" : "OK", missing.length ? "no password for: " + missing.join(", ") + " (node scripts/make-env.mjs makes them)" : "every staff account has a password");
  if (short.length) add("FAIL", "a password shorter than 14 characters: " + short.join(", "));
  if (twice) add("FAIL", "two staff accounts share one password");
  add(has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY") ? "OK" : "WARN", has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY") ? "the keys for the notifications (Web Push) are set" : "no VAPID keys: the notifications for the order status are off (node scripts/make-env.mjs adds them)");
  add(has("SECRET_KEY") ? "OK" : "WARN", has("SECRET_KEY") ? "SECRET_KEY is set (the two-step sign-in can be switched on)" : "no SECRET_KEY: the two-step sign-in of the main admin and the owner cannot be switched on (node scripts/make-env.mjs adds it)");
  add(has("BACKUP_RSYNC") || has("BACKUP_RCLONE") ? "OK" : "WARN", has("BACKUP_RSYNC") || has("BACKUP_RCLONE") ? "the backups leave the server (" + (has("BACKUP_RSYNC") ? "rsync" : "rclone") + ")" : "no place off the server for the backups (BACKUP_RSYNC or BACKUP_RCLONE): a backup on the same disk does not survive the loss of the server");
  if ((has("BACKUP_RSYNC") || has("BACKUP_RCLONE")) && !has("BACKUP_PASSFILE")) add("WARN", "the backups leave the server without encryption (BACKUP_PASSFILE): fine only when the place is private and in the EU");
  return out;
}

/** The newest backup in <dir>/db: {level, text}. now: ms.
    @param {string} dir @param {number} [now] @returns {{ level: "OK" | "WARN" | "FAIL", text: string }} */
export function checkBackups(dir, now = Date.now()) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, "db")); } catch { /* no folder */ }
  const times = names.map((n) => stampOf(n)).filter(Boolean).map((d) => d.getTime()).sort((a, b) => b - a);
  if (!times.length) return { level: "FAIL", text: "no backup yet in " + path.join(dir, "db") + " (node scripts/backup.mjs; the nightly timer: deploy/siracusa-backup.timer)" };
  const h = Math.round((now - times[0]) / 3600_000);
  return h > 26 ? { level: "FAIL", text: "the newest backup is " + h + " hours old: the nightly backup does not run (systemctl list-timers siracusa-backup.timer)" } : { level: "OK", text: "the newest backup is " + h + " h old (" + times.length + " kept)" };
}

/** The built site in <dist>: a server build (never the demo), with the files the server needs.
    @param {string} dist @returns {{ level: "OK" | "WARN" | "FAIL", text: string }[]} */
export function checkDist(dist) {
  const out = [], add = (level, text) => out.push({ level, text });
  const read = (f) => { try { return fs.readFileSync(path.join(dist, f), "utf8"); } catch { return null; } };
  const index = read("index.html");
  if (index == null) { add("FAIL", "no built site in " + dist + " (deploy/deploy.sh builds it)"); return out; }
  add(/<html[^>]*\bdata-demo\b/.test(index) ? "FAIL" : "OK", /<html[^>]*\bdata-demo\b/.test(index) ? "the site in " + dist + " is the DEMO build (data in the browser): build the server version" : "the built site is the server version");
  const robots = read("robots.txt");
  add(robots != null && !/^Disallow:\s*\/\s*$/m.test(robots) ? "OK" : "FAIL", robots == null ? "no robots.txt in the build" : /^Disallow:\s*\/\s*$/m.test(robots) ? "robots.txt closes the whole site to the search engines (the demo's file)" : "robots.txt lets the search engines in");
  add(read("redirects.json") != null ? "OK" : "FAIL", read("redirects.json") != null ? "redirects.json is there (the old addresses of the dishes lead to the new ones)" : "no redirects.json: the old addresses of the dishes would be 404");
  add(read("sitemap.xml") != null || read("sitemap-index.xml") != null ? "OK" : "WARN", read("sitemap.xml") != null || read("sitemap-index.xml") != null ? "the sitemap is there" : "no sitemap in the build");
  add(read("sw.js") != null ? "OK" : "WARN", read("sw.js") != null ? "the service worker file is there" : "no sw.js in the build (notifications and the staff modules without a connection)");
  return out;
}

const curl = (args) => { const r = spawnSync("curl", ["-sS", "-m", "10", ...args], { encoding: "utf8" }); return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() }; };

/** From outside, through the proxy: HTTPS, HTTP/2, the redirect, the headers, the live stream. */
export function checkUrl(url) {
  const out = [], add = (level, text) => out.push({ level, text });
  const u = new URL(url), base = u.origin;
  if (u.protocol !== "https:") { add("FAIL", "the address must be https://"); return out; }
  const head = curl(["-o", "/dev/null", "-D", "-", "-w", "\n%{http_version} %{http_code}", base + "/"]);
  if (!head.ok) { add("FAIL", "the site does not answer at " + base + " (" + head.err.slice(0, 120) + ")"); return out; }
  const [ver, code] = head.out.trim().split("\n").pop().split(" "), h = head.out.toLowerCase();
  add(code === "200" ? "OK" : "FAIL", "the home page answers " + code + " over HTTPS (the certificate is valid)");
  add(ver === "2" || ver === "3" ? "OK" : "FAIL", ver === "2" || ver === "3" ? "HTTP/" + ver + " is on" : "HTTP/2 is off (HTTP/" + ver + "): the site was measured with it (nginx: listen 443 ssl http2)");
  add(/content-encoding: (br|gzip)/.test(curl(["-o", "/dev/null", "-D", "-", "-H", "Accept-Encoding: br, gzip", base + "/"]).out.toLowerCase()) ? "OK" : "WARN", "the pages arrive compressed (brotli or gzip)");
  add(/strict-transport-security:/.test(h) ? "OK" : "WARN", /strict-transport-security:/.test(h) ? "Strict-Transport-Security is sent" : "no Strict-Transport-Security header");
  add(/x-content-type-options: nosniff/.test(h) ? "OK" : "WARN", /x-content-type-options: nosniff/.test(h) ? "X-Content-Type-Options: nosniff is sent" : "no X-Content-Type-Options header");
  const plain = curl(["-o", "/dev/null", "-w", "%{http_code} %{redirect_url}", "http://" + u.host + "/"]);
  add(/^30[18] https:\/\//.test(plain.out) ? "OK" : "FAIL", /^30[18] https:\/\//.test(plain.out) ? "http:// leads to https://" : "http:// does not lead to https:// (answer: " + (plain.out || plain.err).slice(0, 80) + ")");
  const health = curl([base + "/api/health"]);
  add(/"ok":true/.test(health.out) ? "OK" : "FAIL", /"ok":true/.test(health.out) ? "the API answers" : "the API does not answer at /api/health");
  /* the stream must deliver its first event at once: a proxy that buffers would hold it back (the kitchen would be late) */
  const sse = spawnSync("curl", ["-sS", "-N", "-m", "4", "-D", "-", base + "/api/stream"], { encoding: "utf8" });
  const first = /event: hello/.test(sse.stdout || "");
  add(first && /content-type: text\/event-stream/i.test(sse.stdout || "") ? "OK" : "FAIL", first ? "the live stream delivers at once through the proxy" : "the live stream does not deliver within 4 s: the proxy buffers it (nginx: proxy_buffering off for /api/stream)");
  const missing = curl(["-o", "/dev/null", "-w", "%{http_code}", base + "/niama-takava-stranitsa-" + Date.now() + "/"]);
  add(missing.out === "404" ? "OK" : "WARN", "an unknown address answers " + missing.out + (missing.out === "404" ? "" : " (expected 404)"));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : undefined; };
  const envFile = path.resolve(arg("env") || ".env"), env = readEnv(envFile);
  const lines = [];
  const [maj, min] = process.versions.node.split(".").map(Number);
  lines.push({ level: maj > 22 || (maj === 22 && min >= 12) ? "OK" : "FAIL", text: "Node.js " + process.versions.node + (maj > 22 || (maj === 22 && min >= 12) ? "" : " (22.12 or newer is needed)") });
  if (!fs.existsSync(envFile)) lines.push({ level: "FAIL", text: "no .env at " + envFile + " (node scripts/make-env.mjs)" });
  else lines.push(...checkEnv(env, fs.statSync(envFile).mode & 0o777));
  /* the database: opens, is whole, its folder can be written */
  /* the real place: on the server data/ is a link into shared/ and the backups are next to it (scripts/backup.mjs) */
  const real = (f) => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
  const dbFile = real(arg("db") || env.DB_FILE || "data/siracusa.db");
  try {
    const { default: Database } = await import("better-sqlite3");
    fs.accessSync(path.dirname(dbFile), fs.constants.W_OK);
    const d = new Database(dbFile, { readonly: true, fileMustExist: true });
    const ok = d.pragma("quick_check", { simple: true });
    d.close();
    lines.push({ level: ok === "ok" ? "OK" : "FAIL", text: ok === "ok" ? "the database opens and is whole" : "the database fails its check: " + String(ok).slice(0, 120) });
    lines.push({ level: fs.statSync(dbFile).mode & 0o077 ? "WARN" : "OK", text: fs.statSync(dbFile).mode & 0o077 ? "the database file can be read by other users of the server (chmod 600, folder 700)" : "the database file is private" });
  } catch (e) { lines.push({ level: "FAIL", text: "the database at " + dbFile + " does not open or its folder cannot be written (" + String(e instanceof Error ? e.message : e).slice(0, 100) + ")" }); }
  lines.push(...checkDist(path.resolve(arg("dist") || env.DIST_DIR || "dist")));
  lines.push(checkBackups(path.resolve(arg("backups") || env.BACKUP_DIR || path.join(path.dirname(dbFile), "..", "backups"))));
  const port = env.PORT || "8787", local = curl(["http://127.0.0.1:" + port + "/api/health"]);
  lines.push({ level: /"ok":true/.test(local.out) ? "OK" : "FAIL", text: /"ok":true/.test(local.out) ? "the server answers on port " + port : "the server does not answer on port " + port + " (systemctl status siracusa)" });
  if (arg("url")) lines.push(...checkUrl(arg("url")));
  for (const l of lines) console.log(l.level.padEnd(5) + " " + l.text);
  const fail = lines.filter((l) => l.level === "FAIL").length, warn = lines.filter((l) => l.level === "WARN").length;
  console.log("\n" + (fail ? "NOT READY: " + fail + " to fix" + (warn ? ", " + warn + " to look at" : "") : warn ? "READY, with " + warn + " to look at" : "READY"));
  process.exit(fail ? 1 : 0);
}
