import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { floorLock } from "./_floor-lock.ts";
import { E, apiAs, admin, newWaiter, startShift, endShift, freeTable, signInCtx, errors } from "./servitor-helpers.ts";

/* "Управител" › "Екипът", "Още", the search, the owner in the manager's module, and the look of the four screens
   (src/modules/upravitel/team.ts, more.ts, find.ts) on the real server:
   - "Смени масите": the sheet (the colleague's name under his table, the changes, at least one table), the waiter's own
     hall updates live in a second browser, "Отмени" gives the tables back;
   - "Още": the forms of the admin, the sections the role has, the theme, "Звук", "Изход";
   - the search: a table, an order number (exact first, the phone masked), "без лук", "оборот" never a sum;
   - the owner ("Смяната сега"): "Към Собственик", no "Звук";
   - 360, 390, 1024, 1440, light and dark: no horizontal scroll, targets of 48 px, the pencil in its place, axe without
     serious violations, no console errors. The hall is shared: floorLock(). */
floorLock();

const CLOCK = "19:42", PV = "?preview=1&t=" + CLOCK;
const USERS: Record<string, { username: string; password: string }> = {
  manager: { username: "manager", password: E.MANAGER_PASSWORD }, owner: { username: "owner", password: E.OWNER_PASSWORD },
};
async function open(page: Page, ctx: BrowserContext, path: string, who = "manager") {
  await signInCtx(ctx, USERS[who]);
  await page.goto(path + PV);
  await expect(page.locator("[data-upscr]")).toBeVisible();
}
const toast = (page: Page) => page.locator(".bs-toast.on");
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 900;

test("„Смени масите“: the sheet, at least one table, the waiter's hall updates live, „Отмени“", async ({ page, context, browser }) => {
  const errs = errors(page);
  const a = await admin();
  const w1 = await newWaiter(a), w2 = await newWaiter(a);
  for (const n of [19, 20]) await freeTable(a, n);
  await startShift(w1, [19]); await startShift(w2, [20]);
  try {
    /* the waiter's phone: his hall */
    const wctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await signInCtx(wctx, w1);
    const wp = await wctx.newPage();
    await wp.goto("/servitor/" + PV);
    await expect(wp.locator('.tile[data-fk="t19"] .own')).toBeVisible();
    await expect(wp.locator('.tile[data-fk="t20"] .own')).toHaveCount(0);
    await open(page, context, "/upravitel/ekipat/");
    const cardW = page.locator("#w-" + w1.username.replace(/\./g, "\\."));
    await expect(cardW).toContainText(w1.name);
    await expect(cardW.locator(".mg-tno")).toHaveText(["19"]);
    await cardW.getByRole("button", { name: "Смени масите" }).click();
    const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet");
    await expect(sh.locator("h2")).toHaveText("Масите на " + w1.name);
    /* the colleague's name under his table */
    await expect(sh.locator('[data-n="20"] small')).toHaveText(w2.name.replace(/ /g, " "));
    /* at least one table stays */
    await sh.locator('[data-n="19"]').click();
    await expect(sh.locator(".mg-err")).toContainText("Записът е спрян: " + w1.name + " трябва да има поне една маса.");
    await expect(sh.locator("[data-save]")).toBeDisabled();
    await sh.locator('[data-n="19"]').click();
    await sh.locator('[data-n="20"]').click();
    await expect(sh.locator('[data-n="20"]')).toHaveClass(/chg/);
    await expect(sh.locator(".mg-note[role=status]")).toContainText("Добавени: 20.");
    await sh.locator("[data-save]").click();
    await expect(toast(page)).toContainText("Масите на " + w1.name + " са сменени. " + w1.name + " и " + w2.name + " получават известие.");
    /* live on the waiter's phone */
    await expect(wp.locator('.tile[data-fk="t20"] .own')).toBeVisible({ timeout: 10_000 });
    await expect(cardW.locator(".mg-tno")).toHaveText(["19", "20"]);
    await toast(page).getByRole("button", { name: "Отмени" }).click();
    await expect(wp.locator('.tile[data-fk="t20"] .own')).toHaveCount(0, { timeout: 10_000 });
    await expect(cardW.locator(".mg-tno")).toHaveText(["19"]);
    await wctx.close();
  } finally { await endShift(w1); await endShift(w2); }
  expect(errs).toEqual([]);
});

