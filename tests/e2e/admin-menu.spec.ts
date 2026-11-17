import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { readEnv } from "../../scripts/env.mjs";
import { assertPortFree } from "./_port.ts";

/* /admin/menu/ (design/pages-admin/menu.html, version 4): the menu editor with the shared draft.
   Every project starts ITS OWN server (port E2E_PORT + 100 desktop, + 101 phone, its own copy of the build and its own database):
   the draft is one shared document and a real "Публикувай" rebuilds the site and swaps the build folder, so the build of the
   other tests is never touched and the two projects never meet in one draft.
   Covered: price in place -> draft bar -> „Отмени“; new dish; removal with 301 in the summary; 409 with two tabs and
   „Зареди пак“; „Изчерпано днес“ at once (not the draft); the order of the categories with the buttons; „Публикувай“ ->
   /api/menu sees the new price, the rebuild state, „Върни предишното меню“ (desktop); rights (marketing 403 and
   „Нямате права“, the kitchen goes to its module); 360 without horizontal scroll; axe without serious. */
const env = readEnv() as Record<string, string | undefined>;
const SRC = process.env.DIST_DIR || "dist-e2e";
let PORT = 0, DIST = "", DB = "", BASE = "";
let srv: ChildProcess | null = null;
const USER: Record<string, [string, string | undefined]> = { admin: [env.ADMIN_USER || "admin", env.ADMIN_PASSWORD], marketing: ["marketing", env.MARKETING_PASSWORD], kitchen: ["kitchen", env.KITCHEN_PASSWORD] };

const rmAll = () => { if (!DIST) return; for (const d of [DIST, DIST + "-prev", DIST + "-next"]) fs.rmSync(d, { recursive: true, force: true }); for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true }); };
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error("timeout: " + what);
    await new Promise((r) => setTimeout(r, 400));
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, info) => {
  test.setTimeout(120_000);
  test.skip(!env.ADMIN_PASSWORD, "no .env with the admin password (node scripts/make-env.mjs)");
  PORT = +(process.env.E2E_PORT || 8788) + (info.project.name === "phone" ? 101 : 100);
  DIST = SRC + "-menu-" + info.project.name; DB = "data/e2e-menu-" + PORT + ".db"; BASE = "http://localhost:" + PORT;
  rmAll();
  fs.cpSync(SRC, DIST, { recursive: true });
  await assertPortFree(PORT);
  srv = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), DIST_DIR: DIST, DB_FILE: DB, SC_PREVIEW_API: "1", SMS_DEMO: "1" }, stdio: "ignore",
  });
  await until(async () => (await fetch(BASE + "/api/health")).ok, 30_000, "server start");
});
test.afterAll(async () => {
  /* a rebuild still running (it should not be: the publish test waits for it) must not write into a removed folder */
  if (srv && srv.pid) { srv.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 500)); }
  rmAll();
});

async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post(BASE + "/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[13]|409|422)/.test(m.text())) list.push(m.text()); });
  return list;
}
async function openMenu(page: Page, hash = "") {
  await page.goto(BASE + "/admin/menu/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Меню");
  await expect(page.locator(".mn-sum")).toBeVisible();
}
/** "Отмени" / "Върни" in the toast, once it has risen */
async function undo(page: Page) {
  await expect(page.locator(".sa-toast")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
}
const draft = async (ctx: BrowserContext) => (await (await ctx.request.get(BASE + "/api/admin/menu/draft")).json()) as { version: number; changes: { count: number } };
async function discard(ctx: BrowserContext) { const d = await draft(ctx); await ctx.request.post(BASE + "/api/admin/menu/draft/discard", { data: { version: d.version } }); }
async function setPrice(page: Page, id: string, v: string) {
  const inp = page.locator('.mn-row[data-id="' + id + '"] [data-price]');
  await inp.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await inp.fill(v); await inp.press("Enter");
}
const bar = (page: Page) => page.locator(".mn-pub");
const sheet = (page: Page) => page.locator(".sheetwrap.on .sheet");

test("price in place -> the draft (bar, tag, „в сайта“), „Отмени“ puts it back", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await openMenu(page);
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  await setPrice(page, "tarator", "2,50");
  await expect(page.locator(".sa-toast")).toContainText("В черновата: цена на „Таратор“ 2,35 € → 2,50 €");
  await expect(bar(page)).toContainText("Чернова: 1 промяна");
  const row = page.locator('.mn-row[data-id="tarator"]');
  await expect(row).toContainText("Променено в черновата");
  await expect(row).toContainText("в сайта 2,35 €");
  expect((await draft(context)).changes.count).toBe(1);
  await undo(page);
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  await expect(row.locator("[data-price]")).toHaveValue("2,35");
  await expect.poll(async () => (await draft(context)).changes.count).toBe(0);
  /* a wrong price stays in the field with the error, nothing is saved */
  await setPrice(page, "tarator", "abc");
  await expect(row).toContainText("Напишете цена като 10,22.");
  expect((await draft(context)).changes.count).toBe(0);
  expect(errs).toEqual([]);
});

