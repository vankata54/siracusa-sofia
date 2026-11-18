/* The daily backup (scripts/backup.mjs): a consistent, checked copy of the database while it is written, the uploaded
   photos, which old backups stay, encryption, and the restore of a copy (what deploy/restore.sh does). */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { backup, prunePlan, stampOf, stampName, copyNew } from "../../scripts/backup.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-backup-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const DAY = 86400000;

describe("backup: which copies stay", () => {
  const now = new Date(Date.UTC(2026, 10, 18, 2, 30));
  const names = Array.from({ length: 400 }, (_, i) => stampName(new Date(now.getTime() - i * DAY)));
  it("the name carries the time; other files are not backups", () => {
    expect(stampName(now)).toBe("siracusa-20261118-0230.db.gz");
    expect(stampOf("siracusa-20261118-0230.db.gz")!.getTime()).toBe(now.getTime());
    expect(stampOf("siracusa-20261118-0230.db.gz.gpg")!.getTime()).toBe(now.getTime());
    expect(stampOf("siracusa.db")).toBeNull();
    expect(stampOf("notes.txt")).toBeNull();
  });
  it("14 days, 8 weeks, 12 months; never the newest three; unknown files are never listed", () => {
    const gone = prunePlan([...names, "notes.txt", "siracusa.db"], now) as string[];
    const stay = names.filter((n) => !gone.includes(n));
    expect(gone).not.toContain("notes.txt");
    expect(gone).not.toContain("siracusa.db");
    /* every day of the last two weeks */
    for (let i = 0; i <= 14; i++) expect(stay).toContain(names[i]);
    /* then one a week, then one a month: far fewer than 400, and the oldest kept one is about a year old */
    expect(stay.length).toBeGreaterThan(15 + 5);
    expect(stay.length).toBeLessThan(15 + 8 + 12 + 1);
    const oldest = stampOf(stay[stay.length - 1])!;
    expect((now.getTime() - oldest.getTime()) / DAY).toBeGreaterThan(300);
    expect((now.getTime() - oldest.getTime()) / DAY).toBeLessThan(366);
    /* old backups only: the newest three stay whatever the rule says */
    const old = [0, 1, 2, 3, 4].map((i) => stampName(new Date(now.getTime() - (900 + i) * DAY)));
    expect(prunePlan(old, now, { daily: 0, weekly: 0, monthly: 0 })).toEqual(old.slice(3));
    /* running it again deletes nothing more */
    expect(prunePlan(stay, now)).toEqual([]);
  });
});

