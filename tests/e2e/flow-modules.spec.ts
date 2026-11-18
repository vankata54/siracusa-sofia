import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { ownServer, E, type Own } from "./own-server.ts";

/* The two flows between the modules, every person in their own browser with their own screen, all open at the same time,
   nothing done through the API that a person does on a screen:
     1. a QR table: the guest's phone orders → the waiter's phone confirms → the kitchen tablet „Започни“ / „Готово“
        → the waiter's „Готови“ → „Сервирах“ → the guest's phone shows „Сервирано“;
     2. a delivery from the site: the customer's checkout → the kitchen tablet „Започни“ / „Готово“ → the driver's phone
        „Взех“ / „Тръгвам“ / „Пристигнах“ / „Доставена“ → the customer's tracking page follows every step.
   Only the driver's shift start is made through the API (its sign-in has its own test in shofyor-flow.spec.ts).
   An own server (E2E_PORT + 30, its own database): no other spec takes these orders or closes this table.
   Desktop project only: each person has a context of their own size (phone 390, tablet 1280, desktop 1440). */
let S: Own;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  test.setTimeout(120_000);
  test.skip(!E.WAITER_PASSWORD || !E.KITCHEN_PASSWORD || !E.DRIVER_PASSWORD || !E.ADMIN_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("flow-modules", 30);
});
test.afterAll(async () => { if (S) await S.stop(); });

const PASS: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], waiter: ["waiter", E.WAITER_PASSWORD], kitchen: ["kitchen", E.KITCHEN_PASSWORD], driver: ["driver", E.DRIVER_PASSWORD] };
type Person = { ctx: BrowserContext; page: Page; errs: string[] };

