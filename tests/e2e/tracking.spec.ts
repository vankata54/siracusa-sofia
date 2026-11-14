import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";

/* Tracking (/porachka/<номер>-<ключ>/; the server may run with TRACK_KEY_REQUIRED=1): not found, pre-order "за утре" + "Промени", live status over SSE (the manager changes it),
   rating Да / Не through api.ratings.submit, the success content right after checkout, the prototype panel only with ?preview=1.
   Orders are made "за утре", so the test works at any hour (today's orders are refused after 22:30). */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function cookies(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
}
async function makeOrder(request: APIRequestContext, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const r = await request.post("/api/orders", { headers, data: {
    cart: { mode: "delivery", lines: [{ id: "pitsa-s-burata-i-proshuto-krudo", q: 2, mods: ["без лук"] }, { id: "gratska-salata", q: 1, mods: [] }] },
    zone: "Дружба 2", addr: "бл. 311", name: "Иван Петров", phone: "0888123456", pay: "card", sched: "утре", slot: "19:00", ...extra,
  } });
  expect(r.status()).toBe(201);
  const o = await r.json();
  expect(o.key).toMatch(/^[a-z0-9]{8}$/);
  return o;
}
/** the tracking address with the secret key */
const trk = (o: { no: string; key: string }) => "/porachka/" + o.no + "-" + o.key + "/";
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
/** the manager changes the status (the page gets it over SSE) */
async function staffCtx(playwright: { request: { newContext: (o: { baseURL?: string }) => Promise<APIRequestContext> } }, baseURL: string | undefined) {
  const E = env();
  const staff = await playwright.request.newContext({ baseURL });
  expect((await staff.post("/api/auth/login", { data: { username: "manager", password: E.MANAGER_PASSWORD } })).ok()).toBe(true);
  return { staff, set: async (no: string, status: string) => expect((await staff.patch("/api/admin/orders/" + no, { data: { status } })).ok()).toBe(true) };
}
const sofia = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("tracking: unknown number -> polite empty state, noindex, one h1", async ({ page }) => {
  const errors = watch(page);
  await cookies(page);
  await page.goto("/porachka/999999/");
  await expect(page.locator("h1")).toHaveText("Не намираме поръчка № 999999");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('a[href^="tel:"]', { hasText: "Обади се · 0894 36 55 77" })).toBeVisible();
  await expect(page.getByText("Само в прегледа")).toHaveCount(0);
  await noHScroll(page);
  /* "Опитай пак": the same answer again, the focus on the heading (not <body>), so a screen reader reads it */
  await page.getByRole("button", { name: "Опитай пак" }).click();
  await expect(page.locator("h1")).toHaveText("Не намираме поръчка № 999999");
  await expect(page.locator("h1")).toBeFocused();
  expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
});

test("tracking: server error -> 'Опитай пак' keeps the focus on the heading, then it tries again by itself", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await page.clock.install();
  await cookies(page);
  await page.route("**/api/orders/*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "server", message: "x" }) }));
  await page.goto(trk(o));
  await expect(page.locator("h1")).toHaveText("Не успяхме да заредим поръчка № " + o.no);
  await page.getByRole("button", { name: "Опитай пак" }).click();
  await expect(page.locator("h1")).toHaveText("Не успяхме да заредим поръчка № " + o.no);
  await expect(page.locator("h1")).toBeFocused();
  /* the server answers again: no "online" event comes, the page tries by itself (15 s) */
  await page.unroute("**/api/orders/*");
  await page.clock.fastForward(16_000);
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  expect(errors.filter((e) => !/500/.test(e))).toEqual([]);
});

