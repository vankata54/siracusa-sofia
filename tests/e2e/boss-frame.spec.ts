import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* The shared frame of "Управител" (/upravitel/) and "Собственик" (/sobstvenik/) and the choice after the sign-in
   (stage D, step 6; src/modules/boss/frame.ts, src/admin/login.ts). Phone 390 and 360, computer 1440 and 1024, light and
   dark: the guard for every role, "Къде продължаваш?" with and without "Запомни", #next= to a module and to a forbidden
   address, every tab of both modules, the pencil on the row of the bottom nav / at the bottom of the rail on every scroll
   step and a recommendation with the right module, the profile and the theme, the keys of the search, the bar "Няма
   връзка", the key "Звук" and a new online order (made through the API), no horizontal scroll at 360, targets of 48 px,
   no console errors, axe without violations. The accounts come from .env (as in the other e2e tests). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = {
  admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD],
  waiter: ["waiter", E.WAITER_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD],
};
type Role = keyof typeof USER;
async function signIn(ctx: BrowserContext, role: Role) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
/** the sign-in through the form */
async function formIn(page: Page, role: Role) {
  await page.fill("#u", USER[role][0]); await page.fill("#p", USER[role][1]); await page.click("[data-go]");
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  /* without the refused requests while the test is offline */
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) list.push(m.text()); });
  return list;
}
/** every violation of axe (not only the serious ones) */
async function axe(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.map((v) => v.id + " (" + v.impact + "): " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 900;
/** the frame is drawn and the pencil is in its place */
async function ready(page: Page, title: string) {
  await expect(page.locator(".bs-top h1")).toHaveText(title);
  await expect(page.locator(".bs-penslot .sa-pen-btn")).toBeVisible();
}
const home = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("sa-home") || "{}") as Record<string, string>);
/** visible things to press that are smaller than 48 px (the hidden reader links and the scrim of a sheet aside) */
const smallTargets = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  document.querySelectorAll<HTMLElement>(".bs-app a[href], .bs-app button, .bs-app input, .bs-ov a[href], .bs-ov button, .bs-ov input").forEach((el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("[inert]") || el.classList.contains("scrim")) return;
    if (r.width < 47.5 || r.height < 47.5) out.push((el.className || el.tagName) + " " + Math.round(r.width) + "x" + Math.round(r.height));
  });
  return out;
});
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
const order = (ctx: BrowserContext) => ctx.request.post("/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode: "pickup", lines: [{ id: "kebapcheta", q: 1 }] }, name: "Иван Петров", phone: "0888 12 35 " + (10 + Math.floor(Math.random() * 90)) } });

const UP: [string, string, string][] = [["/upravitel/", "Сега", "now"], ["/upravitel/zalata/", "Залата", "hall"], ["/upravitel/ekipat/", "Екипът", "team"], ["/upravitel/oshte/", "Още", "more"]];
const SO: [string, string, string][] = [["/sobstvenik/", "Днес", "today"], ["/sobstvenik/tendentsii/", "Тенденции", "trends"], ["/sobstvenik/finansi/", "Финанси и гориво", "finance"], ["/sobstvenik/reshenia/", "Решения", "decisions"]];

test("no session: a module address -> the sign-in with #next=; after the sign-in #next= to a module wins over the choice", async ({ page }) => {
  const errs = errors(page);
  await page.goto("/upravitel/zalata/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fupravitel%2Fzalata%2F$/);
  await formIn(page, "manager");
  await expect(page).toHaveURL(/\/upravitel\/zalata\/$/);
  await ready(page, "Залата");
  /* the owner module, with a parameter in the address */
  await page.context().clearCookies();
  await page.goto("/sobstvenik/tendentsii/#p=30");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fsobstvenik%2Ftendentsii%2F%23p%3D30$/);
  await formIn(page, "owner");
  await expect(page).toHaveURL(/\/sobstvenik\/tendentsii\/#p=30$/);
  await ready(page, "Тенденции");
  expect(errs).toEqual([]);
});

test("the guard by role: the manager, the owner, the main admin, the waiter, marketing", async ({ browser }) => {
  const open = async (role: Role, path: string, pre?: Record<string, string>) => {
    const ctx = await browser.newContext(); await signIn(ctx, role);
    const page = await ctx.newPage();
    if (pre) await page.addInitScript((v) => localStorage.setItem("sa-home", JSON.stringify(v)), pre);
    await page.goto(path); await page.waitForLoadState("networkidle");
    const url = new URL(page.url()).pathname, h1 = await page.locator("h1").first().textContent();
    await ctx.close();
    return [url, h1];
  };
  /* the manager: the own module; the owner's module -> his home (the dashboard; the module only when it is remembered) */
  expect(await open("manager", "/upravitel/")).toEqual(["/upravitel/", "Сега"]);
  expect((await open("manager", "/sobstvenik/"))[0]).toBe("/admin/");
  expect(await open("manager", "/sobstvenik/finansi/", { manager: "app" })).toEqual(["/upravitel/", "Сега"]);
  /* the owner and the main admin: both */
  expect(await open("owner", "/sobstvenik/")).toEqual(["/sobstvenik/", "Днес"]);
  expect(await open("owner", "/upravitel/ekipat/")).toEqual(["/upravitel/ekipat/", "Екипът"]);
  expect(await open("admin", "/sobstvenik/reshenia/")).toEqual(["/sobstvenik/reshenia/", "Решения"]);
  expect(await open("admin", "/upravitel/")).toEqual(["/upravitel/", "Сега"]);
  /* the staff: the own module; a role of the admin without the modules: the dashboard */
  expect((await open("waiter", "/upravitel/"))[0]).toBe("/servitor/");
  expect((await open("waiter", "/sobstvenik/"))[0]).toBe("/servitor/");
  expect((await open("marketing", "/upravitel/oshte/"))[0]).toBe("/admin/");
});

test("„Къде продължаваш?“ without „Запомни“: asked every time; the module first and main on the phone", async ({ page }) => {
  const errs = errors(page);
  await page.goto("/admin/vhod/");
  await formIn(page, "manager");
  const h = page.locator("#ch-h");
  await expect(h).toHaveText("Къде продължаваш?");
  await expect(h).toBeFocused();
  await expect(page).toHaveTitle(/^Къде продължаваш\?/);
  await expect(page.locator(".ch .lead")).toContainText("Влезе като");
  const cards = page.locator(".ch-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText("Смяната"); await expect(cards.nth(0)).toContainText("Бързият екран за деня");
  await expect(cards.nth(1)).toContainText("Админ панел"); await expect(cards.nth(1)).toContainText("Пълната работа");
  await expect(cards.nth(0)).toHaveAttribute("href", "/upravitel/");
  await expect(cards.nth(1)).toHaveAttribute("href", "/admin/");
  const boxes = await cards.evaluateAll((l) => l.map((el) => { const r = el.getBoundingClientRect(); return { y: r.top, h: r.height, x: r.left, bg: getComputedStyle(el).backgroundColor }; }));
  for (const b of boxes) expect(b.h).toBeGreaterThanOrEqual(72);
  if (isPhone(page)) { expect(boxes[0].y).toBeLessThan(boxes[1].y); expect(boxes[0].h).toBeGreaterThan(boxes[1].h); expect(boxes[0].bg).not.toBe(boxes[1].bg); }
  else { expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1); expect(Math.abs(boxes[0].h - boxes[1].h)).toBeLessThan(1); expect(boxes[0].bg).toBe(boxes[1].bg); }
  await expect(page.locator(".ch-also")).toHaveCount(0);
  await expect(page.locator("#ch-rem")).not.toBeChecked();
  await expect(page.locator('label[for="ch-rem"]')).toContainText("Запомни избора на това устройство");
  expect(await noSideScroll(page)).toBe(true);
  expect(await axe(page)).toEqual([]);
  await cards.nth(0).click();
  await expect(page).toHaveURL(/\/upravitel\/$/);
  await ready(page, "Сега");
  expect(await home(page)).toEqual({});
  /* "Изход" and again: the question again; "Изход" on the card leads back to the form */
  await page.locator('[data-bs="profile"]').click();
  await page.locator('.bs-sheet [data-bs="logout"]').click();
  await expect(page).toHaveURL(/\/admin\/vhod\/$/);
  await formIn(page, "manager");
  await expect(page.locator("#ch-h")).toBeFocused();
  await page.locator(".ch [data-out]").click();
  await expect(page.locator("form.lg-form")).toBeVisible();
  await expect(page.locator(".ch")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("„Къде продължаваш?“ with „Запомни“: next time straight there; the choice follows „Отвори приложението“ and „Към админа“", async ({ page }) => {
  const errs = errors(page);
  await page.goto("/admin/vhod/");
  await formIn(page, "manager");
  await page.locator(".ch-rem .sa-check").click();
  await expect(page.locator("#ch-rem")).toBeChecked();
  await page.locator('.ch-card[data-pick="admin"]').click();
  await expect(page).toHaveURL(/\/admin\/$/);
  expect(await home(page)).toEqual({ manager: "admin" });
  /* the next sign-in on this device: straight to the admin */
  await expect(page.locator(".sa-h1")).toBeVisible();
  await page.evaluate(() => (document.querySelector('[data-sa="logout"]') as HTMLElement).click());
  await expect(page).toHaveURL(/\/admin\/vhod\//);
  await formIn(page, "manager");
  await expect(page).toHaveURL(/\/admin\/$/);
  /* "Отвори приложението" on the dashboard: the module, and the remembered choice follows */
  const openApp = page.locator('.sa-head a[data-home="app"]');
  await expect(openApp).toHaveText("Отвори приложението");
  await expect(openApp).toHaveAttribute("href", "/upravitel/");
  await openApp.click();
  await ready(page, "Сега");
  expect(await home(page)).toEqual({ manager: "app" });
  /* "Към админа": in the top bar on the computer, in the profile on the phone */
  if (isPhone(page)) { await page.locator('[data-bs="profile"]').click(); await page.locator('.bs-sheet a[data-home="admin"]').click(); }
  else await page.locator('.bs-top a[data-home="admin"]').click();
  await expect(page).toHaveURL(/\/admin\/$/);
  expect(await home(page)).toEqual({ manager: "admin" });
  /* the sign-in page of a signed-in manager: both ways, and "Къде продължаваш?" again with the remembered card marked */
  await page.goto("/admin/vhod/");
  await expect(page.locator(".lg-in-as a")).toHaveText(["Към приложението", "Към таблото"]);
  await page.goto("/admin/vhod/#st=choose");
  await expect(page.locator("#ch-h")).toHaveText("Къде продължаваш?");
  await expect(page.locator('.ch-card[data-pick="admin"] .rem')).toHaveText("Запомнено");
  await expect(page.locator("#ch-rem")).toBeChecked();
  expect(errs).toEqual([]);
});

test("the owner chooses „Собственик“ or the admin, with „Смяната сега: екранът на управителя“", async ({ page }) => {
  await page.goto("/admin/vhod/");
  await formIn(page, "owner");
  await expect(page.locator("#ch-h")).toBeFocused();
  await expect(page.locator(".ch-card").nth(0)).toContainText("Собственик"); await expect(page.locator(".ch-card").nth(0)).toContainText("Оборот и решения");
  await expect(page.locator(".ch-card").nth(0)).toHaveAttribute("href", "/sobstvenik/");
  const also = page.locator(".ch-also");
  await expect(also).toHaveText("Смяната сега: екранът на управителя");
  expect((await also.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await also.click();
  await ready(page, "Сега");
  /* the owner is a guest in the manager's module: "Към Собственик", and no key "Звук" */
  await expect(page.locator('[data-bs="sound"]')).toHaveCount(0);
  if (!isPhone(page)) await expect(page.locator(".bs-top a.bs-toadmin")).toHaveText(["Към Собственик", "Към админа"]);
  await page.locator('[data-bs="profile"]').click();
  await expect(page.locator(".bs-sheet .mg-setrow b")).toHaveText(["Към Собственик", "Към админа", "Моите препоръки"]);
  await page.locator(".bs-sheet .mg-setrow").first().click();
  await ready(page, "Днес");
});

test("#next= to an address the role may not open is ignored (then the choice, or the own module)", async ({ page }) => {
  /* the manager: the owner's module, a section he does not see, another site */
  for (const next of ["/sobstvenik/", "/admin/roles/", "https://example.com/upravitel/", "//example.com/"]) {
    await page.context().clearCookies();
    await page.goto("about:blank");
    await page.goto("/admin/vhod/#next=" + encodeURIComponent(next));
    await formIn(page, "manager");
    await expect(page.locator("#ch-h"), next).toHaveText("Къде продължаваш?");
    await expect(page).toHaveURL(/\/admin\/vhod\/#st=choose$/);
  }
  /* a section he sees: #next= wins over the choice */
  await page.context().clearCookies();
  await page.goto("about:blank");
  await page.goto("/admin/vhod/#next=" + encodeURIComponent("/admin/orders/"));
  await formIn(page, "manager");
  await expect(page).toHaveURL(/\/admin\/orders\/$/);
  /* the waiter: always the own module */
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/admin/vhod/#next=" + encodeURIComponent("/upravitel/"));
  await formIn(page, "waiter");
  await expect(page).toHaveURL(/\/servitor\/$/);
  /* marketing: no module, the dashboard (first leave the waiter's app: it may still move on to its shift screen) */
  await page.goto("about:blank");
  await page.context().clearCookies();
  await page.goto("/admin/vhod/#next=" + encodeURIComponent("/sobstvenik/finansi/"));
  await formIn(page, "marketing");
  await expect(page).toHaveURL(/\/admin\/$/);
});

test("every tab of both modules: the frame, the right tab, the skeleton in the mount point", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  for (const [mod, sub, tabs] of [["upravitel", "Управител · Siracusa", UP], ["sobstvenik", "Собственик · Siracusa", SO]] as [string, string, [string, string, string][]][]) {
    for (const [path, title, id] of tabs) {
      await page.goto(path);
      await ready(page, title);
      await expect(page).toHaveTitle(title + " | Siracusa · " + sub.split(" ")[0]);
      await expect(page.locator(".bs-tt span")).toHaveText(sub);
      await expect(page.locator(".bs-app")).toHaveAttribute("data-mod", mod);
      await expect(page.locator(".bs-app")).toHaveAttribute("data-tab", id);
      const bar = page.locator(isPhone(page) ? ".bs-nav" : ".bs-rail");
      await expect(bar).toBeVisible();
      await expect(page.locator(isPhone(page) ? ".bs-rail" : ".bs-nav")).toBeHidden();
      await expect(bar.locator("a[aria-current=page] > span").first()).toHaveText(tabs.find((t) => t[2] === id)![1].split(" ")[0]);
      await expect(bar.locator((isPhone(page) ? "a" : "a.it") + " > span:first-of-type")).toHaveText(tabs.map((t) => t[1].split(" ")[0]));
      await expect(bar.locator(isPhone(page) ? "a" : "a.it").nth(1)).toHaveAttribute("href", tabs[1][0]);
      /* the mount point of the screen: the skeleton (hidden from the reader) with a hidden status, or the screen once its
         author has filled it ("Управител": src/modules/upravitel, [data-upscr]; "Собственик": src/modules/sobstvenik, [data-owscr]) */
      const body = page.locator("#main [data-body]");
      await expect(body.locator('[aria-hidden="true"] .skel, [data-upscr], [data-owscr]').first()).toBeVisible();
      /* the top bar: "Търси" (56 x 56 on the phone), the profile (48 x 48), no sound for the owner */
      if (isPhone(page)) { const b = (await page.locator('[data-bs="find"]').boundingBox())!; expect(b.width).toBeGreaterThanOrEqual(56); expect(b.height).toBe(56); }
      else { await expect(page.locator("#bs-q")).toBeVisible(); await expect(page.locator(".bs-top a.bs-toadmin").last()).toHaveText("Към админа"); }
      const av = (await page.locator(".bs-me .bs-av").boundingBox())!; expect([av.width, av.height]).toEqual([48, 48]);
      await expect(page.locator('[data-bs="sound"]')).toHaveCount(0);
      expect(await noSideScroll(page)).toBe(true);
      expect(await smallTargets(page), path).toEqual([]);
    }
  }
  expect(errs).toEqual([]);
});

test("the real rights: „Нямаш права за този екран.“ when the role lacks the section of the tab", async ({ page, context }) => {
  await signIn(context, "manager");
  const without = async (gone: string[]) => {
    await page.unroute("**/api/auth/me");
    await page.route("**/api/auth/me", async (r) => { const res = await r.fetch(); const me = await res.json() as { sections: string[] }; me.sections = me.sections.filter((s) => !gone.includes(s)); await r.fulfill({ response: res, json: me }); });
  };
  await without(["staff"]);
  await page.goto("/upravitel/ekipat/");
  await expect(page.locator("#main h2")).toHaveText("Нямаш права за този екран.");
  await expect(page.locator("#main")).toContainText("Ролята „Управител“ не вижда „Персонал“. Ако ти трябва, помоли главния админ.");
  await expect(page.locator("#main a.pill")).toHaveText("Към „Сега“");
  /* the frame is whole: the tabs, the profile, the pencil */
  await expect(page.locator(isPhone(page) ? ".bs-nav a" : ".bs-rail a.it")).toHaveCount(4);
  await expect(page.locator(".bs-penslot .sa-pen-btn")).toBeVisible();
  expect(await axe(page)).toEqual([]);
  /* "Залата": one of the two sections is enough (the skeleton, or the screen once it is filled) */
  const drawn = page.locator('#main [data-body] [aria-hidden="true"] .skel, #main [data-upscr]').first();
  await page.goto("/upravitel/zalata/");
  await expect(drawn).toBeVisible();
  await without(["hall"]);
  await page.goto("/upravitel/zalata/");
  await expect(drawn).toBeVisible();
  await without(["hall", "reservations"]);
  await page.goto("/upravitel/zalata/");
  await expect(page.locator("#main h2")).toHaveText("Нямаш права за този екран.");
  await expect(page.locator("#main")).toContainText("не вижда „Залата и масите“");
  await page.locator("#main a.pill").click();
  await ready(page, "Сега");
});

for (const [mod, role, path, coreMod] of [["upravitel", "manager", "/upravitel/", "manager"], ["sobstvenik", "owner", "/sobstvenik/", "owner"]] as [string, Role, string, string][]) {
  test("the pencil in „" + mod + "“: on the row of the bottom nav / at the bottom of the rail on every scroll step; a recommendation with the right module", async ({ page, context }) => {
    const errs = errors(page);
    await signIn(context, role);
    const sizes = isPhone(page) ? [[390, 844], [360, 740]] : [[1440, 900], [1024, 768]];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto(path);
      await ready(page, mod === "upravitel" ? "Сега" : "Днес");
      /* a long screen with things to press all the way down */
      /* (after the mount point, once a filled screen is drawn: it draws its own content again on every refresh) */
      if (mod === "upravitel") await expect(page.locator("[data-upscr]")).toBeVisible();
      await page.evaluate(() => { const d = document.createElement("div"); d.dataset.long = ""; d.innerHTML = Array.from({ length: 30 }, (_, i) => '<p style="margin:0 0 12px"><button class="pill pill-ink" type="button" style="width:100%">Действие ' + (i + 1) + "</button></p>").join(""); document.querySelector("#main")!.appendChild(d); });
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      expect(max).toBeGreaterThan(600);
      for (let y = 0; ; y += 80) {
        const top = Math.min(y, max);
        await page.evaluate((t) => window.scrollTo(0, t), top);
        const g = await page.evaluate(() => {
          const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
          const pen = r(".bs-penslot .sa-pen-btn"), at = document.elementFromPoint((pen.l + pen.r) / 2, (pen.t + pen.b) / 2);
          return { pen, nav: r(".bs-nav"), rail: r(".bs-rail"), col: r(".bs-col"), hit: !!at && !!at.closest(".sa-pen-btn"), vw: innerWidth, vh: innerHeight };
        });
        expect([Math.round(g.pen.w), Math.round(g.pen.h)]).toEqual([56, 56]);
        expect(g.hit, "the pencil is on top at " + top).toBe(true);
        if (w < 900) {
          /* on the row of the bottom nav, to its right: the nav is shorter by 56 + 8 px, the centres are on one line */
          expect(Math.abs((g.pen.t + g.pen.b) / 2 - (g.nav.t + g.nav.b) / 2)).toBeLessThan(0.6);
          expect(g.pen.l - g.nav.r).toBeGreaterThanOrEqual(7.5);
          expect(Math.round(g.vw - g.pen.r)).toBe(8);
          expect(Math.round(g.nav.l)).toBe(8);
          expect(Math.round(g.vh - g.nav.b)).toBe(10);
          expect(Math.round(g.nav.h)).toBe(72);
        } else {
          /* at the bottom of the rail, in its middle; never over the column with the content */
          expect(g.pen.l).toBeGreaterThanOrEqual(g.rail.l); expect(g.pen.r).toBeLessThanOrEqual(g.rail.r); expect(g.pen.b).toBeLessThanOrEqual(g.rail.b);
          expect(g.pen.r).toBeLessThanOrEqual(g.col.l);
          expect(Math.abs((g.pen.l + g.pen.r) / 2 - (g.rail.l + g.rail.r) / 2)).toBeLessThan(0.6);
          expect(Math.round(g.rail.w)).toBe(104);
        }
        if (top >= max) break;
      }
      /* the last thing to press scrolls clear of the bottom nav (the empty space under the content) */
      const lastOk = await page.evaluate(() => { const b = Array.from(document.querySelectorAll("[data-long] button")).pop()!.getBoundingClientRect(), n = document.querySelector(".bs-nav")!.getBoundingClientRect(); return n.height === 0 || b.bottom <= n.top; });
      expect(lastOk).toBe(true);
      expect(await noSideScroll(page)).toBe(true);
    }
    /* a recommendation: the pencil only recommends here (whatever the role), and the note carries the module */
    await page.evaluate(() => window.scrollTo(0, 0));
    const pen = page.locator(".bs-penslot .sa-pen-btn");
    await expect(pen).toHaveAttribute("aria-label", /^Молив/);
    await pen.click();
    await expect(pen).toHaveAttribute("aria-pressed", "true");
    /* a thing in the middle of the screen (the ember bar of the pencil is over the top of the page) */
    await page.locator("[data-long] button").nth(4).click();
    const ui = page.locator("sa-pen-ui");
    if (await ui.locator("[data-pick]").isVisible()) await ui.locator("[data-pick]").click();
    await expect(ui.locator(".sheet h2")).toHaveText("Какво да подобрим?");
    await expect(ui.locator(".sheet .meta")).toContainText(mod === "upravitel" ? "Управител" : "Собственик");
    const text = "Бутонът да е по-голям, " + mod + " " + Math.random().toString(36).replace(/[^a-z]/g, "");
    await ui.locator("textarea").fill(text);
    await ui.locator("[data-save]").click();
    await expect(ui.locator(".toast")).toContainText("Препоръката е изпратена");
    const mine = await (await context.request.get("/api/admin/notes/mine")).json() as { text: string; module: string; url: string; source: { role: string } }[];
    const note = mine.find((n) => n.text === text)!;
    expect(note).toMatchObject({ module: coreMod, url: path, source: { role } });
    expect(errs).toEqual([]);
  });
}

test("the profile: a sheet with the focus inside, the links, the theme shared with the admin, „Изход“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  await page.goto("/sobstvenik/");
  await ready(page, "Днес");
  const me = page.locator('[data-bs="profile"]');
  await me.click();
  const sh = page.locator(".bs-sheetwrap.on .bs-sheet");
  await expect(sh.locator(".sh h2")).toHaveText("Профил");
  await expect(sh.locator(".sh h2")).toBeFocused();
  await expect(sh).toHaveAttribute("role", "dialog");
  await expect(sh.locator(".mg-setrow b")).toHaveText(["Смяната сега", "Към админа", "Моите препоръки"]);
  await expect(sh.locator(".mg-setrow").nth(0)).toHaveAttribute("href", "/upravitel/");
  await expect(sh.locator(".mg-setrow").nth(1)).toHaveAttribute("href", "/admin/");
  await expect(sh.locator(".mg-setrow").nth(2)).toHaveAttribute("href", "/admin/notes/#src=owner");
  await expect(sh.locator(".mg-themes button")).toHaveText(["Авто", "Светла", "Тъмна"]);
  await expect(sh.locator('.mg-themes button[aria-pressed="true"]')).toHaveText("Авто");
  /* the page behind is inert, the pencil is hidden, the focus stays inside */
  expect(await page.evaluate(() => [".bs-app", ".bs-nav", ".bs-rail", ".bs-penslot"].every((s) => (document.querySelector(s) as HTMLElement).inert))).toBe(true);
  await expect(page.locator(".bs-penslot")).toBeHidden();
  for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest(".bs-sheet"))).toBe(true); }
  await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement!.closest(".bs-sheet"))).toBe(true);
  expect(await smallTargets(page)).toEqual([]);
  expect(await axe(page)).toEqual([]);
  /* the theme: the key of the admin (sa-prefs), at once */
  await sh.locator('.mg-themes button[data-v="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(sh.locator('.mg-themes button[aria-pressed="true"]')).toHaveText("Тъмна");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sa-prefs")!).theme)).toBe("dark");
  expect(await axe(page)).toEqual([]);
  /* Esc closes, the focus returns, the page is alive again */
  await page.keyboard.press("Escape");
  await expect(page.locator(".bs-sheetwrap.on")).toHaveCount(0);
  await expect(me).toBeFocused();
  expect(await page.evaluate(() => (document.querySelector(".bs-app") as HTMLElement).inert)).toBe(false);
  await expect(page.locator(".bs-penslot .sa-pen-btn")).toBeVisible();
  /* the admin shows the same theme; back to "Авто" from the module */
  await page.goto("/admin/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/sobstvenik/");
  await me.click();
  await expect(sh.locator('.mg-themes button[aria-pressed="true"]')).toHaveText("Тъмна");
  await sh.locator('.mg-themes button[data-v="system"]').click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBeUndefined();
  /* the scrim closes; "Изход" leads to the sign-in */
  await page.locator(".bs-sheetwrap.on .scrim").click({ position: { x: 5, y: 5 }, force: true });
  await expect(page.locator(".bs-sheetwrap.on")).toHaveCount(0);
  await me.click();
  await sh.locator('[data-bs="logout"]').click();
  await expect(page).toHaveURL(/\/admin\/vhod\/$/);
  await page.goto("/sobstvenik/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fsobstvenik%2F$/);
  expect(errs).toEqual([]);
});

test("@desktop the search on the computer: „/“ focuses, the panel under the field, the arrows, Esc clears first, Enter opens", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "manager");
  for (const w of [1440, 1024]) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 768 });
    await page.goto("/upravitel/");
    await ready(page, "Сега");
    const q = page.locator("#bs-q"), panel = page.locator("#bs-dres");
    await expect(q).toHaveAttribute("type", "search");
    await expect(q).toHaveAttribute("placeholder", "Търси: маса, №, ястие");
    await expect(panel).toBeHidden();
    await page.keyboard.press("/");
    await expect(q).toBeFocused();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("role", "region");
    await expect(panel.locator(".mg-fscope")).toBeVisible();
    /* the panel stays inside the column (never under the rail), under the field */
    const g = await page.evaluate(() => { const b = (s: string) => document.querySelector(s)!.getBoundingClientRect(); const p = b("#bs-dres"), c = b(".bs-col"), f = b("#bs-q"); return { pl: p.left, pr: p.right, pt: p.top, cl: c.left, cr: c.right, fb: f.bottom }; });
    expect(g.pl).toBeGreaterThanOrEqual(g.cl + 23.5); expect(g.pr).toBeLessThanOrEqual(g.cr - 23.5); expect(Math.round(g.pt - g.fb)).toBe(8);
    await q.fill("зал");
    const links = panel.locator("a[href]");
    await expect(links.first()).toContainText("Залата");
    await expect(panel.locator("section[aria-label] > h2").first()).toBeVisible();
    await expect(page.locator(".bs-dsearch [aria-live]")).toHaveText(/^\d+ резултата? за „зал“$/);
    expect(await axe(page)).toEqual([]);
    /* down from the field: the first result; the arrows move; up from the first and Esc: back to the field */
    await page.keyboard.press("ArrowDown");
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(links.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(q).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(q).toBeFocused();
    await expect(panel).toBeVisible();
    /* Esc in the field: first it clears, then the panel hides and the focus stays */
    await page.keyboard.press("Escape");
    await expect(q).toHaveValue("");
    await expect(panel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(q).toBeFocused();
    /* nothing found; one clear button; the module never offers "оборот" */
    await q.fill("оборот");
    await expect(panel.locator(".mg-fempty h2")).toHaveText("Нищо за „оборот“");
    await expect(page.locator(".bs-dsearch [aria-live]")).toHaveText("Нищо за „оборот“");
    await expect(page.locator(".bs-dsearch .clr")).toBeVisible();
    await page.locator(".bs-dsearch .clr").click();
    await expect(q).toHaveValue(""); await expect(q).toBeFocused();
    /* a click outside hides; Enter opens the first result */
    await page.locator(".bs-top h1").click();
    await expect(panel).toBeHidden();
    await q.fill("екип");
    await expect(links.first()).toContainText("Екипът");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/upravitel\/ekipat\/$/);
  }
  expect(errs).toEqual([]);
});

