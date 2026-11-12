import { test, expect, type Page } from "@playwright/test";

/* Contacts (/kontakti/): server HTML (SEO, one h1, facts only from RESTAURANT, [ЛИПСВА] for parking and the rest,
   JSON-LD BreadcrumbList + ContactPage > Restaurant + FAQPage without [ЛИПСВА]), the hour (main action, live "Днес" card,
   today highlighted in the week table at 12:30 / 21:30 / 23:30), copy, the map on tap, the feedback form (empty submit,
   wrong phone, success, "Напиши ново съобщение"), no console errors, no horizontal scroll at 360. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t?: string, hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/kontakti/" + (t ? "?preview=1&t=" + t : "") + hash);
  await expect(page.locator("[data-contacts][data-ready]")).toHaveCount(1);
}

test("contacts: SEO, facts from RESTAURANT, [ЛИПСВА], JSON-LD", async ({ request }) => {
  const html = await (await request.get("/kontakti/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("<title>Контакти | Siracusa Bar &amp; Grill</title>");
  expect(html).toMatch(/<link rel="canonical" href="[^"]*\/kontakti\/">/);
  expect(html).not.toMatch(/[—–]/);
  expect(html).not.toMatch(/\.html["#]/);
  for (const s of ['href="tel:+359894365577"', 'href="tel:+35970019955"', 'href="mailto:menu@siracusa-sofia.com"', "https://www.facebook.com/BarGrillSiracusa"]) expect(html).toContain(s);
  for (const miss of ["[ЛИПСВА: има ли места пред ресторанта и колко]", "[ЛИПСВА: паркиране пред ресторанта]", "[ЛИПСВА: профил в Instagram]", "[ЛИПСВА: статична карта Google]", "[ЛИПСВА: работно време в празнични дни]"]) expect(html).toContain(miss);
  /* the server does not know the date: no "today" in the table */
  expect(html).not.toContain('aria-current="date"');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  expect(ld.find((x) => x["@type"] === "BreadcrumbList").itemListElement.map((i: { name: string }) => i.name)).toEqual(["Начало", "Контакти"]);
  const cp = ld.find((x) => x["@type"] === "ContactPage");
  expect(cp.mainEntity).toMatchObject({ "@type": "Restaurant", name: "Siracusa Bar & Grill", telephone: "+359894365577", email: "menu@siracusa-sofia.com" });
  expect(cp.mainEntity.address).toMatchObject({ streetAddress: "ж.к. Дружба 2, срещу бл. 311", postalCode: "1582", addressLocality: "София" });
  expect(JSON.stringify(ld)).not.toMatch(/ЛИПСВА|parking|seat/i);
  expect(ld.find((x) => x["@type"] === "FAQPage").mainEntity.length).toBe(3);
});

test("contacts 12:30: open, call first, today highlighted, copy, map", async ({ page, context }) => {
  const errors = watch(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await open(page, "12:30");
  await expect(page.locator("h1")).toHaveText("Контакти");
  await expect(page.locator("[data-cta] .pill-red")).toContainText("Обади се · 0894 36 55 77");
  await expect(page.locator("[data-today] .h3")).toHaveText("Отворено сега");
  await expect(page.locator("[data-today] .nowchip")).toHaveText("Сега · 12:30");
  const today = page.locator(".ct-week tr.today");
  await expect(today).toHaveCount(1);
  await expect(today).toHaveAttribute("aria-current", "date");
  await expect(today).toContainText("Днес");
  const day = await page.evaluate(() => new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", weekday: "long" }).format(new Date()));
  await expect(today.locator("th")).toContainText(day, { ignoreCase: true });
  /* copy */
  await page.locator('.ct-row button[data-copy="0894 36 55 77"]').click();
  await expect(page.locator(".toast")).toContainText("Номерът е копиран");
  /* map: the iframe loads only on tap (no network to Google in the test: abort it) */
  await page.route(/google\.com\/maps/, (r) => r.abort());
  await page.locator("[data-mapgo]").click();
  await expect(page.locator("[data-map] iframe, [data-map] .ct-mapstate").first()).toBeVisible();
  expect(errors.filter((e) => !/google|ERR_FAILED|net::/i.test(e))).toEqual([]);
});

test("contacts 21:30 and 23:30: status and main action follow the hour", async ({ page }) => {
  await open(page, "21:30");
  await expect(page.locator("[data-today] .sub")).toContainText("Доставката приключи за днес");
  await expect(page.locator("[data-cta] .pill-red")).toContainText("Обади се");
  await open(page, "23:30");
  await expect(page.locator("[data-today] .h3")).toHaveText("Затворено сега");
  await expect(page.locator("[data-cta] .pill-red")).toHaveText("Пишете ни");
  await expect(page.locator("[data-heronote]")).toContainText("Сега сме затворени");
  await expect(page.locator(".ct-week .chip-s", { hasText: "Утре" })).toHaveCount(1);
});

test("contacts: feedback form, validation and success", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30");
  const send = page.locator("[data-send]");
  await send.click();
  await expect(page.locator("#e-name")).toContainText("Напишете името си.");
  await expect(page.locator("#e-contact")).toContainText("Напишете телефон");
  await expect(page.locator("#e-msg")).toContainText("Напишете съобщението си.");
  await expect(page.locator("#f-name")).toBeFocused();
  await page.locator("#f-name").fill("Мария Петрова");
  await page.locator("#f-contact").fill("0888 12345");
  await page.locator("#f-msg").fill("Имате ли места в събота вечер?");
  await send.click();
  await expect(page.locator("#e-contact")).toContainText("10 цифри");
  await page.locator("#f-contact").fill("0888 12 34 56");
  await page.locator("[data-topics] .chip", { hasText: "Въпрос" }).click();
  await send.click();
  const ok = page.locator("[data-ok]");
  await expect(ok).toBeVisible({ timeout: 5000 });
  await expect(ok.locator("h3")).toHaveText("Благодарим, Мария!");
  await expect(ok).toContainText("Ще ви се обадим на 0888 12 34 56");
  await expect(ok.locator(".quote")).toContainText("Имате ли места в събота вечер?");
  await ok.locator("[data-again]").click();
  await expect(page.locator("#f-msg")).toHaveValue("");
  await expect(page.locator("#f-name")).toHaveValue("Мария Петрова");
  /* e-mail mode */
  await page.locator('[data-mode="email"]').click();
  await expect(page.locator("#f-contact")).toHaveAttribute("placeholder", "ime@primer.bg");
  expect(errors).toEqual([]);
});

test("contacts: no horizontal scroll at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over).toBeLessThanOrEqual(0);
});
