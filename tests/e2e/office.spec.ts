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
  await expect(page.locator("[data-pv]")).toHaveCount(0);
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
  await expect(page.locator("[data-pv]")).toBeVisible();
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

test("office: a colleague stops at 10 portions (the sum of the counts)", async ({ page }) => {
  await open(page);
  await page.fill("#o-name", "Мария");
  await page.locator('[data-zone="Дружба 2"]').click();
  await page.locator(".o-form [type=submit]").click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е отворена");
  const code = /#join-(\d{6})/.exec((await page.locator("[data-link]").textContent()) || "")![1];
  await page.goto(PATH + "?preview=1&t=09:30#join-" + code);
  const items = page.locator(".o-item:not(.out)");
  await items.nth(0).locator(".plus").click();
  for (let i = 0; i < 7; i++) await items.nth(0).locator('[data-q="1"]').click();
  await items.nth(1).locator(".plus").click();
  await items.nth(1).locator('[data-q="1"]').click();
  /* at 10 portions every "+" is aria-disabled (site.review-tech Д10); a tap still says why */
  await expect(items.nth(1).locator('[data-q="1"]')).toHaveAttribute("aria-disabled", "true");
  await expect(items.nth(2).locator('[data-q="1"]')).toHaveAttribute("aria-disabled", "true");
  await items.nth(1).locator('[data-q="1"]').click({ force: true }); /* the 11th portion is refused */
  await expect(items.nth(0).locator("output")).toHaveText("8");
  await expect(items.nth(1).locator("output")).toHaveText("2");
  await expect(page.locator(".toast, [role=status]").filter({ hasText: "До 10 порции на човек" }).first()).toBeVisible();
});

/* ---------- after the code review (стъпка 3, повторна): focus, errors, contact, payment words, pickup after 15:00 ---------- */
const CALL_TXT = "Обади се · 0894 36 55 77";
/** create an order in this browser (the organizer); returns the code */
async function create(page: Page, o: { phone?: string; pickup?: boolean } = {}) {
  await page.fill("#o-office", "Счетоводство");
  await page.fill("#o-name", "Мария");
  if (o.phone) await page.fill("#o-cphone", o.phone);
  if (o.pickup) { await page.fill("#o-addr", "ж.к. Младост 1, бл. 20"); await page.locator("[data-act=pickup]").click(); }
  else await page.locator('[data-zone="Дружба 2"]').click();
  await page.locator(".o-form [type=submit]").click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е отворена");
  return /#join-(\d{6})/.exec((await page.locator("[data-link]").textContent()) || "")![1];
}
const guestBtn = (page: Page) => page.locator(isPhone(page) ? ".o-bar [data-act=guestsave]" : ".o-aside [data-act=guestsave]");
const sendBtnOf = (page: Page) => page.locator(isPhone(page) ? ".o-bar [data-act=send]" : "[data-sendinline] [data-act=send]");
/** the smooth scroll to the new title has ended (the page stays still for 100 ms) */
async function settle(page: Page) {
  let prev = -1;
  await expect.poll(async () => { const y = await page.evaluate(() => window.scrollY); const same = y === prev; prev = y; return same; }, { intervals: [100] }).toBe(true);
}
/** the element is on the screen (not above or below it) */
async function onScreen(page: Page, sel: string) {
  await settle(page);
  const r = await page.locator(sel).first().boundingBox();
  const h = page.viewportSize()!.height;
  expect(r).not.toBeNull();
  expect(r!.y).toBeGreaterThanOrEqual(0);
  expect(r!.y + r!.height).toBeLessThanOrEqual(h);
}

