import { test, expect, type Page } from "@playwright/test";

/* Delivery (/dostavka/): server HTML (SEO, zones from ZONES, [ЛИПСВА] fees, JSON-LD BreadcrumbList + FAQPage),
   the address check (zone, ask, outside, unknown, short), the map / table selection, the hour (12:30 delivery,
   21:30 pickup until 22:30, 23:30 tomorrow), simulated states only in preview, no horizontal scroll at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string, hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/dostavka/" + (t ? "?preview=1&t=" + t : "") + hash);
  await expect(page.locator("[data-dl][data-ready]")).toHaveCount(1);
}
async function check(page: Page, text: string) {
  await page.fill("#adr", text);
  await page.getByRole("button", { name: "Провери адреса" }).click();
}
const res = (page: Page) => page.locator("[data-res]");
const zcard = (page: Page) => page.locator("[data-zcard]");

test("delivery: SEO, zones and [ЛИПСВА] fees in the server HTML, JSON-LD", async ({ request }) => {
  const html = await (await request.get("/dostavka/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("<title>Доставка на храна в Дружба | Siracusa Bar &amp; Grill</title>");
  expect(html).toContain('rel="canonical"');
  expect(html).not.toMatch(/[—–]/);
  for (const z of ["Дружба 1", "Дружба 2", "НПЗ Искър", "Бусманци", "Горубляне", "Гара Искър"]) expect(html).toContain("<b>" + z + "</b>");
  expect(html.match(/data-pick="/g)?.length).toBe(6);
  expect(html.match(/\[ЛИПСВА: такса в €\]/g)!.length).toBeGreaterThanOrEqual(2);
  expect(html).not.toContain("Сега 12:00"); /* the server does not know the hour */
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const crumbs = ld.find((x) => x["@type"] === "BreadcrumbList");
  expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Доставка"]);
  expect(crumbs.itemListElement[1].item).toMatch(/\/dostavka\/$/);
  const faq = ld.find((x) => x["@type"] === "FAQPage");
  expect(faq.mainEntity.length).toBe(7);
  expect(JSON.stringify(faq)).not.toContain("ЛИПСВА");
  /* the fees are [ЛИПСВА]: no promise that the cart shows them; one payment answer for the group (RESTAURANT.payment) */
  expect(JSON.stringify(faq)).not.toContain("се вижда в количката");
  const pay = faq.mainEntity.find((q: { name: string }) => q.name === "Как мога да платя?");
  expect(pay.acceptedAnswer.text).toContain("карта при получаване (Visa, Mastercard)");
  expect(html).toContain("Не намерихте отговор? Обадете ни се, ще ви кажем.");
  expect(html).toContain("Обади се · 0894 36 55 77");
  expect(JSON.stringify(faq)).not.toContain("<");
});

