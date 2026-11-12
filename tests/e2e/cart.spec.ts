import { test, expect, type Page } from "@playwright/test";

/* Cart and checkout (/kolichka/): 3 steps, delivery / pickup, -30% lunch after 15:00 for pickup, zones, slots,
   validation, api.orders.create -> tracking, server errors, empty, closed ("Поръчай за утре"), undo on remove. */
const CART = {
  mode: "delivery",
  lines: [
    { key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 },
    { key: "l-lazanya-boloneze", id: "l-lazanya-boloneze", q: 2, mods: [], extra: 0 },
  ],
};
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (409|422|500)/.test(m.text())) errors.push(m.text()); });
  return errors;
}
async function open(page: Page, t = "12:30", cart: unknown = CART, hash = "") {
  await page.addInitScript(([c]) => {
    if (sessionStorage.getItem("ck-init")) return;
    sessionStorage.setItem("ck-init", "1");
    localStorage.setItem("sc-cookie", '"min"');
    localStorage.removeItem("sc-checkout");
    if (c) localStorage.setItem("sc-cart", JSON.stringify(c)); else localStorage.removeItem("sc-cart");
  }, [cart]);
  await page.goto("/kolichka/?preview=1&t=" + t + hash);
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 900;
const cta = (page: Page) => (isPhone(page) ? page.locator(".ck-bar .js-next") : page.locator(".sum-cta .js-next"));

test("cart: SEO noindex, one h1, lines and totals from the menu", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Количка");
  await expect(page.locator(".ln")).toHaveCount(2);
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 1 от 3");
  await expect(cta(page)).toHaveText(/^Към адреса · \d+,\d{2} €$/);
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("cart: remove with undo", async ({ page }) => {
  await open(page);
  await page.locator(".ln-rm").first().click();
  await expect(page.locator(".ln")).toHaveCount(1);
  await page.locator(".toast button", { hasText: "Отмени" }).click();
  await expect(page.locator(".ln")).toHaveCount(2);
  await expect(page.locator(".ln-name").first()).toHaveText("Пица Дяволо");
});

test("cart: lunch after 15:00 is pickup only with -30%", async ({ page }) => {
  await open(page, "16:30");
  await expect(page.locator(".note.warn")).toContainText("само за вземане");
  await expect(cta(page)).toHaveText(/Смени на вземане · \d+,\d{2} €$/); /* the action and the price after the switch */
  const after = (await cta(page).textContent())!.match(/(\d+,\d{2}) €/)![1];
  await cta(page).click();
  await expect(page.locator(".sum")).toContainText("Отстъпка след 15:00");
  await expect(page.locator(".sum [data-total]")).toHaveText(after + " €");
  await expect(page.locator(".tag.promo")).toHaveText("-30% след 15:00");
  await expect(cta(page)).toContainText("Избери час");
});

test("cart: 21:30 delivery is off, pickup slots until 22:30", async ({ page }) => {
  await open(page, "21:30", { ...CART, lines: [CART.lines[0]] });
  await expect(page.locator('.seg.ff [data-v="delivery"]')).toBeDisabled();
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Кога ще я вземете?");
  const last = await page.locator(".slot").last().getAttribute("data-v");
  expect(last).toBe("22:30");
});

test("cart: closed kitchen offers an order for tomorrow, without a time tonight", async ({ page }) => {
  await open(page, "23:30", { ...CART, lines: [CART.lines[0]] });
  await expect(page.locator(".note.info").first()).toContainText("Поръчайте за утре");
  await expect(cta(page)).toContainText("Поръчай за утре");
  /* step 1 says the same as step 2: both ways possible, "по избран час", no 21:00 note, no time tonight */
  await expect(page.locator('.seg.ff [data-v="delivery"]')).toBeEnabled();
  await expect(page.locator('.seg.ff [data-v="delivery"] small')).toHaveText("по избран час");
  await expect(page.locator(".ff-note")).toHaveCount(0);
  await expect(page.locator(".sum .eta-row")).toContainText("Утре, от 10:30");
  await expect(page.locator(".sum")).not.toContainText("Готова около");
  await cta(page).click();
  await expect(page.locator(".note.info").first()).toContainText("Поръчвате за утре");
  await page.locator('.seg.ff [data-v="pickup"]').click();
  await expect(page.locator(".slot").first()).toHaveAttribute("data-v", "10:30");
});

test("cart: empty state", async ({ page }) => {
  const errors = watch(page);
  await open(page, "12:30", null);
  await expect(page.locator("h1")).toHaveText("Количката е празна");
  await expect(page.locator(".rail .dcard").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("cart: full delivery flow on the real server -> tracking with the key", async ({ page }) => {
  const errors = watch(page);
  let body: Record<string, unknown> | null = null;
  page.on("request", (r) => { if (r.url().endsWith("/api/orders") && r.method() === "POST") body = r.postDataJSON(); });
  /* a sold-out dish stays in the cart as "Не се брои" and is not sent */
  await open(page, "12:30", { ...CART, lines: [CART.lines[0], { key: "pleskavitsa", id: "pleskavitsa", q: 1, mods: [], extra: 0 }] });
  await expect(page.locator(".ln.out")).toHaveCount(1);
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Къде да я доставим?");
  await page.locator("#addr").fill("Младост 1");
  await page.locator("#addr-list li[data-i]").first().click();
  await expect(page.locator("#addr-res")).toContainText("Извън зоната ни");
  await page.locator(".combo-x").click();
  await page.locator("#addr").fill("ул. Обиколна 5, Дружба 2");
  await page.locator("#addr-list li[data-i]").first().click();
  await expect(page.locator("#addr-res")).toContainText("Безплатна доставка");
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Вашите данни");
  await expect(page.locator('[data-f="consent"]')).not.toBeChecked();
  await expect(page.locator("#f-code")).toBeVisible();
  await cta(page).click();
  await expect(page.locator("#e-name")).toBeVisible();
  await expect(page.locator("#f-name")).toHaveAttribute("aria-describedby", "e-name");
  await page.fill("#f-name", "Мария");
  await page.fill("#f-phone", "0888 12 34 56");
  await page.locator("label.opt", { hasText: "Карта при получаване" }).click();
  await expect(page.locator("label.opt", { hasText: "Ваучер" })).not.toContainText("Sodexo");
  await expect(cta(page)).toHaveText(/^Поръчай · \d+,\d{2} €$/);
  await cta(page).click();
  await page.waitForURL(/\/porachka\/\d+-[a-z0-9]+\/$/);
  expect(body).toMatchObject({ zone: "Дружба 2", pay: "card", name: "Мария", marketing: false });
  const sent = body as unknown as { cart: { mode: string; lines: { id: string }[] } };
  expect(sent.cart.mode).toBe("delivery");
  expect(sent.cart.lines.map((l) => l.id)).toEqual(["pitsa-dyavolo"]);
  expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
});

async function toStep3(page: Page, t = "12:30", cart: unknown = { ...CART, mode: "pickup", lines: [CART.lines[0]] }) {
  await open(page, t, cart);
  await cta(page).click();
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Вашите данни");
  await page.fill("#f-name", "Мария");
  await page.fill("#f-phone", "0888123456");
}

test("cart: discount code - wrong code from the core under the field, a good one gives -10% and is sent", async ({ page }) => {
  await toStep3(page);
  await page.fill("#f-code", "SC10-0000000000");
  await page.locator('[data-act="code-apply"]').click();
  await expect(page.locator("#e-code")).toContainText("Няма такъв код");
  await expect(page.locator("#f-code")).toHaveAttribute("aria-invalid", "true");
  /* a good code (the check is mocked, the core itself is tested in the unit tests) */
  await page.route("**/api/codes/check", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "SC10-1234567890", pct: 10, valid: true }) }));
  let body: Record<string, unknown> | null = null;
  await page.route("**/api/orders", async (r) => { body = r.request().postDataJSON(); await r.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ no: "1077", key: "abcd1234", discKind: "code" }) }); });
  await page.route("**/porachka/1077-abcd1234/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<h1>ok</h1>" }));
  const before = (await page.locator(".sum [data-total]").textContent())!;
  await page.fill("#f-code", "sc10 1234567890");
  await page.locator("#f-code").press("Enter");
  await expect(page.locator(".code-blk .note.ok")).toContainText("Кодът е приложен");
  await expect(page.locator(".sum")).toContainText("Отстъпка с код");
  await expect(page.locator(".sum [data-total]")).not.toHaveText(before);
  await cta(page).click();
  await page.waitForURL("**/porachka/1077-abcd1234/");
  expect(body).toMatchObject({ code: "SC10-1234567890" });
});

