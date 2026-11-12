import { test, expect, type Page } from "@playwright/test";

/* Dish (/menu/<кат>/<ястие>/): SEO, sheet "Добавки и промени", counter and add to cart, sold out, per 100 g, closed kitchen. */
const PIZZA = "/menu/pitsi/pitsa-s-burata-i-proshuto-krudo/";
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, path: string, t = "12:30") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto(path + "?preview=1&t=" + t);
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 900;
const buyBtn = (page: Page) => (isPhone(page) ? page.locator(".dish-abar [data-buy]") : page.locator("[data-buybox] [data-buy]"));
const plusQ = (page: Page) => (isPhone(page) ? page.locator('.dish-abar [data-q="1"]') : page.locator('[data-buybox] [data-q="1"]'));

test("dish: SEO (h1, JSON-LD MenuItem + BreadcrumbList, crumbs)", async ({ page }) => {
  const errors = watch(page);
  await open(page, PIZZA);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Пица с бурата и прошуто Крудо");
  await expect(page).toHaveTitle(/Пица с бурата и прошуто Крудо \| Пици на пещ \| Siracusa/);
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((x) => JSON.parse(x));
  const mi = ld.find((x) => x["@type"] === "MenuItem");
  expect(mi.offers.priceCurrency).toBe("EUR");
  expect(mi.offers.price).toBe("10.22");
  expect(mi.description).toContain("бурата");
  const bc = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(bc.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Меню", "Пици на пещ", "Пица с бурата и прошуто Крудо"]);
  await expect(page.locator(".crumbs a")).toHaveText(["Меню", "Пици на пещ"]);
  await expect(page.locator(".crumbs a").nth(1)).toHaveAttribute("href", "/menu/pitsi/");
  await expect(page.locator(".fcard")).toContainText("Предварително, от състава. Потвърждава се от кухнята.");
  await expect(page.locator("[data-pairs] .pcard")).toHaveCount(2);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("dish: modifiers sheet, counter and add to cart", async ({ page }) => {
  const errors = watch(page);
  await open(page, PIZZA);
  await page.locator("[data-mods]").click();
  const sheet = page.locator(".sheet");
  await expect(sheet.locator("h2")).toHaveText("Добавки и промени");
  await sheet.locator("label.mrow", { hasText: "Без доматен сос" }).click();
  await sheet.locator("label.mrow", { hasText: "Риба тон" }).click();
  await expect(sheet.locator("[data-tot]")).toHaveText("12,39 €");
  await expect(sheet.locator("[data-sbuy]")).toContainText("Добави · 12,39 €");
  await sheet.locator("[data-close]").click();
  await expect(page.locator("[data-mods]")).toContainText("Без доматен сос · + Риба тон");
  await plusQ(page).click();
  await expect(buyBtn(page)).toContainText("Добави 2 бр. · 24,78 €");
  await buyBtn(page).click();
  await expect(page.locator("[data-cnt]").first()).toHaveText("2");
  const line = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").lines[0]);
  expect(line.id).toBe("pitsa-s-burata-i-proshuto-krudo");
  expect(line.mods).toEqual(["без доматен сос", "+ Риба тон"]);
  expect(errors).toEqual([]);
});

test("dish: favourite and 3D", async ({ page }) => {
  await open(page, PIZZA);
  const fav = page.locator("[data-fav]");
  await fav.click();
  await expect(fav).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sc-fav") || "[]"))).toContain("pitsa-s-burata-i-proshuto-krudo");
  await page.locator("[data-3d]").click();
  await expect(page.locator("[data-3d]")).toContainText("Снимка");
  await expect(page.locator("[data-note3d]")).toBeVisible();
});

test("dish: sold out shows the notice and 3 similar dishes", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/menu/skara-bertha/pleskavitsa/");
  await expect(page.locator(".soldout")).toContainText("Изчерпано днес");
  await expect(page.locator("#similar .pcard")).toHaveCount(3);
  await expect(page.locator("[data-buy]")).toHaveCount(0);
  await expect(page.locator("[data-3d]")).toHaveCount(0);
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((x) => JSON.parse(x));
  expect(ld.find((x) => x["@type"] === "MenuItem").offers.availability).toBe("https://schema.org/SoldOut");
  if (isPhone(page)) await expect(page.locator(".dish-abar.out")).toContainText("Вижте подобни");
  expect(errors).toEqual([]);
});

test("dish: per 100 g and kitchen closed", async ({ page }) => {
  await open(page, "/menu/skara-bertha/ribay-stek-ot-blek-angas/", "23:30");
  await expect(page.locator(".prow2 .g")).toHaveText("за 100 гр.");
  await expect(buyBtn(page)).toContainText("/100 гр.");
  await expect(page.locator(".closednote")).toContainText("поръчайте за утре");
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((x) => JSON.parse(x));
  expect(ld.find((x) => x["@type"] === "MenuItem").offers.priceSpecification.referenceQuantity.value).toBe(100);
  /* no double dot after "гр." (review: visual, important 1-2) */
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /9,20 € за 100 гр\. Поръчайте/);
  await expect(page.locator("details.nutr .note-auto")).toContainText("На 100 гр. Стойностите");
  expect(await page.content()).not.toMatch(/гр\.\./);
});

test("dish: long names keep the title within about 70 signs", async ({ page }) => {
  await open(page, "/menu/studeni-predyastia/grilovani-tikvichki-s-mus-ot-sirena-semena-i-pus/");
  const t = await page.title();
  expect(t.length).toBeLessThanOrEqual(72);
  expect(t).toMatch(/^Гриловани тиквички .* пушена сьомга \| Siracusa Bar & Grill$/);
  await expect(page.locator("h1")).toHaveText("Гриловани тиквички с мус от сирена, семена и пушена сьомга");
});

test("dish: keyboard - the focused element is never under the bar, the sheet keeps the focus", async ({ page }) => {
  test.skip(!isPhone(page), "phone layout (floating bar)");
  const errors = watch(page);
  await open(page, PIZZA);
  const hidden: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body || a.closest(".ov, .top, .nav, .dish-abar, .skip")) return null;
      const b = a.getBoundingClientRect(), bars = [...document.querySelectorAll<HTMLElement>(".dish-abar, .nav, .top")].map((e) => e.getBoundingClientRect());
      const cy = b.top + b.height / 2;
      return bars.some((z) => z.height && cy > z.top && cy < z.bottom) ? (a.textContent || a.getAttribute("aria-label") || a.tagName).trim().slice(0, 40) : null;
    });
    if (r) hidden.push(r);
    if (await page.evaluate(() => document.activeElement?.hasAttribute("data-mods"))) break;
  }
  expect(hidden).toEqual([]);
  await expect(page.locator("[data-mods]")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sheet")).toBeVisible();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheetwrap"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-mods]")).toBeFocused();
  expect(errors).toEqual([]);
});

