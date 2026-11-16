import { test, expect, type Page } from "@playwright/test";

/* "Предложи подобрение" (decision 15.11.2026): a small button in the footer of every page and in "Още" on the phone, no
   sign-in. src/client/suggest.ts loads only at the first tap; the sheet sends POST /api/notes/suggest (module "site",
   the page's address, the size of the screen, by choice a place on the page: never the value of a field); 429 says
   politely when the next one is possible. The test server runs with SC_PREVIEW_API=1 (limits off): the 429 is mocked. */

const SHEET_TEXT = "Какво да подобрим?";
async function noCookie(page: Page) { await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } }); }
/** the bodies of the JS files the page loaded (to see whether the suggest chunk came) */
function jsLog(page: Page) {
  const bodies: string[] = [];
  page.on("response", async (r) => { if (/\.js(\?|$)/.test(r.url())) { try { bodies.push(await r.text()); } catch { /* gone */ } } });
  return { loaded: () => bodies.some((b) => b.includes(SHEET_TEXT)) };
}
async function openFromFooter(page: Page) {
  const b = page.locator("footer.foot [data-suggest]");
  await b.scrollIntoViewIfNeeded();
  await b.click();
  await expect(page.locator(".sheetwrap.on #sg-t")).toBeFocused();
}
const sheet = (page: Page) => page.locator(".sheetwrap.on");

test("the footer button is on every page; the module loads only at the first tap; sending works", async ({ page }) => {
  await noCookie(page);
  const js = jsLog(page);
  for (const path of ["/", "/menu/", "/kontakti/"]) {
    await page.goto(path);
    await expect(page.locator("footer.foot [data-suggest]")).toHaveText("Предложи подобрение");
  }
  await page.waitForLoadState("networkidle");
  expect(js.loaded()).toBe(false);
  expect(await page.evaluate(() => document.body.innerHTML.includes("data-sgform"))).toBe(false);

  await page.goto("/menu/");
  await openFromFooter(page);
  expect(js.loaded()).toBe(true);
  await expect(sheet(page).locator("h2")).toHaveText("Предложи подобрение");
  await expect(sheet(page)).toContainText("Без име, телефон и имейл: препоръката е анонимна.");
  await expect(sheet(page).locator("label[for=sg-t]")).toHaveText(SHEET_TEXT);

  /* required, and no personal data */
  await sheet(page).locator("[type=submit]").click();
  await expect(sheet(page).locator("#sg-e")).toHaveText("Напишете какво да подобрим.");
  await expect(sheet(page).locator("#sg-t")).toHaveAttribute("aria-invalid", "true");
  await sheet(page).locator("#sg-t").fill("Обадете ми се на 0888 12 34 56");
  await sheet(page).locator("[type=submit]").click();
  await expect(sheet(page).locator("#sg-e")).toHaveText("Моля, без телефон и имейл: препоръката е анонимна.");

  await sheet(page).locator("#sg-t").fill("Бутонът за филтрите е малък");
  const req = page.waitForRequest((r) => r.url().endsWith("/api/notes/suggest") && r.method() === "POST");
  const res = page.waitForResponse((r) => r.url().endsWith("/api/notes/suggest"));
  await sheet(page).locator("[type=submit]").click();
  const body = (await req).postDataJSON();
  expect((await res).status()).toBe(201);
  expect(body).toMatchObject({ module: "site", selector: "", text: "Бутонът за филтрите е малък", elementText: "" });
  expect(body.url).toMatch(/^\/menu\/(#.*)?$/); /* the path and the # of the page (the menu marks its category) */
  expect(body.viewport.w).toBe(page.viewportSize()!.width);
  expect(body).not.toHaveProperty("author");
  await expect(page.locator(".ov .toast")).toContainText("Благодарим! Препоръката е изпратена.");
  await expect(page.locator(".sheetwrap")).toHaveCount(0);
  /* the focus is back on the button that opened it */
  await expect(page.locator("footer.foot [data-suggest]")).toBeFocused();
});

test("@phone 'Още' has the button; it closes 'Още' and opens the sheet; Esc closes it and the focus goes back", async ({ page }) => {
  await noCookie(page);
  await page.goto("/");
  await page.locator("[data-more]").first().click();
  const b = sheet(page).locator("[data-suggest]");
  await expect(b).toHaveText("Предложи подобрение");
  const box = await b.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(48);
  await b.click();
  await expect(sheet(page).locator("#sg-t")).toBeFocused();
  await expect(page.locator(".sheetwrap")).toHaveCount(1);
  await expect(sheet(page).locator("h2")).toHaveText("Предложи подобрение");
  /* Tab goes round inside the sheet */
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".sheetwrap.on .sheet"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheetwrap")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => { const a = document.activeElement as HTMLElement; return !!a && a !== document.body && a.getClientRects().length > 0 && a.matches("[data-more], [data-suggest]"); })).toBe(true);
});

test("@desktop keyboard: Enter opens it, Esc closes it and the focus is back on the footer button", async ({ page }) => {
  await noCookie(page);
  await page.goto("/oferti/");
  const b = page.locator("footer.foot [data-suggest]");
  await b.scrollIntoViewIfNeeded();
  await b.focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator("#sg-t")).toBeFocused();
  await page.keyboard.type("Текстът в офертите е дребен");
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheetwrap")).toHaveCount(0);
  await expect(b).toBeFocused();
  /* the draft stays for the next opening */
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator("#sg-t")).toHaveValue("Текстът в офертите е дребен");
});

