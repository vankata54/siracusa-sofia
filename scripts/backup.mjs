/* The daily backup of the live data (deploy/siracusa-backup.timer runs it; by hand: node scripts/backup.mjs).
   What is saved, into BACKUP_DIR (default: backups/ next to the data folder):
     db/siracusa-YYYYMMDD-HHMM.db.gz   a consistent copy of the SQLite database, taken while the server works (the online
                                       backup of SQLite: no half-written file, the WAL is included), checked with
                                       "PRAGMA integrity_check" BEFORE it counts as a backup, then gzip
     media/, receipts/                 the uploaded photos of the dishes and of the fuel receipts (new files only; their
                                       names are the hash of the content, a file never changes)
   What is kept (prune): every backup of the last KEEP_DAILY days (default 14), the newest one of each of the last
   KEEP_WEEKLY weeks (8, ISO weeks) and of the last KEEP_MONTHLY months (12). Never fewer than the newest 3.
   Off the server (GDPR: the place must be in the EU and private), when one of these is set in .env:
     BACKUP_RSYNC=user@host:folder     rsync over SSH (e.g. a storage box); BACKUP_RSYNC_SSH: extra ssh options (a port, a key)
     BACKUP_RCLONE=remote:folder       rclone (S3-compatible storage and others)
   With BACKUP_PASSFILE (a file with a passphrase, mode 600) the database copies are encrypted (gpg, AES-256) and only the
   encrypted files (*.db.gz.gpg) leave the server. Nothing is ever deleted in the place off the server (a new, empty
   server must not wipe the old backups): the old copies there are cleaned by hand or by the storage's own rule.
   Without a place off the server the script says so loudly on every run:
   a backup on the same disk does not survive the loss of the server.
   Exit code: 0 = saved (and sent, when a place is set); 1 = failed (systemd shows it; nothing was pruned).
   Options: --db <file>, --dir <folder>, --no-remote, --quiet. Restore: deploy/restore.sh. Never prints secrets. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** siracusa-YYYYMMDD-HHMM.db.gz (and .gpg) -> its date (UTC), or null for any other file */
export function stampOf(name) {
  const m = /^siracusa-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})\.db\.gz(?:\.gpg)?$/.exec(name);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])) : null;
}
const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return t.getUTCFullYear() + "-W" + Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
};
/** Which backups stay. names: the file names; now: Date. Returns the names to DELETE (never one of the newest 3;
    names that are not backups are never touched). */
export function prunePlan(names, now, keep = { daily: 14, weekly: 8, monthly: 12 }) {
  const list = names.map((n) => ({ n, d: stampOf(n) })).filter((x) => x.d).sort((a, b) => b.d - a.d);
  const stay = new Set(list.slice(0, 3).map((x) => x.n));
  const weeks = new Map(), months = new Map();
  for (const x of list) {
    const age = (now - x.d) / 86400000;
    if (age <= keep.daily) stay.add(x.n);
    const w = isoWeek(x.d), m = x.d.getUTCFullYear() + "-" + (x.d.getUTCMonth() + 1);
    if (!weeks.has(w)) weeks.set(w, x.n); /* the list is newest first: the newest of each week / month */
    if (!months.has(m)) months.set(m, x.n);
  }
  [...weeks.values()].slice(0, keep.weekly).forEach((n) => stay.add(n));
  [...months.values()].slice(0, keep.monthly).forEach((n) => stay.add(n));
  return list.filter((x) => !stay.has(x.n)).map((x) => x.n);
}
const pad = (n) => String(n).padStart(2, "0");
export const stampName = (d) => "siracusa-" + d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "-" + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + ".db.gz";

/** copy the files of `from` that `to` does not have yet (flat folders of content-named files); returns how many */
export function copyNew(from, to) {
  if (!fs.existsSync(from)) return 0;
  fs.mkdirSync(to, { recursive: true });
  let n = 0;
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (!e.isFile()) continue;
    const dst = path.join(to, e.name);
    if (fs.existsSync(dst) && fs.statSync(dst).size === fs.statSync(path.join(from, e.name)).size) continue;
    fs.copyFileSync(path.join(from, e.name), dst + ".part");
    fs.renameSync(dst + ".part", dst);
    n++;
  }
  return n;
}

