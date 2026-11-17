import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* The shared phone frame of the staff apps "Сервитьор" (/servitor/) and "Шофьор" (/shofyor/): src/modules/staff/frame.ts.
   Checks: the guard (no session, another role, the roles that may look), the top buttons Търси · Молив · Смяна (48 px,
   nothing overlaps, 360 and 390, light and dark), the tabs and the badges, the sheet (focus stays inside, Esc), the toast
   with "Отмени", no connection (the strip, the whole screen, "Виж последните данни": timers frozen, badges grey, actions
   say why), "Свързваме се отново …", the theme, the timers, the pencil (a recommendation with the module of the app), the
   search shell, no horizontal scroll at 360, no console errors, axe without serious, and on a computer: a centred phone
   column. The frame handle is window.SCStaff (the screens get it from mountStaff). Accounts from .env. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = {
  admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], waiter: ["waiter", E.WAITER_PASSWORD],
  driver: ["driver", E.DRIVER_PASSWORD], kitchen: ["kitchen", E.KITCHEN_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD],
};
async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]|net::ERR_/.test(m.text())) list.push(m.text()); });
  return list;
}
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const APPS = [{ role: "waiter", path: "/servitor/", title: "Залата", tabs: ["Маси", "Повиквания", "Готови", "Поръчка"], note: "waiter" },
  { role: "driver", path: "/shofyor/", title: "Моите доставки", tabs: ["Доставки", "Маршрут", "Гориво", "Смяна"], note: "driver" }] as const;
/** the frame is drawn (the waiting skeleton of the page is gone) */
async function open(page: Page, path: string, theme?: string) {
  if (theme) await page.addInitScript((t) => { try { localStorage.setItem("st-prefs", JSON.stringify({ theme: t })); } catch { /* ignore */ } }, theme);
  await page.goto(path);
  await expect(page.locator(".st-app:not([data-boot]) .st-me")).toBeVisible();
}
/* what "Търси" searches in during the tests (the real providers come with the screens) */
const provider = `({ label: "Търси маса, поръчка, резервация или ястие", placeholder: "Маса, №, резервация, ястие…",
  start: () => '<p class="fscope">Търсиш само в своето.</p><div class="fchips"><button class="chip" type="button" data-ex="12">Маса 12</button></div>',
  results: (q) => q === "няма" ? '<div class="fempty"><h3>Няма „няма“</h3></div>' : '<section class="fgrp"><h3>Маси<span class="muted">2</span></h3><a class="frow" href="#m' + q + '"><span class="fi">' + q + '</span><span><b>Маса ' + q + '</b><small>Моя маса</small></span><span class="fr"></span></a><a class="frow" href="#second"><span class="fi">7</span><span><b>Маса 7</b></span><span class="fr"></span></a></section>' })`;
const st = "(window.SCStaff)";

