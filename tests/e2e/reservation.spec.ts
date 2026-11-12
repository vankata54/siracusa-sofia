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
  await page.locator('[data-proto="event"]').click();
  await page.locator('.slot.full', { hasText: "19:00" }).click();
  await expect(page.locator(".sheet")).toContainText("Пълно в");
  /* the closest free hours (a tie goes to the earlier one), as in the prototype */
  await expect(page.locator(".sheet [data-wlslot]")).toHaveText(["17:00", "17:30", "18:00", "18:30"]);
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
  await page.locator('[data-proto="late"]').click();
  await expect(page.locator(".alert.warn")).toContainText("Онлайн промяна вече не е възможна");
  await expect(page.locator('.alert.warn a[href^="tel:"]')).toBeVisible();
});

test("reservation: link from the SMS (#r-<id>-<key>) opens the booking, fits 360, cancels online", async ({ page, request }, info) => {
  const errors = watch(page);
  const date = future(info.project.name === "phone" ? 24 : 25);
  const r = await request.post("/api/reservations", { data: { date, time: "19:30", people: 2, table: info.project.name === "phone" ? "S2" : "G1", name: "Гост От Линк", phone: "0888 44 55 66" } });
  expect(r.status()).toBe(201);
  const b = await r.json();
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/rezervatsia/#r-" + b.id + "-" + b.key);
  await expect(page.locator("h1:visible")).toHaveText("Вашата резервация");
  await expect(page.locator("[data-rview] .dcard")).toContainText("Гост От Линк");
  await expect(page.locator("[data-change]")).toBeVisible();
  const over = await page.evaluate(() => [...document.querySelectorAll("[data-rview] *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).length);
  expect(over).toBe(0);
  const small = await page.evaluate(() => [...document.querySelectorAll("[data-rview] a, [data-rview] button")].filter((e) => { const h = e.getBoundingClientRect().height; return h > 0 && h < 48; }).length);
  expect(small).toBe(0);
  await page.locator("[data-cancel=ask]").click();
  await page.locator("[data-cancel=yes]").click();
  await expect(page.locator("h1:visible")).toHaveText("Резервацията е отказана");
  const after = await request.get("/api/reservations/" + b.id + "?k=" + b.key);
  expect((await after.json()).status).toBe("cancelled");
  /* the table is free again */
  const tk = await request.get("/api/reservations/taken?date=" + date + "&time=19:30");
  expect(await tk.json()).not.toContain(b.table);
  /* a wrong key: a polite message on step 1 */
  await page.evaluate(() => { location.hash = "r-deadbeef-00112233"; });
  await expect(page.locator("[data-flow] .note[role=alert]")).toContainText("Не намерихме тази резервация");
  expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
});

test("reservation: a new #date on an open page updates the message (year for another year)", async ({ page }) => {
  await open(page, "nonsense");
  await expect(page.locator("[data-flow] .note[role=alert]")).toContainText("Не разпознахме датата");
  await page.evaluate(() => { location.hash = "2020-02-02"; });
  await expect(page.locator("[data-flow] .note[role=alert]")).toHaveText("Датата 2 февруари 2020 вече мина. Изберете друг ден.");
  const d = future(8);
  await page.evaluate((x) => { location.hash = x; }, d);
  await expect(page.locator(".day[aria-pressed=true]")).toHaveAttribute("data-day", d);
  await expect(page.locator("[data-flow] .note[role=alert]")).toHaveCount(0);
});

test("reservation: chips in \"Нужно ви е\" show that they slide on a phone", async ({ page }, info) => {
  test.skip(info.project.name !== "phone");
  await page.setViewportSize({ width: 360, height: 800 });
  await toStep2(page, future(11));
  await expect(page.locator("[data-morehint]")).toBeVisible();
  await expect(page.locator(".needs .chips")).toHaveAttribute("data-more", "");
  await page.locator(".needs .chips").evaluate((c) => { c.scrollLeft = c.scrollWidth; });
  await expect(page.locator("[data-morehint]")).toBeHidden();
});

test("reservation: fields.time / people from the core go back to step 1, under the question", async ({ page }, info) => {
  const errors = watch(page);
  await page.route("**/api/reservations", (r) => r.request().method() === "POST"
    ? r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "invalid", message: "Проверете полетата.", fields: { time: "Този час вече мина. Изберете по-късен.", people: "Масата е за 2 души. Изберете по-голяма маса или съединени маси." } }) })
    : r.continue());
  await toStep2(page, future(info.project.name === "phone" ? 26 : 27));
  await pickFree(page);
  await next(page).click();
  await page.fill("#f-name", "Тест");
  await page.fill("#f-phone", "0888 12 34 56");
  await next(page).click();
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 1 от 3");
  await expect(page.locator("#q-time .qerr")).toHaveText("Този час вече мина. Изберете по-късен.");
  await expect(page.locator("#q-ppl .qerr")).toContainText("Масата е за 2 души");
  expect(errors).toEqual([]);
});

