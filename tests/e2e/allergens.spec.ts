import { test, expect, type Page } from "@playwright/test";

/* Allergens (/alergeni/): server HTML (SEO, every dish with its allergens, JSON-LD BreadcrumbList and FAQPage),
   "Без ..." filters and "Скрий ястията без данни" on the rows the server drew (no menu download), the "cannot check"
   group, search with the menu's logic (menu chunk loaded only then), the address, the category sheet, the states panel
   only in preview, no horizontal scroll at 360, no console errors. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, hash = "", qs = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/alergeni/" + qs + hash);
  await expect(page.locator("#res[data-ready]")).toHaveCount(1);
}
const mainRows = (page: Page) => page.locator("[data-list] > table.atbl tr.dish");
const ndRows = (page: Page) => page.locator("#nodata tr.dish");

test("allergens: SEO, all dishes in the server HTML, JSON-LD, no invented facts", async ({ request }) => {
  const html = await (await request.get("/alergeni/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Алергени в менюто | Siracusa Bar &amp; Grill");
  expect(html).toContain('rel="canonical" href="https://siracusa-sofia.com/alergeni/"');
  expect(html.match(/<tr class="dish/g)?.length).toBe(127);
  expect(Buffer.byteLength(html)).toBeLessThan(120_000); /* speed: icons from one sprite / CSS, empty cells without allergen */
  expect(html).toContain("Алергените са предварителни, от състава. Кухнята ги потвърждава.");
  expect(html).toContain("Състав имаме за 54 от 127 ястия");
  expect(html).toContain("Няма данни за алергени,</b> попитайте ни");
  expect(html).toContain("[ЛИПСВА: дата на проверката от кухнята]");
  expect(html).not.toContain("Само в прототипа");
  expect(html).not.toMatch(/[—–]/);
  /* Шопска: no allergen found, never a green "safe" mark */
  const shopska = html.split('/shopska-salata/"')[1].split("</tr>")[0];
  expect(shopska).toContain("Не открихме алергени в състава · Не е потвърдено от кухнята");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Алергени"]);
  expect(crumbs.itemListElement[1].item).toBe("https://siracusa-sofia.com/alergeni/");
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(5);
  expect(JSON.stringify(faq)).not.toContain("ЛИПСВА");
});

test("allergens: filter Без ..., the cannot-check group, hide no data, clear; no menu download", async ({ page }) => {
  const errors = watch(page);
  const chunks: string[] = [];
  page.on("request", (r) => { if (/\/_astro\/(data|filters)\.[^/]+\.js$/.test(r.url())) chunks.push(r.url()); });
  await open(page);
  await expect(mainRows(page)).toHaveCount(127);
  await page.locator('button[data-al="gluten"]').click();
  await page.locator('button[data-al="milk"]').click();
  await expect(page).toHaveURL(/#a=gluten\.milk$/);
  await expect(page.locator('button[data-al="gluten"]')).toHaveAttribute("aria-pressed", "true");
  /* main table: only dishes with a composition and without gluten / milk */
  const n = await mainRows(page).count();
  expect(n).toBeGreaterThan(0);
  expect(n).toBeLessThan(127);
  /* column 1 = gluten, column 7 = milk (cells after the name); every row has a composition */
  for (const r of await mainRows(page).evaluateAll((els) => els.map((e) => {
    const c = (e as HTMLTableRowElement).cells;
    return (c[1].classList.contains("y") ? "gluten " : "") + (c[7].classList.contains("y") ? "milk " : "") + (e.querySelector(".comp") ? "comp" : "");
  }))) expect(r).toBe("comp");
  await expect(page.locator("#nodata")).toBeVisible();
  await expect(page.locator("#nodata summary")).toContainText("Не можем да проверим");
  expect(await ndRows(page).count()).toBeGreaterThan(0);
  await expect(page.locator("[data-sum]:visible, [data-sum2]:visible").first()).toContainText("без глутен, мляко");
  /* hide the dishes without data: the group goes away */
  await page.locator("#nd").check();
  await expect(page.locator("#nodata")).toBeHidden();
  await expect(page).toHaveURL(/nd=1/);
  await page.locator(".frow [data-clear]").click();
  await expect(mainRows(page)).toHaveCount(127);
  await expect(page.locator(".frow [data-clear]")).toBeHidden();
  expect(chunks).toEqual([]); /* the filters work on the HTML: the menu is never downloaded */
  expect(errors).toEqual([]);
});

test("allergens: search like the menu (Latin, typos), empty state, from the address", async ({ page }) => {
  const errors = watch(page);
  await open(page, "#q=kebapcheta");
  await expect(mainRows(page).first().locator("a")).toHaveAttribute("href", /kebapcheta/);
  await expect(page.locator("#q")).toHaveValue("kebapcheta");
  await page.locator("#q").fill("pica");
  await expect(page.locator("tbody.cath").first()).toContainText("Пици");
  await page.locator("#q").fill("zzqqxx");
  await expect(page.locator("[data-state]")).toContainText("Не намерихме „zzqqxx“");
  await page.locator("[data-state] [data-clrq]").click();
  await expect(mainRows(page)).toHaveCount(127);
  await expect(page.locator("#q")).toHaveValue("");
  expect(errors).toEqual([]);
});

test("allergens: category sheet jumps to a category; no horizontal scroll at 360", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 360, height: 760 });
  await open(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.locator("[data-cats]").click();
  const btn = page.locator('.sheetwrap [data-jump="g-deserti"]');
  await expect(btn).toBeVisible();
  await btn.click();
  await expect(page.locator("#g-deserti")).toBeInViewport();
  /* touch targets: dish links at least 48px high */
  const h = await page.locator(".nm a").first().evaluate((a) => a.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(48);
  expect(errors).toEqual([]);
});

test("allergens: preview states panel only in preview", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator(".proto")).toHaveCount(0);
  await page.goto("/alergeni/?preview=1");
  await expect(page.locator(".proto")).toBeVisible();
  await page.locator('[data-view="error"]').click();
  await expect(page.locator("[data-state]")).toContainText("Не успяхме да заредим алергените");
  await page.locator("[data-state] [data-retry]").click();
  await expect(mainRows(page)).toHaveCount(127, { timeout: 5000 });
  expect(errors).toEqual([]);
});
