import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* The admin frame (stage C, part 1): sign-in (error, attempts left, lockout by retryIn), sign-in by role (admin ->
   dashboard, waiter -> /servitor/), no session -> sign-in with #next=, no rights, "Чака те" with a real order made through
   the API, a new online order in real time, "Звук" remembered on the device, the badge "Бележки" = the number in "Чака те",
   360 without horizontal scroll, axe without serious, the empty space under the content (room for the round "Молив").
   The passwords come from .env (as in the other e2e tests); wrong attempts use unknown user names (the lockout counts per
   user name and per address, so the suite never locks a real account). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = {
  admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], waiter: ["waiter", E.WAITER_PASSWORD],
};
async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
/** console errors, without the expected 401 of a wrong sign-in */
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]/.test(m.text())) list.push(m.text()); });
  return list;
}
async function serious(page: Page, include = "body") {
  const r = await new AxeBuilder({ page }).include(include).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const dashboard = async (page: Page) => { await page.goto("/admin/"); await expect(page.locator(".waits, .wt-ok")).toBeVisible(); };

test("sign-in: one message for a wrong user or password, under the form, with the focus there", async ({ page }, info) => {
  const errs = errors(page);
  await page.goto("/admin/vhod/");
  await expect(page.locator("h1")).toHaveText("Вход");
  await expect(page.locator(".lg-forgot")).toHaveText("Забравена парола: обадете се на главния админ.");
  await page.fill("#u", "nobody-" + info.project.name);
  await page.fill("#p", "wrong-password-1");
  await page.click("[data-go]");
  const err = page.locator("[data-err]");
  await expect(err).toContainText("Грешен потребител или парола.");
  await expect(err).toBeFocused();
  await expect(page.locator("#p")).toHaveValue("");
  await expect(page.locator("#u")).toHaveAttribute("aria-invalid", "true");
  /* empty fields: the same message, no request */
  await page.fill("#u", "");
  await page.click("[data-go]");
  await expect(err).toContainText("Грешен потребител или парола.");
  expect(errs).toEqual([]);
});

test("sign-in: the last attempts are counted, and the lockout counts down by retryIn", async ({ page }) => {
  let n = 0;
  await page.route("**/api/auth/login", (r) => {
    n++;
    return n === 1
      ? r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "bad_login", message: "Грешен потребител или парола.", left: 2 }) })
      : r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "throttled", message: "Твърде много опити. Опитайте след 15 минути.", retryIn: 3 }) });
  });
  await page.goto("/admin/vhod/");
  await page.fill("#u", "admin"); await page.fill("#p", "x-wrong-1"); await page.click("[data-go]");
  await expect(page.locator("[data-err]")).toContainText("Остават 2 опита, после входът се заключва за 15 минути.");
  await page.fill("#p", "x-wrong-2"); await page.click("[data-go]");
  await expect(page.locator("[data-err]")).toContainText("Твърде много опити. Опитайте след 15 минути.");
  await expect(page.locator("[data-go]")).toBeDisabled();
  await expect(page.locator("[data-go]")).toContainText(/Заключено · 0:0[1-3]/);
  /* unlocked when retryIn has passed */
  await expect(page.locator("[data-go]")).toBeEnabled({ timeout: 6000 });
  await expect(page.locator("[data-go]")).toHaveText("Влез");
});