test("„Още“: the forms of the admin, the sections the role has, the theme, „Звук“, „Изход“", async ({ page, context }) => {
  const errs = errors(page);
  await open(page, context, "/upravitel/oshte/");
  await expect(page.getByRole("link", { name: /Нова поръчка по телефон/ })).toHaveAttribute("href", "/admin/orders/#phone=1");
  await expect(page.getByRole("link", { name: /Нова резервация/ })).toHaveAttribute("href", "/admin/reservations/#new=1");
  await expect(page.getByRole("link", { name: /Моите препоръки/ })).toHaveAttribute("href", "/admin/notes/#src=manager");
  const secs = page.locator("section", { has: page.locator("#h-s") }).locator(".mg-setrow b");
  await expect(secs).toHaveText(["Поръчки", "Резервации", "Меню и изчерпано", "Обедно меню", "Отчети", "Персонал", "Настройки"]);
  await expect(page.locator('.bs-app main [data-sa="settheme"][data-v="dark"]')).toBeVisible();
  await page.locator('.bs-app main [data-sa="settheme"][data-v="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator('.bs-app main [data-sa="settheme"][data-v="system"]').click();
  /* "Звук" here and in the top bar are one setting */
  const sw = page.locator("[data-snd]");
  await expect(sw).toBeChecked();
  await page.locator(".mg-setrow .mg-switch").click();
  await expect(toast(page)).toHaveText("Звукът за нови онлайн поръчки е изключен");
  if (!isPhone(page)) await expect(page.locator('[data-bs="sound"]')).toHaveAttribute("aria-pressed", "false");
  await page.locator(".mg-setrow .mg-switch").click();
  await expect(sw).toBeChecked();
  await page.locator('.bs-app main [data-bs="logout"]').click();
  await expect(page).toHaveURL(/\/admin\/vhod\/$/);
  expect(errs).toEqual([]);
});

test("the owner in the manager's module: „Към Собственик“, no „Звук“", async ({ page, context }) => {
  const errs = errors(page);
  await open(page, context, "/upravitel/oshte/", "owner");
  await expect(page.locator('[data-bs="sound"]')).toHaveCount(0);
  await expect(page.locator("[data-snd]")).toHaveCount(0);
  await expect(page.locator(".bs-app main").getByRole("link", { name: /Към Собственик/ })).toHaveAttribute("href", "/sobstvenik/");
  if (!isPhone(page)) await expect(page.locator(".bs-top").getByRole("link", { name: "Към Собственик" })).toBeVisible();
  /* "Към админа" changes nothing remembered for the owner here */
  await expect(page.locator(".bs-app main").getByRole("link", { name: /Към админа/ })).not.toHaveAttribute("data-home", /./);
  await page.goto("/upravitel/" + PV);
  await expect(page.locator("[data-upscr]")).toBeVisible();
  expect(errs).toEqual([]);
});

test("the search: a table, an exact order number first with the phone masked, „без лук“, the sections; „оборот“ is never a sum", async ({ page, context }) => {
  const errs = errors(page);
  const r = await apiAs("manager", E.MANAGER_PASSWORD);
  const x = await r.post("/api/orders", { data: { cart: { mode: "pickup", lines: [{ id: "kebapcheta", key: "kebapcheta", q: 1, extra: 0, mods: [] }] }, name: "Търсен Клиент", phone: "0888 76 54 32", pay: "cash", note: "" } });
  const no = ((await x.json()) as { no: string }).no;
  await open(page, context, "/upravitel/");
  let field = page.locator("#bs-q"), box = page.locator("#bs-dres");
  if (isPhone(page)) { await page.locator('[data-bs="find"]').click(); field = page.locator("#bs-fq"); box = page.locator("#bs-fr"); }
  else await field.click();
  await expect(box.locator(".mg-fscope")).toBeVisible();
  await field.fill("12");
  await expect(box.locator(".mg-fgrp").first().locator("h2")).toContainText("Маси");
  await expect(box.locator("a.mg-frow").first()).toContainText("Маса 12");
  await expect(box.locator("a.mg-frow").first()).toHaveAttribute("href", "/upravitel/zalata/#t=12");
  await field.fill(no);
  await expect(box.locator("a.mg-frow").first()).toContainText("№ " + no);
  await expect(box.locator("a.mg-frow").first()).toContainText("0888 •• •• 32");
  await expect(box.locator("a.mg-frow").first()).not.toContainText("76 54");
  await field.fill("без лук");
  await expect(box.locator(".mg-fchips .chip.without")).toContainText("без лук");
  await expect(box.locator(".mg-fgrp h2").first()).toContainText("Ястия без лук");
  await field.fill("отчети");
  await expect(box.locator(".mg-fgrp", { hasText: "Раздели на админа" })).toContainText("Отчети");
  await field.fill("оборот");
  await expect(box.locator(".mg-fres")).toBeVisible();
  await expect(box).not.toContainText("€");
  expect(errs).toEqual([]);
});

/** visible things to press under 48 px (the scrim of a sheet aside) */
const smallTargets = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  document.querySelectorAll<HTMLElement>(".bs-app a[href], .bs-app button, .bs-app input, .bs-ov a[href], .bs-ov button").forEach((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[inert], .vh, p, .missing") || el.classList.contains("scrim") || (el as HTMLInputElement).type === "checkbox") return;
    if (r.width < 47.5 || r.height < 47.5) out.push((el.className || el.tagName) + " " + (el.textContent || "").trim().slice(0, 20) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  });
  return out;
});
test("the four screens at 360, 390, 1024, 1440, light and dark: no horizontal scroll, targets of 48 px, the pencil in its place, axe, no console errors @desktop", async ({ browser }) => {
  test.setTimeout(180_000);
  const sizes: [number, number, "light" | "dark"][] = [[360, 740, "dark"], [390, 844, "light"], [1024, 768, "light"], [1440, 900, "dark"]];
  for (const [w, h, scheme] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: w < 700, hasTouch: w < 700 });
    const page = await ctx.newPage(), errs = errors(page);
    for (const path of ["/upravitel/", "/upravitel/zalata/", "/upravitel/ekipat/", "/upravitel/oshte/"]) {
      await open(page, ctx, path);
      const at = w + " " + scheme + " " + path;
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), at + " horizontal scroll").toBeLessThanOrEqual(0);
      expect(await smallTargets(page), at + " targets").toEqual([]);
      /* the pencil: on the row of the bottom nav (phone) or at the bottom of the left rail (computer) */
      const pen = page.locator(".bs-penslot .sa-pen-btn");
      await expect(pen).toBeVisible();
      const g = await page.evaluate(() => { const p = document.querySelector(".bs-penslot .sa-pen-btn")!.getBoundingClientRect(), n = document.querySelector(innerWidth < 900 ? ".bs-nav" : ".bs-rail")!.getBoundingClientRect(); return { pc: p.top + p.height / 2, nt: n.top, nb: n.bottom, pl: p.left, nl: n.left, nr: n.right }; });
      expect(g.pc, at + " pencil").toBeGreaterThan(g.nt); expect(g.pc, at + " pencil").toBeLessThan(g.nb);
      const ax = await new AxeBuilder({ page }).analyze();
      expect(ax.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", ")), at + " axe").toEqual([]);
    }
    expect(errs, w + " console").toEqual([]);
    await ctx.close();
  }
});

