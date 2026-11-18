import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ownServer, E } from "./own-server.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* Кухня: the screens after the queue (src/modules/kuhnya/izcherpano.ts, natovareno.ts, izpalneni.ts, obsht.ts) over the real
   core, with real orders placed through the site's API (never sample data):
   - „Изчерпано днес“: a dish of an accepted delivery: the notice says 1 order and the manager, the site's menu says it is
     sold out, the order's line too, „Върни“ and „Върни в менюто“ bring it back; real time from another tablet;
   - „Натоварено“ on its own server (the switch is one for the whole kitchen and the site): the public status says
     „Възможни са закъснения · около 55 мин“, a new order gets „+20 мин“ in the queue, the log, off again;
   - „Изпълнени днес“: a finished order, „Върни в опашката“ with the notice and „Върни“, a taken order cannot go back (409);
   - „Общ изглед“ of the head chef: orders in two sections with their states, the ticking deadline, live updates, a
     section's queue from its card, no connection;
   - every screen at 1280 × 800, 1024 × 768 and 768 × 1024, dark and light: no horizontal scroll, targets of 48 px, axe.
   Tablet tests: each opens its own context (they run once, in the desktop project). */
const SIZES: [number, number][] = [[1280, 800], [1024, 768], [768, 1024]];
type Opt = { w?: number; h?: number; sec?: string; theme?: "dark" | "light"; base?: string };
async function tablet(browser: Browser, o: Opt = {}): Promise<{ ctx: BrowserContext; page: Page; errs: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: o.w || 1280, height: o.h || 800 }, hasTouch: true, ...(o.base ? { baseURL: o.base } : {}) });
  expect((await ctx.request.post("/api/auth/login", { data: { username: "kitchen", password: E.KITCHEN_PASSWORD } })).status(), "sign-in").toBe(200);
  await ctx.addInitScript(([sec, theme]) => {
    try { if (localStorage.getItem("sk-test")) return; localStorage.setItem("sk-test", "1"); localStorage.setItem("sk-sec", JSON.stringify(sec)); if (theme) localStorage.setItem("sk-theme", JSON.stringify(theme)); } catch { /* ignore */ }
  }, [o.sec || "skara", o.theme || ""]);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  return { ctx, page, errs };
}
type Line = { id: string; q: number; mods?: string[] };
type Made = { no: string; key: string };
/** the customer orders from the site (12:30 on the shop's clock: the kitchen and the delivery are open) */
async function order(request: APIRequestContext, mode: "delivery" | "pickup", lines: Line[], base = ""): Promise<Made> {
  const r = await request.post(base + "/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode, lines: lines.map((l) => ({ key: l.id + (l.mods || []).join(), extra: 0, mods: [], ...l })) }, ...(mode === "delivery" ? { addr: "ж.к. Дружба 2, бл. 311" } : {}), name: "Иван Петров", phone: "0888 12 34 56", pay: "cash" } });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()) as Made;
}
const kpost = async (ctx: BrowserContext, path: string, data: Record<string, unknown>) => { const r = await ctx.request.post("/api/kitchen/" + path, { data }); return { status: r.status(), body: await r.json() }; };
const menuOut = async (request: APIRequestContext, id: string, base = "") => ((await (await request.get(base + "/api/menu")).json()) as { items: { id: string; t: string[] }[] }).items.find((x) => x.id === id)!.t.includes("out");
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const overX = (page: Page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, document.body.scrollWidth - innerWidth));
/** every visible button and link of the screen is at least 48 × 48 */
const small = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  document.querySelectorAll<HTMLElement>(".kd a[href], .kd button").forEach((el) => { if (el.offsetParent === null) return; const b = el.getBoundingClientRect(); if (b.height < 48 || b.width < 48) out.push((el.className || el.tagName) + " " + (el.textContent || "").trim().slice(0, 20) + " " + Math.round(b.width) + "×" + Math.round(b.height)); });
  return out;
});
const toast = (page: Page) => page.locator(".kt");

