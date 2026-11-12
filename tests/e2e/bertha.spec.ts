import { test, expect, type Page } from "@playwright/test";

/* Bertha (/furna-bertha/): server HTML (SEO, the dishes of "Скара Bertha" with "+", FAQ, JSON-LD BreadcrumbList and
   FAQPage), the hour in the service note, the diagram (steps, "Пауза"), "+" to the cart without the menu chunk,
   the states panel only in preview, offline, no horizontal scroll. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string, hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/furna-bertha/" + (t ? "?preview=1&t=" + t : "") + hash);
  await expect(page.locator("#yastia[data-ready]")).toHaveCount(1);
}
const svc = (page: Page) => page.locator("[data-svc] > *");

test("bertha: SEO, dishes in the server HTML, JSON-LD, no invented facts", async ({ request }) => {
  const html = await (await request.get("/furna-bertha/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Фурната Bertha: скара на дървени въглища | Siracusa Bar &amp; Grill");
  expect(html).toContain('rel="canonical" href="https://siracusa-sofia.com/furna-bertha/"');
  const grid = html.split('id="yastia"')[1].split("Отвори категорията")[0];
  expect(grid.match(/class="dcard"/g)?.length).toBe(11);
  expect(grid.match(/data-add="[^"]+" data-p="[\d.]+"/g)?.length).toBe(10); /* the sold out one has no "+" */
  expect(grid.indexOf("Свински ребра")).toBeLessThan(grid.indexOf("Кебапчета")); /* hit first */
  expect(grid.lastIndexOf("Изчерпано днес")).toBeGreaterThan(grid.indexOf("Рибай")); /* sold out last */
  expect(html).toContain("[ЛИПСВА: модел на фурната]");
  expect(html).not.toContain("Само в прегледа");
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Фурната Bertha"]);
  expect(crumbs.itemListElement[1].item).toBe("https://siracusa-sofia.com/furna-bertha/");
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  expect(faq.mainEntity).toHaveLength(6);
  expect(JSON.stringify(faq)).not.toContain("ЛИПСВА");
});

test("bertha 12:30: no pizza claim, CTA to the dishes, + to the cart, delivery note", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  await expect(page.locator("main")).not.toContainText(/пиц/i); /* OPEN-QUESTIONS 22 */
  await expect(svc(page)).toContainText("Доставка: около 35 мин");
  await page.locator(".hero [data-to=yastia]").click();
  await expect(page.locator("#h-dish")).toBeInViewport();
  await page.locator('#yastia [data-add="kebapcheta"]').click();
  await expect(page.locator("[data-cartnav] [data-cnt]").first()).toHaveText("1");
  const cart = await page.evaluate(() => localStorage.getItem("sc-cart") || "");
  expect(cart).toContain("kebapcheta");
  await page.locator('[data-sides] [data-add]').first().click();
  await expect(page.locator("[data-cartnav] [data-cnt]").first()).toHaveText("2");
  expect(errors).toEqual([]);
});

for (const [t, txt] of [["21:30", "Вземане до 22:30"], ["22:45", "Кухнята затвори за днес"], ["08:30", "Кухнята още не е отворила"]]) {
  test("bertha " + t + ": service note", async ({ page }) => {
    const errors = watch(page);
    await open(page, t);
    await expect(svc(page)).toContainText(txt);
    expect(errors).toEqual([]);
  });
}

test("bertha: diagram steps and pause", async ({ page }) => {
  await open(page, "12:30");
  const play = page.locator("[data-play]");
  await expect(play).toHaveAccessibleName("Пауза на анимацията");
  await page.locator(".step[data-step='3']").click();
  await expect(page.locator(".stage")).toHaveAttribute("data-step", "3");
  await expect(page.locator(".step[data-step='3']")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".step[aria-pressed='true']")).toHaveCount(1);
  await expect(play).toHaveText("Пусни");
  await play.click();
  await expect(play).toHaveText("Пауза");
  const box = await play.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
});

test("bertha: preview panel states (error, retry) and real offline", async ({ page, context }) => {
  await open(page);
  await expect(page.locator("[data-pv]")).toHaveCount(0);
  await open(page, "12:30");
  await page.locator('[data-demo="error"]').click();
  await expect(page.locator("[data-dishes] [role=alert]")).toContainText("Не успяхме да заредим ястията");
  await page.locator("[data-retry]").click();
  await expect(page.locator("[data-dishes] .dcard")).toHaveCount(11);
  await page.locator('[data-demo="loading"]').click();
  await expect(page.locator("[data-dishes] .skcard")).toHaveCount(4);
  await page.locator('[data-demo=""]').click();
  await context.setOffline(true);
  await expect(svc(page)).toContainText("Няма връзка с интернет");
  await context.setOffline(false);
  await expect(svc(page)).toContainText("Доставка");
});

test("bertha 360: no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page, "12:30");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
