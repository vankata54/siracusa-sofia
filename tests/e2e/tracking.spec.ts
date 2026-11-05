import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import fs from "node:fs";

/* Tracking (/porachka/<номер>/): not found, pre-order "за утре" + "Промени", live status over SSE (the manager changes it),
   rating Да / Не through api.ratings.submit, the success content right after checkout, the prototype panel only with ?preview=1.
   Orders are made "за утре", so the test works at any hour (today's orders are refused after 22:30). */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
}
async function cookies(page: Page) {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
}
async function makeOrder(request: APIRequestContext) {
  const r = await request.post("/api/orders", { data: {
    cart: { mode: "delivery", lines: [{ id: "pitsa-s-burata-i-proshuto-krudo", q: 2, mods: ["без лук"] }, { id: "gratska-salata", q: 1, mods: [] }] },
    zone: "Дружба 2", addr: "бл. 311", name: "Иван Петров", phone: "0888123456", pay: "card", sched: "утре", slot: "19:00",
  } });
  expect(r.status()).toBe(201);
  return r.json();
}
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const noHScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test("tracking: unknown number -> polite empty state, noindex, one h1", async ({ page }) => {
  const errors = watch(page);
  await cookies(page);
  await page.goto("/porachka/999999/");
  await expect(page.locator("h1")).toHaveText("Не намираме поръчка № 999999");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('a[href^="tel:"]', { hasText: "Обади се в ресторанта" })).toBeVisible();
  await expect(page.getByText("Само в прототипа")).toHaveCount(0);
  await noHScroll(page);
  expect(errors.filter((e) => !/404/.test(e))).toEqual([]);
});

test("tracking: pre-order for tomorrow, Промени, share, no prototype panel without preview", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto("/porachka/" + o.no + "/");
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  await expect(page.locator(".elab")).toContainText("Приета за утре");
  await expect(page.locator(".enum.clock b")).toHaveText("19:00");
  await expect(page.locator(".tl li")).toHaveCount(5);
  await expect(page.locator(".oline")).toHaveCount(2);
  await expect(page.locator(".oline .mod")).toHaveText("Без лук");
  await expect(page.locator(".okv")).toContainText("Карта при получаване");
  await expect(page.locator(".okv .tot")).toContainText("26,52 €");
  await expect(page.locator("[data-sim]")).toHaveCount(0);
  await page.locator("[data-change]").click();
  await expect(page.locator(".sheet")).toContainText("18:00");
  await expect(page.locator(".sheet a[href^='tel:']")).toBeVisible();
  await page.locator(".sheet [data-close]").click();
  await noHScroll(page);
  expect(errors).toEqual([]);
});

test("tracking: live status from the kitchen, then rating Да / Не", async ({ page, request, playwright, baseURL }) => {
  const E = env();
  test.skip(!E.MANAGER_PASSWORD, "no .env with staff passwords");
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto("/porachka/" + o.no + "/");
  await expect(page.locator(".tl li.now .nm")).toHaveText("Приета");
  const staff = await playwright.request.newContext({ baseURL });
  expect((await staff.post("/api/auth/login", { data: { username: "manager", password: E.MANAGER_PASSWORD } })).ok()).toBe(true);
  const set = async (status: string) => expect((await staff.patch("/api/admin/orders/" + o.no, { data: { status } })).ok()).toBe(true);
  await set("cooking");
  await expect(page.locator(".tl li.now .nm")).toHaveText("Готви се");
  await expect(page.locator(".say")).toHaveText("Пицата е в пещта");
  await set("ready"); await set("on_way"); await set("delivered");
  await expect(page.locator("#rate-h")).toHaveText("Останахте ли доволни?");
  await expect(page.locator(".trk-live")).toContainText("Доставена");
  await page.locator('[data-rate="yes"]').click();
  await expect(page.locator(".code .v")).toHaveText(/^[A-Z0-9]+-\d+$/);
  const code = await page.locator(".code .v").textContent();
  await expect(page.getByText("Напиши отзив в Google")).toBeVisible();
  await expect(page.getByText("[ЛИПСВА: линк към профила в Google]")).toBeVisible();
  await page.locator("[data-rate-reset]").click();
  await page.locator('[data-rate="no"]').click();
  await expect(page.locator(".code .v")).toHaveText(code!);           // the same code for both answers
  await expect(page.locator(".ans a", { hasText: "Отзив в Google" })).toBeVisible();          // Google link also after "Не"
  await page.locator("[data-fb]").click();
  await expect(page.locator("#fbe")).toHaveText("Напишете няколко думи, за да го изпратим.");
  await page.locator("#fb").fill("Пицата пристигна студена.");
  await page.locator("[data-fb]").click();
  await expect(page.getByText("Изпратихме го на управителя.")).toBeVisible();
  await expect(page.locator("[data-again]")).toContainText("Поръчай същото · 26,52 €");
  await staff.dispose();
  expect(errors).toEqual([]);
});

test("tracking: right after checkout shows the success content on top", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await page.addInitScript((ord) => { try { localStorage.setItem("sc-cookie", '"min"'); if (!sessionStorage.getItem("t")) { localStorage.setItem("sc-order", JSON.stringify(ord)); sessionStorage.setItem("t", "1"); } } catch { /* ignore */ } }, o);
  await page.goto("/porachka/" + o.no + "/");
  await expect(page.locator("h1")).toHaveText("Благодарим! Поръчката е приета.");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".ono")).toContainText("№ " + o.no);
  await expect(page.locator(".okhead .lead")).toContainText("Иван,");
  await expect(page.getByText("Направи профил и вземи -10% от следващата поръчка")).toBeVisible();
  const sw = page.locator("[data-bday]");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#bd-d")).toBeVisible();
  /* second opening: the normal tracking title */
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Поръчка № " + o.no);
  expect(errors).toEqual([]);
});

test("tracking: ?preview=1 shows the prototype panel and 'Симулирай: доставена'", async ({ page, request }) => {
  const errors = watch(page);
  const o = await makeOrder(request);
  await cookies(page);
  await page.goto("/porachka/" + o.no + "/?preview=1&t=12:30");
  await page.getByRole("button", { name: "Симулирай: доставена" }).click();
  await expect(page.locator("#rate-h")).toBeVisible();
  await expect(page.locator(".elab")).toHaveText("Доставена в");
  await noHScroll(page);
  expect(errors).toEqual([]);
});
