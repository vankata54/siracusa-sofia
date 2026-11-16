import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ownServer, signIn, dbPut, errors, E, type Own } from "./own-server.ts";

/* /admin/reservations/ (design/pages-admin/reservations.html): the day by hour, "Потвърди" with "Отмени", "Дошли" /
   "Неявили се" only from 30 min before the time (the core refuses earlier), two no-shows put the number on the list and
   "Блокирай" decides it (the number never whole in the list; "Покажи" goes into the log), the staff's "Нова резервация"
   (errors under the fields, a blocked number), the waiting list ("Дай маса"), #blocks from the dashboard, the rights (no
   section: "Нямате права"; a role with the section but not a boss: the list read only, the core says 403), 360, axe.
   Its own server per project (E2E_PORT + 5 / + 6): the roles change and bookings earlier today go straight into the
   database (the API never accepts a past time). */
let S: Own;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({}, info: TestInfo) => {
  test.setTimeout(120_000);
  test.skip(!E.ADMIN_PASSWORD || !E.MARKETING_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("res-" + info.project.name, info.project.name === "phone" ? 5 : 6);
});
test.afterAll(async () => { if (S) await S.stop(); });

const pad = (n: number) => String(n).padStart(2, "0");
const sofia = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()); const g = (t: string) => p.find((x) => x.type === t)!.value; return { ymd: g("year") + "-" + g("month") + "-" + g("day"), min: (+g("hour") % 24) * 60 + +g("minute") }; };
const addDays = (k: string, n: number) => { const [y, m, d] = k.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10); };
const rnd = () => String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
const phone = () => "0888" + rnd();
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
async function api(page: Page, method: string, path: string, data?: unknown) {
  const r = await page.context().request.fetch(S.base + "/api/" + path, { method, data });
  return { status: r.status(), j: await r.json().catch(() => null) };
}
/** a booking earlier today ("Дошли" / "Неявили се" can be marked), straight into the database */
function pastToday(name: string, ph: string, extra: Record<string, unknown> = {}) {
  const s = sofia(), t = Math.max(0, Math.floor((s.min - 40) / 30) * 30), time = pad(Math.floor(t / 60)) + ":" + pad(t % 60), id = "e2e" + rnd();
  const now = new Date().toISOString();
  dbPut(S.db, "reservations", { id, date: s.ymd, time, people: 2, table: null, zone: null, name, phone: ph, marketing: false, status: "confirmed", createdAt: now, updatedAt: now, dur: 120, key: "k" + rnd(), ...extra },
    { date: s.ymd, time, table_id: null, phone: ph, status: "confirmed" });
  return { id, time, date: s.ymd };
}
const card = (page: Page, name: string) => page.locator("article.rsv").filter({ hasText: name });
async function undo(page: Page) {
  await expect(page.locator(".sa-toast")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
}
async function open(page: Page, hash = "") {
  await page.goto(S.base + "/admin/reservations/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Резервации");
  await expect(page.locator(".kpis")).toBeVisible();
}

test("a guest's booking: „Потвърди“ and „Отмени“; tomorrow has no „Дошли“ and the core refuses it 30+ min early", async ({ page }) => {
  const errs = errors(page);
  await signIn(page.context(), S.base, "admin");
  const tm = addDays(sofia().ymd, 1), name = "Гост " + rnd();
  const g = await page.context().request.post(S.base + "/api/reservations", { data: { date: tm, time: "19:00", people: 2, name, phone: phone(), marketing: false } });
  expect(g.status()).toBe(201);
  await open(page, "#d=" + tm);
  const c = card(page, name);
  await expect(c.locator(".st")).toHaveText("Нова");
  await expect(c.locator('[data-st="seated"]')).toHaveCount(0);
  await c.locator('[data-st="confirmed"]').click();
  await expect(page.locator(".sa-toast")).toContainText(name + ": Потвърдена");
  await expect(c.locator(".st")).toHaveText("Потвърдена");
  await expect(c.locator('[data-st="seated"]')).toHaveCount(0); /* tomorrow: not yet */
  const id = await c.getAttribute("data-rv");
  expect((await api(page, "POST", "admin/reservations/" + id + "/status", { status: "seated" })).status).toBe(409);
  await undo(page);
  await expect(c.locator(".st")).toHaveText("Нова");
  expect(errs).toEqual([]);
});

test("two no-shows: the number waits for a decision, „Блокирай“; the phone is never whole in the list, „Покажи“ is in the log", async ({ page }) => {
  const errs = errors(page);
  await signIn(page.context(), S.base, "admin");
  const ph = phone(), name = "Неявил " + rnd();
  pastToday(name, ph); pastToday(name, ph);
  await open(page);
  await expect(page.locator("body")).not.toContainText(ph);
  await expect(page.locator("body")).not.toContainText(ph.slice(0, 4) + " " + ph.slice(4, 6));
  const cs = card(page, name);
  await expect(cs).toHaveCount(2);
  await cs.locator('[data-st="no_show"]').first().click();
  await expect(page.locator(".sa-toast")).toContainText(name + ": Неявили се");
  await expect(cs.locator(".st").filter({ hasText: "Неявили се" })).toHaveCount(1);
  await cs.locator('[data-st="no_show"]').first().click();
  await expect(page.locator(".sa-toast")).toContainText("2 неявявания: номерът чака решение за блокиране");
  const box = page.locator("section.box[aria-labelledby^='bl-h']").filter({ visible: true });
  const item = box.locator(".bi").filter({ hasText: name });
  await expect(item).toContainText("2 неявявания");
  await expect(item).toContainText(ph.slice(0, 4) + " •• •• " + ph.slice(8));
  await expect(cs.nth(0).locator(".late")).toContainText("Чака блокиране");
  await item.locator('[data-bl="block"]').click();
  await expect(page.locator(".sa-toast")).toContainText(name + " е блокиран");
  await expect(box.locator(".bi").filter({ hasText: name })).toContainText("Отблокирай");
  const bl = (await api(page, "GET", "admin/blocks")).j as { rows: { name: string; status: string }[] };
  expect(bl.rows.find((r) => r.name === name)!.status).toBe("blocked");
  /* "Покажи" the phone: whole in the sheet, a line in the log */
  await cs.nth(0).locator("[data-open]").click();
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh).toContainText("Неявили се");
  await sh.locator("[data-reveal]").click();
  await expect(sh.locator("[data-phv] a")).toHaveAttribute("href", "tel:" + ph);
  const rid = await cs.nth(0).getAttribute("data-rv");
  const log = (await api(page, "GET", "admin/audit")).j as { action: string; target: string }[];
  expect(log.some((x) => x.action === "reservation.phone_view" && x.target === rid)).toBe(true);
  /* a blocked number cannot book (the staff's form says so) */
  await sh.locator("[data-close]").click();
  await page.locator(".sa-head [data-new]").click();
  const f = page.locator(".sheetwrap.on .sheet");
  await f.locator("#nr-d").fill(addDays(sofia().ymd, 2));
  await f.locator("#nr-t").selectOption("19:00");
  await f.locator("#nr-n").fill(name);
  await f.locator("#nr-ph").fill(ph);
  await f.locator("[data-ok]").click();
  await expect(f.locator("#nr-ph-err")).toContainText("блокиран");
  expect(errs).toEqual([]);
});

