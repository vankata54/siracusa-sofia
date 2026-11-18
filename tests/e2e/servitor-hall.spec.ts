import { test, expect } from "@playwright/test";
import { admin, newWaiter, signInCtx, startShift, endShift, guest, freeTable, errors, serious, ready, layout, rnd } from "./servitor-helpers.ts";
import { floorLock } from "./_floor-lock.ts";
import { dbPut } from "./own-server.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* "Залата" of the waiter (/servitor/; design/pages-servitor/tables.html) on the real server: the counters, "Чакат сега"
   live from a guest's call, "Отивам" → "Обслужено" (+ "Отмени"), the tiles of my tables and of the whole hall, the search
   (tables, an order, "лук", "без лук", "изчерпано"), "Нова резервация" (errors under the fields, success with "Отмени"),
   no connection (the whole screen, the last data, actions that say why they wait), the layout at 360 and 390 in both
   themes. Each test has its own waiter and its own tables (the tests run in parallel on one database). */
test.describe.configure({ mode: "serial" });

test("@phone a guest calls: the strip comes live, „Отивам“ → „Обслужено“ with „Отмени“, the guest's call is served and cools down", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 1); await freeTable(a, 2);
  await startShift(w, [1]);
  try {
    await signInCtx(context, w);
    await page.goto("/servitor/");
    await ready(page);
    await expect(page.locator(".st-top [data-sub]")).toHaveText(new RegExp("^" + w.name + " · от \\d\\d:\\d\\d$"));
    await expect(page.locator("main .st-h h2").first()).toHaveText(/Моите маси|Чакат сега/);
    const myTile = page.locator('main .tgrid a.tile[href="/servitor/masa/#1"]').first();
    await expect(myTile).toHaveAccessibleName(/^Маса 1 Салон Моя Свободна$/);
    await expect(myTile.locator(".own")).toHaveText("Моя");
    await expect(myTile.locator(".own")).toBeVisible();
    /* the guests at table 1 ask for the bill, at table 2 (nobody's) for water: both come without a reload */
    const g1 = await guest(a, 1), g2 = await guest(a, 2);
    expect((await g1.call("bill")).status).toBe(200);
    expect((await g2.call("water")).status).toBe(200);
    const s1 = page.locator(".cstrip", { has: page.locator('a.tx[href="/servitor/masa/#1"]') });
    await expect(s1).toBeVisible();
    await expect(s1.locator("small")).toContainText("Сметка · моя маса");
    await expect(s1.locator(".tm")).toHaveText(/^\d+:\d\d$/);
    const s2 = page.locator(".cstrip", { has: page.locator('a.tx[href="/servitor/masa/#2"]') });
    await expect(s2.locator("small")).toContainText("Вода / прибори · без сервитьор");
    /* my table first among the ones that wait the same */
    await expect(myTile).toHaveAccessibleName(/^Маса 1 Салон Моя Чака Сметка чака \d+:\d\d$/);
    await expect(myTile).toHaveClass(/\bbill\b/);
    await expect(myTile.locator(".tm")).toHaveText(/^чака \d+:\d\d$/);
    /* the strip is a 56 px target without its button */
    expect((await s1.locator("a.tx").boundingBox())!.height).toBeGreaterThanOrEqual(56);
    /* ONE queue number: the counter and the badge */
    const one = await page.evaluate(() => [document.querySelector(".sum a b")!.textContent, document.querySelector('.st-nav [data-cnt="calls"] [data-n]')!.textContent]);
    expect(one[0]).toBe(one[1]);
    expect(+one[0]!).toBeGreaterThanOrEqual(2);
    /* "Отивам" from the keyboard: the colleagues see who took it, the focus moves to "Обслужено" of the same strip */
    await s1.locator("button", { hasText: "Отивам" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".st-toast")).toHaveText("Маса 1: отивам. Колегите виждат, че масата е поета.");
    await expect(s1.locator("button", { hasText: "Обслужено" })).toBeFocused();
    await expect(s1).toHaveClass(/taken/);
    await expect(s1.locator("small")).toContainText("Сметка · отивам");
    const hall = await (await a.get("/api/floor/hall")).json();
    expect(hall.calls.find((c: { table: { n: number }; kind: string }) => c.table.n === 1 && c.kind === "bill").taken.name).toBe(w.name);
    /* "Обслужено" with "Отмени" (the call waits again), then "Обслужено" for good */
    await page.keyboard.press("Enter");
    await expect(page.locator(".st-toast span")).toHaveText("Маса 1: обслужено");
    await expect(s1).toHaveCount(0);
    /* the strip went away: the focus is on the next call's button (Маса 2), never on the page */
    await expect(page.locator(".cstrip", { has: page.locator('a.tx[href="/servitor/masa/#2"]') }).locator("button")).toBeFocused();
    await page.locator(".st-toast button", { hasText: "Отмени" }).click();
    await expect(s1).toBeVisible();
    await s1.locator("button").click();
    await expect(s1).toHaveCount(0);
    /* the guest's tile: the same call is cooling down (settings.callCooldown minutes after "Обслужено") */
    const v = await g1.post("view");
    expect(v.body.calls.state.bill.state).toBe("cool");
    expect(Date.parse(v.body.calls.state.bill.until) - Date.now()).toBeGreaterThan(60_000);
    expect((await g1.call("bill")).body.error).toBe("call_cooldown");
    /* the tile of table 2 in "Цялата зала" */
    const t2 = page.locator('#zala a.tile[href="/servitor/masa/#2"]');
    await expect(t2).toHaveClass(/\bcall\b/);
    await expect(t2.locator(".w")).toContainText("Вода / прибори");
    expect(await serious(page)).toEqual([]);
    /* the manager gives me table 2: said in a toast, the tile is mine at once */
    expect((await a.post("/api/floor/shift/tables", { data: { who: w.username, tables: [1, 2] } })).status()).toBe(200);
    await expect(page.locator(".st-toast")).toHaveText("Управителят ти даде Маса 2.");
    await expect(page.locator('main .tgrid a.tile[href="/servitor/masa/#2"]').first().locator(".own")).toHaveText("Моя");
    expect(errs).toEqual([]);
  } finally { await endShift(w); await freeTable(a, 1); await freeTable(a, 2); }
});

