import { test, expect, type Page } from "@playwright/test";

/* Category (/menu/<кат>/): server HTML (SEO, every dish, JSON-LD), filters and sort kept in the address,
   allergen sheet, breakfast by the hour, "+" shows the order bar, no horizontal scroll on 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, path: string, t = "12:30", hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto(path + "?preview=1&t=" + t + hash);
}
const cards = (page: Page) => page.locator(".flt .grid-dishes .dcard");

test("category: SEO, all dishes in the server HTML, JSON-LD", async ({ request }) => {
  const html = await (await request.get("/menu/pitsi/")).text();
  expect(html.match(/class="dcard/g)?.length).toBe(15);
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Пици на пещ в Дружба 2 с доставка | Siracusa Bar &amp; Grill");
  expect(html).toContain("[ЛИПСВА: SEO текст за „Пици на пещ“");
  expect(html).toContain('href="/menu/salati/"');
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const menu = ld.find((x) => x["@type"] === "Menu");
  expect(menu.hasMenuSection.name).toBe("Пици на пещ");
  expect(menu.hasMenuSection.hasMenuItem).toHaveLength(15);
  expect(menu.hasMenuSection.hasMenuItem[0].offers.priceCurrency).toBe("EUR");
  const bc = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(bc.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Меню", "Пици на пещ"]);
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  expect(JSON.stringify(faq)).not.toContain("ЛИПСВА");
  /* every category with dishes has its page; sold out stays visible */
  const sk = await (await request.get("/menu/skara-bertha/")).text();
  expect(sk).toContain("https://schema.org/SoldOut");
});

test("category: light HTML (lazy illustrations), own Menu @id, 'Други категории' counts", async ({ request, page }) => {
  const html = await (await request.get("/menu/pitsi/")).text();
  expect(html.length).toBeLessThan(140_000); /* was 213 KB with every SVG inline */
  expect(html.match(/class="dcard[^"]*"/g)?.length).toBe(15);
  expect(html.match(/data-art="/g)?.length).toBe(11 + 14); /* cards after the first 4 + the 14 other categories */
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const menu = ld.find((x) => x["@type"] === "Menu");
  expect(menu["@id"]).toMatch(/\/menu\/pitsi\/#menu$/);
  expect(menu.isPartOf["@id"]).toMatch(/\/menu\/#menu$/);
  /* the breakfast chip reads like the others: "3 закуски · до 11:30" */
  expect(html).toMatch(/<b>Закуски<\/b><small>\d+ закуски · до 11:30<\/small>/);
  /* the browser draws every lazy plate once it is near */
  const errors = watch(page);
  await open(page, "/menu/pitsi/");
  for (let y = 0; y < 12; y++) { await page.mouse.wheel(0, 900); await page.waitForTimeout(60); }
  await expect(page.locator("[data-art]")).toHaveCount(0);
  await expect(cards(page).locator(".pic svg")).toHaveCount(15);
  await expect(page.locator(".cats .pic svg")).toHaveCount(14);
  /* filtering re-renders the cards; the plates come back */
  await page.locator('.flt [data-f="veg"]').click();
  await expect(cards(page).locator(".pic svg")).toHaveCount(4);
  expect(errors).toEqual([]);
});

test("category: 'no allergen data' note under the price, as in the prototype", async ({ page }) => {
  await open(page, "/menu/supi/", "12:30", "#a=gluten");
  const nd = page.locator(".flt .dcard .nodata");
  await expect(nd.first()).toHaveText("Няма данни за алергени. Попитайте ни.");
  /* below the price row */
  const card = page.locator(".flt .dcard", { has: page.locator(".nodata") }).first();
  const yPrice = (await card.locator(".rowp").boundingBox())!.y, yNote = (await card.locator(".nodata").boundingBox())!.y;
  expect(yNote).toBeGreaterThan(yPrice);
});

test("category: an unknown category is the 404 with the menu variant", async ({ page, request }) => {
  expect((await request.get("/menu/nyama-takava/")).status()).toBe(404);
  await page.goto("/menu/nyama-takava/");
  await expect(page.locator('h1 [data-v="cat"]')).toBeVisible();
  await expect(page.locator('h1 [data-v="cat"]')).toHaveText("Тази категория я няма в менюто");
  await expect(page.locator('[aria-labelledby="nf-cats-h"] a.cat').first()).toBeVisible();
});

test("category: filters, sort and allergens are kept in the address", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/menu/pitsi/");
  await expect(page.locator("h1")).toHaveText("Пици на пещ");
  await expect(cards(page)).toHaveCount(15);
  await expect(page.locator("[data-tfact]")).toContainText("Доставка около 35 мин");
  await page.locator('.flt [data-f="veg"]').click();
  await expect(page).toHaveURL(/#f=veg$/);
  await expect(page.locator("#res-h")).toContainText("4 от 15 пици");
  await expect(cards(page)).toHaveCount(4);
  /* sort */
  await page.locator("[data-sort]").click();
  await page.locator('.sheetwrap.on input[value="asc"]').check();
  await expect(page).toHaveURL(/#f=veg&sort=asc$/);
  const prices = await cards(page).locator(".price").allTextContents();
  const nums = prices.map((p) => parseFloat(p.replace(",", ".")));
  expect([...nums].sort((a, b) => a - b)).toEqual(nums);
  /* allergens */
  await page.locator("[data-allergens]").click();
  await page.locator('.sheetwrap.on [data-al="nuts"]').click();
  await page.locator(".sheetwrap.on [data-alok]").click();
  await expect(page).toHaveURL(/a=nuts/);
  await expect(cards(page)).toHaveCount(3);
  await expect(page.locator("[data-allergens]")).toHaveText(/Без 1 алерген/);
  /* clear */
  await page.locator(".res-note [data-clear]").click();
  await expect(cards(page)).toHaveCount(15);
  /* the address restores the choice */
  await page.goto("/menu/pitsi/?preview=1&t=12:30#q=" + encodeURIComponent("моцарела"));
  await expect(page.locator("#res-h")).toContainText("с „моцарела“");
  expect(errors).toEqual([]);
});

test("category: breakfast after 11:30 has no '+', a notice, the hour", async ({ page }) => {
  await open(page, "/menu/zakuski/", "21:30");
  await expect(page.locator(".notice")).toContainText("Закуските свършиха за днес");
  await expect(cards(page).locator(".plus")).toHaveCount(0);
  await expect(cards(page).first().locator(".later")).toContainText("от 10:00");
});

test("category: '+' shows the order bar; no horizontal scroll on 360", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page, "/menu/burgeri/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await cards(page).first().locator(".plus").click();
  await expect(page.locator(".cbar")).toHaveClass(/on/);
  await expect(page.locator(".cbar [data-cn]")).toContainText("1 ястие");
  expect(errors).toEqual([]);
});
