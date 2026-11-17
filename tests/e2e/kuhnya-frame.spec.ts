import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* Кухня, the frame of the module (src/modules/kuhnya/frame.ts, vhod.ts) on the tablet sizes of the approved prototype:
   1280 × 800, 1024 × 768 and 768 × 1024 (portrait), dark (default) and light. The guard and the roles, the choice of the
   section (remembered on the tablet), the top bar and its tabs (a section / "Общ изглед"), the row of the counters with
   "Търси" and "Молив" in the flow, "Звук" (remembered; "Звук: докоснете" until the first touch), the theme, the tablet's
   heartbeat, the pencil (a recommendation of the kitchen), no horizontal scroll, targets of 48 px, axe, no console errors.
   These are tablet tests: every test opens its own context with its own viewport (they run once, in the desktop project). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = {
  admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], kitchen: ["kitchen", E.KITCHEN_PASSWORD],
  waiter: ["waiter", E.WAITER_PASSWORD], driver: ["driver", E.DRIVER_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD],
};
const SIZES: [number, number][] = [[1280, 800], [1024, 768], [768, 1024]];
type Opt = { w?: number; h?: number; sec?: string | null; theme?: "dark" | "light"; role?: string | null; reduced?: boolean };
/** a tablet: its own context (viewport, touch), signed in, with the section and the theme already chosen on it */
async function tablet(browser: Browser, o: Opt = {}): Promise<{ ctx: BrowserContext; page: Page; errs: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: o.w || 1280, height: o.h || 800 }, hasTouch: true, reducedMotion: o.reduced ? "reduce" : "no-preference" });
  if (o.role !== null) { const u = USER[o.role || "kitchen"]; expect((await ctx.request.post("/api/auth/login", { data: { username: u[0], password: u[1] } })).status(), "sign-in").toBe(200); }
  await ctx.addInitScript(([sec, theme]) => {
    try { if (localStorage.getItem("sk-test")) return; localStorage.setItem("sk-test", "1"); if (sec) localStorage.setItem("sk-sec", JSON.stringify(sec)); if (theme) localStorage.setItem("sk-theme", JSON.stringify(theme)); } catch { /* ignore */ }
  }, [o.sec === undefined ? "skara" : o.sec, o.theme || ""] as [string | null, string]);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]/.test(m.text())) errs.push(m.text()); });
  return { ctx, page, errs };
}
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const ready = async (page: Page) => { await expect(page.locator(".kd:not(.kboot) .kbar")).toBeVisible(); await expect(page.locator("[data-qn]")).toBeVisible(); };
const overX = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, document.body.scrollWidth - innerWidth));

