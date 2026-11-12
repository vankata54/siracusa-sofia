import { test, expect, type Page } from "@playwright/test";

/* 404: three variants by address (general, /menu/..., /sabitia/...), all in the server HTML (noindex, one h1),
   picked in the browser before the first paint; HTTP status 404; no console errors (except the 404 document itself);
   no horizontal scroll at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text()); });
  return errors;
}
async function open(page: Page, path: string) {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  const r = await page.goto(path);
  expect(r?.status()).toBe(404);
}
const visible = (page: Page) => page.locator("h1 > span:visible");

test("404: server HTML has every variant, noindex, one h1", async ({ request }) => {
  const r = await request.get("/nyama-takava-stranitsa/");
  expect(r.status()).toBe(404);
  const html = await r.text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toMatch(/<meta name="robots" content="noindex/);
  for (const t of ["Тази страница я няма в&nbsp;менюто", "Тази категория я няма в&nbsp;менюто", "Това ястие го няма в&nbsp;менюто", "Това събитие го няма в&nbsp;програмата", "Виж всички събития", "Предстои", "Категории в менюто", "Може би търсите"]) expect(html).toContain(t);
  expect(html).not.toMatch(/[—–]/);
});

test("404 general: menu and home", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/nyama-takava-stranitsa/?preview=1&t=12:30");
  await expect(visible(page)).toHaveText("Тази страница я няма в менюто");
  await expect(page.getByRole("link", { name: "Към менюто" }).first()).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Начало" })).toBeVisible();
  await expect(page.locator("[data-call]")).toContainText("Обадете се: 0894 36 55 77");
  await expect(page.locator(".nf-cats")).toBeHidden();
  await expect(page).toHaveTitle(/Страницата я няма/);
  expect(errors).toEqual([]);
});

test("404 general at 23:30: call tomorrow", async ({ page }) => {
  await open(page, "/x/?preview=1&t=23:30");
  await expect(page.locator("[data-call]")).toContainText("утре след 10:00");
});

test("404 menu: unknown category, list of categories, call", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/menu/nyama-takava/");
  await expect(visible(page)).toHaveText("Тази категория я няма в менюто");
  await expect(page.locator(".nf-cats a.cat")).not.toHaveCount(0);
  await expect(page.locator('.nf-cats a[data-cat="pitsi"]')).toHaveAttribute("href", "/menu/pitsi/");
  await expect(page.getByRole("link", { name: /Обади се · 0894 36 55 77/ })).toHaveAttribute("href", "tel:+359894365577");
  await expect(page.getByText("Може би търсите")).toBeHidden();
  await page.locator('.nf-cats a[data-cat="pitsi"]').click();
  await expect(page).toHaveURL(/\/menu\/pitsi\/$/);
  expect(errors).toEqual([]);
});

test("404 menu: unknown dish in a known category", async ({ page }) => {
  await open(page, "/menu/pitsi/nyama-takava/");
  await expect(visible(page)).toHaveText("Това ястие го няма в менюто");
  await expect(page.locator("[data-tocat]")).toHaveAttribute("href", "/menu/pitsi/");
  await expect(page).toHaveTitle(/Ястието го няма/);
});

test("404 event: all events and the upcoming card", async ({ page }) => {
  const errors = watch(page);
  await open(page, "/sabitia/nyama-takova/");
  await expect(visible(page)).toHaveText("Това събитие го няма в програмата");
  await expect(page.getByRole("link", { name: "Виж всички събития" })).toHaveAttribute("href", "/sabitia/");
  const card = page.locator(".ev-upcard");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", "/sabitia/gratska-vecher/");
  await expect(card.locator("[data-when]")).toHaveText(/^(пн|вт|ср|чт|пт|сб|нд), \d+ /);
  await expect(page.locator(".nf-art")).toBeHidden();
  expect(errors).toEqual([]);
});

test("404: no horizontal scroll at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const p of ["/x/", "/menu/x/", "/sabitia/x/"]) {
    await open(page, p);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
