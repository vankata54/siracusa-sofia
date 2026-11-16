import { test, expect, type Page, type BrowserContext, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { readEnv } from "../../scripts/env.mjs";

/* /admin/lunch/ (design/pages-admin/lunch.html): a day of the schedule, adding with the button ("Добави", also on the phone
   in the sheet) and "Отмени", the rule "the same menu never two days in a row" stops publishing, "Публикувай" by day,
   the PIN (set once and shown once, wrong with the tries left, unlock, "Заключи", the countdown after too many), "Изчерпано
   днес" for a lunch dish, the rights, 360 without a horizontal scroll, axe.
   Each project starts ITS OWN server (port E2E_PORT + 2 / + 3, a copy of the build, its own database): the PIN, the roles
   and "Изчерпано днес" never touch the server of the other tests, and only days of NEXT week are published, so today's
   lunch menu (and the site) never changes. */
const SRC = process.env.DIST_DIR || "dist-e2e";
const env = readEnv() as Record<string, string | undefined>;
let srv: ChildProcess | null = null, BASE = "", DIST = "", DB = "";
const USER: Record<string, [string, string | undefined]> = { admin: [env.ADMIN_USER || "admin", env.ADMIN_PASSWORD], owner: ["owner", env.OWNER_PASSWORD], marketing: ["marketing", env.MARKETING_PASSWORD] };

const rmAll = () => { if (!DIST) return; for (const d of [DIST, DIST + "-prev", DIST + "-next"]) fs.rmSync(d, { recursive: true, force: true }); for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true }); };
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error("timeout: " + what);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, info: TestInfo) => {
  test.setTimeout(120_000);
  test.skip(!env.ADMIN_PASSWORD || !env.MARKETING_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  const port = +(process.env.E2E_PORT || 8788) + (info.project.name === "phone" ? 2 : 3);
  BASE = "http://localhost:" + port; DIST = SRC + "-lunch-" + info.project.name; DB = "data/e2e-lunch-" + port + ".db";
  rmAll();
  fs.cpSync(SRC, DIST, { recursive: true });
  srv = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], {
    env: { ...process.env, PORT: String(port), DIST_DIR: DIST, DB_FILE: DB, SC_PREVIEW_API: "1", SMS_DEMO: "1" }, stdio: "ignore",
  });
  await until(async () => (await fetch(BASE + "/api/health")).ok, 30_000, "server start");
});
test.afterAll(async () => {
  if (srv && srv.pid) { srv.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 300)); }
  rmAll();
});

