import { test, expect, type Page, type BrowserContext, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* "Нова поръчка" of the waiter (/servitor/porachka/#n, src/modules/servitor/order.ts) on the real server: "За коя маса?",
   the search of the site (Cyrillic and Latin, forgiving spelling, one clear button), "+", a note to the kitchen,
   "Поотделно" with two guests, "Към кухнята · …" → the orders are in the kitchen's queue and on the table; the draft
   survives "Назад"; no connection: "Запази на телефона" and the order goes by itself when the connection is back; after
   22:30 the sending is stopped (the core says the same); a steak "за 100 гр." with grams; "Изчерпано днес"; 360 and 390,
   light and dark. The preview clock 19:30 (?preview=1&t=19:30 / x-sc-clock, SC_PREVIEW_API=1); the projects use their own
   tables (phone 7, 8, 9; desktop 10, 15, 16). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const PASS: Record<string, string> = { waiter: E.WAITER_PASSWORD, kitchen: E.KITCHEN_PASSWORD };
const CLOCK = { "x-sc-clock": "19:30" };
const Q = "?preview=1&t=19:30";
const phone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const tables = (page: Page) => (phone(page) ? [7, 8, 9] : [10, 15, 16]);

async function signIn(ctx: BrowserContext | APIRequestContext, role: string) {
  const req = "request" in ctx ? ctx.request : ctx;
  const r = await req.post("/api/auth/login", { data: { username: role, password: PASS[role] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[1349]|net::ERR_/.test(m.text())) list.push(m.text()); });
  return list;
}
async function api<T = any>(req: APIRequestContext, method: "GET" | "POST" | "PUT", path: string, data?: unknown, clock = CLOCK): Promise<{ status: number; body: T }> {
  const r = await req.fetch("/api/" + path, { method, headers: clock, data: data as object | undefined });
  return { status: r.status(), body: (await r.json().catch(() => null)) as T };
}
async function freeTable(w: APIRequestContext, n: number) {
  const d = (await api<any>(w, "GET", "floor/table/" + n)).body;
  if (!d.session) return;
  if (d.pending) await api(w, "POST", "floor/table/" + n + "/qr/reject", { reason: "test" });
  if (d.rest > 0) await api(w, "POST", "floor/table/" + n + "/pay", { how: "cash" });
  expect((await api(w, "POST", "floor/table/" + n + "/close", { force: true })).status).toBe(200);
}
async function ready(page: Page) {
  await expect(page.locator(".st-app:not([data-boot]) .st-me")).toBeVisible();
  await expect(page.locator("main .st-skel")).toHaveCount(0);
}
const row = (page: Page, name: string) => page.locator(".qrow", { has: page.locator(".nm", { hasText: new RegExp("^" + name + "$") }) });
/** nothing sticks out of the phone column (the column clips, so scrollWidth alone would not show it) */
const clipped = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("body *")).filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && el.offsetParent !== null && (r.right > innerWidth + 0.5 || r.left < -0.5) && !el.closest(".guests, .st-toast, .vh, .skip"); }).map((el) => el.tagName + "." + el.className));
const toast = (page: Page) => page.locator(".st-toast.on");
const search = async (page: Page, q: string) => { await page.fill("#q", q); await expect(page.locator(".res-h, [data-body] .st-empty h2").first()).toBeVisible(); };

