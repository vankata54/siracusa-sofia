import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/staff/ (design/pages-admin/staff.html): „Нов потребител“ (password ≥ 10, a random PIN by default, shown ONCE);
   a chosen easy or taken PIN: „Изберете друг ПИН.“; who manages whom (the main admin everyone; the manager only lower
   roles, never himself, never the main admin; the server refuses too); deactivating with a confirmation and „Отмени“;
   marketing gets „Нямате права“; 360; axe. Each test makes its own users (random names). */
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
  page.on("console", (m) => { if (m.type() === "error" && !/status of 4\d\d/.test(m.text())) list.push(m.text()); });
  return list;
}
const rnd = () => Math.random().toString(36).slice(2, 7);
type Row = { id: string; username: string; name: string; role: string; active: boolean; pin: string; canManage: boolean };
const rows = async (ctx: BrowserContext) => ((await (await ctx.request.get("/api/admin/staff/list")).json()) as { rows: Row[] }).rows;
async function open(page: Page, hash = "") {
  await page.goto("/admin/staff/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Персонал");
  await expect(page.locator(".sa-table, .sa-empty").first()).toBeVisible();
}
const rowOf = (page: Page, username: string) => page.locator("tr[data-u]", { has: page.locator("code", { hasText: new RegExp("^" + username + "$") }) });

test("„Нов потребител“: password ≥ 10, the random PIN is shown once", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await open(page);
  const u = "e2e.w" + rnd(), name = "Сервитьор " + rnd();
  await page.locator(".sa-head [data-new]").click();
  const s = page.locator(".sheetwrap.on");
  await s.locator("#nu-u").fill(u); await s.locator("#nu-n").fill(name);
  await s.locator("#nu-r").selectOption("waiter");
  await expect(s.locator('[data-pm="random"]')).toHaveAttribute("aria-pressed", "true");
  await s.locator("#nu-p1").fill("short"); await s.locator("#nu-p2").fill("short");
  await s.locator("[data-ok]").click();
  await expect(s.locator(".err:not([hidden])")).toHaveText("Паролата трябва да е поне 10 знака.");
  await s.locator("[data-gen]").click();
  await s.locator("[data-ok]").click();
  const once = page.locator(".sheetwrap.on [data-pin-once]");
  await expect(once).toHaveText(/^\d{4}$/);
  await page.locator(".sheetwrap.on [data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText("Създаден: " + name);
  const row = rowOf(page, u);
  await expect(row.locator(".pin")).toHaveText("••••");
  /* never again: „Управлявай“ → „Смени ПИН“ has no digits */
  await row.locator("[data-man]").click();
  await expect(page.locator(".sheetwrap.on [data-pin]")).toHaveText(/Смени ПИН/);
  await expect(page.locator(".sheetwrap.on")).not.toContainText(/\d{4}/);
  expect((await rows(context)).find((x) => x.username === u)!.pin).toBe("set");
  expect(errs).toEqual([]);
});

test("PIN: an easy one gets „Изберете друг ПИН.“; „Случаен ПИН“ is shown once", async ({ page, context }) => {
  await signIn(context, "admin");
  const u = "e2e.k" + rnd();
  expect((await context.request.post("/api/admin/staff", { data: { username: u, name: "Кухня " + rnd(), role: "kitchen", password: "dlga-parola-123" } })).status()).toBe(201);
  await open(page);
  await rowOf(page, u).locator("[data-man]").click();
  await page.locator(".sheetwrap.on [data-pin]").click();
  const s = page.locator(".sheetwrap.on").last();
  await expect(s.locator("h2")).toContainText("ПИН за");
  await s.locator("#pn").fill("1234");
  await s.locator("[data-ok]").click();
  await expect(s.locator(".err")).toHaveText("Изберете друг ПИН.");
  await s.locator("[data-rnd]").click();
  await expect(page.locator(".sheetwrap.on [data-pin-once]")).toHaveText(/^\d{4}$/);
  /* the server never gives it back */
  const r = (await rows(context)).find((x) => x.username === u)!;
  expect(JSON.stringify(r)).not.toMatch(/"\d{4}"/);
  expect(r.pin).toBe("set");
});

