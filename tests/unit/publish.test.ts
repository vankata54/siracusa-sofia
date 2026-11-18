/* The rebuild queue (server/publish.ts) and the static files during a swap (review admin-menu flows, minors 1-4):
   the data files of a crashed build are cleaned at start (only of processes that are gone), "Върни" swaps the folders
   without a build when only the date and the removed list differ, no 404 between the renames, 60 photos an hour. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPublisher, buildHash, pagesHash, weeklyDue } from "../../server/publish.ts";
import { createApp } from "../../server/app.ts";
import { builtinMenu } from "../../src/core/menu-edit.ts";
import type { Menu } from "../../src/data/menu.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-pub-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const site = (dir: string, text: string) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "index.html"), text); };

describe("the weekly rebuild", () => {
  const DAY = 24 * 3600_000;
  /* 04:30 in Sofia: 02:30 UTC in winter (UTC+2), 01:30 UTC in summer (UTC+3) */
  const winter = new Date("2026-11-23T02:30:00Z"), summer = new Date("2026-07-06T01:30:00Z");
  it("due only for a site older than a week, between 04:00 and 05:00 in Sofia (winter and summer time)", () => {
    expect(weeklyDue(winter, winter.getTime() - 7 * DAY)).toBe(true);
    expect(weeklyDue(summer, summer.getTime() - 8 * DAY)).toBe(true);
    /* built the same night a week ago, a little later than now: still due (the 2 hours of slack) */
    expect(weeklyDue(winter, winter.getTime() - 7 * DAY + 40 * 60_000)).toBe(true);
    expect(weeklyDue(winter, winter.getTime() - 6 * DAY)).toBe(false);
    expect(weeklyDue(winter, 0)).toBe(false); /* no build at all: nothing to refresh */
    expect(weeklyDue(new Date("2026-11-23T03:00:00Z"), 1)).toBe(false); /* 05:00 in Sofia */
    expect(weeklyDue(new Date("2026-11-23T01:59:00Z"), 1)).toBe(false); /* 03:59 */
    expect(weeklyDue(new Date("2026-11-23T17:30:00Z"), 1)).toBe(false); /* 19:30: never while the restaurant works */
    expect(weeklyDue(new Date("2026-07-06T02:30:00Z"), 1)).toBe(false); /* 05:30 in summer */
  });
  it("a forced build builds the same menu again (no swap), a plain one does not; the previous folder is kept", async () => {
    const dist = path.join(tmp, "dw"), data = path.join(tmp, "dataw");
    let builds = 0;
    const p = createPublisher({ distDir: dist, dataDir: data, onSwap: () => {}, build: async (_m, out) => { builds++; site(out, "build " + builds); } });
    expect(p.builtAt()).toBe(0);
    const a = builtinMenu();
    p.enqueue(a); await p.idle();
    expect(builds).toBe(1);
    expect(p.builtAt()).toBeGreaterThan(0);
    p.enqueue(a); await p.idle();
    expect(builds).toBe(1); /* the same pages: nothing to build */
    p.enqueue(a, null, true); await p.idle();
    expect(builds).toBe(2);
    expect(p.state()).toMatchObject({ state: "done", how: "build" });
    expect(fs.readFileSync(path.join(dist, "index.html"), "utf8")).toBe("build 2");
    expect(fs.readFileSync(path.join(dist + "-prev", "index.html"), "utf8")).toBe("build 1");
    expect(p.builtHash()).toBe(buildHash(a));
    /* a forced build that waits stays forced when a plain one is queued behind it */
    let free = () => {};
    const slow = createPublisher({ distDir: path.join(tmp, "dw2"), dataDir: data, onSwap: () => {}, build: async (_m, out) => { builds++; await new Promise<void>((r) => { free = r; }); site(out, "b" + builds); } });
    slow.enqueue(a); await new Promise((r) => setTimeout(r, 20));
    slow.enqueue(a, null, true); slow.enqueue(a);
    free(); await new Promise((r) => setTimeout(r, 20)); free();
    await slow.idle();
    expect(builds).toBe(4);
  });
  it("the server: weekly() queues a forced build only when due, writes the log, and never on top of a running build", async () => {
    const dist = path.join(tmp, "dws");
    site(dist, "old");
    let builds = 0;
    const x = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build: async (_m, out) => { builds++; site(out, "weekly " + builds); } });
    await x.publisher()!.idle();
    const start = builds, old = Date.now() - 8 * DAY;
    fs.utimesSync(path.join(dist, "index.html"), old / 1000, old / 1000);
    expect(await x.weekly(new Date("2026-11-23T17:30:00Z"))).toBe(false); /* not at night */
    expect(await x.weekly(winter)).toBe(true);
    await x.publisher()!.idle();
    expect(builds).toBe(start + 1);
    expect((await x.core.audit.list({ action: "site.weekly" })).length).toBe(1);
    expect(await x.weekly(winter)).toBe(false); /* the new build is fresh */
    x.sqlite.close();
  });
});