test("no session: the module leads to the sign-in with #next=, and back after it", async ({ page }) => {
  await page.goto("/servitor/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fservitor%2F$/);
  await page.goto("/shofyor/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fshofyor%2F$/);
  await page.fill("#u", USER.driver[0]); await page.fill("#p", USER.driver[1]); await page.click("[data-go]");
  await expect(page).toHaveURL(/\/shofyor\/$/);
  await expect(page.locator(".st-top h1")).toHaveText("Моите доставки");
  /* no chrome of the site and of the admin, no cart, footer, assistant or cookie banner */
  await expect(page.locator(".sa-side, .sa-bnav, .sa-top, footer, .foot, .aifab, .cookie, [data-cart], .sm-app")).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page).toHaveTitle("Моите доставки | Siracusa · Шофьор");
});

test("another role goes to its own home; the owner and the main admin may look and get „Към таблото“", async ({ browser }) => {
  const go = async (role: keyof typeof USER, path: string) => { const c = await browser.newContext(); await signIn(c, role); const p = await c.newPage(); await p.goto(path); return { c, p }; };
  let x = await go("driver", "/servitor/"); await expect(x.p).toHaveURL(/\/shofyor\/$/); await x.c.close();
  x = await go("waiter", "/shofyor/"); await expect(x.p).toHaveURL(/\/servitor\/$/); await x.c.close();
  x = await go("kitchen", "/servitor/"); await expect(x.p).toHaveURL(/\/kuhnya\/$/); await x.c.close();
  x = await go("marketing", "/shofyor/"); await expect(x.p).toHaveURL(/\/admin\/$/); await x.c.close();
  for (const role of ["owner", "admin"] as const) {
    x = await go(role, "/servitor/");
    await expect(x.p.locator(".st-top h1")).toHaveText("Залата");
    await x.p.locator('[data-act="menu"]').click();
    const sh = x.p.locator(".st-sheetwrap.on .st-sheet");
    await expect(sh.locator("h2")).toHaveText("Смяна");
    await expect(sh.locator(".sfoot a")).toHaveText("Към таблото");
    await expect(sh.locator(".sfoot a")).toHaveAttribute("href", "/admin/");
    await expect(sh.locator('[data-act="logout"]')).toHaveText("Изход");
    await x.c.close();
  }
});

for (const app of APPS) {
  test(`@phone ${app.role}: the top buttons and the tabs at 390 and 360, light and dark: 48 px, nothing overlaps, no horizontal scroll`, async ({ page, context }) => {
    const errs = errors(page);
    await signIn(context, app.role);
    for (const [w, h, theme] of [[390, 844, "light"], [390, 844, "dark"], [360, 740, "light"], [360, 740, "dark"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await open(page, app.path, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator(".st-top h1")).toHaveText(app.title);
      /* the pencil arrives after the first paint, in the place kept for it */
      await expect(page.locator(".st-top .sa-pen-btn")).toHaveText("Молив");
      await page.evaluate(`${st}.setSearch(${provider}); ${st}.setTop({ find: true }); ${st}.setBadge("${app.role === "waiter" ? "calls" : "list"}", 4)`);
      const g = await page.evaluate(() => {
        const r = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
        const hit = (el: Element) => { const b = el.getBoundingClientRect(), t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (t === el || el.contains(t)); };
        const tools = [...document.querySelectorAll(".st-tools > button, .st-tools .sa-pen-btn")].filter((b) => !(b as HTMLElement).hidden);
        const tabs = [...document.querySelectorAll(".st-nav a")];
        const small: string[] = [];
        document.querySelectorAll(".st-app *, .st-ov *").forEach((el) => { if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) return; const b = el.getBoundingClientRect(); if (!b.width) return; const f = parseFloat(getComputedStyle(el).fontSize); if (f < 14) small.push(el.className + " " + f); });
        return {
          words: tools.map((b) => b.textContent!.trim()), tools: tools.map(r), toolsHit: tools.map(hit), tabs: tabs.map(r), tabsHit: tabs.map(hit),
          title: r(document.querySelector(".st-top .tt")!), h1: r(document.querySelector(".st-top h1")!), top: r(document.querySelector(".st-top")!), nav: r(document.querySelector(".st-nav")!),
          over: document.documentElement.scrollWidth - innerWidth, vw: innerWidth, vh: innerHeight, small,
          cnt: r(document.querySelector(".st-nav .cnt:not([hidden])")!),
        };
      });
      const at = `${app.role} ${w} ${theme}`;
      expect(g.words, at).toEqual(["Търси", "Молив", "Смяна"]);
      for (const [i, b] of g.tools.entries()) {
        expect(b.w, at + " width " + g.words[i]).toBeGreaterThanOrEqual(w <= 370 ? 52 : 56);
        expect(b.h, at + " height " + g.words[i]).toBeGreaterThanOrEqual(48);
        expect(b.r, at).toBeLessThanOrEqual(g.vw);
        expect(g.toolsHit[i], at + " nothing over " + g.words[i]).toBe(true);
        if (i) expect(b.x, at + " after the previous").toBeGreaterThanOrEqual(g.tools[i - 1].r);
      }
      /* the title keeps its place beside the buttons and is not squeezed away */
      expect(g.title.r, at).toBeLessThanOrEqual(g.tools[0].x);
      expect(g.h1.w, at).toBeGreaterThan(60);
      expect(g.top.h, at).toBe(72); /* 56 px buttons + 8 px above and below, as in the prototype */
      /* the bottom nav: 72 px, four tabs of at least 48 px, on the screen, the badge inside it */
      expect(g.nav.h, at).toBe(72);
      expect(g.nav.b, at).toBeLessThanOrEqual(g.vh - 10);
      expect(g.tabs.length, at).toBe(4);
      for (const [i, b] of g.tabs.entries()) { expect(b.h, at).toBeGreaterThanOrEqual(48); expect(b.w, at).toBeGreaterThanOrEqual(48); expect(g.tabsHit[i], at + " tab " + i).toBe(true); }
      expect(g.cnt.y, at).toBeGreaterThanOrEqual(g.nav.y); expect(g.cnt.h, at).toBe(24);
      expect(g.over, at + " horizontal scroll").toBeLessThanOrEqual(0);
      expect(g.small, at + " text under 14 px").toEqual([]);
      expect(await serious(page), at).toEqual([]);
    }
    expect(errs).toEqual([]);
  });

  test(`${app.role}: the tabs lead to the screens of the app; the badges count, hide at 0 and can be grey`, async ({ page, context }) => {
    await signIn(context, app.role);
    await open(page, app.path);
    const nav = page.locator(".st-nav");
    await expect(nav).toHaveAttribute("aria-label", app.role === "waiter" ? "Приложение на сервитьора" : "Приложение на шофьора");
    await expect(nav.locator("a .lb")).toHaveText([...app.tabs]);
    await expect(nav.locator('a[aria-current="page"] .lb')).toHaveText(app.tabs[0]);
    const hrefs = await nav.locator("a").evaluateAll((l) => l.map((a) => a.getAttribute("href")));
    expect(hrefs).toEqual(app.role === "waiter" ? ["/servitor/", "/servitor/povikvania/", "/servitor/gotovi/", "/servitor/porachka/"] : ["/shofyor/", "/shofyor/marshrut/", "/shofyor/gorivo/", "/shofyor/smyana/"]);
    await expect(nav.locator(".cnt:not([hidden])")).toHaveCount(0);
    if (app.role === "waiter") {
      await expect(nav.locator("a").nth(3)).toHaveAccessibleName("Нова поръчка");
      await page.evaluate(`${st}.setBadge("calls", 4); ${st}.setBadge("ready", 2, true)`);
      await expect(nav.locator('[data-cnt="calls"] [data-n]')).toHaveText("4");
      await expect(nav.locator("a").nth(1)).toHaveAccessibleName(/^Повиквания ?, 4$/);
      await expect(nav.locator('[data-cnt="ready"]')).toHaveClass(/ember/);
      await expect(nav.locator('[data-cnt="ready"]')).toHaveClass(/grey/);
      await page.evaluate(`${st}.setBadge("calls", 0)`);
      await expect(nav.locator('[data-cnt="calls"]')).toBeHidden();
      await expect(nav.locator("a").nth(1)).toHaveAccessibleName("Повиквания");
    } else {
      await page.evaluate(`${st}.setBadge("list", 3)`);
      await expect(nav.locator("a").first()).toHaveAccessibleName(/^Доставки ?, 3 активни$/);
    }
    /* the one state of the page until its author draws the screen: the empty state of the prototype */
    await expect(page.locator("main .st-empty h2")).toHaveText(app.role === "waiter" ? "Няма повиквания" : "Няма доставки за теб");
    await expect(page.locator("main .st-skel")).toHaveCount(0);
  });

  test(`${app.role}: the pencil is in the top bar between „Търси“ and „Смяна“ and writes a recommendation of the module`, async ({ page, context, browser }) => {
    const errs = errors(page);
    await signIn(context, app.role);
    await open(page, app.path);
    const pen = page.locator(".st-top .sa-pen-btn");
    await expect(pen).toHaveText("Молив");
    await expect(page.locator("[data-pen-wait]")).toHaveCount(0);
    await expect(page.locator("sa-pen-ui [data-fab]")).toHaveCount(0); /* never a floating button over the nav, the bar or the toasts */
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".st-top .sa-pen-btn")!).position)).not.toBe("fixed");
    await page.evaluate(`${st}.main.insertAdjacentHTML("beforeend", '<p style="text-align:center"><button class="pill pill-line" type="button" id="m2" data-act="menu">Смяна</button></p>')`);
    await pen.click();
    await expect(pen).toHaveAttribute("aria-pressed", "true");
    await expect(pen).toHaveText("Изключи");
    await expect(page.locator("sa-pen-ui .bar")).toContainText("Препоръка");
    const pick = page.locator("sa-pen-ui [data-pick]"), sh = page.locator("sa-pen-ui .sheet");
    /* while it is on, a button of the frame is pointed at, not pressed */
    await page.locator("#m2").click();
    if (await pick.isVisible()) await pick.click(); /* touch: the first tap outlines */
    await expect(sh.locator("h2")).toHaveText("Какво да подобрим?");
    await expect(page.locator(".st-sheetwrap")).toHaveCount(0);
    await expect(sh.locator("textarea")).toBeFocused(); /* the sheet is up (two frames after it is drawn) */
    await page.keyboard.press("Escape");
    await expect(page.locator("sa-pen-ui")).not.toHaveAttribute("data-pen-sheet", "");
    await expect(page.locator("sa-pen-ui .sw")).not.toHaveClass(/on/);
    await page.locator("main .st-empty h2").click();
    if (await pick.isVisible()) await pick.click();
    await expect(sh.locator("h2")).toHaveText("Какво да подобрим?");
    await expect(sh.locator(".meta")).toContainText(app.role === "waiter" ? "Сервитьор" : "Шофьор");
    /* letters only: the server takes numbers that look like a phone out of a note */
    const text = "Заглавието да е по-кратко " + app.role + " " + Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8);
    await sh.locator("textarea").fill(text);
    await sh.locator("[data-save]").click();
    await expect(page.locator("sa-pen-ui .toast")).toContainText("Препоръката е изпратена");
    await expect(page.locator("sa-pen-ui .toast")).toHaveCSS("opacity", "1");
    await page.waitForTimeout(400); /* it has come up */
    /* the toast of the pencil does not cover the bottom nav */
    const tb = (await page.locator("sa-pen-ui .toast").boundingBox())!, nb = (await page.locator(".st-nav").boundingBox())!;
    if ((page.viewportSize()?.width || 0) < 700) expect(tb.y + tb.height).toBeLessThanOrEqual(nb.y);
    await page.keyboard.press("Escape");
    await expect(pen).toHaveAttribute("aria-pressed", "false");
    /* the main admin sees it in "Бележки" with the module and the source */
    const a = await browser.newContext(); await signIn(a, "admin");
    const notes = (await (await a.request.get("/api/admin/notes")).json()) as { text: string; module: string; url: string; source?: { role?: string }; author?: string }[];
    const mine = notes.find((n) => n.text === text)!;
    expect(mine, "the note is saved").toBeTruthy();
    expect(mine.module).toBe(app.note);
    expect(mine.url).toBe(app.path);
    expect(JSON.stringify(mine)).toContain(app.role);
    await a.close();
    expect(errs).toEqual([]);
  });
}