test("new dish, removal with 301 in the summary, „Върни в менюто“, „Откажи“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await openMenu(page);
  await page.locator(".sa-acts [data-new]").click();
  await expect(sheet(page).locator("h2")).toHaveText("Ново ястие");
  await sheet(page).locator("[data-ok]").click();
  await expect(sheet(page)).toContainText("Напишете името на ястието.");
  await sheet(page).locator("#mf-n").fill("Салата за проба");
  await sheet(page).locator("#mf-cat").selectOption("salati");
  await sheet(page).locator("#mf-p").fill("7,50");
  await sheet(page).locator("[data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText("ново ястие „Салата за проба“");
  await expect(page.locator(".mn-row", { hasText: "Салата за проба" })).toContainText("Ново в черновата");
  /* removal: the confirm says where the old address leads */
  await page.locator('.mn-row[data-id="shkembe"] .mn-open').evaluate((el) => (el as HTMLElement).click());
  await sheet(page).locator("[data-rm]").click();
  await expect(sheet(page).last()).toContainText("старият му адрес води (301) към категорията „Супи“");
  await page.locator(".sheetwrap.on [data-yes]").click();
  const del = page.locator('.mn-row[data-id="shkembe"]');
  await expect(del).toContainText("Ще се махне");
  await expect(bar(page)).toContainText("Чернова: 2 промени");
  /* the summary from the server */
  await bar(page).locator("[data-review]").click();
  await expect(sheet(page)).toContainText("Нови ястия · 1");
  await expect(sheet(page)).toContainText("Салата за проба");
  await expect(sheet(page)).toContainText("Махнати · 1");
  await expect(sheet(page)).toContainText("старият адрес води (301) към „Супи“");
  await expect(sheet(page)).toContainText("без състав");
  await sheet(page).locator("[data-x]").click();
  /* back into the menu */
  await del.locator("[data-undel]").click();
  await expect(del).not.toContainText("Ще се махне");
  await expect(bar(page)).toContainText("Чернова: 1 промяна");
  /* „Откажи“ the whole draft */
  await bar(page).locator("[data-discard]").click();
  await page.locator(".sheetwrap.on [data-yes]").click();
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  await expect(page.locator(".mn-row", { hasText: "Салата за проба" })).toHaveCount(0);
  expect((await draft(context)).changes.count).toBe(0);
  expect(errs).toEqual([]);
});

test("two tabs: the second one gets 409 and „Зареди пак“", async ({ page, context }) => {
  await signIn(context, "admin");
  const other = await context.newPage();
  await openMenu(page); await openMenu(other);
  await setPrice(page, "tarator", "2,60");
  await expect(bar(page)).toContainText("1 промяна");
  await setPrice(other, "pileshka-supa", "3,10");
  await expect(other.locator(".mn-conf")).toContainText("Някой друг промени черновата.");
  await other.locator("[data-reload]").click();
  await expect(other.locator(".mn-conf")).toHaveCount(0);
  await expect(other.locator('.mn-row[data-id="tarator"] [data-price]')).toHaveValue("2,60");
  await setPrice(other, "pileshka-supa", "3,10");
  await expect(bar(other)).toContainText("2 промени");
  await other.close();
  await discard(context);
});

test("„Изчерпано днес“ acts at once (not the draft), „Върни“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await openMenu(page);
  const sw = page.locator('.mn-row[data-id="tarator"] [data-out]');
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sw.click({ force: true });
  await expect(page.locator(".sa-toast")).toContainText("Изчерпано днес: Таратор");
  await expect(page.locator(".mn-today")).toContainText("Таратор");
  await expect.poll(async () => ((await (await context.request.get(BASE + "/api/menu")).json()).items.find((x: { id: string }) => x.id === "tarator").t as string[]).includes("out")).toBe(true);
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  await undo(page);
  await expect(page.locator(".mn-today")).not.toContainText("Таратор");
  await expect.poll(async () => ((await (await context.request.get(BASE + "/api/menu")).json()).items.find((x: { id: string }) => x.id === "tarator").t as string[]).includes("out")).toBe(false);
  expect(errs).toEqual([]);
});

test("categories: „Надолу“ / „Нагоре“ change the order at once, in the draft", async ({ page, context }) => {
  await signIn(context, "admin");
  await openMenu(page, "#t=cats");
  const first = page.locator(".mn-ci").first();
  await expect(first).toContainText("Супи");
  await page.locator('.mn-ci[data-cat="supi"] [data-down]').click();
  await expect(page.locator(".mn-ci").first()).toContainText("Салати");
  await expect(page.locator('.mn-ci[data-cat="supi"] .no')).toHaveText("2");
  await expect(page.locator('.mn-ci[data-cat="supi"] [data-down]')).toBeFocused();
  await expect(bar(page)).toContainText("1 промяна");
  const box = await page.locator('.mn-ci[data-cat="supi"] [data-up]').boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await page.locator('.mn-ci[data-cat="supi"] [data-up]').click();
  await expect(page.locator(".mn-ci").first()).toContainText("Супи");
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  /* „Махни“ only for an empty category */
  await expect(page.locator('.mn-ci[data-cat="supi"] [data-catdel]')).toHaveCount(0);
  await discard(context);
});