test.beforeAll(() => { test.skip(!E.WAITER_PASSWORD || !E.KITCHEN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("„За коя маса?“ → search → „+“ → a note → „Поотделно“ with two guests → „Към кухнята“ → the kitchen and the table", async ({ page, playwright, baseURL }) => {
  const errs = errors(page), n = tables(page)[0];
  await signIn(page.context(), "waiter");
  const w = page.context().request;
  await freeTable(w, n);
  await page.addInitScript(() => { try { localStorage.removeItem("st-outbox"); Object.keys(localStorage).filter((k) => k.indexOf("st-draft-") === 0).forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ } });
  await page.goto("/servitor/porachka/" + Q);
  await ready(page);
  await expect(page.locator(".st-top h1")).toHaveText("Нова поръчка");
  await expect(page.locator(".st-top [data-sub]")).toHaveText("На маса: за коя маса?");
  await expect(page.locator(".st-nav [aria-current]")).toHaveAttribute("aria-label", "Нова поръчка");
  await expect(page.locator(".pick h2").first()).toContainText(/Маси · Салон|Моите маси/);
  await page.locator(".tile", { hasText: new RegExp("^Маса " + n + ",") }).click();
  await expect(page).toHaveURL(new RegExp("#" + n + "$"));
  await ready(page);
  await expect(page.locator(".st-top [data-sub]")).toHaveText("На маса: Маса " + n);
  await expect(page.locator(".st-top .st-back")).toHaveText("Маса");
  await expect(page.locator(".st-nav")).toHaveCount(0);
  await expect(page.locator(".cattile").first()).toBeVisible();

  /* "Поотделно": Гост 1 gets a pizza ("pica"), Гост 2 kebapcheta ("kebap") */
  await page.getByRole("button", { name: "Поотделно" }).click();
  await expect(page.locator("[data-guest]")).toHaveText(["Гост 1", "Гост 2"]);
  await search(page, "pica");
  await expect(page.locator(".schips .chip")).toContainText("пица");
  await row(page, "Пица Маргарита").getByRole("button", { name: "Добави Пица Маргарита" }).click();
  await expect(row(page, "Пица Маргарита").locator("output")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Още едно Пица Маргарита" })).toBeFocused();
  await page.locator('[data-guest="Гост 2"]').click();
  await search(page, "kebap");
  await row(page, "Кебапчета").getByRole("button", { name: "Добави Кебапчета" }).click();
  await row(page, "Кебапчета").getByRole("button", { name: "Още едно Кебапчета" }).click();
  await expect(page.locator(".st-bar [data-review]")).toHaveText("3 артикула · Преглед");
  await expect(page.locator(".st-bar [data-send]")).toHaveText("Към кухнята · 22,37 €");

  /* the review: a note to the kitchen (a quick note) and a note for the order */
  await page.locator(".st-bar [data-review]").click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet").last();
  await expect(sh.locator("h2")).toHaveText("Маса " + n + " · преглед");
  await expect(sh.locator(".st-cap")).toHaveText(["Гост 1", "Гост 2"]);
  await sh.getByRole("button", { name: "Бележка към Кебапчета" }).click();
  await expect(sh.locator("h2")).toHaveText("Бележка към кухнята");
  await sh.getByRole("button", { name: "Без лук" }).click();
  await sh.getByRole("button", { name: "Запази бележката" }).click();
  const rv = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(rv.locator(".nb")).toHaveText("Без лук");
  await rv.locator("#gn").fill("пицата първо");
  await expect(rv.locator(".rfl").first()).toHaveText("Добавя се към сметката на Маса " + n + ". Плащането е от „Сметка“ на масата.");
  await rv.locator("[data-send]").click();
  await expect(page.locator(".sent h1")).toHaveText("Поръчката е в кухнята");
  await expect(page.locator(".sent .lead")).toContainText("Маса " + n + " · 3 артикула · 22,37 €");
  await expect(page.locator(".sent .muted")).toContainText(/№ \d+, № \d+ · отделни сметки · в сметката на масата/);

  /* the kitchen has them; the table has two bills with the notes */
  const kitchen = await playwright.request.newContext({ baseURL }); await signIn(kitchen, "kitchen");
  const d = (await api<any>(w, "GET", "floor/table/" + n)).body;
  expect(d.bills.map((b: any) => b.name)).toEqual(["Гост 1", "Гост 2"]);
  const nos = d.bills.map((b: any) => b.orders[0].no);
  expect(d.bills[1].orders[0].lines[0]).toMatchObject({ id: "kebapcheta", q: 2, note: "Без лук" });
  expect(d.bills[0].orders[0].note).toBe("пицата първо");
  const qd = JSON.stringify((await api(kitchen, "GET", "kitchen/queue?sec=all")).body);
  for (const no of nos) expect(qd).toContain('"' + no + '"');
  expect(await page.evaluate((k) => localStorage.getItem(k), "st-draft-" + n)).toBeNull();
  await page.getByRole("link", { name: "Към Маса " + n }).click();
  await expect(page.locator(".st-top h1")).toHaveText("Маса " + n);
  await expect(page.locator(".ocard")).toHaveCount(2);
  expect(errs).toEqual([]);
  await kitchen.dispose();
});

test("the draft survives „Назад“; no connection: „Запази на телефона“, then it goes by itself", async ({ page, context }) => {
  const errs = errors(page), n = tables(page)[1];
  await signIn(context, "waiter");
  await freeTable(context.request, n);
  await page.goto("/servitor/porachka/" + Q + "#" + n);
  await ready(page);
  await page.evaluate((k) => { localStorage.removeItem(k); localStorage.removeItem("st-outbox"); }, "st-draft-" + n);
  await page.reload(); await ready(page);
  await search(page, "cezar");
  await expect(page.locator(".qrow .nm").first()).toHaveText(/Салата Цезар/);
  await row(page, "Салата Цезар с пилешки пръчки").locator("[data-inc]").click();
  await page.locator(".st-top .st-back").click();
  await expect(page.locator(".st-top h1")).toHaveText("Маса " + n);
  await page.goto("/servitor/porachka/" + Q + "#" + n);
  await ready(page);
  await expect(toast(page)).toContainText("Недоизпратената поръчка е запазена: 1 артикул");
  await expect(page.locator(".st-bar [data-review]")).toHaveText("1 артикул · Преглед");

  /* no connection */
  await context.setOffline(true);
  await expect(page.locator(".st-net")).toContainText("Няма връзка");
  await expect(page.locator(".st-bar [data-send]")).toHaveText("Запази на телефона · 7,15 €");
  await page.locator(".st-bar [data-review]").click();
  await expect(page.locator(".st-sheetwrap.on .rfl").nth(1)).toHaveText("Няма връзка: поръчката тръгва към кухнята сама, щом се върне.");
  await page.locator(".st-sheetwrap.on [data-send]").click();
  await expect(page.locator(".sent h1")).toHaveText("Запазено на телефона");
  await expect(page.locator(".sent")).toContainText("Номерът на поръчката идва, щом има връзка.");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("st-outbox") || "[]").length)).toBe(1);
  await context.setOffline(false);
  await expect(page.locator(".sent h1")).toHaveText("Поръчката е в кухнята", { timeout: 15_000 });
  await expect(page.locator(".sent .muted")).toContainText(/№ \d+ · в сметката на масата/);
  expect(await page.evaluate(() => localStorage.getItem("st-outbox"))).toBeNull();
  const d = (await api<any>(context.request, "GET", "floor/table/" + n)).body;
  expect(d.bills[0].orders[0].lines[0].id).toBe("salata-tsezar-s-pileshki-prachki");
  expect(errs.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|EventSource/.test(e))).toEqual([]);
});