test("the sheet „Смяна“: who is signed in, the theme, „Изход“; the focus stays inside, the page behind is inert, Esc closes", async ({ page, context }) => {
  await signIn(context, "waiter");
  await open(page, "/servitor/");
  const btn = page.locator('[data-act="menu"]');
  await expect(btn).toHaveAccessibleName("Смяна и настройки, свързано");
  await btn.focus(); await page.keyboard.press("Enter");
  const wrap = page.locator(".st-sheetwrap.on"), sh = wrap.locator(".st-sheet");
  await expect(sh).toHaveAttribute("role", "dialog");
  await expect(sh).toHaveAttribute("aria-modal", "true");
  await expect(sh.locator("h2")).toHaveText("Смяна");
  await expect(sh.locator(".kvs .kv").first()).toContainText("Сервитьор");
  await expect(sh.locator("[data-conn]")).toHaveText("Свързано");
  await expect(sh.locator('[data-act="theme"]')).toHaveText(["Авто", "Светла", "Тъмна", "По часа"]);
  await expect(sh.locator('[data-act="navapp"]')).toHaveCount(0);
  await expect(sh.locator("[data-close]")).toBeFocused();
  expect(await page.evaluate(() => [(document.querySelector(".st-app") as HTMLElement).inert, (document.querySelector(".st-nav") as HTMLElement).inert])).toEqual([true, true]);
  /* Tab and Shift+Tab never leave the sheet */
  for (let i = 0; i < 9; i++) { await page.keyboard.press(i % 3 === 2 ? "Shift+Tab" : "Tab"); expect(await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest(".st-sheet"))).toBe(true); }
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
  expect(await page.evaluate(() => !!document.activeElement!.closest(".st-sheet"))).toBe(true);
  expect(await serious(page)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.locator(".st-sheetwrap.on")).toHaveCount(0);
  await expect(btn).toBeFocused();
  expect(await page.evaluate(() => [(document.querySelector(".st-app") as HTMLElement).inert, (document.querySelector(".st-nav") as HTMLElement).inert])).toEqual([false, false]);
  /* a sheet of a screen, a second one over it, and confirm(): Esc closes the top one first */
  await page.evaluate(`window.__s1 = ${st}.sheet({ title: "Сметка", html: '<button class="pill" type="button" id="b1">В брой</button>', foot: '<button class="pill pill-red pill-block" type="button" id="b2">Маркирай платено</button>' }); window.__ok = 0`);
  await expect(page.locator(".st-sheetwrap.on h2")).toHaveText("Сметка");
  await page.evaluate(`${st}.confirm({ title: "Затвори масата?", text: "3 ястия още не са сервирани.", ok: "Затвори въпреки това", danger: true }, () => { window.__ok++; })`);
  await expect(page.locator(".st-sheetwrap.on")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".st-sheetwrap.on")).toHaveCount(1);
  expect(await page.evaluate(() => (document.querySelector(".st-app") as HTMLElement).inert)).toBe(true);
  await page.evaluate(`${st}.confirm({ title: "Затвори масата?", ok: "Затвори въпреки това", danger: true }, () => { window.__ok++; })`);
  await page.locator(".st-sheetwrap.on [data-yes]").click();
  expect(await page.evaluate("window.__ok")).toBe(1);
  await page.locator(".st-sheetwrap.on .scrim").click({ position: { x: 20, y: 20 } });
  await expect(page.locator(".st-sheetwrap.on")).toHaveCount(0);
  /* "Изход" signs out */
  await btn.click();
  await page.locator('.st-sheetwrap.on [data-act="logout"]').click();
  await expect(page).toHaveURL(/\/admin\/vhod\/$/);
  await page.goto("/servitor/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=/);
});

