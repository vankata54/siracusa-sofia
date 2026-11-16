import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/orders/ (design/pages-admin/orders.html, decisions 15.11 and 16.11.2026): one step with "Отмени", "Откажи" with a
   required reason that the tracking page shows, "Покажи телефона" into the log, "Нова поръчка по телефон", a new online
   order live (the ember banner, the blinking badge stops when it is seen), the hash filters, the rights, 360 and axe.
   The orders are pre-orders "за утре" (accepted at any hour, they belong to today's list by the time they were made), so
   the tests work at any hour; only the phone order needs the kitchen open now (the server's real clock): outside 10:00-22:20
   the test checks that the form says so and does not send. Every test uses its own order number. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD] };
async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[134]/.test(m.text())) list.push(m.text()); });
  return list;
}
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const rnd = () => String(Math.floor(Math.random() * 90) + 10);
/** a web pre-order for tomorrow (pickup or delivery); returns {no, key} */
async function webOrder(req: APIRequestContext, mode: "pickup" | "delivery" = "pickup"): Promise<{ no: string; key: string }> {
  const r = await req.post("/api/orders", { data: {
    cart: { mode, lines: [{ id: "kebapcheta", q: 2, mods: [] }, { id: "gratska-salata", q: 1, mods: [] }] }, name: "Иван Петров", phone: "0888 12 34 " + rnd(), pay: "cash",
    sched: "утре", slot: "19:00", ...(mode === "delivery" ? { zone: "Дружба 2", addr: "Дружба 2, бл. 311" } : {}),
  } });
  expect(r.status()).toBe(201);
  return r.json();
}
async function openOrders(page: Page, hash = "") {
  await page.goto("/admin/orders/" + (hash ? "#" + hash : ""));
  await expect(page.locator(".sa-h1")).toHaveText("Поръчки");
  await expect(page.locator("#or-list .sa-skel")).toHaveCount(0);
}
const card = (page: Page, no: string) => page.locator('article.oc[data-no="' + no + '"]');
async function undo(page: Page) {
  await expect(page.locator(".sa-toast")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
}
const detailOf = async (ctx: BrowserContext, no: string) => (await (await ctx.request.get("/api/admin/orders/" + no + "/detail")).json()) as { status: string; reason?: string; channel: string; total: number; phone: string };

test("one step with „Отмени“: Приета -> Готви се -> back; the tab counts and the hash", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  const o = await webOrder(context.request);
  await openOrders(page, "s=accepted");
  await expect(page.locator(page.viewportSize()!.width < 1100 ? "#or-st" : '[data-tab="accepted"]')).toBeVisible();
  const c = card(page, o.no);
  await expect(c).toContainText("№ " + o.no);
  await expect(c.locator(".stt")).toHaveText("Приета");
  await expect(c).toContainText("За утре 19:00");
  await expect(c).toContainText("2 ×Кебапчета");
  await c.getByRole("button", { name: "Готви се: № " + o.no }).click();
  await expect(page.locator(".sa-toast")).toContainText("№ " + o.no + ": Готви се");
  /* in "Приета" it is gone, the server has it */
  await expect(c).toHaveCount(0);
  expect((await detailOf(context, o.no)).status).toBe("cooking");
  await undo(page);
  await expect(card(page, o.no).locator(".stt")).toHaveText("Приета");
  await expect.poll(async () => (await detailOf(context, o.no)).status).toBe("accepted");
  /* the hash keeps the tab */
  expect(page.url()).toContain("#s=accepted");
  expect(errs).toEqual([]);
});

test("„Откажи“ needs a reason; the customer sees it on the tracking page; the card says it", async ({ page, context, browser }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  const o = await webOrder(context.request, "delivery");
  await openOrders(page, "n=" + o.no);
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh.locator("h2")).toHaveText("№ " + o.no);
  await expect(sh.locator(".od-steps li.cur")).toContainText("Приета");
  await sh.getByRole("button", { name: "Откажи" }).click();
  const cs = page.locator(".sheetwrap.on .sheet").filter({ hasText: "Да откажем ли" });
  await expect(cs.locator("h2")).toHaveText("Да откажем ли № " + o.no + "?");
  await cs.getByRole("button", { name: "Откажи поръчката" }).click();
  await expect(cs.locator("#or-r-e")).toHaveText("Изберете причина: клиентът я вижда.");
  await cs.locator("#or-r").selectOption("Друго");
  await cs.getByRole("button", { name: "Откажи поръчката" }).click();
  await expect(cs.locator("#or-r2-e")).toHaveText("Напишете причината с няколко думи.");
  await cs.locator("#or-r2").fill("Фурната е в ремонт до утре.");
  await cs.getByRole("button", { name: "Откажи поръчката" }).click();
  await expect(page.locator(".sa-toast")).toContainText("№ " + o.no + ": Отказана (Фурната е в ремонт до утре.)");
  await expect.poll(async () => (await detailOf(context, o.no)).reason).toBe("Фурната е в ремонт до утре.");
  await page.goto("/admin/orders/#s=cancelled");
  await expect(card(page, o.no).locator(".oc-why")).toHaveText("Причина: Фурната е в ремонт до утре.");
  /* the guest's tracking page (another browser, the address with the key) */
  const g = await browser.newContext(); const gp = await g.newPage();
  await gp.goto("/porachka/" + o.no + "-" + o.key + "/");
  await expect(gp.locator(".state h2")).toHaveText("Поръчката е отказана");
  await expect(gp.locator(".state .why")).toHaveText("Причина: Фурната е в ремонт до утре.");
  await g.close();
  expect(errs).toEqual([]);
});

