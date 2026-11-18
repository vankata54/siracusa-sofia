import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ownServer, E, USER } from "./own-server.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* Кухня · Вход с личен ПИН (/kuhnya/vhod/, src/modules/kuhnya/vhod.ts; design/pages-kuhnya/login.html) on a KNOWN device
   (core/staff-pin.ts: a device where somebody signed in with a password; in the kitchen the PIN alone):
   - an unknown device: the module sends to the password, /kuhnya/vhod/ says the first sign-in is with the password;
   - a known device without a session: the module sends to the PIN (#next=), the section + 4 digits, „Влез · Скара Bertha“,
     a wrong PIN (role="status"), the right one (the keypad and the keyboard) opens the screen it came from;
   - the lockout on its own server (the core's text, the countdown);
   - 1280 × 800, 1024 × 768, 768 × 1024 (the compact sign-in), dark and light: no horizontal scroll, targets, axe.
   The PIN is made through the admin's staff API (as tests/e2e/admin-staff.spec.ts). */
const rnd = () => Math.random().toString(36).slice(2, 8);
async function newKitchen(base = ""): Promise<{ username: string; name: string; pin: string }> {
  const r0 = await fetch((base || "http://localhost:" + (process.env.E2E_PORT || 8788)) + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: USER.admin[0], password: USER.admin[1] }) });
  expect(r0.status).toBe(200);
  const cookie = r0.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const username = "e2e.k" + rnd(), name = "Готвач " + rnd();
  const r = await fetch((base || "http://localhost:" + (process.env.E2E_PORT || 8788)) + "/api/admin/staff", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ username, name, role: "kitchen", password: "Pw-" + rnd() + rnd() + "x9", pin: "" }) });
  const j = (await r.json()) as { pin_once?: string };
  expect(r.status, JSON.stringify(j)).toBe(201);
  expect(j.pin_once).toMatch(/^\d{4}$/);
  return { username, name, pin: j.pin_once! };
}
/** one cook with a PIN for the tests of this file (a module-level promise: made once per worker) */
let one: Promise<{ username: string; name: string; pin: string }> | null = null;
const someone = () => (one ||= newKitchen());
type Opt = { w?: number; h?: number; theme?: "dark" | "light"; known?: boolean; base?: string };
/** a tablet with no session; known: somebody signed in here with a password before (then signed out) */
async function tablet(browser: Browser, o: Opt = {}): Promise<{ ctx: BrowserContext; page: Page; errs: string[] }> {
  const ctx = await browser.newContext({ viewport: { width: o.w || 1280, height: o.h || 800 }, hasTouch: true, ...(o.base ? { baseURL: o.base } : {}) });
  if (o.known) {
    expect((await ctx.request.post("/api/auth/login", { data: { username: "kitchen", password: E.KITCHEN_PASSWORD } })).status()).toBe(200);
    expect((await ctx.request.post("/api/auth/logout")).status()).toBe(200);
  }
  if (o.theme) await ctx.addInitScript((t) => { try { if (!localStorage.getItem("sk-theme")) localStorage.setItem("sk-theme", JSON.stringify(t)); } catch { /* ignore */ } }, o.theme);
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(e.message));
  /* "no session" and a wrong PIN are answers of the API (401 / 429), not errors of the page */
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|429)/.test(m.text())) errs.push(m.text()); });
  return { ctx, page, errs };
}
async function serious(page: Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const keys = async (page: Page, digits: string) => { for (const d of digits) await page.locator('.pinpad [data-k="' + d + '"]').click(); };

test("@desktop an unknown device: the module asks for the password; /kuhnya/vhod/ says the first sign-in on a new tablet is with the password", async ({ browser }) => {
  const { ctx, page, errs } = await tablet(browser);
  await page.goto("/kuhnya/izcherpano/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fkuhnya%2Fizcherpano%2F$/);
  await page.goto("/kuhnya/vhod/");
  await expect(page.locator("h1")).toHaveText("Коя е секцията на този таблет?");
  await expect(page.locator(".sct b")).toHaveText(["Топла кухня", "Скара Bertha", "Пещ за пици", "Салати и студени", "Общ изглед"]);
  await expect(page.locator(".pin h2")).toHaveText("Нов таблетза вход в Топла кухня");
  await expect(page.locator(".pin .first")).toHaveText("Първият вход на нов таблет е с потребител и парола. После тук стига личният ПИН.");
  await expect(page.locator(".pinpad")).toHaveCount(0);
  await page.locator('[data-sec="pesht"]').click();
  await expect(page.locator(".pin h2 small")).toHaveText("за вход в Пещ за пици");
  const pw = page.locator("a[data-pw]");
  await expect(pw).toHaveText("Влез с парола");
  await expect(pw).toHaveAttribute("href", "/admin/vhod/#next=%2Fkuhnya%2F");
  await pw.click();
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fkuhnya%2F$/);
  /* the section waits for the person on this tablet */
  expect(await page.evaluate(() => localStorage.getItem("sk-sec"))).toBe('"pesht"');
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop a known device: the module asks for the PIN; the section + the person + 4 digits, a wrong PIN, the right one opens the screen it came from", async ({ browser }) => {
  const who = await newKitchen();
  const { ctx, page, errs } = await tablet(browser, { known: true });
  await page.goto("/kuhnya/izpalneni/");
  await expect(page).toHaveURL(/\/kuhnya\/vhod\/#next=%2Fkuhnya%2Fizpalneni%2F$/);
  await expect(page.locator(".pin h2")).toHaveText(/^Личен ПИНза вход в /);
  await expect(page.locator(".pinpad button")).toHaveText(["1", "2", "3", "4", "5", "6", "7", "8", "9", "Изчисти", "0", ""]);
  await expect(page.locator('.pinpad [data-k="b"]')).toHaveAccessibleName("Изтрий една цифра");
  await expect(page.locator(".dots i")).toHaveCount(4);
  await expect(page.locator(".pw a")).toHaveText("Вход с потребител и парола");
  await expect(page.locator(".pw a")).toHaveAttribute("href", "/admin/vhod/#next=%2Fkuhnya%2Fizpalneni%2F");
  /* no "Изход" and no theme before the sign-in */
  await expect(page.locator("[data-out]")).toHaveCount(0);
  await page.locator('[data-sec="skara"]').click();
  await expect(page.locator(".pin h2 small")).toHaveText("за вход в Скара Bertha");
  await expect(page.locator("button[data-go]")).toHaveText("Влез · Скара Bertha");
  /* the person (decision of the chief 18.11): the people with the role "Кухня" and a PIN, never a user name */
  await expect(page.locator(".who .lbl")).toHaveText("Кой влиза?");
  const chip = page.locator("[data-who]", { hasText: who.name });
  await expect(chip).toHaveCount(1);
  await expect(page.locator(".who")).not.toContainText(who.username);
  if ((await page.locator("[data-who]").count()) > 1) {
    await keys(page, "1234"); await page.locator("button[data-go]").click();
    await expect(page.locator("[data-err]")).toHaveText("Първо избери кой влиза.");
    await page.locator('.pinpad [data-k="c"]').click();
  }
  await chip.click();
  await expect(chip).toHaveAttribute("aria-pressed", "true");
  /* fewer than 4 digits */
  await keys(page, "12");
  await expect(page.locator(".dots i.on")).toHaveCount(2);
  await page.locator("button[data-go]").click();
  await expect(page.locator("[data-err]")).toHaveText("Въведи 4 цифри.");
  await expect(page.locator("[data-err]")).toHaveAttribute("role", "status");
  await page.locator('.pinpad [data-k="b"]').click();
  await expect(page.locator(".dots i.on")).toHaveCount(1);
  await page.locator('.pinpad [data-k="c"]').click();
  await expect(page.locator(".dots i.on")).toHaveCount(0);
  /* a wrong PIN (an easy one: nobody may have it) */
  await keys(page, "0000");
  await page.locator("button[data-go]").click();
  await expect(page.locator("[data-err]")).toHaveText("Грешен ПИН. Опитай пак.");
  await expect(page.locator(".dots")).toHaveClass(/\berr\b/);
  await expect(page.locator(".dots i.on")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("sk-sec"))).toBeNull();
  /* the right PIN from the keyboard of the tablet */
  await page.keyboard.type(who.pin);
  await expect(page.locator(".dots i.on")).toHaveCount(4);
  await expect(page.locator("[data-err]")).toHaveText("");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/kuhnya\/izpalneni\/$/);
  await expect(page.locator(".ksec b")).toHaveText("Скара Bertha");
  await expect(page.locator("h1")).toHaveText("Изпълнени днес");
  expect(await page.evaluate(() => localStorage.getItem("sk-sec"))).toBe('"skara"');
  const me = (await (await ctx.request.get("/api/auth/me")).json()) as { user: { username: string } };
  expect(me.user.username).toBe(who.username);
  expect(await page.evaluate(() => localStorage.getItem("sk-who"))).not.toBeNull();
  /* signed in: "Смени секцията" is the choice without a PIN, with "Изход" */
  await page.locator(".ksec").click();
  await expect(page).toHaveURL(/\/kuhnya\/vhod\/$/);
  await expect(page.locator("[data-pin] *")).toHaveCount(0);
  await expect(page.locator(".pin h2 small")).toHaveText("Вход: " + who.name + " (Кухня)");
  expect(errs).toEqual([]);
  await ctx.close();
});