test("the driver's sheet has the navigation app; it is remembered on the device", async ({ page, context }) => {
  await signIn(context, "driver");
  await open(page, "/shofyor/");
  await page.locator('[data-act="menu"]').click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator(".kvs .kv").first()).toContainText("Шофьор");
  await expect(sh.locator('[data-act="navapp"]')).toHaveText(["Google Maps", "Waze"]);
  await expect(sh.locator('[data-act="navapp"][data-v="google"]')).toHaveAttribute("aria-pressed", "true");
  await sh.locator('[data-act="navapp"][data-v="waze"]').click();
  await expect(sh.locator('[data-act="navapp"][data-v="waze"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(`${st}.navApp()`)).toBe("waze");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("st-prefs")!).nav)).toBe("waze");
  /* the rows of the shift come from the screen through a hook; here the frame alone */
  await expect(sh.locator(".kvs .kv")).toHaveCount(2);
});

test("the theme: Авто / Светла / Тъмна / По часа, remembered on the device and set before the first paint", async ({ page, context }) => {
  await signIn(context, "waiter");
  await page.emulateMedia({ colorScheme: "light" });
  await open(page, "/servitor/");
  const html = page.locator("html");
  expect(await html.getAttribute("data-theme")).toBeNull();
  await page.locator('[data-act="menu"]').click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator('[data-act="theme"][data-v="system"]')).toHaveAttribute("aria-pressed", "true");
  await sh.locator('[data-act="theme"][data-v="dark"]').click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(sh.locator('[data-act="theme"][data-v="dark"]')).toHaveAttribute("aria-pressed", "true");
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".st-app")!).backgroundColor);
  expect(bg).toBe("rgb(18, 18, 17)");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("st-prefs")!).theme)).toBe("dark");
  expect(await serious(page)).toEqual([]);
  /* after a reload the theme is there before any script of the page runs */
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.locator(".st-app:not([data-boot]) .st-me")).toBeVisible();
  await page.locator('[data-act="menu"]').click();
  await sh.locator('[data-act="theme"][data-v="hour"]').click();
  const hour = +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hour12: false }).format(new Date()) % 24;
  await expect(html).toHaveAttribute("data-theme", hour >= 18 || hour < 7 ? "dark" : "light");
  await expect(sh).toContainText("„По часа“ е тъмна от 18:00 до 07:00");
  await sh.locator('[data-act="theme"][data-v="light"]').click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await sh.locator('[data-act="theme"][data-v="system"]').click();
  expect(await html.getAttribute("data-theme")).toBeNull();
  /* only the preferences of the device are kept by the frame */
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("st-")))).toEqual(["st-prefs"]);
});

