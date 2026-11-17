import { test, expect } from "@playwright/test";
import { CLOCK, PV, codeOf, phone, staff, tableN, watch, guest, tok } from "./masa-helpers.ts";
import { E } from "./own-server.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* QR маса: the whole flow with TWO phones (two browser contexts) on the real server: both add to the shared cart, one
   changes the other's line, "Изпрати към сервитьора" waits, the waiter confirms (a third context, signed in as the
   waiter), the kitchen starts and finishes, "Сервирах": the phones see Прието → Готви се → Сервирано without a reload;
   the next order goes straight to the kitchen; a rejection with its reason and "Разбрах". */
test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD || !E.WAITER_PASSWORD || !E.KITCHEN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("two phones: the shared cart, the waiter confirms, the kitchen cooks, „Сервирах“, the next order to the kitchen", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const errs = watch(page);
  const n = tableN(page, 0), t = await codeOf(browser, baseURL!, n);
  const p2 = await phone(browser, page, baseURL!);
  const W = await staff(browser, baseURL!, "waiter"), K = await staff(browser, baseURL!, "kitchen");
  await W.clear(n);
  try {
    /* the first scan opens the sitting: phone 1 and phone 2 */
    await page.goto("/masa/" + t.code + "/" + PV);
    await expect(page.locator(".wl-t")).toHaveText("Маса " + n);
    await expect(page.locator("[data-mtab]")).toContainText("Маса " + n + " · " + (t.zone === "garden" ? "Градина" : "Салон"));
    await expect(page.locator(".wl-lead")).toContainText("Поръчайте от телефона");
    await p2.page.goto("/masa/" + t.code + "/" + PV);
    await expect(p2.page.locator(".now b")).toHaveText(/На масата: Вие, Телефон \d/);
    await expect(page.locator(".now b")).toHaveText(/На масата: Вие, Телефон \d/); /* live on phone 1 */

    /* the menu: "+" fills the SHARED cart; the other phone sees who added it, live */
    await page.goto("/masa/" + t.code + "/menu/" + PV);
    await p2.page.goto("/masa/" + t.code + "/menu/" + PV);
    await page.locator('[data-row="pitsa-margarita"] [data-madd]').click();
    await expect(page.locator(".toast")).toContainText("Добавено в общата количка");
    await expect(page.locator("[data-mnav] [data-mcnt], [data-mdnav] [data-mcnt]").filter({ visible: true })).toHaveText("1");
    const row2 = p2.page.locator('[data-row="pitsa-margarita"]');
    await expect(row2.locator(".incart")).toContainText(/В количката:\d?Телефон \d/);
    await expect(p2.page.locator(".toast")).toContainText("добави Пица Маргарита");
    await expect(p2.page.locator("[data-cbar]")).toContainText("1 ястие");
    await expect(p2.page.locator("[data-cgo]")).toContainText("Към количката · 7,15 €");
    await p2.page.locator('[data-row="kebapcheta"] [data-madd]').click();
    await expect(page.locator('[data-row="kebapcheta"] .incart')).toBeVisible();

    /* the cart: grouped by phone, any phone changes any line, "Отмени" after a removal */
    await page.goto("/masa/" + t.code + "/kolichka/" + PV);
    await expect(page.locator(".grp")).toHaveCount(2);
    await expect(page.locator(".grp").first()).toContainText("Вие");
    const keb = page.locator(".cl", { hasText: "Кебапчета" });
    await keb.locator('[data-q="1"]').click();
    await expect(keb.locator("output")).toHaveText("2");
    await p2.page.goto("/masa/" + t.code + "/kolichka/" + PV);
    await expect(p2.page.locator(".cl", { hasText: "Кебапчета" }).locator("output")).toHaveText("2");
    const pz = page.locator(".cl", { hasText: "Пица Маргарита" });
    await pz.locator('[data-q="-1"]').click();
    await expect(page.locator(".cl", { hasText: "Пица Маргарита" })).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Махнахме Пица Маргарита");
    await page.locator(".toast button", { hasText: "Отмени" }).click();
    await expect(page.locator(".cl", { hasText: "Пица Маргарита" })).toHaveCount(1);
    await expect(p2.page.locator(".cl", { hasText: "Пица Маргарита" })).toHaveCount(1);

    /* the first order goes to the waiter */
    const send = page.locator("[data-send]").filter({ visible: true });
    await expect(send).toHaveText("Изпрати към сервитьора · 22,37 €");
    await send.click();
    await expect(page.locator(".wait h2")).toHaveText("Чака потвърждение от сервитьора");
    await expect(p2.page.locator(".wait h2")).toHaveText("Чака потвърждение от сервитьора");
    await expect(p2.page.locator(".rnd-h")).toContainText("чака сервитьора");

    /* the waiter confirms: Прието, live on both phones */
    const conf = await W.confirm(n);
    expect(conf.no).toMatch(/^\d+$/);
    await expect(page.locator(".wait")).toHaveCount(0);
    await expect(page.locator(".rnd-h")).toContainText("потвърдена от сервитьора");
    await expect(p2.page.locator(".sl .stp.accepted")).toHaveCount(2);
    await expect(p2.page.locator(".legend")).toContainText("Прието→Готви се→Сервирано");

    /* the kitchen: „Започни“ → Готви се; every line ready; the waiter „Сервирах“ → Сервирано */
    await K.start(conf.no);
    await expect(page.locator(".sl .stp.cooking")).toHaveCount(2);
    await expect(p2.page.locator(".sl .stp.cooking").first()).toContainText("Готви се");
    await K.ready(conf.no, 0); await K.ready(conf.no, 1);
    await W.serve(n);
    await expect(page.locator(".sl .stp.served")).toHaveCount(2);
    await expect(p2.page.locator(".sl .stp.served").first()).toContainText("Сервирано");

    /* the next order goes straight to the kitchen */
    await p2.page.goto("/masa/" + t.code + "/menu/" + PV);
    await p2.page.locator('[data-row="tiramisu"] [data-madd]').click();
    await p2.page.goto("/masa/" + t.code + "/kolichka/" + PV);
    await expect(p2.page.locator(".sum")).toContainText("Сметка на масата досега");
    await expect(p2.page.locator(".sum .tot")).toContainText("Общо с новите");
    const s2 = p2.page.locator("[data-send]").filter({ visible: true });
    await expect(s2).toHaveText("Изпрати към кухнята · 4,09 €");
    await s2.click();
    await expect(p2.page.locator(".toast")).toContainText("Изпратено в кухнята");
    await expect(page.locator(".rnd-h").first()).toContainText("направо в кухнята");
    await expect(page.locator(".rnd")).toHaveCount(2);
    expect(errs).toEqual([]);
    expect(p2.errors).toEqual([]);
  } finally {
    await W.clear(n).catch(() => {});
    await p2.ctx.close(); await W.ctx.close(); await K.ctx.close();
  }
});