test("the detail: the phone is hidden until „Покажи телефона“, which goes into the log", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  const o = await webOrder(context.request, "delivery");
  await openOrders(page);
  await card(page, o.no).getByRole("button", { name: "Детайли: № " + o.no }).click();
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh.locator("[data-tel]")).toContainText("••");
  await expect(sh).toContainText("Дружба 2, бл. 311");
  await expect(sh).toContainText("Кебапчета");
  await expect(sh.locator(".od-tot .big")).toContainText("€");
  expect(page.url()).toContain("#n=" + o.no);
  await sh.getByRole("button", { name: "Покажи телефона" }).click();
  await expect(sh.getByRole("link", { name: "Обади се" })).toHaveAttribute("href", /^tel:0888123\d{3}$/);
  await expect(sh.locator("[data-tel]")).not.toContainText("••");
  const log = (await (await context.request.get("/api/admin/audit?action=order.phone_view&limit=50")).json()) as { action: string; target?: string }[];
  expect(log.some((x) => x.action === "order.phone_view" && x.target === o.no)).toBe(true);
  /* closing the sheet takes #n= away */
  await sh.getByRole("button", { name: "Затвори" }).first().click();
  await expect(page.locator(".sheetwrap.on")).toHaveCount(0);
  expect(page.url()).not.toContain("#n=");
  expect(errs).toEqual([]);
});

test("„Нова поръчка по телефон“: checks, the dishes by search, the price from the core, channel „Телефон“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "manager");
  await openOrders(page);
  await page.getByRole("button", { name: "Нова поръчка по телефон" }).first().click();
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh.locator("h2")).toHaveText("Нова поръчка по телефон");
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
  const m = (hm[0] % 24) * 60 + hm[1];
  if (m < 600 || m >= 1350) {
    /* the kitchen is closed now: the form says so and does not send */
    await expect(sh.locator(".sa-banner")).toContainText("Кухнята е затворена");
    await expect(page.locator(".sheetwrap.on .sa-sfoot [data-ok]")).toBeDisabled();
    return;
  }
  test.info().annotations.push({ type: "kitchen", description: "open" });
  /* the checks of the form */
  await sh.locator("[data-pmode=pickup]").click();
  await page.locator(".sheetwrap.on .sa-sfoot [data-ok]").click();
  await expect(sh.locator("#po-tel-e")).toContainText("10 цифри");
  await expect(sh.locator("#po-lines-e")).toHaveText("Добавете поне едно ястие.");
  await sh.locator("#po-tel").fill("0888 77 66 " + rnd());
  await sh.locator("#po-name").fill("Мария");
  /* the search of the site: Latin, the counter after "Добави" */
  await sh.locator("#po-q").fill("kebap");
  await sh.getByRole("button", { name: "Добави Кебапчета" }).click();
  await sh.getByRole("button", { name: "Още едно: Кебапчета" }).first().click();
  await expect(sh.locator(".po-lines .po-line")).toHaveCount(1);
  await expect(sh.locator(".po-lines output")).toHaveText("2");
  const label = await page.locator(".sheetwrap.on [data-plabel]").textContent();
  expect(label).toMatch(/^Към кухнята · \d+,\d{2} €$/);
  await page.locator(".sheetwrap.on .sa-sfoot [data-ok]").click();
  await expect(page.locator(".sheetwrap.on")).toHaveCount(0);
  await expect(page.locator(".sa-toast")).toContainText(/№ \d+ е в кухнята/);
  const no = /№ (\d+)/.exec((await page.locator(".sa-toast .tx").textContent()) || "")![1];
  const c = card(page, no);
  await expect(c).toContainText("Телефон");
  await expect(c).toHaveClass(/fresh/);
  const d = await detailOf(context, no);
  expect(d.channel).toBe("phone");
  /* the price on the button is the core's price */
  expect(label).toContain(d.total.toFixed(2).replace(".", ",") + " €");
  expect(errs).toEqual([]);
});