async function person(browser: Browser, kind: "phone" | "tablet" | "desktop", who?: string, init?: () => void): Promise<Person> {
  const vp = kind === "phone" ? { width: 390, height: 844 } : kind === "tablet" ? { width: 1280, height: 800 } : { width: 1440, height: 900 };
  const ctx = await browser.newContext({ baseURL: S.base, viewport: vp, isMobile: kind === "phone", hasTouch: kind !== "desktop" });
  if (who) {
    const r = await ctx.request.post("/api/auth/login", { data: { username: PASS[who][0], password: PASS[who][1] } });
    expect(r.status(), "sign-in " + who).toBe(200);
  }
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(), errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  return { ctx, page, errs };
}
/** the kitchen tablet on the grill ("Скара Bertha": kebapcheta and svinski-vrat are cooked there) */
const kitchenInit = () => { try { if (!localStorage.getItem("sk-test")) { localStorage.setItem("sk-test", "1"); localStorage.setItem("sk-sec", JSON.stringify("skara")); } } catch { /* ignore */ } };
const cookieInit = () => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } };
/** press and hold with the mouse (the kitchen's „Готово“ needs 1 s) */
async function hold(page: Page, el: Locator, ms: number) {
  await el.scrollIntoViewIfNeeded();
  const b = (await el.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down(); await page.waitForTimeout(ms); await page.mouse.up();
}
async function kitchenCooks(k: Page, no: string) {
  const card = k.locator('.tk[data-no="' + no + '"]');
  await expect(card).toBeVisible();
  await card.locator("[data-start]").click();
  await expect(card.locator(".tag.cook")).toHaveText(/^готви се от \d\d:\d\d$/);
  return card;
}

test("@desktop QR table: the guest's phone → the waiter's phone → the kitchen tablet → „Сервирах“ → „Сервирано“ on the guest's phone", async ({ browser }) => {
  test.setTimeout(120_000);
  const N = 11;
  const admin = await person(browser, "desktop", "admin");
  const code = ((await (await admin.ctx.request.get("/api/admin/qr")).json()) as { n: number; code: string }[]).find((r) => r.n === N)!.code;
  await admin.ctx.close();
  const guest = await person(browser, "phone"), waiter = await person(browser, "phone", "waiter"), kitchen = await person(browser, "tablet", "kitchen", kitchenInit);
  const PV = "?preview=1&t=19:30";
  try {
    /* everybody's screen is open before anything happens: every step below arrives live */
    await waiter.page.goto("/servitor/masa/" + PV + "#" + N);
    await expect(waiter.page.locator(".st-app:not([data-boot]) .st-top h1")).toHaveText("Маса " + N);
    await kitchen.page.goto("/kuhnya/");
    await expect(kitchen.page.locator(".kstrip .kcount")).toContainText("Чакат");

    /* the guest scans the code, adds from the menu and sends: the first order of a sitting waits for the waiter */
    await guest.page.goto("/masa/" + code + "/menu/" + PV);
    await guest.page.locator('[data-row="kebapcheta"] [data-madd]').click();
    await expect(guest.page.locator(".toast")).toContainText("Добавено в общата количка");
    await guest.page.locator('[data-row="svinski-vrat"] [data-madd]').click();
    await guest.page.goto("/masa/" + code + "/kolichka/" + PV);
    const send = guest.page.locator("[data-send]").filter({ visible: true });
    await expect(send).toHaveText(/^Изпрати към сервитьора · \d+,\d\d\s€$/);
    await send.click();
    await expect(guest.page.locator("[data-whose]")).toHaveText("Вашата поръчка чака сервитьора");

    /* the waiter's phone: the order appears live; „Потвърди и прати“ sends it to the kitchen */
    const qr = waiter.page.locator(".qrcard");
    await expect(qr).toContainText("Поръчка от QR · чака потвърждение");
    await expect(qr).toContainText("Кебапчета");
    await waiter.page.locator(".st-bar [data-confirm]").click();
    await expect(waiter.page.locator(".st-toast.on")).toContainText("Потвърдено и изпратено в кухнята · №");
    const no = ((await waiter.page.locator(".st-toast.on").textContent()) || "").match(/№\s*(\d+)/)![1];
    await expect(guest.page.locator(".rnd-h")).toContainText("потвърдена от сервитьора");

    /* the kitchen tablet: the ticket arrives live (the table, from QR); „Започни“ → the guest sees „Готви се“ */
    const card = await kitchenCooks(kitchen.page, no);
    await expect(card).toContainText("Маса " + N);
    await expect(guest.page.locator(".sl .stp.cooking")).toHaveCount(2);
    await expect(waiter.page.locator(".ocard .stt.cook").first()).toContainText("Готви се");
    /* „Готово“ with the 1 s hold: the waiter is told („Готови“), the ticket leaves the queue */
    await hold(kitchen.page, card.locator("[data-done]"), 1150);
    await expect(card).toHaveCount(0);
    await expect(kitchen.page.locator(".kt")).toContainText("Маса " + N);

    /* the waiter's „Готови“: the table with both dishes; „Сервирах“ */
    await waiter.page.goto("/servitor/gotovi/" + PV);
    const ready = waiter.page.locator("article.rcard", { has: waiter.page.locator(".hd b", { hasText: new RegExp("^Маса " + N + "$") }) });
    await expect(ready).toBeVisible();
    await expect(ready.locator(".oline")).toHaveCount(2);
    await ready.locator("button", { hasText: "Сервирах" }).click();
    await expect(waiter.page.locator(".st-toast span")).toHaveText("Маса " + N + ": сервирано");
    await expect(ready).toHaveCount(0);

    /* the guest's phone: every dish „Сервирано“, live */
    await expect(guest.page.locator(".sl .stp.served")).toHaveCount(2);
    await expect(guest.page.locator(".sl .stp.served").first()).toContainText("Сервирано");
    /* the kitchen's „Изпълнени“ has it */
    await kitchen.page.goto("/kuhnya/izpalneni/");
    await expect(kitchen.page.locator("main")).toContainText("Маса " + N);
    await expect(kitchen.page.locator("main")).toContainText("1 × Кебапчета, 1 × Свински врат");

    expect(guest.errs).toEqual([]);
    expect(waiter.errs).toEqual([]);
    expect(kitchen.errs).toEqual([]);
  } finally {
    await Promise.all([guest.ctx.close(), waiter.ctx.close(), kitchen.ctx.close()]);
  }
});

test("@desktop delivery from the site: the checkout → the kitchen tablet → the driver's phone → the customer's tracking page at every step", async ({ browser }) => {
  test.setTimeout(120_000);
  const cart = { mode: "delivery", lines: [{ key: "kebapcheta", id: "kebapcheta", q: 2, mods: [], extra: 0 }, { key: "svinski-vrat", id: "svinski-vrat", q: 1, mods: [], extra: 0 }] };
  const customer = await person(browser, "desktop", undefined, () => {
    try { if (sessionStorage.getItem("fl-init")) return; sessionStorage.setItem("fl-init", "1"); localStorage.setItem("sc-cookie", '"min"'); localStorage.removeItem("sc-checkout"); } catch { /* ignore */ }
  });
  await customer.ctx.addInitScript((c) => { try { if (!sessionStorage.getItem("fl-cart")) { sessionStorage.setItem("fl-cart", "1"); localStorage.setItem("sc-cart", JSON.stringify(c)); } } catch { /* ignore */ } }, cart);
  const kitchen = await person(browser, "tablet", "kitchen", kitchenInit), driver = await person(browser, "phone", "driver", cookieInit);
  try {
    /* the driver's shift is open and his list is on screen; the kitchen tablet is open */
    const st = await (await driver.ctx.request.get("/api/driver/state")).json();
    if (!st.shift) expect((await driver.ctx.request.post("/api/driver/start", { data: { car: "a1", km: 48250, float: 20 } })).status()).toBe(201);
    await driver.page.goto("/shofyor/");
    await expect(driver.page.locator(".st-app:not([data-boot]) .st-top")).toBeVisible();
    await kitchen.page.goto("/kuhnya/");
    await expect(kitchen.page.locator(".kstrip .kcount")).toContainText("Чакат");

    /* the customer: the cart → the address → the details (marketing unticked) → „Поръчай“ → the tracking page */
    const cp = customer.page, cta = cp.locator(".sum-cta .js-next");
    await cp.goto("/kolichka/?preview=1&t=12:30");
    await cta.click();
    await expect(cp.locator("h1")).toHaveText("Къде да я доставим?");
    await cp.locator("#addr").fill("ул. Обиколна 5, Дружба 2");
    await cp.locator("#addr-list li[data-i]").first().click();
    await expect(cp.locator("#addr-res")).toContainText("Безплатна доставка");
    await cta.click();
    await expect(cp.locator("h1")).toHaveText("Вашите данни");
    await expect(cp.locator('[data-f="consent"]')).not.toBeChecked();
    await cp.fill("#f-name", "Мария");
    await cp.fill("#f-phone", "0888 12 34 56");
    await cp.locator("label.opt", { hasText: "В брой" }).click();
    await expect(cta).toHaveText(/^Поръчай · \d+,\d{2} €$/);
    await cta.click();
    await cp.waitForURL(/\/porachka\/\d+-[a-z0-9]+\/$/);
    const no = cp.url().match(/\/porachka\/(\d+)-/)![1];
    const now = cp.locator(".tl li.now .nm");
    await expect(now).toHaveText("Приета");

    /* the kitchen tablet: the delivery arrives live; „Започни“ → „Готви се“ for the customer; „Готово“ → „Готова“ */
    const card = await kitchenCooks(kitchen.page, no);
    await expect(card).toContainText("Доставка");
    await expect(now).toHaveText("Готви се");
    await hold(kitchen.page, card.locator("[data-done]"), 1150);
    await expect(card).toHaveCount(0);
    await expect(kitchen.page.locator(".kt")).toContainText("Известихме шофьора.");
    await expect(now).toHaveText("Готова");

    /* the driver's phone: the ready delivery arrives live; „Взех“ → „Тръгвам“ → the customer sees it on the way */
    const dp = driver.page, bar = dp.locator(".st-bar"), toast = dp.locator(".st-toast.on");
    await expect(dp.locator(".next")).toContainText("№ " + no);
    await expect(dp.locator(".next .money")).toContainText("Вземи в брой");
    await bar.getByRole("button", { name: /^Взех 1 поръчка$/ }).click();
    await expect(toast).toContainText("1 поръчка е взета");
    await bar.getByRole("button", { name: /^Тръгвам$/ }).click();
    await expect(toast).toContainText("№ " + no + " е на път");
    await expect(cp.locator("body")).toContainText("Поръчката тръгна към вас");
    /* „Пристигнах“ → „Шофьорът е пред входа“ on the customer's page */
    await bar.getByRole("button", { name: "Пристигнах" }).click();
    await expect(cp.locator("body")).toContainText("Шофьорът е пред входа");
    /* the delivery: the customer by name only, never the phone; „Доставена · взех …“ */
    await bar.getByRole("link", { name: "Отвори № " + no }).click();
    await expect(dp.locator(".st-top h1")).toHaveText("№ " + no);
    await expect(dp.locator(".client")).toContainText("Мария");
    await expect(dp.locator("main")).not.toContainText("0888");
    await dp.getByRole("button", { name: "Точна сума" }).click();
    await bar.getByRole("button", { name: /^Доставена · взех \d+,\d\d\s€$/ }).click();
    await expect(toast).toContainText("№ " + no + " е доставена.");
    await expect(cp.locator("body")).toContainText(/Доставена|Приятен апетит|доставихме/i);

    expect(customer.errs).toEqual([]);
    expect(kitchen.errs).toEqual([]);
    expect(driver.errs).toEqual([]);
  } finally {
    await Promise.all([customer.ctx.close(), kitchen.ctx.close(), driver.ctx.close()]);
  }
});