test("@phone the search on the phone: the whole screen, the arrows, Esc from the results to the field, Esc from the field closes", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  for (const w of [390, 360]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 740 });
    await page.goto("/sobstvenik/");
    await ready(page, "Днес");
    const open = page.locator('[data-bs="find"]');
    await open.click();
    const dlg = page.locator(".bs-find.on");
    await expect(dlg).toHaveAttribute("role", "dialog");
    const q = dlg.locator("#bs-fq");
    await expect(q).toBeFocused();
    await expect(q).toHaveAttribute("placeholder", "Ястие или показател");
    const box = (await dlg.boundingBox())!; expect([box.x, box.y, box.width]).toEqual([0, 0, w]);
    await expect(page.locator(".bs-penslot")).toBeHidden();
    expect(await page.evaluate(() => (document.querySelector(".bs-app") as HTMLElement).inert)).toBe(true);
    await q.fill("реш");
    const links = dlg.locator("#bs-fr a[href]");
    await expect(links.first()).toContainText("Решения");
    await expect(dlg.locator("[data-flive]")).toHaveText(/^\d+ резултата? за „реш“$/);
    expect(await smallTargets(page)).toEqual([]);
    expect(await noSideScroll(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press("ArrowDown");
    await expect(links.nth(0)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(q).toBeFocused();
    await expect(dlg).toBeVisible();
    /* the focus stays inside */
    for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement!.closest(".bs-find"))).toBe(true); }
    await q.focus();
    await page.keyboard.press("Escape");
    await expect(page.locator(".bs-find")).toHaveCount(0);
    await expect(open).toBeFocused();
    await expect(page.locator(".bs-penslot .sa-pen-btn")).toBeVisible();
    /* "Затвори"; Enter opens the first result */
    await open.click();
    await page.locator(".bs-find [data-fclose]").click();
    await expect(page.locator(".bs-find")).toHaveCount(0);
    await open.click();
    await page.locator("#bs-fq").fill("финан");
    await expect(page.locator("#bs-fr a[href]").first()).toContainText("Финанси");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sobstvenik\/finansi\/$/);
  }
  expect(errs).toEqual([]);
});