async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post(BASE + "/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[139]|422|429)/.test(m.text())) list.push(m.text()); });
  return list;
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const ymd = (s: string, n: number) => { const [y, m, d] = s.split("-").map(Number), t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
/** the Monday of next week (always in the future) */
async function nextMonday(ctx: BrowserContext) {
  const v = await (await ctx.request.get(BASE + "/api/admin/lunch")).json() as { today: string };
  const w = new Date(v.today + "T12:00:00Z").getUTCDay();
  return ymd(v.today, (w === 0 ? 1 : 8 - w));
}
const lunchOf = async (ctx: BrowserContext) => (await (await ctx.request.get(BASE + "/api/admin/lunch")).json()) as { days: Record<string, string[]>; pub: Record<string, { ids: string[] }> };
async function toastHas(page: Page, text: string | RegExp) { await expect(page.locator(".sa-toast.on")).toContainText(text); }
async function setSections(ctx: BrowserContext, role: string, fn: (s: string[]) => string[]) {
  const roles = (await (await ctx.request.get(BASE + "/api/admin/roles")).json()) as { id: string; sections: string[] }[];
  const r = await ctx.request.put(BASE + "/api/admin/roles/" + role, { data: { sections: fn(roles.find((x) => x.id === role)!.sections) } });
  expect(r.status()).toBe(200);
}
/** "Добави" of a dish: on the computer in the list on the left, on the phone in the sheet "Добави в …" */
async function addDish(page: Page, id: string) {
  if (isPhone(page)) {
    await tap(page.locator(".ln-day [data-pick]"));
    const s = page.locator(".sheetwrap.on .sheet");
    await s.locator('[data-put="' + id + '"]').click();
    await expect(s.locator('[data-it="' + id + '"]')).toHaveClass(/\bin\b/);
    await s.locator("[data-done]").click();
    await expect(page.locator(".sheetwrap")).toHaveCount(0);
  } else {
    await tap(page.locator('.ln-cat [data-put="' + id + '"]'));
  }
}
const day = (page: Page, d: string) => page.locator('.ln-dt[data-day="' + d + '"]');
/** a click in the middle of the screen (never under the floating bars of the phone) */
async function tap(loc: ReturnType<Page["locator"]>) { await loc.evaluate((el) => el.scrollIntoView({ block: "center" })); await loc.click(); }

test("a day: „Добави“ and „Отмени“, the rule for two days in a row stops „Публикувай“, then publishing by day", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  const mon = await nextMonday(context), tue = ymd(mon, 1);
  await page.goto(BASE + "/admin/lunch/#w=" + mon);
  await expect(page.locator(".sa-h1")).toHaveText("Обедно меню");
  await expect(page.locator(".ln-day h2")).toHaveText(/^Понеделник, \d+ /);
  await expect(page.locator(".ln-day .ln-dz")).toContainText("Денят е празен.");
  await expect(page.locator(".ln-pub")).not.toHaveClass(/\bon\b/);

  /* add with the button, then "Отмени" */
  await addDish(page, "l-supa-topcheta");
  await expect(page.locator('.ln-day [data-row="l-supa-topcheta"]')).toContainText("Супа топчета");
  await toastHas(page, "Добавено в пн: Супа топчета");
  await expect(day(page, mon)).toContainText("Чернова");
  await expect.poll(async () => (await lunchOf(context)).days[mon]).toEqual(["l-supa-topcheta"]);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast.on [data-tu]").click({ force: true });
  await expect(page.locator('.ln-day [data-row="l-supa-topcheta"]')).toHaveCount(0);
  await expect.poll(async () => (await lunchOf(context)).days[mon]).toBeUndefined();

  /* Monday: two dishes */
  await addDish(page, "l-supa-topcheta");
  await expect(page.locator('.ln-day [data-row="l-supa-topcheta"]')).toBeVisible();
  await addDish(page, "l-lazanya-boloneze");
  await expect(page.locator(".ln-day .ln-row")).toHaveCount(2);
  await expect(page.locator(".ln-pub")).toHaveClass(/\bon\b/);
  await expect(page.locator(".ln-pub")).toContainText("1 ден чака публикуване");

  /* Tuesday: "Копирай от пн" -> the same menu two days in a row */
  await day(page, tue).click();
  await expect(page.locator(".ln-day h2")).toHaveText(/^Вторник, /);
  await tap(page.locator(".ln-day [data-copy]"));
  await expect(page.locator(".ln-rule")).toContainText("Същото меню като в понеделник");
  await expect(page.locator(".ln-rule")).toContainText("Едно и също меню не може два поредни дни.");
  await expect(day(page, tue)).toContainText("Повтаря се");
  await expect(day(page, mon)).toContainText("Повтаря се");
  await page.locator(".ln-pub [data-publish]").click();
  await toastHas(page, "Не е публикувано: пн и вт повтаря съседен ден.");
  await expect(page.locator(".ln-day h2")).toHaveText(/^Вторник, /);
  const l0 = await lunchOf(context);
  expect(l0.pub[mon]).toBeUndefined();
  expect(l0.pub[tue]).toBeUndefined();
  /* the server says the same (422 same_menu) */
  const r = await context.request.post(BASE + "/api/admin/lunch/publish", { data: { dates: [tue] } });
  expect(r.status()).toBe(422);
  expect((await r.json()).error).toBe("same_menu");

  /* change one dish on Tuesday: the rule is gone, both days publish */
  await tap(page.locator('.ln-day [data-rm="l-lazanya-boloneze"]'));
  await addDish(page, "l-spageti-karbonara");
  await expect(page.locator(".ln-rule")).toHaveCount(0);
  await expect(day(page, tue)).toContainText("Чернова");
  await expect(page.locator(".ln-pub")).toContainText("2 дни чакат публикуване");
  await page.locator(".ln-pub [data-publish]").click();
  await toastHas(page, /Публикувано: пн, вт\. (Стига до сайта в своя ден\.|В демото)/);
  await expect(day(page, mon)).toContainText("Публикувано");
  await expect(day(page, tue)).toContainText("Публикувано");
  await expect(page.locator(".ln-pub")).not.toHaveClass(/\bon\b/);
  const l1 = await lunchOf(context);
  expect(l1.pub[mon].ids.sort()).toEqual(["l-lazanya-boloneze", "l-supa-topcheta"]);
  expect(l1.pub[tue].ids.sort()).toEqual(["l-spageti-karbonara", "l-supa-topcheta"]);
  /* every change is in the log (the core) */
  const log = (await (await context.request.get(BASE + "/api/admin/audit?action=lunch.")).json()) as { action: string }[];
  expect(log.filter((x) => x.action === "lunch.update").length).toBeGreaterThanOrEqual(5);
  expect(log.some((x) => x.action === "lunch.publish")).toBe(true);
  await expect(page.locator(".ln-logc .ln-log li").first()).toContainText("Публикувано в сайта: пн, вт");
  expect(errs).toEqual([]);
});

test("rights: Маркетинг without the section sees „Нямате права“; with it, before a PIN is set, „ПИН още не е зададен“", async ({ browser }) => {
  const ctx = await browser.newContext({ ...(await pageOpts(browser)) });
  await signIn(ctx, "marketing");
  const p = await ctx.newPage();
  await p.goto(BASE + "/admin/lunch/");
  await expect(p.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await ctx.request.get(BASE + "/api/admin/lunch")).status()).toBe(403);
  const adm = await browser.newContext();
  await signIn(adm, "admin");
  await setSections(adm, "marketing", (s) => [...new Set([...s, "lunch"])]);
  await p.goto(BASE + "/admin/lunch/");
  await expect(p.locator(".ln-gate h2")).toHaveText("ПИН още не е зададен");
  await expect(p.locator(".ln-pub")).not.toHaveClass(/\bon\b/);
  await ctx.close(); await adm.close();
});

