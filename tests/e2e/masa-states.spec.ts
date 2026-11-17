import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PV, codeOf, staff, tableN, watch, guest, tok, noHScroll, smallTargets } from "./masa-helpers.ts";
import { E } from "./own-server.ts";

/* QR маса · the states: the invalid code (no table in the top bar, no nav), the kitchen closed (the preview clock 23:00:
   browsing only, sending stopped with the explanation), no connection (context.setOffline: „Няма връзка. Поръчката ви е
   запазена - опитайте пак.“ and „Опитай пак“), English for the module's own texts; every screen: axe without serious
   violations, no horizontal scroll at 360, targets of at least 48 px, no console errors. */
test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD || !E.WAITER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });
const SCREENS = ["", "menu/", "kolichka/", "povikvane/", "smetka/"];

test("an invalid code: „Този код вече не работи“, no table in the top bar, no nav, on every screen", async ({ page }) => {
  const errs = watch(page);
  for (const s of SCREENS) {
    await page.goto("/masa/zzzzzzzz/" + s + PV);
    await expect(page.locator(".gate h1")).toHaveText("Този код вече не работи");
    await expect(page.locator(".gate")).toContainText("Попитайте сервитьора");
    await expect(page.locator("[data-mtab]")).toBeHidden();
    await expect(page.locator("[data-mnav]")).toBeHidden();
    await expect(page.locator("[data-mdnav]")).toBeHidden();
    await expect(page.locator(".gate a", { hasText: "Разгледай менюто" })).toHaveAttribute("href", "/menu/");
  }
  expect(errs).toEqual([]);
});

test("the kitchen closed (23:00): the menu is for browsing, no „+“, sending stopped with the reason and „Повикай сервитьор“", async ({ page, browser, baseURL }) => {
  const errs = watch(page);
  const n = tableN(page, 6), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const A = tok("late" + n), G = guest(W.r, t.code, A);
  try {
    await G.open(true); await G.add("tiramisu"); /* added at 19:42, the page opens at 23:00 */
    await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
    await page.goto("/masa/" + t.code + "/?preview=1&t=23:00");
    await expect(page.locator(".wl-lead")).toHaveText("Разгледайте менюто и повикайте сервитьор, ако ви трябва нещо.");
    await page.goto("/masa/" + t.code + "/menu/?preview=1&t=23:00");
    await expect(page.locator("[data-mlead]")).toHaveText("Кухнята затвори за днес. Менюто е за разглеждане.");
    await expect(page.locator(".mnote.warn").first()).toContainText("Кухнята приема поръчки до 22:30");
    await expect(page.locator("[data-madd]")).toHaveCount(0);
    await expect(page.locator(".mrow").first()).toBeVisible();
    await expect(page.locator("[data-cgo]")).toContainText("Виж количката · 4,09 €");
    await page.goto("/masa/" + t.code + "/kolichka/?preview=1&t=23:00");
    const bar = page.locator("[data-nosend]").filter({ visible: true });
    await expect(bar).toHaveText("Кухнята приема поръчки до 22:30");
    await expect(page.locator(".mnote.warn a", { hasText: "Повикай сервитьор" })).toBeVisible();
    await expect(page.locator(".sum .how")).toHaveCount(0);
    /* the core refuses it too */
    const r = await W.r.post("/api/floor/t/" + t.code + "/send", { headers: { "x-sc-clock": "23:00" }, data: { g: A } });
    expect([r.status(), (await r.json()).error]).toEqual([409, "closed"]);
    expect(errs).toEqual([]);
  } finally { await W.clear(n).catch(() => {}); await W.ctx.close(); }
});

