import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/roles/ (design/pages-admin/roles.html): the main admin changes a right, sees it at once ("1 промяна"), saves
   (setRole, a "role.update" line in the log) and puts it back with "Отмени"; "Откажи промените"; leaving with unsaved
   changes asks first; another role with "Роли и права" sees the table locked (and the server refuses); the owner without
   the section gets "Нямате права"; the phone view (#r=...); 360; axe.
   The projects change different roles (desktop: marketing, phone: driver) and always put them back. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD] };
async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
/** "Отмени" in the toast as soon as it has risen (a toast of another test, a new online order, may replace it later) */
async function undo(page: Page) {
  await expect(page.locator(".sa-toast")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]/.test(m.text())) list.push(m.text()); });
  return list;
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const roleOf = (page: Page) => (isPhone(page) ? "driver" : "marketing");
type R = { id: string; sections: string[] };
const sectionsOf = async (ctx: BrowserContext, id: string) => ((await (await ctx.request.get("/api/admin/roles")).json()) as R[]).find((r) => r.id === id)!.sections;
async function openRoles(page: Page, hash = "") {
  await page.goto("/admin/roles/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Роли и права");
  await expect(page.locator("input[data-r]").first()).toBeAttached();
}
/** the control of a role and a section in the layout of this page (table or switch) */
const control = (page: Page, r: string, s: string) => page.locator((isPhone(page) ? ".rl-ph" : ".rl-wrap") + ' input[data-r="' + r + '"][data-s="' + s + '"]');
/** a click on the check box or switch in the middle of the screen (never under the bottom bar or the round "Молив") */
async function toggle(page: Page, r: string, s: string) {
  const box = control(page, r, s);
  await box.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await box.click({ force: true });
}

test("main admin: a change shows at once, „Запази“ writes it and the log, „Отмени“ puts it back", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  const r = roleOf(page), before = await sectionsOf(context, r), had = before.includes("hall");
  await openRoles(page, isPhone(page) ? "#r=" + r : "");
  const box = control(page, r, "hall");
  await expect(box).toBeChecked({ checked: had });
  await toggle(page, r, "hall");
  const bar = page.locator(".rl-bar");
  await expect(bar).toHaveClass(/\bon\b/);
  await expect(bar.locator("[data-n]")).toContainText("1 промяна");
  await expect(box.locator("xpath=ancestor::*[contains(@class,'sa-check') or contains(@class,'rl-sw')][1]")).toHaveClass(/chg/);
  /* the round "Молив" goes up above the bar */
  await expect(page.locator("sa-pen-ui")).toHaveAttribute("data-up", "");
  await bar.locator("[data-save]").click();
  await expect(page.locator(".sa-toast")).toContainText("Правата са запазени · 1 промяна");
  await expect(bar).not.toHaveClass(/\bon\b/);
  expect((await sectionsOf(context, r)).includes("hall")).toBe(!had);
  const log = (await (await context.request.get("/api/admin/audit")).json()) as { action: string; target: string; data: { added: string[]; removed: string[] } }[];
  const line = log.find((x) => x.action === "role.update" && x.target === r)!;
  expect(had ? line.data.removed : line.data.added).toContain("hall");
  await undo(page);
  await expect(page.locator(".sa-toast")).toContainText("Правата са върнати");
  expect((await sectionsOf(context, r)).includes("hall")).toBe(had);
  expect(errs).toEqual([]);
});

test("„Откажи промените“ and leaving with unsaved changes asks first", async ({ page, context }) => {
  await signIn(context, "admin");
  const r = roleOf(page);
  await openRoles(page, isPhone(page) ? "#r=" + r : "");
  const box = control(page, r, "qr"), was = await box.isChecked();
  await toggle(page, r, "qr");
  await page.locator(".rl-bar [data-cancel]").click();
  await expect(page.locator(".rl-bar")).not.toHaveClass(/\bon\b/);
  await expect(box).toBeChecked({ checked: was });
  await toggle(page, r, "qr");
  await page.locator(isPhone(page) ? '.sa-bnav a[href="/admin/"]' : '.sa-side a[href="/admin/"]').first().click();
  const sheet = page.locator(".sheetwrap.on");
  await expect(sheet.locator("h2")).toHaveText("Незапазени промени");
  await expect(sheet).toContainText("1 незапазена промяна");
  await sheet.locator("[data-leave]").click();
  await expect(page).toHaveURL(/\/admin\/$/);
  expect((await sectionsOf(context, r)).includes("qr")).toBe(was);
});

test("@desktop another role with „Роли и права“ sees the table locked; the server refuses its change", async ({ page, context, browser }) => {
  const a = await browser.newContext(); await signIn(a, "admin");
  const before = await sectionsOf(a, "manager");
  expect((await a.request.put("/api/admin/roles/manager", { data: { sections: [...before, "roles"] } })).status()).toBe(200);
  try {
    await signIn(context, "manager");
    await openRoles(page);
    await expect(page.locator(".rl-lock")).toContainText("Само главният админ променя правата");
    await expect(page.locator(".rl-wrap input[data-r]:not([disabled])")).toHaveCount(0);
    expect((await context.request.put("/api/admin/roles/marketing", { data: { sections: ["dashboard"] } })).status()).toBe(403);
  } finally {
    expect((await a.request.put("/api/admin/roles/manager", { data: { sections: before } })).status()).toBe(200);
    await a.close();
  }
});

test("the owner (without „Роли и права“) gets „Нямате права“", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto("/admin/roles/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await context.request.put("/api/admin/roles/marketing", { data: { sections: ["dashboard"] } })).status()).toBe(403);
});

test("@phone one role at a time: #r=waiter, switches, the main admin locked", async ({ page, context }) => {
  await signIn(context, "admin");
  await openRoles(page, "#r=waiter");
  await expect(page.locator(".rl-wrap")).toBeHidden();
  await expect(page.locator('.rl-ph [data-pr="waiter"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".rl-who h2")).toHaveText("Сервитьор");
  await expect(page.locator('.rl-ph input[role="switch"][data-s="dashboard"]')).toBeDisabled();
  await page.locator('.rl-ph [data-pr="admin"]').click();
  await expect(page).toHaveURL(/#r=admin$/);
  await expect(page.locator(".rl-who")).toContainText("Винаги всичко");
  await expect(page.locator('.rl-ph input[role="switch"]:not([disabled])')).toHaveCount(0);
});

test("@phone 360: no horizontal scroll, also with the bar „Запази“", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await openRoles(page, "#r=driver");
  const over = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll(".sa-scroller")].map((s) => s.scrollWidth - s.clientWidth)));
  expect(await over()).toBeLessThanOrEqual(0);
  await toggle(page, "driver", "events");
  await expect(page.locator(".rl-bar")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(600); /* the bar has risen */
  const b = await page.locator(".rl-bar").boundingBox(), nav = await page.locator(".sa-bnav").boundingBox();
  expect(b!.y + b!.height).toBeLessThanOrEqual(nav!.y);
  expect(b!.x + b!.width).toBeLessThanOrEqual(360);
  expect(await over()).toBeLessThanOrEqual(0);
  await page.locator(".rl-bar [data-cancel]").click();
});

test("axe: no serious on „Роли и права“", async ({ page, context }) => {
  await signIn(context, "admin");
  await openRoles(page);
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});