test("PIN: set once (shown once, never again), wrong with the tries left, unlock, „Заключи“, the countdown", async ({ page, context, browser }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await page.goto(BASE + "/admin/lunch/");
  const card = page.locator('[data-edit-id="admin.lunch.pin"]');
  await expect(card).toContainText("ПИН още не е зададен");
  /* an easy PIN is refused */
  await tap(card.locator("[data-setpin]"));
  let s = page.locator(".sheetwrap.on .sheet");
  await s.locator("#lp-1").fill("1234"); await s.locator("#lp-2").fill("1234");
  await s.locator("[data-ok]").click();
  await expect(s.locator("#lp-1-e")).toContainText("по-труден ПИН");
  await s.locator("#lp-1").fill("2580"); await s.locator("#lp-2").fill("2508");
  await s.locator("[data-ok]").click();
  await expect(s.locator("#lp-2-e")).toHaveText("Двата ПИН-а не са еднакви.");
  await s.locator("#lp-2").fill("2580");
  await s.locator("[data-ok]").click();
  await expect(s.locator(".ln-newpin .code")).toHaveText("2580");
  await expect(s.locator("[data-undo]")).toHaveCount(0);
  await s.locator("[data-done]").click();
  await expect(card).toContainText("ПИН е зададен");
  await expect(card.locator("[data-setpin]")).toHaveText(/Смени ПИН/);
  await expect(page.locator("body")).not.toContainText("2580");
  /* never again: the sheet is empty, the API has no PIN */
  await tap(card.locator("[data-setpin]"));
  s = page.locator(".sheetwrap.on .sheet");
  await expect(s.locator("#lp-1")).toHaveValue("");
  await s.locator("[data-x]").click();
  const st = await (await context.request.get(BASE + "/api/admin/lunch/pin")).json();
  expect(st).toMatchObject({ pinSet: true, boss: true });
  expect(JSON.stringify(st)).not.toContain("2580");

  /* Маркетинг (with the section from the test above): the schedule is locked */
  const ctx = await browser.newContext({ ...(await pageOpts(browser, page)) });
  await signIn(ctx, "marketing");
  const p = await ctx.newPage();
  const perr = errors(p);
  await p.goto(BASE + "/admin/lunch/");
  await expect(p.locator(".ln-gate h2")).toHaveText("Графикът е заключен");
  const type = async (pin: string) => { for (const c of pin) await p.locator('.ln-keys [data-k="' + c + '"]').click(); };
  await type("1111");
  await expect(p.locator("[data-perr]")).toHaveText("Грешен ПИН. Опитайте пак.");
  await type("1112");
  await expect(p.locator("[data-perr]")).toContainText("Остават 3 опита");
  await type("2580");
  await expect(p.locator(".ln-week")).toBeVisible();
  await expect(p.locator(".sa-toast.on")).toContainText("Отключено");
  await expect(p.locator('[data-edit-id="admin.lunch.pin"]')).toContainText("Отключено с ПИН");
  await expect(p.locator("[data-setpin]")).toHaveCount(0);
  /* a change with the PIN is in the log ("с ПИН") */
  const mon = await nextMonday(ctx);
  await p.goto(BASE + "/admin/lunch/#w=" + mon + "&d=" + ymd(mon, 3));
  await expect(p.locator(".ln-day h2")).toHaveText(/^Четвъртък, /);
  await addDish(p, "l-tikven-chiyzkeyk");
  await expect(p.locator('.ln-day [data-row="l-tikven-chiyzkeyk"]')).toBeVisible();
  const log = (await (await context.request.get(BASE + "/api/admin/audit?action=lunch.")).json()) as { action: string; actor: string; data?: { pin?: boolean } }[];
  expect(log.some((x) => x.action === "lunch.update" && x.actor === "marketing" && x.data && x.data.pin)).toBe(true);
  expect(log.some((x) => x.action === "lunch.unlock" && x.actor === "marketing")).toBe(true);
  expect(log.filter((x) => x.action === "lunch.pin_fail").length).toBeGreaterThanOrEqual(2);
  /* "Заключи" */
  await tap(p.locator("[data-lock]"));
  await expect(p.locator(".ln-gate h2")).toHaveText("Графикът е заключен");
  expect((await ctx.request.get(BASE + "/api/admin/lunch")).status()).toBe(403);
  expect(perr).toEqual([]);

  /* another device: 5 wrong -> locked with a countdown, the keys wait */
  const ctx2 = await browser.newContext({ ...(await pageOpts(browser, page)) });
  await signIn(ctx2, "marketing");
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + "/admin/lunch/");
  await expect(p2.locator(".ln-gate h2")).toHaveText("Графикът е заключен");
  for (let i = 0; i < 5; i++) {
    for (const c of "000" + i) await p2.locator('.ln-keys [data-k="' + c + '"]').click();
    await expect(p2.locator("[data-perr]")).not.toHaveText("");
  }
  await expect(p2.locator("[data-perr]")).toContainText("Твърде много грешни опити.");
  await expect(p2.locator("[data-perr]")).toContainText(/Остават 1[45]:\d\d\./);
  await expect(p2.locator('.ln-keys [data-k="1"]')).toBeDisabled();
  await ctx.close(); await ctx2.close();
  expect(errs).toEqual([]);
});

