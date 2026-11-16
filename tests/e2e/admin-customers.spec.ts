import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/customers/ (design/pages-admin/customers.html): the list with the phone partly hidden; „Покажи“ gives the whole
   number and writes „customer.phone_view“ in the log; the consents are tags only; feedback „Прегледано“ with „Отмени“;
   GDPR „Изтрий профила“: confirmation, 10 s for „Отмени“ (the profile stays), after the window it is gone for good;
   the empty state; marketing without the section gets „Нямате права“ (and the server 403); 360; axe.
   Every test makes its own customer (SMS sign-in through the API, a random phone). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD] };
async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]/.test(m.text())) list.push(m.text()); });
  return list;
}
/** a new customer with a profile (SMS sign-in with the demo code), in its own request context */
async function customer(request: APIRequestContext, name: string): Promise<{ phone: string; name: string }> {
  const phone = "0887" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
  const rq = await (await request.post("/api/auth/sms/request", { data: { phone } })).json();
  const v = await request.post("/api/auth/sms/verify", { data: { phone, code: rq.demoCode, name } });
  expect(v.status()).toBe(200);
  return { phone, name };
}
const masked = (p: string) => p.slice(0, 4) + " •• •• " + p.slice(8);
const uniq = (s: string) => s + " " + Math.random().toString(36).slice(2, 6).toUpperCase();
async function open(page: Page, hash = "") {
  await page.goto("/admin/customers/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Клиенти");
  await expect(page.locator(".cu-top [data-tab]").first()).toBeVisible();
}
const rowOf = (page: Page, name: string) => page.locator("tr[data-c]", { hasText: name });

test("the phone is hidden; „Покажи“ shows it and writes the log; the consents are tags", async ({ page, context, playwright }) => {
  const errs = errors(page);
  const guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const c = await customer(guest, uniq("Тест Клиент")); await guest.dispose();
  await signIn(context, "admin");
  await open(page);
  const row = rowOf(page, c.name);
  await expect(row).toContainText(masked(c.phone));
  await expect(row).not.toContainText(c.phone.slice(4, 8));
  await expect(row.locator(".cu-tags")).toContainText("Без съгласия");
  expect(await row.innerText()).not.toMatch(/\d (яну|фев|мар|апр|юни|юли|авг|сеп|окт|ное|дек)(?![а-я])/); /* "пн, 16 ноември" */
  await row.locator("[data-open]").click();
  const sheet = page.locator(".sheetwrap.on");
  await expect(sheet.locator("h2")).toHaveText("Профил");
  await expect(sheet).toContainText(c.name);
  await expect(sheet).toContainText("[ЛИПСВА: правило за печатите]");
  await expect(sheet.locator("input[type=checkbox]")).toHaveCount(0); /* the consents are only tags */
  await sheet.locator("[data-reveal]").click();
  const full = c.phone.slice(0, 4) + " " + c.phone.slice(4, 6) + " " + c.phone.slice(6, 8) + " " + c.phone.slice(8);
  await expect(sheet.locator("[data-phv] a")).toHaveText(full);
  const log = (await (await context.request.get("/api/admin/audit?action=customer.phone_view")).json()) as { action: string }[];
  expect(log.some((x) => x.action === "customer.phone_view")).toBe(true);
  expect(errs).toEqual([]);
});

