import { test, expect, type Page } from "@playwright/test";

/* Gallery (/galeria/): server HTML (SEO, one h1, 24 tiles with counts from the data, [ЛИПСВА] slots, lazy dish
   illustrations, JSON-LD BreadcrumbList), the filter in the address (#gradina), the viewer ("Затвори", arrows, swipe,
   Escape, focus trap, focus back, browser "Назад"), "Добави" from the viewer, the preview-only states panel,
   no console errors, no horizontal scroll at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, q = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/galeria/" + q);
  await expect(page.locator("[data-gallery][data-ready]")).toHaveCount(1);
}
const visible = (page: Page) => page.locator(".mason .gi:visible");
const dialog = (page: Page) => page.getByRole("dialog");

test("gallery: SEO, tiles from the data, [ЛИПСВА], JSON-LD, light HTML", async ({ request }) => {
  const html = await (await request.get("/galeria/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("<title>Галерия | Siracusa Bar &amp; Grill</title>");
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/galeria\/">/);
  expect(html).toMatch(/<meta name="description" content="Галерия на Siracusa/);
  expect(html).not.toMatch(/[—–]/);
  expect(html).not.toContain("Само в прегледа");
  expect(html).not.toMatch(/href="[^"]*\.html/);
  /* 12 dishes + 12 photo slots; the counts on the chips come from the same list */
  expect(html.match(/class="gi"/g)?.length).toBe(24);
  const chips = [...html.matchAll(/data-cat="(\w+)"[^>]*>.*?<span class="n">(\d+)<\/span>/g)].map((m) => m[1] + ":" + m[2]);
  expect(chips).toEqual(["all:24", "yastia:12", "salon:4", "gradina:4", "sabitia:4"]);
  /* the one photo slot of the site: "[ЛИПСВА: снимка на <what>]" (site.review-consistency В8) */
  expect(html.match(/\[ЛИПСВА: снимка на [^\]]+\]/g)?.length).toBe(12);
  expect(html).toContain("[ЛИПСВА: снимки от новата фотосесия]");
  expect(html).toContain("10,22 €");
  /* the illustrations are drawn by the browser (lazy), not shipped in the HTML */
  expect(html).not.toMatch(/<svg[^>]*data-dish=/);
  expect(html.match(/data-art="/g)?.length).toBe(12);
  expect(html.length).toBeLessThan(80_000);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Галерия"]);
  expect(crumbs.itemListElement[1].item).toMatch(/\/galeria\/$/);
});

test("gallery: filter in the address, viewer with keys, focus trap and focus back", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("h1")).toHaveText("Галерия");
  await expect(visible(page)).toHaveCount(24);
  await expect(page.locator("[data-count]")).toHaveText("Всички: 24 кадъра, 12 ястия и 12 места за снимки");
  /* the illustrations near the screen are drawn */
  await expect(page.locator(".mason .gi").first().locator("svg[data-dish]")).toHaveCount(1);

  await page.locator('.g-chips [data-cat="gradina"]').click();
  await expect(page).toHaveURL(/#gradina$/);
  await expect(visible(page)).toHaveCount(4);
  await expect(page.locator('.g-chips [data-cat="gradina"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-count]")).toHaveText("Градина: 4 кадъра");

  const first = visible(page).first();
  await first.click();
  const lb = dialog(page);
  await expect(lb).toBeVisible();
  await expect(lb.getByRole("button", { name: "Затвори" })).toBeFocused();
  await expect(lb.locator(".lb-where")).toContainText("Градина");
  await expect(lb.locator(".lb-count")).toHaveText("1 от 4");
  await expect(lb.locator("h2")).toHaveText("Градината през деня");
  await expect(lb).toContainText("[ЛИПСВА: снимка от новата фотосесия]");
  await expect(lb.getByRole("link", { name: "Резервирай маса" })).toHaveAttribute("href", "/rezervatsia/");
  await expect(lb.getByRole("button", { name: "Предишна" })).toBeDisabled();
  /* the page behind is inert */
  expect(await page.locator("[data-scroller]").evaluate((el) => (el.closest(".device") as HTMLElement).inert)).toBe(true);

  await page.keyboard.press("ArrowRight");
  await expect(lb.locator(".lb-count")).toHaveText("2 от 4");
  await lb.getByRole("button", { name: "Следваща" }).click();
  await lb.getByRole("button", { name: "Следваща" }).click();
  await expect(lb.locator(".lb-count")).toHaveText("4 от 4");
  await expect(lb.getByRole("button", { name: "Следваща" })).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(lb.locator(".lb-count")).toHaveText("3 от 4");

  /* Tab never leaves the viewer */
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".lb"))).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement?.closest(".lb"))).toBe(true);

  /* Escape closes; the focus goes to the tile of the photo that was open */
  await page.keyboard.press("Escape");
  await expect(lb).toHaveCount(0);
  await expect(visible(page).nth(2)).toBeFocused();
  await expect(page).toHaveURL(/#gradina$/);
  expect(await page.locator(".device").evaluate((el) => (el as HTMLElement).inert)).toBe(false);

  /* the address opens the filter directly; "Всички" brings everything back */
  await page.goto("/galeria/#sabitia");
  await expect(visible(page)).toHaveCount(4);
  await page.locator('.g-chips [data-cat="all"]').click();
  await expect(visible(page)).toHaveCount(24);
  await expect(page).toHaveURL(/\/galeria\/$/);
  expect(errors).toEqual([]);
});