test("office: focus and screen go to the title of the new state (create, add, remove), never <body>", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const code = await create(page);
  await expect(page.locator("h1:visible")).toBeFocused();
  await onScreen(page, "h1:visible");

  await page.goto(PATH + "?preview=1&t=09:30#join-" + code);
  await page.fill("#o-gname", "Николай");
  await page.locator(".o-item:not(.out) .plus").first().click();
  await page.mouse.wheel(0, 1500); /* far down the menu, as a colleague is when they add */
  await guestBtn(page).click();
  await expect(page.locator("h1:visible")).toHaveText("Готово, Николай!");
  await expect(page.locator("h1:visible")).toBeFocused();
  await expect.poll(async () => (await page.locator("h1:visible").boundingBox())!.y).toBeGreaterThanOrEqual(0);
  await onScreen(page, "h1:visible");
  /* "Промени избора": the invitation title */
  await page.locator("[data-act=guestedit]").click();
  await expect(page.locator("h1:visible")).toBeFocused();

  /* "Махни": the button is gone, the focus is on "Кой какво поръча" */
  await page.goto(PATH + "?preview=1&t=09:30#list");
  await page.locator('[data-act=drop][data-who="Николай"]').click();
  await expect(page.locator("#o-people-h")).toBeFocused();
  await onScreen(page, "#o-people-h");
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(false);
});

test("office: errors when adding: a title with the focus, the call as the main action on 429 and full", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const code = await create(page);
  await page.goto(PATH + "?preview=1&t=09:30#join-" + code);
  await page.fill("#o-gname", "Николай");
  await page.locator(".o-item:not(.out) .plus").first().click();
  let answer: { status: number; body?: Record<string, string>; abort?: boolean } = { status: 500, body: { error: "server", message: "Нещо се обърка." } };
  await page.route(/\/api\/office\/\d+\/join$/, (r) => (answer.abort ? r.abort() : r.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) })));
  const title = page.locator(".o-err [data-errh]");

  /* 500: "Не успяхме да …", the choice is kept, "Опитай пак" */
  await guestBtn(page).click();
  await expect(title).toHaveText("Не успяхме да добавим избора ви");
  await expect(title).toBeFocused();
  await expect(page.locator(".o-err")).toContainText("Изборът ви е запазен");
  await expect(page.locator(".o-err [data-act=guestsave]")).toHaveText("Опитай пак");

  /* offline: "Няма връзка с интернет" only here */
  answer = { status: 0, abort: true };
  await settle(page);
  await page.locator(".o-err [data-act=guestsave]").click();
  await expect(title).toHaveText("Няма връзка с интернет");
  await expect(title).toBeFocused();

  /* full: no "запазен", the call is the main (red) action */
  answer = { status: 409, body: { error: "full", message: "Поръчката е пълна: до 60 души." } };
  await settle(page);
  await page.locator(".o-err [data-act=guestsave]").click();
  await expect(title).toHaveText("Поръчката е пълна");
  await expect(title).toBeFocused();
  await expect(page.locator(".o-err")).not.toContainText("запазен");
  await expect(page.locator(".o-err a.pill-red")).toHaveText(CALL_TXT);
  /* adding again is refused too: the save buttons became the call */
  await expect(page.locator("[data-act=guestsave][data-savebtn]")).toHaveCount(0);
  await expect(page.locator(isPhone(page) ? ".o-bar a.pill-red" : ".o-aside a.pill-red").first()).toHaveText(CALL_TXT);

  /* 429 and too_big (a fresh view) */
  for (const [st, err, t] of [[429, "throttled", "Твърде много опити"], [422, "too_big", "Голяма поръчка: обадете ни се"]] as const) {
    await page.reload();
    await page.locator(".o-item:not(.out) .plus").first().click().catch(() => undefined);
    answer = { status: st, body: { error: err, message: "x" } };
    await guestBtn(page).click();
    await expect(title).toHaveText(t);
    await expect(title).toBeFocused();
    await expect(page.locator(".o-err a.pill-red")).toHaveText(CALL_TXT);
    await expect(page.locator(".o-err [data-act=guestsave]")).toHaveCount(0);
    await expect(page.locator(".o-err")).not.toContainText("запазен");
  }
});