test("tracking: pre-order for tomorrow, Промени, share, no prototype panel without preview", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o));
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  await expect(page.locator(".elab")).toContainText("Приета за утре");
  await expect(page.locator(".enum.clock b")).toHaveText("19:00");
  await expect(page.locator(".tl li")).toHaveCount(5);
  await expect(page.locator(".oline")).toHaveCount(2);
  await expect(page.locator(".oline .mod")).toHaveText("Без лук");
  await expect(page.locator(".okv")).toContainText("Карта при получаване");
  await expect(page.locator(".okv .tot")).toContainText("26,52 €");
  await expect(page.locator("[data-sim]")).toHaveCount(0);
  await page.locator("[data-change]").click();
  await expect(page.locator(".sheet")).toContainText("по телефона до 18:00");
  await expect(page.locator(".sheet a[href^='tel:']")).toBeVisible();
  await page.locator(".sheet [data-close]").click();
  /* "Сподели" gives the address with the key */
  await page.evaluate(() => { (navigator as unknown as { share?: unknown }).share = undefined; (window as unknown as { _c: string })._c = ""; navigator.clipboard.writeText = async (t: string) => { (window as unknown as { _c: string })._c = t; }; });
  await page.locator("[data-share]").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { _c: string })._c)).toMatch(new RegExp("/porachka/" + o.no + "-" + o.key + "/$"));
  await noHScroll(page);
  expect(errors).toEqual([]);
});

test("tracking: live status from the kitchen, then rating Да / Не", async ({ page, request, playwright, baseURL }) => {
  const E = env();
  test.skip(!E.MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o));
  await expect(page.locator(".tl li.now .nm")).toHaveText("Приета");
  const staff = await playwright.request.newContext({ baseURL });
  expect((await staff.post("/api/auth/login", { data: { username: "manager", password: E.MANAGER_PASSWORD } })).ok()).toBe(true);
  const set = async (status: string) => expect((await staff.patch("/api/admin/orders/" + o.no, { data: { status } })).ok()).toBe(true);
  /* a live update redraws the hero: the focus stays on the same control (here "Сподели"), never on <body> */
  await page.locator("[data-share]").focus();
  await set("cooking");
  await expect(page.locator(".tl li.now .nm")).toHaveText("Готви се");
  await expect(page.locator(".say")).toHaveText("Пицата е в пещта");
  await expect(page.locator("[data-share]")).toBeFocused();
  await set("ready"); await set("on_way"); await set("delivered");
  await expect(page.locator("#rate-h")).toHaveText("Останахте ли доволни?");
  await expect(page.locator(".trk-live")).toContainText("Доставена");
  /* ratings.submit answers 409 not_finished (e.g. the kitchen took the step back): a clear message, no code */
  let first = true;
  await page.route("**/api/ratings", (r) => { if (!first) return r.continue(); first = false; return r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "not_finished", message: "x" }) }); });
  await page.locator('[data-rate="yes"]').click();
  await expect(page.locator(".toast", { hasText: "след като е доставена" })).toBeVisible();
  await expect(page.locator(".code")).toHaveCount(0);
  await expect(page.locator("#rate-h")).toBeVisible();
  await page.locator('[data-rate="yes"]').click();
  await expect(page.locator(".code .v")).toHaveText(/^SC10-\d{10}$/);
  const code = await page.locator(".code .v").textContent();
  await expect(page.locator(".code p")).toContainText("в полето „Код за отстъпка“");
  await expect(page.locator(".code p")).not.toContainText("телефонен номер");
  await expect(page.getByText("Напиши отзив в Google")).toBeVisible();
  await expect(page.getByText("[ЛИПСВА: линк към профила в Google]")).toBeVisible();
  await page.locator("[data-rate-reset]").click();
  await page.locator('[data-rate="no"]').click();
  await expect(page.locator(".code .v")).toHaveText(code!);           // the same code for both answers
  await expect(page.locator(".ans a", { hasText: "Отзив в Google" })).toBeVisible();          // Google link also after "Не"
  await page.locator("[data-fb]").click();
  await expect(page.locator("#fbe")).toHaveText("Напишете няколко думи, за да го изпратим.");
  await page.locator("#fb").fill("Пицата пристигна студена.");
  await page.locator("[data-fb]").click();
  await expect(page.getByText("Изпратихме го на управителя.")).toBeVisible();
  await expect(page.locator("[data-again]")).toContainText("Поръчай същото · 26,52 €");
  /* the code on the next order: "Отстъпка с код" in the order summary (o.codeDisc) */
  const o2 = await makeOrder(request, { code });
  expect(o2.discKind).toBe("code");
  await page.goto(trk(o2));
  await expect(page.locator(".okv .disc")).toHaveText(/Отстъпка с код\s*-2,65 €/);
  await expect(page.locator(".okv")).not.toContainText("Отстъпка след 15:00");
  await staff.dispose();
  expect(errors.filter((e) => !/409/.test(e))).toEqual([]);   /* the network line of the mocked 409 */
});

