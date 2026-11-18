import { test, expect, type TestInfo, type Page, type APIRequestContext } from "@playwright/test";
import { ownServer, E, type Own } from "./own-server.ts";
import { order, login, ready, shift, driver2, moveOut, errors, drawn, toast, bar, PW, type Made } from "./shofyor-helpers.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* Шофьор (/shofyor/...; src/modules/shofyor/*): the sign-in in 3 steps; a web order for delivery -> the kitchen makes it
   ready -> it appears live in "Доставки" -> "Взех" (with "Отмени") -> "Тръгвам" -> "Пристигнах" (the customer's
   tracking page shows "Шофьорът е пред входа") -> "Доставена" with cash and change; two drivers cannot take the same
   order; a problem and "Върнах я"; an address outside the zones asked and answered by the manager live.
   Every project has its own server (E2E_PORT + 20 / + 21): "Взех N поръчки" takes every ready order. */
let S: Own, kitchen: APIRequestContext, manager: APIRequestContext;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({ playwright }, info: TestInfo) => {
  test.setTimeout(120_000);
  test.skip(!E.DRIVER_PASSWORD || !E.KITCHEN_PASSWORD || !E.MANAGER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("drv-flow-" + info.project.name, info.project.name === "phone" ? 20 : 21);
  kitchen = await playwright.request.newContext(); await login(kitchen, S.base, "kitchen");
  manager = await playwright.request.newContext(); await login(manager, S.base, "manager");
});
test.afterAll(async () => { if (S) await S.stop(); });

const go = async (page: Page, path: string) => { await page.goto(S.base + path); await drawn(page); };
const api = (page: Page) => page.context().request;
const get = async (page: Page, no: string) => (await (await api(page).get(S.base + "/api/driver/deliveries/" + no)).json()) as { st: string; arrivedAt: string | null; total: number; problem: { solved: string } | null };