test("no connection: the bar „Няма връзка · Показваме данните от HH:MM“ with „Опитай пак“; back by itself", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "manager");
  await page.goto("/upravitel/");
  await ready(page, "Сега");
  const bar = page.locator(".bs-net");
  await expect(bar).toBeHidden();
  const before = await page.evaluate(() => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()));
  await context.setOffline(true);
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute("role", "status");
  const text = (await bar.locator("[data-net]").textContent())!;
  expect(text).toMatch(/^Няма връзка · Показваме данните от \d\d:\d\d$/);
  /* the time of the last successful load: this minute or the one before */
  const mins = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5), d = (mins(before) - mins(text.slice(-5)) + 1440) % 1440;
  expect(d).toBeLessThanOrEqual(1);
  await expect(page.locator(".bs-ov")).toHaveClass(/stale/);
  /* under the top bar, over the whole column; the button is a full target */
  const g = await page.evaluate(() => { const b = (s: string) => document.querySelector(s)!.getBoundingClientRect(); return { top: b(".bs-top").bottom, net: b(".bs-net").top, btn: b(".bs-net button").height }; });
  expect(Math.round(g.net - g.top)).toBe(0); expect(g.btn).toBeGreaterThanOrEqual(48);
  expect(await noSideScroll(page)).toBe(true);
  expect(await axe(page)).toEqual([]);
  await bar.locator("button").click();
  await expect(page.locator(".bs-toast.on")).toHaveText("Още няма връзка. Опитваме сами на всеки 10 сек.");
  await expect(bar).toBeVisible();
  /* the connection is back: the bar goes, the badges are alive */
  await context.setOffline(false);
  await expect(bar).toBeHidden({ timeout: 15_000 });
  await expect(page.locator(".bs-ov")).not.toHaveClass(/stale/);
  expect(errs).toEqual([]);
});

