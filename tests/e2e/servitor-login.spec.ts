import { test, expect } from "@playwright/test";
import { admin, newWaiter, signInCtx, startShift, endShift, guest, freeTable, errors, serious, layout } from "./servitor-helpers.ts";

/* "Вход и смяна" of the waiter (/servitor/vhod/; design/pages-servitor/login.html) on the real server: an unknown phone
   starts with the password (one line why), the errors under the fields, „Покажи / Скрий“; the personal PIN on a known
   phone (the person + 4 digits from the keyboard, a wrong PIN in role="status"); "Моите маси днес" → the hall; the end of
   the shift with the tables handed over and the sign-out. */
test.describe.configure({ mode: "serial" });

test("no session: the waiter's app leads to its own sign-in with #next=", async ({ page }) => {
  await page.goto("/servitor/gotovi/");
  await expect(page).toHaveURL(/\/servitor\/vhod\/#next=%2Fservitor%2Fgotovi%2F$/);
  await expect(page.locator("main h1")).toHaveText("Вход с парола");
});

test("@phone an unknown phone: the password first, errors under each field, „Покажи / Скрий“, then the shift and the hall", async ({ page }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 15); await freeTable(a, 16);
  try {
    await page.goto("/servitor/vhod/");
    await expect(page.locator("main h1")).toHaveText("Вход с парола");
    await expect(page.locator("main .lead")).toHaveText("Първият вход на нов телефон е с парола. После тук влизаш с личния ПИН.");
    await expect(page.locator('[data-v="pass"]')).toHaveAttribute("aria-pressed", "true");
    /* the PIN tab explains in one line */
    await page.locator('[data-v="pin"]').click();
    await expect(page.locator("main .notice")).toHaveText("Първият вход на нов телефон е с парола. После тук влизаш с личния ПИН.");
    await expect(page.locator(".pinpad")).toHaveCount(0);
    await page.locator('main button[data-v="pass"]').last().click();
    await expect(page.locator("#u")).toHaveAttribute("autocomplete", "off");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#uerr")).toHaveText("Въведи потребител.");
    await expect(page.locator("#perr")).toHaveText("Въведи парола.");
    await expect(page.locator("#u")).toBeFocused();
    await expect(page.locator("#u")).toHaveAttribute("aria-invalid", "true");
    await page.locator("#u").fill(w.username);
    await page.locator("#p").fill("greshna-parola-1");
    const show = page.locator("[data-show]");
    await show.click();
    await expect(show).toHaveAttribute("aria-pressed", "true");
    await expect(show).toHaveText("Скрий");
    await expect(page.locator("#p")).toHaveAttribute("type", "text");
    await show.click();
    await expect(page.locator("#p")).toHaveAttribute("type", "password");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("#perr")).not.toHaveText("");
    await expect(page.locator("#u")).toHaveValue(w.username);
    expect(await serious(page)).toEqual([]);
    await page.locator("#p").fill(w.password);
    await page.locator('button[type="submit"]').click();
    /* "Моите маси днес" */
    await expect(page.locator("main h1")).toHaveText("Смяна · " + w.name);
    await expect(page).toHaveURL(/#shift$/);
    await expect(page.locator(".lg")).toContainText("Избери своите маси за смяната. Управителят може да ги промени.");
    const start = page.locator("[data-start]");
    await expect(start).toHaveText("Започни смяната · 0 маси");
    await expect(start).toHaveAttribute("aria-disabled", "true");
    await start.click({ force: true });
    await expect(page.locator(".st-toast")).toHaveText("Избери поне една маса.");
    await page.locator('[data-t="15"]').click(); await page.locator('[data-t="16"]').click();
    await expect(page.locator('[data-t="15"]')).toHaveAttribute("aria-pressed", "true");
    await expect(start).toHaveText("Започни смяната · 2 маси");
    await layout(page, "shift");
    expect(await serious(page)).toEqual([]);
    await start.click();
    await expect(page).toHaveURL(/\/servitor\/$/);
    await expect(page.locator("main .st-h h2", { hasText: "Моите маси" })).toBeVisible();
    await expect(page.locator(".st-h", { hasText: "Моите маси" }).locator(".muted")).toHaveText("2 маси");
    /* the sheet "Смяна": since, my tables, "Приключи смяната" */
    await page.locator('[data-act="menu"]').click();
    const sh = page.locator(".st-sheetwrap.on .st-sheet");
    await expect(sh.locator(".kv", { hasText: "Моите маси" }).locator("b")).toHaveText("15, 16");
    await expect(sh).toContainText("Избрах ги при вход. Управителят може да ги промени.");
    await expect(sh.locator(".kv", { hasText: "На смяна от" }).locator("b")).toHaveText(/^\d\d:\d\d$/);
    await expect(sh.locator(".sfoot a", { hasText: "Приключи смяната" })).toHaveAttribute("href", "/servitor/vhod/#end");
    expect(errs).toEqual([]);
  } finally { await endShift(w); }
});

