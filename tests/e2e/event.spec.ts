import { test, expect, type Page } from "@playwright/test";

/* Event (/sabitia/<slug>/): date computed in the browser (last Saturday), SEO (h1, Event + BreadcrumbList),
   "Запази място" -> reservation with the date, calendar sheet + .ics, share sheet, preview states. */
const EV = "/sabitia/gratska-vecher/";
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function open(page: Page, hash = "", t = "12:30") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto(EV + "?preview=1&t=" + t + (hash ? "#" + hash : ""));
}
/* the last Saturday of this month (or the next one, if it passed), as the page computes it */
function lastSat(): string {
  const t = new Date(), mid = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const ls = (y: number, m: number) => { const d = new Date(y, m + 1, 0); while (d.getDay() !== 6) d.setDate(d.getDate() - 1); return d; };
  let d = ls(t.getFullYear(), t.getMonth());
  if (d < mid) d = ls(t.getMonth() === 11 ? t.getFullYear() + 1 : t.getFullYear(), (t.getMonth() + 1) % 12);
  const p = (n: number) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

test("event: server HTML has no date, SEO is complete", async ({ request }) => {
  const html = await (await request.get(EV)).text();
  expect(html).toContain("Всяка последна събота от месеца");
  expect(html).not.toMatch(/[—–]/);
  expect((html.match(/<h1/g) || []).length).toBe(1);
  expect(html).toContain('"@type":"BreadcrumbList"');
  expect(html).toContain('"eventSchedule"');
  expect(html).not.toContain('"offers"');
});

test("event: date, reserve link, JSON-LD startDate, calendar and share", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  const iso = lastSat();
  await expect(page.locator("h1")).toHaveText("Гръцка вечер");
  await expect(page.locator(".tk-main .cal .d")).toHaveText(String(+iso.slice(8)));
  await expect(page.locator("[data-hero-cta]")).toHaveAttribute("href", "/rezervatsia/#" + iso);
  await expect(page).toHaveTitle(/Гръцка вечер · сб, \d+ \S+ \| Siracusa/);
  const ld = JSON.parse((await page.locator("#ev-ld").textContent()) || "{}");
  expect(ld["@type"]).toBe("Event");
  expect(ld.startDate).toMatch(new RegExp("^" + iso + "T19:00:00\\+0[23]:00$"));
  expect(ld.offers).toBeUndefined();
  await expect(page.locator(".seats")).toHaveCount(0);
  await expect(page.locator(".ev-facts")).toContainText("[ЛИПСВА: цена");

  await page.locator("[data-cal]").click();
  await expect(page.locator(".sheet")).toContainText("Google Календар");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("[data-ics]").click()]);
  expect(dl.suggestedFilename()).toBe("gratska-vecher-" + iso + ".ics");
  await page.waitForTimeout(400);

  await page.locator("[data-evshare]").click();
  await expect(page.locator(".sheet").last()).toBeVisible();

  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("event: preview states (seats, full, live, over, error)", async ({ page }) => {
  const errors = watch(page);
  await open(page, "mesta");
  await expect(page.locator(".seats")).toHaveText("Остават 6 места");
  await page.evaluate(() => { location.hash = "pulno"; });
  await expect(page.locator("[data-hero-cta]")).toContainText("Запиши ме в чакащите");
  await page.evaluate(() => { location.hash = "sega"; });
  await expect(page.locator("[data-hero-cta]")).toHaveAttribute("href", "tel:+359894365577");
  await page.evaluate(() => { location.hash = "prikljuchi"; });
  await expect(page.locator("[data-hero-cta]")).toHaveAttribute("href", "/sabitia/");
  await page.evaluate(() => { location.hash = "greshka"; });
  await expect(page.locator("h1")).toHaveText("Не успяхме да заредим събитието");
  await page.locator("[data-retry]").click();
  await expect(page.locator("h1")).toHaveText("Гръцка вечер");
  expect(errors).toEqual([]);
});

test("event: the action bar appears after the main button scrolls away", async ({ page }) => {
  await open(page);
  await expect(page.locator("[data-abar]")).toHaveClass(/off/);
  await page.evaluate(() => window.scrollTo(0, 1400));
  await expect(page.locator("[data-abar]")).not.toHaveClass(/off/);
  await expect(page.locator("[data-abar] a")).toContainText("Запази място");
});