test("@desktop the lockout per person (own server): the last tries are counted, then the core's text and the countdown; a colleague still signs in on the same tablet", async ({ browser }) => {
  test.setTimeout(90_000);
  const S = await ownServer("kpin", 22);
  try {
    const a = await newKitchen(S.base), b = await newKitchen(S.base);
    const { ctx, page, errs } = await tablet(browser, { known: true, base: S.base });
    await page.goto("/kuhnya/vhod/");
    await expect(page.locator(".pinpad")).toBeVisible();
    await page.locator("[data-who]", { hasText: a.name }).click();
    const tryPin = async () => { await keys(page, "0000"); await page.locator("button[data-go]").click(); };
    await tryPin();
    await expect(page.locator("[data-err]")).toHaveText("Грешен ПИН. Опитай пак.");
    await tryPin();
    await expect(page.locator("[data-err]")).toHaveText("Грешен ПИН. Опитай пак. Остават 3 опита, после входът се заключва за 15 минути.");
    await tryPin(); await expect(page.locator("[data-err]")).toContainText("Остават 2 опита");
    await tryPin(); await expect(page.locator("[data-err]")).toContainText("Остава 1 опит");
    await tryPin();
    await expect(page.locator("[data-err]")).toHaveText("Твърде много грешни опити. Опитай след 15 минути или влез с парола.");
    const go = page.locator("button[data-go]");
    await expect(go).toBeDisabled();
    await expect(go).toHaveText(/^Заключено · 1[45]:\d\d$/);
    const t0 = await go.textContent();
    await expect(go).not.toHaveText(t0!, { timeout: 3000 }); /* it counts down */
    /* the keypad waits too; the password stays open */
    await page.locator('.pinpad [data-k="1"]').click();
    await expect(page.locator(".dots i.on")).toHaveCount(0);
    await expect(page.locator(".pw a")).toBeVisible();
    /* the colleague on the same tablet: never one lock for the whole kitchen (review 2, important 4) */
    await page.reload();
    await page.locator("[data-who]", { hasText: b.name }).click();
    await keys(page, b.pin); await page.locator("button[data-go]").click();
    await expect(page).toHaveURL(/\/kuhnya\/$/);
    expect(((await (await ctx.request.get("/api/auth/me")).json()) as { user: { username: string } }).user.username).toBe(b.username);
    expect(errs).toEqual([]);
    await ctx.close();
  } finally { await S.stop(); }
});