test("@phone the PIN on a known phone: the person + 4 digits, a wrong PIN said aloud, then the hall", async ({ page }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 17);
  try {
    /* the password once on this phone makes it known */
    await page.goto("/servitor/vhod/");
    await page.locator("#u").fill(w.username); await page.locator("#p").fill(w.password);
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("main h1")).toHaveText("Смяна · " + w.name);
    await page.locator('[data-t="17"]').click();
    await page.locator("[data-start]").click();
    await expect(page).toHaveURL(/\/servitor\/$/);
    /* the manager gives a PIN; the waiter leaves and comes back */
    const pin = ((await (await a.post("/api/admin/staff/" + w.id + "/pin", { data: {} })).json()) as { pin: string }).pin;
    expect(pin).toMatch(/^\d{4}$/);
    await page.request.post("/api/auth/logout");
    await page.goto("/servitor/vhod/");
    await expect(page.locator("main h1")).toHaveText("Вход за персонала");
    await expect(page.locator('[data-v="pin"]')).toHaveAttribute("aria-pressed", "true");
    const me = page.locator("[data-who]", { hasText: w.name });
    await me.click();
    await expect(me).toHaveAttribute("aria-pressed", "true");
    expect(await serious(page)).toEqual([]);
    await layout(page, "pin");
    const wrong = pin === "9087" ? "9078" : "9087";
    await page.keyboard.type(wrong);
    const msg = page.locator(".pinerr");
    await expect(msg).toHaveAttribute("role", "status");
    await expect(msg).toHaveText("Грешен ПИН. Опитай пак.");
    await expect(page.locator(".dots")).toHaveClass(/bad/);
    for (const d of pin) await page.locator('.pinpad [data-d="' + d + '"]').click();
    /* on shift already: straight to the hall */
    await expect(page).toHaveURL(/\/servitor\/$/);
    await expect(page.locator(".st-top h1")).toHaveText("Залата");
    expect(errs).toEqual([]);
  } finally { await endShift(w); }
});

test("@phone the end of the shift: the open tables are handed over, the sign-out, back to the sign-in", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a), w2 = await newWaiter(a);
  await freeTable(a, 13); await freeTable(a, 14);
  await startShift(w, [13, 14]); await startShift(w2, [18]);
  try {
    const g = await guest(a, 13); await g.call("bill");
    await signInCtx(context, w);
    await page.goto("/servitor/vhod/#end");
    await expect(page.locator("main h1")).toHaveText("Край на смяната");
    const row = page.locator(".endrow");
    await expect(row).toHaveCount(1);
    await expect(row.locator("b")).toHaveText("Маса 13");
    await expect(row.locator(".stt")).toHaveText("Чака сметка");
    await expect(page.locator("#to option", { hasText: w2.name })).toHaveCount(1);
    await page.locator("#to").selectOption(w2.username);
    await layout(page, "end");
    expect(await serious(page)).toEqual([]);
    await page.locator("[data-end]").click();
    await expect(page.locator(".st-toast")).toHaveText("Смяната приключи. Масата е предадена.");
    await expect(page.locator("main h1")).toHaveText(/Вход/);
    const meR = await page.request.get("/api/auth/me");
    expect(meR.status() === 401 || (await meR.json()) === null, "signed out").toBe(true);
    const mine2 = await (await w2.api.get("/api/floor/shift")).json();
    expect(mine2.shift.tables.map((t: { n: number }) => t.n).sort()).toEqual([13, 18]);
    expect(errs).toEqual([]);
  } finally { await endShift(w); await endShift(w2); await freeTable(a, 13); }
});