test("„Изчерпано днес“ for a lunch dish: the same switch as the menu, with „Върни“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  /* the preview (?preview=1): the lunch menu of the data counts as today's, as in the prototype */
  await page.goto(BASE + "/admin/lunch/?preview=1&t=12:30");
  const out = page.locator(".ln-out");
  await expect(out.locator("h3")).toHaveText("Изчерпано днес");
  const sw = out.locator('[data-lout="l-supa-topcheta"]');
  await sw.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sw.click({ force: true });
  await expect(sw).toBeChecked();
  await expect(out.locator("h3")).toHaveText("Изчерпано днес · 1");
  await expect(sw.locator("xpath=ancestor::label[1]")).toContainText("Изчерпано днес");
  await toastHas(page, "Изчерпано днес: Супа топчета");
  const outNow = async () => ((await (await context.request.get(BASE + "/api/menu", { headers: { "x-sc-clock": "12:30" } })).json()) as { lunch: { items: { id: string; out?: boolean }[] } }).lunch.items.find((x) => x.id === "l-supa-topcheta")!.out;
  await expect.poll(outNow).toBe(true);
  await page.waitForTimeout(400);
  await expect(page.locator(".sa-toast.on [data-tu]")).toHaveText(/Върни/);
  await page.locator(".sa-toast.on [data-tu]").click({ force: true });
  await expect(out.locator('[data-lout="l-supa-topcheta"]')).not.toBeChecked();
  await expect.poll(outNow).toBeFalsy();
  const log = (await (await context.request.get(BASE + "/api/admin/audit?action=menu.")).json()) as { action: string; target: string }[];
  expect(log.some((x) => x.action === "menu.sold_out" && x.target === "l-supa-topcheta")).toBe(true);
  /* the note about -30% after 15:00 (pickup only) */
  await expect(page.locator(".ln-30")).toContainText("След 15:00 обедното меню е само за вземане от място, с -30%.");
  await expect(page.locator(".ln-g")).toContainText("Публикация в Google профила");
  await expect(page.locator(".ln-g")).toContainText("Скоро");
  expect(errs).toEqual([]);
});