test("@desktop guard: no session -> the sign-in with #next=; other roles -> their own home; the kitchen without a section -> /kuhnya/vhod/", async ({ browser }) => {
  const anon = await tablet(browser, { role: null });
  await anon.page.goto("/kuhnya/izpalneni/");
  await expect(anon.page).toHaveURL(/\/admin\/vhod\/#next=%2Fkuhnya%2Fizpalneni%2F$/);
  await anon.ctx.close();
  for (const [role, home] of [["waiter", /\/servitor\/$/], ["driver", /\/shofyor\/$/], ["marketing", /\/admin\/$/]] as [string, RegExp][]) {
    const t = await tablet(browser, { role });
    await t.page.goto("/kuhnya/");
    await expect(t.page, role).toHaveURL(home);
    /* and the API says the same: the rights are in the core */
    expect((await t.ctx.request.get("/api/kitchen/queue?sec=skara")).status(), role).toBe(403);
    await t.ctx.close();
  }
  const k = await tablet(browser, { sec: null });
  for (const path of ["/kuhnya/", "/kuhnya/izcherpano/", "/kuhnya/obsht-izgled/"]) {
    await k.page.goto(path);
    await expect(k.page).toHaveURL(/\/kuhnya\/vhod\/$/);
    await expect(k.page.locator("h1")).toHaveText("Коя е секцията на този таблет?");
  }
  expect(k.errs).toEqual([]);
  await k.ctx.close();
});

test("@desktop the section of the tablet: 4 sections + „Общ изглед“, „Влез · …“, remembered; „Смени секцията“ leads back", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser, { sec: null });
  await page.goto("/kuhnya/vhod/");
  await expect(page.locator(".sct b")).toHaveText(["Топла кухня", "Скара Bertha", "Пещ за пици", "Салати и студени", "Общ изглед"]);
  await expect(page.locator(".sct.wide .d")).toHaveText("За главния готвач: всички секции, колко чакат, закъснения");
  await expect(page.locator(".lead")).toHaveText("Таблетът ще показва само ястията на секцията. Изборът се помни.");
  await expect(page.locator(".pin h2 small")).toHaveText(/^Вход: /);
  /* the conditional sections are said to be conditional (the core's marker) */
  await expect(page.locator(".note .miss")).toHaveText("[ЛИПСВА: секции на кухнята]");
  /* the place of the PIN step is there and empty; no keypad yet */
  await expect(page.locator("[data-pin]")).toHaveCount(1);
  await expect(page.locator("[data-pin] *")).toHaveCount(0);
  /* nothing is remembered before "Влез" */
  await page.locator('[data-sec="pesht"]').click();
  await expect(page.locator('[data-sec="pesht"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".sct[aria-pressed=true]")).toHaveCount(1);
  await expect(page.locator("[data-go]")).toHaveText("Влез · Пещ за пици");
  expect(await page.evaluate(() => localStorage.getItem("sk-sec"))).toBeNull();
  await page.locator("[data-go]").click();
  await expect(page).toHaveURL(/\/kuhnya\/$/);
  await ready(page);
  await expect(page.locator(".ksec b")).toHaveText("Пещ за пици");
  await expect(page).toHaveTitle("Опашка · Пещ за пици | Кухня · Siracusa");
  expect(await page.evaluate(() => localStorage.getItem("sk-sec"))).toBe('"pesht"');
  /* the tabs of a section */
  await expect(page.locator(".ktabs a")).toHaveText([/^Опашка/, /^Изчерпано/, "Изпълнени", "Общ изглед"]);
  await expect(page.locator('.ktabs a[aria-current="page"]')).toHaveText(/^Опашка/);
  /* remembered: a new load stays in the section; "Смени секцията" opens the choice with it selected */
  await page.reload(); await ready(page);
  await expect(page.locator(".ksec b")).toHaveText("Пещ за пици");
  await expect(page.locator(".ksec")).toHaveAccessibleName("Пещ за пици Смени секцията");
  await page.locator(".ksec").click();
  await expect(page).toHaveURL(/\/kuhnya\/vhod\/$/);
  await expect(page.locator('[data-sec="pesht"]')).toHaveAttribute("aria-pressed", "true");
  /* the head chef: "Общ изглед" with its own tabs; the queue and "Изпълнени" lead there */
  await page.locator('[data-sec="all"]').click();
  await expect(page.locator("[data-go]")).toHaveText("Влез · Общ изглед");
  await page.locator("[data-go]").click();
  await expect(page).toHaveURL(/\/kuhnya\/obsht-izgled\/$/);
  await expect(page.locator(".ksec b")).toHaveText("Главен готвач");
  await expect(page.locator(".ktabs a")).toHaveText(["Общ изглед", /^Изчерпано/, "Натоварено"]);
  await expect(page.locator('.ktabs a[aria-current="page"]')).toHaveText("Общ изглед");
  for (const path of ["/kuhnya/", "/kuhnya/izpalneni/"]) { await page.goto(path); await expect(page).toHaveURL(/\/kuhnya\/obsht-izgled\/$/); }
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the screens of the module: the right tab, the frame, the place for the screen; no order button, no client chrome", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser);
  const SCREENS: [string, string | RegExp, string][] = [["/kuhnya/", /^Опашка/, "Опашка · Скара Bertha"], ["/kuhnya/izcherpano/", /^Изчерпано/, "Изчерпано днес · Скара Bertha"], ["/kuhnya/izpalneni/", "Изпълнени", "Изпълнени · Скара Bertha"], ["/kuhnya/obsht-izgled/", "Общ изглед", "Общ изглед"]];
  for (const [path, tab, title] of SCREENS) {
    await page.goto(path); await ready(page);
    await expect(page.locator('.ktabs a[aria-current="page"]'), path).toHaveText(tab);
    await expect(page.locator('.ktabs a[aria-current="page"]')).toHaveCount(1);
    await expect(page).toHaveTitle(title + " | Кухня · Siracusa");
    await expect(page.locator("main#main.kmain")).toHaveCount(1);
    await expect(page.locator("[data-clock]")).toHaveText(/^\d\d:\d\d$/);
    await expect(page.locator(".net")).toHaveText("Онлайн");
    await expect(page.locator(".ktools [data-kfind]")).toHaveText("Търси");
    /* a staff screen: no cart, no footer, no bottom bar, no assistant, no cookie banner of the site, no bar of the admin */
    await expect(page.locator(".foot, .nav, .aifab, .cookie, .cartbar, .sa-side, .sa-bnav, .sa-top")).toHaveCount(0);
    await expect(page.locator("a, button").filter({ hasText: /Нова поръчка|Количка|Поръчай/ })).toHaveCount(0);
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex");
  }
  /* the screens written after the frame: the skeleton with a hidden status and a clean mount point */
  await page.goto("/kuhnya/izcherpano/"); await ready(page);
  await expect(page.locator('main[data-screen="izcherpano"] .kskel')).toHaveCount(3);
  await expect(page.locator("main [role=status]")).toHaveText("Зареждаме …");
  /* "Натоварено" is reached from the key in the row of the queue (a section has no tab for it) */
  await page.goto("/kuhnya/"); await ready(page);
  const busy = page.locator('.kstrip a.kpill[href="/kuhnya/natovareno/"]');
  await expect(busy).toHaveText(/^Натоварено(: изкл\.| \+\d+ мин)/);
  await busy.click();
  await expect(page).toHaveURL(/\/kuhnya\/natovareno\/$/);
  await expect(page).toHaveTitle("Натоварено | Кухня · Siracusa");
  await expect(page.locator('.ktabs a[aria-current="page"]')).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the main admin, the owner and the manager may open the kitchen and get „Към таблото“; the kitchen has no such link", async ({ browser }) => {
  for (const role of ["owner", "manager", "admin"]) {
    const { ctx, page, errs } = await tablet(browser, { role, sec: null });
    await page.goto("/kuhnya/");
    await expect(page).toHaveURL(/\/kuhnya\/vhod\/$/);
    await expect(page.locator(".lg-top .kboss")).toHaveText("Табло"); await expect(page.locator(".lg-top .kboss")).toHaveAttribute("title", "Към таблото");
    await page.locator('[data-sec="skara"]').click(); await page.locator("[data-go]").click();
    await ready(page);
    const boss = page.locator(".kbar .kboss");
    await expect(boss).toHaveText("Табло");
    await expect(boss).toHaveAttribute("href", "/admin/");
    const bb = (await boss.boundingBox())!;
    expect(bb.height).toBeGreaterThanOrEqual(48); expect(bb.width).toBeGreaterThanOrEqual(48);
    expect(await overX(page)).toBeLessThanOrEqual(0);
    await boss.click();
    await expect(page, role).toHaveURL(/\/admin\/$/);
    expect(errs, role).toEqual([]);
    await ctx.close();
  }
  const k = await tablet(browser);
  await k.page.goto("/kuhnya/"); await ready(k.page);
  await expect(k.page.locator(".kboss")).toHaveCount(0);
  await k.ctx.close();
});

for (const [w, h] of SIZES) for (const theme of ["dark", "light"] as const) {
  test(`@desktop ${w} × ${h} ${theme}: the top bar and the row fit, nothing overlaps, no horizontal scroll, targets of 48 px`, async ({ browser }) => {
    const { ctx, page, errs } = await tablet(browser, { w, h, theme });
    await page.goto("/kuhnya/"); await ready(page);
    await expect(page.locator(".ktools .sa-pen-btn")).toBeVisible();
    await expect(page.locator(".kstrip .kcount")).toContainText("Чакат");
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".kd")!).backgroundColor);
    const lum = bg.match(/\d+/g)!.slice(0, 3).reduce((a, x) => a + +x, 0) / 3;
    if (theme === "dark") expect(lum).toBeLessThan(60); else expect(lum).toBeGreaterThan(200);
    expect(await overX(page)).toBeLessThanOrEqual(0);
    const g = await page.evaluate(() => {
      const r = (s: string) => { const el = document.querySelector(s); if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const small: string[] = [];
      document.querySelectorAll<HTMLElement>(".kd a[href], .kd button").forEach((el) => { if (el.offsetParent === null) return; const b = el.getBoundingClientRect(); if (b.height < 48 || b.width < 48) small.push((el.className || el.tagName) + " " + Math.round(b.width) + "×" + Math.round(b.height)); });
      const tabs = [...document.querySelectorAll(".ktabs a")].map((a) => { const b = a.getBoundingClientRect(); return { r: b.right, l: b.left, cut: (a as HTMLElement).scrollWidth > (a as HTMLElement).clientWidth + 1 }; });
      return { sec: r(".ksec")!, tabs: r(".ktabs")!, clock: r(".kclock")!, bar: r(".kbar")!, tools: r(".ktools")!, count: r(".kcount")!, find: r("[data-kfind]")!, pen: r(".sa-pen-btn")!, strip: r(".kstrip")!, main: r(".kmain")!, small, tab: tabs, net: r(".net")!, time: r("[data-clock]")!,
        text: [...document.querySelectorAll(".kcount > span:not(.sep)")].map((s) => { const b = s.getBoundingClientRect(); return { r: b.right, b: b.bottom, t: b.top }; }) };
    });
    expect(g.small).toEqual([]);
    /* the bar: the section, the tabs and the clock never overlap and stay on the screen */
    const apart = (a: { l: number; r: number; t: number; b: number }, b: { l: number; r: number; t: number; b: number }) => a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t + 0.5 || b.b <= a.t + 0.5;
    expect(apart(g.sec, g.tabs)).toBe(true); expect(apart(g.tabs, g.clock)).toBe(true); expect(apart(g.sec, g.clock)).toBe(true);
    for (const b of [g.sec, g.tabs, g.clock]) { expect(b.l).toBeGreaterThanOrEqual(0); expect(b.r).toBeLessThanOrEqual(w); }
    for (const t of g.tab) { expect(t.cut).toBe(false); expect(t.r).toBeLessThanOrEqual(g.tabs.r + 0.5); }
    if (w < 900) { expect(g.tabs.t).toBeGreaterThanOrEqual(g.sec.b - 0.5); expect(g.tabs.w).toBeGreaterThan(w - 40); } /* portrait: the tabs go down to a second row */
    else expect(g.tabs.t).toBeLessThan(g.sec.b);
    if (w <= 1100) expect(g.net.t).toBeGreaterThanOrEqual(g.time.b - 1); /* "Онлайн" is under the hour */
    else expect(g.net.r).toBeLessThanOrEqual(g.time.l);
    /* the row: the counters on the left, "Търси" and "Молив" on the right of the same row, in the flow (never over a counter) */
    expect(Math.abs((g.tools.t + g.tools.b) / 2 - (g.count.t + g.count.b) / 2)).toBeLessThanOrEqual(2);
    expect(g.tools.r).toBeLessThanOrEqual(w - 8);
    for (const s of g.text) expect(s.r).toBeLessThanOrEqual(g.tools.l);
    expect(g.find.r).toBeLessThanOrEqual(g.pen.l);
    if (w < 900) { for (const b of [g.find, g.pen]) { expect(b.h).toBe(56); expect(b.w).toBeGreaterThanOrEqual(60); } } /* icon over word */
    else for (const b of [g.find, g.pen]) expect(b.h).toBe(52);
    /* the pencil is the module's button in the row, not the round floating one */
    await expect(page.locator("sa-pen-ui [data-fab]")).toHaveCount(0);
    await expect(page.locator(".ktools .sa-pen-btn")).toHaveText(/Молив/);
    expect(g.main.t).toBeGreaterThanOrEqual(g.strip.b - 0.5);
    expect(errs).toEqual([]);
    await ctx.close();
  });
}

