import { test, expect } from "@playwright/test";
import { PV, codeOf, phone, staff, tableN, watch, guest, tokenOf } from "./masa-helpers.ts";
import { E } from "./own-server.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* QR маса, the live stream: the phone's token is never in the address of /api/stream (an address stays in the access log
   of a proxy). It travels in an httpOnly cookie of that table, sent only to the stream; the page cannot read it, and the
   live events still arrive. */
test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD || !E.WAITER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("the stream of a table: no token in the address, an httpOnly cookie for /api/stream only, the events arrive", async ({ page, browser, baseURL }) => {
  const errs = watch(page);
  const n = tableN(page, 6), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const streams: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/stream")) streams.push(r.url()); });
  const p2 = await phone(browser, page, baseURL!);
  try {
    await page.goto("/masa/" + t.code + "/menu/" + PV);
    await expect(page.locator('[data-row="pitsa-margarita"]')).toBeVisible();
    /* the page may open the public stream first; the one of the table follows as soon as the sitting is known */
    await expect.poll(() => streams.some((u) => u.includes("table=" + t.code))).toBe(true);
    const g = await tokenOf(page);
    expect(g).toMatch(/^[0-9a-f]{32}$/);
    for (const u of streams) {
      expect(u).not.toContain(g);
      expect(new URL(u).searchParams.has("g")).toBe(false);
    }
    /* the cookie: this table's, httpOnly, for the stream only; the page's scripts do not see it */
    const all = await page.context().cookies(baseURL + "/api/stream");
    const ck = all.find((c) => c.name === "sc_tg_" + t.code);
    expect(ck, "the stream cookie").toBeTruthy();
    expect(ck!.value).toBe(g);
    expect(ck!.httpOnly).toBe(true);
    expect(ck!.path).toBe("/api/stream");
    expect(ck!.sameSite).toBe("Lax");
    expect((await page.context().cookies(baseURL + "/masa/" + t.code + "/")).some((c) => c.name.startsWith("sc_tg_"))).toBe(false);
    expect(await page.evaluate(() => document.cookie)).not.toContain("sc_tg_");

    /* live: another phone adds a dish through the API, this page shows it without a reload */
    await p2.page.goto("/masa/" + t.code + "/" + PV);
    await guest(p2.ctx.request, t.code, await tokenOf(p2.page)).add("kebapcheta");
    await expect(page.locator('[data-row="kebapcheta"] .incart')).toBeVisible();
    expect(errs).toEqual([]);
  } finally {
    await W.clear(n);
    await p2.ctx.close();
    await W.ctx.close();
  }
});
