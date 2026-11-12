import { test, expect, type Page } from "@playwright/test";

/* Home (/): hero, hour-dependent copy, offers banner, address check, map on tap, SEO. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string, hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.route(/google\.com\/maps/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>map</title>" }));
  await page.goto("/" + (t ? "?preview=1&t=" + t : "") + hash);
}

test("home: hero, order flow, SEO and no overflow", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Пица на пещ и скара на дървени въглища");
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  const r = ld.map((x) => JSON.parse(x)).find((x) => x["@type"] === "Restaurant");
  expect(r.telephone).toBe("+359894365577");
  expect(r.aggregateRating).toBeUndefined();
  expect(r.review).toBeUndefined();
  await expect(page.locator("[data-go]")).toContainText("Поръчай");
  await expect(page.locator("[data-eta]")).toContainText("Доставка сега");
  /* popular: + adds to the cart without the menu on the page */
  await page.locator(".rail.pop [data-add]").first().click();
  await expect(page.locator("[data-cnt]").first()).toHaveText("1");
  expect(errors).toEqual([]);
  await page.locator("[data-go]").click();
  await expect(page).toHaveURL(/\/menu\//);
});

test("home: after 21:00 the order button is for pickup and sets the mode", async ({ page }) => {
  const errors = watch(page);
  await open(page, "21:30");
  await expect(page.locator("[data-go]")).toContainText("Поръчай за вземане");
  await expect(page.locator("[data-eta]")).toContainText("Доставката приключи");
  await expect(page.locator("[data-dnote]")).toBeVisible();
  await expect(page.locator("[data-lunchtile]")).toContainText("-30%");
  await expect(page.locator("[data-slides] .slide.on")).toContainText("-30% на обедното меню");
  expect(errors).toEqual([]);
  await page.locator("[data-go]").click();
  await expect(page).toHaveURL(/\/menu\//);
  const mode = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").mode);
  expect(mode).toBe("pickup");
});

test("home: offers banner pauses and the dots switch slides", async ({ page }) => {
  await open(page, "23:30");
  const promo = page.locator("[data-promo]");
  await expect(promo.locator(".slide.on")).toContainText("Поръчай за утре");
  await promo.locator("[data-pp]").click();
  await expect(promo.locator("[data-pp]")).toContainText("Пусни");
  await promo.locator('[data-dot="2"]').click();
  await expect(promo.locator('[data-dot="2"]')).toHaveAttribute("aria-current", "true");
  await expect(promo.locator(".slide.on")).toHaveCount(1);
  await expect(promo.locator(".slide.on a")).not.toHaveAttribute("tabindex", "-1");
});

test("home: address check and the map", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  const f = page.locator("[data-chk]");
  await f.locator("button[type=submit]").click();
  await expect(f.locator("#addr-err")).toBeVisible();
  await f.locator("#addr").fill("Младост 1");
  await f.locator("button[type=submit]").click();
  await expect(f.locator("[data-res]")).toContainText("Не доставяме до този адрес.");
  await f.locator("#addr").fill("druzhba 2, бл. 311");
  await f.locator("button[type=submit]").click();
  await expect(f.locator("[data-res]")).toContainText("Дружба 2: безплатна доставка");
  await f.locator("#addr").fill("Горубляне");
  await f.locator("button[type=submit]").click();
  await expect(f.locator("[data-res]")).toContainText("доставка по тарифа");
  await page.locator("[data-maplive]").click();
  await expect(page.locator("[data-map] iframe")).toHaveCount(1);
  await expect(page.locator('a[href^="https://www.google.com/maps/dir/"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("home: no horizontal scroll at 360, targets at least 48px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page, "12:30");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
  const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-home] button, [data-home] .pill"))
    .filter((b) => b.offsetParent && b.getBoundingClientRect().height < 48).map((b) => b.outerHTML.slice(0, 80)));
  expect(small).toEqual([]);
});

test("home: preview-only states stay behind ?preview=1", async ({ page }) => {
  await open(page, undefined, "#error");
  await expect(page.locator(".proto")).toHaveCount(0);
  await expect(page.locator(".errbox")).toHaveCount(0);
  await open(page, "12:30", "#loading");
  await expect(page.locator(".proto")).toBeVisible();
  await expect(page.locator(".skcard").first()).toBeVisible();
});

test("home: \"Натоварено\" follows the kitchen setting from /api/status", async ({ page }) => {
  const errors = watch(page);
  await page.route("**/api/status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kitchen: { busy: true, etaMin: 35, etaBusyMin: 55 } }) }));
  await page.addInitScript(() => { try { sessionStorage.removeItem("sc-kitchen"); } catch { /* ignore */ } });
  await open(page, "12:30");
  const row = page.locator("[data-eta]");
  await expect(row).toContainText("Възможни са закъснения");
  await expect(row).toContainText("около 55 мин");
  const f = page.locator("[data-chk]");
  await f.locator("#addr").fill("Дружба 2, бл. 311");
  await f.locator("button[type=submit]").click();
  await expect(f.locator("[data-res]")).toContainText("Възможни са закъснения · около 55 мин");
  expect(errors).toEqual([]);
});

test("home: \"35 мин\" stays on one line at 360 and the slides are not articles with a role", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page, "12:30");
  await expect(page.locator("[data-eta]")).toContainText("около 35 мин");
  expect(await page.locator("article[role]").count()).toBe(0);
  expect(await page.locator("[data-slides] .slide[role=group]").count()).toBeGreaterThan(0);
  /* "35" and "мин" on the same line box */
  const lines = await page.locator("[data-eta] .tx b").evaluate((b) => {
    const t = b.firstChild as Text, i = (t.textContent || "").indexOf("35"), r = document.createRange();
    r.setStart(t, i); r.setEnd(t, i + 6);
    return new Set(Array.from(r.getClientRects()).map((x) => Math.round(x.top))).size;
  });
  expect(lines).toBe(1);
});
