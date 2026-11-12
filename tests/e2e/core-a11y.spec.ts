import { test, expect, type Page } from "@playwright/test";

/* Shared runtime (src/client/sc.ts): the focus trap of the sheets, the focus after the cookie sheet, the assistant out of
   the Tab order while it is invisible, the floating bars named as regions. */
async function noCookie(page: Page) { await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } }); }
const inSheet = (page: Page) => page.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest(".sheetwrap.on .sheet") && !a.classList.contains("scrim"); });

test("sheets: Tab and Shift+Tab go round inside; a radio group as the last stop; skip link and page are inert", async ({ page }) => {
  await noCookie(page);
  await page.goto("/menu/pitsi/");
  await page.locator("[data-sort]").first().click();
  await expect(page.locator(".sheetwrap.on [data-close]")).toBeFocused();
  for (let i = 0; i < 9; i++) { await page.keyboard.press("Tab"); expect(await inSheet(page)).toBe(true); }
  for (let i = 0; i < 9; i++) { await page.keyboard.press("Shift+Tab"); expect(await inSheet(page)).toBe(true); }
  expect(await page.evaluate(() => (document.querySelector(".skip") as HTMLElement).closest("[inert]") !== null)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-sort]").first()).toBeFocused();
  expect(await page.evaluate(() => [".skip", ".device", ".ov .nav"].some((q) => !!document.querySelector(q)?.closest("[inert]")))).toBe(false);

  await page.goto("/");
  await page.locator("[data-more]").first().click();
  await expect(page.locator(".sheetwrap.on [data-close]")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(await inSheet(page)).toBe(true);
  await page.keyboard.press("Tab");
  await expect(page.locator(".sheetwrap.on [data-close]")).toBeFocused();
});

test("cookie sheet: after Escape or 'Запази избора' the focus is on a visible element, never on body", async ({ page }) => {
  await page.goto("/biskvitki/");
  await page.locator('.cookie [data-cookie="set"]').click();
  await expect(page.locator(".sheetwrap.on [data-close]")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && (document.activeElement as HTMLElement).getClientRects().length > 0)).toBe(true);
  await page.locator("[data-cookie-settings]").first().click();
  await page.locator('.cookie [data-cookie="set"]').click();
  await page.locator(".sheetwrap.on [type=submit]").click();
  await expect.poll(() => page.evaluate(() => document.activeElement !== document.body && (document.activeElement as HTMLElement).getClientRects().length > 0)).toBe(true);
});

test("assistant: not a Tab stop while invisible on the phone; floating bars are named regions", async ({ page }) => {
  await noCookie(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".aifab")).toHaveAttribute("tabindex", "-1");
  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect(page.locator(".aifab")).not.toHaveAttribute("tabindex", "-1");
  await page.goto("/menu/pitsi/pitsa-margarita/");
  const bars = page.locator(".ov .abar");
  const n = await bars.count();
  for (let i = 0; i < n; i++) await expect(bars.nth(i)).toHaveAttribute("role", "region");
});

/* closing a sheet never jumps: the view stays (±100 px) and the focus is on the screen (round 7, urgent) */
async function stays(page: Page, act: () => Promise<void>) {
  const y0 = await page.evaluate(() => window.scrollY);
  await act();
  await page.waitForTimeout(500);
  const y1 = await page.evaluate(() => window.scrollY);
  expect(Math.abs(y1 - y0)).toBeLessThanOrEqual(100);
  const inView = await page.evaluate(() => { const a = document.activeElement as HTMLElement; if (!a || a === document.body) return false; if (a.tagName === "MAIN") return true; const r = a.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; });
  expect(inView).toBe(true);
  expect(await page.evaluate(() => !!document.activeElement?.closest("footer"))).toBe(false);
}

test("no jump: category 'Подреждане' -> a choice", async ({ page }) => {
  await noCookie(page);
  await page.goto("/menu/pitsi/");
  await page.locator("[data-sort]").first().scrollIntoViewIfNeeded();
  await page.locator("[data-sort]").first().click();
  await expect(page.locator(".sheetwrap.on input[name=sort]").first()).toBeVisible();
  await stays(page, async () => { await page.locator(".sheetwrap.on input[name=sort]:not(:checked)").first().check(); await page.waitForTimeout(300); if (await page.locator(".sheetwrap.on").count()) await page.keyboard.press("Escape"); });
});

test("no jump: menu 'Алергени' -> a box -> Escape", async ({ page }) => {
  await noCookie(page);
  await page.goto("/menu/");
  await page.locator('[data-sheet="al"]').first().scrollIntoViewIfNeeded();
  await page.locator('[data-sheet="al"]').first().click();
  await expect(page.locator(".sheetwrap.on input[data-al]").first()).toBeVisible();
  await stays(page, async () => { await page.locator(".sheetwrap.on input[data-al]").first().check(); await page.keyboard.press("Escape"); });
});

test("no jump: home cookie 'Настройки' -> Escape, and 'Запази избора'", async ({ page }) => {
  await page.goto("/");
  await page.locator('.cookie [data-cookie="set"]').click();
  await expect(page.locator(".sheetwrap.on [data-close]")).toBeFocused();
  await stays(page, async () => { await page.keyboard.press("Escape"); });
  await expect(page.locator(".cookie")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sc-cookie"))).toBeNull();
  await page.locator('.cookie [data-cookie="set"]').click();
  await stays(page, async () => { await page.locator(".sheetwrap.on [type=submit]").click(); });
  expect(await page.evaluate(() => localStorage.getItem("sc-cookie"))).toBe('"set"');
});

test("keyboard: a focused chip in a horizontal row comes fully into the row (phone)", async ({ page }) => {
  await noCookie(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/menu/");
  const rowOf = (sel: string) => page.locator(sel).first();
  for (const row of [".chips.fchips", ".catscroll"]) {
    /* the chip cut by the right edge (Chrome does not scroll a part-visible element on focus) */
    const k = await rowOf(row).evaluate((r) => {
      const a = r.getBoundingClientRect();
      return Array.from(r.querySelectorAll("button, a")).findIndex((x) => { const b = x.getBoundingClientRect(); return b.left < a.right - 8 && b.right > a.right + 8; });
    });
    expect(k, row).toBeGreaterThan(-1);
    const last = rowOf(row).locator("button, a").nth(k);
    await last.focus();
    await expect.poll(async () => {
      const [a, b] = await Promise.all([rowOf(row).boundingBox(), last.boundingBox()]);
      return !!a && !!b && b.x >= a.x - 1 && b.x + b.width <= a.x + a.width + 1;
    }, { message: row }).toBe(true);
  }
});