test("„Звук“ in the manager's module: „докосни“ until the first touch, remembered on the device; a new online order: the toast and the blinking badge", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "manager");
  await page.goto("/upravitel/zalata/");
  await ready(page, "Залата");
  const snd = page.locator('[data-bs="sound"]');
  /* before the first touch: the browser plays no sound yet */
  await expect(snd).toHaveAttribute("aria-label", "Звук: докосни, нови онлайн поръчки");
  await expect(snd).toHaveAttribute("aria-pressed", "true");
  await expect(snd).toHaveClass(/wait/);
  await expect(snd.locator(isPhone(page) ? ".sm" : ".lg")).toHaveText(isPhone(page) ? "Звук" : "Звук: докосни");
  /* the first touch anywhere unlocks it */
  await page.locator(".bs-top h1").click();
  await expect(snd).toHaveAttribute("aria-label", "Звук вкл., нови онлайн поръчки");
  await expect(snd).not.toHaveClass(/wait/);
  /* off: said, remembered on this device with the key of the admin */
  await snd.click();
  await expect(snd).toHaveAttribute("aria-pressed", "false");
  await expect(snd).toHaveAttribute("aria-label", "Звук изкл., нови онлайн поръчки");
  await expect(page.locator(".bs-toast.on")).toHaveText("Звукът за нови онлайн поръчки е изключен");
  expect(await page.evaluate(() => localStorage.getItem("sa-sound"))).toBe("off");
  await page.reload();
  await ready(page, "Залата");
  await expect(snd).toHaveAttribute("aria-pressed", "false");
  await snd.click();
  await expect(snd).toHaveAttribute("aria-label", "Звук вкл., нови онлайн поръчки");
  await expect(page.locator(".bs-toast.on")).toHaveText("Звукът за нови онлайн поръчки е включен");
  expect(await page.evaluate(() => localStorage.getItem("sa-sound"))).toBe("on");
  /* a new online order through the API: the toast with "Виж", the badge on "Сега" blinks and counts */
  /* (another test may make an order at the same moment: the toast then shows the newest number) */
  const r = await order(context); expect(r.status()).toBe(201); const mine = +(await r.json()).no;
  const toast = page.locator(".bs-toast.on");
  await expect(toast).toContainText(/Нова онлайн поръчка №\u00a0\d+/);
  await expect(toast.locator("a")).toHaveText("Виж");
  await expect(toast.locator("a")).toHaveAttribute("href", /^\/upravitel\/#n=\d+$/);
  expect(+(await toast.locator("a").getAttribute("href"))!.split("=")[1]).toBeGreaterThanOrEqual(mine);
  /* the toast is at the top, under the top bar (never under the finger at the bottom) */
  const place = () => page.evaluate(() => { const b = (s: string) => document.querySelector(s)!.getBoundingClientRect(); return Math.round(b(".bs-toast").top - b(".bs-top").bottom); });
  await expect.poll(place).toBeGreaterThanOrEqual(8);
  expect(await place()).toBeLessThanOrEqual(12);
  const tab = page.locator(isPhone(page) ? ".bs-nav a" : ".bs-rail a.it").first();
  const badge = tab.locator(".bs-n");
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/fresh/);
  await expect.poll(async () => +(await badge.textContent() || 0)).toBeGreaterThanOrEqual(1);
  await expect(tab.locator("[data-nbv]")).toContainText("нова онлайн поръчка");
  /* the top of the toast is under the top bar (never under the finger at the bottom) */
  /* with reduced motion: no blinking, the word "Нова" */
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await badge.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el, "::after").content])).toEqual(["none", '" Нова"']);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  /* "Виж": to "Сега" with the number, the order is seen */
  await toast.locator("a").click();
  await expect(page).toHaveURL(/\/upravitel\/#n=\d+$/);
  await ready(page, "Сега");
  await expect(page.locator(".bs-n.fresh")).toHaveCount(0);
  await expect(page.locator(isPhone(page) ? ".bs-nav a" : ".bs-rail a.it").first().locator(".bs-n")).toBeVisible();
  /* the toast and the blinking badge are clean for axe too */
  expect((await order(context)).status()).toBe(201);
  await expect(page.locator(".bs-toast.on")).toContainText("Нова онлайн поръчка");
  await expect(page.locator(".bs-n.fresh").first()).toBeAttached();
  expect(await axe(page)).toEqual([]);
  expect(errs).toEqual([]);
});