for (const [w, h] of [[1280, 800], [1024, 768], [768, 1024]] as [number, number][]) for (const theme of ["dark", "light"] as const) {
  test(`@desktop ${w} × ${h} ${theme}: the PIN step fits, no horizontal scroll, targets of 48 px, axe`, async ({ browser }) => {
    await someone();
    const { ctx, page, errs } = await tablet(browser, { w, h, theme, known: true });
    await page.goto("/kuhnya/vhod/");
    await expect(page.locator(".pinpad")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, document.querySelector(".lg")!.scrollWidth - innerWidth))).toBeLessThanOrEqual(0);
    const g = await page.evaluate(() => {
      const small: string[] = [];
      document.querySelectorAll<HTMLElement>(".lg a[href], .lg button").forEach((el) => { const b = el.getBoundingClientRect(); if (b.height < 48 || b.width < 48) small.push(el.className + " " + Math.round(b.width) + "×" + Math.round(b.height)); });
      const go = document.querySelector("button[data-go]")!.getBoundingClientRect();
      return { small, goBottom: go.bottom, desc: [...document.querySelectorAll<HTMLElement>(".sct .d")].filter((x) => x.offsetParent !== null).length };
    });
    expect(g.small).toEqual([]);
    /* "Влез" is on the first screen; at 768 the compact sign-in (no descriptions on the tiles) */
    expect(g.goBottom).toBeLessThanOrEqual(h);
    if (w < 900) expect(g.desc).toBe(0); else expect(g.desc).toBeGreaterThan(0);
    /* the error state (said on the tablet, no try is spent) */
    await page.locator("[data-who]").first().click();
    await keys(page, "00"); await page.locator("button[data-go]").click();
    await expect(page.locator("[data-err]")).toHaveText("Въведи 4 цифри.");
    expect(await serious(page)).toEqual([]);
    expect(errs).toEqual([]);
    await ctx.close();
  });
}