/** One backup. o: {dbFile, dir, now?, keep?, passFile?, log?}. Returns {file, bytes, tables, media, receipts, pruned}. */
export async function backup(o) {
  const { default: Database } = await import("better-sqlite3");
  const log = o.log || (() => {});
  const now = o.now || new Date(), dbDir = path.join(o.dir, "db");
  if (!fs.existsSync(o.dbFile)) throw new Error("no database at " + o.dbFile);
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
  const name = stampName(now), raw = path.join(dbDir, name.replace(/\.gz$/, "") + ".part");
  fs.rmSync(raw, { force: true });
  /* the online backup: a consistent copy while the server writes */
  const src = new Database(o.dbFile, { readonly: true, fileMustExist: true });
  try { await src.backup(raw); } finally { src.close(); }
  /* the copy must open and pass the check before it counts */
  let tables = 0;
  const copy = new Database(raw, { readonly: true, fileMustExist: true });
  try {
    const ok = copy.pragma("integrity_check", { simple: true });
    if (ok !== "ok") throw new Error("the copy failed the integrity check: " + String(ok).slice(0, 200));
    tables = copy.prepare("select count(*) as n from sqlite_master where type = 'table'").get().n;
    if (!tables) throw new Error("the copy has no tables");
  } catch (e) { copy.close(); fs.rmSync(raw, { force: true }); throw e; }
  copy.close();
  let file = path.join(dbDir, name);
  fs.writeFileSync(file + ".part", zlib.gzipSync(fs.readFileSync(raw), { level: 9 }), { mode: 0o600 });
  fs.renameSync(file + ".part", file);
  fs.rmSync(raw, { force: true });
  for (const x of ["-wal", "-shm"]) fs.rmSync(raw + x, { force: true });
  if (o.passFile) {
    /* only the encrypted file stays (and leaves the server) */
    const r = spawnSync("gpg", ["--batch", "--yes", "--quiet", "--pinentry-mode", "loopback", "--symmetric", "--cipher-algo", "AES256", "--passphrase-file", o.passFile, "--output", file + ".gpg", file], { stdio: ["ignore", "ignore", "pipe"] });
    if (r.status !== 0) throw new Error("gpg failed: " + String(r.stderr || r.error || "").slice(0, 300));
    fs.chmodSync(file + ".gpg", 0o600);
    fs.rmSync(file, { force: true });
    file += ".gpg";
  }
  const dataDir = path.dirname(fs.realpathSync(o.dbFile));
  const media = copyNew(path.join(dataDir, "media"), path.join(o.dir, "media")), receipts = copyNew(path.join(dataDir, "receipts"), path.join(o.dir, "receipts"));
  const pruned = prunePlan(fs.readdirSync(dbDir), now, o.keep);
  for (const n of pruned) fs.rmSync(path.join(dbDir, n), { force: true });
  log("saved " + path.basename(file) + " (" + Math.round(fs.statSync(file).size / 1024) + " KB, " + tables + " tables), new photos: " + media + ", new receipts: " + receipts + ", old backups removed: " + pruned.length);
  return { file, bytes: fs.statSync(file).size, tables, media, receipts, pruned };
}

/** send the backup folder off the server; returns "rsync" | "rclone" | null (no place set). Throws when the copy fails. */
export function sendRemote(dir, env, log = () => {}) {
  const run = (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    if (r.error || r.status !== 0) throw new Error(cmd + " failed: " + String((r.error && r.error.message) || r.stderr || "").slice(0, 300));
  };
  /* with a passphrase only the encrypted copies of the database go out */
  const enc = !!env.BACKUP_PASSFILE;
  if (env.BACKUP_RSYNC) {
    const ssh = "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new" + (env.BACKUP_RSYNC_SSH ? " " + env.BACKUP_RSYNC_SSH : "");
    run("rsync", ["-a", "-e", ssh, ...(enc ? ["--exclude", "db/*.db.gz"] : []), dir.replace(/\/?$/, "/"), env.BACKUP_RSYNC.replace(/\/?$/, "/")]);
    log("sent with rsync");
    return "rsync";
  }
  if (env.BACKUP_RCLONE) {
    run("rclone", ["copy", ...(enc ? ["--exclude", "db/*.db.gz"] : []), dir, env.BACKUP_RCLONE]);
    log("sent with rclone");
    return "rclone";
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > -1 ? process.argv[i + 1] : undefined; };
  const quiet = process.argv.includes("--quiet"), log = (m) => { if (!quiet) console.log("backup: " + m); };
  /* the real place of the database: on the server data/ is a link into shared/ (deploy/deploy.sh), and the backups go
     next to that shared data folder, never into the folder of one version (old versions are deleted) */
  const real = (f) => { try { return fs.realpathSync(f); } catch { return path.resolve(f); } };
  const dbFile = real(arg("db") || process.env.DB_FILE || "data/siracusa.db");
  const dir = path.resolve(arg("dir") || process.env.BACKUP_DIR || path.join(path.dirname(dbFile), "..", "backups"));
  const num = (k, d) => (/^\d+$/.test(process.env[k] || "") ? +process.env[k] : d);
  try {
    await backup({ dbFile, dir, passFile: process.env.BACKUP_PASSFILE || undefined, log, keep: { daily: num("KEEP_DAILY", 14), weekly: num("KEEP_WEEKLY", 8), monthly: num("KEEP_MONTHLY", 12) } });
    const sent = process.argv.includes("--no-remote") ? "skipped" : sendRemote(dir, process.env, log);
    if (!sent) console.warn("backup: WARNING: no place off the server is set (BACKUP_RSYNC or BACKUP_RCLONE in .env). This backup is on the same disk as the site: it does not survive the loss of the server.");
  } catch (e) {
    console.error("backup: FAILED. " + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  }
}