test("@desktop „Изчерпано днес“: one touch on a dish of an accepted delivery, the notice says 1 order and the manager; the site, the order's line; „Върни“ and „Върни в менюто“", async ({ browser, request }) => {
  const DISH = "teleshki-sudzhuk";
  const { ctx, page, errs } = await tablet(browser);
  await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "skara" } }); /* a run that stopped half-way */
  const o = await order(request, "delivery", [{ id: DISH, q: 1 }, { id: "kebapcheta", q: 1 }]);
  await page.goto("/kuhnya/izcherpano/");
  await expect(page.locator("h1")).toHaveText("Изчерпано днес");
  await expect(page.locator(".klead")).toHaveText("Докосни ястие, което свърши. Действа веднага.");
  await expect(page.locator(".eff li")).toHaveText(["Сайт, QR меню и сервитьор: видимо с „Изчерпано днес“, без „+“", "Wolt и Foodpanda: скрито"]);
  /* the section's dishes and the add-ons shared by every section */
  await expect(page.locator(".cath").first()).toHaveText("Скара Bertha");
  await expect(page.locator(".cath").last()).toHaveText(/^Добавки · за всички секции: готвят се с основното ястие$/);
  await expect(page.locator(".side h2")).toHaveText(/^Списък изчерпани \d+$/);
  await expect(page.locator(".foot2")).toHaveText("В полунощ се връща в менюто всичко, отбелязано днес тук.");
  await expect(page.locator(".kcount")).toContainText("Изчерпани за Скара Bertha");
  await expect(page.locator(".kcount")).toContainText("Във всички секции");
  /* sold out in the menu's data (the admin): the tile says what the list says */
  await expect(page.locator('.tile[data-id="pleskavitsa"] .st')).toHaveText("Изчерпано в менюто от админа");
  await expect(page.locator(".orow", { hasText: "Плескавица" }).locator("small")).toContainText("изчерпано в менюто от админа (не се връща само)");
  const tile = page.locator('.tile[data-id="' + DISH + '"]');
  await expect(tile).toHaveAttribute("aria-pressed", "false");
  await expect(tile.locator(".act")).toHaveText("Отбележи изчерпано");
  const before = Number(await page.locator(".side h2 .n").textContent());
  /* one touch: at once on the screen */
  await tile.click();
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(tile).toHaveClass(/\bout\b/);
  await expect(tile.locator(".st")).toHaveText("Изчерпано днес");
  await expect(tile.locator(".act")).toHaveText("Върни в менюто");
  await expect(page.locator(".side h2 .n")).toHaveText(String(before + 1));
  await expect(page.locator(".orow").first().locator("b")).toHaveText("Телешки суджук");
  await expect(page.locator(".orow").first().locator("small")).toHaveText(/^Скара Bertha · от \d\d:\d\d$/);
  /* the notice: in how many accepted orders, who was told (a delivery: the manager), "Върни · 10" */
  await expect(toast(page)).toContainText("Телешки суджук · изчерпано днес");
  await expect(toast(page)).toContainText("В 1 приета поръчка · известихме управителя.");
  await expect(toast(page).locator("button")).toHaveText(/^Върни · (10|9)$/);
  /* one source: the site's menu and the order's line in the kitchen */
  await expect.poll(() => menuOut(request, DISH)).toBe(true);
  const q = (await (await ctx.request.get("/api/kitchen/queue?sec=skara")).json()) as { tickets: { no: string; lines: { id: string; out: boolean }[] }[] };
  expect(q.tickets.find((t) => t.no === o.no)!.lines.find((l) => l.id === DISH)!.out).toBe(true);
  await expect(page.locator("[data-outn]")).toHaveText(/^\d+$/);
  /* "Върни" in the notice: back in the menu */
  await toast(page).locator("button").click();
  await expect(tile).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => menuOut(request, DISH)).toBe(false);
  /* again, and back from the list with "Върни в менюто" */
  await tile.click();
  await expect(toast(page)).toContainText("Телешки суджук · изчерпано днес");
  await expect.poll(() => menuOut(request, DISH)).toBe(true);
  await page.locator(".orow", { hasText: "Телешки суджук" }).locator("[data-back]").click();
  await expect(toast(page)).toContainText("Телешки суджук е отново в менюто");
  await expect(toast(page)).toContainText("Бутонът „+“ се върна навсякъде.");
  await expect(tile).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".orow", { hasText: "Телешки суджук" })).toHaveCount(0);
  await expect.poll(() => menuOut(request, DISH)).toBe(false);
  /* real time: another tablet (the head chef) marks it; this screen follows without a reload */
  const r = await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: true, sec: "all" } });
  expect(r.status()).toBe(200);
  await expect(tile).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".orow", { hasText: "Телешки суджук" }).locator("small")).toHaveText(/^Скара Bertha · от \d\d:\d\d · Главен готвач \(Общ изглед\)$/);
  expect((await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "all" } })).status()).toBe(200);
  await expect(tile).toHaveAttribute("aria-pressed", "false");
  expect((await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara" })).status).toBe(200); /* out of the queue for the next tests */
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Натоварено“ (own server): on: the site says „около 55 мин“, a new order gets „+20 мин“ in the queue; the log of the day; off again", async ({ browser }) => {
  test.setTimeout(120_000);
  const S = await ownServer("kbusy", 21);
  try {
    const { ctx, page, errs } = await tablet(browser, { base: S.base });
    const status = async () => ((await (await ctx.request.get("/api/status")).json()) as { eta: { text: string } }).eta.text.replace(/\u00a0/g, " ");
    await page.goto("/kuhnya/natovareno/");
    await expect(page.locator("h1")).toHaveText("Натоварено: +20 мин");
    await expect(page.locator(".state")).toHaveText("ИзключеноСроковете са обичайните");
    await expect(page.locator(".kcount")).toHaveText("Обичаен режим");
    await expect(page.locator('.kstrip a.kpill[data-fk="back"]')).toHaveText("Към опашката");
    await expect(page.locator("#h-fx")).toHaveText("Какво ще се промени");
    await expect(page.locator(".fx tbody tr td:first-child")).toHaveText([/^МасаСалон и Градина$/, /^Вземаненай-рано в \d\d:\d\d$/, /^Доставкашофьорът тръгва след това$/]);
    await expect(page.locator(".fx td.now")).toHaveText(["20 мин", "20 мин", "20 мин"]);
    await expect(page.locator(".cust .status")).toHaveText("около 35 мин");
    await expect(page.locator(".cust")).toContainText("В поръчката времето е по квартал, също +20 мин при „Натоварено“ (Дружба 2: около 25 → 45 мин).");
    await expect(page.locator(".cust")).toContainText("При „Натоварено“: „Възможни са закъснения · около 55 мин“");
    await expect(page.locator(".cust .miss")).toHaveText("[ЛИПСВА: норми за време]");
    expect(await status()).toBe("около 35 мин");
    /* on */
    await page.locator("[data-tg]").click();
    await expect(toast(page)).toContainText("Натоварено: +20 мин");
    await expect(toast(page)).toContainText("Новите поръчки и сайтът вече показват по-дълги срокове.");
    await expect(page.locator("section.sw")).toHaveClass(/\bon\b/);
    await expect(page.locator(".state")).toHaveText(/^Включено от \d\d:\d\dВключи: Скара Bertha$/);
    await expect(page.locator("[data-tg]")).toHaveText("Изключи: кухнята се справя");
    await expect(page.locator(".kcount")).toHaveText(/^Натоварено \+20 мин от \d\d:\d\d$/);
    await expect(page.locator("#h-fx")).toHaveText("Новите срокове");
    await expect(page.locator(".fx td.was")).toHaveText(["20 мин", "20 мин", "20 мин"]);
    await expect(page.locator(".fx td.now")).toHaveText(["40 мин+20", "40 мин+20", "40 мин+20"]);
    await expect(page.locator(".cust .status")).toHaveText("Възможни са закъснения · около 55 мин");
    await expect(page.locator(".cust")).toContainText("Беше: „около 35 мин“");
    await expect(page.locator(".lrow").first()).toHaveText(/^\d\d:\d\d - сегаСкара Bertha$/);
    await expect.poll(status).toBe("Възможни са закъснения · около 55 мин");
    /* a new order: the queue shows "+20 мин" on its card */
    const o = await order(ctx.request, "delivery", [{ id: "kebapcheta", q: 1 }]);
    await page.locator('.kstrip a.kpill[data-fk="back"]').click();
    await expect(page).toHaveURL(/\/kuhnya\/$/);
    const card = page.locator('.tk[data-no="' + o.no + '"]');
    await expect(card.locator(".tag.busy")).toHaveText("+20 мин");
    await expect(page.locator('.kstrip a.kpill[data-fk="busy"]')).toHaveText(/^Натоварено \+20 мин от \d\d:\d\d$/);
    /* off again from the key in the queue's row */
    await page.locator('.kstrip a.kpill[data-fk="busy"]').click();
    await page.locator("[data-tg]").click();
    await expect(toast(page)).toContainText("Натоварено е изключено");
    await expect(toast(page)).toContainText("Новите поръчки са с обичайните срокове.");
    await expect(page.locator(".state")).toHaveText("ИзключеноСроковете са обичайните");
    await expect(page.locator(".lrow").first()).toHaveText(/^\d\d:\d\d - \d\d:\d\dСкара Bertha$/);
    await expect.poll(status).toBe("около 35 мин");
    /* the accepted order keeps its deadline */
    const q = (await (await ctx.request.get("/api/kitchen/queue?sec=skara")).json()) as { tickets: { no: string; busyMin: number }[] };
    expect(q.tickets.find((t) => t.no === o.no)!.busyMin).toBe(20);
    /* "Върни" in the notice switches it back on; real time: another tablet switches it off, this screen follows */
    await toast(page).locator("button").click();
    await expect(page.locator("section.sw")).toHaveClass(/\bon\b/);
    await expect.poll(status).toBe("Възможни са закъснения · около 55 мин");
    expect((await ctx.request.put("/api/kitchen/busy", { data: { on: false, sec: "all" } })).status()).toBe(200);
    await expect(page.locator(".state")).toHaveText("ИзключеноСроковете са обичайните");
    await expect(page.locator(".lrow").first()).toHaveText(/^\d\d:\d\d - \d\d:\d\dСкара BerthaИзключи: Главен готвач \(Общ изглед\)$/);
    /* the head chef's view writes "Главен готвач (Общ изглед)" */
    const chef = await tablet(browser, { base: S.base, sec: "all" });
    await chef.page.goto("/kuhnya/natovareno/");
    await expect(chef.page.locator('.ktabs a[aria-current="page"]')).toHaveText("Натоварено");
    await expect(chef.page.locator('.kstrip a.kpill[data-fk="back"]')).toHaveText("Към общия изглед");
    await chef.page.locator("[data-tg]").click();
    await expect(chef.page.locator(".state")).toHaveText(/^Включено от \d\d:\d\dВключи: Главен готвач \(Общ изглед\)$/);
    await chef.page.locator("[data-tg]").click();
    await expect(chef.page.locator(".lrow").first()).toHaveText(/^\d\d:\d\d - \d\d:\d\dГлавен готвач \(Общ изглед\)$/);
    expect(errs).toEqual([]); expect(chef.errs).toEqual([]);
    await chef.ctx.close(); await ctx.close();
  } finally { await S.stop(); }
});