test("cart: discount code with the lunch -30% after 15:00 - the better one wins, the code is kept", async ({ page }) => {
  await page.route("**/api/codes/check", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: "SC10-1234567890", pct: 10, valid: true }) }));
  await toStep3(page, "16:30", { mode: "pickup", lines: [CART.lines[1]] });
  await page.fill("#f-code", "SC10-1234567890");
  await page.locator('[data-act="code-apply"]').click();
  await expect(page.locator(".code-blk .note.info")).toContainText("Обедната отстъпка -30% е по-изгодна");
  await expect(page.locator(".sum")).toContainText("Отстъпка след 15:00");
  await expect(page.locator(".sum")).not.toContainText("Отстъпка с код");
});

test("cart: delivery closed by the core -> step 1 with the reason and 'Вземи от място'", async ({ page }) => {
  await page.route("**/api/orders", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "delivery_closed", message: "Доставката приключи за днес в 21:00. Можете да я вземете от ресторанта до 22:30." }) }));
  await open(page, "12:30", { ...CART, lines: [CART.lines[0]] });
  await cta(page).click();
  await page.locator("#addr").fill("Дружба 2, бл. 311");
  await page.locator("#addr-list li[data-i]").first().click();
  await expect(page.locator("#addr-res")).toContainText("Безплатна доставка");
  await cta(page).click();
  await page.fill("#f-name", "Мария");
  await page.fill("#f-phone", "0888123456");
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Количка");
  await expect(page.locator(".note.bad")).toContainText("Доставката приключи за днес в 21:00");
  await page.locator('.note.bad [data-act="mode"][data-v="pickup"]').click();
  await expect(page.locator('.seg.ff [data-v="pickup"]')).toHaveAttribute("aria-pressed", "true");
});