test("tracking: right after checkout shows the success content on top", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await page.addInitScript((ord) => { try { localStorage.setItem("sc-cookie", '"min"'); if (!sessionStorage.getItem("t")) { localStorage.setItem("sc-order", JSON.stringify(ord)); sessionStorage.setItem("t", "1"); } } catch { /* ignore */ } }, o);
  await page.goto("/porachka/" + o.no + "/");   /* the cart's address without the key: the key comes from sc-order */
  await expect(page.locator("h1")).toHaveText("Благодарим! Поръчката е приета.");
  await expect(page).toHaveURL(new RegExp("/porachka/" + o.no + "-" + o.key + "/$"));
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".ono")).toContainText("№ " + o.no);
  await expect(page.locator(".okhead .lead")).toContainText("Иван,");
  await expect(page.getByText("Направи профил и вземи -10% от следващата поръчка")).toBeVisible();
  const sw = page.locator("[data-bday]");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#bd-d")).toBeVisible();
  /* second opening: the normal tracking title */
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  expect(errors).toEqual([]);
});

test("tracking: ?preview=1 shows the prototype panel and 'Симулирай: доставена'", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o) + "?preview=1&t=12:30");
  await page.getByRole("button", { name: "Симулирай: доставена" }).click();
  await expect(page.locator("#rate-h")).toBeVisible();
  await expect(page.locator(".elab")).toHaveText("Доставена в");
  /* the same hour in the hero and on the last step (no real time for a simulated step) */
  await expect(page.locator(".tl li").last().locator(".tm")).toHaveText((await page.locator(".enum.clock b").textContent())!);
  /* a simulated state: the real order is not delivered, so no API call and a sample code, marked as such */
  await page.locator('[data-rate="yes"]').click();
  await expect(page.locator(".code .v")).toHaveText("SC10-0000000000");
  await expect(page.locator(".code")).toContainText("Примерен код: само в прегледа.");
  await noHScroll(page);
  expect(errors).toEqual([]);
});

test("tracking: the key in the address, the number alone on screen; a wrong key is 'not found'", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o));
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  await expect(page.locator(".trk-live")).toBeVisible();
  await page.goto("/porachka/" + o.no + "-zzzzzzzz/");
  await expect(page.locator("h1")).toHaveText("Не намираме поръчка № " + o.no);
  expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
});