test("@desktop „Изпълнени днес“: a finished order, newest first, „Върни в опашката“ with the notice and „Върни“; a taken order cannot go back", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const a = await order(request, "pickup", [{ id: "ushtiptsi", q: 2 }]);
  const b = await order(request, "delivery", [{ id: "ushtiptsi", q: 1, mods: ["без лук"] }, { id: "pileshko-file", q: 1 }]);
  expect((await kpost(ctx, "orders/" + a.no + "/done", { sec: "skara" })).status).toBe(200);
  expect((await kpost(ctx, "orders/" + b.no + "/done", { sec: "skara" })).status).toBe(200);
  await page.goto("/kuhnya/izpalneni/");
  await expect(page.locator("h1")).toHaveText("Изпълнени днес");
  await expect(page.locator(".klead")).toHaveText("Последните поръчки на Скара Bertha, най-новата горе. Ако нещо е отбелязано по грешка, върни го в опашката.");
  await expect(page.locator('.kstrip a.kpill[data-fk="back"]')).toHaveText("Към опашката");
  const rb = page.locator('.dr[data-no="' + b.no + '"]'), ra = page.locator('.dr[data-no="' + a.no + '"]');
  await expect(rb).toBeVisible(); await expect(ra).toBeVisible();
  /* newest first */
  const order2 = await page.locator(".dr").evaluateAll((l) => l.map((x) => (x as HTMLElement).dataset.no));
  expect(order2.indexOf(b.no)).toBeLessThan(order2.indexOf(a.no));
  await expect(rb.locator(".t")).toHaveText(/^\d\d:\d\dготово$/);
  await expect(rb.locator(".s b")).toHaveText("№ " + b.no);
  await expect(rb.locator(".s small")).toHaveText("Доставка");
  await expect(ra.locator(".s small")).toHaveText("Вземане");
  await expect(rb.locator(".it")).toHaveText("1 × Ущипци без лук, 1 × Пилешко филе");
  await expect(rb.locator(".du")).toHaveText(/^(за \d+ мин|под 1 мин)навреме$/);
  await expect(rb.locator("[data-back]")).toHaveText("Върни в опашката");
  await expect(rb.locator("[data-back]")).toHaveAccessibleName("Върни в опашката: Доставка № " + b.no);
  const n0 = await page.locator(".kcount").textContent();
  expect(n0).toMatch(/^Днес изпълнени \d+Навреме \d+$/);
  /* "Върни в опашката": the row leaves, the order is back in the queue, the notice with "Върни" */
  await rb.locator("[data-back]").click();
  await expect(rb).toHaveCount(0);
  await expect(toast(page)).toContainText("Доставка № " + b.no + " е отново в опашката");
  const inQ = async () => ((await (await ctx.request.get("/api/kitchen/queue?sec=skara")).json()) as { tickets: { no: string }[] }).tickets.some((t) => t.no === b.no);
  await expect.poll(inQ).toBe(true);
  await toast(page).locator("button").click();
  await expect(rb).toBeVisible();
  await expect.poll(inQ).toBe(false);
  /* real time: the whole pickup is ready and taken by the customer: it can no longer go back (the core's 409) */
  const boss = await browser.newContext();
  expect((await boss.request.post("/api/auth/login", { data: { username: "manager", password: E.MANAGER_PASSWORD } })).status()).toBe(200);
  expect((await boss.request.patch("/api/admin/orders/" + a.no, { data: { status: "picked_up" } })).status()).toBe(200);
  await boss.close();
  await expect(ra.locator("[data-back]")).toHaveAttribute("aria-disabled", "true");
  await ra.locator("[data-back]").click({ force: true }); /* aria-disabled: it still answers a touch, with the reason */
  await expect(toast(page)).toContainText("Вземане № " + a.no + " не може да се върне");
  await expect(toast(page)).toContainText("Поръчката вече е взета и не може да се върне в опашката.");
  const r = await kpost(ctx, "orders/" + a.no + "/back", { sec: "skara" });
  expect(r.status).toBe(409);
  await expect(ra).toBeVisible();
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Изпълнени днес“ empty: the polite empty state (a section with nothing done)", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser, { sec: "topla" });
  const d = (await (await ctx.request.get("/api/kitchen/done?sec=topla")).json()) as { rows: unknown[] };
  await page.goto("/kuhnya/izpalneni/");
  if (!d.rows.length) {
    await expect(page.locator(".kempty h2")).toHaveText("Още няма изпълнени поръчки днес");
    await expect(page.locator(".kempty p")).toHaveText("Тук ще виждате последните поръчки, отбелязани с „Готово“.");
    await expect(page.locator(".kcount")).toHaveText("Днес изпълнени 0Навреме 0");
  } else await expect(page.locator(".dr")).toHaveCount(d.rows.length);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Общ изглед“ of the head chef: orders in two sections with their states, the ticking deadline, live; a section's queue from its card; no connection", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser, { sec: "all" });
  const o = await order(request, "delivery", [{ id: "svinski-kyufteta", q: 1 }, { id: "vitaminozna-salata", q: 1 }]);
  expect((await kpost(ctx, "orders/" + o.no + "/start", { sec: "skara" })).status).toBe(200);
  test.setTimeout(60_000); /* offline and back: the probe after "online" can take a while on a busy machine */
  await page.goto("/kuhnya/obsht-izgled/");
  await expect(page.locator(".ksec b")).toHaveText("Главен готвач");
  await expect(page.locator(".ktabs a")).toHaveText(["Общ изглед", /^Изчерпано/, "Натоварено"]);
  await expect(page.locator(".secg .sc .hd")).toHaveText(["Топла кухня", "Скара Bertha", "Пещ за пици", "Салати и студени"]);
  await expect(page.locator(".secg .sc").first().locator("li span")).toHaveText(["Закъсняват", "Наближават", "Най-старата", "Изчерпани днес"]);
  await expect(page.locator('.secg .sc[data-sec="skara"] .tab')).toHaveText(/^(Таблетът работи|без връзка( от \d\d:\d\d)?)$/);
  await expect(page.locator(".kcount")).toHaveText(/^Поръчки в кухнята \d+\s?Закъсняват \d+Изчерпани \d+По-късно \d+$/);
  await expect(page.locator('.kstrip a.kpill[data-fk="busy"]')).toHaveText(/^Натоварено/);
  const row = page.locator('tr[data-row="' + o.no + '"]');
  await expect(row.locator(".src b")).toHaveText("№ " + o.no);
  await expect(row.locator(".src small")).toHaveText("Доставка");
  await expect(row.locator(".sst")).toHaveText(["Скара · готви се", "Салати · чака"]);
  await expect(row.locator(".sst.cook .ic")).toHaveCount(1);
  await expect(row.locator(".tm small")).toHaveText("остават");
  const t0 = await row.locator(".tm").textContent();
  await expect(row.locator(".tm")).not.toHaveText(t0!, { timeout: 3000 }); /* the deadline ticks */
  await expect(page.locator(".legend")).toContainText("Докосни секция, за да видиш опашката ѝ.");
  /* live: the salads finish their part */
  expect((await kpost(ctx, "orders/" + o.no + "/done", { sec: "studeni" })).status).toBe(200);
  await expect(row.locator(".sst")).toHaveText(["Скара · готви се", "Салати · готово"]);
  await expect(row.locator(".sst.done")).toHaveText("Салати · готово");
  /* the card of a section opens its queue (the heartbeat of this tablet stays "Общ изглед") */
  await page.locator('.secg .sc[data-sec="skara"]').click();
  await expect(page).toHaveURL(/\/kuhnya\/#s=skara$/);
  await expect(page.locator(".ksec b")).toHaveText("Скара Bertha");
  await expect(page.locator('.tk[data-no="' + o.no + '"]')).toBeVisible();
  await page.goBack();
  await expect(row).toBeVisible();
  /* no connection: the frame's bar with its own text, the cards say since when there are no data */
  await ctx.setOffline(true);
  await expect(page.locator(".koff")).toBeVisible();
  await expect(page.locator(".koff b").first()).toHaveText("Няма връзка.");
  await expect(page.locator(".koff p").first()).toHaveText(/^Данните за секциите са от \d\d:\d\d и не се обновяват\.$/);
  await expect(page.locator(".secg .sc .tab").first()).toHaveText(/^Няма данни след \d\d:\d\d$/);
  const t1 = await row.locator(".tm").textContent();
  await expect(row.locator(".tm")).not.toHaveText(t1!, { timeout: 3000 });
  await ctx.setOffline(false);
  await expect(page.locator(".koff")).toHaveCount(0, { timeout: 25_000 });
  await expect(page.locator(".secg .sc .tab").first()).not.toHaveText(/Няма данни/);
  expect((await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara" })).status).toBe(200);
  await expect(row).toHaveCount(0);
  expect(errs).toEqual([]);
  await ctx.close();
});

/* the four screens at the three sizes of the prototype, dark and light */
for (const [w, h] of SIZES) for (const theme of ["dark", "light"] as const) {
  test(`@desktop ${w} × ${h} ${theme}: „Изчерпано“, „Натоварено“, „Изпълнени“, „Общ изглед“: no horizontal scroll, targets of 48 px, axe`, async ({ browser, request }) => {
    test.setTimeout(60_000);
    const o = await order(request, "pickup", [{ id: "pileshko-file", q: 1 }, { id: "shopska-salata", q: 1 }]);
    const { ctx, page, errs } = await tablet(browser, { w, h, theme });
    expect((await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara" })).status).toBe(200);
    for (const [path, ready] of [["/kuhnya/izcherpano/", ".tile"], ["/kuhnya/natovareno/", "[data-tg]"], ["/kuhnya/izpalneni/", ".dr"], ["/kuhnya/obsht-izgled/", ".secg .sc"]] as const) {
      await page.goto(path);
      await expect(page.locator(ready).first(), path).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      expect(await overX(page), path).toBeLessThanOrEqual(0);
      expect(await small(page), path).toEqual([]);
      expect(await serious(page), path + " " + theme).toEqual([]);
      /* the text of the screen is 14 px or more */
      const tiny = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".kmain *")].filter((el) => el.offsetParent !== null && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent || "").trim()) && parseFloat(getComputedStyle(el).fontSize) < 14).map((el) => el.className + " " + el.textContent));
      expect(tiny, path).toEqual([]);
    }
    expect(errs).toEqual([]);
    await ctx.close();
  });
}

