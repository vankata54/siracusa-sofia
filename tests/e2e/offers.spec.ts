import { test, expect, type Page } from "@playwright/test";

/* Offers (/oferti/): server HTML (SEO, one H1, BreadcrumbList + OfferCatalog + FAQPage, [ЛИПСВА] where the owner has to
   answer), the coupons by the hour (ember = active now, grey = later), -30% only after 15:00 and only for pickup, the
   anchors (#birthday, #lunch30 ...), the birthday consent (unchecked, errors under the fields) and the voucher inquiry
   sent through api.feedback, the states panel only in preview, no overflow at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string, hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/oferti/" + (t ? "?preview=1&t=" + t : "") + hash);
  await expect(page.locator("[data-of][data-ready]")).toHaveCount(1);
}
const cp = (page: Page, id: string) => page.locator("#" + id + ".cp");

test("offers: SEO, server HTML, JSON-LD", async ({ request }) => {
  const html = await (await request.get("/oferti/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Оферти и отстъпки | Siracusa Bar &amp; Grill");
  expect(html).toContain('rel="canonical"');
  for (const id of ["lunch", "greek", "signup", "rating", "birthday", "celebration", "loyalty", "voucher"]) expect(html).toContain('id="' + id + '"');
  expect(html).toContain("[ЛИПСВА: колко дни по-рано]");
  expect(html).toContain("[ЛИПСВА: наградата]");
  expect(html).toContain("[ЛИПСВА: срок]");
  expect(html).not.toContain("печат за всяка поръчка");
  expect(html).not.toContain("Само в прегледа");
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(crumbs.itemListElement[1]).toMatchObject({ name: "Оферти" });
  expect(crumbs.itemListElement[1].item).toMatch(/\/oferti\/$/);
  const cat = ld.find((x) => x["@type"] === "OfferCatalog");
  expect(cat.itemListElement.length).toBeGreaterThan(2);
  for (const o of cat.itemListElement) { expect(o["@type"]).toBe("Offer"); expect(o.validThrough).toBeUndefined(); }
  const all = JSON.stringify(ld);
  expect(all).not.toContain("ЛИПСВА");
  expect(all).not.toMatch(/Google/);
  expect(ld.find((x) => x["@type"] === "FAQPage").mainEntity.length).toBe(5);
});

test("offers 16:30: -30% active (pickup), hero, count, CTA sets pickup", async ({ page }) => {
  const errors = watch(page);
  await open(page, "16:30");
  await expect(cp(page, "lunch")).not.toHaveClass(/off/);
  await expect(cp(page, "lunch")).toContainText("Важи сега · до 22:30");
  await expect(page.locator("[data-grid] .cp").first()).toHaveAttribute("id", "lunch");
  await expect(page.locator("[data-feat]")).toContainText("на обедното меню при вземане от място");
  await expect(page.locator("[data-now]")).toContainText("Сега важат 7 от 8");
  await expect(cp(page, "birthday")).toHaveClass(/off/);
  await expect(cp(page, "rating")).toContainText("Еднакво при „Да“ и при „Не“");
  await expect(cp(page, "rating")).toContainText("Код за отстъпка");
  await expect(cp(page, "greek")).not.toContainText("-5%");
  await cp(page, "lunch").locator("[data-pickup]").click();
  await expect(page).toHaveURL(/\/obedno-menu\/(\?[^#]*)?$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").mode)).toBe("pickup");
  expect(errors).toEqual([]);
});

test("offers 12:30 and 23:30: -30% grey with when it applies, hero by the hour", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  await expect(cp(page, "lunch")).toHaveClass(/off/);
  await expect(cp(page, "lunch")).toContainText("Днес от 15:00 · след 2 ч 30 мин");
  await expect(page.locator("[data-feat]")).toContainText("Обедно меню");
  await expect(page.locator("[data-feat]")).toContainText("след 2 ч 30 мин");
  await expect(page.locator("[data-now]")).toContainText("Сега важат 6 от 8");
  await page.goto("/oferti/?preview=1&t=23:30");
  await expect(page.locator("[data-of][data-ready]")).toHaveCount(1);
  await expect(cp(page, "lunch")).toContainText("Утре от 15:00 до 22:30");
  await expect(page.locator("[data-feat]")).toContainText("Гръцка вечер");
  expect(errors).toEqual([]);
});

test("offers: #birthday anchor, consent unchecked, errors, guest request sent", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30", "#birthday");
  await expect(cp(page, "birthday")).toBeInViewport();
  await cp(page, "birthday").locator('[data-sheet="birthday"]').click();
  const sh = page.locator(".sheetwrap.on");
  await expect(sh.locator("#b-ok")).not.toBeChecked();
  await sh.locator("[data-go]").click();
  await expect(sh.locator("#e-ok")).toBeVisible();
  await expect(sh.locator("#e-day")).toBeVisible();
  await expect(sh.locator("#e-mail")).toBeVisible();
  await sh.locator("label.check").click();
  await sh.locator("#b-day").selectOption("12");
  await sh.locator("#b-mon").selectOption("3");
  await sh.locator("#b-mail").fill("ime@primer.bg");
  await sh.locator("[data-go]").click();
  await expect(sh.locator(".of-done")).toContainText("Готово, записахме 12 март");
  expect(errors).toEqual([]);
});

test("offers: voucher inquiry through api.feedback, amount in the button", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30", "#voucher");
  await page.locator('[data-sheet="voucher"]').click();
  const sh = page.locator(".sheetwrap.on");
  await sh.locator("#v-sum").fill("25");
  await expect(sh.locator("[data-go]")).toHaveText("Поискай ваучер за 25,00 €");
  await sh.locator("#v-name").fill("Мария");
  await sh.locator("#v-tel").fill("0888");
  await sh.locator("[data-go]").click();
  await expect(sh.locator("#e-tel")).toContainText("10 цифри");
  await sh.locator("#v-tel").fill("0888 12 34 56");
  const req = page.waitForRequest((r) => r.url().includes("/api/feedback") && r.method() === "POST");
  await sh.locator("[data-go]").click();
  const body = (await req).postDataJSON();
  expect(body).toMatchObject({ name: "Мария", contact: "0888123456", mode: "phone", topic: "voucher" });
  expect(body.message).toContain("25,00 €");
  await expect(sh.locator(".of-done")).toContainText("0888 12 34 56");
  expect(errors).toEqual([]);
});

test("offers: states panel only in preview, no horizontal scroll at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  await expect(page.locator("[data-pv]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/oferti/?preview=1&t=16:30");
  await expect(page.locator("[data-pv]")).toHaveCount(1);
  await page.locator('[data-proto="error"]').click();
  await expect(page.locator("[data-grid] [role=alert]")).toContainText("Не успяхме да заредим офертите");
  await page.locator("[data-retry]").click();
  await expect(page.locator("#lunch.cp")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