test("delivery 12:30: address check, map and table select the zone", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  await expect(page.locator("[data-live]")).toContainText("Доставка сега");
  await expect(page.locator("[data-tl]")).toContainText("Сега 12:30");
  await expect(zcard(page)).toContainText("Дружба 2");

  await check(page, "");
  await expect(page.locator("#adrErr")).toHaveText("Напишете квартала си, например Дружба 2.");

  await check(page, "druzhba 1");
  await expect(res(page)).toContainText("Доставяме безплатно до Дружба 1");
  await expect(res(page).getByRole("link", { name: /Поръчай с безплатна доставка/ })).toHaveAttribute("href", /\/menu\/$/);
  await expect(zcard(page)).toContainText("Дружба 1");
  await expect(page.locator('[data-row="druzhba-1"] [data-pick]')).toHaveAttribute("aria-pressed", "true");

  await check(page, "Дружба");
  await expect(res(page)).toContainText("Дружба 1 или Дружба 2?");
  await res(page).getByRole("button", { name: "Дружба 2" }).click();
  await expect(res(page)).toContainText("Доставяме безплатно до Дружба 2");
  await expect(page.locator("#adr")).toHaveValue("Дружба 2");

  await check(page, "gorublqne");
  await expect(res(page)).toContainText("Доставяме до Горубляне по тарифа");
  await expect(res(page)).toContainText("[ЛИПСВА: такса в €]");

  await check(page, "Младост 1");
  await expect(res(page)).toContainText("Не доставяме до този адрес.");
  await expect(zcard(page)).toContainText("Извън зоните");

  await check(page, "ул. Обиколна 5");
  await expect(res(page)).toContainText("По улица и блок още не можем да проверим.");
  await res(page).getByRole("button", { name: "Моят квартал го няма" }).click();
  await expect(res(page)).toContainText("Не доставяме до този адрес.");

  /* table and map */
  await page.locator('[data-pick="gara-iskar"]').click();
  await expect(zcard(page)).toContainText("Гара Искър");
  await expect(zcard(page)).toContainText("По тарифа");
  await expect(page).toHaveURL(/#gara-iskar$/);
  await page.locator('[data-row="busmantsi"] [data-pick]').click();
  await expect(zcard(page)).toContainText("Бусманци");
  await expect(page.locator('[data-row="busmantsi"]')).toHaveClass(/on/);

  /* the address is remembered */
  await page.reload();
  await expect(page.locator("[data-dl][data-ready]")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("delivery 21:30 and 23:30: pickup until 22:30, then tomorrow", async ({ page }) => {
  const errors = watch(page);
  await open(page, "21:30", "#npz-iskar");
  await expect(page.locator("[data-live]")).toContainText("Утре доставяме от 10:00");
  await expect(zcard(page)).toContainText("НПЗ Искър");
  const go = zcard(page).getByRole("link", { name: /Вземи от място до 22:30/ });
  await expect(go).toHaveAttribute("href", /\/vzemi-ot-myasto\/$/);
  await expect(page.locator("[data-end]")).toContainText("Доставката приключи за днес.");
  await expect(page.locator("[data-tl]")).toContainText("Доставката приключи за днес · Вземане до 22:30.");
  await go.evaluate((a) => a.addEventListener("click", (e) => e.preventDefault()));
  await go.click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").mode)).toBe("pickup");

  await page.goto("/dostavka/?preview=1&t=23:30");
  await expect(page.locator("[data-dl][data-ready]")).toHaveCount(1);
  await expect(page.locator("[data-live]")).toContainText("Сега не доставяме · утре от 10:00");
  await expect(page.locator("[data-end]")).toContainText("Утре доставяме от 10:00.");
  await expect(zcard(page)).toContainText("утре от 10:00");
  expect(errors).toEqual([]);
});

test("delivery: simulated states only in preview, #adres= link", async ({ page }) => {
  await open(page, "12:30", "#greshka");
  await expect(res(page)).toContainText("Не успяхме да проверим адреса.");
  await res(page).getByRole("button", { name: "Опитай пак" }).click();
  await expect(res(page)).toContainText("Доставяме безплатно до Дружба 2");

  await page.goto("/dostavka/#adres=Busmantsi");
  await expect(page.locator("[data-dl][data-ready]")).toHaveCount(1);
  await expect(res(page)).toContainText("Доставяме безплатно до Бусманци");
});

test("delivery: no simulated error on the real site", async ({ page }) => {
  await open(page, undefined, "#greshka");
  await expect(res(page)).toBeEmpty();
  await expect(zcard(page)).toContainText("Дружба 2");
});

test("delivery: no horizontal scroll at 360, the zone card and the fees table fit (nothing cut)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await open(page, "12:30", "#gara-iskar");
  await check(page, "Дружба");
  const w = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(w).toBeLessThanOrEqual(360);
  /* every box of the card and the table ends at least 16px before the right edge (the gutter) */
  const over = await page.evaluate(() => [...document.querySelectorAll(".zcard, .zcard *, .fees, .fees *, .minline")]
    .filter((el) => el.getBoundingClientRect().right > 344.5).map((el) => el.className || el.tagName));
  expect(over).toEqual([]);
});

test("delivery: \"Натоварено\" from the kitchen adds the extra minutes everywhere", async ({ page }) => {
  await page.addInitScript(() => { try { sessionStorage.setItem("sc-kitchen", JSON.stringify({ at: Date.now(), k: { busy: true, etaMin: 35, etaBusyMin: 55 } })); } catch { /* ignore */ } });
  await open(page, "12:30");
  await expect(page.locator("[data-live]")).toContainText("Натоварено · 45 - 65");
  await expect(zcard(page)).toContainText("около 45");
  await expect(zcard(page)).toContainText("натоварено сега");
  await expect(page.locator('[data-eta="druzhba-1"]')).toContainText("около 50");
});