test("dish: back goes to the category when we came from it", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/menu/pitsi/");
  await page.evaluate((h) => { const a = document.createElement("a"); a.href = h; a.id = "go"; a.textContent = "go"; document.body.prepend(a); }, PIZZA);
  await page.locator("#go").click();
  await expect(page.locator(".top.back a.hb")).toHaveText("Пици на пещ");
  await expect(page.locator(".top.back a.hb")).toHaveAttribute("href", "/menu/pitsi/");
});

test("dish: loads only the light script at start; the pairs follow the cart", async ({ page }) => {
  const errors = watch(page);
  const js: string[] = [];
  page.on("request", (r) => { if (r.url().endsWith(".js")) js.push(r.url()); });
  await open(page, PIZZA);
  await expect(page.locator("[data-pairs] .pcard")).toHaveCount(2);
  await page.waitForLoadState("networkidle");
  expect(js.filter((u) => /\/(data|sc-menu|art|_dish)\.[^/]*\.js$/.test(u))).toEqual([]);
  /* add from "Върви добре с" (the global "+" handler) and reload: the pairs are drawn again for the cart */
  await buyBtn(page).click();
  await expect(page.locator("[data-cnt]").first()).toHaveText("1");
  const line = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").lines[0]);
  expect(line).toMatchObject({ id: "pitsa-s-burata-i-proshuto-krudo", n: "Пица с бурата и прошуто Крудо", p: 10.22 });
  await page.reload();
  await expect(page.locator("[data-pairs] .pcard").first()).toBeVisible();
  expect(errors).toEqual([]);
});
