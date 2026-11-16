import { test, expect, type Page, type BrowserContext, type Browser } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/notes/ (design/pages-admin/notes.html, decisions 15.11.2026): the tabs by status with a count, "Одобри и изпълни"
   (approves; the next Claude session takes it), "Отхвърли" with a required reason, "Отмени" after a change and after
   "Изтрий" (restoreNote), the read-only view of a role with "Бележки", "Моите препоръки" of a staff role (full screen,
   "Нов статус", the badge goes to 0), NOTES.json with only the approved ones, real time, 360 and axe.
   Each project writes its own notes (a unique text) and uses its own staff account for the recommendations
   (desktop: waiter, phone: kitchen), so the two projects never race on one badge. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = {
  admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD],
  waiter: ["waiter", E.WAITER_PASSWORD], kitchen: ["kitchen", E.KITCHEN_PASSWORD],
};
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
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const staffOf = (project: string): "waiter" | "kitchen" => (project === "phone" ? "kitchen" : "waiter");
const uniq = (p: string) => p + " " + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
/** a recommendation from a staff account (every role writes them with the pencil); returns its id */
async function recommend(browser: Browser, role: "waiter" | "kitchen", text: string): Promise<string> {
  const c = await browser.newContext(); await signIn(c, role);
  const r = await c.request.post("/api/admin/notes", { data: { module: role, url: role === "waiter" ? "/servitor/" : "/kuhnya/", selector: "h1", elementText: "Модулът ти идва скоро", text, viewport: { w: 390, h: 844 } } });
  expect(r.status()).toBe(201); const id = (await r.json()).id as string; await c.close(); return id;
}
const card = (page: Page, text: string) => page.locator("article.nt").filter({ hasText: text });
async function openNotes(page: Page, hash = "") {
  await page.goto("/admin/notes/" + (hash ? "#" + hash : ""));
  await expect(page.locator(".sa-h1")).toHaveText("Бележки");
  await expect(page.locator("#nt-list .sa-skel")).toHaveCount(0);
}

test("main admin: tabs with counts, „Одобри и изпълни“ -> „Одобрени“ for the next session, „Отмени“ puts it back", async ({ page, context, browser }, info) => {
  const errs = errors(page);
  const text = uniq("Бутонът да е по-голям");
  const id = await recommend(browser, staffOf(info.project.name), text);
  await signIn(context, "admin");
  await openNotes(page, "s=new");
  /* "Как работи?" is folded in one line */
  await expect(page.locator("details.nt-how")).not.toHaveAttribute("open", "");
  await page.locator("details.nt-how summary").click();
  await expect(page.locator("details.nt-how")).toHaveAttribute("open", "");
  await expect(page.locator("details.nt-how")).toContainText("GET /api/admin/notes?status=approved");
  const tabs = page.locator('[role="tab"]');
  await expect(tabs).toHaveText([/^Нови\d+$/, /^Одобрени\d+$/, /^В изпълнение\d+$/, /^За преглед\d+$/, /^Публикувани\d+$/, /^Отхвърлени\d+$/]);
  await page.fill("#nt-q", text);
  const c = card(page, text);
  await expect(c).toHaveCount(1);
  await expect(c.locator(".sa-tag").first()).toHaveText("Нова");
  await expect(c.locator(".where")).toContainText(/Сервитьор|Кухня/);
  /* the selector and editId are folded in "Технически данни" */
  await expect(c.locator("details.nt-tech")).not.toHaveAttribute("open", "");
  await c.locator("details.nt-tech summary").click();
  await expect(c.locator("details.nt-tech")).toContainText("CSS селектор");
  await expect(c.locator('a:has-text("Покажи на страницата")')).toHaveAttribute("href", "/admin/preview/#n=" + id);
  await c.locator('[data-act="run"]').click();
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toContainText("Одобрени");
  await expect(page.locator(".sa-toast")).toContainText("следващата сесия на Claude я поема");
  await expect(card(page, text)).toContainText("Чака изпълнение: следващата сесия на Claude я поема");
  await expect(card(page, text)).not.toContainText("Claude работи");
  expect((await (await context.request.get("/api/admin/notes?status=approved")).json()).some((n: { id: string }) => n.id === id)).toBe(true);
  await undo(page);
  await expect.poll(async () => ((await (await context.request.get("/api/admin/notes")).json()) as { id: string; status: string }[]).find((n) => n.id === id)?.status).toBe("new");
  expect(errs).toEqual([]);
});