/* ---------- проверка 2 на кухнята: the behaviours fixed after the reviews (decisions of the chief 18.11) ---------- */
type Lines = { tickets: { no: string; lines: { i: number; ks: string; out: boolean }[] }[] };
const queueOf = async (ctx: BrowserContext, sec = "skara") => (await (await ctx.request.get("/api/kitchen/queue?sec=" + sec)).json()) as Lines;
async function hold(page: Page, sel: string) {
  await page.locator(sel).scrollIntoViewIfNeeded();
  const b = (await page.locator(sel).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.waitForTimeout(1150); await page.mouse.up();
}
const card = (page: Page, no: string) => page.locator('.tk[data-no="' + no + '"]');

test("@desktop two outages in a row with nothing pressed: the bar goes away each time and new orders still come (review 2, blocking 1)", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const { ctx, page, errs } = await tablet(browser);
  await page.goto("/kuhnya/");
  await expect(page.locator(".kcount")).toContainText("Чакат");
  for (let n = 0; n < 3; n++) {
    await ctx.setOffline(true);
    await expect(page.locator(".koff")).toBeVisible();
    await page.waitForTimeout(1500);
    await ctx.setOffline(false);
    await expect(page.locator(".koff"), "outage " + (n + 1)).toHaveCount(0, { timeout: 12_000 });
    await expect(page.locator(".net")).toHaveText("Онлайн");
  }
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }]);
  await expect(card(page, o.no)).toBeVisible({ timeout: 10_000 });
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop an action kept offline that another tablet overtook is refused and said; the tablet shows the new state (review 2, important 1)", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const { ctx, page, errs } = await tablet(browser);
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }]);
  await page.goto("/kuhnya/");
  await expect(card(page, o.no)).toBeVisible();
  await ctx.setOffline(true);
  await expect(page.locator(".koff")).toBeVisible();
  await hold(page, '.tk[data-no="' + o.no + '"] [data-done]');           /* tablet A: "Готово", kept on the tablet */
  await expect(card(page, o.no)).toHaveCount(0);
  await page.waitForTimeout(300);
  /* tablet B (online): "Готово", then "Върни" (it was not right after all) */
  expect((await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara", saw: { 0: "wait" } })).status).toBe(200);
  expect((await kpost(ctx, "orders/" + o.no + "/back", { sec: "skara", saw: { 0: "ready" } })).status).toBe(200);
  await ctx.setOffline(false);
  await expect(page.locator(".koff")).toHaveCount(0, { timeout: 12_000 });
  await expect(toast(page)).toContainText("Едно действие не се записа");
  await expect(toast(page)).toContainText("Друг таблет промени поръчката.");
  await expect(card(page, o.no)).toBeVisible(); /* the new state: back in the queue */
  expect((await queueOf(ctx)).tickets.find((t) => t.no === o.no)!.lines[0].ks).not.toBe("ready");
  expect(await page.evaluate(() => localStorage.getItem("sk-outbox"))).toBeNull();
  expect(errs).toEqual([]);
  expect((await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara" })).status).toBe(200);
  await ctx.close();
});

test("@desktop a touch made while the kept actions are on their way is sent too, nothing stays on the tablet (review 2, important 2)", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const { ctx, page, errs } = await tablet(browser);
  const a = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }, { id: "svinski-vrat", q: 1 }]);
  const b = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }, { id: "svinski-vrat", q: 1 }]);
  await page.goto("/kuhnya/");
  await expect(card(page, b.no)).toBeVisible();
  await ctx.setOffline(true);
  await expect(page.locator(".koff")).toBeVisible();
  await card(page, a.no).locator(".ln").first().click();
  /* the connection comes back slowly: every action of the kitchen takes 1,5 s */
  await page.route("**/api/kitchen/orders/**", async (r) => { await new Promise((x) => setTimeout(x, 1500)); await r.continue(); });
  await ctx.setOffline(false);
  await page.waitForTimeout(400);
  await card(page, b.no).locator(".ln").first().click();               /* while the bar still says "Няма връзка" */
  await expect(page.locator(".koff")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => localStorage.getItem("sk-outbox")), { timeout: 10_000 }).toBeNull();
  await expect.poll(async () => (await queueOf(ctx)).tickets.find((t) => t.no === b.no)!.lines[0].ks, { timeout: 10_000 }).toBe("ready");
  expect((await queueOf(ctx)).tickets.find((t) => t.no === a.no)!.lines[0].ks).toBe("ready");
  await page.unroute("**/api/kitchen/orders/**");
  for (const no of [a.no, b.no]) await kpost(ctx, "orders/" + no + "/done", { sec: "skara" });
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Изчерпано“ after „Започни“: the line being cooked is made and stays in the bill; only the waiting lines are marked (review 2, blocking 2)", async ({ browser, request }) => {
  const DISH = "teleshki-sudzhuk";
  const { ctx, page, errs } = await tablet(browser);
  await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "skara" } });
  const cooking = await order(request, "delivery", [{ id: DISH, q: 1 }]);
  expect((await kpost(ctx, "orders/" + cooking.no + "/start", { sec: "skara" })).status).toBe(200);
  const waiting = await order(request, "pickup", [{ id: DISH, q: 1 }]);
  await page.goto("/kuhnya/izcherpano/");
  await page.locator('.tile[data-id="' + DISH + '"]').click();
  await expect(toast(page)).toContainText(/В \d+ приет(а|и) поръчк(а|и) · известихме управителя\./);
  const q = await queueOf(ctx);
  expect(q.tickets.find((t) => t.no === cooking.no)!.lines[0]).toMatchObject({ ks: "cook", out: false });
  expect(q.tickets.find((t) => t.no === waiting.no)!.lines[0]).toMatchObject({ ks: "wait", out: true });
  /* back in the menu: the mark goes */
  await page.locator(".orow", { hasText: "Телешки суджук" }).locator("[data-back]").click();
  await expect.poll(async () => (await queueOf(ctx)).tickets.find((t) => t.no === waiting.no)!.lines[0].out).toBe(false);
  for (const no of [cooking.no, waiting.no]) await kpost(ctx, "orders/" + no + "/done", { sec: "skara" });
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop „Готово“ with the keyboard: the focus goes to „Върни“ in the notice (one key), then to the next card (review 2, important 5)", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser);
  const o = await order(request, "pickup", [{ id: "kebapcheta", q: 1 }]);
  await page.goto("/kuhnya/");
  await expect(card(page, o.no)).toBeVisible();
  await card(page, o.no).locator("[data-done]").focus();
  await page.keyboard.press("Enter");
  await expect(card(page, o.no)).toHaveCount(0);
  await expect(toast(page).locator("button")).toBeFocused();
  await expect(toast(page).locator("button")).toHaveAccessibleName("Върни");
  /* one live region; the seconds are not read aloud */
  expect(await page.locator(".kt[role=status]").count()).toBe(0);
  await page.keyboard.press("Enter");
  await expect(card(page, o.no)).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.tagName)).not.toBe("BODY");
  await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara" });
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the head chef on a section's queue: „Общ изглед“ in the row; „Натоварено“ for 60+ min reminds on the key of the queue and of „Общ изглед“ (review 1)", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser, { sec: "all" });
  /* the core's flag (unit-tested with the clock): here the answer says it has been on for 60+ min */
  await page.route("**/api/kitchen/queue?*", async (r) => {
    const res = await r.fetch(), j = await res.json();
    j.busy = { ...j.busy, on: true, at: new Date(Date.now() - 61 * 60_000).toISOString(), atHm: "18:00", by: "Кухня · Скара", extra: 20, remind: true };
    await r.fulfill({ response: res, json: j });
  });
  await page.goto("/kuhnya/#s=pesht");
  await expect(page.locator(".ksec b")).toHaveText("Пещ за пици");
  const busy = page.locator('.kstrip a.kpill[data-fk="busy"]');
  await expect(busy).toHaveText("Натоварено +20 мин · 60+ мин");
  await expect(busy).toHaveClass(/\bremind\b/);
  const back = page.locator('.kstrip a.kpill[data-fk="back"]');
  await expect(back).toHaveText("Общ изглед");
  await back.click();
  await expect(page).toHaveURL(/\/kuhnya\/obsht-izgled\/$/);
  await expect(page.locator('.kstrip a.kpill[data-fk="busy"]')).toHaveClass(/\bremind\b/);
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop 1024, the evening rush: „Нова“, „По-късно“, „Звук“ and „Натоварено · 60+ мин“ stay on one row (review 1, round 2)", async ({ browser, request }) => {
  const { ctx, page, errs } = await tablet(browser, { w: 1024, h: 768 });
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }]);
  await page.route("**/api/kitchen/queue?*", async (r) => {
    const res = await r.fetch(), j = await res.json();
    j.busy = { ...j.busy, on: true, atHm: "18:00", extra: 20, remind: true };
    j.later = [{ no: "9999", kind: "pickup", src: { kind: "pickup", k: "Вземане", t: "№ 9999", text: "Вземане № 9999", who: "клиента", zone: "", table: null, tableNo: null }, forAt: Date.now() + 3600e3, forHm: "21:00", enter: Date.now() + 2400e3, enterHm: "20:40", tomorrow: false, lines: [] }];
    await r.fulfill({ response: res, json: j });
  });
  await page.goto("/kuhnya/");
  await expect(card(page, o.no)).toBeVisible();
  await page.locator("[data-clock]").click();
  await expect(page.locator("[data-sound]")).toHaveText("Звук вкл.");
  await expect(page.locator(".knew")).toBeVisible();
  await expect(page.locator('.kstrip [data-fk="busy"]')).toHaveClass(/\bremind\b/);
  /* offsetTop: the layout, not the entrance animation of "Нова" (a transform) */
  const tops = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".kstrip > *:not(.kcount)")].map((e) => e.offsetTop + Math.round(e.offsetHeight / 2)));
  expect(tops.length).toBe(4);
  expect(new Set(tops).size).toBe(1);
  expect(errs).toEqual([]);
  await kpost(ctx, "orders/" + o.no + "/done", { sec: "skara" });
  await ctx.close();
});