test("tracking: pickup today for a chosen hour shows that hour, not 'около N мин'", async ({ page, request }) => {
  /* at any real hour: the order is made at 12:30 on the test server's clock (SC_PREVIEW_API=1, x-sc-clock) and the page
     runs on the same preview clock */
  const slot = "14:00";
  const errors = watch(page);
  const o = await makeOrder(request, { cart: { mode: "pickup", lines: [{ id: "pitsa-s-burata-i-proshuto-krudo", q: 1, mods: [] }] }, sched: "", slot, zone: "", addr: "" }, { "x-sc-clock": "12:30" });
  expect(o.at).toBe(slot);
  await cookies(page);
  await page.goto(trk(o) + "?preview=1&t=12:30");
  await expect(page.locator(".elab")).toContainText("Приета за днес");
  await expect(page.locator(".enum.clock b")).toHaveText(slot);
  await expect(page.locator(".say")).toHaveText("Ще е готова за този час");
  await expect(page.locator(".enum .u")).toHaveCount(0);   /* no "мин" */
  await expect(page.locator(".tl li")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("tracking: the times are in Sofia time in a browser in another zone", async ({ browser, request, playwright, baseURL }) => {
  const ctx = await browser.newContext({ baseURL, timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o));
  await expect(page.locator(".elab")).toContainText("Приета за утре");
  await expect(page.locator(".enum.clock b")).toHaveText("19:00");
  await expect(page.locator(".sub")).toContainText("до 18:00");
  /* "Доставена в": updatedAt on the Sofia clock */
  const E = env();
  if (E.MANAGER_PASSWORD) {
    const staff = await playwright.request.newContext({ baseURL });
    expect((await staff.post("/api/auth/login", { data: { username: "manager", password: E.MANAGER_PASSWORD } })).ok()).toBe(true);
    for (const st of ["cooking", "ready", "on_way", "delivered"]) expect((await staff.patch("/api/admin/orders/" + o.no, { data: { status: st } })).ok()).toBe(true);
    await staff.dispose();
    const before = sofia(new Date(Date.now() - 60000)), after = sofia(new Date(Date.now() + 60000)), mid = sofia(new Date());
    await expect(page.locator(".elab")).toHaveText("Доставена в");
    expect([before, mid, after]).toContain(await page.locator(".enum.clock b").textContent());
    /* every step at the hour the core kept (order.times), on the Sofia clock; "Доставена в" = the last step of the timeline */
    const pub = await (await request.get("/api/orders/" + o.no + "-" + o.key)).json();
    const tms = page.locator(".tl .tm");
    await expect(tms.nth(1)).toHaveText(sofia(new Date(pub.times.cooking)));
    await expect(tms.nth(2)).toHaveText(sofia(new Date(pub.times.ready)));
    await expect(tms.nth(3)).toHaveText(sofia(new Date(pub.times.on_way)));
    await expect(tms.nth(4)).toHaveText(sofia(new Date(pub.times.delivered)));
    await expect(page.locator(".enum.clock b")).toHaveText(sofia(new Date(pub.times.delivered)));
  }
  await ctx.close();
  expect(errors).toEqual([]);
});

test("tracking: the minute tick and a live update keep the complaint text, the caret and the focus", async ({ page, request, playwright, baseURL }) => {
  test.skip(!env().MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  const { staff, set } = await staffCtx(playwright, baseURL);
  for (const st of ["cooking", "ready", "on_way", "delivered"]) await set(o.no, st);
  await page.clock.install();
  await cookies(page);
  await page.goto(trk(o));
  await page.locator('[data-rate="no"]').click();
  const fb = page.locator("#fb");
  await fb.click();
  await page.keyboard.type("Пицата пристигна");
  await page.clock.fastForward(61_000);   /* sc:tick */
  await expect(fb).toBeFocused();
  await expect(fb).toHaveValue("Пицата пристигна");
  /* a live event (SSE): the order is read again */
  const read = page.waitForResponse((r) => /\/api\/orders\/\d+-/.test(r.url()) && r.request().method() === "GET");
  await set(o.no, "delivered");
  await read;
  await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => ok(null))));
  await page.keyboard.type(" студена.");
  await expect(fb).toHaveValue("Пицата пристигна студена.");
  await expect(fb).toBeFocused();
  /* the birthday select is not closed / redrawn by the tick either */
  await staff.dispose();
  expect(errors).toEqual([]);
});

test("tracking: a cancelled order while watching: toast, focus on the heading", async ({ page, request, playwright, baseURL }) => {
  test.skip(!env().MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  const { staff, set } = await staffCtx(playwright, baseURL);
  await cookies(page);
  await page.goto(trk(o));
  await page.locator("[data-change]").focus();
  await set(o.no, "cancelled");
  await expect(page.locator(".state h2")).toHaveText("Поръчката е отказана");
  await expect(page.locator(".toast")).toContainText("Поръчката е отказана");
  await expect(page.locator(".state h2")).toBeFocused();
  await staff.dispose();
  expect(errors).toEqual([]);
});

test("tracking: the live stream drops: no 'На живо', and the order is read again when it is back", async ({ page, request, playwright, baseURL }) => {
  test.skip(!env().MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  const { staff, set } = await staffCtx(playwright, baseURL);
  await cookies(page);
  await page.route("**/api/stream**", (r) => r.abort());
  await page.goto(trk(o));
  await expect(page.locator(".trk-live")).toContainText("Свързваме се отново…");
  await expect(page.locator(".trk-live")).not.toContainText("На живо");
  await set(o.no, "cooking");                 /* missed: the stream is down */
  await page.unroute("**/api/stream**");      /* the browser reconnects by itself (about 3 s) */
  await expect(page.locator(".tl li.now .nm")).toHaveText("Готви се", { timeout: 15_000 });
  await expect(page.locator(".trk-live")).toContainText("На живо");
  await staff.dispose();
  expect(errors.filter((e) => !/stream|ERR_FAILED/.test(e))).toEqual([]);
});

test("tracking: Промени gives a new hour online for an order for tomorrow; errors stay in the sheet with focus", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o));
  await expect(page.locator(".enum.clock b")).toHaveText("19:00");
  await page.locator("[data-change]").click();
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh.locator('[data-slot="19:00"]')).toHaveAttribute("aria-pressed", "true");
  await expect(sh.locator('[data-slot="19:00"]')).toContainText("сега");
  await expect(sh).toContainText("Ястия, адрес или плащане: промени приемаме по телефона до 18:00");
  await expect(sh.locator('a[href^="tel:"]')).toBeVisible();
  /* the cart's rule for a delivery for tomorrow: 10:30 to 20:45 every 15 min */
  await sh.locator("[data-allslots]").click();
  await expect(sh.locator("[data-slot]").first()).toHaveAttribute("data-slot", "10:30");
  await expect(sh.locator("[data-slot]").last()).toHaveAttribute("data-slot", "20:45");
  await expect(sh.locator("[data-slot]")).toHaveCount(42);
  /* 422 fields.slot from the core: in the sheet, with the focus on it */
  let n = 0;
  await page.route("**/api/orders/*", (r) => {
    if (r.request().method() !== "PATCH" || n++ > 0) return r.continue();
    return r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "invalid", message: "Проверете полетата.", fields: { slot: "Изберете час от списъка." } }) });
  });
  await sh.locator('[data-slot="20:00"]').click();
  await expect(sh.locator('[data-slot="20:00"]')).toHaveAttribute("aria-pressed", "true");
  await expect(sh.locator('[data-slot="20:00"]')).toBeFocused();
  await sh.locator("[data-chg-save]").click();
  await expect(sh.locator(".chg-err")).toContainText("Изберете час от списъка.");
  await expect(sh.locator(".chg-err")).toBeFocused();
  /* the real change */
  await sh.locator("[data-chg-save]").click();
  await expect(page.locator(".sheetwrap.on")).toHaveCount(0);
  await expect(page.locator(".enum.clock b")).toHaveText("20:00");
  await expect(page.locator(".sub")).toContainText("до 19:00");
  await expect(page.locator(".toast")).toContainText("Часът е сменен");
  await expect(page.locator("[data-change]")).toBeFocused();
  expect((await (await request.get("/api/orders/" + o.no + "-" + o.key)).json()).at).toBe("20:00");
  /* 409 too_late (the deadline passed meanwhile): no hours any more, only the phone */
  await page.unroute("**/api/orders/*");
  await page.route("**/api/orders/*", (r) => r.request().method() !== "PATCH" ? r.continue()
    : r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "too_late", message: "Промени приемаме до 1 час преди часа на поръчката. Обадете се на 0894 36 55 77." }) }));
  await page.locator("[data-change]").click();
  await sh.locator('[data-slot="20:15"]').click();
  await sh.locator("[data-chg-save]").click();
  await expect(sh.locator(".chg-err")).toContainText("Промени приемаме до 1 час преди часа");
  await expect(sh.locator(".chg-err")).toBeFocused();
  await expect(sh.locator("[data-chg-save]")).toHaveCount(0);
  await expect(sh.locator('a[href^="tel:"]')).toBeVisible();
  await noHScroll(page);
  expect(errors.filter((e) => !/422|409/.test(e))).toEqual([]);
});

