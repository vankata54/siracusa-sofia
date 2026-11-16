import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/reports/ (design/pages-admin/reports.html): the numbers are those of the core (GET /api/admin/reports), the sums
   „10,22 €“, the axis ticks whole; the period (tabs on the computer, a select on the phone), „Сравни с предишния“,
   „Таблица“ for every chart, „Период“ up to 92 days; the cost is [ЛИПСВА]; marketing gets „Нямате права“; 360; axe. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD], owner: ["owner", E.OWNER_PASSWORD] };
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
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const eur = (v: number) => v.toFixed(2).replace(".", ",") + " €";
type Rep = { orders: number; revenue: number; avg: number; reservations: number; top: { name: string }[] };
async function open(page: Page, hash = "") {
  await page.goto("/admin/reports/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Отчети");
  await expect(page.locator(".rp-bar")).toBeVisible();
}

test("the numbers are the core's; the sums „10,22 €“, the axis ticks whole; „Таблица“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  /* one order so the report is not empty */
  const o = await context.request.post("/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode: "pickup", lines: [{ id: "kebapcheta", q: 2 }] }, name: "Отчет Тест", phone: "0888 77 66 5" + Math.floor(Math.random() * 10) } });
  expect(o.status()).toBe(201);
  await open(page);
  const r = (await (await context.request.get("/api/admin/reports?period=7")).json()) as Rep;
  const kp = page.locator(".kp");
  await expect(kp.locator("> div").nth(0).locator("b")).toHaveText(String(r.orders));
  await expect(kp.locator("> div").nth(1).locator("b")).toHaveText(eur(r.revenue).replace(".", ","));
  await expect(kp.locator("> div").nth(2).locator("b")).toHaveText(eur(r.avg));
  await expect(page.locator(".rp-top")).toContainText(r.top[0].name);
  /* the ticks of the axes are whole numbers */
  const ticks = await page.locator(".plot .ya span").allTextContents();
  for (const t of ticks) expect(t.replace(/\s|€/g, ""), t).toMatch(/^\d+$/);
  await expect(page.locator(".cost")).toContainText("[ЛИПСВА: себестойност на ястията]");
  /* „Таблица“ and back */
  const btn = page.locator('[data-tbl="ch"]');
  await btn.click();
  await expect(page.locator('[aria-labelledby="h-ch"] table')).toContainText("Сайт");
  await page.locator('[data-tbl="ch"]').click();
  await expect(page.locator('[aria-labelledby="h-ch"] table')).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("the period: today; „Сравни с предишния“ off; the address keeps it", async ({ page, context }) => {
  await signIn(context, "admin");
  await open(page);
  if (isPhone(page)) await page.locator("[data-psel]").selectOption("today");
  else await page.locator('.rp-bar [role=tab][data-per="today"]').click();
  await expect(page).toHaveURL(/#p=today/);
  await expect(page.locator('[aria-labelledby="h-main"] h2')).toContainText("Оборот по час");
  await expect(page.locator(".rp-meta")).toContainText("спрямо");
  await page.locator(".cmp").click();
  await expect(page).toHaveURL(/c=0/);
  await expect(page.locator(".rp-meta")).not.toContainText("спрямо");
  await expect(page.locator(".dl")).toHaveCount(0);
});

test("„Период“: up to 92 days; the server refuses more", async ({ page, context }) => {
  await signIn(context, "admin");
  await open(page, "#p=custom&a=2026-01-01&b=2026-11-01");
  const a = page.locator("[data-ca]"), b = page.locator("[data-cb]");
  await expect(b).toHaveValue("2026-11-01");
  await expect(a).toHaveValue("2026-08-02"); /* cut to 92 days */
  await a.fill("2026-05-01"); await a.dispatchEvent("change");
  await expect(page.locator(".sa-toast")).toContainText("До 92 дни");
  await expect(page.locator("[data-ca]")).toHaveValue("2026-08-02");
  expect((await context.request.get("/api/admin/reports?period=custom&from=2026-01-01&to=2026-11-01")).status()).toBe(422);
});

test("marketing (without „Отчети“) gets „Нямате права“; the server refuses", async ({ page, context }) => {
  await signIn(context, "marketing");
  await page.goto("/admin/reports/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await context.request.get("/api/admin/reports")).status()).toBe(403);
});

test("the error state and „Опитай пак“", async ({ page, context }) => {
  await signIn(context, "owner");
  let fail = true;
  await page.route(/\/api\/admin\/reports/, (r) => (fail ? r.fulfill({ status: 500, json: { error: "server", message: "Грешка" } }) : r.continue()));
  await page.goto("/admin/reports/");
  await expect(page.locator(".sa-banner.danger")).toContainText("Не успяхме да сметнем отчета");
  fail = false;
  await page.locator('[data-sa="retry"]').click();
  await expect(page.locator(".kp, .sa-empty").first()).toBeVisible();
});

test("@phone 360: no horizontal scroll; the period is a select", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await open(page, "#p=30");
  await expect(page.locator("[data-psel]")).toBeVisible();
  await expect(page.locator(".rp-bar .sa-tabs")).toBeHidden();
  const over = await page.evaluate(() => { const s = document.querySelector(".sa-scroller")!; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
  expect(over).toBeLessThanOrEqual(0);
});

test("axe: no serious on „Отчети“ (charts and tables)", async ({ page, context }) => {
  await signIn(context, "admin");
  await open(page);
  const serious = async () => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
  expect(await serious()).toEqual([]);
  if (await page.locator('[data-tbl="main"]').count()) { await page.locator('[data-tbl="main"]').click(); expect(await serious()).toEqual([]); }
});
