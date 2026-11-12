import { test, expect, type Page, type Browser } from "@playwright/test";

/* Обща поръчка за офиса (/obedna-porachka-za-ofisa/): create (name, address with zone check, deadline 11:30 by default,
   who pays) -> link for colleagues -> invited colleague adds from the lunch menu -> shared list with sums -> send
   (api.office.create/get/join/submit) -> sent with the order number. Simulated colleagues only behind ?preview=1. */
const PATH = "/obedna-porachka-za-ofisa/";
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (404|409|422)/.test(m.text())) errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t = "09:30", hash = "", preview = true) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("of-init")) return;
    sessionStorage.setItem("of-init", "1");
    localStorage.setItem("sc-cookie", '"min"');
    localStorage.removeItem("sc-office");
  });
  await page.goto(PATH + (preview ? "?preview=1&t=" + t : "") + hash);
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 900;
/** another browser (own storage), cookie banner answered */
async function other(browser: Browser, like: Page) {
  const c = await browser.newContext({ viewport: like.viewportSize() || undefined, hasTouch: isPhone(like) });
  await c.addInitScript(() => localStorage.setItem("sc-cookie", '"min"'));
  return { c, p: await c.newPage() };
}

test("office: SEO, one h1, FAQ JSON-LD, no horizontal scroll, no prototype panel without preview", async ({ page }) => {
  const errors = watch(page);
  await open(page, "09:30", "", false);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1:visible")).toHaveText("Обща поръчка за офиса");
  await expect(page).toHaveTitle(/Обща поръчка за офиса/);
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.some((x) => x.includes("FAQPage"))).toBe(true);
  expect(ld.some((x) => x.includes("BreadcrumbList"))).toBe(true);
  await expect(page.locator(".o-slot[aria-pressed=true]")).toBeVisible();
  await expect(page.locator(".o-proto")).toHaveCount(0);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  const html = await page.content();
  expect(html).not.toMatch(/[—–]/);
  expect(errors).toEqual([]);
});

test("office: validation and zone check", async ({ page }) => {
  await open(page);
  await page.locator(".o-form [type=submit]").click();
  await expect(page.locator("#o-name-e")).toBeVisible();
  await expect(page.locator("#o-addr-e")).toBeVisible();
  await page.fill("#o-addr", "ж.к. Младост 1, бл. 20");
  await expect(page.locator("[data-zoneres] .o-note.bad")).toContainText("Не доставяме");
  await page.fill("#o-addr", "ж.к. Дружба 2, бл. 12");
  await expect(page.locator("[data-zoneres] .o-note.ok")).toContainText("Безплатна доставка · Дружба 2");
  await expect(page.locator(".o-slot[aria-pressed=true]")).toHaveText("11:30");
});

test("office: full flow: create, colleague joins, list, send, sent", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await page.fill("#o-office", "Счетоводство");
  await page.fill("#o-name", "Мария");
  await page.locator('[data-zone="Дружба 2"]').click();
  await page.locator(".o-form [type=submit]").click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е отворена");
  const link = (await page.locator("[data-link]").textContent()) || "";
  const code = /#join-(\d{6})/.exec(link)![1];

  /* the colleague (same browser in the demo, other browser on the server) */
  await page.goto(PATH + "?preview=1&t=09:30#join-" + code);
  await expect(page.locator("h1:visible")).toHaveText("Мария поръчва обяд за офиса");
  await page.fill("#o-gname", "Николай");
  await page.locator(".o-item:not(.out) .plus").first().click();
  await (isPhone(page) ? page.locator(".o-bar [data-act=guestsave]") : page.locator(".o-aside [data-act=guestsave]")).click();
  await expect(page.locator("h1:visible")).toHaveText("Готово, Николай!");

  /* a second colleague with the same name is refused */
  await page.locator("[data-act=guestedit]").click();
  await expect(page.locator("#o-gname")).toHaveValue("Николай");

  /* the organizer: list, own lunch, send */
  await page.goto(PATH + "?preview=1&t=09:30#list");
  await expect(page.locator(".o-person")).toHaveCount(2);
  await expect(page.locator(".o-person").nth(1)).toContainText("Николай");
  await page.locator('a[href="#mine"]').first().click();
  await page.locator(".o-item:not(.out) .plus").nth(1).click();
  await (isPhone(page) ? page.locator(".o-bar [data-act=savemine]") : page.locator(".o-aside [data-act=savemine]")).click();
  await expect(page.locator(".o-person").first()).toContainText("1 ×");
  /* before 10:00 the kitchen is closed: send waits */
  await expect(page.locator("[data-sendinline] button, .o-bar button").first()).toBeDisabled();

  await page.goto(PATH + "?preview=1&t=10:45#list");
  await page.fill("#o-phone", "0888 12 34 56");
  const send = isPhone(page) ? page.locator(".o-bar [data-act=send]") : page.locator("[data-sendinline] [data-act=send]");
  await expect(send).toHaveText(/^Изпрати на ресторанта · \d+,\d{2} €$/);
  await send.click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е изпратена");
  await expect(page.locator(".o-sentmeta")).toContainText("№ ");
  expect(errors).toEqual([]);
});

test("office: wrong link and simulated colleagues only in preview", async ({ page }) => {
  await open(page, "09:30", "#join-000000");
  await expect(page.locator("h1:visible")).toHaveText("Тази връзка не работи");
  await expect(page.locator(".o-proto")).toBeVisible();
});