test("GDPR: „Изтрий профила“ gives 10 s for „Отмени“; after the window the profile is gone for good", async ({ page, context, playwright }) => {
  test.setTimeout(60_000);
  const guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const a = await customer(guest, uniq("Изтрий Отмени")), b = await customer(guest, uniq("Изтрий Докрай")); await guest.dispose();
  await signIn(context, "admin");
  await open(page);
  const del = async (name: string) => {
    await rowOf(page, name).locator("[data-open]").click();
    const sheet = page.locator(".sheetwrap.on");
    await sheet.locator("[data-del]").click();
    const conf = page.locator(".sheetwrap.on").last();
    await expect(conf.locator("h2")).toHaveText("Да изтрием профила на " + name + "?");
    await conf.locator("[data-yes]").click();
    await expect(page.locator(".sa-toast")).toHaveClass(/\bon\b/);
    await expect(page.locator(".sa-toast")).toContainText("се изтрива. Окончателно след 10 секунди.");
  };
  /* „Отмени“ in the window: the profile stays */
  await del(a.name);
  await expect(rowOf(page, a.name)).toContainText("Изтрива се");
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
  await expect(page.locator(".sa-toast")).toContainText("Профилът на " + a.name + " е върнат");
  await expect(rowOf(page, a.name)).not.toContainText("Изтрива се");
  const list = async () => ((await (await context.request.get("/api/admin/customers")).json()) as { rows: { name: string; id: string }[] }).rows;
  const idA = (await list()).find((x) => x.name === a.name)!.id;
  expect((await context.request.get("/api/admin/customers/" + idA)).status()).toBe(200);
  /* no „Отмени“: gone after 10 s, also from the list on the screen */
  await del(b.name);
  const idB = (await list()).find((x) => x.name === b.name)!.id;
  await expect(rowOf(page, b.name)).toHaveCount(0, { timeout: 16_000 });
  expect((await context.request.get("/api/admin/customers/" + idB)).status()).toBe(404);
  expect((await context.request.post("/api/admin/customers/" + idB + "/restore")).status()).toBe(410);
  expect((await context.request.get("/api/admin/customers/" + idA)).status()).toBe(200);
});

test("feedback: „Прегледано“ with „Отмени“; the contact is hidden", async ({ page, context, playwright }) => {
  const guest = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  const msg = uniq("Тестово съобщение за обратната връзка");
  expect((await guest.post("/api/feedback", { data: { name: "Гост", contact: "0888 55 66 77", message: msg, topic: "Въпрос" } })).status()).toBeLessThan(300);
  await guest.dispose();
  await signIn(context, "admin");
  await open(page, "#tab=feedback");
  const card = page.locator("article.fb", { hasText: msg });
  await expect(card).toContainText("0888 •• •• 77");
  await expect(card).toContainText("Ново");
  await card.locator('[data-st="done"]').click();
  await expect(page.locator(".sa-toast")).toContainText("Отбелязано като прегледано");
  await expect(page.locator("article.fb.done", { hasText: msg })).toContainText("Прегледано");
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
  await expect(page.locator("article.fb:not(.done)", { hasText: msg })).toBeVisible();
});

test("the empty state: „Още няма профили.“", async ({ page, context }) => {
  await signIn(context, "admin");
  await page.route(/\/api\/admin\/customers(\?.*)?$/, (r) => r.fulfill({ json: { rows: [], total: 0 } }));
  await open(page);
  await expect(page.locator(".sa-empty h3")).toHaveText("Още няма профили.");
});

test("marketing (without „Клиенти“) gets „Нямате права“; the server refuses", async ({ page, context }) => {
  await signIn(context, "marketing");
  await page.goto("/admin/customers/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await context.request.get("/api/admin/customers")).status()).toBe(403);
});

test("@phone 360: no horizontal scroll, the cards and the profile", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await open(page);
  const over = () => page.evaluate(() => { const s = document.querySelector(".sa-scroller")!; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
  expect(await over()).toBeLessThanOrEqual(0);
  await page.locator("[data-tab=requests]").click();
  expect(await over()).toBeLessThanOrEqual(0);
});

test("axe: no serious on „Клиенти“ (profiles, feedback, the profile sheet)", async ({ page, context }) => {
  await signIn(context, "admin");
  await open(page);
  const serious = async () => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
  expect(await serious()).toEqual([]);
  await page.locator("[data-tab=feedback]").click();
  expect(await serious()).toEqual([]);
  await page.locator("[data-tab=profiles]").click();
  if (await page.locator("[data-open]").count()) {
    await page.locator("[data-open]").first().click();
    await expect(page.locator(".sheetwrap.on .cp-page")).toBeVisible();
    expect(await serious()).toEqual([]);
  }
});