describe("backup: the copy", () => {
  const data = path.join(tmp, "data"), dbFile = path.join(data, "siracusa.db"), dir = path.join(tmp, "backups");
  fs.mkdirSync(path.join(data, "media"), { recursive: true });
  fs.mkdirSync(path.join(data, "receipts"), { recursive: true });
  const live = new Database(dbFile);
  live.pragma("journal_mode = WAL");
  live.exec("create table orders (no integer primary key, total text)");
  const add = live.prepare("insert into orders (total) values (?)");
  for (let i = 0; i < 500; i++) add.run("10,22 €");
  fs.writeFileSync(path.join(data, "media", "a".repeat(64) + ".webp"), "photo-1");
  fs.writeFileSync(path.join(data, "receipts", "b".repeat(64) + ".jpg"), "receipt-1");
  afterAll(() => live.close());
  const open = (gz: string) => { const f = path.join(tmp, "check-" + path.basename(gz, ".gz")); fs.writeFileSync(f, zlib.gunzipSync(fs.readFileSync(gz))); return new Database(f, { readonly: true }); };

  it("a checked copy while the database is open and has rows only in the WAL; the photos; private files", async () => {
    const r = await backup({ dbFile, dir, now: new Date(Date.UTC(2026, 10, 18, 2, 30)) });
    expect(path.basename(r.file)).toBe("siracusa-20261118-0230.db.gz");
    expect(r).toMatchObject({ tables: 1, media: 1, receipts: 1, pruned: [] });
    expect(fs.statSync(r.file).mode & 0o077).toBe(0);
    const c = open(r.file);
    expect(c.prepare("select count(*) as n from orders").get()).toEqual({ n: 500 });
    c.close();
    expect(fs.readFileSync(path.join(dir, "media", "a".repeat(64) + ".webp"), "utf8")).toBe("photo-1");
    expect(fs.readFileSync(path.join(dir, "receipts", "b".repeat(64) + ".jpg"), "utf8")).toBe("receipt-1");
    /* nothing half-made is left behind */
    expect(fs.readdirSync(path.join(dir, "db"))).toEqual(["siracusa-20261118-0230.db.gz"]);
  });
  it("the next day: only the new photos are copied, the new rows are in, the old copy stays", async () => {
    add.run("7,15 €");
    fs.writeFileSync(path.join(data, "media", "c".repeat(64) + ".webp"), "photo-2");
    const r = await backup({ dbFile, dir, now: new Date(Date.UTC(2026, 10, 19, 2, 30)) });
    expect(r).toMatchObject({ media: 1, receipts: 0, pruned: [] });
    const c = open(r.file);
    expect(c.prepare("select count(*) as n from orders").get()).toEqual({ n: 501 });
    c.close();
    expect(fs.readdirSync(path.join(dir, "db")).sort()).toEqual(["siracusa-20261118-0230.db.gz", "siracusa-20261119-0230.db.gz"]);
    expect(copyNew(path.join(data, "media"), path.join(dir, "media"))).toBe(0);
  });
  it("old copies are pruned by the rule after a good backup", async () => {
    const r = await backup({ dbFile, dir, now: new Date(Date.UTC(2026, 10, 20, 2, 30)), keep: { daily: 0, weekly: 0, monthly: 0 } });
    expect(r.pruned).toEqual([]); /* three copies: the newest three always stay */
    const r2 = await backup({ dbFile, dir, now: new Date(Date.UTC(2026, 10, 21, 2, 30)), keep: { daily: 0, weekly: 0, monthly: 0 } });
    expect(r2.pruned).toEqual(["siracusa-20261118-0230.db.gz"]);
    expect(fs.readdirSync(path.join(dir, "db"))).toHaveLength(3);
  });
  it("no database: an error, nothing written and nothing pruned", async () => {
    const before = fs.readdirSync(path.join(dir, "db"));
    await expect(backup({ dbFile: path.join(tmp, "nope.db"), dir })).rejects.toThrow(/no database/);
    expect(fs.readdirSync(path.join(dir, "db"))).toEqual(before);
  });
  it("a broken database never becomes a backup", async () => {
    const bad = path.join(tmp, "bad", "siracusa.db"), badDir = path.join(tmp, "bad-backups");
    fs.mkdirSync(path.dirname(bad), { recursive: true });
    fs.writeFileSync(bad, "this is not a database, only text. ".repeat(200));
    await expect(backup({ dbFile: bad, dir: badDir })).rejects.toThrow();
    expect(fs.existsSync(path.join(badDir, "db")) ? fs.readdirSync(path.join(badDir, "db")).filter((f) => f.endsWith(".gz")) : []).toEqual([]);
  });
  it("with a passphrase only the encrypted copy stays, and it opens with the passphrase", async () => {
    const pass = path.join(tmp, "pass.txt"), encDir = path.join(tmp, "enc-backups");
    fs.writeFileSync(pass, "a long test passphrase 123\n", { mode: 0o600 });
    const r = await backup({ dbFile, dir: encDir, passFile: pass, now: new Date(Date.UTC(2026, 10, 18, 2, 30)) });
    expect(path.basename(r.file)).toBe("siracusa-20261118-0230.db.gz.gpg");
    expect(fs.readdirSync(path.join(encDir, "db"))).toEqual(["siracusa-20261118-0230.db.gz.gpg"]);
    expect(fs.readFileSync(r.file).includes(Buffer.from("SQLite format 3"))).toBe(false);
    const out = path.join(tmp, "dec.db.gz");
    const d = spawnSync("gpg", ["--batch", "--yes", "--quiet", "--pinentry-mode", "loopback", "--passphrase-file", pass, "--output", out, "--decrypt", r.file]);
    expect(d.status).toBe(0);
    const c = open(out);
    expect((c.prepare("select count(*) as n from orders").get() as { n: number }).n).toBeGreaterThanOrEqual(500);
    c.close();
  });
});
