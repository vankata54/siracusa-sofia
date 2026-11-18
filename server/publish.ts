/* Rebuilding the site after "Публикувай" / "Върни" of the menu (decision 15.11.2026) and after a change of the site data
   (zones, hall, events, offers: src/core/site-data.ts, decision 16.11.2026): ONE queue, one build at a time; each build
   has the newest menu AND the newest site data (SITE_FILE next to MENU_FILE, scripts/site-file.mjs; none = the built-in).
   1. the menu goes into a temporary JSON file (data/menu-build-<n>.json next to the database);
   2. `astro build` runs into a NEW folder (<dist>-next) with that menu (MENU_FILE: astro.config.mjs puts it in place of
      src/data/menu.json and src/lib/lunch-date.ts; scripts/build-checks.mjs reads the same file);
   3. the folders change places: <dist> -> <dist>-prev (kept for "Върни"), <dist>-next -> <dist>; redirects.json is
      written from the menu (the same function as the build) and the server reloads it (onSwap);
   4. on an error the old site stays and the state says what went wrong.
   A menu that was already built (the previous folder, by its content hash in <folder>/.menu-hash) is not built again:
   the folders only change places ("Върни" is instant: the comparison ignores the date and the removed list, which every
   commit changes, pagesHash). Several publishes while a build runs: only the newest is built.
   The weekly rebuild (weeklyDue below, the timer in server/app.ts): the dates of the events in the HTML and JSON-LD come
   from the day of the build, so a site that nobody published for a week is built again at night with the same menu
   (enqueue(..., force): always a real build, never a swap).
   In the tests the build is replaced (opts.build), no real astro run. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { Menu } from "../src/data/menu.ts";
import type { SiteBuild } from "../src/core/site-data.ts";
/* the same 301 table as the build (scripts/build-checks.mjs) */
import { redirectMap } from "../scripts/build-checks.mjs";

/** siteFile: the site data from the admin (SITE_FILE), or undefined for the built-in data */
export type BuildFn = (menuFile: string, outDir: string, siteFile?: string) => Promise<void>;
export interface BuildState {
  state: "idle" | "queued" | "building" | "done" | "error";
  /** when the state was reached (ISO) */
  at: string | null;
  /** the error for people (the old site stays) */
  error?: string;
  /** "swap": the previous folder was used, no build */
  how?: "build" | "swap";
  /** milliseconds of the last build */
  ms?: number;
}

const HASH_FILE = ".menu-hash", PAGES_FILE = ".pages-hash";
const stable = (v: unknown): string => (Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : v && typeof v === "object"
  ? "{" + Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(v));
/** what the pages depend on (not the redirects: they are written from the menu at every swap) */
export function menuHash(m: Menu): string {
  const { redirects: _r, ...rest } = m;
  return crypto.createHash("sha256").update(stable(rest)).digest("hex");
}

/** the content hash of a build: the menu, and the site data when it is not the built-in one (the redirects are not part of
    it: they are written at every swap) */
export function buildHash(m: Menu, site?: SiteBuild | null): string {
  if (!site) return menuHash(m);
  const { redirects: _r, ...rest } = site;
  return crypto.createHash("sha256").update(menuHash(m) + ":" + stable(rest)).digest("hex");
}

/** The hash for "the same pages": like buildHash, but without what "Публикувай" / "Върни" (core/menu-edit.ts finalize)
    change on every commit without a visible change of the dishes: the date `updated` (only the allergens page shows it)
    and `removed` (dishes taken off the menu, kept for the cart's note; the core refuses them anyway with "removed").
    "Върни" to the menu of the previous folder then only swaps the folders (no build); the swapped site keeps the date and
    the removed list of its own build (a dish that lived only between the publish and "Върни" is refused by the core). */
export function pagesHash(m: Menu, site?: SiteBuild | null): string {
  const { updated: _u, removed: _rm, ...rest } = m;
  return buildHash({ ...rest, updated: "", removed: [] } as Menu, site);
}

/** The weekly rebuild: is it due now? The site is older than 7 days (less 2 hours, so the night of the same weekday
    counts) and it is between 04:00 and 05:00 in Sofia (the restaurant is closed, no orders; a failed build is tried again
    at the next check inside the hour, then the next night). builtAt: the time of dist/index.html (0 = no build). */
export const WEEKLY_MS = 7 * 24 * 3600_000 - 2 * 3600_000;
export function weeklyDue(now: Date, builtAt: number): boolean {
  if (!builtAt || now.getTime() - builtAt < WEEKLY_MS) return false;
  return +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hourCycle: "h23" }).format(now) === 4;
}

/** the real build: `astro build --outDir <out>` with MENU_FILE and SITE_FILE (the server build, never the demo) */
export function astroBuild(root: string): BuildFn {
  return (menuFile, outDir, siteFile) => new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env, MENU_FILE: menuFile };
    if (siteFile) env.SITE_FILE = siteFile; else delete env.SITE_FILE;
    delete env.DEMO;
    const p = spawn(process.execPath, [path.join(root, "node_modules/astro/bin/astro.mjs"), "build", "--outDir", outDir], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const keep = (b: Buffer) => { log = (log + b.toString()).slice(-4000); };
    p.stdout.on("data", keep); p.stderr.on("data", keep);
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(log.split("\n").filter((l) => /error|Error|build-checks/.test(l)).slice(-3).join(" ").slice(0, 400) || "astro build exited with " + code))));
  });
}