test("„Отхвърли“ needs a reason; the author sees it in „Моите препоръки“ with „Нов статус“ and the badge goes to 0", async ({ page, context, browser }, info) => {
  const role = staffOf(info.project.name), text = uniq("Цветът на бутона");
  await recommend(browser, role, text);
  await signIn(context, "admin");
  await openNotes(page);
  await page.fill("#nt-q", text);
  await card(page, text).locator('[data-act="reject"]').click();
  const sheet = page.locator(".sheetwrap.on");
  await expect(sheet.locator("h2")).toHaveText("Отхвърли бележката");
  await sheet.locator("[data-ok]").click();
  await expect(sheet.locator("#nt-why-e")).toHaveText("Напишете причината.");
  await sheet.locator("#nt-why").fill("Не е в плана за тази седмица.");
  await sheet.locator("[data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText("Бележката е отхвърлена");
  await page.locator('[role="tab"]', { hasText: "Отхвърлени" }).click();
  await expect(card(page, text).locator(".nt-why")).toContainText("Не е в плана за тази седмица.");

  /* the author: full screen (no bar of the admin), read-only, "Нов статус", then the badge is 0 */
  const w = await browser.newContext(); await signIn(w, role);
  expect(((await (await w.request.get("/api/admin/notes/waiting")).json()) as { n: number }).n).toBeGreaterThan(0);
  const p = await w.newPage(); const errs = errors(p);
  await p.goto("/admin/notes/");
  await expect(p.locator(".sa-h1")).toHaveText("Моите препоръки");
  await expect(p.locator(".sa-side")).toHaveCount(0);
  await expect(p.locator("a.nt-back")).toHaveAttribute("href", role === "waiter" ? "/servitor/" : "/kuhnya/");
  await expect(p.locator('[role="tab"][aria-selected="true"]')).toBeVisible();
  await p.locator('[role="tab"]', { hasText: "Отхвърлени" }).click();
  const mine = card(p, text);
  await expect(mine).toContainText("Нов статус");
  await expect(mine.locator(".nt-why")).toContainText("Не е в плана за тази седмица.");
  await expect(mine.locator("[data-act]")).toHaveCount(0);
  await expect.poll(async () => ((await (await w.request.get("/api/admin/notes/waiting")).json()) as { n: number }).n).toBe(0);
  expect(errs).toEqual([]);
  await w.close();
});

test("„Изтрий“ with „Отмени“: the same note comes back (restoreNote)", async ({ page, context, browser }, info) => {
  const text = uniq("Да се махне банерът");
  const id = await recommend(browser, staffOf(info.project.name), text);
  await signIn(context, "admin");
  await openNotes(page);
  await page.fill("#nt-q", text);
  await card(page, text).locator('[data-act="del"]').click();
  await expect(page.locator(".sa-toast")).toContainText("Бележката е изтрита");
  await expect(card(page, text)).toHaveCount(0);
  await undo(page);
  await expect(card(page, text)).toHaveCount(1);
  const all = (await (await context.request.get("/api/admin/notes")).json()) as { id: string }[];
  expect(all.some((n) => n.id === id)).toBe(true);
});

test("a role with „Бележки“ that is not the main admin reads everything, without actions", async ({ page, context, browser }, info) => {
  const text = uniq("Снимките да са по-големи");
  await recommend(browser, staffOf(info.project.name), text);
  await signIn(context, "marketing");
  await openNotes(page);
  await expect(page.locator(".nt-ro")).toContainText("Само главният админ одобрява");
  await page.fill("#nt-q", text);
  await expect(card(page, text)).toHaveCount(1);
  await expect(page.locator("[data-act]")).toHaveCount(0);
  /* the server says the same */
  const all = (await (await context.request.get("/api/admin/notes")).json()) as { id: string; text: string }[];
  const n = all.find((x) => x.text === text)!;
  expect((await context.request.patch("/api/admin/notes/" + n.id, { data: { status: "approved" } })).status()).toBe(403);
});

test("„Изтегли NOTES.json“ holds only the approved ones", async ({ page, context, browser }, info) => {
  const text = uniq("За износа");
  const id = await recommend(browser, staffOf(info.project.name), text);
  await signIn(context, "admin");
  expect((await context.request.patch("/api/admin/notes/" + id, { data: { status: "approved" } })).status()).toBe(200);
  await openNotes(page);
  const dl = page.waitForEvent("download");
  await page.locator("[data-dl]").click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe("NOTES.json");
  const j = JSON.parse(fs.readFileSync((await d.path())!, "utf8")) as { status: string; notes: { id: string; status: string }[] };
  expect(j.status).toBe("approved");
  expect(j.notes.length).toBeGreaterThan(0);
  expect(j.notes.every((n) => n.status === "approved")).toBe(true);
  expect(j.notes.some((n) => n.id === id)).toBe(true);
});

test("real time: a new recommendation appears without reloading", async ({ page, context, browser }, info) => {
  await signIn(context, "admin");
  await openNotes(page, "s=new");
  const text = uniq("На живо");
  await recommend(browser, staffOf(info.project.name), text);
  await expect(card(page, text)).toHaveCount(1, { timeout: 10_000 });
});

test("@phone 360: no horizontal scroll on „Бележки“ and „Моите препоръки“", async ({ page, context, browser }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const over = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll(".sa-scroller")].map((s) => s.scrollWidth - s.clientWidth)));
  await recommend(browser, "kitchen", uniq("Широк текст за проверка на 360 без хоризонтален скрол"));
  await signIn(context, "admin");
  await openNotes(page);
  await expect(page.locator("article.nt").first()).toBeVisible();
  expect(await over()).toBeLessThanOrEqual(0);
  const w = await browser.newContext({ viewport: { width: 360, height: 740 } }); await signIn(w, "kitchen");
  const p = await w.newPage(); await p.goto("/admin/notes/"); await expect(p.locator(".sa-h1")).toHaveText("Моите препоръки");
  expect(await p.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll(".sa-scroller")].map((s) => s.scrollWidth - s.clientWidth)))).toBeLessThanOrEqual(0);
  await w.close();
});

test("axe: no serious on „Бележки“ (main admin, marketing) and „Моите препоръки“", async ({ page, context, browser }, info) => {
  await recommend(browser, staffOf(info.project.name), uniq("За axe"));
  await signIn(context, "admin");
  await openNotes(page);
  await page.waitForTimeout(700);
  expect(await serious(page)).toEqual([]);
  await signIn(context, "marketing");
  await openNotes(page);
  await page.waitForTimeout(700);
  expect(await serious(page)).toEqual([]);
  const w = await browser.newContext(); await signIn(w, staffOf(info.project.name));
  const p = await w.newPage(); await p.goto("/admin/notes/"); await expect(p.locator("article.nt").first()).toBeVisible();
  expect(await serious(p)).toEqual([]);
  await w.close();
});