test("a new online order arrives live: the ember banner and the badge blink until it is seen", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await openOrders(page);
  const o = await webOrder(context.request, "delivery");
  /* other tests make orders at the same time: the banner shows the newest one, every new card has the ember frame */
  await expect(card(page, o.no)).toHaveClass(/fresh/);
  await expect(page.locator(".or-new")).toContainText(/Нова поръчка № \d+/);
  await expect(page.locator(".or-new")).toContainText(/Доставка|Вземане/);
  await expect(page.locator('[data-badge="orders"].fresh').first()).toBeAttached();
  await card(page, o.no).getByRole("button", { name: "Детайли: № " + o.no }).click();
  await expect(page.locator(".sheetwrap.on .sheet h2")).toHaveText("№ " + o.no);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheetwrap.on")).toHaveCount(0);
  await expect(card(page, o.no)).not.toHaveClass(/fresh/);
  /* „Виж поръчката“ for the rest: once every new order is seen, the badge stops blinking and the banner goes */
  await expect(async () => {
    for (let i = 0; i < 8 && (await page.locator(".or-new [data-seenew]").count()); i++) {
      await page.locator(".or-new [data-seenew]").click();
      await expect(page.locator(".sheetwrap.on .sheet h2")).toContainText("№");
      await page.keyboard.press("Escape");
      await expect(page.locator(".sheetwrap.on")).toHaveCount(0);
    }
    const left = await page.locator("article.oc.fresh [data-open]").all();
    for (const b of left) { await b.click({ timeout: 2000 }); await expect(page.locator(".sheetwrap.on .sheet h2")).toContainText("№"); await page.keyboard.press("Escape"); await expect(page.locator(".sheetwrap.on")).toHaveCount(0); }
    await expect(page.locator(".or-new")).toHaveCount(0, { timeout: 500 });
    await expect(page.locator('[data-badge="orders"].fresh')).toHaveCount(0, { timeout: 500 });
  }).toPass({ timeout: 20_000 });
  expect(errs).toEqual([]);
});

test("rights: Маркетинг has no „Поръчки“; the phone order only for the main admin, the owner and the manager", async ({ page, context }) => {
  await signIn(context, "marketing");
  await page.goto("/admin/orders/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  await expect(page.locator(".or-bar")).toHaveCount(0);
  const r = await context.request.post("/api/admin/orders/phone", { data: { phone: "0888123456", name: "Х", mode: "pickup", lines: [{ id: "kebapcheta", q: 1 }] } });
  expect(r.status()).toBe(403);
});

test("filters in the address: #s=done&ch=office; the empty choice offers „Покажи всички“", async ({ page, context }) => {
  await signIn(context, "admin");
  await openOrders(page, "s=done&ch=office");
  await expect(page.locator('[data-ch="office"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#or-q").fill("никой-такъв-клиент");
  await expect(page.locator("#or-list")).toContainText("Няма поръчка с този избор.");
  await page.getByRole("button", { name: "Покажи всички" }).click();
  await expect(page.locator('[data-ch=""]')).toHaveAttribute("aria-pressed", "true");
  expect(page.url()).toContain("#s=done");
});

test("360 @phone: no horizontal scroll, the select „Статус“, axe without serious (list, detail, phone form)", async ({ page, context }) => {
  await signIn(context, "admin");
  const o = await webOrder(context.request, "delivery");
  await page.setViewportSize({ width: 360, height: 740 });
  await openOrders(page);
  await expect(page.locator("#or-st")).toBeVisible();
  await expect(card(page, o.no)).toBeVisible();
  const hs = () => page.evaluate(() => { const s = document.querySelector(".sa-scroller")!; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
  expect(await hs()).toBeLessThanOrEqual(0);
  expect(await serious(page)).toEqual([]);
  await card(page, o.no).getByRole("button", { name: "Детайли: № " + o.no }).click();
  await expect(page.locator(".sheetwrap.on .sheet h2")).toHaveText("№ " + o.no);
  await page.waitForTimeout(400);
  expect(await hs()).toBeLessThanOrEqual(0);
  expect(await serious(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheetwrap.on")).toHaveCount(0);
  await page.getByRole("button", { name: "Нова поръчка по телефон" }).first().click();
  await expect(page.locator(".sheetwrap.on .sheet h2")).toHaveText("Нова поръчка по телефон");
  await page.locator("#po-q").fill("пица");
  await page.waitForTimeout(400);
  expect(await hs()).toBeLessThanOrEqual(0);
  expect(await serious(page)).toEqual([]);
});

test("axe @desktop: the board, the detail and the cancel sheet without serious", async ({ page, context }) => {
  await signIn(context, "admin");
  const o = await webOrder(context.request);
  await openOrders(page);
  await expect(page.locator(".or-board")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await card(page, o.no).getByRole("button", { name: "Детайли: № " + o.no }).click();
  await page.locator(".sheetwrap.on").getByRole("button", { name: "Откажи" }).click();
  await expect(page.locator(".sheetwrap.on .sheet h2")).toContainText("Да откажем ли");
  await page.waitForTimeout(400);
  expect(await serious(page)).toEqual([]);
});
