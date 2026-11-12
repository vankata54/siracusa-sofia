import { test, expect, type Page } from "@playwright/test";

/* About (/za-nas/): server HTML (SEO, one h1, numbers counted from the menu, [ЛИПСВА] for history, team, photos, seats,
   parking; JSON-LD BreadcrumbList + AboutPage > Restaurant + FAQPage without [ЛИПСВА]), the hour (live row and closing
   action at 12:30 / 21:30 / 23:30), FAQ, links through the routes, no console errors, no horizontal scroll at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string) {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/za-nas/" + (t ? "?preview=1&t=" + t : ""));
  await expect(page.locator("[data-about][data-ready]")).toHaveCount(1);
}

test("about: SEO, numbers from the data, [ЛИПСВА], JSON-LD", async ({ request }) => {
  const html = await (await request.get("/za-nas/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("За нас: ресторант с градина в Дружба 2 | Siracusa Bar &amp; Grill");
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/za-nas\/">/);
  expect(html).not.toMatch(/[—–]/);
  expect(html).not.toContain("Само в прегледа");
  /* numbers: 124 dishes in 14 categories (breakfast is a separate menu), 15 pizzas, 11 from Bertha, 4 free zones */
  const nums = [...html.matchAll(/class="ab-n[^"]*"[^>]*>.*?<b>(\d+)<\/b>/g)].map((m) => +m[1]);
  expect(nums).toEqual([124, 14, 15, 11, 7, 4]);
  for (const miss of ["[ЛИПСВА: историята от собственика", "[ЛИПСВА: потвърждение на годината", "[ЛИПСВА: капацитет]", "[ЛИПСВА: снимки и имена на екипа", "[ЛИПСВА: паркиране]", "[ЛИПСВА: снимка на салона]"]) expect(html).toContain(miss);
  expect(html).not.toMatch(/Обедното меню днес/); /* the build does not know today's date */
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  expect(ld.find((x) => x["@type"] === "BreadcrumbList").itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "За нас"]);
  const about = ld.find((x) => x["@type"] === "AboutPage");
  expect(about.mainEntity).toMatchObject({ "@type": "Restaurant", name: "Siracusa Bar & Grill", telephone: "+359894365577" });
  expect(JSON.stringify(about)).not.toMatch(/foundingDate|seat|capacity|ЛИПСВА/i);
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  expect(faq.mainEntity.length).toBe(4);
  expect(JSON.stringify(faq)).not.toContain("ЛИПСВА");
});

test("about 12:30: open, order home, FAQ, links", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  await expect(page.locator("h1")).toHaveText("Вашият ресторант в Дружба 2");
  await expect(page.locator("[data-ab-live]")).toContainText("Отворено до 23:00");
  await expect(page.locator("[data-end-btn]")).toHaveText("Поръчай"); /* site.review-consistency В3 */
  await expect(page.locator("[data-end-btn]")).toHaveAttribute("href", /\/menu\/$/);
  await expect(page.locator(".ab-cta a").first()).toHaveAttribute("href", "/rezervatsia/");
  /* FAQ: the first one is open, the others open on click */
  const q = page.locator(".ab-faq details");
  await expect(q).toHaveCount(6);
  await expect(q.first()).toHaveAttribute("open", "");
  await q.nth(4).locator("summary").click();
  await expect(q.nth(4)).toContainText("[ЛИПСВА: паркиране]");
  /* every link inside the page goes through the routes (no prototype .html) */
  const hrefs = await page.locator("[data-about] a").evaluateAll((as) => as.map((a) => a.getAttribute("href") || ""));
  expect(hrefs.filter((h) => /\.html/.test(h))).toEqual([]);
  expect(errors).toEqual([]);
});

test("about 21:30 and 23:30: the closing action follows the hour", async ({ page }) => {
  await open(page, "21:30");
  await expect(page.locator("[data-ab-live]")).toContainText("Доставката приключи за днес");
  await expect(page.locator("[data-end-btn]")).toHaveText("Поръчай за вземане");
  await expect(page.locator("[data-end-btn]")).toHaveAttribute("href", "/vzemi-ot-myasto/");
  await open(page, "23:30");
  await expect(page.locator("[data-ab-live]")).toContainText("Затворено");
  await expect(page.locator("[data-end-btn]")).toHaveText("Поръчай за утре");
  await expect(page.locator("[data-end-text]")).toContainText("Приемаме поръчки утре от 10:00");
});

test("about: no horizontal scroll at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});
