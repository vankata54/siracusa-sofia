import { test, expect, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import path from "node:path";

/* The pencil (src/admin/pencil.ts) on pages of the site, before the admin frame uses it: the module is bundled here and
   put into the page (window.Pen), the notes go to window.__notes. The admin frame adds its own e2e when it mounts it.
   Checks: the round button (56 px, "Молив", the tip), mouse / keyboard / touch, "Разшири" / "Стесни", the sheet
   ("Какво да се промени?" / "Какво да подобрим?"), the error under the field, Ctrl+Enter, Esc, the focus, the toast,
   the badge, the slot, the frame of the preview (same origin), and the pure part: a unique, short selector and the
   label of a field, never its value. */

const code = buildSync({ entryPoints: [path.resolve("src/admin/pencil.ts")], bundle: true, format: "iife", globalName: "Pen", write: false, target: "es2022" }).outputFiles[0].text;
type Opts = { sectionNotes?: boolean; slot?: string; badge?: number; frame?: boolean; fail?: boolean };

async function mount(page: Page, path0: string, o: Opts = {}) {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto(path0);
  await page.addScriptTag({ content: code });
  await page.evaluate(async (o) => {
    const w = window as unknown as { Pen: typeof import("../../src/admin/pencil.ts"); __notes: unknown[]; __pen: ReturnType<typeof import("../../src/admin/pencil.ts").mountPencil> };
    w.__notes = [];
    let doc: (() => Document | null) | undefined;
    if (o.frame) {
      const f = document.createElement("iframe");
      f.src = "/menu/?preview=1"; f.title = "Преглед"; f.style.cssText = "position:fixed;left:0;top:0;width:390px;height:700px;border:0;z-index:30";
      document.body.appendChild(f);
      await new Promise((r) => f.addEventListener("load", r, { once: true }));
      doc = () => f.contentDocument;
    }
    w.__pen = w.Pen.mountPencil({
      module: "site", who: "Тест (Главен админ)", sectionNotes: o.sectionNotes !== false, notesHref: "/admin/belezhki/", badge: o.badge,
      slot: o.slot ? (document.querySelector(o.slot) as HTMLElement) : undefined, doc,
      onSave: async (n) => { if (o.fail) throw new Error("Няма връзка. Проверете интернета и опитайте пак."); w.__notes.push(n); },
    });
  }, o);
}
const ui = (page: Page) => page.locator("sa-pen-ui");
const fab = (page: Page) => ui(page).locator("[data-fab]");
const notes = (page: Page) => page.evaluate(() => (window as unknown as { __notes: Record<string, unknown>[] }).__notes);

test("pure part: every target has a unique, short selector; a field gives its label, never its value", async ({ page }) => {
  await mount(page, "/kontakti/");
  await page.locator("#f-name").fill("Иван Петров");
  await page.locator("#f-contact").fill("0888 12 34 56");
  await page.locator("#f-msg").fill("Тайна бележка ivan@abv.bg");
  const r = await page.evaluate(() => {
    const P = (window as unknown as { Pen: typeof import("../../src/admin/pencil.ts") }).Pen;
    const all = Array.from(document.querySelectorAll("main a, main button, main input, main textarea, main h1, main h2, main label, footer a, header a, .nav a"));
    const bad: string[] = [];
    let max = 0, sum = 0;
    for (const el of all) {
      const s = P.selectorFor(el);
      const l = document.querySelectorAll(s);
      if (l.length !== 1 || l[0] !== el) bad.push(s);
      max = Math.max(max, s.length); sum += s.length;
    }
    /* a password field and an editable block, added for the test */
    const f = document.createElement("form");
    f.innerHTML = '<label for="t-pw">Парола</label><input id="t-pw" type="password" value="tajna-123"><label>Имейл <input type="email" placeholder="ivan@abv.bg" value="ivan@abv.bg"></label><div contenteditable="true" aria-label="Бележка">лично 0888 765 432</div><select aria-label="Час"><option>19:00</option></select>';
    document.querySelector("main")!.appendChild(f);
    return {
      n: all.length, bad, max, avg: sum / all.length,
      h1: P.selectorFor(document.querySelector("main h1")!),
      name: P.elementText(document.querySelector("#f-name")!),
      contact: P.elementText(document.querySelector("#f-contact")!),
      msg: P.elementText(document.querySelector("#f-msg")!),
      form: P.elementText(document.querySelector("#f-msg")!.closest("form")!),
      pw: P.elementText(f.querySelector("#t-pw")!),
      mail: P.elementText(f.querySelector("[type=email]")!),
      ce: P.elementText(f.querySelector("[contenteditable]")!),
      sel: P.elementText(f.querySelector("select")!),
      own: P.elementText(f),
      phoneText: (() => { const p = document.createElement("p"); p.textContent = "Обадете се на 0894 36 55 77 или пишете на menu@siracusa-sofia.com"; document.querySelector("main")!.appendChild(p); return P.elementText(p); })(),
    };
  });
  expect(r.n).toBeGreaterThan(20);
  expect(r.bad).toEqual([]);
  expect(r.max).toBeLessThanOrEqual(120);
  expect(r.avg).toBeLessThan(45);
  expect(r.h1.length).toBeLessThanOrEqual(20);
  expect(r.name).toBe("Вашето име");
  expect(r.contact).toBe("Как да ви отговорим?");
  expect(r.msg).toBe("Съобщение");
  expect(r.pw).toBe("Парола");
  expect(r.mail).toBe("Имейл");
  expect(r.ce).toBe("Бележка");
  expect(r.sel).toBe("Час");
  const all = JSON.stringify(r);
  for (const v of ["Иван", "0888 12 34 56", "Тайна", "ivan@abv.bg", "tajna", "0888 765 432", "лично"]) expect(all).not.toContain(v);
  expect(r.phoneText).toBe("Обадете се на [телефон] или пишете на [имейл]");
});

test("@desktop mouse: the round button, the tip, outline, the sheet, the error, Ctrl+Enter, the toast, Esc", async ({ page }) => {
  await mount(page, "/menu/");
  const b = fab(page);
  await expect(b).toHaveAttribute("aria-label", "Молив");
  await expect(b).toHaveText("");
  const box = (await b.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(56);
  expect(box.height).toBeGreaterThanOrEqual(56);
  await b.hover();
  await expect(ui(page).locator(".tip")).toHaveText("Молив: бележка за промяна");
  await expect(ui(page).locator(".tip")).toHaveCSS("opacity", "1");
  await b.click();
  await expect(b).toHaveAttribute("aria-pressed", "true");
  await expect(b).toHaveAttribute("aria-label", "Изключи молива");
  await expect(ui(page).locator(".bar")).toHaveText(/Моливът е включен · Изберете елемент · Esc за изход/);
  /* the pointer outlines; a click picks, and the page does not follow the link */
  const link = page.locator("main a[href]").first();
  await link.scrollIntoViewIfNeeded();
  await page.locator("#mh1").scrollIntoViewIfNeeded();
  await page.locator("#mh1").hover();
  await expect(page.locator("sa-pen-layer").locator(".box")).toHaveClass(/on/);
  await expect(page.locator("sa-pen-layer").locator(".lab")).toHaveText("Заглавие „Меню“");
  await page.locator("#mh1").click();
  const sh = ui(page).locator(".sheet");
  await expect(sh.locator("h2")).toHaveText("Какво да се промени?");
  await expect(sh.locator("textarea")).toBeFocused();
  await expect(sh.locator(".meta")).toContainText("Клиентски сайт");
  await expect(sh.locator(".meta")).toContainText("1440 × 900");
  await expect(sh.locator(".quote")).toContainText("„Меню“");
  await expect(sh.locator("details")).not.toHaveAttribute("open", "");
  await expect(sh.locator("details dd").nth(1)).toHaveText("#mh1");
  await sh.locator("[data-save]").click();
  await expect(sh.locator(".err")).toHaveText("Напишете какво да се промени.");
  await expect(sh.locator("textarea")).toHaveAttribute("aria-invalid", "true");
  await expect(sh.locator("textarea")).toBeFocused();
  await page.keyboard.type("По-голямо заглавие");
  await expect(sh.locator(".err")).toBeHidden();
  await page.keyboard.press("Control+Enter");
  await expect(ui(page).locator(".toast")).toContainText("Бележката е записана");
  await expect(ui(page).locator(".toast a")).toHaveText("Виж бележките");
  const n = (await notes(page))[0];
  expect(n).toEqual({ module: "site", url: "/menu/", selector: "#mh1", editId: null, text: "По-голямо заглавие", elementText: "Меню", viewport: { w: 1440, h: 900 }, screenshot: null });
  await expect(ui(page).locator(".bar")).toContainText("Записани: 1");
  /* after the sheet the focus is back on the element (a heading: the round button) */
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("SA-PEN-UI");
  /* a link is picked, not followed */
  await link.click();
  await expect(ui(page).locator(".sheet textarea")).toBeFocused();
  expect(new URL(page.url()).pathname).toBe("/menu/");
  await page.keyboard.press("Escape");
  await expect(ui(page).locator(".sw")).not.toHaveClass(/on/);
  await page.keyboard.press("Escape");
  await expect(b).toHaveAttribute("aria-pressed", "false");
  await expect(ui(page).locator(".bar")).not.toHaveClass(/on/);
});

test("@desktop keyboard: Enter on the button, Tab outlines, ↑ / ↓ widen and narrow, Enter picks, Esc returns the focus", async ({ page }) => {
  await mount(page, "/kontakti/", { sectionNotes: false });
  await fab(page).focus();
  await expect(ui(page).locator(".tip")).toHaveCSS("opacity", "1");
  await expect(ui(page).locator(".tip")).toHaveText("Молив: препоръка");
  await page.keyboard.press("Enter");
  await expect(ui(page).locator(".bar")).toContainText("Препоръка");
  await page.locator("#f-name").focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator("sa-pen-layer .lab")).toHaveText("Поле „Вашето име“");
  await expect(ui(page).locator("[data-pick]")).toBeVisible();
  await page.keyboard.press("ArrowUp");
  await expect(ui(page).locator("[data-down]")).toBeVisible();
  await expect(page.locator("sa-pen-layer .lab")).not.toHaveText("Поле „Вашето име“");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("sa-pen-layer .lab")).toHaveText("Поле „Вашето име“");
  await page.keyboard.press("Enter");
  const sh = ui(page).locator(".sheet");
  await expect(sh.locator("h2")).toHaveText("Какво да подобрим?");
  await expect(sh).toContainText("Препоръката отива при главния админ. Тя не променя нищо, докато той не я одобри.");
  await expect(sh.locator("[data-save]")).toHaveText("Изпрати препоръката");
  await expect(sh.locator("textarea")).toBeFocused();
  /* Tab stays in the sheet */
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => document.activeElement?.tagName)).toBe("SA-PEN-UI"); }
  await page.keyboard.press("Escape");
  await expect(page.locator("#f-name")).toBeFocused();
  await expect(ui(page).locator(".bar")).toHaveClass(/on/);
  await page.keyboard.press("Escape");
  await expect(fab(page)).toHaveAttribute("aria-pressed", "false");
});