test("the toast: one at a time under the top bar, „Отмени“ gives the action back", async ({ page, context }) => {
  await signIn(context, "waiter");
  await open(page, "/servitor/");
  await page.evaluate(`window.__undo = 0; ${st}.toast("Маса 12: отивам. Колегите виждат, че масата е поета.")`);
  const t = page.locator(".st-toast");
  await expect(t).toHaveClass(/on/);
  await expect(t).toHaveAttribute("role", "status");
  await expect(t).toHaveText("Маса 12: отивам. Колегите виждат, че масата е поета.");
  await expect(t.locator("button")).toHaveCount(0);
  await page.evaluate(`${st}.toast("Маса 12 е обслужена", { undo: () => { window.__undo++; } })`);
  await expect(page.locator(".st-toast")).toHaveCount(1);
  await expect(t.locator("span")).toHaveText("Маса 12 е обслужена");
  await expect(t.locator("button")).toHaveText("Отмени");
  await expect(t).toHaveCSS("opacity", "1");
  const g = await page.evaluate(() => { const r = (s: string) => document.querySelector(s)!.getBoundingClientRect(); return { top: r(".st-top").bottom, t: r(".st-toast").top, tb: r(".st-toast").bottom, nav: r(".st-nav").top, btn: r(".st-toast button").height, tr: r(".st-toast").right, w: innerWidth }; });
  expect(g.t).toBeGreaterThanOrEqual(g.top);
  expect(g.tb).toBeLessThan(g.nav);
  expect(g.btn).toBeGreaterThanOrEqual(48);
  expect(g.tr).toBeLessThanOrEqual(g.w);
  await t.locator("button").click();
  expect(await page.evaluate("window.__undo")).toBe(1);
  await expect(t).not.toHaveClass(/on/);
  /* without "Отмени" it goes away by itself */
  await page.evaluate(`${st}.toast("Потвърдено", { ms: 400 })`);
  await expect(t).toHaveClass(/on/);
  await expect(t).not.toHaveClass(/on/);
});

test("the timers tick once a second from a timestamp and colour their card by the waiting time", async ({ page, context }) => {
  await signIn(context, "waiter");
  await open(page, "/servitor/");
  await page.evaluate(`${st}.main.innerHTML = '<div class="cstrip" id="lv" data-lvl="3,5">' + ${st}.timer(Date.now() - 1000) + '</div><div id="plain">' + ${st}.timer(Date.now() - 125000, "tm") + '</div>'`);
  const tm = page.locator("#lv [data-since]");
  await expect(tm).toHaveText(/^0:0[12]$/);
  await expect(page.locator("#plain [data-since]")).toHaveText(/^2:0[5-9]$/);
  await expect(page.locator("#plain [data-since]")).toHaveClass("tnum tm");
  await expect(page.locator("#lv")).toHaveClass(/warn/, { timeout: 4000 });
  await expect(page.locator("#lv")).toHaveClass(/late/, { timeout: 4000 });
  await expect(page.locator("#lv")).not.toHaveClass(/warn/);
  expect(await page.evaluate(`[${st}.mmss(0), ${st}.mmss(75), ${st}.mmss(600)]`)).toEqual(["0:00", "1:15", "10:00"]);
  /* a hidden page does not tick; when it is seen again the time is right at once */
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  const before = await tm.textContent();
  await page.waitForTimeout(2200);
  expect(await tm.textContent()).toBe(before);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  expect(await tm.textContent()).not.toBe(before);
});