test("after 22:30 the sending is stopped; a steak with grams; „Изчерпано днес“; the Latin search", async ({ page, playwright, baseURL }) => {
  const errs = errors(page), n = tables(page)[2];
  await signIn(page.context(), "waiter");
  const w = page.context().request;
  await freeTable(w, n);
  /* the core says it too */
  const late = await api(w, "POST", "floor/table/" + n + "/order", { lines: [{ id: "kebapcheta", q: 1 }] }, { "x-sc-clock": "22:45" });
  expect(late.status).toBe(409);
  expect((late.body as { message: string }).message).toContain("Кухнята приема поръчки до 22:30");
  await page.goto("/servitor/porachka/?preview=1&t=22:45#" + n);
  await ready(page);
  await expect(page.locator("[data-body] .notice")).toContainText("Кухнята приема поръчки до 22:30, затова изпращането е спряно.");
  await page.locator('.cattile[data-cat="deserti"]').click();
  await row(page, "Тирамису").locator("[data-inc]").click();
  await expect(page.locator(".st-bar [data-send]")).toBeDisabled();

  /* 19:30: a steak "за 100 гр." asks its grams; "Изчерпано днес" stays visible and off */
  const kitchen = await playwright.request.newContext({ baseURL }); await signIn(kitchen, "kitchen");
  expect((await api(kitchen, "PUT", "kitchen/sold-out/kyunefe", { out: true, sec: "all" })).status).toBe(200);
  try {
    await page.goto("/servitor/porachka/" + Q + "#" + n);
    await ready(page);
    await expect(page.locator("[data-body] .notice")).toHaveCount(0);
    await search(page, "ribeye");
    await expect(page.locator(".qrow .nm").first()).toHaveText("Рибай стек от Блек Ангъс");
    await expect(page.locator(".qrow .g").first()).toHaveText("за 100 гр.");
    await page.getByRole("button", { name: "Добави Рибай стек от Блек Ангъс" }).click();
    const sh = page.locator(".st-sheetwrap.on .st-sheet");
    await expect(sh.locator("h2")).toHaveText("Грамаж");
    await sh.locator("#gg").fill("50");
    await expect(sh.locator("#ggerr")).toHaveText("Поне 100 гр.");
    await sh.locator('[data-gr="500"]').click();
    await expect(sh.locator("[data-gok]")).toHaveText("Добави · 46,00 €");
    await sh.locator("[data-gok]").click();
    /* the draft of 22:45 (Тирамису) is still there: 46,00 + 4,09 */
    await expect(page.locator(".st-bar [data-send]")).toHaveText("Към кухнята · 50,09 €");
    await search(page, "kyunefe");
    await expect(row(page, "Кюнефе")).toContainText("Изчерпано днес");
    await expect(row(page, "Кюнефе").locator("button")).toHaveCount(0);
    /* the Latin search with a forgiving spelling, and only one clear button */
    for (const [q, first] of [["kebap", "Кебапчета"], ["pica", /^Пица/], ["pizza", /^Пица/], ["cezar", /Цезар/], ["shopska", "Шопска салата"], ["angus", /Блек Ангъс/], ["ribeye", "Рибай стек от Блек Ангъс"]] as const) {
      await search(page, q);
      await expect(page.locator(".qrow .nm").first(), q).toHaveText(first);
    }
    await expect(page.locator(".search button")).toHaveCount(1);
    /* the browser's own × of type=search is hidden by the frame's rule (staff.css) */
    expect(await page.evaluate(() => [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => /\.search input\[type="search"\]::-webkit-search-cancel-button/.test(r.cssText) && /display:\s*none/.test(r.cssText)); } catch { return false; } }))).toBe(true);
    await page.locator(".search .clr").click();
    await expect(page.locator("#q")).toHaveValue("");
    await expect(page.locator(".cattile").first()).toBeVisible();
    await page.locator(".st-bar [data-send]").click();
    await expect(page.locator(".sent h1")).toHaveText("Поръчката е в кухнята");
    const d = (await api<any>(w, "GET", "floor/table/" + n)).body;
    expect(d.bills[0].orders[0].lines.map((l: any) => [l.id, l.grams, l.sum])).toContainEqual(["ribay-stek-ot-blek-angas", 500, 46]);
  } finally {
    await api(kitchen, "PUT", "kitchen/sold-out/kyunefe", { out: false, sec: "all" });
    await kitchen.dispose();
  }
  expect(errs).toEqual([]);
});