test("@phone touch: the first tap outlines, the second picks; the button hides under a sheet and a toast and goes up over a bar", async ({ page }) => {
  await mount(page, "/menu/", { sectionNotes: false, badge: 1 });
  const b = fab(page);
  await expect(b).toHaveAttribute("aria-label", "Молив, 1 препоръка с нов статус");
  await expect(b.locator(".n")).toHaveText("1");
  const r0 = (await b.boundingBox())!;
  const nav = (await page.locator(".ov .nav").boundingBox())!;
  expect(r0.y + r0.height).toBeLessThanOrEqual(nav.y);
  await page.evaluate(() => document.querySelector("sa-pen-ui")!.setAttribute("data-up", ""));
  await expect.poll(async () => (await b.boundingBox())!.y).toBeLessThan(r0.y - 60);
  await page.evaluate(() => document.querySelector("sa-pen-ui")!.removeAttribute("data-up"));
  await b.tap();
  await expect(ui(page).locator(".bar")).toContainText("Докоснете елемент");
  await expect(ui(page).locator(".bar")).not.toContainText("Esc");
  /* the title at the top: the first tap outlines it (the bar is short), "Бележка за това" picks it (a second tap would
     land on the bar, which covers the top of the page) */
  await page.locator("#mh1").tap();
  await expect(ui(page).locator(".bar")).toContainText("Оградено: Заглавие „Меню“");
  await expect(ui(page).locator("[data-pick]")).toBeVisible();
  await ui(page).locator("[data-pick]").tap();
  await expect(ui(page).locator(".sheet h2")).toHaveText("Какво да подобрим?");
  await expect(b).toBeHidden();
  await ui(page).locator("[data-x]").first().tap();
  await expect(ui(page).locator(".sw")).not.toHaveClass(/on/);
  /* a heading in the middle of the screen: the first tap outlines, the second picks */
  const h2 = page.locator("main h2").first();
  await page.evaluate(() => { const r = document.querySelector("main h2")!.getBoundingClientRect(); window.scrollBy(0, r.top - innerHeight / 2); });
  await h2.tap();
  await expect(ui(page).locator(".bar")).toContainText("Оградено:");
  await h2.tap();
  await expect(ui(page).locator(".sheet h2")).toHaveText("Какво да подобрим?");
  await expect(b).toBeHidden();
  await ui(page).locator("textarea").fill("По-голямо");
  await ui(page).locator("[data-save]").tap();
  await expect(ui(page).locator(".toast")).toContainText("Препоръката е изпратена");
  await expect(ui(page).locator(".toast a")).toHaveText("Моите препоръки");
  await expect(ui(page)).toHaveAttribute("data-pen-toast", "");
  await expect(b).toHaveCSS("opacity", "0");
  expect((await notes(page))[0]).toMatchObject({ module: "site", viewport: { w: 390, h: 844 } });
  expect(await page.evaluate((s) => document.querySelectorAll(s).length === 1 && document.querySelector(s) === document.querySelector("main h2"), (await notes(page))[0].selector as string)).toBe(true);
  /* the sheet on the phone: no horizontal scroll */
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("a failed save keeps the sheet with the message under the field; the slot button; setBadge; destroy", async ({ page }) => {
  await mount(page, "/menu/", { fail: true, slot: "footer.foot .legal" });
  await expect(fab(page)).toHaveCount(0);
  const btn = page.locator("footer.foot .sa-pen-btn");
  await expect(btn).toHaveText("Молив");
  await expect(btn).toHaveAttribute("aria-label", "Молив");
  await btn.scrollIntoViewIfNeeded();
  expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  await page.evaluate(() => (window as unknown as { __pen: { setBadge(n: number): void } }).__pen.setBadge(2));
  await expect(btn).toHaveAttribute("aria-label", "Молив, 2 препоръки с нов статус");
  await btn.click();
  await expect(btn).toHaveText("Изключи");
  await expect(btn).toHaveAttribute("aria-pressed", "true");
  await page.locator("footer.foot h3").first().click();
  await ui(page).locator("textarea").fill("Нещо");
  await ui(page).locator("[data-save]").click();
  await expect(ui(page).locator(".err")).toHaveText("Няма връзка. Проверете интернета и опитайте пак.");
  await expect(ui(page).locator(".sw")).toHaveClass(/on/);
  await page.evaluate(() => (window as unknown as { __pen: { destroy(): void } }).__pen.destroy());
  await expect(page.locator("sa-pen-ui, sa-pen-layer, .sa-pen-btn")).toHaveCount(0);
});

test("@desktop the frame of the preview: outline in the frame, the sheet in the page, the address of the frame", async ({ page }) => {
  await mount(page, "/kontakti/", { frame: true });
  await fab(page).click();
  const frame = page.frameLocator("iframe[title=Преглед]");
  await frame.locator("#mh1").hover();
  await expect(frame.locator("sa-pen-layer .lab")).toHaveText("Заглавие „Меню“");
  await frame.locator("#mh1").click();
  await expect(ui(page).locator(".sheet h2")).toHaveText("Какво да се промени?");
  await expect(ui(page).locator(".meta")).toContainText("390 × 700");
  await ui(page).locator("textarea").fill("В рамката");
  await ui(page).locator("[data-save]").click();
  expect((await notes(page))[0]).toMatchObject({ url: "/menu/", selector: "#mh1", viewport: { w: 390, h: 700 } });
  /* Esc in the page turns it off (the frame may not have the focus) */
  await page.locator("body").press("Escape");
  await expect(fab(page)).toHaveAttribute("aria-pressed", "false");
});