test("no connection, the waiter: the strip, the whole screen with the steps, „Опитай пак“, „Виж последните данни“ and back", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "waiter");
  await open(page, "/servitor/");
  await page.evaluate(`window.__reload = 0; ${st}.onReload(() => { window.__reload++; }); window.__net = []; ${st}.onNet((off) => window.__net.push(off));
    ${st}.setBadge("calls", 4); ${st}.setBadge("ready", 2);
    ${st}.main.innerHTML = '<div class="cstrip" id="c1" data-lvl>' + ${st}.timer(Date.now() - 61000) + '<button class="pill" type="button" id="go">Отивам</button></div>'; ${st}.synced();
    document.getElementById("go").addEventListener("click", () => { window.__went = 1; })`);
  await context.setOffline(true);
  const strip = page.locator(".st-net");
  await expect(strip).toBeVisible();
  await expect(strip).toHaveAttribute("role", "status");
  await expect(strip.locator("span")).toHaveText("Няма връзка. Поръчките се пазят тук.");
  await expect(strip.locator("button")).toHaveText("Опитай пак");
  await expect(page.locator('[data-act="menu"]')).toHaveAccessibleName("Смяна и настройки, няма връзка");
  await expect(page.locator(".st-me")).toHaveClass(/off/);
  expect(await page.evaluate(`[${st}.offline, ${st}.stale, window.__net]`)).toEqual([true, true, [true]]);
  /* the whole screen */
  const off = page.locator(".st-app > .offline");
  await expect(off.locator("h2")).toHaveText("Няма връзка с ресторанта");
  await expect(off.locator("ol li")).toHaveCount(4);
  await expect(off.locator("ol li").nth(1)).toHaveText("Изключи и включи Wi-Fi. Ако мрежата не работи, ползвай мобилни данни.");
  await expect(off).toContainText("Новите поръчки се пазят на телефона и тръгват сами, щом връзката се върне.");
  await expect(page.locator("main")).toBeHidden();
  await expect(page.locator(".st-nav")).toHaveClass(/stale/);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".st-nav .cnt")!).backgroundColor === getComputedStyle(document.querySelector(".st-nav .cnt.ember")!).backgroundColor)).toBe(true);
  expect(await serious(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  /* "Опитай пак" checks and says the truth */
  const retry = off.locator('[data-act="retry"]');
  expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await retry.click();
  await expect(retry).toBeDisabled();
  await expect(retry).toHaveText("Проверяваме…");
  await expect(page.locator(".st-toast")).toHaveText("Още няма връзка. Опитваме сами на всеки 10 сек.");
  await expect(retry).toBeEnabled();
  /* the toast is under the strip, never over it */
  const g = await page.evaluate(() => ({ s: document.querySelector(".st-net")!.getBoundingClientRect().bottom, t: document.querySelector(".st-toast")!.getBoundingClientRect().top }));
  expect(g.t).toBeGreaterThanOrEqual(g.s);
  /* the last data: a note with the hour, the timers stand still, an action says why it waits */
  await off.locator('[data-act="cached"]').click();
  await expect(off).toBeHidden();
  await expect(page.locator("[data-stale] .notice")).toHaveText(/^Последни данни от \d\d:\d\d\. Таймерите са спрени, а „Отивам“ ще може, щом има връзка\.$/);
  const tm = page.locator("#c1 [data-since]"), frozen = await tm.textContent();
  await page.waitForTimeout(2300);
  expect(await tm.textContent()).toBe(frozen);
  expect(await page.evaluate(`${st}.offAttr()`)).toBe(' aria-disabled="true" data-off="Без връзка колегите няма да видят. Опитай, щом връзката се върне."');
  await page.evaluate(`document.getElementById("go").outerHTML = '<button class="pill" type="button" id="go"' + ${st}.offAttr() + '>Отивам</button>'; document.getElementById("go").addEventListener("click", () => { window.__went = 1; })`);
  await page.locator("#go").click({ force: true }); /* aria-disabled: a person can still touch it, and hears why it waits */
  await expect(page.locator(".st-toast")).toHaveText("Без връзка колегите няма да видят. Опитай, щом връзката се върне.");
  expect(await page.evaluate("window.__went")).toBeUndefined();
  /* in the sheet too */
  await page.locator('[data-act="menu"]').click();
  await expect(page.locator(".st-sheetwrap.on [data-conn]")).toHaveText("Няма връзка");
  await page.keyboard.press("Escape");
  /* the connection is back: the strip goes, the screen loads again, the timers tick */
  await context.setOffline(false);
  await expect(strip).toBeHidden({ timeout: 20_000 });
  await expect(page.locator("[data-stale]")).toHaveCount(0);
  await expect(page.locator(".st-nav")).not.toHaveClass(/stale/);
  await expect(page.locator(".st-me")).not.toHaveClass(/off/);
  expect(await page.evaluate("window.__reload")).toBeGreaterThanOrEqual(1);
  expect(await page.evaluate(`[${st}.offline, window.__net[window.__net.length - 1]]`)).toEqual([false, false]);
  await expect(tm).not.toHaveText(frozen!);
  expect(await page.evaluate(`${st}.offAttr()`)).toBe("");
  expect(errs).toEqual([]);
});