test("without a connection the kept action is this person's: „Изход“ asks and removes it", async ({ page, context }) => {
  const r = await apiAs("manager", E.MANAGER_PASSWORD);
  const x = await r.post("/api/orders", { data: { cart: { mode: "pickup", lines: [{ id: "kebapcheta", key: "kebapcheta", q: 1, extra: 0, mods: [] }] }, name: "Изход Тест", phone: "0888 " + String(100000 + Math.floor(Math.random() * 899999)), pay: "cash", note: "" } });
  const no = ((await x.json()) as { no: string }).no;
  await open(page, context, "/upravitel/");
  const row = page.locator('.mg-wrow[data-wno="' + no + '"]');
  await context.setOffline(true);
  await expect(page.locator(".bs-net")).toBeVisible();
  await row.locator("button").click();
  await expect(row.locator(".mg-wout")).toContainText("Записано на телефона");
  const box = await page.evaluate(() => JSON.parse(localStorage.getItem("up-outbox") || "[]") as { user: string; op: string; day: string }[]);
  expect(box.map((k) => [k.user, k.op])).toEqual([["manager", "accept"]]);
  await page.locator('[data-bs="profile"]').click();
  await page.locator('.bs-sheet [data-bs="logout"]').click();
  const sh = page.locator(".bs-sheetwrap:not(.closing) .bs-sheet").last();
  await expect(sh.locator("h2")).toHaveText("Изход");
  await expect(sh).toContainText("1 неизпратено действие");
  await context.setOffline(false);
  await sh.getByRole("button", { name: "Изтрий и излез" }).click();
  await expect(page).toHaveURL(/\/admin\/vhod\//);
  expect(await page.evaluate(() => localStorage.getItem("up-outbox"))).toBeNull();
});