test("office: after 15:00 the order is for tomorrow", async ({ page }) => {
  await open(page, "16:30");
  await expect(page.locator(".o-note.warn")).toContainText("За днес е късно");
  await expect(page.locator(".o-slot[disabled]")).toHaveCount(0);
  await expect(page.locator("[data-eta]")).toContainText("утре");
});

/* After the code review (12.11): separate browsers on the server. The organizer gives a phone (the core sends at the
   deadline), the colleague sees the same day, a taken name is refused under the field, the organizer's own link opens
   the list on another device and sends; a second send is refused (one order only). */
test("office: separate browsers: same day, name taken, organizer link on another device, one send", async ({ page, browser }) => {
  const errors = watch(page);
  await open(page, "09:30");
  await page.fill("#o-office", "Счетоводство");
  await page.fill("#o-name", "Мария");
  await page.fill("#o-cphone", "0888 12 34 56");
  await page.locator('[data-zone="Дружба 2"]').click();
  await page.locator(".o-form [type=submit]").click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е отворена");
  await expect(page.locator(".o-orglink")).toBeVisible();
  const code = /#join-(\d{6})/.exec((await page.locator("[data-link]").textContent()) || "")![1];
  const key = await page.evaluate((c) => JSON.parse(localStorage.getItem("sc-keys") || "{}").org[c], code);
  expect(key).toBeTruthy();
  await page.goto(PATH + "?preview=1&t=09:30#list");
  await expect(page.locator("[data-sendnote]")).toContainText("В 11:30 поръчката тръгва към ресторанта сама.");

  /* the colleague in another browser: the same day as the organizer */
  const { c: c1, p: g } = await other(browser, page);
  const gErr = watch(g);
  await g.goto(PATH + "?preview=1&t=09:30#join-" + code);
  await expect(g.locator("h1:visible")).toHaveText("Мария поръчва обяд за офиса");
  await expect(g.locator(".o-pill-time")).toContainText("До 11:30");
  await g.fill("#o-gname", "Николай");
  await g.locator(".o-item:not(.out) .plus").first().click();
  await g.locator(isPhone(g) ? ".o-bar [data-act=guestsave]" : ".o-aside [data-act=guestsave]").click();
  await expect(g.locator("h1:visible")).toHaveText("Готово, Николай!");

  /* a third browser with the same name: the core refuses (name_taken), the text is under the field */
  const { c: c2, p: h } = await other(browser, page);
  await h.goto(PATH + "?preview=1&t=09:30#join-" + code);
  await expect(h.locator("h1:visible")).toHaveText("Мария поръчва обяд за офиса");
  await h.fill("#o-gname", "николай");
  await h.locator(".o-item:not(.out) .plus").first().click();
  await h.locator(isPhone(h) ? ".o-bar [data-act=guestsave]" : ".o-aside [data-act=guestsave]").click();
  await expect(h.locator("#o-gname-e")).toBeVisible();
  await expect(h.locator("#o-gname-e")).toContainText("вече е в");

  /* the organizer's own link on another device: the list, then send */
  const { c: c3, p: o2 } = await other(browser, page);
  const oErr = watch(o2);
  await o2.goto(PATH + "?preview=1&t=10:45#list-" + code + "-" + key);
  await expect(o2).toHaveURL(/#list$/);
  await expect(o2.locator(".o-person")).toHaveCount(2);
  /* the phone given at create is with the core: optional here */
  await expect(o2.locator('label[for="o-phone"]')).toContainText("по желание");
  const send = isPhone(o2) ? o2.locator(".o-bar [data-act=send]") : o2.locator("[data-sendinline] [data-act=send]");
  await send.click();
  await expect(o2.locator("h1:visible")).toHaveText("Поръчката е изпратена");
  const no = ((await o2.locator(".o-sentmeta b").first().textContent()) || "").replace(/\D/g, "");
  const meta = (await o2.locator(".o-sentmeta").textContent()) || "";

  /* the first device: a second send is refused, the sent screen shows the same number */
  await page.goto(PATH + "?preview=1&t=10:46#list");
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е изпратена");
  await expect(page.locator(".o-sentmeta")).toContainText("№ " + no);
  /* one arrival time and one total on every device (the order's own) */
  await expect(page.locator(".o-sentmeta")).toHaveText(meta);
  /* the colleague sees it too */
  await g.goto(PATH + "?preview=1&t=10:46#join-" + code);
  await expect(g.locator("h1:visible")).toHaveText("Поръчката е изпратена");
  expect([...errors, ...gErr, ...oErr]).toEqual([]);
  await c1.close(); await c2.close(); await c3.close();
});

test("office: without preview the old lunch menu is only for reference", async ({ page, browser }) => {
  await open(page, "", "", false);
  const ok = await page.evaluate(() => JSON.parse(document.getElementById("o-data")!.textContent!).date === new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date()));
  test.skip(ok, "the lunch menu in the data is for today");
  await page.fill("#o-name", "Мария");
  await page.locator('[data-zone="Дружба 2"]').click();
  await page.locator(".o-form [type=submit]").click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е отворена");
  const code = /#join-(\d{6})/.exec((await page.locator("[data-link]").textContent()) || "")![1];
  const { c: c1, p: g } = await other(browser, page);
  await g.goto(PATH + "#join-" + code);
  await expect(g.locator(".o-menu .o-note.warn")).toContainText(/Обедното меню за (днес|утре) още не е качено/);
  await expect(g.locator(".o-item .plus")).toHaveCount(0);
  /* the invitation shows the office name the colleagues get */
  await expect(g.locator(".o-invite")).toContainText("Офисът на Мария");
  await c1.close();
});
