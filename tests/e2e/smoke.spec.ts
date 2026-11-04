import { test, expect } from "@playwright/test";

test("home opens without console errors, + adds to the cart", async ({ page }) => {
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
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBe(0);
  expect(errors).toEqual([]);
});