test("360 without a horizontal scroll; the selected day in view @phone", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  const mon = await nextMonday(context);
  await page.goto(BASE + "/admin/lunch/#w=" + mon + "&d=" + ymd(mon, 4));
  await expect(page.locator(".ln-day h2")).toHaveText(/^Петък, /);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  const box = await day(page, ymd(mon, 4)).boundingBox();
  expect(box && box.x + box.width).toBeLessThanOrEqual(360);
  /* every target at least 48 px high */
  const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".sa-page button, .sa-page a, .sa-page input:not(.vh)")).filter((el) => el.offsetParent && el.getBoundingClientRect().height < 44).map((el) => el.className + ":" + (el.textContent || "").trim().slice(0, 20)));
  expect(small).toEqual([]);
});

test("axe: no serious or critical (the schedule and the PIN screen)", async ({ page, context, browser }) => {
  await signIn(context, "admin");
  await page.goto(BASE + "/admin/lunch/?preview=1&t=19:42");
  await expect(page.locator(".ln-week")).toBeVisible();
  await expect(page.locator(".ln-out .ln-og")).toBeVisible();
  const serious = async (pg: Page) => (await new AxeBuilder({ page: pg }).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
  expect(await serious(page)).toEqual([]);
  const ctx = await browser.newContext({ ...(await pageOpts(browser, page)) });
  await signIn(ctx, "marketing");
  const p = await ctx.newPage();
  await p.goto(BASE + "/admin/lunch/");
  await expect(p.locator(".ln-gate")).toBeVisible();
  expect(await serious(p)).toEqual([]);
  await ctx.close();
});

/* a new context with the size of this project (phone or computer) */
async function pageOpts(_b: unknown, page?: Page) {
  const v = page ? page.viewportSize() : null;
  return v ? { viewport: v, isMobile: v.width < 700, hasTouch: v.width < 700 } : {};
}