/* ---------- кръг 3: a sold-out line waits for a decision (decision of the chief 18.11) ---------- */
async function signedCtx(browser: Browser, username: string, password: string, vp = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport: vp });
  expect((await ctx.request.post("/api/auth/login", { data: { username, password } })).status(), "sign-in " + username).toBe(200);
  return ctx;
}

test("@desktop a delivery with a sold-out dish: „Започни“ and „Готово“ leave it, the card says it waits; the manager „Приеми без него“ after „Започни“ makes it „Готова“", async ({ browser, request }) => {
  test.setTimeout(90_000);
  const DISH = "teleshki-sudzhuk";
  const { ctx, page, errs } = await tablet(browser);
  await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "skara" } });
  const o = await order(request, "delivery", [{ id: "kebapcheta", q: 1 }, { id: DISH, q: 1 }]);
  try {
    expect((await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: true, sec: "skara" } })).status()).toBe(200);
    await page.goto("/kuhnya/");
    const c = card(page, o.no);
    await expect(c.locator(".ln.outwait")).toContainText("Изчерпано днес · чака решение");
    await expect(c.locator(".ln.outwait")).not.toHaveAttribute("data-ln", /./);
    await c.locator("[data-start]").click();
    await hold(page, '.tk[data-no="' + o.no + '"] [data-done]');
    await expect(toast(page)).toContainText("В поръчката има изчерпано ястие: чака решение.");
    await expect(c).toBeVisible();
    await expect(c.locator(".ln").first()).toHaveClass(/\bdone\b/);
    expect((await queueOf(ctx)).tickets.find((t) => t.no === o.no)!.lines.map((l) => [l.ks, l.out])).toEqual([["ready", false], ["wait", true]]);
    /* the manager decides in "Сега" (the problem stays after "Започни") */
    const m = await signedCtx(browser, "manager", E.MANAGER_PASSWORD), mp = await m.newPage();
    await mp.goto("/upravitel/?preview=1&t=19:42");
    await expect(mp.locator("[data-upscr]")).toBeVisible();
    const more = mp.locator('[data-a="allp"]'); if (await more.count()) await more.click();
    const prob = mp.locator('.mg-prob[data-key="out:' + o.no + '"]');
    await expect(prob).toContainText("в кухнята");
    await prob.locator('[data-a="without"]').click();
    await expect(prob).toHaveCount(0);
    /* the kitchen: the card leaves by itself, the order is "Готова" without the dish */
    await expect(c).toHaveCount(0);
    await expect.poll(async () => ((await (await ctx.request.get("/api/kitchen/done?sec=skara")).json()) as { rows: { no: string }[] }).rows.some((r) => r.no === o.no)).toBe(true);
    await m.close();
    expect(errs).toEqual([]);
  } finally {
    await ctx.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "skara" } });
    await ctx.close();
  }
});