test("deactivate with a confirmation and „Отмени“", async ({ page, context }) => {
  await signIn(context, "admin");
  const u = "e2e.d" + rnd(), name = "Шофьор " + rnd();
  expect((await context.request.post("/api/admin/staff", { data: { username: u, name, role: "driver", password: "dlga-parola-123" } })).status()).toBe(201);
  await open(page);
  const sw = rowOf(page, u).locator("[data-act]");
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sw.click({ force: true });
  const conf = page.locator(".sheetwrap.on");
  await expect(conf.locator("h2")).toHaveText("Да деактивираме " + name + "?");
  await conf.locator("[data-yes]").click();
  await expect(page.locator(".sa-toast")).toContainText(name + " е деактивиран");
  expect((await rows(context)).find((x) => x.username === u)!.active).toBe(false);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
  await expect(page.locator(".sa-toast")).toContainText("Деактивирането е отменено");
  expect((await rows(context)).find((x) => x.username === u)!.active).toBe(true);
});

test("who manages whom: the manager only lower roles, not himself, not the main admin", async ({ page, context }) => {
  await signIn(context, "manager");
  await open(page);
  const list = await rows(context);
  const admin = list.find((x) => x.role === "admin")!, me = list.find((x) => x.username === "manager")!, owner = list.find((x) => x.role === "owner")!;
  await expect(rowOf(page, admin.username)).toContainText("Само главният админ");
  await expect(rowOf(page, owner.username)).toContainText("Само по-висока роля");
  await expect(rowOf(page, admin.username).locator("[data-act]")).toBeDisabled();
  await expect(rowOf(page, "manager").locator("[data-act]")).toBeDisabled();
  await expect(rowOf(page, "manager")).toContainText("вие");
  /* oneself: only the password */
  await rowOf(page, "manager").locator("[data-man]").click();
  const s = page.locator(".sheetwrap.on");
  await expect(s.locator("[data-pw]")).toBeVisible();
  await expect(s.locator("[data-edit]")).toHaveCount(0);
  await s.locator("[data-close]").click();
  /* „Нов потребител“ offers only the lower roles */
  await page.locator(".sa-head [data-new]").click();
  const opts = await page.locator(".sheetwrap.on #nu-r option").evaluateAll((l) => l.map((o) => (o as HTMLOptionElement).value));
  expect(opts).not.toContain("admin"); expect(opts).not.toContain("owner"); expect(opts).not.toContain("manager");
  /* the server refuses too */
  expect((await context.request.post("/api/admin/staff/" + admin.id + "/active", { data: { active: false } })).status()).toBe(403);
  expect((await context.request.post("/api/admin/staff/" + me.id + "/active", { data: { active: false } })).status()).toBe(403);
});

test("marketing (without „Персонал“) gets „Нямате права“; the server refuses", async ({ page, context }) => {
  await signIn(context, "marketing");
  await page.goto("/admin/staff/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await context.request.get("/api/admin/staff/list")).status()).toBe(403);
});

test("@phone 360: no horizontal scroll (cards and the new-user sheet)", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await open(page, "#f=all");
  const over = () => page.evaluate(() => { const s = document.querySelector(".sa-scroller")!; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
  expect(await over()).toBeLessThanOrEqual(0);
  await page.locator(".sa-head [data-new]").click();
  const sheet = page.locator(".sheetwrap.on .sheet");
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
});

test("axe: no serious on „Персонал“ and the new-user sheet", async ({ page, context }) => {
  await signIn(context, "admin");
  await open(page);
  const serious = async () => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
  expect(await serious()).toEqual([]);
  await page.locator(".sa-head [data-new]").click();
  await expect(page.locator(".sheetwrap.on #nu-u")).toBeVisible();
  expect(await serious()).toEqual([]);
});
