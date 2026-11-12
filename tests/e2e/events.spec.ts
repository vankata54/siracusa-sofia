import { test, expect, type Page } from "@playwright/test";

/* Events (/sabitia/): server HTML (SEO, Гръцка вечер, honest "Скоро" cards, JSON-LD Event without a price),
   tabs and chips in the address, private occasions -> /praznik/#<type>, subscribe through api.subscribe with the
   consent unchecked, the states panel only in preview. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, q = "", hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/sabitia/" + q + hash);
  await expect(page.locator("[data-list][data-ready]")).toHaveCount(1);
}

test("events: SEO, server HTML, JSON-LD", async ({ request }) => {
  const html = await (await request.get("/sabitia/")).text();
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Събития и поводи | Siracusa Bar &amp; Grill");
  expect(html).toContain("Гръцка вечер");
  expect(html).toContain('href="/sabitia/gratska-vecher/"');
  expect(html).toContain("Празник при нас");
  expect(html).toContain('href="/praznik/#rozhden-den"');
  expect(html).not.toContain("Само в прегледа");
  expect(html).not.toContain("Само в прегледа");
  /* one calendar in the HTML (it was drawn twice), the table drawing is a separate file */
  expect(html.match(/class="shell calbox"/g)?.length).toBe(1);
  expect(html).not.toContain("<svg class=\"tbl\"");
  expect(html.length).toBeLessThan(75_000);
  /* heading order: an h2 before the cards (h3) */
  expect(html.indexOf("data-list-h")).toBeLessThan(html.indexOf('id="t-gratska-vecher"'));
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)].flatMap((m) => JSON.parse(m[1]));
  const ev = ld.filter((x) => x["@type"] === "Event");
  expect(ev).toHaveLength(1);
  expect(ev[0].name).toBe("Гръцка вечер");
  expect(ev[0].startDate).toMatch(/^\d{4}-\d{2}-\d{2}T19:00:00\+0[23]:00$/);
  expect(ev[0].offers).toBeUndefined();
  expect(ev[0].endDate).toBeUndefined();
  expect(ld.find((x) => x["@type"] === "BreadcrumbList").itemListElement[1].name).toBe("Събития и поводи");
  expect(JSON.stringify(ld.find((x) => x["@type"] === "FAQPage"))).not.toContain("ЛИПСВА");
});

test("events: tabs, chips, occasion panel, address", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("#ev-gratska-vecher .pill-red")).toHaveAttribute("href", /\/rezervatsia\/#\d{4}-\d{2}-\d{2}$/);
  await expect(page.locator(".ev.soon")).toHaveCount(4);
  await page.locator('.evchips [data-cat="zhiva-muzika"]').click();
  await expect(page).toHaveURL(/#zhiva-muzika$/);
  await expect(page.locator("[data-list] .ev")).toHaveCount(1);
  await page.locator('.evchips [data-cat="rozhdeni-dni"]').click();
  await expect(page.locator(".occ .go")).toHaveAttribute("href", "/praznik/#rozhden-den");
  await page.locator('[data-tab="past"]').click();
  await expect(page).toHaveURL(/#minali\/rozhdeni-dni$/);
  await expect(page.locator(".gal .gtile")).toHaveCount(1);
  await page.reload();
  await expect(page.locator('[data-tab="past"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('.evchips [data-cat="rozhdeni-dni"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#praznik").scrollIntoViewIfNeeded();
  await expect(page.locator("#praznik .party")).toBeVisible();
  await expect(page.locator("#praznik [data-art] svg.tbl")).toHaveCount(1);
  /* the one calendar: under the list on a phone, beside it on a computer */
  const wide = (page.viewportSize()?.width || 0) >= 900;
  await expect(page.locator((wide ? ".hcal" : "#kalendar") + " [data-cal] .calbox")).toHaveCount(1);
  await expect(page.locator("[data-cal]")).toHaveCount(1);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(over).toBe(false);
  expect(errors).toEqual([]);
});

test("events: subscribe, consent unchecked, errors, success", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.locator('.ev.soon [data-notify="Жива музика"]').click();
  await expect(page.locator('[data-want="Жива музика"]')).toHaveAttribute("aria-pressed", "true");
  const ok = page.locator("#sub-ok");
  await expect(ok).not.toBeChecked();
  await page.locator("[data-subform] [type=submit]").click();
  await expect(page.locator("#sub-email-err")).toBeVisible();
  await expect(page.locator("#sub-ok-err")).toBeVisible();
  await page.locator("#sub-email").fill("test" + Date.now() + "@primer.bg");
  await ok.check();
  await page.locator("[data-subform] [type=submit]").click();
  /* the success text comes from the saved subscription: its topics are what api.subscribe stored */
  await expect(page.locator(".sub-ok")).toContainText("ново събитие в: Жива музика");
  expect(errors).toEqual([]);
});

test("events: states panel only in preview", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-mode]")).toHaveCount(0);
  await page.goto("/sabitia/?preview=1");
  await expect(page.locator(".proto")).toContainText("Само в прегледа: състояния");
  await page.locator('[data-mode="error"]').click();
  await expect(page.locator("[data-retry]")).toBeVisible();
  await page.locator("[data-retry]").click();
  await expect(page.locator("#ev-gratska-vecher")).toBeVisible();
  await page.locator('[data-mode="none"]').click();
  await expect(page.locator(".ev-empty")).toContainText("Засега няма обявени събития");
});