test("the waiter rejects the first order: the reason, the dishes back in the cart, „Повикай сервитьор“ and „Разбрах“", async ({ page, browser, baseURL }) => {
  const errs = watch(page);
  const n = tableN(page, 1), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const A = tok("rej-a" + n), G = guest(W.r, t.code, A);
  try {
    await G.open(true); await G.add("shopska-salata"); await G.send();
    await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
    await page.goto("/masa/" + t.code + "/kolichka/" + PV);
    await expect(page.locator(".wait h2")).toBeVisible();
    await W.reject(n, "gaveup");
    const note = page.locator(".mnote", { hasText: "Сервитьорът отказа поръчката" });
    await expect(note).toContainText("Сервитьорът отбеляза, че сте се отказали от нея.");
    await expect(note.locator("a", { hasText: "Повикай сервитьор" })).toHaveAttribute("href", "/masa/" + t.code + "/povikvane/");
    await expect(page.locator(".cl", { hasText: "Шопска салата" })).toHaveCount(1);
    await expect(page.locator("[data-send]").filter({ visible: true })).toContainText("Изпрати към сервитьора");
    await note.locator("[data-rejok]").click();
    await expect(page.locator(".mnote", { hasText: "Сервитьорът отказа поръчката" })).toHaveCount(0);
    expect(errs).toEqual([]);
  } finally { await W.clear(n).catch(() => {}); await W.ctx.close(); }
});

test("the closed sitting after the waiter is paid and closes; a new scan opens the next sitting", async ({ page, browser, baseURL }) => {
  const errs = watch(page);
  const n = tableN(page, 2), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const A = tok("close-a" + n), G = guest(W.r, t.code, A);
  try {
    await G.open(true); await G.add("tiramisu"); await G.send(); await W.confirm(n);
    await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
    await page.goto("/masa/" + t.code + "/smetka/" + PV);
    await expect(page.locator(".tot .price")).toHaveText("4,09 €");
    await W.pay(n); await W.close(n);
    await expect(page.locator(".coming.done h2")).toHaveText("Сметката е платена");
    await expect(page.locator(".rate h2")).toHaveText("Останахте ли доволни?"); /* the rating after the close */
    await page.goto("/masa/" + t.code + "/menu/" + PV);
    await expect(page.locator(".gate h1")).toHaveText("Благодарим, че бяхте при нас!");
    await expect(page.locator(".gate")).toContainText("Ако останете още, сканирайте кода на масата отново.");
    await expect(page.locator("[data-mnav]")).toBeHidden();
    /* a new scan (the label's address, opened straight): the next sitting */
    await page.goto("/masa/" + t.code + "/" + PV);
    await expect(page.locator(".wl-t")).toHaveText("Маса " + n);
    await expect(page.locator(".now .d")).toHaveText("Количката още е празна");
    expect(errs).toEqual([]);
  } finally { await W.clear(n).catch(() => {}); await W.ctx.close(); }
});

test("the time in the views follows the preview clock", async ({ page, browser, baseURL }) => {
  const n = tableN(page, 3), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const A = tok("clock" + n), G = guest(W.r, t.code, A);
  try {
    await G.open(true); await G.add("tiramisu"); await G.send();
    await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
    await page.goto("/masa/" + t.code + "/kolichka/" + PV);
    await expect(page.locator(".wait .meta")).toContainText("изпратено в " + CLOCK);
  } finally { await W.clear(n).catch(() => {}); await W.ctx.close(); }
});