test("@desktop pointing at a place with the mouse and with the keyboard: a unique selector, never the value of a field", async ({ page }) => {
  await noCookie(page);
  await page.goto("/kontakti/");
  await page.locator("#f-name").fill("Иван Петров");
  await openFromFooter(page);
  await sheet(page).locator("#sg-t").fill("Полето за име е неясно");
  await sheet(page).locator("[data-sgp=pick]").click();
  await expect(page.locator(".sg-ui")).toContainText("Посочете мястото");
  /* while pointing, the page does not get the clicks */
  await page.locator("#f-name").hover();
  await expect(page.locator(".sg-box")).toHaveCSS("opacity", "1");
  await page.locator("#f-name").click();
  await expect(sheet(page).locator("[data-place]")).toContainText("Място: Поле „Вашето име“");
  await expect(sheet(page).locator("#sg-t")).toHaveValue("Полето за име е неясно");
  const req = page.waitForRequest((r) => r.url().endsWith("/api/notes/suggest"));
  await sheet(page).locator("[type=submit]").click();
  const body = (await req).postDataJSON();
  expect(body.elementText).toBe("Вашето име");
  expect(JSON.stringify(body)).not.toContain("Иван");
  expect(body.url).toBe("/kontakti/");
  expect(await page.evaluate((s) => { const l = document.querySelectorAll(s); return l.length === 1 && l[0].id === "f-name"; }, body.selector)).toBe(true);

  /* keyboard: Tab outlines, Enter picks; Esc while pointing goes back to the sheet without a place */
  await openFromFooter(page);
  await sheet(page).locator("[data-sgp=pick]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".sg-ui")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".sg-ui")).toHaveCount(0);
  await expect(sheet(page).locator("[data-sgp=pick]")).toBeVisible();
  await sheet(page).locator("[data-sgp=pick]").click();
  await expect(page.locator(".sg-ui")).toBeVisible();
  await page.locator("#f-contact").focus();
  await page.keyboard.press("Tab");
  await expect(page.locator(".sg-ui")).toContainText("Tab до него, Enter избира");
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator("[data-place]")).toContainText("Място:");
  await expect(sheet(page).locator("[data-place]")).not.toContainText("0888");
  await sheet(page).locator("[data-sgp=clear]").click();
  await expect(sheet(page).locator("[data-sgp=pick]")).toBeVisible();
});

test("@phone pointing with a finger: the first tap outlines, 'Избери това' picks", async ({ page }) => {
  await noCookie(page);
  await page.goto("/menu/");
  await openFromFooter(page);
  await sheet(page).locator("[data-sgp=pick]").tap();
  await expect(page.locator(".sg-ui")).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#mh1").tap();
  await expect(page.locator(".sg-ui")).toContainText("докоснете пак или „Избери това“");
  await page.locator('.sg-ui [data-sg="pick"]').tap();
  await expect(sheet(page).locator("[data-place]")).toContainText("Място: Заглавие „Меню“");
  expect(await page.evaluate(() => location.pathname)).toBe("/menu/");
});

test("429: the polite message of the server and the time of the next one; the next opening says it at once", async ({ page }) => {
  await noCookie(page);
  const message = "Благодарим! Вече получихме няколко предложения от вас. Можете да пишете пак след час.";
  let calls = 0;
  await page.route("**/api/notes/suggest", (r) => { calls++; return r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "throttled", message, retryIn: 1800 }) }); });
  await page.goto("/");
  await openFromFooter(page);
  await sheet(page).locator("#sg-t").fill("Още една идея");
  await sheet(page).locator("[type=submit]").click();
  const at = await page.evaluate(() => new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(Date.now() + 1800e3)));
  await expect(sheet(page).locator("[data-sglimit]")).toContainText("Благодарим за препоръките!");
  await expect(sheet(page).locator("[data-sglimit]")).toContainText("Вече получихме няколко предложения от вас.");
  await expect(sheet(page).locator("[data-sglimit]")).toContainText("Може да изпратите нова след " + at.slice(0, 2));
  await page.keyboard.press("Escape");
  await expect(page.locator(".sheetwrap")).toHaveCount(0);
  await openFromFooter(page).catch(() => {});
  await expect(sheet(page).locator("[data-sglimit]")).toBeVisible();
  expect(calls).toBe(1);
});

test("no horizontal scroll at 360 with the sheet and while pointing; the sheet is above the cookie banner", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/");
  const over = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  /* the banner is not answered: at the end of the page it covers the footer, the keyboard reaches the button */
  const b = page.locator("footer.foot [data-suggest]");
  await b.focus();
  await page.keyboard.press("Enter");
  await expect(sheet(page).locator("#sg-t")).toBeVisible();
  expect(await over()).toBeLessThanOrEqual(0);
  /* the banner (not answered here) never covers the send button */
  const send = sheet(page).locator("[type=submit]");
  await send.scrollIntoViewIfNeeded();
  const r = (await send.boundingBox())!;
  expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest(".sheetwrap"), [r.x + r.width / 2, r.y + r.height / 2])).toBe(true);
  await sheet(page).locator("[data-sgp=pick]").click();
  await expect(page.locator(".sg-ui")).toBeVisible();
  expect(await over()).toBeLessThanOrEqual(0);
  const bar = (await page.locator(".sg-ui").boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(0);
  expect(bar.x + bar.width).toBeLessThanOrEqual(360);
});
