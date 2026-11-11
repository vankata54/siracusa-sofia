import { test, expect, type Page } from "@playwright/test";

/* Reservation (/rezervatsia/): day -> time -> people, floor plan (Салон / Градина) or list, details with unticked consent,
   api.reservations.create -> success; taken table from the API, waitlist, blocked number, date from #YYYY-MM-DD, large group. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (403|409|422)/.test(m.text())) errors.push(m.text()); });
  return errors;
}
const pad = (n: number) => String(n).padStart(2, "0");
/** a date ~10 days ahead that is not the last Saturday (event day), as YYYY-MM-DD */
function future(days = 10): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); while (last.getDay() !== 6) last.setDate(last.getDate() - 1);
  if (d.getDate() === last.getDate()) d.setDate(d.getDate() + 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
async function open(page: Page, hash = "", t = "12:30") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/rezervatsia/?preview=1&t=" + t + (hash ? "#" + hash : ""));
  await expect(page.locator("[data-flow] .cal")).toBeVisible();
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 900;
const next = (page: Page) => (isPhone(page) ? page.locator(".rabar [data-act=next]") : page.locator(".aside [data-act=next]"));
async function toStep2(page: Page, date: string, slot = "19:30") {
  await open(page, date);
  await page.locator(".slot", { hasText: slot }).click();
  await next(page).click();
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 2 от 3");
  await expect(page.locator(".fp")).toBeVisible();
}
async function pickFree(page: Page) {
  await page.locator(".tbl.free").first().click();
  await page.locator(".sheet [data-pick]").click();
  await expect(page.locator(".selc .hold")).toContainText("задържана");
}

test("reservation: SEO, one h1, calendar with event dot, no overflow", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Резервирай маса");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/rezervatsia\/$/);
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join(" ")).toContain("ReserveAction");
  expect(ld.join(" ")).toContain("BreadcrumbList");
  await expect(page.locator(".day .ev").first()).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("reservation: full flow day -> table -> details -> success (consent unticked)", async ({ page }, info) => {
  const errors = watch(page);
  const date = future(info.project.name === "phone" ? 9 : 12);
  await toStep2(page, date);
  await pickFree(page);
  await next(page).click();
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 3 от 3");
  await expect(page.locator("[data-consent]")).not.toBeChecked();
  await next(page).click(); /* empty form -> errors */
  await expect(page.locator("#e-name")).toBeVisible();
  await page.fill("#f-name", "Тест Гост");
  await page.fill("#f-phone", "0888 12 34 56");
  await expect(next(page)).toContainText(/Резервирай маса за 2/);
  await next(page).click();
  await expect(page.locator("h1:visible")).toHaveText("Масата е запазена");
  await expect(page.locator("[data-ics]")).toBeVisible();
  await expect(page.locator("h1:visible")).toHaveCount(1);
  if (isPhone(page)) await page.screenshot({ path: "test-results/res-done-390.png", fullPage: false });
  expect(errors).toEqual([]);
});

test("reservation: table taken through the API shows as taken", async ({ page, request }, info) => {
  const date = future(info.project.name === "phone" ? 15 : 16);
  const r = await request.post("/api/reservations", { data: { date, time: "13:00", people: 2, table: "S1", name: "Друг", phone: "0888 11 22 33" } });
  expect(r.ok() || r.status() === 409).toBeTruthy(); /* 409: already taken by an earlier run */
  await open(page, date);
  await page.locator(".seg [data-period=lunch]").click();
  await page.locator(".slot", { hasText: "13:00" }).click();
  await next(page).click();
  await expect(page.locator('.tbl[data-t="S1"]')).toHaveClass(/taken/);
  await page.locator("[data-list]").click();
  await expect(page.locator(".trow.taken").first()).toContainText("Заета в 13:00");
  if (!isPhone(page)) await page.screenshot({ path: "test-results/res-list-1440.png" });
});

test("reservation: blocked number gets a polite message", async ({ page }, info) => {
  const date = future(info.project.name === "phone" ? 20 : 21);
  await toStep2(page, date, "20:00");
  await pickFree(page);
  await next(page).click();
  await page.fill("#f-name", "Тест");
  await page.fill("#f-phone", "0888 000 000");
  await next(page).click();
  await expect(page.locator("[data-blocked]")).toContainText("Тази резервация ще уредим по телефона");
  await expect(page.locator(".rabar a.cta, .aside a.cta").first()).toHaveAttribute("href", /^tel:/);
});

test("reservation: event date from the address preselects 19:00", async ({ page }) => {
  const d = new Date(); let ls = new Date(d.getFullYear(), d.getMonth() + 1, 0); while (ls.getDay() !== 6) ls.setDate(ls.getDate() - 1);
  if (ls.getDate() <= d.getDate() + 1) { ls = new Date(d.getFullYear(), d.getMonth() + 2, 0); while (ls.getDay() !== 6) ls.setDate(ls.getDate() - 1); }
  const ymd = ls.getFullYear() + "-" + pad(ls.getMonth() + 1) + "-" + pad(ls.getDate());
  await open(page, ymd);
  await expect(page.locator(".day[aria-pressed=true]")).toHaveAttribute("data-day", ymd);
  await expect(page.locator(".slot[aria-pressed=true]")).toHaveText("19:00");
  await expect(page.locator(".evnote")).toContainText("Гръцка вечер");
  if (isPhone(page)) await page.screenshot({ path: "test-results/res-event-390.png", fullPage: true });
});

test("reservation: full hour -> waitlist (preview), large group joins tables", async ({ page }) => {
  await open(page);
  await page.locator(".proto summary").click();
  await page.locator('[data-proto="event"]').click();
  await page.locator('.slot.full').first().click();
  await expect(page.locator(".sheet")).toContainText("Пълно в");
  await page.fill("#wl-name", "Чакащ");
  await page.fill("#wl-phone", "0888 22 33 44");
  await page.locator("[data-wlgo]").click();
  await expect(page.locator("[data-wlok]")).toHaveText("Записахме ви в списъка на чакащите");
  await page.keyboard.press("Escape");
  await page.locator('[data-proto="group"]').click();
  await expect(page.locator(".grp")).toContainText("За 8 души ще съединим маси");
});

test("reservation: manage late is locked (under 2 h / 1 h)", async ({ page }) => {
  await open(page, "", "18:10");
  await page.locator(".proto summary").click();
  await page.locator('[data-proto="late"]').click();
  await expect(page.locator(".alert.warn")).toContainText("Онлайн промяна вече не е възможна");
  await expect(page.locator('.alert.warn a[href^="tel:"]')).toBeVisible();
});