export function createPublisher(o: { distDir: string; dataDir: string; build: BuildFn; onSwap: () => void; log?: (m: string) => void }) {
  const dist = path.resolve(o.distDir), next = dist + "-next", prev = dist + "-prev";
  let st: BuildState = { state: "idle", at: null };
  let pending: { m: Menu; site: SiteBuild | null; force: boolean } | null = null, running: Promise<void> | null = null, n = 0;
  const now = () => new Date().toISOString();
  const hashOf = (dir: string) => { try { return fs.readFileSync(path.join(dir, HASH_FILE), "utf8").trim(); } catch { return ""; } };
  const pagesOf = (dir: string) => { try { return fs.readFileSync(path.join(dir, PAGES_FILE), "utf8").trim(); } catch { return ""; } };
  /* a crash during a build leaves its data files (the whole menu): cleaned at start. The folder can be shared by other
     servers (the e2e servers of other agents): only the files of a process that is not running any more */
  const alive = (pid: number) => { if (pid === process.pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as { code?: string }).code === "EPERM"; } };
  try {
    for (const f of fs.readdirSync(o.dataDir)) {
      const m = /^(?:menu|site)-build-(\d+)-\d+\.json$/.exec(f);
      if (m && !alive(+m[1])) fs.rmSync(path.join(o.dataDir, f), { force: true });
    }
  } catch { /* no data folder yet */ }
  /* the menu's 301 table + the site data's (a gone event -> /sabitia/) */
  const writeRedirects = (dir: string, m: Menu, site: SiteBuild | null) => fs.writeFileSync(path.join(dir, "redirects.json"), JSON.stringify({ ...(site ? site.redirects : {}), ...redirectMap(m) }, null, 1) + "\n");
  const rm = (dir: string) => fs.rmSync(dir, { recursive: true, force: true });

  /* the folder now has the pages of this menu: its hashes say so (the boot check compares the full hash) */
  const mark = (dir: string, h: string, ph: string) => { fs.writeFileSync(path.join(dir, HASH_FILE), h + "\n"); fs.writeFileSync(path.join(dir, PAGES_FILE), ph + "\n"); };
  const same = (dir: string, h: string, ph: string) => fs.existsSync(path.join(dir, "index.html")) && (hashOf(dir) === h || pagesOf(dir) === ph);

  async function one(m: Menu, site: SiteBuild | null, force = false) {
    const h = buildHash(m, site), ph = pagesHash(m, site), t0 = Date.now();
    st = { state: "building", at: now() };
    try {
      /* force (the weekly rebuild, a deploy): the same menu is built again, the folders are never just swapped */
      if (force) { /* fall through to the build */ }
      else if (same(dist, h, ph)) { writeRedirects(dist, m, site); mark(dist, h, ph); o.onSwap(); st = { state: "done", at: now(), how: "swap", ms: 0 }; return; }
      if (!force && same(prev, h, ph)) {
        /* the previous site has the pages of this menu ("Върни"): the folders change places, no build. Between the renames
           the server serves the folder that is there (server/app.ts: <dist>, else <dist>-prev), never a 404 */
        writeRedirects(prev, m, site);
        mark(prev, h, ph);
        fs.renameSync(dist, next);
        fs.renameSync(prev, dist);
        fs.renameSync(next, prev);
        o.onSwap();
        st = { state: "done", at: now(), how: "swap", ms: Date.now() - t0 };
        return;
      }
      fs.mkdirSync(o.dataDir, { recursive: true });
      const file = path.join(o.dataDir, "menu-build-" + process.pid + "-" + ++n + ".json");
      const sfile = site ? path.join(o.dataDir, "site-build-" + process.pid + "-" + n + ".json") : undefined;
      fs.writeFileSync(file, JSON.stringify(m));
      if (sfile) fs.writeFileSync(sfile, JSON.stringify(site));
      rm(next);
      try { await o.build(file, next, sfile); } finally { fs.rmSync(file, { force: true }); if (sfile) fs.rmSync(sfile, { force: true }); }
      if (!fs.existsSync(path.join(next, "index.html"))) throw new Error("the build made no index.html");
      writeRedirects(next, m, site);
      mark(next, h, ph);
      rm(prev);
      if (fs.existsSync(dist)) fs.renameSync(dist, prev);
      fs.renameSync(next, dist);
      o.onSwap();
      st = { state: "done", at: now(), how: "build", ms: Date.now() - t0 };
    } catch (e) {
      rm(next);
      const msg = e instanceof Error ? e.message : String(e);
      (o.log || console.error)("site rebuild failed: " + msg);
      st = { state: "error", at: now(), error: "Сайтът не се пресглоби, остава предишният. " + msg.slice(0, 300) };
    }
  }
  async function loop() {
    while (pending) { const p = pending; pending = null; await one(p.m, p.site, p.force); }
    running = null;
  }
  return {
    /** queue the menu and the site data (null = the built-in data); only the newest waiting pair is built.
        force: build even when the folder already has the pages of this menu (a waiting forced build stays forced) */
    enqueue(m: Menu, site: SiteBuild | null = null, force = false): void {
      pending = { m: JSON.parse(JSON.stringify(m)), site: site ? JSON.parse(JSON.stringify(site)) : null, force: force || (!!pending && pending.force) };
      if (running) { if (st.state !== "building") st = { state: "queued", at: now() }; return; }
      st = { state: "queued", at: now() };
      running = Promise.resolve().then(loop);
    },
    state(): BuildState & { waiting: boolean } { return { ...st, waiting: !!pending }; },
    /** the content hash of the menu the live site was built with ("" for a build without one, e.g. `npm run build`) */
    builtHash(): string { return hashOf(dist); },
    /** when the live site was built (the time of its index.html; a swap of the folders keeps it): 0 = no build */
    builtAt(): number { try { return fs.statSync(path.join(dist, "index.html")).mtimeMs; } catch { return 0; } },
    /** tests: wait until the queue is empty */
    async idle(): Promise<void> { while (running) await running; },
  };
}
export type Publisher = ReturnType<typeof createPublisher>;
