/* The tests of the hall (QR table, waiter, the kitchen's and the driver's flows) share one live hall: 20 tables, one
   kitchen queue, the ready deliveries. Two of them running at the same time in different workers close each other's
   tables or take each other's deliveries. This lock lets only one of them run at a time; every other test of the suite
   still runs in parallel. The lock is a folder (mkdir is atomic), per server port; a lock older than 3 minutes is stale
   (a killed worker). The time spent waiting is added to the test's timeout. */
import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const port = process.env.E2E_PORT || "8788";
const DIR = path.resolve("test-results", ".floor-lock-" + port);
const STALE_MS = 180_000;

async function take(): Promise<number> {
  const t0 = Date.now();
  fs.mkdirSync(path.dirname(DIR), { recursive: true });
  for (;;) {
    try { fs.mkdirSync(DIR); fs.writeFileSync(path.join(DIR, "pid"), String(process.pid)); return Date.now() - t0; }
    catch {
      try { if (Date.now() - fs.statSync(DIR).mtimeMs > STALE_MS) fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* gone meanwhile */ }
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}
function drop() { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* already gone */ } }

/** call once at the top of a spec file that works with the live hall */
export function floorLock(): void {
  test.beforeEach(async ({}, info) => {
    /* the wait itself must not run into the test's timeout: no limit while waiting, then the usual one + the wait */
    const limit = info.timeout;
    info.setTimeout(0);
    const waited = await take();
    info.setTimeout(limit ? limit + waited : 0);
  });
  test.afterEach(() => { drop(); });
}
