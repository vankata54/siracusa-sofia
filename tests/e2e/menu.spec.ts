import { test, expect, type Page } from "@playwright/test";

/* Menu (/menu/): all dishes in the server HTML, JSON-LD, filters, allergens, search, scrollspy, breakfast by the hour,
   the address keeps the choice, "+" shows the order bar. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t = "12:30", hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/menu/?preview=1&t=" + t + hash);
}
const visibleCards = (page: Page) => page.locator("[data-results] .mcat:not([hidden]) .dcard");

test("menu: SEO, all 127 dishes in the server HTML, JSON-LD Menu", async ({ request }) => {
  const html = await (await request.get("/menu/")).text();
  expect(html.match(/class="dcard"/g)?.length).toBe(127);
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Пица с бурата и прошуто крудо");
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const menu = ld.find((x) => x["@type"] === "Menu");
  expect(menu.hasMenuSection).toHaveLength(15);
  const all = menu.hasMenuSection.flatMap((s: { hasMenuItem: unknown[] }) => s.hasMenuItem);
  expect(all).toHaveLength(127);
  const pizza = all.find((x: { name: string }) => x.name === "Пица Маргарита");
  expect(pizza.offers.priceCurrency).toBe("EUR");
  expect(pizza.description).toBeTruthy();
  expect(ld.find((x) => x["@type"] === "BreadcrumbList")).toBeTruthy();
});

test("menu: filters, allergens and search are kept in the address", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("h1")).toHaveText("Меню");
  await expect(visibleCards(page)).toHaveCount(124);
  await expect(page.locator("[data-count]")).toContainText("124 ястия");
  /* filter chip */
  await page.locator('[data-fchips] [data-f="veg"]').click();
  await expect(page).toHaveURL(/#f=veg$/);
  await expect(page.locator("[data-count]")).toContainText("Показваме");
  const nVeg = await visibleCards(page).count();
  expect(nVeg).toBeGreaterThan(0);
  expect(nVeg).toBeLessThan(124);
  /* allergen sheet */
  await page.locator('[data-sheet="al"]').click();
  await page.locator('.sheetwrap.on input[data-al="milk"]').check({ force: true });
  await expect(page.locator(".sheetwrap.on [data-shgo]")).toContainText("Покажи");
  await page.locator(".sheetwrap.on [data-shgo]").click();
  await expect(page).toHaveURL(/f=veg&a=milk/);
  await expect(page.locator('[data-sheet="al"] .dot')).toHaveText("1");
  /* clear, then search in Latin with a typo */
  await page.locator(".mstat [data-clearall]").click();
  await page.locator("#mq").fill("kebapceta");
  await expect(page.locator("[data-count]")).toContainText("Намерихме");
  await expect(visibleCards(page).first()).toContainText("Кебапчета");
  await expect(page).toHaveURL(/q=kebapceta/);
  /* nothing found: the empty state */
  await page.locator("#mq").fill("жжжжжжж");
  await expect(page.locator(".mempty")).toContainText("Не намерихме");
  await page.locator(".mempty [data-qclear]").click();
  await expect(visibleCards(page)).toHaveCount(124);
  /* reload keeps the address */
  await page.goto("/menu/?preview=1&t=12:30#f=veg.hot");
  await expect(page.locator('[data-f="hot"]').first()).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("menu: empty state with filters and a remove chip per filter", async ({ page }) => {
  await open(page, "12:30", "#f=veg.hot.bertha");
  await expect(page.locator(".mempty")).toContainText("Няма ястия с тези филтри");
  await page.locator(".mempty [data-clearall]").click();
  await expect(visibleCards(page)).toHaveCount(124);
});

test("menu: category navigation and scrollspy", async ({ page, isMobile }) => {
  const errors = watch(page);
  await open(page);
  const nav = isMobile ? page.locator("[data-catscroll]") : page.locator("[data-slist]");
  await nav.locator('[data-go="pitsi"]').click();
  await expect(page).toHaveURL(/#pitsi$/);
  await expect(nav.locator('[data-go="pitsi"]')).toHaveAttribute("aria-current", "true");
  await page.waitForTimeout(400);
  const top = await page.locator("#c-pitsi").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(60);
  expect(top).toBeLessThan(220);
  /* lazy illustrations are drawn near the viewport */
  await expect(page.locator("#c-pitsi .pic svg").first()).toBeAttached();
  /* opened with a category in the address */
  await open(page, "12:30", "#deserti");
  await expect(nav.locator('[data-go="deserti"]')).toHaveAttribute("aria-current", "true");
  expect(errors).toEqual([]);
});

test("menu: breakfast by the hour", async ({ page }) => {
  await open(page, "10:30", "#zakuski");
  await expect(page.locator('.mseg [data-menu="bf"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-notices]")).toContainText("Закуски всеки ден до 11:30");
  await expect(visibleCards(page)).toHaveCount(3);
  await expect(visibleCards(page).locator("[data-add]")).toHaveCount(3);
  await open(page, "12:30", "#zakuski");
  await expect(page.locator("[data-notices]")).toContainText("Закуските свършиха за днес");
  await expect(visibleCards(page).locator("[data-add]")).toHaveCount(0);
  await expect(visibleCards(page).first()).toContainText("утре");
  await page.locator('[data-notices] [data-menu="main"]').click();
  await expect(visibleCards(page)).toHaveCount(124);
  /* after the kitchen closes */
  await open(page, "23:30");
  await expect(page.locator("[data-notices]")).toContainText("Поръчай за утре?");
  await expect(page.locator("[data-eta]")).toBeHidden();
});

test("menu: + adds to the cart and shows the order bar; no overflow at 360", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(360);
  await visibleCards(page).first().locator("[data-add]").click();
  await expect(page.locator("[data-cnt]").first()).toHaveText("1");
  await expect(page.locator(".cbar")).toHaveClass(/on/);
  await expect(page.locator(".cbar [data-cgo]")).toContainText("Поръчай ·");
  await page.locator(".cbar [data-cgo]").click();
  await expect(page).toHaveURL(/\/kolichka\//);
  expect(errors).toEqual([]);
});