/* Web Push: the browser's push service is replaced by a stub (no network to a push service here); the API calls are checked */
async function pushStub(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w._n = 0; w._hidden = false;
    class N { static permission = "granted"; static async requestPermission() { return "granted"; } constructor() { (w._n as number)++; w._n = (w._n as number); } }
    Object.defineProperty(window, "Notification", { value: N, configurable: true });
    Object.defineProperty(document, "hidden", { get: () => w._hidden, configurable: true });
    const sub = { endpoint: "https://push.example/abc", toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "x", auth: "y" } }) };
    const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
    Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg }, configurable: true });
  });
}
test("tracking: Включи известията with Web Push ('on'): server notifications, none from the page; Изключи unsubscribes", async ({ page, request, playwright, baseURL }) => {
  test.skip(!env().MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  const { staff, set } = await staffCtx(playwright, baseURL);
  await cookies(page);
  await pushStub(page);
  const calls: string[] = [];
  await page.route("**/api/push/**", (r) => {
    const u = new URL(r.request().url()).pathname; calls.push(u + " " + (r.request().postData() || ""));
    if (u.endsWith("/key")) return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ key: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U" }) });
    return r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  let loaded = false;
  page.on("request", (r) => { if (/\/push\.[\w-]+\.js/.test(r.url())) loaded = true; });
  await page.goto(trk(o));
  await expect(page.locator("[data-notify]")).toBeVisible();
  expect(loaded).toBe(false);                 /* not in the first JS */
  await page.locator("[data-notify]").click();
  await expect(page.locator(".okline")).toContainText("Известията са включени");
  await expect(page.locator(".okline")).toContainText("Ще получите известие на този телефон.");
  expect(calls.some((c) => c.startsWith("/api/push/subscribe") && c.includes(o.no + "-" + o.key) && c.includes("push.example"))).toBe(true);
  /* a status while the page is in the background: the server sends it, the page does not show a second one */
  await page.evaluate(() => { (window as unknown as { _hidden: boolean })._hidden = true; });
  await set(o.no, "cooking");
  await expect(page.locator(".tl li.now .nm")).toHaveText("Готви се");
  expect(await page.evaluate(() => (window as unknown as { _n: number })._n)).toBe(0);
  await page.locator("[data-notify-off]").click();
  await expect.poll(() => calls.some((c) => c.startsWith("/api/push/unsubscribe") && c.includes("push.example/abc"))).toBe(true);
  await expect(page.locator("[data-notify]")).toBeFocused();
  await staff.dispose();
  expect(errors).toEqual([]);
});

test("tracking: Включи известията without a push server ('local'): the page tells while it is open", async ({ page, request, playwright, baseURL }) => {
  test.skip(!env().MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  const { staff, set } = await staffCtx(playwright, baseURL);
  await cookies(page);
  await pushStub(page);
  await page.route("**/api/push/key", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "push_unavailable", message: "x" }) }));
  await page.goto(trk(o));
  await page.locator("[data-notify]").click();
  await expect(page.locator(".okline")).toContainText("Известията са включени");
  await expect(page.locator(".okline")).toContainText("Ще ви кажем тук, докато страницата е отворена.");
  await page.evaluate(() => { (window as unknown as { _hidden: boolean })._hidden = true; });
  await set(o.no, "cooking");
  await expect(page.locator(".tl li.now .nm")).toHaveText("Готви се");
  await expect.poll(() => page.evaluate(() => (window as unknown as { _n: number })._n)).toBe(1);
  await staff.dispose();
  expect(errors.filter((e) => !/503/.test(e))).toEqual([]);
});

test("tracking: the loading words come into the live region after it is on the page", async ({ page, request }) => {
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto(trk(o) + "?preview=1&t=12:30");
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  await page.locator("[data-pv]").getByRole("button", { name: "Зареждане" }).click();
  const st = page.locator("[data-skst]");
  await expect(st).toHaveAttribute("role", "status");
  await expect(st).toHaveText("Зареждаме поръчката…");
});
