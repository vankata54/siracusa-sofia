/* The check before going live (scripts/preflight.mjs): the settings that must never reach real customers wrong. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkEnv, checkBackups, checkDist } from "../../scripts/preflight.mjs";
import { stampName } from "../../scripts/backup.mjs";

type Line = { level: "OK" | "WARN" | "FAIL"; text: string };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-preflight-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const pw = (n: number) => "long-password-number-" + n;
const GOOD: Record<string, string> = {
  PORT: "8787", SITE_URL: "https://siracusa-sofia.com", DB_FILE: "data/siracusa.db", COOKIE_SECURE: "1", TRUST_PROXY: "1", ADMIN_USER: "admin",
  ADMIN_PASSWORD: pw(1), OWNER_PASSWORD: pw(2), MANAGER_PASSWORD: pw(3), WAITER_PASSWORD: pw(4), KITCHEN_PASSWORD: pw(5), DRIVER_PASSWORD: pw(6), MARKETING_PASSWORD: pw(7),
  VAPID_PUBLIC_KEY: "vapid-public-value", VAPID_PRIVATE_KEY: "vapid-private-value", SECRET_KEY: "secret-key-value", BACKUP_RSYNC: "backup-user@backup-host:dir", BACKUP_PASSFILE: "/srv/siracusa/shared/backup.pass",
};
const fails = (l: Line[]) => l.filter((x) => x.level === "FAIL").map((x) => x.text);
const warns = (l: Line[]) => l.filter((x) => x.level === "WARN").map((x) => x.text);

describe("preflight: the settings", () => {
  it("a complete .env of a live server: nothing to fix, nothing to look at; no value is ever printed", () => {
    const l = checkEnv(GOOD, 0o600) as Line[];
    expect(fails(l)).toEqual([]);
    expect(warns(l)).toEqual([]);
    const all = l.map((x) => x.text).join("\n");
    for (const k of Object.keys(GOOD)) if (/PASSWORD|KEY|PASSFILE|RSYNC/.test(k)) expect(all).not.toContain(GOOD[k]);
  });
  it("each dangerous setting is a FAIL", () => {
    const one = (patch: Record<string, string | undefined>, mode = 0o600) => fails(checkEnv({ ...GOOD, ...patch }, mode) as Line[]).join(" | ");
    expect(one({ COOKIE_SECURE: undefined })).toMatch(/COOKIE_SECURE/);
    expect(one({ COOKIE_SECURE: "0" })).toMatch(/COOKIE_SECURE/);
    expect(one({ TRUST_PROXY: undefined })).toMatch(/TRUST_PROXY/);
    expect(one({ TRUST_PROXY: "cloudflare" })).toBe("");
    expect(one({ SITE_URL: "http://siracusa-sofia.com" })).toMatch(/https/);
    expect(one({ SITE_URL: "" })).toMatch(/SITE_URL is missing/);
    expect(one({ SITE_URL: "https://localhost" })).toMatch(/SITE_URL/);
    expect(one({ SMS_DEMO: "1" })).toMatch(/SMS_DEMO/);
    expect(one({ SC_PREVIEW_API: "1" })).toMatch(/test mode/);
    expect(one({ TRACK_KEY_REQUIRED: "0" })).toMatch(/TRACK_KEY_REQUIRED/);
    expect(one({ OWNER_PASSWORD: "" })).toMatch(/no password for: OWNER_PASSWORD/);
    expect(one({ DRIVER_PASSWORD: "short" })).toMatch(/shorter than 14.*DRIVER_PASSWORD/);
    expect(one({ WAITER_PASSWORD: pw(5) })).toMatch(/share one password/);
    expect(one({}, 0o644)).toMatch(/chmod 600/);
    expect(one({}, 0o640)).toMatch(/chmod 600/);
  });
  it("what works but must be looked at is a WARN", () => {
    const w = (patch: Record<string, string | undefined>) => warns(checkEnv({ ...GOOD, ...patch }, 0o600) as Line[]).join(" | ");
    expect(w({ VAPID_PRIVATE_KEY: undefined })).toMatch(/VAPID/);
    expect(w({ SECRET_KEY: undefined })).toMatch(/SECRET_KEY/);
    expect(w({ BACKUP_RSYNC: undefined, BACKUP_PASSFILE: undefined })).toMatch(/off the server/);
    expect(w({ BACKUP_RSYNC: undefined, BACKUP_RCLONE: "r:dir" })).toBe("");
    expect(w({ BACKUP_PASSFILE: undefined })).toMatch(/without encryption/);
  });
});

describe("preflight: the backups and the built site", () => {
  it("no backup, an old one, a fresh one", () => {
    const dir = path.join(tmp, "bk"), now = Date.UTC(2026, 10, 18, 9, 0);
    expect(checkBackups(dir, now)).toMatchObject({ level: "FAIL", text: expect.stringMatching(/no backup yet/) });
    fs.mkdirSync(path.join(dir, "db"), { recursive: true });
    fs.writeFileSync(path.join(dir, "db", "notes.txt"), "x");
    expect(checkBackups(dir, now).level).toBe("FAIL");
    fs.writeFileSync(path.join(dir, "db", stampName(new Date(now - 30 * 3600_000))), "x");
    expect(checkBackups(dir, now)).toMatchObject({ level: "FAIL", text: expect.stringMatching(/30 hours old/) });
    fs.writeFileSync(path.join(dir, "db", stampName(new Date(now - 8 * 3600_000)) + ".gpg"), "x");
    expect(checkBackups(dir, now)).toMatchObject({ level: "OK", text: expect.stringMatching(/8 h old \(2 kept\)/) });
  });
  it("the demo build must never be the live site", () => {
    const dist = path.join(tmp, "dist");
    expect(fails(checkDist(dist) as Line[]).join()).toMatch(/no built site/);
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><html lang="bg" data-demo><body></body></html>');
    fs.writeFileSync(path.join(dist, "robots.txt"), "User-agent: *\nDisallow: /\n");
    const demo = fails(checkDist(dist) as Line[]).join(" | ");
    expect(demo).toMatch(/DEMO build/);
    expect(demo).toMatch(/robots\.txt closes the whole site/);
    expect(demo).toMatch(/no redirects\.json/);
    fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><html lang="bg"><body></body></html>');
    fs.writeFileSync(path.join(dist, "robots.txt"), "User-agent: *\nDisallow: /admin/\nSitemap: https://siracusa-sofia.com/sitemap.xml\n");
    fs.writeFileSync(path.join(dist, "redirects.json"), "{}");
    fs.writeFileSync(path.join(dist, "sitemap.xml"), "<urlset/>");
    fs.writeFileSync(path.join(dist, "sw.js"), "");
    const l = checkDist(dist) as Line[];
    expect(fails(l)).toEqual([]);
    expect(warns(l)).toEqual([]);
  });
});