test("no connection, the driver: the strip says what waits and „Виж“ opens it; the screen stays", async ({ page, context }) => {
  await signIn(context, "driver");
  await open(page, "/shofyor/");
  await page.evaluate(`${st}.setBadge("list", 4)`);
  await context.setOffline(true);
  const strip = page.locator(".st-net");
  await expect(strip.locator("span")).toHaveText("Няма връзка. Записите се пазят тук.");
  await expect(strip.locator("button")).toHaveText("Опитай пак");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator(".st-app > .offline")).toBeHidden();
  await expect(page.locator(".st-nav")).not.toHaveClass(/stale/);
  expect(await page.evaluate(`[${st}.offline, ${st}.stale, ${st}.offAttr()]`)).toEqual([true, false, ""]);
  expect((await strip.locator("button").boundingBox())!.height).toBeGreaterThanOrEqual(48);
  expect(await serious(page)).toEqual([]);
  await context.setOffline(false);
  await expect(strip).toBeHidden({ timeout: 20_000 });
});

test("the real-time stream drops: „Свързваме се отново …“, and the screen loads again when it is back", async ({ page, context }) => {
  await signIn(context, "waiter");
  let block = true;
  await page.route("**/api/stream**", (r) => (block ? r.abort() : r.continue()));
  await open(page, "/servitor/");
  await page.evaluate(`window.__reload = 0; ${st}.onReload(() => { window.__reload++; }); window.__ev = []; ${st}.onLive(["floor.call", "order.status"], (d, t) => window.__ev.push(t))`);
  const strip = page.locator(".st-net");
  await expect(strip.locator("span")).toHaveText("Свързваме се отново …", { timeout: 10_000 });
  await expect(strip.locator("button")).toHaveCount(0);
  await expect(page.locator('[data-act="menu"]')).toHaveAccessibleName("Смяна и настройки, свързваме се отново");
  /* it is not "no connection": the screen stays and nothing is frozen */
  await expect(page.locator("main")).toBeVisible();
  expect(await page.evaluate(`[${st}.offline, ${st}.stale]`)).toEqual([false, false]);
  block = false;
  await expect(strip).toBeHidden({ timeout: 20_000 });
  expect(await page.evaluate("window.__reload")).toBeGreaterThanOrEqual(1);
});