test("no connection: the banner, sending / calling / the bill stopped with „Опитай пак“, back online", async ({ page, browser, baseURL, context }) => {
  const errs = watch(page);
  const n = tableN(page, 6), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const A = tok("off" + n), G = guest(W.r, t.code, A);
  try {
    await G.open(true); await G.add("shopska-salata");
    await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
    await page.goto("/masa/" + t.code + "/kolichka/" + PV);
    await expect(page.locator(".cl")).toHaveCount(1);
    await context.setOffline(true);
    const note = page.locator(".mnote.bad");
    await expect(note).toContainText("Няма връзка");
    await expect(note).toContainText("Поръчката ви е запазена - опитайте пак.");
    await expect(page.locator("[data-send]")).toHaveCount(0);
    await expect(page.locator("[data-mretry]").filter({ visible: true }).first()).toContainText(/Опитай пак/);
    /* calling: stopped too */
    await context.setOffline(false);
    await page.goto("/masa/" + t.code + "/povikvane/" + PV);
    await context.setOffline(true);
    await expect(page.locator(".mnote.bad")).toContainText("Няма връзка");
    await expect(page.locator('[data-call="water"]')).toHaveAttribute("aria-disabled", "true");
    await page.locator('[data-call="water"]').dispatchEvent("click");
    await expect(page.locator(".toast")).toContainText("Няма връзка");
    /* „Опитай пак“ while still offline: the banner stays */
    await page.locator(".mnote.bad [data-mretry]").click();
    await expect(page.locator(".mnote.bad")).toContainText("Няма връзка");
    /* back online: the screen reads the table again by itself */
    await context.setOffline(false);
    await expect(page.locator(".mnote.bad")).toHaveCount(0);
    await expect(page.locator(".toast")).toContainText("Връзката се върна");
    await expect(page.locator('[data-call="water"]')).not.toHaveAttribute("aria-disabled", "true");
    expect(errs).toEqual([]);
  } finally { await context.setOffline(false); await W.clear(n).catch(() => {}); await W.ctx.close(); }
});

test("English for the module's texts, the dish names stay Bulgarian with the [ЛИПСВА] note; the language is per phone", async ({ page, browser, baseURL }) => {
  const n = tableN(page, 6), t = await codeOf(browser, baseURL!, n);
  await page.goto("/masa/" + t.code + "/" + PV);
  await page.locator('.wl-lang [data-mlang="en"]').click();
  await expect(page.locator(".wl-t")).toHaveText("Table " + n);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-mtab]")).toContainText("Table " + n);
  await expect(page.locator(".wl-menu")).toContainText("[ЛИПСВА: английски имена и състав на ястията]");
  await page.goto("/masa/" + t.code + "/menu/" + PV);
  await expect(page.locator("#mm-h")).toHaveText("Menu");
  await expect(page.locator('[data-row="kebapcheta"] .meta')).toContainText("450 g");
  await expect(page.locator('[data-row="kebapcheta"] .nm')).toHaveText("Кебапчета");
  /* the header button goes back */
  await page.locator(".mtop [data-mlang]").click();
  await expect(page.locator("#mm-h")).toHaveText("Меню");
});

for (const w of [360, 0]) {
  test("every screen with content: axe, " + (w ? "360 px no horizontal scroll, " : "") + "48 px targets, the profile sheet", async ({ page, browser, baseURL }) => {
    test.setTimeout(90_000);
    if (w) await page.setViewportSize({ width: w, height: 780 });
    const errs = watch(page);
    const n = tableN(page, w ? 6 : 6), t = await codeOf(browser, baseURL!, n);
    const W = await staff(browser, baseURL!, "waiter");
    await W.clear(n);
    const A = tok("axe" + w + n), G = guest(W.r, t.code, A);
    try {
      await G.open(true); await G.add("pitsa-margarita"); await G.send(); await W.confirm(n); await G.add("tiramisu"); await G.call("water");
      await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
      for (const s of SCREENS) {
        await page.goto("/masa/" + t.code + "/" + s + PV);
        await expect(page.locator("main .mpage")).toBeVisible();
        await expect(page.locator(".msk")).toHaveCount(0);
        if (w) await noHScroll(page);
        expect(await smallTargets(page), s).toEqual([]);
        const a = await new AxeBuilder({ page }).analyze();
        expect(a.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => s + " " + v.id + ": " + v.nodes.map((x) => x.target.join(" ")).slice(0, 3).join(" | ")), s).toEqual([]);
      }
      /* the profile sheet: language, my orders, the sign-in, the theme */
      await page.locator("[data-mprofile]").filter({ visible: true }).click();
      const sh = page.locator(".sheetwrap.on .sheet");
      await expect(sh.locator(".sheet-h h2")).toHaveText("Профил");
      await expect(sh).toContainText("Моите поръчки на тази маса");
      await expect(sh.locator(".pline")).toContainText("Пица Маргарита");
      await expect(sh).toContainText("Вход по желание");
      if (w) await noHScroll(page);
      const a = await new AxeBuilder({ page }).include(".sheetwrap.on").analyze();
      expect(a.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id)).toEqual([]);
      /* the sign-in through the site's SMS sign-in: the code is shown (SMS_DEMO) */
      await sh.locator("#ml-ph").fill("0888" + String(Date.now()).slice(-6));
      await sh.locator(".mlog [type=submit]").click();
      const demo = sh.locator("[data-mdemo]");
      await expect(demo).toHaveText(/^\d{6}$/);
      await sh.locator("#ml-code").fill((await demo.textContent())!);
      await sh.locator(".mlog [type=submit]").click();
      await expect(sh.locator("[data-login]")).toContainText("Влезли сте");
      await sh.locator('[data-mtheme="dark"]').click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      expect(errs).toEqual([]);
    } finally { await W.clear(n).catch(() => {}); await W.ctx.close(); }
  });
}