test("„Нова резервация“: errors under the fields, then a table from the free ones; without a table into „Чакащи“ and „Дай маса“", async ({ page }) => {
  const errs = errors(page);
  await signIn(page.context(), S.base, "admin");
  const d = addDays(sofia().ymd, 3), name = "Нов " + rnd(), name2 = "Чака " + rnd();
  await open(page, "#d=" + d);
  await page.locator(".sa-head [data-new]").click();
  const f = page.locator(".sheetwrap.on .sheet");
  await f.locator("[data-ok]").click();
  await expect(f.locator("#nr-t-err")).toHaveText("Изберете час между 11:00 и 21:30.");
  await expect(f.locator("#nr-n-err")).toHaveText("Напишете името на госта.");
  await expect(f.locator("#nr-ph-err")).toHaveText("Телефонът трябва да е 10 цифри, например 0888 12 34 56.");
  await expect(f.locator("#nr-t")).toBeFocused();
  await f.locator("#nr-t").selectOption("20:00");
  await f.locator("#nr-p").fill("2");
  await f.locator("#nr-p").dispatchEvent("change");
  await expect(f.locator("#nr-tb option").nth(1)).toBeAttached();
  const tval = await f.locator("#nr-tb option").nth(1).getAttribute("value");
  await f.locator("#nr-tb").selectOption(tval!);
  await f.locator("#nr-n").fill(name);
  await f.locator("#nr-ph").fill("0888 " + rnd().slice(0, 2) + " " + rnd().slice(0, 2) + " " + rnd().slice(0, 2));
  await f.locator("#nr-o").selectOption("Рожден ден");
  await f.locator("[data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText("Резервацията е записана");
  const c = card(page, name);
  await expect(c.locator(".st")).toHaveText("Потвърдена");
  await expect(c).toContainText("Рожден ден");
  const day = (await api(page, "GET", "admin/reservations/day?date=" + d)).j as { rows: { name: string; status: string; table: string }[] };
  expect(day.rows.find((r) => r.name === name)).toMatchObject({ status: "confirmed", table: tval });
  /* without a table: "Чака маса" in "Чакащи", then "Дай маса" */
  await page.locator(".sa-head [data-new]").click();
  await f.locator("#nr-t").selectOption("13:00");
  await f.locator("#nr-n").fill(name2);
  await f.locator("#nr-ph").fill(phone());
  await f.locator("[data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText("(чака маса)");
  const wl = page.locator("section.box[aria-labelledby^='wl-h']").filter({ visible: true });
  await expect(wl).toContainText(name2);
  await wl.locator(".bi").filter({ hasText: name2 }).locator("[data-seat-wl]").click();
  await f.locator("[data-ok]").click();
  await expect(page.locator(".sa-toast")).toContainText(name2 + " получи маса");
  await expect(card(page, name2).locator(".st")).toHaveText("Потвърдена");
  await expect(wl).not.toContainText(name2);
  expect(errs).toEqual([]);
});

test("#blocks: the box „Блокиране“ is in view with the focus on its title", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await open(page, "#blocks");
  const h = page.locator("section.box[aria-labelledby^='bl-h'] h3").filter({ visible: true });
  await expect(h).toBeFocused();
  await expect(h).toBeInViewport();
});

test("rights: no section -> „Нямате права“; with the section but not a boss -> blocking read only (the core says 403)", async ({ page, browser }) => {
  await signIn(page.context(), S.base, "admin");
  const roles = (await api(page, "GET", "admin/roles")).j as { id: string; sections: string[] }[];
  const mk = roles.find((r) => r.id === "marketing")!;
  const ph = phone(), name = "Чака " + rnd();
  pastToday(name, ph); pastToday(name, ph);
  const ids = ((await api(page, "GET", "admin/reservations/day")).j as { rows: { id: string; name: string }[] }).rows.filter((r) => r.name === name).map((r) => r.id);
  for (const id of ids) expect((await api(page, "POST", "admin/reservations/" + id + "/status", { status: "no_show" })).status).toBe(200);
  const ctx = await browser.newContext({ viewport: page.viewportSize()! });
  const p2 = await ctx.newPage();
  await signIn(ctx, S.base, "marketing");
  await p2.goto(S.base + "/admin/reservations/");
  await expect(p2.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await api(page, "PUT", "admin/roles/marketing", { sections: [...mk.sections, "reservations"] })).status).toBe(200);
  try {
    await p2.goto(S.base + "/admin/reservations/#blocks");
    await p2.reload(); /* only the hash changed: a real load with the new rights */
    const box = p2.locator("section.box[aria-labelledby^='bl-h']").filter({ visible: true });
    await expect(box).toContainText("Ролята „Маркетинг“ само вижда списъка.");
    const item = box.locator(".bi").filter({ hasText: name });
    await expect(item.locator('[data-bl="block"]')).toBeDisabled();
    await expect(box.locator("[data-bladd]")).toBeDisabled();
    const bl = (await (await ctx.request.get(S.base + "/api/admin/blocks")).json()) as { rows: { ref: string; name: string }[]; canDecide: boolean };
    expect(bl.canDecide).toBe(false);
    const r = await ctx.request.post(S.base + "/api/admin/blocks/" + bl.rows.find((x) => x.name === name)!.ref, { data: { action: "block" } });
    expect(r.status()).toBe(403);
  } finally {
    await api(page, "PUT", "admin/roles/marketing", { sections: mk.sections });
    await ctx.close();
  }
});

test("phone: the day strip, the status select, 360 without a horizontal scroll; axe without serious @phone", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  pastToday("Телефон " + rnd(), phone());
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  await expect(page.locator(".days")).toBeVisible();
  await expect(page.locator("[data-fsel]")).toBeVisible();
  await expect(page.locator(".rs-bar .sa-tabs")).toBeHidden();
  const over = await page.evaluate(() => { const sc = document.querySelector(".sa-scroller")!; return document.documentElement.scrollWidth > innerWidth || sc.scrollWidth > sc.clientWidth; });
  expect(over).toBe(false);
  await page.locator("[data-fsel]").selectOption("seated");
  await expect(page.locator("[data-list]")).toContainText("Нищо не отговаря на филтъра.");
  expect(page.url()).toContain("f=seated");
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});

test("desktop: the calendar picks a day; axe without serious @desktop", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await open(page);
  expect(isPhone(page)).toBe(false);
  const tm = addDays(sofia().ymd, 1);
  await page.locator('.cal-wrap [data-day="' + tm + '"]').first().click();
  await expect(page.locator(".dayh h2 small")).toHaveText("Утре");
  expect(page.url()).toContain("d=" + tm);
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});