test("the owner's module has no sound and no notice about new orders; the badge „Решения“ is hidden without no-shows", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto("/sobstvenik/");
  await ready(page, "Днес");
  await expect(page.locator('[data-bs="sound"]')).toHaveCount(0);
  const r = await order(context); expect(r.status()).toBe(201);
  await page.waitForTimeout(1200);
  await expect(page.locator(".bs-toast.on")).toHaveCount(0);
  await expect(page.locator(".bs-n.fresh")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) {
  test("axe without violations, 48 px targets and no horizontal scroll: both modules, " + theme, async ({ page, context }) => {
    const errs = errors(page);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(context, "admin");
    const sizes = isPhone(page) ? [[390, 844], [360, 740]] : [[1440, 900], [1024, 768]];
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      for (const [path, title] of [[UP[0][0], UP[0][1]], [UP[3][0], UP[3][1]], [SO[0][0], SO[0][1]], [SO[2][0], SO[2][1]]]) {
        await page.goto(path);
        await ready(page, title);
        expect(await axe(page), path + " " + w + " " + theme).toEqual([]);
        expect(await smallTargets(page), path + " " + w).toEqual([]);
        expect(await noSideScroll(page), path + " " + w).toBe(true);
        /* nothing under 14 px */
        const tiny = await page.evaluate(() => { const out: string[] = []; document.querySelectorAll<HTMLElement>(".bs-app *, .bs-ov *").forEach((el) => { if (el.children.length || !el.textContent!.trim() || el.closest(".vh") || !el.getClientRects().length) return; const f = parseFloat(getComputedStyle(el).fontSize); if (f < 14) out.push(f + " " + el.textContent); }); return out; });
        expect(tiny, path + " " + w).toEqual([]);
      }
      /* the long title of the owner's screen is whole at 360 (two lines at most), the tabs keep their words */
      if (w === 360) {
        await page.goto(SO[2][0]); await ready(page, "Финанси и гориво");
        expect(await page.locator(".bs-top h1").evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        const gaps = await page.evaluate(() => { const a = Array.from(document.querySelectorAll(".bs-nav a > span:first-of-type")).map((el) => el.getBoundingClientRect()); return a.slice(1).map((r, i) => Math.round(r.left - a[i].right)); });
        for (const g of gaps) expect(g).toBeGreaterThanOrEqual(8);
      }
    }
    expect(errs).toEqual([]);
  });
}
