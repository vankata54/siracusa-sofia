/* The build of a deploy (deploy/deploy.sh): the site with the LIVE menu and site data of the database, not the built-in
   ones from git, so the new release never shows old prices while the server rebuilds after its start.
     node --experimental-strip-types --no-warnings server/build-live.ts [--db <file>] [--dist <folder>]
   --db: the database to read (default DB_FILE from .env, then data/siracusa.db). The deploy passes the copy it has just
         backed up: the migrations of the new code run on the copy, the live database is not touched while the old
         server still works. No database yet (the first deploy): the built-in menu.
   --dist: where the site goes (default DIST_DIR, then dist).
   It uses the server's own queue (server/publish.ts), so the folder gets the same marks (.menu-hash, redirects.json) and
   the server sees at its start that the site already has the pages of the live menu: no second build.
   Exit code 0 = the site is built; 1 = the build failed (the folder is left as it was). */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app.ts";
import { createPublisher, astroBuild, buildHash } from "./publish.ts";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const arg = (name: string): string | undefined => { const i = process.argv.indexOf("--" + name); return i > -1 ? process.argv[i + 1] : undefined; };
const dbFile = arg("db") || process.env.DB_FILE || "data/siracusa.db";
const distDir = arg("dist") || process.env.DIST_DIR || "dist";

const hasDb = fs.existsSync(dbFile);
/* the menu and the site data are only read: timers off, no rebuild queue inside the app, uploads never touched */
const { core, sqlite } = createApp({ dbFile: hasDb ? dbFile : ":memory:", distDir, timers: false, build: null });
let code = 1;
/* the build's own data files (the menu as JSON) never go next to the database */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "siracusa-build-"));
try {
  await core.menuEdit.boot();
  await core.site.boot();
  const menu = await core.menuEdit.effective(), site = (await core.site.version()) > 0 ? await core.site.build() : null;
  const live = await core.menuEdit.live();
  console.log("build-live: " + (hasDb ? "database " + dbFile : "no database yet, the built-in menu") + "; menu version " + live.version + ", " + menu.items.length + " dishes, lunch " + menu.lunch.date + "; site data " + (site ? "from the admin" : "built-in"));
  const prev = path.resolve(distDir) + "-prev", hadSite = fs.existsSync(path.resolve(distDir, "index.html"));
  const publisher = createPublisher({ distDir, dataDir, build: astroBuild(process.cwd()), onSwap: () => {}, log: (m) => console.error(m) });
  /* force: always a real build (a new release has new code even when the menu is the same) */
  publisher.enqueue(menu, site, true);
  await publisher.idle();
  const st = publisher.state();
  if (st.state === "done" && publisher.builtHash() === buildHash(menu, site)) {
    /* the queue keeps a previous folder for "Върни"; a new release (no site before this build) has none of its own */
    if (!hadSite) fs.rmSync(prev, { recursive: true, force: true });
    console.log("build-live: done in " + Math.round((st.ms || 0) / 1000) + " s -> " + path.resolve(distDir));
    code = 0;
  } else console.error("build-live: FAILED. " + (st.error || "state " + st.state));
} catch (e) {
  console.error("build-live: FAILED.", e);
} finally {
  sqlite.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
process.exit(code);