test("sign-in in 3 steps: errors under each field, „Покажи“, the car, the km checked by the core, then „Доставки“", async ({ page }) => {
  const errs = errors(page);
  await go(page, "/shofyor/vhod/");
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 1 от 3");
  await expect(page.locator("h1.h1")).toHaveText("Вход за шофьора");
  await expect(page.locator(".st-tools, .st-nav")).toHaveCount(0);
  await bar(page).getByRole("button", { name: "Влез" }).click();
  await expect(page.locator("#uerr")).toHaveText("Въведи потребител.");
  await expect(page.locator("#perr")).toHaveText("Въведи парола.");
  await expect(page.locator("#u")).toBeFocused();
  const show = page.locator("[data-show]");
  await expect(show).toHaveAttribute("aria-pressed", "false");
  await show.click();
  await expect(show).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#p")).toHaveAttribute("type", "text");
  await page.fill("#u", "driver"); await page.fill("#p", "wrong-password");
  await bar(page).getByRole("button", { name: "Влез" }).click();
  await expect(page.locator("#perr")).toContainText("Грешен потребител или парола.");
  await expect(page.locator("#uerr")).toHaveCount(0);
  await page.fill("#p", PW.driver[1]);
  await bar(page).getByRole("button", { name: "Влез" }).click();
  /* 2: the car, the first one chosen; one tap changes it */
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 2 от 3");
  const cars = page.locator(".cars .car");
  await expect(cars.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cars")).toContainText("[ЛИПСВА]");
  await cars.nth(1).click();
  await expect(cars.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(cars.first()).toHaveAttribute("aria-pressed", "false");
  await expect(bar(page).locator("button").first()).toHaveText("Назад");
  await cars.first().click();
  await bar(page).getByRole("button", { name: /^С Автомобил 1/ }).click();
  /* 3: km and the change; the polite reminder */
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 3 от 3");
  await expect(page.locator(".park")).toContainText("Ползвай приложението само когато колата е паркирана.");
  await expect(page.locator("#flh")).toContainText("[ЛИПСВА: колко ресто се дава]");
  await expect(page.locator("#kmnow")).toHaveAttribute("inputmode", "numeric");
  /* the location is explained first and asked only on "Разреши"; "Не сега" is remembered on the phone */
  const geo = page.locator("[data-geo-card]");
  await expect(geo).toContainText("Местоположението не се изпраща никъде.");
  await geo.getByRole("button", { name: "Не сега" }).click();
  await expect(geo).toContainText("Изключено");
  expect(await page.evaluate(() => localStorage.getItem("dr-geo"))).toBe("no");
  await bar(page).getByRole("button", { name: "Започни смяната" }).click();
  await expect(page.locator("#kerr")).toHaveText("Въведи километража от таблото.");
  await expect(page.locator("#kmnow")).toBeFocused();
  await page.fill("#kmnow", "48250"); await page.fill("#fl", "20");
  await bar(page).getByRole("button", { name: "Започни смяната" }).click();
  await expect(page).toHaveURL(/\/shofyor\/$/);
  await drawn(page);
  await expect(page.locator(".st-top h1")).toHaveText("Моите доставки");
  await expect(page.locator(".st-top [data-sub]")).toHaveText(/ · Автомобил 1$/);
  /* signed in with a shift: the sign-in goes straight to "Доставки" */
  await page.goto(S.base + "/shofyor/vhod/");
  await expect(page).toHaveURL(/\/shofyor\/$/);
  expect(errs).toEqual([]);
});

test("a web order arrives live, „Взех“ with „Отмени“, „Тръгвам“, „Пристигнах“ on the customer's page, „Доставена“ with change", async ({ page, browser }) => {
  const errs = errors(page);
  await login(page.context(), S.base, "driver");
  await shift(api(page), S.base);
  await go(page, "/shofyor/");
  const o = await order(page.context().request, S.base, { note: "Звънецът не работи." });
  /* the customer watches the tracking page */
  const cust = await browser.newContext();
  await cust.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  const tp = await cust.newPage();
  await tp.goto(S.base + "/porachka/" + o.no + "-" + o.key + "/");
  await ready(kitchen, S.base, o.no);
  /* live, no reload */
  const card = page.locator(".next");
  await expect(card).toContainText("№ " + o.no);
  await expect(card.locator(".money")).toContainText("Вземи в брой");
  await expect(page.locator('.st-nav [data-cnt="list"]')).toContainText("1");
  const take = bar(page).getByRole("button", { name: /^Взех 1 поръчка$/ });
  await expect(take).toBeVisible();
  await take.click();
  await expect(toast(page)).toContainText("1 поръчка е взета");
  /* the focus stays on the screen: the new main button (never <body>) */
  const focusIn = (sel: string) => page.evaluate((s) => !!document.activeElement && !!document.activeElement.closest(s), sel);
  await expect.poll(() => focusIn(".st-bar")).toBe(true);
  await toast(page).getByRole("button", { name: "Отмени" }).click();
  await expect(toast(page)).toContainText("Отменено.");
  await expect.poll(() => focusIn(".st-bar")).toBe(true);
  await expect(bar(page).getByRole("button", { name: /^Взех 1 поръчка$/ })).toBeVisible();
  expect((await get(page, o.no)).st).toBe("wait");
  await bar(page).getByRole("button", { name: /^Взех 1 поръчка$/ }).click();
  await expect(bar(page).getByRole("button", { name: /^Тръгвам$/ })).toBeVisible();
  await expect(bar(page).getByRole("link", { name: /Навигация до № / })).toHaveAttribute("href", /google\.com\/maps\/dir\/\?api=1&destination=/);
  await bar(page).getByRole("button", { name: /^Тръгвам$/ }).click();
  await expect(toast(page)).toContainText("№ " + o.no + " е на път");
  await expect(tp.locator("body")).toContainText("Поръчката тръгна към вас");
  await bar(page).getByRole("button", { name: "Пристигнах" }).click();
  await expect(toast(page)).toContainText("Шофьорът е пред входа");
  await expect(card.locator(".arr")).toContainText("Клиентът вижда „Шофьорът е пред входа“");
  await expect(card).toContainText("[ЛИПСВА: доставчик за SMS]");
  await expect(tp.locator("body")).toContainText("Шофьорът е пред входа");
  /* a live event (another order ready) redraws the list: the focus stays on "Отвори" of the same card */
  await card.locator(".acts a.pill-soft").focus();
  const o3 = await order(page.context().request, S.base, { addr: "ж.к. Дружба 1, бл. 12" });
  await ready(kitchen, S.base, o3.no);
  await expect(page.locator(".drow2", { hasText: "№ " + o3.no })).toBeVisible();
  expect(await page.evaluate(() => [document.activeElement?.textContent?.trim(), !!document.activeElement?.closest(".next")])).toEqual(["Отвори", true]);
  /* the delivery: the customer by name only, the stages, the change */
  await bar(page).getByRole("link", { name: "Отвори № " + o.no }).click();
  await expect(page).toHaveURL(new RegExp("/shofyor/dostavka/#" + o.no + "$"));
  await drawn(page);
  await expect(page.locator(".st-top h1")).toHaveText("№ " + o.no);
  await expect(page.locator(".client")).toContainText("Иван Петров");
  await expect(page.locator(".client")).toContainText("Номерът е скрит");
  await expect(page.locator("main")).not.toContainText("0888");
  await expect(page.locator(".notebox")).toHaveText("Звънецът не работи.");
  await expect(page.locator(".flow li.now")).toHaveText("На път");
  await expect(page.locator(".paygrid .on")).toHaveText("В брой");
  const total = (await get(page, o.no)).total, fmt = (n: number) => n.toFixed(2).replace(".", ",") + " €";
  await page.getByRole("button", { name: "Друга сума" }).click();
  await expect(page.locator("#oth")).toBeFocused();
  await page.fill("#oth", "100");
  await expect(page.locator("#chg .chg.big")).toHaveText("Върни " + fmt(100 - total));
  expect(await page.locator("#chg .chg.big").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(24);
  await page.getByRole("button", { name: "Точна сума" }).click();
  await expect(page.locator("#chg")).toHaveText("Без ресто");
  /* "Отмени" of "Пристигнах" is the core's: one step back */
  const done = bar(page).getByRole("button", { name: "Доставена · взех " + fmt(total) });
  await expect(done).toBeVisible();
  await done.click();
  await expect(toast(page)).toContainText("№ " + o.no + " е доставена.");
  await expect(page.locator(".flow li.on")).toHaveCount(3);
  await expect(bar(page).getByRole("link", { name: /^(Към доставките|Следваща · № \d+)/ })).toBeVisible();
  await expect(tp.locator("body")).toContainText(/Доставена|Приятен апетит|доставихме/i);
  expect((await get(page, o.no)).st).toBe("done");
  await cust.close();
  expect(errs).toEqual([]);
});

test("two drivers cannot take the same order; a problem and „Върнах я“; „Отмени“ the core no longer takes", async ({ page, browser, playwright }) => {
  const errs = errors(page);
  await login(page.context(), S.base, "driver");
  await shift(api(page), S.base);
  const admin = await playwright.request.newContext(); await login(admin, S.base, "admin");
  const [u2, p2] = await driver2(admin, S.base);
  const c2 = await browser.newContext(); await login(c2, S.base, u2, p2); await shift(c2.request, S.base, "a2", 31540, null);
  const o = await order(page.context().request, S.base, { lines: [{ id: "kebapcheta", q: 2 }] });
  await ready(kitchen, S.base, o.no);
  /* the second driver's phone does not hear the first one (no stream): his tap is refused by the core */
  const p2page = await c2.newPage();
  await p2page.route("**/api/stream**", (r) => r.abort());
  await p2page.goto(S.base + "/shofyor/dostavka/#" + o.no); await drawn(p2page);
  await expect(bar(p2page).getByRole("button", { name: "Взех от ресторанта" })).toBeVisible();
  await go(page, "/shofyor/dostavka/#" + o.no);
  await bar(page).getByRole("button", { name: "Взех от ресторанта" }).click();
  await expect(toast(page)).toContainText("№ " + o.no + " е взета от ресторанта.");
  await bar(p2page).getByRole("button", { name: "Взех от ресторанта" }).click();
  await expect(p2page.locator(".st-toast.on")).toContainText("№ " + o.no + " вече е взета от друг шофьор.");
  await p2page.unroute("**/api/stream**");
  await p2page.goto(S.base + "/shofyor/"); await drawn(p2page);
  await expect(p2page.locator("main")).not.toContainText("№ " + o.no);
  await c2.close(); await admin.dispose();

  /* the problem: only taken / on the way */
  await bar(page).getByRole("button", { name: "Тръгвам · На път" }).click();
  await expect(page.locator(".flow li.now")).toHaveText("На път");
  await page.getByRole("button", { name: "Проблем с доставката" }).click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator("h2")).toHaveText("Какво се случи?");
  await expect(sh.locator("[data-psend]")).toBeDisabled();
  await sh.getByRole("button", { name: /Няма никой/ }).click();
  await expect(sh).toContainText("[ЛИПСВА: колко чака шофьорът");
  await sh.getByRole("button", { name: "Изпрати: Няма никой" }).click();
  await expect(toast(page)).toContainText("Ресторантът е уведомен: Няма никой.");
  await expect(page.locator(".notice.bad").first()).toContainText("Проблем: Няма никой.");
  await expect(page.getByRole("button", { name: "Проблем с доставката" })).toHaveCount(0);
  await expect(bar(page).getByRole("button", { name: /Доставих все пак/ })).toBeVisible();
  await bar(page).getByRole("button", { name: "Върнах я" }).click();
  await expect(toast(page)).toContainText("№ " + o.no + " е върната в ресторанта.");
  await expect(page.locator(".notice.bad").first()).toContainText("Върната в ресторанта в");
  expect((await get(page, o.no)).problem!.solved).toBe("returned");
  /* "Отмени" that the core no longer takes: its words (409) */
  const r = await api(page).post(S.base + "/api/driver/undo", { data: { id: "nope" } });
  expect(r.status()).toBe(409);
  expect((await r.json()).message).toBe("Вече не може да се отмени.");
  expect(errs).toEqual([]);
});

test("an address outside the zones: „уточни с ресторанта“, „Взех · след потвърждение“ asks the manager, the answer arrives live", async ({ page }) => {
  const errs = errors(page);
  await login(page.context(), S.base, "driver");
  await shift(api(page), S.base);
  const o: Made = await order(page.context().request, S.base, { lines: [{ id: "kebapcheta", q: 1 }] });
  moveOut(S.db, o.no);
  await ready(kitchen, S.base, o.no);
  await go(page, "/shofyor/");
  const row = page.locator(".next, .drow2").filter({ hasText: "№ " + o.no }).first();
  await expect(row).toContainText("Извън зоните");
  await expect(row).toContainText("уточни с ресторанта");
  await go(page, "/shofyor/dostavka/#" + o.no);
  await expect(page.locator(".notice.bad").first()).toContainText("Адресът е извън зоните за доставка.");
  await expect(page.locator(".notice.bad a[href^='tel:']").first()).toHaveText("Обади се в ресторанта");
  await expect(page.locator(".notice.warn")).toContainText("Попитай ресторанта колко да вземеш");
  await expect(page.locator("main")).not.toContainText("Върни ");
  await bar(page).getByRole("button", { name: "Взех · след потвърждение" }).click();
  const sh = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh.locator("h2")).toHaveText("Ресторантът потвърди ли?");
  await sh.getByRole("button", { name: "Питай управителя" }).click();
  await expect(toast(page)).toContainText("Попита управителя за № " + o.no);
  await expect(page.locator(".notice.bad").first()).toContainText("Чакаш отговор от управителя от");
  /* the manager answers (his module / the admin): the driver sees it at once */
  const asks = (await (await manager.get(S.base + "/api/driver/asks")).json()) as { id: string; order: string }[];
  const q = asks.find((a) => a.order === o.no)!;
  expect((await manager.post(S.base + "/api/driver/asks/" + q.id + "/answer", { data: { answer: "deliver" } })).status()).toBe(200);
  await expect(page.locator(".notice.bad").first()).toContainText("Управителят: Да я достави.");
  await expect(bar(page).getByRole("button", { name: "Взех от ресторанта" })).toBeVisible();
  await bar(page).getByRole("button", { name: "Взех от ресторанта" }).click();
  await expect(page.locator(".flow li.on")).toHaveText("Взета");
  /* the screen says "уточни с ресторанта": "Доставена" asks how much he took, and that goes into the cash */
  await bar(page).getByRole("button", { name: "Тръгвам · На път" }).click();
  await bar(page).locator('[data-st="done"]').click();
  const sh2 = page.locator(".st-sheetwrap.on .st-sheet");
  await expect(sh2.locator("h2")).toHaveText("Колко взе?");
  await expect(page.locator("#took")).toBeFocused();
  await page.fill("#took", "abc");
  await sh2.locator("[data-took]").click();
  await expect(page.locator("#took-e")).toHaveText("Въведи сумата, която взе, например 24,50.");
  await page.fill("#took", "35,00");
  await sh2.locator("[data-took]").click();
  await expect(toast(page)).toContainText("№ " + o.no + " е доставена: взе 35,00 €.");
  const got = (await (await api(page).get(S.base + "/api/driver/deliveries/" + o.no)).json()) as { st: string; collected: { sum: number } };
  expect([got.st, got.collected.sum]).toEqual(["done", 35]);
  expect(errs).toEqual([]);
});