test("„Публикувай“: the summary, /api/menu sees the new price, the rebuild, „Върни предишното меню“ @desktop", async ({ page, context }) => {
  test.setTimeout(420_000);
  const errs = errors(page);
  await signIn(context, "admin");
  await openMenu(page);
  await setPrice(page, "tarator", "2,50");
  await expect(bar(page)).toContainText("1 промяна");
  await bar(page).locator("[data-review]").click();
  await expect(sheet(page)).toContainText("Сайтът се пресглобява сам:");
  await expect(sheet(page)).toContainText("цена 2,35 € → 2,50 €");
  await sheet(page).locator("[data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText("Сайтът се пресглобява.");
  await expect(page.locator(".mn-pubinfo")).toContainText("Публикувано");
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  const price = async () => (await (await context.request.get(BASE + "/api/menu")).json()).items.find((x: { id: string }) => x.id === "tarator").p;
  expect(await price()).toBe(2.5);
  /* the rebuild on the server: the screen follows it to „готово“ */
  await until(async () => { const s = await (await context.request.get(BASE + "/api/admin/menu/publish")).json(); return s.build.state === "done" || s.build.state === "error" ? s : null; }, 240_000, "rebuild");
  await expect(page.locator(".mn-pubinfo")).toContainText("Сайтът е пресглобен: готово в", { timeout: 10_000 });
  /* one step back */
  await page.locator("[data-rollback]").click();
  await page.locator(".sheetwrap.on [data-yes]").click();
  await expect(page.locator(".sa-toast")).toContainText("Предишното меню е върнато.");
  await expect.poll(price).toBe(2.35);
  await expect(page.locator('.mn-row[data-id="tarator"] [data-price]')).toHaveValue("2,35");
  await until(async () => { const s = await (await context.request.get(BASE + "/api/admin/menu/publish")).json(); return s.build.state === "done" || s.build.state === "error" ? s : null; }, 240_000, "rebuild back");
  expect(errs).toEqual([]);
});

test("the search of the admin opens the dish (#d=), #review=1 with no changes", async ({ page, context }) => {
  await signIn(context, "admin");
  await openMenu(page, "#d=shopska-salata");
  await expect(sheet(page).locator("h2")).toHaveText("Шопска салата");
  await expect(sheet(page)).toContainText("Чакат потвърждение от кухнята.");
  await expect(sheet(page).locator("#mf-sw")).toBeDisabled();
  await sheet(page).locator("[data-close]").click();
  await page.goto(BASE + "/admin/menu/#review=1"); await page.reload();
  await expect(sheet(page)).toContainText("Няма промени за публикуване.");
});

test("rights: marketing gets 403 and „Нямате права“, the kitchen goes to its module", async ({ page, context, browser }) => {
  await signIn(context, "marketing");
  expect((await context.request.get(BASE + "/api/admin/menu/draft")).status()).toBe(403);
  await page.goto(BASE + "/admin/menu/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  await page.goto(BASE + "/admin/menu/vnos/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  const k = await browser.newContext({ viewport: page.viewportSize()! });
  await signIn(k, "kitchen");
  const kp = await k.newPage();
  await kp.goto(BASE + "/admin/menu/");
  await expect(kp).toHaveURL(/\/kuhnya\/(vhod\/)?$/); /* the module; on a device without a chosen section it asks for the section first */
  await k.close();
});

test("360: no horizontal scroll in the three parts and the sheet @phone", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  for (const h of ["", "#t=cats", "#t=opts", "#d=pitsa-margarita"]) {
    await page.goto(BASE + "/admin/menu/" + h); await page.reload();
    await expect(page.locator(".mn-sum")).toBeVisible();
    await page.waitForTimeout(500);
    const over = await page.evaluate(() => { const s = document.querySelector(".sa-scroller") as HTMLElement; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
    expect(over, h).toBeLessThanOrEqual(0);
  }
});

test("axe: no serious or critical on the parts, the sheet and the summary", async ({ page, context }) => {
  await signIn(context, "admin");
  const serious = async () => (await new AxeBuilder({ page }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", "));
  for (const h of ["", "#t=cats", "#t=opts"]) {
    await page.goto(BASE + "/admin/menu/" + h); await page.reload();
    await expect(page.locator(".mn-sum")).toBeVisible(); await page.waitForTimeout(400);
    expect(await serious(), h).toEqual([]);
  }
  await page.goto(BASE + "/admin/menu/#d=tarator"); await page.reload();
  await expect(sheet(page)).toBeVisible(); await page.waitForTimeout(500);
  expect(await serious(), "sheet").toEqual([]);
});