test("@phone 360 and 390, light and dark: no horizontal scroll, text of 14 px and more, targets of 48 px, axe", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 3);
  await startShift(w, [3]);
  const g = await guest(a, 3); await g.call("order");
  try {
    await signInCtx(context, w);
    for (const [wd, h, theme] of [[390, 844, "light"], [390, 844, "dark"], [360, 740, "light"], [360, 740, "dark"]] as const) {
      await page.setViewportSize({ width: wd, height: h });
      await page.addInitScript((t) => { localStorage.setItem("st-prefs", JSON.stringify({ theme: t })); }, theme);
      for (const path of ["/servitor/", "/servitor/povikvania/", "/servitor/gotovi/"]) {
        await page.goto(path);
        await ready(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await layout(page, path + " " + wd + " " + theme);
        expect(await serious(page), path + " " + wd + " " + theme).toEqual([]);
      }
    }
    expect(errs).toEqual([]);
  } finally { await endShift(w); await freeTable(a, 3); }
});

test("@desktop 1440: the hall stays a phone column", async ({ page, context }) => {
  const a = await admin(), w = await newWaiter(a);
  await signInCtx(context, w);
  await page.goto("/servitor/");
  await ready(page);
  const g = await page.evaluate(() => ({ app: document.querySelector(".st-app")!.getBoundingClientRect().width, over: document.documentElement.scrollWidth - innerWidth }));
  expect(g.app).toBe(430);
  expect(g.over).toBeLessThanOrEqual(0);
  /* not on shift: no tables of mine, the way to start the shift */
  await expect(page.locator("main .notice", { hasText: "Не си на смяна." })).toBeVisible();
  await expect(page.locator('main a[href="/servitor/vhod/#shift"]')).toHaveText("Започни смяната");
  expect(await serious(page)).toEqual([]);
});