test("gallery: dish in the viewer, add to the cart, swipe, browser back closes", async ({ page }) => {
  const errors = watch(page);
  await open(page, "#yastia");
  await expect(visible(page)).toHaveCount(12);
  await visible(page).first().click();
  const lb = dialog(page);
  await expect(lb.locator("h2")).toHaveText("Пица с бурата и прошуто Крудо");
  /* this photo and its neighbour are drawn, the rest wait */
  await expect(lb.locator(".lb-slide").nth(0).locator("svg[data-dish]")).toHaveCount(1);
  await expect(lb.locator(".lb-slide").nth(5).locator("svg[data-dish]")).toHaveCount(0);
  await expect(lb.getByRole("link", { name: "За ястието" })).toHaveAttribute("href", "/menu/pitsi/pitsa-s-burata-i-proshuto-krudo/");
  const add = lb.getByRole("button", { name: /Добави · 10,22 €/ });
  await add.click();
  await expect(lb.locator("[data-lbadd]")).toContainText("Добавено");
  const lines = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").lines || []);
  expect(lines.map((l: { id: string; q: number }) => l.id + ":" + l.q)).toEqual(["pitsa-s-burata-i-proshuto-krudo:1"]);

  /* swipe left with the pointer: the next photo, and its illustration is drawn */
  const box = (await lb.locator(".lb-stage").boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width * 0.7 - i * 25, y);
  await page.mouse.up();
  await expect(lb.locator(".lb-count")).toHaveText("2 от 12");
  await expect(lb.locator("h2")).toHaveText("Свински ребра");
  await expect(lb.locator(".lb-slide").nth(1).locator("svg[data-dish]")).toHaveCount(1);

  /* the browser's "Назад" closes the viewer and stays on the page */
  await page.goBack();
  await expect(lb).toHaveCount(0);
  await expect(page).toHaveURL(/\/galeria\/#yastia$/);
  await expect(visible(page).nth(1)).toBeFocused();
  expect(errors).toEqual([]);
});

test("gallery: states panel only in preview; 360 without horizontal scroll", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("[data-pv]")).toHaveCount(0);
  await open(page, "?preview=1&t=12:30");
  const proto = page.locator("[data-pv]");
  await expect(proto).toBeVisible();
  await proto.getByRole("button", { name: "Зареждане" }).click();
  await expect(page.locator(".g-skel .skel-it")).toHaveCount(8);
  await expect(page.locator(".mason")).toBeHidden();
  await proto.getByRole("button", { name: "Без интернет" }).click();
  await expect(page.getByRole("alert")).toContainText("Няма връзка с интернет");
  await page.getByRole("alert").getByRole("button", { name: "Опитай пак" }).click();
  await expect(visible(page)).toHaveCount(24);

  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await visible(page).first().click();
  await expect(dialog(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