describe("publisher", () => {
  it("pagesHash ignores the date and the removed list, buildHash does not", () => {
    const m = builtinMenu(), m2: Menu = { ...m, updated: "2030-01-01", removed: [{ ...m.items[0], removed: true }] };
    expect(pagesHash(m2)).toBe(pagesHash(m));
    expect(buildHash(m2)).not.toBe(buildHash(m));
    expect(pagesHash({ ...m, items: m.items.slice(1) })).not.toBe(pagesHash(m));
  });
  it("at start: the data files of a gone process are removed, a running one's stay", () => {
    const data = path.join(tmp, "data1"); fs.mkdirSync(data);
    const dead = path.join(data, "menu-build-999999-1.json"), deadSite = path.join(data, "site-build-999999-1.json");
    const live = path.join(data, "menu-build-" + process.ppid + "-1.json"), other = path.join(data, "notes.json");
    for (const f of [dead, deadSite, live, other]) fs.writeFileSync(f, "{}");
    createPublisher({ distDir: path.join(tmp, "d1"), dataDir: data, build: async () => {}, onSwap: () => {} });
    expect([fs.existsSync(dead), fs.existsSync(deadSite), fs.existsSync(live), fs.existsSync(other)]).toEqual([false, false, true, true]);
  });
  it("'Върни' to the previous menu: the folders swap without a build, also when finalize changed the date and removed", async () => {
    const dist = path.join(tmp, "d2"), data = path.join(tmp, "data2");
    site(dist, "start");
    let builds = 0;
    const p = createPublisher({ distDir: dist, dataDir: data, onSwap: () => {}, build: async (_m, out) => { builds++; site(out, "build " + builds); } });
    const a = builtinMenu(), b: Menu = { ...a, items: a.items.slice(1), updated: "2026-11-16" };
    p.enqueue(a); await p.idle();
    p.enqueue(b); await p.idle();
    expect(builds).toBe(2);
    /* "Върни": the same dishes as a, but another date and a removed dish (what finalize does) */
    p.enqueue({ ...a, updated: "2026-11-17", removed: [{ ...a.items[5], removed: true }] }); await p.idle();
    expect(builds).toBe(2);
    expect(p.state()).toMatchObject({ state: "done", how: "swap" });
    expect(fs.readFileSync(path.join(dist, "index.html"), "utf8")).toBe("build 1");
    /* the boot check then sees the full hash of what is live: no rebuild at the next start */
    expect(p.builtHash()).toBe(buildHash({ ...a, updated: "2026-11-17", removed: [{ ...a.items[5], removed: true }] }));
  });
});

describe("the server between the renames and the photos", async () => {
  const dist = path.join(tmp, "d3");
  site(dist, "<p>new</p>"); site(dist + "-prev", "<p>old</p>");
  fs.mkdirSync(path.join(dist + "-prev", "menu"), { recursive: true }); fs.writeFileSync(path.join(dist + "-prev", "menu", "index.html"), "<p>old menu</p>");
  const { app, core } = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build: null, mediaDir: path.join(tmp, "media") });
  await core.staff.upsert({ username: "admin", name: "А", role: "admin", password: "test-password-123" });
  const cookie = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "admin", password: "test-password-123" }) })).headers.get("set-cookie")!.split(";")[0];

  it("no 404 while <dist> is missing: the pages come from <dist>-prev; never a path outside it", async () => {
    expect(await (await app.request("/")).text()).toBe("<p>new</p>");
    fs.renameSync(dist, dist + "-gone");
    expect(await (await app.request("/")).text()).toBe("<p>old</p>");
    expect((await app.request("/menu/")).status).toBe(200);
    expect((await app.request("/../d3-gone/index.html")).status).toBe(404);
    fs.renameSync(dist + "-gone", dist);
    expect(await (await app.request("/")).text()).toBe("<p>new</p>");
  });
  it("photos: 60 an hour per person, then 429 with retryIn", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    const up = () => app.request("/api/admin/media", { method: "POST", headers: { "content-type": "image/png", cookie }, body: png as unknown as BodyInit });
    for (let i = 0; i < 60; i++) expect((await up()).status).toBe(201);
    const r = await up();
    expect(r.status).toBe(429);
    expect(await r.json()).toMatchObject({ error: "throttled", retryIn: expect.any(Number) });
  });
});