test("cart: kitchen closed by the core -> an order for tomorrow, choose the time again", async ({ page }) => {
  await page.route("**/api/orders", (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "closed", message: "Кухнята вече не приема поръчки за днес. Поръчайте за утре." }) }));
  await toStep3(page);
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Кога ще я вземете?");
  await expect(page.locator(".note").first()).toContainText("Кухнята вече не приема поръчки за днес");
  await expect(page.locator(".note").first()).toContainText("Изберете час за утре");
});

test("cart: a slot refused by the core -> step 2, choose again", async ({ page }) => {
  await page.route("**/api/orders", (r) => r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "invalid", message: "Проверете полетата.", fields: { slot: "Изберете час от списъка." } }) }));
  await toStep3(page);
  await cta(page).click();
  await expect(page.locator("h1")).toHaveText("Кога ще я вземете?");
  await expect(page.locator(".note.bad")).toContainText("Изберете час от списъка.");
});

test("cart: server refusal is shown and nothing is lost", async ({ page }) => {
  await page.route("**/api/orders", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "server", message: "Нещо се обърка. Опитайте пак." }) }));
  await open(page, "12:30", { ...CART, mode: "pickup", lines: [CART.lines[0]] });
  await cta(page).click();
  await cta(page).click();
  await page.fill("#f-name", "Мария");
  await page.fill("#f-phone", "0888123456");
  await cta(page).click();
  await expect(page.locator("#topnotes .note.bad")).toContainText("Поръчката не е изпратена");
  await expect(cta(page)).toContainText("Опитай пак");
  await expect(page.locator("#f-name")).toHaveValue("Мария");
  await expect(page.locator(".ln, .recap")).toHaveCount(1);
});
