import { test, expect, type Page } from "@playwright/test";

/* Profile (/profil/): invitation without a profile; signed in through the API (smsRequest -> demoCode -> smsVerify):
   orders with "Поръчай отново" (current menu prices, a sold-out dish is not added), favourites, consents (marketing off
   by default), name and email, theme, export, delete with an in-page confirmation, logout. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|409|422)/.test(m.text())) errors.push(m.text()); });
  return errors;
}
const phoneNo = () => "0887" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
const line = (id: string, q: number) => ({ key: id, id, q, mods: [], extra: 0 });

/** signs in through the API in this browser context (cookie) and optionally places orders and favourites */
async function signIn(page: Page, opts: { orders?: boolean; favs?: string[]; name?: string } = {}) {
  const phone = phoneNo();
  await page.goto("/?preview=1&t=12:30");
  await page.evaluate(async ([phone, o]) => {
    localStorage.setItem("sc-cookie", '"min"');
    localStorage.removeItem("sc-cart");
    const j = async (m: string, u: string, b?: unknown) => {
      const r = await fetch("/api/" + u, { method: m, headers: { "content-type": "application/json", "x-sc-clock": "12:30" }, body: b ? JSON.stringify(b) : undefined });
      const d = await r.json(); if (!r.ok) throw new Error(u + ": " + JSON.stringify(d)); return d;
    };
    const r = await j("POST", "auth/sms/request", { phone });
    const v = await j("POST", "auth/sms/verify", { phone, code: r.demoCode, name: o.name || "Мария" });
    localStorage.setItem("sc-user", JSON.stringify(v.customer));
    const L = (id: string, q: number) => ({ key: id, id, q, mods: [], extra: 0 });
    if (o.orders) {
      await j("POST", "orders", { cart: { mode: "delivery", lines: [L("pitsa-margarita", 2), L("tiramisu", 1)] }, zone: "Дружба 2", addr: "бл. 311", name: "Мария", phone, pay: "cash" });
    }
    for (const id of o.favs || []) await j("POST", "me/favorites", { id });
  }, [phone, opts] as const);
  return phone;
}
const open = (page: Page, t = "12:30") => page.goto("/profil/?preview=1&t=" + t);

test("profile: noindex, invitation to sign in without a profile", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => localStorage.setItem("sc-cookie", '"min"'));
  await open(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Вашият профил");
  await expect(page.locator(".inv [data-login]")).toHaveAttribute("href", "/vhod/");
  await expect(page.locator(".inv")).toContainText("от следващата поръчка");
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("profile: orders and 'Поръчай отново' with menu prices, undo", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, { orders: true });
  await open(page);
  await expect(page.locator("h1")).toHaveText("Здравейте, Мария");
  await expect(page.locator(".tiles [data-nord]")).toHaveText("1");
  const ord = page.locator(".ord").first();
  await expect(ord).toContainText("Пица Маргарита");
  await expect(ord.locator(".st")).toHaveText("Приета");
  const sum = await page.evaluate(async () => { const m = await (await fetch("/api/menu")).json(); const it = (m.items || m) as { id: string; p: number }[]; const p = (id: string) => it.find((x) => x.id === id)!.p; return p("pitsa-margarita") * 2 + p("tiramisu"); });
  const btn = ord.locator("[data-re]");
  await expect(btn).toContainText("Поръчай отново · " + sum.toFixed(2).replace(".", ",") + " €");
  await btn.click();
  await expect(ord.locator("[data-gocart]")).toBeVisible();
  const cart = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}"));
  expect(cart.lines.map((l: { id: string; q: number }) => l.id + ":" + l.q).sort()).toEqual(["pitsa-margarita:2", "tiramisu:1"]);
  await page.locator(".toast button").click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").lines.length)).toBe(0);
  await expect(ord.locator('a[href^="/porachka/"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("profile: a sold-out dish stays visible and is not added again", async ({ page }) => {
  await signIn(page);
  /* the core refuses orders with a sold-out dish, so the old order with "Плескавица" comes from a stubbed answer */
  await page.route("**/api/me/orders", (r) => r.fulfill({ json: [{ no: "1100", mode: "delivery", status: "delivered", ts: Date.now() - 864e5, total: 20, lines: [line("pleskavitsa", 1), line("kebapcheta", 2)] }] }));
  await open(page);
  const ord = page.locator(".ord").first();
  await expect(ord.locator("li.out")).toContainText("Изчерпано днес");
  await expect(ord.locator(".note")).toContainText("Плескавица го няма днес");
  await ord.locator("[data-re]").click();
  const ids = await page.evaluate(() => JSON.parse(localStorage.getItem("sc-cart") || "{}").lines.map((l: { id: string }) => l.id));
  expect(ids).toEqual(["kebapcheta"]);
});