test("reservation: change keeps the guest's own table free (30 min later, same table)", async ({ page, request }, info) => {
  const errors = watch(page);
  const tbl = info.project.name === "phone" ? "S6" : "G2";
  /* a day where the table is free at 19:30 - 21:30 (an earlier run may have kept one) */
  let b: { id: string; key: string } | null = null;
  for (let k = 28; k < 80 && !b; k += 2) {
    const date = future(k + (info.project.name === "phone" ? 0 : 1));
    if ((await (await request.get("/api/reservations/taken?date=" + date + "&time=20:00")).json()).includes(tbl)) continue;
    const r = await request.post("/api/reservations", { data: { date, time: "19:30", people: 4, table: tbl, name: "Сменящ", phone: "0888 55 66 77" } });
    if (r.status() === 201) b = await r.json();
  }
  if (!b) throw new Error("no free day");
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/rezervatsia/?preview=1&t=12:30#r-" + b.id + "-" + b.key);
  await page.locator("[data-change]").click();
  await page.locator(".slot", { hasText: "20:00" }).click();
  await next(page).click();
  await expect(page.locator(".fp")).toBeVisible();
  if (tbl.startsWith("G")) await page.locator("[data-zone=garden]").first().click();
  await expect(page.locator('.tbl[data-t="' + tbl + '"]')).not.toHaveClass(/taken/);
  await page.locator('.tbl[data-t="' + tbl + '"]').click();
  await page.locator(".sheet [data-pick]").click();
  await next(page).click();
  await next(page).click();
  await expect(page.locator("h1:visible")).toHaveText("Резервацията е променена");
  expect((await (await request.get("/api/reservations/" + b.id + "?k=" + b.key)).json()).status).toBe("cancelled");
  expect(errors).toEqual([]);
});

test("reservation: a link without its key says it is incomplete", async ({ page }) => {
  await open(page, "r-deadbeef");
  await expect(page.locator("[data-flow] .note[role=alert]")).toContainText("Връзката е непълна");
});

test("reservation: focus goes to the heading of each step and screen (not <body>)", async ({ page, request }, info) => {
  const errors = watch(page);
  const tag = () => page.evaluate(() => { const a = document.activeElement as HTMLElement; return a.tagName + ":" + (a.textContent || "").trim().slice(0, 40); });
  await toStep2(page, future(info.project.name === "phone" ? 32 : 33));
  await page.waitForTimeout(600); /* the occupancy arrives and the step is drawn again */
  expect(await tag()).toBe("H2:Изберете маса");
  await pickFree(page);
  await next(page).click();
  expect(await tag()).toMatch(/^H2:Вашите данни/);
  await page.locator(isPhone(page) ? ".rabar [data-act=back]" : ".aside [data-act=back]").click();
  await page.waitForTimeout(600);
  expect(await tag()).toBe("H2:Изберете маса");
  /* manage: "Промени" -> step 1 heading, "Откажи" -> the question */
  const r = await request.post("/api/reservations", { data: { date: future(info.project.name === "phone" ? 34 : 35), time: "13:00", people: 2, name: "Фокус", phone: "0888 99 88 77" } });
  const b = await r.json();
  await page.goto("/rezervatsia/?preview=1&t=12:30#r-" + b.id + "-" + b.key);
  await page.locator("[data-cancel=ask]").click();
  expect(await tag()).toMatch(/^H2:Да откажем ли резервацията/);
  await page.locator("[data-cancel=no]").click();
  await page.locator("[data-change]").click();
  await page.waitForTimeout(600);
  expect(await tag()).toBe("H2:Кой ден?");
  expect(errors).toEqual([]);
});

test("reservation: 429 throttled shows the server's text", async ({ page }, info) => {
  const msg = "За този телефон вече има няколко заявки. Обадете ни се на 0894 36 55 77.";
  await page.route("**/api/reservations", (r) => r.request().method() === "POST"
    ? r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "throttled", message: msg }) }) : r.continue());
  await toStep2(page, future(info.project.name === "phone" ? 36 : 37));
  await pickFree(page);
  await next(page).click();
  await page.fill("#f-name", "Тест");
  await page.fill("#f-phone", "0888 12 34 56");
  await next(page).click();
  await expect(page.locator(".alert.bad")).toContainText(msg);
});