test("360 and 390, light and dark: no horizontal scroll, targets ≥ 48 px, axe without serious @phone", async ({ browser, baseURL }) => {
  for (const [width, theme] of [[360, "light"], [360, "dark"], [390, "light"], [390, "dark"]] as const) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, baseURL });
    await signIn(ctx, "waiter");
    const page = await ctx.newPage(), errs = errors(page);
    await page.addInitScript((t) => { try { localStorage.setItem("st-prefs", JSON.stringify({ theme: t })); } catch { /* ignore */ } }, theme);
    for (const path of ["/servitor/porachka/" + Q, "/servitor/porachka/" + Q + "#14"]) {
      await page.goto(path); await ready(page);
      if (path.endsWith("#14")) { await page.getByRole("button", { name: "Поотделно" }).click(); await search(page, "pica"); await page.locator(".qrow [data-inc]").first().click(); }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(0);
      expect(await clipped(page), path).toEqual([]);
      const small = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("main button, main a, .st-bar button, .st-top button, .st-top a, .st-nav a"))
        .filter((el) => el.offsetParent !== null).map((el) => { const r = el.getBoundingClientRect(); return [el.textContent!.trim() || el.getAttribute("aria-label"), Math.round(r.width), Math.round(r.height)] as const; }).filter((x) => x[1] < 48 || x[2] < 48));
      expect(small, path).toEqual([]);
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((x) => x.target.join(" ")).join(", ")), path).toEqual([]);
    }
    await page.locator(".st-bar [data-review]").click();
    await expect(page.locator(".st-sheetwrap.on .st-sheet h2")).toHaveText("Маса 14 · преглед");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    expect(await clipped(page)).toEqual([]);
    expect(errs).toEqual([]);
    await ctx.close();
  }
});