test("the search shell: one field with one clear button, Enter opens the first result, the focus stays inside, Esc and „Затвори“", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "waiter");
  await open(page, "/servitor/");
  /* nothing to search in yet: no "Търси" and no field */
  await expect(page.locator('[data-act="find"]:visible')).toHaveCount(0);
  await page.evaluate(`${st}.setSearch(${provider}); ${st}.setTop({ find: true })`);
  const btn = page.locator('.st-top [data-act="find"]');
  await expect(btn).toHaveAccessibleName("Търси: маси, поръчки, изчерпано, резервации, ястия");
  await btn.click();
  const dlg = page.locator(".st-find.on");
  await expect(dlg).toHaveAttribute("role", "dialog");
  const inp = dlg.locator("#fq");
  await expect(inp).toBeFocused();
  await expect(inp).toHaveAttribute("placeholder", "Маса, №, резервация, ястие…");
  await expect(dlg.locator(".fscope")).toHaveText("Търсиш само в своето.");
  await expect(dlg.locator("[data-clr]")).toBeHidden();
  expect(await page.evaluate(() => (document.querySelector(".st-app") as HTMLElement).inert)).toBe(true);
  /* an example chip types itself */
  await dlg.locator("[data-ex]").click();
  await expect(inp).toHaveValue("12");
  await expect(dlg.locator("a.frow")).toHaveCount(2);
  /* only our clear button: the browser's own × of type=search is hidden */
  await expect(dlg.locator("[data-clr]")).toBeVisible();
  await expect(dlg.locator(".search button")).toHaveCount(1);
  expect(await page.evaluate(() => [...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => /::-webkit-search-cancel-button/.test(r.cssText) && /display:\s*none/.test(r.cssText)); } catch { return false; } }))).toBe(true);
  /* Tab stays inside */
  for (let i = 0; i < 8; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => !!document.activeElement!.closest(".st-find"))).toBe(true); }
  await dlg.locator("[data-clr]").click();
  await expect(inp).toHaveValue(""); await expect(inp).toBeFocused();
  await inp.fill("няма");
  await expect(dlg.locator(".fempty h3")).toHaveText("Няма „няма“");
  await inp.fill("7");
  await expect(dlg.locator("a.frow").first()).toContainText("Маса 7");
  expect(await serious(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  /* Enter opens the first result */
  await inp.press("Enter");
  await expect(page).toHaveURL(/#m7$/);
  /* Esc closes and gives the focus back */
  await page.keyboard.press("Escape");
  await expect(page.locator(".st-find")).toHaveCount(0);
  await expect(btn).toBeFocused();
  expect(await page.evaluate(() => (document.querySelector(".st-app") as HTMLElement).inert)).toBe(false);
  /* "Затвори"; and a text to start with */
  await page.evaluate(`${st}.openSearch(undefined, "12")`);
  await expect(page.locator(".st-find.on #fq")).toHaveValue("12");
  await page.locator(".st-find.on [data-fclose]").click();
  await expect(page.locator(".st-find")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("@phone 360: a long title, „Назад“ and the action bar: the bar is above the nav, nothing overlaps, no horizontal scroll", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "driver");
  await open(page, "/shofyor/");
  await page.evaluate(`${st}.setSearch(${provider}); ${st}.setTop({ title: "Край на смяната за днес", sub: "Шофьор 1 · Автомобил 1 · от 09:20", back: { href: "/shofyor/", label: "Доставки" }, find: true })`);
  await expect(page.locator(".st-top .st-back")).toHaveText("Доставки");
  await expect(page).toHaveTitle("Край на смяната за днес | Siracusa · Шофьор");
  const g = await page.evaluate(() => { const r = (s: string) => document.querySelector(s)!.getBoundingClientRect(); return { back: r(".st-back"), tt: r(".st-top .tt"), find: r('.st-top [data-act="find"]'), me: r(".st-me"), over: document.documentElement.scrollWidth - innerWidth, w: innerWidth }; });
  expect(g.back.height).toBeGreaterThanOrEqual(48);
  expect(g.back.right).toBeLessThanOrEqual(g.tt.left);
  expect(g.tt.right).toBeLessThanOrEqual(g.find.left);
  expect(g.me.right).toBeLessThanOrEqual(g.w);
  expect(g.over).toBeLessThanOrEqual(0);
});

test("@desktop 1440: the app stays a centred phone column, with the nav, the sheet and the toast inside it", async ({ page, context }) => {
  await signIn(context, "waiter");
  await open(page, "/servitor/", "light");
  await page.locator('[data-act="menu"]').click();
  await expect(page.locator(".st-sheetwrap.on .st-sheet")).toBeVisible();
  await page.waitForTimeout(450); /* the sheet has come up */
  await page.evaluate(`${st}.toast("Маса 12 е обслужена", { undo() {} })`);
  await expect(page.locator(".st-toast")).toHaveCSS("opacity", "1");
  const g = await page.evaluate(() => { const r = (s: string) => { const b = document.querySelector(s)!.getBoundingClientRect(); return { x: b.left, r: b.right, w: b.width, mid: b.left + b.width / 2 }; }; return { app: r(".st-app"), top: r(".st-top"), nav: r(".st-nav"), sheet: r(".st-sheet"), toast: r(".st-toast"), w: innerWidth, over: document.documentElement.scrollWidth - innerWidth }; });
  expect(g.app.w).toBe(430);
  expect(Math.abs(g.app.mid - g.w / 2)).toBeLessThanOrEqual(1);
  expect(g.top.w).toBe(430);
  for (const k of ["nav", "sheet", "toast"] as const) { expect(g[k].x, k).toBeGreaterThanOrEqual(g.app.x); expect(g[k].r, k).toBeLessThanOrEqual(g.app.r); expect(Math.abs(g[k].mid - g.w / 2), k).toBeLessThanOrEqual(1); }
  expect(g.nav.w).toBe(414);
  expect(g.over).toBeLessThanOrEqual(0);
  expect(await serious(page)).toEqual([]);
});

test("the session cannot be read: „Няма връзка с ресторанта“ or an error with „Опитай пак“, never an empty page", async ({ page, context }) => {
  await signIn(context, "waiter");
  let mode: "abort" | "fail" | "ok" = "abort";
  await page.route("**/api/auth/me", (r) => (mode === "abort" ? r.abort() : mode === "fail" ? r.fulfill({ status: 500, contentType: "application/json", body: '{"error":"server"}' }) : r.continue()));
  await page.goto("/servitor/");
  await expect(page.locator("main h1")).toHaveText("Няма връзка с ресторанта");
  await expect(page.locator(".st-top .st-word")).toHaveText("Siracusa");
  await expect(page.locator("[data-boot], .st-skel")).toHaveCount(0);
  expect(await serious(page)).toEqual([]);
  mode = "fail";
  await page.locator("[data-boot-retry]").click();
  await expect(page.locator("main h1")).toHaveText("Не успяхме да отворим приложението");
  mode = "ok";
  await page.locator("[data-boot-retry]").click();
  await expect(page.locator(".st-app:not([data-boot]) .st-me")).toBeVisible();
  await expect(page.locator(".st-top h1")).toHaveText("Залата");
  /* an error of a screen's load: the frame draws it, "Опитай пак" asks the screen again */
  await page.evaluate(`window.__reload = 0; ${st}.onReload(() => { window.__reload++; ${st}.main.innerHTML = "<p id='again'>заредено</p>"; }); window.__kind = ${st}.fail(new Error("x"))`);
  expect(await page.evaluate("window.__kind")).toBe("error");
  await expect(page.locator("main .st-empty.err h2")).toHaveText("Не успяхме да заредим данните");
  await page.locator('main [data-act="reload"]').click();
  await expect(page.locator("#again")).toHaveText("заредено");
});
