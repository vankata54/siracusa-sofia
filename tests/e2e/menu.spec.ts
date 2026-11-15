import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* Menu (/menu/): all dishes in the server HTML, JSON-LD, filters, allergens, search, scrollspy, breakfast by the hour,
   the address keeps the choice, "+" shows the order bar. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t = "12:30", hash = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/menu/?preview=1&t=" + t + hash);
}
const visibleCards = (page: Page) => page.locator("[data-results] .mcat:not([hidden]) .dcard");

test("menu: SEO, all 127 dishes in the server HTML, JSON-LD Menu", async ({ request }) => {
  const html = await (await request.get("/menu/")).text();
  expect(html.match(/class="dcard"/g)?.length).toBe(127);
  expect(html.match(/<h1[\s>]/g)?.length).toBe(1);
  expect(html).toContain("Пица Капричоза");
  expect(html).not.toMatch(/[—–]/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
  const menu = ld.find((x) => x["@type"] === "Menu");
  expect(menu.hasMenuSection).toHaveLength(15);
  const all = menu.hasMenuSection.flatMap((s: { hasMenuItem: unknown[] }) => s.hasMenuItem);
  expect(all).toHaveLength(127);
  const pizza = all.find((x: { name: string }) => x.name === "Пица Маргарита");
  expect(pizza.offers.priceCurrency).toBe("EUR");
  expect(pizza.description).toBeTruthy();
  expect(ld.find((x) => x["@type"] === "BreadcrumbList")).toBeTruthy();
  /* the whole menu owns /menu/#menu; sold out is the same schema.org value as on the category and the dish */
  expect(menu["@id"]).toMatch(/\/menu\/#menu$/);
  const out = all.find((x: { name: string }) => x.name === "Плескавица");
  expect(out.offers.availability).toBe("https://schema.org/SoldOut");
});

test("menu: filters, allergens and search are kept in the address", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("h1")).toHaveText("Меню");
  await expect(visibleCards(page)).toHaveCount(124);
  await expect(page.locator("[data-count]")).toContainText("124 ястия");
  /* filter chip */
  await page.locator('[data-fchips] [data-f="veg"]').click();
  await expect(page).toHaveURL(/#f=veg$/);
  await expect(page.locator("[data-count]")).toContainText("Показваме");
  const nVeg = await visibleCards(page).count();
  expect(nVeg).toBeGreaterThan(0);
  expect(nVeg).toBeLessThan(124);
  /* allergen sheet */
  await page.locator('[data-sheet="al"]').click();
  await page.locator('.sheetwrap.on label:has(input[data-al="milk"])').click();
  await expect(page.locator('.sheetwrap.on input[data-al="milk"]')).toBeChecked();
  await expect(page.locator(".sheetwrap.on [data-shgo]")).toContainText("Покажи");
  await page.locator(".sheetwrap.on [data-shgo]").click();
  await expect(page).toHaveURL(/f=veg&a=milk/);
  await expect(page.locator('[data-sheet="al"] .dot')).toHaveText("1");
  /* clear, then search in Latin with a typo */
  await page.locator(".mstat [data-clearall]").click();
  await page.locator("#mq").fill("kebapceta");
  await expect(page.locator("[data-count]")).toContainText("Намерихме");
  await expect(visibleCards(page).first()).toContainText("Кебапчета");
  await expect(page).toHaveURL(/q=kebapceta/);
  /* nothing found: the empty state */
  await page.locator("#mq").fill("жжжжжжж");
  await expect(page.locator(".mempty")).toContainText("Не намерихме");
  await page.locator(".mempty [data-qclear]").click();
  await expect(visibleCards(page)).toHaveCount(124);
  /* reload keeps the address */
  await page.goto("/menu/?preview=1&t=12:30#f=veg.hot");
  await expect(page.locator('[data-f="hot"]').first()).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("menu: empty state with filters and a remove chip per filter", async ({ page }) => {
  await open(page, "12:30", "#f=veg.hot.bertha");
  await expect(page.locator(".mempty")).toContainText("Няма ястия с тези филтри");
  await page.locator(".mempty [data-clearall]").click();
  await expect(visibleCards(page)).toHaveCount(124);
});

test("menu: category navigation and scrollspy", async ({ page, isMobile }) => {
  const errors = watch(page);
  await open(page);
  const nav = isMobile ? page.locator("[data-catscroll]") : page.locator("[data-slist]");
  await nav.locator('[data-go="pitsi"]').click();
  await expect(page).toHaveURL(/#pitsi$/);
  await expect(nav.locator('[data-go="pitsi"]')).toHaveAttribute("aria-current", "true");
  await expect.poll(() => page.locator("#c-pitsi").evaluate((el) => Math.round(el.getBoundingClientRect().top)), { timeout: 5000 }).toBeLessThan(220);
  const top = await page.locator("#c-pitsi").evaluate((el) => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThan(60);
  /* lazy illustrations are drawn near the viewport */
  await expect(page.locator("#c-pitsi .pic svg").first()).toBeAttached();
  /* opened with a category in the address */
  await open(page, "12:30", "#deserti");
  await expect(nav.locator('[data-go="deserti"]')).toHaveAttribute("aria-current", "true");
  expect(errors).toEqual([]);
});

test("menu: breakfast by the hour", async ({ page }) => {
  await open(page, "10:30", "#zakuski");
  await expect(page.locator('.mseg [data-menu="bf"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-notices]")).toContainText("Закуски всеки ден до 11:30");
  await expect(visibleCards(page)).toHaveCount(3);
  await expect(visibleCards(page).locator("[data-add]")).toHaveCount(3);
  await open(page, "12:30", "#zakuski");
  await expect(page.locator("[data-notices]")).toContainText("Закуските свършиха за днес");
  await expect(visibleCards(page).locator("[data-add]")).toHaveCount(0);
  await expect(visibleCards(page).first()).toContainText("утре");
  await page.locator('[data-notices] [data-menu="main"]').click();
  await expect(visibleCards(page)).toHaveCount(124);
  /* after the kitchen closes */
  await open(page, "23:30");
  await expect(page.locator("[data-notices]")).toContainText("Кухнята затвори за днес"); /* the one hour note (lib/ui.ts) */
  await expect(page.locator("[data-eta]")).toBeHidden();
});

test("menu: + adds to the cart and shows the order bar; no overflow at 360", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 360, height: 780 });
  await open(page);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(360);
  await visibleCards(page).first().locator("[data-add]").click();
  await expect(page.locator("[data-cnt]").first()).toHaveText("1");
  await expect(page.locator(".cbar")).toHaveClass(/on/);
  await expect(page.locator(".cbar [data-cgo]")).toContainText("Поръчай ·");
  expect(errors).toEqual([]);
  await expect(page.locator(".cbar [data-cgo]")).toHaveAttribute("href", /\/kolichka\//);
});

/* ---------- search (decision 15.11.2026: one search; by name on top, the band „Съдържат ...“, „без ...“, chips) ---------- */
const group = (page: Page, id: string) => page.locator("#c-q-" + id);
const names = (page: Page, id: string) => group(page, id).locator(".dcard .nm").allTextContents();

test("menu search: „лук“ finds Луканка by name, the band „Съдържат лук“ below, no repeats, the navigation lists the groups", async ({ page, isMobile }) => {
  const errors = watch(page);
  await open(page, "12:30", "#q=" + encodeURIComponent("лук"));
  await expect(group(page, "name")).toBeVisible();
  const top = await names(page, "name");
  expect(top).toContain("Луканка");
  expect(top).toContain("Пица с луканка");
  /* the band is the heading of its group (an h2 with its count), not only a colour */
  await expect(group(page, "comp").locator("h2.sband")).toContainText("Съдържат лук");
  await expect(group(page, "comp")).toHaveAttribute("aria-labelledby", "h-q-comp");
  const below = await names(page, "comp");
  expect(below.length).toBeGreaterThan(5);
  expect(below).not.toContain("Сет от български колбаси");
  expect(below).not.toContain("Пица с луканка");
  expect(below.filter((n) => top.indexOf(n) > -1)).toEqual([]);
  /* no category sections while searching; „лук“ alone has no „без ...“, so no group without composition */
  await expect(page.locator("[data-results] .mcat:not(.qgrp)")).toHaveCount(0);
  await expect(group(page, "unknown")).toHaveCount(0);
  /* the count is in the live line */
  await expect(page.locator("[data-count]")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("[data-count]")).toContainText("Намерихме " + (top.length + below.length) + " ястия");
  const nav = isMobile ? page.locator("[data-catscroll]") : page.locator("[data-slist]");
  await expect(nav.locator('[data-go="q-comp"]')).toContainText("Съдържат лук");
  expect(errors).toEqual([]);
});

test("menu search: English „onion“ and „gluten“", async ({ page }) => {
  await open(page, "12:30", "#q=onion");
  await expect(group(page, "comp").locator(".sband")).toContainText("Съдържат лук");
  expect(await names(page, "comp")).not.toContain("Пица с луканка");
  await expect(page.locator('[data-qchips] [data-qtoggle="onion"]')).toHaveText("лук");
  await page.locator("#mq").fill("gluten");
  await expect(group(page, "comp").locator(".sband")).toContainText("Съдържат глутен");
  expect((await names(page, "comp")).length).toBeGreaterThan(3);
  await expect(page.locator('[data-qchips] [data-qtoggle="gluten"]')).toHaveText("глутен");
});

test("menu search: „без глутен“ never lists a dish without composition; they are apart at the bottom", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30", "#q=" + encodeURIComponent("без глутен"));
  const res = page.locator("[data-results]");
  await expect(group(page, "unknown")).toBeVisible();
  /* the group is the last one, with the one phrase as its heading */
  await expect(res.locator(":scope > section").last()).toHaveId("c-q-unknown");
  await expect(group(page, "unknown").locator("h2")).toContainText("Нямаме пълен състав, попитайте ни");
  await expect(group(page, "unknown")).toContainText("Не знаем дали съдържат глутен");
  /* every dish above it has a composition line and no gluten chip-filter can let a dish without one through */
  const above = res.locator(".mcat:not(.q-unknown) .dcard");
  const n = await above.count();
  expect(n).toBeGreaterThan(5);
  await expect(above.locator(".cp")).toHaveCount(n);
  expect(await group(page, "unknown").locator(".dcard .cp").count()).toBe(0);
  await expect(page.locator("[data-count]")).toContainText("без пълен състав най-долу");
  expect(errors).toEqual([]);
});

test("menu search: the chip switches „глутен“ ↔ „без глутен“ in the field and the address; one clear button", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.locator("#mq").fill("глутен");
  const chip = page.locator('[data-qchips] [data-qtoggle="глутен"]');
  await expect(chip).toHaveText("глутен");
  await expect(chip).toHaveAttribute("aria-pressed", "false");
  await chip.click();
  await expect(page.locator("#mq")).toHaveValue("без глутен");
  await expect(page).toHaveURL(/#q=%D0%B1%D0%B5%D0%B7%20%D0%B3%D0%BB%D1%83%D1%82%D0%B5%D0%BD$/);
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  await expect(chip).toHaveText("без глутен");
  await expect(chip).toBeFocused(); /* the focus is not lost */
  await expect(group(page, "unknown")).toBeVisible();
  await chip.click();
  await expect(page.locator("#mq")).toHaveValue("глутен");
  await expect(group(page, "comp").locator(".sband")).toContainText("Съдържат глутен");
  /* exactly one clear button in the field: ours, never the browser's own one */
  await expect(page.locator(".sbox button:visible")).toHaveCount(1);
  expect(await page.locator("#mq").evaluate((i) => getComputedStyle(i, "::-webkit-search-cancel-button").webkitAppearance)).toBe("none");
  await page.locator(".sbox [data-qclear]").click();
  await expect(page.locator("#mq")).toHaveValue("");
  await expect(page.locator("#mq")).toBeFocused();
  await expect(page.locator("[data-qchips]")).toBeHidden();
  await expect(visibleCards(page)).toHaveCount(124);
  expect(errors).toEqual([]);
});

test("menu search: the filters and the ticked allergens apply together with the search", async ({ page }) => {
  await open(page, "12:30", "#q=" + encodeURIComponent("лук"));
  const all = await page.locator("[data-results] .dcard").count();
  await page.locator('[data-fchips] [data-f="veg"]').click();
  await expect(page).toHaveURL(/f=veg&q=/);
  await expect.poll(() => page.locator("[data-results] .dcard").count()).toBeLessThan(all);
  expect(await page.locator("[data-results] .dcard").count()).toBeGreaterThan(0);
  await expect(page.locator("#mq")).toHaveValue("лук");
  await page.goto("/menu/?preview=1&t=12:30#a=milk&q=" + encodeURIComponent("лук"));
  await expect(page.locator("[data-results] .dcard", { hasText: "Пица с луканка" })).toHaveCount(0);
  await expect(page.locator("[data-results] .dcard", { hasText: "Луканка" }).first()).toBeVisible();
});

test("search states pass axe (no serious / critical) on the menu, a category and the allergens; light and dark", async ({ page }) => {
  const axe = async (include: string) => {
    await page.waitForFunction(() => document.getAnimations().every((a) => { const t = a.effect?.getTiming(); return a.playState !== "running" || !t || t.iterations === Infinity || Number(t.duration) >= 2000; }));
    const r = await new AxeBuilder({ page }).include(include).analyze();
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
  };
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, "12:30", "#q=" + encodeURIComponent("пица без лук"));
    await expect(page.locator("#c-q-unknown, #c-q-name").first()).toBeVisible();
    expect(await axe("[data-menupg]")).toEqual([]);
    await page.goto("/menu/topli-predyastia/?preview=1&t=12:30#q=" + encodeURIComponent("сирене без глутен"));
    await expect(page.locator(".flt .qchips")).toBeVisible();
    expect(await axe(".flt")).toEqual([]);
    await page.goto("/alergeni/#q=" + encodeURIComponent("лук"));
    await expect(page.locator("tbody.cath.qband")).toBeVisible();
    expect(await axe("#filters, #res")).toEqual([]);
  }
});