test("sign-in by role: the main admin -> the dashboard, the waiter -> /servitor/ (full screen, no admin bar)", async ({ page }) => {
  const errs = errors(page);
  await page.goto("/admin/vhod/");
  await page.fill("#u", USER.admin[0]); await page.fill("#p", USER.admin[1]); await page.click("[data-go]");
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(page.locator(".sa-h1")).toHaveText(/^(Добро утро|Добър ден|Добър вечер), /);
  await expect(page.locator("#db-wait-h")).toHaveText("Чака те");
  /* already signed in: the sign-in says so and leads back */
  await page.goto("/admin/vhod/");
  await expect(page.locator(".lg-in-as")).toContainText("Вече сте влезли като");
  await expect(page.locator(".lg-in-as a")).toHaveText("Към таблото");
  /* "Изход", then the waiter */
  await dashboard(page);
  await page.evaluate(() => (document.querySelector('[data-sa="logout"]') as HTMLElement).click());
  await expect(page).toHaveURL(/\/admin\/vhod\//);
  await page.fill("#u", USER.waiter[0]); await page.fill("#p", USER.waiter[1]); await page.click("[data-go]");
  await expect(page).toHaveURL(/\/servitor\/$/);
  await expect(page.locator("h1")).toHaveText("Модулът ти идва скоро");
  await expect(page.locator(".sa-side, .sa-bnav")).toHaveCount(0);
  /* a staff member on an admin address goes to the module */
  await page.goto("/admin/roles/");
  await expect(page).toHaveURL(/\/servitor\/$/);
  expect(errs).toEqual([]);
});

test("no session: every admin page and module -> /admin/vhod/#next=, and back after sign-in", async ({ page }) => {
  await page.goto("/admin/menu/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fadmin%2Fmenu%2F$/);
  await page.goto("/kuhnya/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fkuhnya%2F$/);
  await page.goto("/admin/notes/");
  await expect(page).toHaveURL(/#next=%2Fadmin%2Fnotes%2F$/);
  await page.fill("#u", USER.admin[0]); await page.fill("#p", USER.admin[1]); await page.click("[data-go]");
  await expect(page).toHaveURL(/\/admin\/notes\/$/);
  await expect(page.locator(".sa-h1")).toHaveText("Бележки (молив)");
});

test("no rights: „Нямате права за този раздел.“ with „Към таблото“", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto("/admin/roles/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  await expect(page.locator(".sa-noperm")).toContainText("Ролята „Собственик“ не вижда „Роли и права“.");
  await page.locator(".sa-noperm a").click();
  await expect(page).toHaveURL(/\/admin\/$/);
});

test("„Чака те“ with a real order from the API, the badge „Поръчки“ the same; a new online order arrives live", async ({ page, context }) => {
  await signIn(context, "admin");
  const order = () => context.request.post("/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode: "pickup", lines: [{ id: "kebapcheta", q: 1 }] }, name: "Иван Петров", phone: "0888 12 34 9" + Math.floor(Math.random() * 10) } });
  expect((await order()).status()).toBe(201);
  await dashboard(page);
  const sum = async () => (await (await context.request.get("/api/admin/summary")).json()) as { waiting: { orders: number } };
  const row = page.locator('.wt[data-fresh="orders"]');
  await expect(row).toContainText("Поръчки за приемане");
  /* the same number as the API (other tests add orders at the same time: compared on every tick) */
  const same = async () => +(await row.locator(".sa-n").textContent() || 0) === (await sum()).waiting.orders;
  await expect.poll(same).toBe(true);
  await expect(row.locator(".wgo")).toContainText("Приеми");
  await expect(row).toHaveAttribute("href", "/admin/orders/#s=accepted");
  /* live: the toast, the count and the blinking badge (until the orders are seen) */
  const r = await order(); expect(r.status()).toBe(201); const no = (await r.json()).no;
  await expect(page.locator(".sa-toast")).toContainText("Нова онлайн поръчка № " + no);
  await expect(page.locator('.sa-toast a')).toHaveAttribute("href", "/admin/orders/#n=" + no);
  await expect.poll(same).toBe(true);
  await expect(page.locator('[data-badge="orders"].fresh').first()).toBeAttached();
  await page.goto("/admin/orders/");
  await expect(page.locator('[data-badge="orders"].fresh')).toHaveCount(0);
});

test("the badge „Бележки“ = the number in „Чака те“, its name is read with the count", async ({ page, context, browser }) => {
  /* a recommendation from the waiter (every role writes them with the pencil) */
  const w = await browser.newContext();
  await signIn(w, "waiter");
  expect((await w.request.post("/api/admin/notes", { data: { module: "waiter", url: "/servitor/", selector: "h1", text: "Заглавието да е по-голямо.", viewport: { w: 390, h: 844 } } })).status()).toBe(201);
  await w.close();
  await signIn(context, "admin");
  await dashboard(page);
  const inWait = await page.locator(".wt").filter({ hasText: /Бележки за (одобрение|преглед)/ }).locator(".sa-n").allTextContents();
  const total = inWait.reduce((a, x) => a + +x, 0);
  expect(total).toBeGreaterThan(0);
  const host = page.locator(isPhone(page) ? ".sa-bnav a" : ".sa-side a").filter({ has: page.locator('[data-badge="notes"]') });
  await expect(host.locator('[data-badge="notes"]')).toHaveText(String(total));
  await expect(host).toHaveAccessibleName(new RegExp("^Бележки( \\(молив\\))? ?, " + total + " ча(ка|кат) теб$"));
  await expect(host.locator('[data-badge="notes"]')).toHaveAttribute("title", /одобрение|за преглед/);
});

test("„Звук“ is remembered on this device; „Звук: докоснете“ until the first touch of this load", async ({ page, context }) => {
  await signIn(context, "admin");
  await dashboard(page);
  const snd = page.locator('[data-sa="sound"]');
  await expect(snd).toHaveAttribute("aria-label", /^Звук: докоснете · нови поръчки/);
  await snd.click();
  await expect(snd).toHaveAttribute("aria-pressed", "false");
  await expect(snd).toHaveAttribute("aria-label", /^Звук изкл\. · нови поръчки/);
  expect(await page.evaluate(() => localStorage.getItem("sa-sound"))).toBe("off");
  await page.reload();
  await expect(snd).toHaveAttribute("aria-pressed", "false");
  await snd.click();
  await expect(snd).toHaveAttribute("aria-label", /^Звук вкл\. · нови поръчки$/);
  await page.reload();
  /* "unlocked" is never kept: a new load waits for the first touch again */
  await expect(snd).toHaveAttribute("aria-label", /^Звук: докоснете · нови поръчки/);
  /* only the preferences of the device stay in localStorage */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sa-")));
  expect(keys.every((k) => k === "sa-sound" || k === "sa-prefs")).toBe(true);
});

test("@phone 360: no horizontal scroll on the sign-in, the dashboard, a section and a module", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const over = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll(".sa-scroller, .sm-app, .lg")].map((s) => s.scrollWidth - s.clientWidth)));
  await page.goto("/admin/vhod/"); await expect(page.locator("h1")).toBeVisible(); expect(await over()).toBeLessThanOrEqual(0);
  await signIn(context, "admin");
  await dashboard(page); expect(await over()).toBeLessThanOrEqual(0);
  await page.goto("/admin/settings/"); await expect(page.locator(".sa-h1")).toBeVisible(); expect(await over()).toBeLessThanOrEqual(0);
  await page.goto("/shofyor/"); await expect(page.locator("h1")).toBeVisible(); expect(await over()).toBeLessThanOrEqual(0);
  /* the sheet "Търсене и раздели" */
  await page.goto("/admin/"); await page.locator('.sa-bnav [data-sa="sections"]').click();
  await expect(page.locator(".sheetwrap.on h2")).toHaveText("Търсене и раздели");
  expect(await over()).toBeLessThanOrEqual(0);
});

test("axe: no serious on the sign-in, the dashboard, a section, „Нямате права“ and a module", async ({ page, context }) => {
  await page.goto("/admin/vhod/"); await expect(page.locator("h1")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await signIn(context, "owner");
  await dashboard(page); await page.waitForTimeout(700); /* the gentle rise of the tiles */
  expect(await serious(page)).toEqual([]);
  await page.goto("/admin/roles/"); await expect(page.locator(".sa-noperm")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.goto("/admin/menu/"); await expect(page.locator(".sa-empty")).toBeVisible();
  expect(await serious(page)).toEqual([]);
  await page.goto("/kuhnya/"); await expect(page.locator("h1")).toBeVisible();
  expect(await serious(page)).toEqual([]);
});

test("the empty space under the content: the last element scrolls above the place of the round „Молив“ (56 px + gap)", async ({ page, context }) => {
  await signIn(context, "admin");
  for (const path of ["/admin/", "/admin/menu/"]) {
    await page.goto(path);
    await expect(page.locator("[data-body] > *").first()).toBeVisible();
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const sc = document.querySelector(".sa-scroller") as HTMLElement; sc.scrollTop = sc.scrollHeight;
      const body = document.querySelector("[data-body]") as HTMLElement, last = body.lastElementChild as HTMLElement;
      const nav = document.querySelector(".sa-bnav") as HTMLElement, navTop = nav && nav.offsetParent ? nav.getBoundingClientRect().top : innerHeight;
      return { last: last.getBoundingClientRect().bottom, floor: navTop };
    });
    /* above the round button (56 px) and its gap (16 px) */
    expect(g.last, path).toBeLessThanOrEqual(g.floor - 56 - 16);
  }
});