test("office: errors when sending: a title with the focus, 429 and too_big give the call, forbidden says the core's words", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const code = await create(page, { phone: "0888 12 34 56" });
  await page.goto(PATH + "?preview=1&t=09:30#join-" + code);
  await page.fill("#o-gname", "Николай");
  await page.locator(".o-item:not(.out) .plus").first().click();
  await guestBtn(page).click();
  await expect(page.locator("h1:visible")).toHaveText("Готово, Николай!");
  await page.goto(PATH + "?preview=1&t=10:45#list");
  let answer: { status: number; body?: Record<string, string>; abort?: boolean } = { status: 500, body: { error: "server", message: "Нещо се обърка." } };
  await page.route(/\/api\/office\/\d+\/submit$/, (r) => (answer.abort ? r.abort() : r.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) })));
  const title = page.locator(".o-err [data-errh]");

  await sendBtnOf(page).click();
  await expect(title).toHaveText("Не успяхме да изпратим поръчката");
  await expect(title).toBeFocused();
  await expect(page.locator(".o-err [data-act=send]")).toHaveText("Опитай пак");
  await expect(page.locator(".o-err a[href^='tel:']")).toHaveText(CALL_TXT);

  answer = { status: 0, abort: true };
  await settle(page);
  await page.locator(".o-err [data-act=send]").click();
  await expect(title).toHaveText("Няма връзка с интернет");
  await expect(title).toBeFocused();

  /* forbidden: the core's own text (the organizer is the same person on another device) */
  const core = "Тази връзка не е на организатора на поръчката. Отворете връзката за организатора.";
  answer = { status: 403, body: { error: "forbidden", message: core } };
  await settle(page);
  await page.locator(".o-err [data-act=send]").click();
  await expect(page.locator(".o-err")).toContainText(core);
  await expect(page.locator(".o-err")).not.toContainText("неговата");

  /* 429: no "Опитай пак", the call is the main action, also instead of the send button */
  answer = { status: 429, body: { error: "throttled", message: "Твърде много опити." } };
  await sendBtnOf(page).click();
  await expect(title).toHaveText("Твърде много опити");
  await expect(title).toBeFocused();
  await expect(page.locator(".o-err [data-act=send]")).toHaveCount(0);
  await expect(page.locator(".o-err a.pill-red")).toHaveText(CALL_TXT);
  await expect(page.locator(isPhone(page) ? ".o-bar a.pill-red" : "[data-sendinline] a.pill-red")).toHaveText(CALL_TXT);

  /* too_big (a fresh view) */
  await page.reload();
  answer = { status: 422, body: { error: "too_big", message: "x" } };
  await sendBtnOf(page).click();
  await expect(title).toHaveText("Голяма поръчка: обадете ни се");
  await expect(page.locator(".o-err a.pill-red")).toHaveText(CALL_TXT);
});

test("office: opening the order: 500 is not 'no internet', 429 has the call as the main action, offline", async ({ page }) => {
  await open(page);
  let answer: { status: number; body?: Record<string, string>; abort?: boolean } = { status: 500, body: { error: "server", message: "Нещо се обърка." } };
  await page.route(/\/api\/office\/\d+(\?.*)?$/, (r) => (answer.abort ? r.abort() : r.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) })));
  await page.goto(PATH + "?preview=1&t=09:30#join-123456");
  await expect(page.locator("h1:visible")).toHaveText("Не успяхме да заредим поръчката");
  await expect(page.locator("[data-act=retry]")).toBeVisible();
  answer = { status: 429, body: { error: "throttled", message: "Твърде много опити с грешна връзка. Опитайте след 10 минути." } };
  await page.locator("[data-act=retry]").click();
  await expect(page.locator("h1:visible")).toHaveText("Твърде много опити");
  await expect(page.locator(".sc-state")).toContainText("Опитайте след 10 минути или ни се обадете.");
  await expect(page.locator(".sc-state a.pill-red")).toHaveText(CALL_TXT);
  await expect(page.locator("[data-act=retry]")).toHaveCount(0);
  answer = { status: 0, abort: true };
  await page.reload();
  await expect(page.locator("h1:visible")).toHaveText("Няма връзка с интернет");
});