test("@phone the search: a table, „свободни“, an order by its number and by a dish, „лук“, „без лук“, „изчерпано“", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 11);
  await startShift(w, [11]);
  const o = await (await w.api.post("/api/floor/table/11/order", { data: { lines: [{ id: "pitsa-margarita", q: 1 }] } })).json();
  const no = o.orders[0] as string;
  const out = "tiramisu";
  expect((await a.put("/api/admin/menu/" + out + "/sold-out", { data: { out: true } })).status()).toBe(200);
  try {
    await signInCtx(context, w);
    await page.goto("/servitor/");
    await ready(page);
    await page.locator(".st-findfield").click();
    const dlg = page.locator(".st-find.on"), inp = dlg.locator("#fq");
    await expect(inp).toBeFocused();
    await expect(dlg.locator(".fscope")).toContainText("Търсиш само в своето");
    await inp.fill("11");
    const grp = (t: string) => dlg.locator(".fgrp", { has: page.locator("h3", { hasText: new RegExp("^" + t) }) });
    await expect(grp("Маси").locator("a.frow").first()).toContainText("Маса 11 · Салон");
    await expect(grp("Маси").locator("a.frow").first()).toContainText("Моя маса");
    await expect(grp("Маси").locator("a.frow").first()).toHaveAttribute("href", "/servitor/masa/#11");
    await inp.fill(no);
    await expect(grp("Поръчки").locator("a.frow").first()).toContainText("№\u00a0" + no + " · Маса 11");
    await expect(grp("Поръчки").locator(".stt")).toContainText("Готви се");
    await inp.fill("маргарита");
    await expect(grp("Поръчки")).toContainText("№\u00a0" + no);
    await expect(grp("Ястия").locator("a.frow").first()).toContainText("Маргарита");
    await expect(grp("Ястия").locator("a.frow").first()).toHaveAttribute("href", /\/servitor\/porachka\/#q=/);
    await inp.fill("свободни");
    await expect(grp("Маси").locator(".stt.free").first()).toBeVisible();
    await inp.fill("лук");
    await expect(dlg.locator(".fband").first()).toHaveText("Съдържат лук");
    await expect(dlg.locator('.fchips [data-tog="лук"]')).toBeVisible();
    await dlg.locator('.fchips [data-tog="лук"]').click();
    await expect(inp).toHaveValue("без лук");
    await expect(dlg.locator(".fgrp h3").first()).toContainText("Ястия без лук");
    await expect(dlg.locator(".fband.unk")).toHaveText("Нямаме пълен състав: питай кухнята, преди да кажеш на госта.");
    await inp.fill("изчерпано");
    await expect(grp("Изчерпано днес").locator(".out-b").first()).toHaveText("Изчерпано днес");
    await inp.fill("zzzqqq");
    await expect(dlg.locator(".fempty h3")).toHaveText("Няма „zzzqqq“");
    expect(await serious(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.locator(".st-find")).toHaveCount(0);
    expect(errs).toEqual([]);
  } finally {
    await a.put("/api/admin/menu/" + out + "/sold-out", { data: { out: false } });
    await endShift(w); await freeTable(a, 11);
  }
});