test("profile: empty orders, favourites with undo, consents off by default and saved", async ({ page }) => {
  const errors = watch(page);
  await signIn(page, { favs: ["tiramisu", "pitsa-margarita"] });
  await open(page);
  await expect(page.locator("[data-orders]")).toContainText("Още нямате поръчки");
  await expect(page.locator(".favs .dcard")).toHaveCount(2);
  await page.locator("[data-favedit]").click();
  await page.locator('[data-unfav="tiramisu"]').click();
  await expect(page.locator(".favs .dcard")).toHaveCount(1);
  await page.locator(".toast button").click();
  await expect(page.locator(".favs .dcard")).toHaveCount(2);

  const mk = page.locator('[data-sw="consent.marketing"]');
  await expect(mk).toHaveAttribute("aria-checked", "false");
  await expect(page.locator('[data-sw="consent.birthday"]')).toHaveAttribute("aria-checked", "false");
  await mk.click();
  await expect(mk).toHaveAttribute("aria-checked", "true");
  await page.locator('[data-sw="consent.birthday"]').click();
  await expect(page.locator(".needmail")).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-sw="consent.marketing"]')).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('[data-sw="consent.birthday"]')).toHaveAttribute("aria-checked", "true");
  expect(errors).toEqual([]);
});

test("profile: name and email, theme, export", async ({ page }) => {
  await signIn(page);
  await open(page);
  await page.locator('[data-sets] [data-edit="email"]').click();
  await page.locator("#e-m").fill("лошо");
  await page.locator(".sform button[type=submit]").click();
  await expect(page.locator("#e-m-err")).toBeVisible();
  await page.locator("#e-n").fill("Иван");
  await page.locator("#e-m").fill("ime@primer.bg");
  await page.locator(".sform button[type=submit]").click();
  await expect(page.locator("h1")).toHaveText("Здравейте, Иван");
  await expect(page.locator("[data-sets]")).toContainText("ime@primer.bg");

  await page.locator('[data-th="dark"]').click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator('[data-th="system"]').click();

  const dl = page.waitForEvent("download");
  await page.locator("[data-export]").click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe("siracusa-moite-danni.json");
});

test("profile: logout and delete with confirmation", async ({ page }) => {
  await signIn(page);
  await open(page);
  await page.locator("[data-logout]:visible").first().click();
  await expect(page.locator("h1")).toHaveText("Вашият профил");
  expect(await page.evaluate(async () => (await fetch("/api/me")).json())).toBeNull();

  await signIn(page);
  await open(page);
  await page.locator("[data-delask]").click();
  await expect(page.locator(".confirm")).toContainText("Да изтрием ли профила?");
  await page.locator("[data-delno]").click();
  await expect(page.locator(".confirm")).toHaveCount(0);
  await page.locator("[data-delask]").click();
  await page.locator("[data-delyes]").click();
  await expect(page.locator("h1")).toHaveText("Профилът е изтрит");
  expect(await page.evaluate(async () => (await fetch("/api/me")).json())).toBeNull();
});

test("profile: no horizontal scroll at 360 when signed in", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signIn(page, { orders: true, favs: ["tiramisu"] });
  await open(page, "23:30");
  await expect(page.locator(".ord")).toHaveCount(1);
  await expect(page.locator(".pf-closed")).toBeVisible();
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
});
