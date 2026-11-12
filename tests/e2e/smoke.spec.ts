import { test, expect } from "@playwright/test";

test("home opens without console errors; + adds to the cart; assistant loads lazily", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto("/");
  await expect(page).toHaveTitle(/Siracusa Bar & Grill/);
  await expect(page.locator("header.top")).toBeVisible();
  await expect(page.locator("[data-status]")).toContainText(/Отворено|Затворено|Доставката|Кухнята/);
  await page.click('[data-cookie="min"]');
  await page.locator("[data-add]").first().click();
  await expect(page.locator("[data-cnt]").first()).toHaveText("1");
  const line = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").lines[0]);
  expect(line.p).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.locator("[data-ai]").click();
  await expect(page.locator("[data-aimsgs]")).toBeVisible();
  await page.locator('[data-aiq="group"]').click();
  await expect(page.locator("[data-aiadd]")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});

test("the shared runtime is at most 30 000 B; robots.txt and sitemap.xml; noindex pages without canonical", async ({ page, request }) => {
  await page.goto("/");
  const src = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]")).map((s) => s.src).concat(
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]')).map((l) => l.href)));
  /* the runtime chunk is loaded by every page: find it among the loaded scripts */
  const urls = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /\/_astro\/sc\.[\w-]+\.js$/.test(n)));
  const all = Array.from(new Set([...src.filter((u) => /\/_astro\/sc\.[\w-]+\.js$/.test(u)), ...urls]));
  expect(all.length).toBeGreaterThan(0);
  for (const u of all) {
    const body = await (await request.get(u, { headers: { "accept-encoding": "identity" } })).body();
    expect(body.length, u).toBeLessThanOrEqual(30000);
  }
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain("Sitemap:");
  const sm = await (await request.get("/sitemap.xml")).text();
  expect(sm).toContain("/menu/pitsi/");
  for (const p of ["/kolichka/", "/porachka/", "/vhod/", "/profil/"]) {
    expect(sm).not.toContain(p);
    await page.goto(p);
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  }
});
