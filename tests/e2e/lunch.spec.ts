import { test, expect, type Page } from "@playwright/test";

/* Lunch menu (/obedno-menu/): server HTML (SEO, every dish, JSON-LD Menu/MenuSection/MenuItem), the hour
   (delivery or pickup until 15:00, -30% pickup only until 22:30, closed before 10:00 / after 22:30), the cart bar,
   "Изчерпано днес" and the states panel only in preview, never "днес" when the menu is for another date. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string, hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/obedno-menu/" + (t ? "?preview=1&t=" + t : "") + hash);
  await expect(page.locator("[data-lunch][data-ready]")).toHaveCount(1);
}
const rows = (page: Page) => page.locator("[data-list] .lrow");
const isToday = (page: Page) => page.evaluate(() => (window as unknown as { SC: { lunchIsToday: () => boolean } }).SC.lunchIsToday());

test("lunch: SEO, every dish in the server HTML, JSON-LD", async ({ request }) => {
  const html = await (await request.get("/obedno-menu/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html.match(/class="lrow[ "]/g)?.length).toBe(20);
  expect(html).toContain("Обедно меню | Siracusa Bar &amp; Grill");
  expect(html).toContain("Меню за понеделник, 2 ноември");
  expect(html).not.toMatch(/днес/i); /* the build does not know today's date */
  expect(html).not.toContain("Само в прототипа");
  expect(html).not.toMatch(/[—–]/);
  expect(html).toContain("[ЛИПСВА: меню за вторник]");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const menu = ld.find((x) => x["@type"] === "Menu");
  expect(menu.hasMenuSection.map((s: { name: string }) => s.name)).toEqual(["Супи", "Салати", "Скара на дървени въглища", "Основни", "Десерти"]);
  const all = menu.hasMenuSection.flatMap((s: { hasMenuItem: object[] }) => s.hasMenuItem);
  expect(all).toHaveLength(20);
  expect(all[0]).toMatchObject({ "@type": "MenuItem", name: "Супа топчета", offers: { price: "2.40", priceCurrency: "EUR" } });
  expect(ld.find((x) => x["@type"] === "BreadcrumbList").itemListElement[1].name).toBe("Обедно меню");
  expect(JSON.stringify(ld.find((x) => x["@type"] === "FAQPage"))).not.toContain("ЛИПСВА");
});

test("lunch 12:30: delivery or pickup, add, order bar, sold out mock in preview", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  const today = await isToday(page);
  await expect(page.locator("h1 .eb")).toHaveText(today ? "Обедно меню · днес" : "Обедно меню");
  if (!today) await expect(page.locator("main")).not.toContainText("Днес");
  await expect(page.locator(".today .now-h")).toContainText("Сега: доставка и вземане");
  await expect(page.locator(".deal")).toHaveCount(0);
  await expect(page.locator("[data-modeinfo]")).toContainText("Доставка за около");
  await page.locator('[data-mode="pickup"]').click();
  await expect(page.locator("[data-modeinfo]")).toContainText("Готово веднага след поръчката");
  await expect(rows(page)).toHaveCount(20);
  /* "Изчерпано днес": visible, last in "Основни", without "+" (preview mock) */
  const out = page.locator("#g-osnovni .lrow").last();
  await expect(out).toContainText("Телешко със спанак и ориз");
  await expect(out).toContainText("Изчерпано днес");
  await expect(out.locator(".plus")).toHaveCount(0);
  /* order bar */
  const bar = page.locator("[data-abar]");
  await expect(bar).toContainText("Поръчай обедно меню");
  await page.locator('#g-supi [data-add="l-supa-topcheta"]').click();
  await expect(bar).toContainText("1 ястие");
  await expect(bar.locator("a")).toHaveText("Поръчай · 2,40 €");
  /* states panel only in preview */
  await page.locator('[data-demos] [data-demo="error"]').click();
  await expect(page.locator("[data-list]")).toContainText("Не успяхме да заредим обедното меню");
  await expect(bar).toBeHidden();
  await page.locator('[data-list] [data-demo=""]').click();
  await expect(rows(page)).toHaveCount(20);
  expect(errors).toEqual([]);
});

test("lunch 16:30: -30% pickup only, old price struck, cart switches to pickup", async ({ page }) => {
  const errors = watch(page);
  await open(page, "16:30");
  await expect(page.locator(".deal")).toContainText("-30%");
  await expect(page.locator(".deal")).toContainText("при вземане от място");
  await expect(page.locator("[data-mode]")).toHaveCount(0);
  const soup = page.locator("#g-supi .lrow").first();
  await expect(soup.locator(".old")).toContainText("2,40 €");
  await expect(soup.locator(".price")).toHaveText("1,68 €");
  await expect(soup.locator(".old")).toHaveCSS("text-decoration-line", "line-through");
  await page.locator('[data-add="l-supa-topcheta"]').click();
  await expect(page.locator("[data-abar] a")).toHaveText("Вземи от място · 1,68 €");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").mode)).toBe("pickup");
  expect(errors).toEqual([]);
});

test("lunch 08:30 and 23:30: closed, list for reference without '+'", async ({ page }) => {
  await open(page, "23:30");
  await expect(page.locator(".today .now-h")).toContainText("Обедното меню е от 10:00 до 15:00");
  await expect(page.locator(".tmrw")).toContainText("[ЛИПСВА: утрешното меню");
  await expect(rows(page)).toHaveCount(20);
  await expect(page.locator("[data-list] .plus")).toHaveCount(0);
  await expect(page.locator("[data-abar]")).toBeHidden();
  await open(page, "08:30");
  await expect(page.locator(".today .sub")).toContainText("Отваряме в 10:00");
  await expect(page.locator("[data-list] .plus")).toHaveCount(0);
});

test("lunch: real page (no preview) has no mock and no states panel", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("main")).not.toContainText("Изчерпано днес");
  await expect(page.locator(".proto")).toHaveCount(0);
  if (!(await isToday(page))) {
    await expect(page.locator("h1")).toContainText("Меню за");
    await expect(page.locator("[data-list] .plus")).toHaveCount(0); /* a menu for another date is not orderable */
  }
  expect(errors).toEqual([]);
});

test("lunch: no horizontal scroll on 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const t of ["12:30", "16:30", "23:30"]) {
    await open(page, t);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