test("@desktop a table: the kitchen cannot finish an order with a sold-out dish; the waiter „Махни“ in the table screen and it is „Готова“", async ({ browser }) => {
  test.setTimeout(90_000);
  const DISH = "kapreze-s-beybi-motsarela", N = 18, CL = { "x-sc-clock": "19:30" };
  const k = await signedCtx(browser, "kitchen", E.KITCHEN_PASSWORD);
  const w = await signedCtx(browser, "waiter", E.WAITER_PASSWORD, { width: 390, height: 844 });
  const free = async () => {
    const d = await (await w.request.get("/api/floor/table/" + N, { headers: CL })).json();
    if (!d.session) return;
    if (d.pending) await w.request.post("/api/floor/table/" + N + "/qr/reject", { headers: CL, data: { reason: "test" } });
    if (d.rest > 0) await w.request.post("/api/floor/table/" + N + "/pay", { headers: CL, data: { how: "cash" } });
    await w.request.post("/api/floor/table/" + N + "/close", { headers: CL, data: { force: true } });
  };
  await k.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "studeni" } });
  await free();
  try {
    const r = await w.request.post("/api/floor/table/" + N + "/order", { headers: CL, data: { lines: [{ id: DISH, q: 1 }, { id: "salata-sirakuza", q: 1 }] } });
    expect(r.status(), await r.text()).toBe(201);
    const no = ((await r.json()) as { bills: { orders: { no: string }[] }[] }).bills[0].orders.slice(-1)[0].no;
    expect((await k.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: true, sec: "studeni" } })).status()).toBe(200);
    expect((await k.request.post("/api/kitchen/orders/" + no + "/start", { data: { sec: "studeni" } })).status()).toBe(200);
    const done = await (await k.request.post("/api/kitchen/orders/" + no + "/done", { data: { sec: "studeni" } })).json();
    expect(done).toMatchObject({ status: "cooking", msg: "В поръчката има изчерпано ястие: чака решение." });
    /* the waiter's table screen: the line says the kitchen waits, "Махни" */
    const page = await w.newPage(), errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto("/servitor/masa/?preview=1&t=19:30#" + N);
    const drop = page.locator("[data-outdrop]");
    await expect(drop).toHaveCount(1);
    await expect(page.locator(".oline", { has: drop })).toContainText("Изчерпано днес · кухнята чака решение");
    await drop.click();
    await expect(page.locator(".st-toast.on")).toContainText("Махнато от поръчката. Кухнята не го чака.");
    await expect(page.locator("[data-outdrop]")).toHaveCount(0);
    /* the order is "Готова": the waiter has the salad in "Готови", the kitchen no longer has it */
    await expect.poll(async () => ((await (await k.request.get("/api/kitchen/queue?sec=studeni")).json()) as { tickets: { no: string }[] }).tickets.some((t) => t.no === no)).toBe(false);
    await expect(page.locator("[data-serve]")).toHaveCount(1);
    expect(errs).toEqual([]);
  } finally {
    await k.request.put("/api/kitchen/sold-out/" + DISH, { data: { out: false, sec: "studeni" } });
    await free();
    await k.close(); await w.close();
  }
});
