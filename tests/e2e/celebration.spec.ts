import { test, expect, type Page } from "@playwright/test";

/* Celebration calculator (/praznik/): occasion -> guests -> date -> place, package from the real menu or own menu,
   cake / decoration / contact with unticked consent, api.celebrations.create -> success. "Назад" keeps everything;
   the price for the guest is "Ще ви изпратим оферта" until the admin has a setting; #<type> preselects the occasion. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (422)/.test(m.text())) errors.push(m.text()); });
  return errors;
}
const pad = (n: number) => String(n).padStart(2, "0");
function future(days = 40): string { const d = new Date(); d.setDate(d.getDate() + days); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
async function open(page: Page, hash = "", t = "12:30") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/praznik/?t=" + t + (hash ? "#" + hash : ""));
  await expect(page.locator("[data-flow] .tiles")).toBeVisible();
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 900;
const next = (page: Page) => (isPhone(page) ? page.locator(".cbar [data-next]") : page.locator(".aside [data-next]"));
const back = (page: Page) => (isPhone(page) ? page.locator(".cbar [data-back]") : page.locator(".aside [data-back]"));
const stepIs = (page: Page, n: number) => expect(page.locator("[data-flow] .stepper .t > span").first()).toHaveText("Стъпка " + n + " от 3");

test("celebration: SEO, one h1, breadcrumb JSON-LD, no overflow at 360, no preview panel", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Празник при нас");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/praznik\/$/);
  const ld = (await page.locator('script[type="application/ld+json"]').allTextContents()).join(" ");
  expect(ld).toContain("BreadcrumbList");
  expect(ld).toContain("Празник при нас");
  await expect(page.locator("[data-proto]")).toBeHidden();
  await expect(page.locator("main")).not.toContainText("30 дни");
  await expect(page.locator("[data-early]")).toContainText("[ЛИПСВА: колко дни по-рано]");
  await page.setViewportSize({ width: 360, height: 800 });
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("celebration: errors on step 1, then full flow with a package, Назад keeps everything, success", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await next(page).click();
  await expect(page.locator("#e-type")).toBeVisible();
  await expect(page.locator("#e-date")).toBeVisible();
  await stepIs(page, 1);

  await page.locator(".tile", { hasText: "Кръщене" }).click();
  await page.locator('[data-gset="30"]').click();
  await expect(page.locator("#guests")).toHaveValue("30");
  const date = future();
  await page.locator("#cdate").fill(date);
  await page.locator(".zone", { hasText: "Отоплявана градина" }).click();
  await next(page).click();
  await stepIs(page, 2);

  /* price: "Ще ви изпратим оферта" (no admin setting yet) */
  await expect(page.locator(".pkg").first()).toContainText("Цена с оферта");
  await next(page).click();
  await expect(page.locator("#e-menu")).toBeVisible();
  await page.locator(".pkg", { hasText: "Класически" }).click();
  await expect(page.locator(".pkg", { hasText: "Класически" })).toContainText("Шопска салата");

  /* Назад and forward again: nothing lost */
  await back(page).click();
  await stepIs(page, 1);
  await expect(page.locator(".tile.on")).toContainText("Кръщене");
  await expect(page.locator("#cdate")).toHaveValue(date);
  await expect(page.locator(".zone.on")).toContainText("Отоплявана градина");
  await next(page).click();
  await expect(page.locator('input[name="cmenu"][value="klasicheski"]')).toBeChecked();
  await next(page).click();
  await stepIs(page, 3);

  await expect(page.locator("#cconsent")).not.toBeChecked();
  await page.locator('[data-seg="cake"][data-v="ours"]').click();
  await page.locator("#cakenote").fill("Шоколад");
  await page.locator("#cname").fill("Тест Празник");
  await page.locator("#cphone").fill("123");
  await next(page).click();
  await expect(page.locator("#e-phone")).toBeVisible();
  await page.locator("#cphone").fill("0888 12 34 56");

  const req = page.waitForRequest((r) => r.url().endsWith("/api/celebrations") && r.method() === "POST");
  const res = page.waitForResponse((r) => r.url().endsWith("/api/celebrations"));
  await next(page).click();
  const body = (await req).postDataJSON();
  expect(body).toMatchObject({ kind: "Кръщене", people: 30, date, zone: "garden", pack: "Класически", cake: true, decor: false, name: "Тест Празник", marketing: false, early: false });
  expect(body.items).toContain("shopska-salata");
  expect(body.note).toContain("Начален час: 19:00");
  expect(body.note).toContain("Шоколад");
  expect((await res).status()).toBe(201);

  await expect(page.locator(".done h2")).toHaveText("Запитването е изпратено");
  await expect(page.locator(".done")).toContainText("[ЛИПСВА: срок за обаждане]");
  await expect(page.locator(".done")).toContainText("Кръщене");
  await expect(page.locator(".cbar")).toBeHidden();
  /* the draft is cleared after sending */
  expect(await page.evaluate(() => localStorage.getItem("sc-celebration-draft"))).toBeNull();
  expect(errors).toEqual([]);
});

test("celebration: #krashtene preselects, own menu from the real dishes, the draft survives a reload with consent unticked", async ({ page }) => {
  const errors = watch(page);
  await open(page, "krashtene");
  await expect(page.locator('input[name="ctype"][value="krashtene"]')).toBeChecked();
  await page.locator("#cdate").fill(future(20));
  await next(page).click();
  await page.locator(".pkg.custom").click();
  await expect(page.locator(".picker")).toBeVisible();
  await next(page).click();
  await expect(page.locator("#e-picks")).toBeVisible();
  await page.locator('[data-pick="set-ot-balgarski-kolbasi"]').click();
  await page.locator('[data-pg="dessert"]').click();
  await page.locator('[data-pick="tiramisu"]').click();
  await expect(page.locator("[data-mine]")).toContainText("2 ястия в менюто");
  await expect(page.locator("[data-mine]")).toContainText("Тирамису");
  await next(page).click();
  await stepIs(page, 3);
  await page.locator("#cname").fill("Мария");
  await page.locator("#cconsent").check();

  await page.reload();
  await stepIs(page, 3);
  await expect(page.locator(".draft")).toContainText("Продължавате оттам");
  await expect(page.locator("#cname")).toHaveValue("Мария");
  await expect(page.locator("#cconsent")).not.toBeChecked();
  await back(page).click();
  await expect(page.locator('[data-pick="tiramisu"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-mine]")).toContainText("2 ястия в менюто");
  await page.locator("[data-reset]").click();
  await stepIs(page, 1);
  await expect(page.locator(".tile.on")).toHaveCount(0);
  expect(errors).toEqual([]);
});