test("the menu: the shared search (Latin, „без …“), the filters, the allergen sheet; „Изчерпано днес“ stays visible without „+“; breakfast „до 11:30“ @phone", async ({ page, browser, baseURL }) => {
  const errs = watch(page);
  const n = tableN(page, 6), t = await codeOf(browser, baseURL!, n);
  const K = await staff(browser, baseURL!, "kitchen");
  try {
    expect((await K.r.put("/api/admin/menu/sufle/sold-out", { data: { out: true } })).status()).toBe(200);
    await page.goto("/masa/" + t.code + "/menu/" + PV);
    await expect(page.locator("[data-count]")).toHaveText("113 ястия · 14 категории");
    /* sold out: visible, the badge, no "+" (the live menu comes after the first paint) */
    const sold = page.locator('[data-row="sufle"]');
    await expect(sold).toHaveClass(/out/);
    await expect(sold).toContainText("Изчерпано днес");
    await expect(sold.locator("[data-madd]")).toHaveCount(0);
    /* breakfast after 11:30: no "+", "до 11:30" */
    const bf = page.locator('[data-row="angliyska-zakuska"]');
    await expect(bf.locator(".later")).toHaveText("до 11:30");
    await expect(bf.locator("[data-madd]")).toHaveCount(0);
    /* the search of the site: Latin, the chip „без …“ */
    await page.locator("#mq").fill("kebap");
    await expect(page.locator('[data-row="kebapcheta"]')).toBeVisible();
    await expect(page.locator(".mcat").first().locator("h2")).toHaveText("По име");
    await page.locator("#mq").fill("пица без лук");
    await expect(page.locator(".qchips")).toContainText("без лук");
    await page.locator("[data-qclr]").click();
    await expect(page.locator("[data-count]")).toHaveText("113 ястия · 14 категории");
    /* a filter and the allergen sheet */
    await page.locator('[data-f="veg"]').click();
    await expect(page.locator("[data-count]")).toContainText("Показваме");
    await expect(page.locator('[data-row="kebapcheta"]')).toHaveCount(0);
    await page.locator("[data-al]").click();
    const sh = page.locator(".sheetwrap.on .sheet");
    await sh.locator('[data-alk="milk"]').check();
    await sh.locator("[data-shok]").click();
    await expect(page.locator("[data-al] .dot")).toHaveText("1");
    await page.locator("[data-clr]").first().click();
    await expect(page.locator("[data-count]")).toHaveText("113 ястия · 14 категории");
    /* the dish sheet: composition and allergens, preliminary */
    await page.locator('[data-mdish="kebapcheta"]').click();
    await expect(sh.locator(".dsh")).toContainText("Предварително, от състава. Чака потвърждение от кухнята.");
    await expect(sh.locator("[data-madd]")).toContainText("Добави в общата количка · 7,61 €");
    expect(errs).toEqual([]);
  } finally {
    await K.r.put("/api/admin/menu/sufle/sold-out", { data: { out: false } });
    await K.ctx.close();
  }
});