test("@phone „Нова резервация“: errors under the fields, only free tables, success with „Отмени“", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await signInCtx(context, w);
  await page.goto("/servitor/");
  await ready(page);
  await page.locator("[data-newres]").click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator("h2")).toHaveText("Нова резервация");
  await sh.locator("[data-day]").nth(1).click();
  await expect(sh.locator("[data-day]").nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(sh.locator("#rat option").first()).toHaveText("11:00");
  await expect(sh.locator("#rat option").last()).toHaveText("21:30");
  await sh.locator("#rat").selectOption({ label: "20:30" });
  await expect(sh.locator("[data-rt]").first()).toBeVisible();
  /* over 6: the manager joins tables */
  for (let i = 0; i < 10; i++) await sh.locator('[data-n="1"]').click();
  await expect(sh.locator("output")).toHaveText("12");
  await expect(sh.locator('[data-n="1"]')).toBeDisabled();
  await expect(sh).toContainText("Повече от 12 души: празник, през управителя.");
  for (let i = 0; i < 10; i++) await sh.locator('[data-n="-1"]').click();
  await expect(sh.locator("output")).toHaveText("2");
  await page.locator("[data-rsave]").click();
  await expect(sh.locator("#e-t")).toHaveText("Избери маса.");
  await expect(sh.locator("#e-name")).toHaveText("Напиши името на госта.");
  await expect(sh.locator("#e-phone")).toHaveText("Напиши телефона на госта.");
  const chip = sh.locator("[data-rt]").first(), n = /\d+/.exec((await chip.textContent())!)![0];
  await expect(chip).toHaveAccessibleName(new RegExp("^Маса " + n + " (Салон|Градина) · \\d+ места$"));
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  const name = "Гост " + rnd();
  await sh.locator("#rname").fill(name);
  await sh.locator("#rph").fill("123");
  await page.locator("[data-rsave]").click();
  await expect(sh.locator("#e-phone")).toHaveText("Провери номера: например 0888 12 34 56.");
  await expect(sh.locator("#rph")).toBeFocused();
  await expect(sh.locator("#rph")).toHaveAttribute("aria-invalid", "true");
  await sh.locator("#rph").fill("0888 12 34 56");
  await sh.locator("#rnote").fill("Детско столче");
  expect(await serious(page)).toEqual([]);
  await page.locator("[data-rsave]").click();
  const t = page.locator(".st-toast");
  await expect(t.locator("span")).toHaveText(new RegExp("^Резервация: Маса " + n + " · .+ · 20:30$"));
  await expect(page.locator(".st-sheetwrap.on")).toHaveCount(0);
  /* in the admin it is "Потвърдена", without the marketing consent; "Отмени" makes it "Отказана" */
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(Date.now() + 864e5));
  const day = await (await a.get("/api/admin/reservations/day?date=" + tomorrow + "&status=all")).json();
  const r = day.rows.find((x: { name: string }) => x.name === name);
  expect(r.status).toBe("confirmed");
  expect(r.note).toBe("Детско столче");
  await t.locator("button", { hasText: "Отмени" }).click();
  await expect(t).toHaveText("Резервацията е отменена.");
  const all = await (await a.get("/api/admin/reservations/day?date=" + tomorrow + "&status=cancelled")).json();
  expect(all.rows.some((x: { name: string }) => x.name === name)).toBe(true);
  expect(errs).toEqual([]);
});

test("@phone no connection: the whole screen with the steps, „Виж последните данни“: frozen timers, „Отивам“ says why", async ({ page, context }) => {
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 3);
  await startShift(w, [3]);
  const g = await guest(a, 3); await g.call("other");
  try {
    await signInCtx(context, w);
    await page.goto("/servitor/");
    await ready(page);
    const s3 = page.locator(".cstrip", { has: page.locator('a.tx[href="/servitor/masa/#3"]') });
    await expect(s3).toBeVisible();
    await context.setOffline(true);
    const off = page.locator(".st-app > .offline");
    await expect(off.locator("h2")).toHaveText("Няма връзка с ресторанта");
    await expect(page.locator(".st-findfield")).toBeHidden();
    await off.locator('[data-act="cached"]').click();
    await expect(page.locator("[data-stale] .notice")).toContainText("Последни данни от");
    const tm = s3.locator(".tm"), frozen = await tm.textContent();
    const go = s3.locator("button", { hasText: "Отивам" });
    await expect(go).toHaveAttribute("aria-disabled", "true");
    await go.click({ force: true });
    await expect(page.locator(".st-toast")).toHaveText("Без връзка колегите няма да видят. Опитай, щом връзката се върне.");
    await page.waitForTimeout(2200);
    expect(await tm.textContent()).toBe(frozen);
    await expect(page.locator(".st-nav")).toHaveClass(/stale/);
    await context.setOffline(false);
    await expect(page.locator(".st-net")).toBeHidden({ timeout: 20_000 });
    await expect(s3.locator("button", { hasText: "Отивам" })).not.toHaveAttribute("aria-disabled", "true");
  } finally { await endShift(w); await freeTable(a, 3); }
});

