import { test, expect, type Page } from "@playwright/test";

/* Legal pages: /poveritelnost/, /biskvitki/, /obshti-uslovia/. Simple text templates: one h1, BreadcrumbList,
   [ЛИПСВА: текст от юрист] slots (.missing), facts from RESTAURANT; footer links; "Промени избора" reopens the banner. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
const PAGES: [string, string][] = [["/poveritelnost/", "Поверителност"], ["/biskvitki/", "Бисквитки"], ["/obshti-uslovia/", "Общи условия"]];

for (const [path, name] of PAGES) {
  test("legal " + path + ": SEO, breadcrumb, [ЛИПСВА], facts", async ({ request }) => {
    const r = await request.get(path);
    expect(r.status()).toBe(200);
    const html = await r.text();
    expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
    expect(html).toContain(">" + name + "</h1>");
    expect(html).toMatch(new RegExp('<link rel="canonical" href="[^"]*' + path + '">'));
    expect(html).not.toMatch(/[—–]/);
    expect(html).toContain('<span class="missing">[ЛИПСВА: текст от юрист');
    expect(html).toContain("menu@siracusa-sofia.com");
    const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
    const bc = ld.find((x) => x["@type"] === "BreadcrumbList");
    expect(bc.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", name]);
    expect(bc.itemListElement[1].item).toMatch(new RegExp(path + "$"));
  });
}

test("legal: footer leads to the three pages, TOC anchors work, no console errors", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/obshti-uslovia/");
  const foot = page.locator("footer.foot");
  await expect(foot.getByRole("link", { name: "Общи условия" })).toHaveAttribute("href", "/obshti-uslovia/");
  await expect(foot.getByRole("link", { name: "Поверителност" })).toHaveAttribute("href", "/poveritelnost/");
  await expect(foot.getByRole("link", { name: "Бисквитки" })).toHaveAttribute("href", "/biskvitki/");
  await page.locator(".lg-toc a").nth(3).click();
  await expect(page).toHaveURL(/#chasove$/);
  await expect(page.locator("#chasove")).toContainText("Доставка до 21:00");
  await foot.getByRole("link", { name: "Поверителност" }).click();
  await expect(page).toHaveURL(/\/poveritelnost\/$/);
  await expect(page.locator("#marketing")).toContainText("винаги неотметната");
  expect(errors).toEqual([]);
});

test("cookies: 'Промени избора' reopens the banner and the new choice is shown", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => { try { if (!sessionStorage.getItem("x")) { localStorage.setItem("sc-cookie", '"min"'); sessionStorage.setItem("x", "1"); } } catch { /* ignore */ } });
  await page.goto("/biskvitki/");
  const banner = page.locator(".cookie");
  await expect(banner).toBeHidden();
  await expect(page.locator("[data-ck-now]")).toContainText("само необходимите");
  await page.getByRole("button", { name: "Промени избора" }).click();
  await expect(banner).toBeVisible();
  await expect(page.locator("[data-ck-now]")).toContainText("Още не сте избрали");
  await banner.getByRole("button", { name: "Приеми всички" }).click();
  await expect(banner).toBeHidden();
  await expect(page.locator("[data-ck-now]")).toContainText("Приехте всички");
  expect(await page.evaluate(() => localStorage.getItem("sc-cookie"))).toBe('"all"');
  expect(errors).toEqual([]);
});

test("legal: no horizontal scroll at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const [path] of PAGES) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
