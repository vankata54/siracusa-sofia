/* Rebuilding the site after "Публикувай" / "Върни" of the menu (decision 15.11.2026): a queue, one build at a time.
   1. the menu goes into a temporary JSON file (data/menu-build-<n>.json next to the database);
   2. `astro build` runs into a NEW folder (<dist>-next) with that menu (MENU_FILE: astro.config.mjs puts it in place of
      src/data/menu.json and src/lib/lunch-date.ts; scripts/build-checks.mjs reads the same file);
   3. the folders change places: <dist> -> <dist>-prev (kept for "Върни"), <dist>-next -> <dist>; redirects.json is
      written from the menu (the same function as the build) and the server reloads it (onSwap);
   4. on an error the old site stays and the state says what went wrong.
   A menu that was already built (the previous folder, by its content hash in <folder>/.menu-hash) is not built again:
   the folders only change places ("Върни" is instant). Several publishes while a build runs: only the newest is built.
   In the tests the build is replaced (opts.build), no real astro run. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import type { Menu } from "../src/data/menu.ts";
/* the same 301 table as the build (scripts/build-checks.mjs) */
import { redirectMap } from "../scripts/build-checks.mjs";

export type BuildFn = (menuFile: string, outDir: string) => Promise<void>;
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

const HASH_FILE = ".menu-hash";
const stable = (v: unknown): string => (Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : v && typeof v === "object"
  ? "{" + Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => JSON.stringify(k) + ":" + stable((v as Record<string, unknown>)[k])).join(",") + "}" : JSON.stringify(v));
/** what the pages depend on (not the redirects: they are written from the menu at every swap) */
export function menuHash(m: Menu): string {
  const { redirects: _r, ...rest } = m;
  return crypto.createHash("sha256").update(stable(rest)).digest("hex");
}

/** the real build: `astro build --outDir <out>` with MENU_FILE (the server build, never the demo) */
export function astroBuild(root: string): BuildFn {
  return (menuFile, outDir) => new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env, MENU_FILE: menuFile };
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
  let pending: Menu | null = null, running: Promise<void> | null = null, n = 0;
  const now = () => new Date().toISOString();
  const hashOf = (dir: string) => { try { return fs.readFileSync(path.join(dir, HASH_FILE), "utf8").trim(); } catch { return ""; } };
  const writeRedirects = (dir: string, m: Menu) => fs.writeFileSync(path.join(dir, "redirects.json"), JSON.stringify(redirectMap(m), null, 1) + "\n");
  const rm = (dir: string) => fs.rmSync(dir, { recursive: true, force: true });

  async function one(m: Menu) {
    const h = menuHash(m), t0 = Date.now();
    st = { state: "building", at: now() };
    try {
      if (hashOf(dist) === h) { writeRedirects(dist, m); o.onSwap(); st = { state: "done", at: now(), how: "swap", ms: 0 }; return; }
      if (hashOf(prev) === h && fs.existsSync(path.join(prev, "index.html"))) {
        /* the previous site has exactly this menu ("Върни"): the folders change places, no build */
        writeRedirects(prev, m);
        fs.renameSync(dist, next);
        fs.renameSync(prev, dist);
        fs.renameSync(next, prev);
        o.onSwap();
        st = { state: "done", at: now(), how: "swap", ms: Date.now() - t0 };
        return;
      }
      fs.mkdirSync(o.dataDir, { recursive: true });
      const file = path.join(o.dataDir, "menu-build-" + process.pid + "-" + ++n + ".json");
      fs.writeFileSync(file, JSON.stringify(m));
      rm(next);
      try { await o.build(file, next); } finally { fs.rmSync(file, { force: true }); }
      if (!fs.existsSync(path.join(next, "index.html"))) throw new Error("the build made no index.html");
      writeRedirects(next, m);
      fs.writeFileSync(path.join(next, HASH_FILE), h + "\n");
      rm(prev);
      if (fs.existsSync(dist)) fs.renameSync(dist, prev);
      fs.renameSync(next, dist);
      o.onSwap();
      st = { state: "done", at: now(), how: "build", ms: Date.now() - t0 };
    } catch (e) {
      rm(next);
      const msg = e instanceof Error ? e.message : String(e);
      (o.log || console.error)("menu rebuild failed: " + msg);
      st = { state: "error", at: now(), error: "Сайтът не се пресглоби, остава предишният. " + msg.slice(0, 300) };
    }
  }
  async function loop() {
    while (pending) { const m = pending; pending = null; await one(m); }
    running = null;
  }
  return {
    /** queue the menu; only the newest waiting one is built */
    enqueue(m: Menu): void {
      pending = JSON.parse(JSON.stringify(m));
      if (running) { if (st.state !== "building") st = { state: "queued", at: now() }; return; }
      st = { state: "queued", at: now() };
      running = Promise.resolve().then(loop);
    },
    state(): BuildState & { waiting: boolean } { return { ...st, waiting: !!pending }; },
    /** the content hash of the menu the live site was built with ("" for a build without one, e.g. `npm run build`) */
    builtHash(): string { return hashOf(dist); },
    /** tests: wait until the queue is empty */
    async idle(): Promise<void> { while (running) await running; },
  };
}
export type Publisher = ReturnType<typeof createPublisher>;