test("office: the phone and the way of paying chosen later go to the core (api.office.update); the payment words of the site", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await create(page);
  await page.goto(PATH + "?preview=1&t=09:30#list");
  await expect(page.locator("[data-sendnote]")).toContainText("Поръчката не тръгва сама");
  /* the words: "В брой / Карта при получаване / Ваучер", as the note under the form */
  await expect(page.locator("[data-view] .o-choice .o-opt b")).toHaveText(["В брой", "Карта при получаване", "Ваучер"]);
  expect(await page.locator("[data-view]").textContent()).not.toContain("С карта");
  const upd: Record<string, string>[] = [];
  page.on("request", (r) => { if (/\/api\/office\/\d+\/update$/.test(r.url())) upd.push(JSON.parse(r.postData() || "{}")); });
  await page.fill("#o-phone", "0888 12 34 56");
  await page.locator("#o-phone").blur();
  await expect(page.locator("[data-contactnote]")).toContainText("Запазено");
  await expect(page.locator("[data-sendnote]")).toContainText("поръчката тръгва към ресторанта сама");
  expect(upd[0]).toMatchObject({ phone: "0888123456", name: "Мария" });
  await page.locator(".o-opt", { hasText: "Карта при получаване" }).click();
  await expect(page.locator("[data-contactnote]")).toHaveText("Запазено: Карта при получаване.");
  expect(upd[1]).toMatchObject({ pay: "card" });
  /* the core has it: another load says the order leaves by itself */
  await page.reload();
  await expect(page.locator("[data-sendnote]")).toContainText("поръчката тръгва към ресторанта сама");
  await expect(page.locator(".o-opt:has(input:checked) b")).toHaveText("Карта при получаване");
  /* a wrong phone: the error under the field, nothing sent */
  await page.fill("#o-phone", "123");
  await page.locator("#o-phone").blur();
  await expect(page.locator("#o-phone-e")).toBeVisible();
  expect(upd.length).toBe(2);
  /* "Копирай връзката за вас": one line */
  const b = await page.locator("[data-act=copyorg]").boundingBox();
  expect(b!.height).toBeLessThan(60);
});

test("office: without the organizer key the list says the core's words, without a send button", async ({ page }) => {
  await open(page);
  await create(page);
  await page.evaluate(() => localStorage.setItem("sc-keys", JSON.stringify({ orders: {}, org: {}, pid: {}, res: {} })));
  await page.goto(PATH + "?preview=1&t=10:45#list");
  await page.reload();
  await expect(page.locator("h1:visible")).toHaveText("Отворете връзката за организатора");
  await expect(page.locator("[data-act=send]")).toHaveCount(0);
});

test("office: pickup after 15:00 is sent with -30% (the core's rule), not 'lunch is over'", async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, "12:00");
  const code = await create(page, { pickup: true });
  await page.goto(PATH + "?preview=1&t=12:00#join-" + code);
  await page.fill("#o-gname", "Николай");
  await page.locator(".o-item:not(.out) .plus").first().click();
  await guestBtn(page).click();
  await expect(page.locator("h1:visible")).toHaveText("Готово, Николай!");
  await page.goto(PATH + "?preview=1&t=15:30#list");
  await expect(page.locator("main")).not.toContainText("Обедното меню вече не се доставя");
  const send = sendBtnOf(page);
  await expect(send).toBeEnabled();
  await expect(send).toHaveText(/^Поръчай за вземане · \d+,\d{2} €$/);
  await expect(page.locator("[data-bill]")).toContainText("-30%");
  const sum = /(\d+,\d{2} €)/.exec((await send.textContent()) || "")![1];
  await page.fill("#o-phone", "0888 12 34 56");
  await send.click();
  await expect(page.locator("h1:visible")).toHaveText("Поръчката е изпратена");
  await expect(page.locator(".o-sentmeta")).toContainText(sum);
});

test("office: the code in the chat chip is whole at 360", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await open(page);
  const code = await create(page);
  const chip = page.locator("[data-view] .o-bubble .o-linkchip");
  await expect(chip.locator(".nw")).toHaveText("#join-" + code);
  const c = (await chip.boundingBox())!, n = (await chip.locator(".nw").boundingBox())!;
  expect(n.x + n.width).toBeLessThanOrEqual(c.x + c.width);
  expect(n.x).toBeGreaterThanOrEqual(c.x);
});