test("@phone the search never finds a reservation by the phone (not even the whole number); the name finds it, the phone stays masked", async ({ page, context }) => {
  const a = await admin(), w = await newWaiter(a);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
  const name = "Гост " + rnd(), phone = "0889" + String(100000 + Math.floor(Math.random() * 899999));
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number);
  /* a booking for today at the last hour. The admin's check of a past hour follows the real clock: after 21:30 the
     booking goes straight into the test database (the search reads it the same way) */
  const r = await a.post("/api/admin/reservations/new", { data: { date: today, time: "21:30", people: 2, name, phone } });
  let id: string;
  if (r.status() === 422 && ((await r.json()) as { fields?: { time?: string } }).fields?.time) {
    id = "e2e" + rnd();
    const now = new Date().toISOString();
    dbPut("data/e2e-" + (process.env.E2E_PORT || 8788) + ".db", "reservations", { id, date: today, time: "21:30", people: 2, table: null, zone: null, name, phone, marketing: false, status: "confirmed", createdAt: now, updatedAt: now, dur: 120, key: "k" + rnd() },
      { date: today, time: "21:30", table_id: null, phone, status: "confirmed" });
  } else {
    expect(r.status(), "booking at " + hm.join(":")).toBeLessThan(300);
    id = (await r.json()).id as string;
  }
  try {
    /* through the API: a part of the hidden middle never matches, the whole number does and comes back masked */
    const find = async (q: string) => ((await (await w.api.get("/api/staff/search?q=" + encodeURIComponent(q))).json()) as { reservations: { name: string; phone: string }[] }).reservations.filter((x) => x.name === name);
    for (const part of [phone.slice(0, 5), phone.slice(0, 6), phone.slice(2, 8), phone.slice(0, 9), phone.slice(4)]) expect(await find(part), part).toEqual([]);
    expect(await find(phone.slice(0, 4) + " " + phone.slice(4, 6) + " " + phone.slice(6, 8) + " " + phone.slice(8))).toEqual([]);
    expect(await find("+359" + phone.slice(1))).toEqual([]);
    const hit = await find(name);
    expect(hit.length).toBe(1);
    expect(hit[0].phone).not.toContain(phone.slice(4, 8));
    /* on the screen */
    await signInCtx(context, w);
    await page.goto("/servitor/");
    await ready(page);
    await page.locator(".st-findfield").click();
    const dlg = page.locator(".st-find.on"), inp = dlg.locator("#fq");
    await inp.fill(phone.slice(0, 7));
    await expect(dlg.locator(".fgrp, .fempty").first()).toBeVisible();
    await expect(dlg).not.toContainText(name);
    await inp.fill(phone);
    await expect(dlg.locator(".fgrp, .fempty").first()).toBeVisible();
    await expect(dlg).not.toContainText(name);
    await inp.fill(name);
    await expect(dlg.locator("button.frow", { hasText: name })).toBeVisible();
    await expect(dlg.locator("button.frow", { hasText: name })).not.toContainText(phone.slice(4, 8));
  } finally { await a.post("/api/admin/reservations/" + id + "/status", { data: { status: "cancelled" } }); }
});
