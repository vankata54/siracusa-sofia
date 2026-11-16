import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/settings/ (design/pages-admin/settings.html): a change shows at once ("1 промяна"), „Запази“ sends only the
   changed field (the core checks it, a "settings.update" line in the log), „Отмени“ puts it back; „Натоварено“ shows how
   the guests will see it („Възможни са закъснения · около 55 мин“); the hours are read only; marketing gets „Нямате права“;
   360; axe. The projects change different fields (desktop: the minutes, phone: the table time) and put them back. */
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
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
type S = { kitchen: { busy: boolean; etaMin: number; etaBusyMin: number }; resMinutes: number };
const settings = async (ctx: BrowserContext) => (await (await ctx.request.get("/api/admin/settings")).json()) as S;
async function open(page: Page) {
  await page.goto("/admin/settings/");
  await expect(page.locator(".sa-h1")).toHaveText("Настройки");
  await expect(page.locator("#s-kitchen")).toBeVisible();
}
async function press(page: Page, sel: string) {
  const b = page.locator(sel);
  await b.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await b.click({ force: true });
}

test("a change, „Запази“ (only that field, the log) and „Отмени“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  const before = await settings(context);
  await open(page);
  const [key, sel] = isPhone(page) ? ["resMinutes", '[data-inc="resMinutes"][data-d="30"]'] : ["etaMin", '[data-inc="etaMin"][data-d="5"]'];
  await press(page, sel);
  const bar = page.locator(".st-bar");
  await expect(bar).toHaveClass(/\bon\b/);
  await expect(bar.locator("[data-n]")).toContainText("1 промяна");
  await expect(page.locator(".chg-dot")).toHaveCount(1);
  await bar.locator("[data-save]").click();
  await expect(page.locator(".sa-toast")).toContainText("Настройките са запазени · 1 промяна");
  await expect(bar).not.toHaveClass(/\bon\b/);
  const after = await settings(context);
  if (key === "etaMin") { expect(after.kitchen.etaMin).toBe(before.kitchen.etaMin + 5); expect(after.resMinutes).toBe(before.resMinutes); }
  else { expect(after.resMinutes).toBe(before.resMinutes + 30); }
  const log = (await (await context.request.get("/api/admin/audit?action=settings.update")).json()) as { action: string; data: Record<string, unknown> }[];
  const k2 = key === "etaMin" ? "kitchen" : "resMinutes", line = log.find((x) => x.action === "settings.update" && Object.keys(x.data || {}).includes(k2));
  expect(Object.keys(line!.data)).toEqual([k2]);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
  await expect(page.locator(".sa-toast")).toContainText("Върнати са предишните настройки");
  const back = await settings(context);
  expect(back.kitchen.etaMin).toBe(before.kitchen.etaMin); expect(back.resMinutes).toBe(before.resMinutes);
  expect(errs).toEqual([]);
});

test("„Натоварено“: the preview says how the guests will see it; „Откажи промените“ leaves the system as it was", async ({ page, context }) => {
  await signIn(context, "admin");
  const before = await settings(context);
  await open(page);
  await expect(page.locator(".busy")).toContainText(/Сега: обичаен режим · около \d+ мин/);
  await page.locator(".busy .sa-switch").click();
  await expect(page.locator(".prev")).toContainText("Така ще го виждат гостите след „Запази“");
  await expect(page.locator(".prev .pill-st").first()).toContainText(/Възможни са закъснения · около \d+ мин/);
  await page.locator(".st-bar [data-cancel]").click();
  await expect(page.locator(".st-bar")).not.toHaveClass(/\bon\b/);
  await expect(page.locator(".prev")).toContainText("Така го виждат гостите сега");
  expect((await settings(context)).kitchen.busy).toBe(before.kitchen.busy);
  /* the hours are read only */
  await expect(page.locator("#s-hours input, #s-hours button")).toHaveCount(0);
  await expect(page.locator("#s-hours")).toContainText("до 21:00");
});

test("„Натоварено“ under the minutes: the core refuses, the screen does not let it", async ({ page, context }) => {
  await signIn(context, "admin");
  expect((await context.request.patch("/api/admin/settings", { data: { kitchen: { etaMin: 60, etaBusyMin: 40 } } })).status()).toBe(422);
  await open(page);
  /* "−" on the busy minutes stops at the usual minutes */
  const s = await settings(context);
  const minus = page.locator('[data-inc="etaBusyMin"][data-d="-5"]');
  for (let i = 0; i < (s.kitchen.etaBusyMin - s.kitchen.etaMin) / 5 + 1; i++) { if (await minus.isDisabled()) break; await press(page, '[data-inc="etaBusyMin"][data-d="-5"]'); }
  await expect(minus).toBeDisabled();
  await expect(page.locator('[aria-label="Време при натоварване"] output')).toContainText(String(s.kitchen.etaMin) + " мин");
  await page.locator(".st-bar [data-cancel]").click();
});

test("marketing (without „Настройки“) gets „Нямате права“; the server refuses", async ({ page, context }) => {
  await signIn(context, "marketing");
  await page.goto("/admin/settings/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await context.request.patch("/api/admin/settings", { data: { callCooldown: 4 } })).status()).toBe(403);
});

test("@phone 360: no horizontal scroll; the bar above the bottom bar", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await open(page);
  const over = () => page.evaluate(() => { const s = document.querySelector(".sa-scroller")!; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
  expect(await over()).toBeLessThanOrEqual(0);
  await page.locator('[data-cp="estimate"]').click({ force: true });
  const bar = page.locator(".st-bar");
  await expect(bar).toHaveClass(/\bon\b/);
  /* after the bar has risen (its transition) */
  await expect.poll(async () => { const [b, n] = await Promise.all([bar.boundingBox(), page.locator(".sa-bnav").boundingBox()]); return b!.y + b!.height - n!.y; }).toBeLessThanOrEqual(0);
  await bar.locator("[data-cancel]").click();
});

test("axe: no serious on „Настройки“", async ({ page, context }) => {
  await signIn(context, "admin");
  await open(page);
  const v = (await new AxeBuilder({ page }).analyze()).violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).join(", "));
  expect(v).toEqual([]);
});