test("@desktop „Звук“: „Звук: докоснете“ until the first touch of this load, then „Звук вкл.“; the choice is remembered on the tablet", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser);
  await page.goto("/kuhnya/"); await ready(page);
  const snd = page.locator("[data-sound]");
  await expect(snd).toHaveText("Звук: докоснете");
  await expect(snd).toHaveClass(/ask/);
  /* the first touch anywhere unlocks it: only the key changes */
  await page.locator("[data-clock]").click();
  await expect(snd).toHaveText("Звук вкл.");
  await expect(snd).toHaveAttribute("aria-pressed", "true");
  await expect(snd).not.toHaveClass(/ask/);
  /* the key does what it says */
  await snd.click();
  await expect(snd).toHaveText("Звук изкл."); await expect(snd).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => localStorage.getItem("sk-sound"))).toBe("false");
  await page.reload(); await ready(page);
  await expect(snd).toHaveText("Звук изкл.");
  await snd.click();
  await expect(snd).toHaveText("Звук вкл.");
  expect(await page.evaluate(() => localStorage.getItem("sk-sound"))).toBe("true");
  /* "unlocked" is never kept between loads; a first touch on the key itself confirms "вкл." (it does not switch it off) */
  await page.reload(); await ready(page);
  await expect(snd).toHaveText("Звук: докоснете");
  await snd.click();
  await expect(snd).toHaveText("Звук вкл.");
  /* the keyboard too */
  await page.reload(); await ready(page);
  await snd.focus(); await page.keyboard.press("Enter");
  await expect(snd).toHaveText("Звук вкл.");
  await expect(snd).toBeFocused();
  /* only the tablet's own keys */
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("sk-")).sort());
  expect(keys.filter((k) => !["sk-sec", "sk-sound", "sk-device", "sk-test", "sk-theme", "sk-outbox"].includes(k))).toEqual([]);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the theme: dark by default, light by choice on this tablet, before the first paint", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser, { sec: null });
  await page.goto("/kuhnya/vhod/");
  await expect(page.locator("h1")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
  await expect(page.locator('[data-theme-set="dark"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-theme-set="light"]').click();
  await expect(page.locator('[data-theme-set="light"]')).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("sk-theme"))).toBe('"light"');
  /* the theme of the admin on the same device is another key and is not touched */
  expect(await page.evaluate(() => localStorage.getItem("sa-prefs"))).toBeNull();
  await page.locator('[data-sec="skara"]').click(); await page.locator("[data-go]").click();
  await ready(page);
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe("light");
  /* set by the inline script of the page, before the module's code runs */
  const html = await (await ctx.request.get("/kuhnya/")).text();
  expect(html).toContain('localStorage.getItem("sk-theme")');
  /* "Изход" is on this screen */
  await page.goto("/kuhnya/vhod/");
  await page.locator("[data-out]").click();
  await expect(page).toHaveURL(/\/admin\/vhod\//);
  await page.goto("/kuhnya/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fkuhnya%2F$/);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the heartbeat: the manager sees „Таблетът работи“ for the section of this tablet", async ({ browser }) => {
  const { ctx, page } = await tablet(browser, { sec: "studeni" });
  await page.goto("/kuhnya/"); await ready(page);
  await expect.poll(async () => { const l = await (await ctx.request.get("/api/kitchen/tablets")).json() as { sec: string; online: boolean; text: string }[]; return l.find((x) => x.sec === "studeni"); }).toMatchObject({ online: true, text: "Таблетът работи" });
  await ctx.close();
});

test("@desktop the pencil: a recommendation of the kitchen from the row of the counters, saved with the module „Кухня“", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser);
  await page.goto("/kuhnya/"); await ready(page);
  const pen = page.locator(".ktools .sa-pen-btn"), ui = page.locator("sa-pen-ui");
  await expect(pen).toHaveAttribute("aria-pressed", "false");
  await pen.click();
  await expect(pen).toHaveAttribute("aria-pressed", "true");
  await expect(ui.locator(".bar")).toContainText("Препоръка");
  await page.locator("[data-clock]").click();
  await expect(ui.locator(".sheet h2")).toHaveText("Какво да подобрим?");
  await ui.locator("textarea").fill("Часовникът да е по-голям.");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/admin/notes") && r.method() === "POST");
  await ui.locator("[data-save]").click();
  const body = (await sent).postDataJSON() as { module: string; url: string; text: string; viewport: { w: number } };
  expect(body).toMatchObject({ module: "kitchen", url: "/kuhnya/", text: "Часовникът да е по-голям.", viewport: { w: 1280 } });
  await expect(ui.locator(".toast")).toContainText("Препоръката е изпратена");
  /* in "Бележки" of the main admin: from the kitchen */
  const a = await tablet(browser, { role: "admin", sec: null });
  const list = await (await a.ctx.request.get("/api/admin/notes")).json() as { text: string; module: string; source?: { type: string; role?: string } }[];
  expect(list.find((n) => n.text === "Часовникът да е по-голям.")).toMatchObject({ module: "kitchen", source: { type: "staff", role: "kitchen" } });
  await a.ctx.close();
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop axe: no serious violations on the choice of the section and on a screen of the module, dark and light", async ({ browser }) => {
  for (const theme of ["dark", "light"] as const) {
    const { ctx, page } = await tablet(browser, { theme, reduced: true });
    await page.goto("/kuhnya/vhod/"); await expect(page.locator("h1")).toBeVisible();
    expect(await serious(page), "vhod " + theme).toEqual([]);
    await page.goto("/kuhnya/izpalneni/"); await ready(page);
    await expect(page.locator(".ktools .sa-pen-btn")).toBeVisible();
    expect(await serious(page), "frame " + theme).toEqual([]);
    await ctx.close();
  }
  /* 768 portrait: the choice of the section fits without a horizontal scroll, the tiles are 48 px and more */
  const { ctx, page } = await tablet(browser, { w: 768, h: 1024, sec: null });
  await page.goto("/kuhnya/vhod/"); await expect(page.locator("h1")).toBeVisible();
  expect(await page.evaluate(() => { const lg = document.querySelector(".lg")!; return lg.scrollWidth - lg.clientWidth; })).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".lg button, .lg a")].filter((b) => b.getBoundingClientRect().height < 48).map((b) => b.textContent))).toEqual([]);
  await ctx.close();
});
