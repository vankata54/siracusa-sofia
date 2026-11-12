import { test, expect, type Page } from "@playwright/test";

/* Pickup (/vzemi-ot-myasto/): server HTML (SEO, one H1, BreadcrumbList + FAQPage, [ЛИПСВА] for parking), the live
   plan by the hour (lunch at once, menu after 20 min, tomorrow after 22:30), the slot saved for the cart, -30% after
   15:00, "Поръчай за вземане" sets the cart to pickup, the states panel only in preview, no overflow at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string) {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/vzemi-ot-myasto/" + (t ? "?preview=1&t=" + t : ""));
  await expect(page.locator("[data-live][data-ready]")).toHaveCount(1);
}
const big = (page: Page) => page.locator("[data-live] [data-big]");

test("pickup: SEO, server HTML, JSON-LD", async ({ request }) => {
  const html = await (await request.get("/vzemi-ot-myasto/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Вземи от място | Siracusa Bar &amp; Grill");
  expect(html).toContain('rel="canonical"');
  expect(html).toContain("[ЛИПСВА: паркиране]");
  expect(html).toContain("Часове за вземане");
  expect(html).toContain("Често задавани въпроси");
  expect(html).not.toContain("Само в прегледа");
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(crumbs.itemListElement[1]).toMatchObject({ name: "Вземи от място" });
  expect(crumbs.itemListElement[1].item).toMatch(/\/vzemi-ot-myasto\/$/);
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(5);
  expect(JSON.stringify(faq)).not.toContain("ЛИПСВА");
  expect(html).toContain("Не намерихте отговор? Обадете ни се, ще ви кажем.");
  expect(html).toMatch(/Обади се · (<span class="nw">)?0894 36 55 77/);
  expect(html).toContain("Карта при получаване");
});

test("pickup 12:30: live plan, kinds, slot saved for the cart, CTA sets pickup", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  await expect(page.locator("[data-live] [data-now]")).toContainText("Сега 12:30");
  await expect(big(page)).toContainText("12:50");
  await page.locator('[data-kind="lunch"]').click();
  await expect(big(page)).toHaveText("веднага");
  await page.locator('[data-kind="both"]').click();
  await expect(big(page)).toContainText("12:50");
  await page.locator('[data-slot="810"]').click(); /* 13:30 */
  await expect(big(page)).toContainText("13:30");
  await expect(page.locator(".pk-chosen")).toContainText("Запазихме 13:30");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-pickup") || "null"));
  expect(saved).toMatchObject({ kind: "both", day: "today", t: 810 });
  /* no "full" slot by default */
  await expect(page.locator(".pk-slot[disabled]")).toHaveCount(0);
  await expect(page.locator("[data-alert]")).toBeEmpty();
  await page.locator("[data-hero-cta] [data-pickup-go]").click();
  await expect(page).toHaveURL(/\/menu\/$/);
  const mode = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").mode);
  expect(mode).toBe("pickup");
  expect(errors).toEqual([]);
});

test("pickup 16:30: -30% now, add a lunch dish, CTA with the pickup total", async ({ page }) => {
  const errors = watch(page);
  await open(page, "16:30");
  await expect(page.locator("[data-alert]")).toContainText("Сега: -30% на обедното меню");
  await expect(page.locator(".pk-when")).toContainText("Важи сега · до 22:30");
  const lz = page.locator('.pk-ex:has-text("Лазаня")');
  await expect(lz).toContainText("3,29 €");
  await expect(lz).toContainText("4,70 €");
  await lz.locator(".plus").click();
  await expect(page.locator("[data-hero-cta] [data-pickup-go]")).toContainText("Вземи от място · 3,29 €");
  await expect(page.locator('[data-kind="lunch"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".pk-fromcart")).toBeVisible();
  await expect(page.locator(".pk-tag")).toContainText("-30%");
  expect(errors).toEqual([]);
});

test("pickup 22:45 and 09:30: tomorrow, before opening", async ({ page }) => {
  await open(page, "22:45");
  await expect(page.locator("[data-alert]")).toContainText("Кухнята затвори за днес");
  await expect(page.locator("[data-hero-cta] [data-pickup-go]")).toContainText("Поръчай за утре");
  /* a pre-order starts at 10:30, as in the cart and the core (ORDER_RULES.preorderFrom), not at 10:00 + 20 min */
  await expect(big(page)).toContainText("утре в10:30");
  await expect(page.locator(".pk-asap")).toContainText("в 10:30");
  await expect(page.locator(".pk-pick")).toContainText("утре, ");
  await page.goto("/vzemi-ot-myasto/?preview=1&t=09:30");
  await expect(page.locator("[data-alert]")).toContainText("Приемаме поръчки днес от 10:00");
  await page.locator('[data-kind="lunch"]').click();
  await expect(big(page)).toContainText("днес в10:30");
  await expect(page.locator(".pk-res p")).toContainText("Отваряме в 10:00. Поръчка отсега е готова най-рано в 10:30.");
});

test("pickup 22:45 with a full cart: the button says \"Поръчай за утре\" like the alert", async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cart", JSON.stringify({ mode: "pickup", lines: [{ key: "pitsa-kaprichoza", id: "pitsa-kaprichoza", q: 1, mods: [], extra: 0 }] })); } catch { /* ignore */ } });
  await open(page, "22:45");
  await expect(page.locator("[data-alert]")).toContainText("поръчате сега за утре");
  await expect(page.locator("[data-hero-cta] [data-pickup-go]")).toContainText(/Поръчай за утре · \d+,\d\d €/);
});

test("pickup: states panel only in preview; busy and error states", async ({ page }) => {
  await page.goto("/vzemi-ot-myasto/");
  await expect(page.locator("[data-live][data-ready]")).toHaveCount(1);
  await expect(page.locator(".pk-proto")).toHaveCount(0);
  await open(page, "12:30");
  await page.locator('[data-sim="busy"]').click();
  await expect(page.locator(".pk-busy")).toBeVisible();
  await expect(page.locator(".pk-slot[disabled]").first()).toContainText("заето");
  await page.locator('[data-sim="error"]').click();
  await expect(page.locator(".sc-state[role=alert]")).toContainText("Не успяхме да заредим");
  await page.locator("[data-retry]").click();
  await expect(page.locator(".pk-asap")).toBeVisible();
});

test("pickup: no horizontal scroll at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, "16:30");
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  expect(w[0]).toBeLessThanOrEqual(w[1]);
  /* the hero column keeps the 16px gutter on both sides (minmax(0,1fr)) */
  const r = await page.evaluate(() => [".pk-copy", ".pk-live"].map((s) => { const b = document.querySelector(s)!.getBoundingClientRect(); return [b.left, b.right]; }));
  for (const [l, rt] of r) { expect(l).toBeGreaterThanOrEqual(15.5); expect(rt).toBeLessThanOrEqual(344.5); }
});
