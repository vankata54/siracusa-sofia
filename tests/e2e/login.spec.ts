import { test, expect, type Page } from "@playwright/test";

/* Login (/vhod/): phone -> SMS code (6 boxes, the code comes back as demoCode and is shown as demo) -> name for a new
   profile (marketing unticked) -> -10% "от следващата поръчка"; returning number goes on to /profil/ or ?next=;
   wrong code, too many tries (limit in the core), blocked number, invalid phone, already signed in, noindex. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* expected API answers (wrong code 401, blocked 403, expired 410, too many 429) show as resource errors in Chromium */
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|403|410|422|429|503)/.test(m.text())) errors.push(m.text()); });
  return errors;
}
const rnd = () => "0887" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0");
async function open(page: Page, q = "") {
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/vhod/" + q);
  await expect(page.locator("#ph")).toBeVisible();
}
async function toCode(page: Page, phone: string) {
  await page.locator("#ph").fill(phone);
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.getByRole("heading", { name: "Въведете кода" })).toBeVisible();
  const code = (await page.locator("[data-demo-code] [data-code]").textContent() || "").replace(/\D/g, "");
  expect(code).toMatch(/^\d{6}$/);
  return code;
}
/** the whole code pasted into one box (as from the SMS) */
async function paste(page: Page, code: string, box = 0) {
  await page.locator(".otp input").nth(box).evaluate((el, c) => {
    const dt = new DataTransfer(); dt.setData("text", c);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, code);
}
const wrongOf = (code: string) => (code === "000000" ? "111111" : "000000");
const TEL = "tel:+359894365577";
const j429 = (error: string, message: string, extra: Record<string, unknown> = {}) => ({ status: 429, contentType: "application/json", body: JSON.stringify({ error, message, ...extra }) });
/** the first sms/request goes to the server, its countdown cut to 1 s (so "Изпрати нов код" comes at once); the next ones get `then` */
async function firstReal(page: Page, then: Parameters<import("@playwright/test").Route["fulfill"]>[0]) {
  let n = 0;
  await page.route("**/api/auth/sms/request", async (r) => {
    if (++n > 1) return r.fulfill(then);
    const res = await r.fetch(); const j = await res.json(); j.resendIn = 1;
    return r.fulfill({ response: res, json: j });
  });
}
/** the right edge of `sel` is inside the form card (.core.box) */
async function inCard(page: Page, sel: string) {
  const [el, box] = await Promise.all([page.locator(sel).last().boundingBox(), page.locator(".core.box").boundingBox()]);
  expect(el, sel).not.toBeNull();
  expect(el!.x, sel).toBeGreaterThanOrEqual(box!.x);
  expect(el!.x + el!.width, sel + " right edge").toBeLessThanOrEqual(box!.x + box!.width - 8);
}

test("login: SEO, noindex, one h1, step 1, no overflow at 360", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Влезте с телефона си");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0); /* noindex: no canonical (decision 12.11) */
  await expect(page.locator(".bonus")).toContainText("от следващата поръчка");
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 1 от 3");
  await expect(page.locator("#ph")).toHaveAttribute("placeholder", "0888 12 34 56");
  await expect(page.locator(".fine a").first()).toHaveAttribute("href", "/obshti-uslovia/");
  /* the links inside the sentence get a hit area of at least 24 px (padding-block, the text does not move) */
  for (const a of await page.locator(".fine a").all()) expect((await a.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  await expect(page.locator("[data-pv]")).toHaveCount(0); /* prototype panel only with ?preview=1 */
  await page.setViewportSize({ width: 360, height: 800 });
  const hs = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(hs).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("login: phone validation (empty, short, +359 accepted)", async ({ page }) => {
  await open(page);
  const send = page.getByRole("button", { name: "Изпрати код по SMS" });
  await send.click();
  await expect(page.locator("#ph-err")).toHaveText(/Напишете номера си/);
  await expect(page.locator("#ph")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#ph").fill("0888 12 34");
  await send.click();
  await expect(page.locator("#ph-err")).toContainText("10 цифри");
  await page.locator("#ph").fill("+359 887 " + String(Math.floor(Math.random() * 1e6)).padStart(6, "0"));
  await send.click();
  await expect(page.getByRole("heading", { name: "Въведете кода" })).toBeVisible();
  await expect(page.locator(".sub b").first()).toHaveText(/^0887 \d\d \d\d \d\d$/);
});

test("login: new profile: wrong code, typed code, name, unticked consent, -10% ticket", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  const code = await toCode(page, rnd());
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 2 от 3");
  await expect(page.locator("[data-demo-code]")).toContainText("Демо");
  await expect(page.locator("[data-resend]")).toContainText(/Изпрати нов код след 0:(30|29|28)/);
  const boxes = page.locator(".otp input");
  await expect(boxes).toHaveCount(6);
  /* wrong code: the 6th digit submits on its own */
  await boxes.first().focus();
  await page.keyboard.type(wrongOf(code), { delay: 20 });
  await expect(page.locator("#otp-err")).toHaveText(/Кодът не съвпада/);
  await expect(boxes.first()).toBeFocused();
  /* auto advance + Backspace back */
  await page.keyboard.type(code.slice(0, 2), { delay: 20 });
  await expect(boxes.nth(2)).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(boxes.nth(1)).toBeFocused();
  await expect(boxes.nth(1)).toHaveValue("");
  await page.keyboard.type(code.slice(1), { delay: 20 });
  await expect(page.getByRole("heading", { name: "Как да ви наричаме?" })).toBeVisible();
  await expect(page.locator(".stepper .t b")).toHaveText("Стъпка 3 от 3");
  await expect(page.locator("#mkt")).not.toBeChecked();
  await page.getByRole("button", { name: "Създай профил и вземи -10%" }).click();
  await expect(page.locator("#nm-err")).toBeVisible();
  await page.locator("#nm").fill("Мария");
  await page.getByRole("button", { name: "Създай профил и вземи -10%" }).click();
  await expect(page.getByRole("heading", { name: "Профилът е готов" })).toBeVisible();
  await expect(page.locator(".ticket")).toContainText("от следващата поръчка");
  await expect(page.locator("h1")).toHaveText("Добре дошли, Мария");
  await expect(page.locator(".bonus")).toBeHidden();
  await expect(page.locator("[data-go]")).toHaveAttribute("href", "/profil/");
  const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()));
  expect(me.name).toBe("Мария");
  expect(me.consent.marketing).toBe(false);
  /* signed in: the page says so and offers another number */
  await page.goto("/vhod/");
  await expect(page.getByRole("heading", { name: "Вече сте в профила си" })).toBeVisible();
  await page.getByRole("button", { name: "Влез с друг номер" }).click();
  await expect(page.locator("#ph")).toBeVisible();
  expect(await page.evaluate(() => fetch("/api/me").then((r) => r.json()))).toBeNull();
  expect(errors).toEqual([]);
});

test("login: returning number, pasted code, back to ?next= inside the site", async ({ page, browser }) => {
  const phone = rnd();
  /* first sign-in in another browser makes the profile */
  const other = await browser.newPage();
  await open(other);
  const c1 = await toCode(other, phone);
  await paste(other, c1);
  await expect(other.getByRole("heading", { name: "Как да ви наричаме?" })).toBeVisible();
  await other.close();

  await open(page, "?next=" + encodeURIComponent("/kolichka/"));
  const code = await toCode(page, phone);
  /* paste the whole code into the third box */
  await paste(page, code, 2);
  await expect(page.getByRole("heading", { name: "Влязохте успешно" })).toBeVisible();
  await page.waitForURL(/\/kolichka\/$/);
});

test("login: outside ?next= is ignored, default is the profile", async ({ page }) => {
  await open(page, "?next=" + encodeURIComponent("https://example.com/x"));
  const phone = rnd();
  const code = await toCode(page, phone);
  await paste(page, code);
  await expect(page.getByRole("heading", { name: "Как да ви наричаме?" })).toBeVisible();
  await page.locator("#nm").fill("Иван");
  await page.getByRole("button", { name: "Създай профил и вземи -10%" }).click();
  await expect(page.locator("[data-go]")).toHaveAttribute("href", "/profil/");
});

test("login: too many wrong codes (core limit) asks for a new code", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  const code = await toCode(page, rnd());
  const bad = wrongOf(code);
  const boxes = page.locator(".otp input");
  for (let i = 0; i < 5; i++) {
    await paste(page, bad);
    await expect(page.locator("#otp-err")).toHaveText(/Кодът не съвпада/);
    await expect(boxes.first()).toBeEnabled();
  }
  await paste(page, bad);
  await expect(page.locator("#otp-err")).toContainText("поискайте нов код");
  await expect(boxes.first()).toBeDisabled();
  /* within 30 s of the code the server would answer too_soon: the countdown goes on and holds the focus (not <body>) */
  await expect(page.locator("[data-resend]")).toContainText("Изпрати нов код след");
  await expect(page.locator("[data-resend]")).toBeFocused();
  await expect(page.getByRole("button", { name: "Изпрати нов код" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("login: \"Изпрати нов код\" too soon (429 too_soon): the countdown from retryIn holds the focus", async ({ page }) => {
  const errors = watch(page);
  await firstReal(page, j429("too_soon", "Нов код може след 20 сек.", { retryIn: 20 }));
  await open(page);
  await toCode(page, rnd());
  const again = page.getByRole("button", { name: "Изпрати нов код" });
  await expect(again).toBeVisible();
  await again.click();
  await expect(page.locator("[data-resend]")).toContainText(/Изпрати нов код след 0:(20|19|18)/);
  await expect(page.locator("[data-resend]")).toBeFocused();
  await expect(page.locator(".alert")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("login: blocked number gets a polite way by phone", async ({ page }) => {
  await open(page);
  await page.locator("#ph").fill("0888 00 00 00");
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.getByRole("heading", { name: "Нека го направим по телефона" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Нека го направим по телефона" })).toBeFocused();
  await expect(page.locator(".lg-f").getByRole("link", { name: /Обади се · 0894 36 55 77/ })).toHaveAttribute("href", "tel:+359894365577");
  await page.getByRole("button", { name: "Въведи друг номер" }).click();
  await expect(page.locator("#ph")).toBeFocused();
});

test("login: \"Назад\" and the same number go back to the code that still works", async ({ page }) => {
  const errors = watch(page);
  await open(page);
  const phone = rnd();
  const code = await toCode(page, phone);
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.locator("#ph")).toBeFocused();
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.getByRole("heading", { name: "Въведете кода" })).toBeVisible();
  await expect(page.locator(".alert")).toHaveCount(0);
  await expect(page.locator("[data-resend]")).toContainText("Изпрати нов код след");
  /* with the server limits on, the same code comes back (too_soon); in the test mode the core sends a new one */
  const now = (await page.locator("[data-demo-code] [data-code]").textContent() || "").replace(/\D/g, "");
  expect(now).toMatch(/^\d{6}$/);
  await paste(page, now || code);
  await expect(page.getByRole("heading", { name: "Как да ви наричаме?" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("login: prototype panel and offline state only in preview", async ({ page }) => {
  await open(page, "?preview=1");
  await expect(page.locator("[data-pv]")).toBeVisible();
  await page.locator("[data-offline]").click();
  /* no toast over the page: the switch itself says it */
  await expect(page.locator("[data-offline]")).toHaveText(/вкл\.$/);
  await expect(page.locator("[data-offline]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".toast.on")).toHaveCount(0);
  expect((await page.locator(".toast").allTextContents()).join("")).toBe("");
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.locator(".alert")).toContainText("Няма връзка с интернет");
  await expect(page.locator(".alert")).toContainText("Номерът ви е запазен");
});

/* decision 12.11: "при 429 главното действие е „Обади се · 0894 36 55 77“" (as in the cart); 503 sms_unavailable the same */
async function expectCallIsMain(page: Page, title: string, text: string | RegExp) {
  const al = page.locator(".alert");
  await expect(al.locator("[data-alerth]")).toHaveText(title);
  await expect(al.locator("[data-alerth]")).toBeFocused();
  await expect(al).toContainText(text);
  await expect(page.getByRole("button", { name: "Опитай пак" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Изпрати код по SMS" })).toHaveCount(0);
  /* the one red action of the form is the call, in the place of "Изпрати код по SMS" */
  const main = page.locator("form[data-f=phone] > .pill-red:visible");
  await expect(main).toHaveCount(1);
  await expect(main).toHaveAttribute("href", TEL);
  await expect(main).toContainText("Обади се · 0894 36 55 77");
  await expect(page.locator(".lg-f a[href^='tel:']")).toHaveCount(1);
  /* Enter in the field sends nothing and brings the message back */
  await page.locator("#ph").press("Enter");
  await expect(al.locator("[data-alerth]")).toBeFocused();
}

test("login: 429 throttled (too many requests from this place): the main action is the call", async ({ page }) => {
  const errors = watch(page);
  let n = 0;
  await page.route("**/api/auth/sms/request", (r) => { n++; return r.fulfill(j429("throttled", "Твърде много опити. Опитайте след 10 минути.")); });
  await open(page);
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expectCallIsMain(page, "Не успяхме да изпратим кода", "Опитайте след 10 минути");
  expect(n).toBe(1);
  /* the limit is for this place: another number is still refused, the call stays */
  await page.locator("#ph").fill(rnd());
  await expect(page.locator("form[data-f=phone] > a.pill-red")).toHaveAttribute("href", TEL);
  expect(errors).toEqual([]);
});

test("login: 429 too_many (5 codes an hour for the number): the call is the main action until another number", async ({ page }) => {
  const errors = watch(page);
  await page.route("**/api/auth/sms/request", (r) => r.fulfill(j429("too_many", "Твърде много кодове за този номер. Опитайте след час или ни се обадете на 0894 36 55 77.")));
  await open(page);
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expectCallIsMain(page, "Не успяхме да изпратим кода", "Твърде много кодове за този номер");
  /* the limit is per number: with another number the form can send again */
  await page.unroute("**/api/auth/sms/request");
  await page.locator("#ph").fill(rnd());
  await expect(page.getByRole("button", { name: "Изпрати код по SMS" })).toBeVisible();
  await expect(page.locator(".alert")).toHaveCount(0);
  await expect(page.locator("[data-callmain]")).toHaveCount(0);
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.getByRole("heading", { name: "Въведете кода" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("login: 503 sms_unavailable (no SMS provider): the call is the main action, no retry", async ({ page }) => {
  const errors = watch(page);
  await page.route("**/api/auth/sms/request", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "sms_unavailable", message: "Входът с код по SMS още не работи. Обадете ни се на 0894 36 55 77." }) }));
  await open(page);
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expectCallIsMain(page, "Входът с код още не работи", "Обадете ни се на 0894 36 55 77");
  expect(errors).toEqual([]);
});

test("login: 429 too_soon on the phone step (reload, new tab): the code step with the countdown", async ({ page }) => {
  const errors = watch(page);
  await page.route("**/api/auth/sms/request", (r) => r.fulfill(j429("too_soon", "Нов код може след 22 сек.", { retryIn: 22 })));
  await open(page);
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.getByRole("heading", { name: "Въведете кода" })).toBeVisible();
  await expect(page.locator(".alert")).toHaveCount(0);
  await expect(page.locator("[data-demo-code]")).toHaveCount(0); /* this page does not know that code */
  await expect(page.locator("[data-resend]")).toContainText(/Изпрати нов код след 0:(22|21|20)/);
  await expect(page.locator(".otp input").first()).toBeFocused();
  expect(errors).toEqual([]);
});

test("login: 429 on \"Изпрати нов код\" after a dead code: the red call takes its place", async ({ page }, info) => {
  const errors = watch(page);
  await firstReal(page, j429("too_many", "Твърде много кодове за този номер. Опитайте след час или ни се обадете на 0894 36 55 77."));
  await open(page);
  const code = await toCode(page, rnd());
  for (let i = 0; i < 5; i++) {
    await paste(page, wrongOf(code));
    await expect(page.locator("#otp-err")).toHaveText(/Кодът не съвпада/);
    await expect(page.locator(".otp input").first()).toBeEnabled();
  }
  await paste(page, wrongOf(code)); /* the 6th: too many tries, the code is dead */
  await expect(page.locator("#otp-err")).toContainText("поискайте нов код");
  await expect(page.locator("[data-demo-code]")).toHaveCount(0); /* the dead code is not offered again (login.review кръг 2) */
  await page.getByRole("button", { name: "Изпрати нов код" }).click();
  const al = page.locator(".alert");
  await expect(al.locator("[data-alerth]")).toHaveText("Не успяхме да изпратим нов код");
  await expect(al.locator("[data-alerth]")).toBeFocused();
  await expect(al).toContainText("Твърде много кодове за този номер");
  await expect(page.getByRole("button", { name: "Изпрати нов код" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Опитай пак" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Потвърди кода" })).toHaveCount(0);
  await expect(page.locator("[data-resend] a.pill-red")).toHaveAttribute("href", TEL);
  await expect(page.locator("#otp-err")).not.toContainText("поискайте");
  if (info.project.name === "desktop") { /* "Назад" under the main button, now the call */
    const [bk, cl] = [await page.locator(".flow-back").boundingBox(), await page.locator("[data-resend] a.pill-red").boundingBox()];
    expect(bk!.y).toBeGreaterThanOrEqual(cl!.y + cl!.height);
  }
  /* "Назад": the phone step keeps the lock for this number */
  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.locator("form[data-f=phone] > a.pill-red")).toHaveAttribute("href", TEL);
  await expect(page.getByRole("button", { name: "Изпрати код по SMS" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("login: 429 on \"Изпрати нов код\" while the code still works: the call in its place, \"Потвърди кода\" stays", async ({ page }) => {
  const errors = watch(page);
  await firstReal(page, j429("throttled", "Твърде много опити. Опитайте след 10 минути."));
  await open(page);
  const code = await toCode(page, rnd());
  await page.getByRole("button", { name: "Изпрати нов код" }).click();
  await expect(page.locator(".alert [data-alerth]")).toBeFocused();
  await expect(page.getByRole("button", { name: "Изпрати нов код" })).toHaveCount(0);
  await expect(page.locator("[data-resend] a[href^='tel:']")).toHaveAttribute("href", TEL);
  await expect(page.getByRole("button", { name: "Потвърди кода" })).toBeVisible();
  await paste(page, code);
  await expect(page.getByRole("heading", { name: "Как да ви наричаме?" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("login: the code and name steps stay inside the card at 360 and 375 (nothing cut by the screen edge)", async ({ page }) => {
  const errors = watch(page);
  await page.setViewportSize({ width: 360, height: 760 });
  await open(page);
  const code = await toCode(page, rnd());
  await inCard(page, ".otp input:last-child");
  await inCard(page, ".core.box [type=submit]");
  await inCard(page, ".stepper .t");
  await page.setViewportSize({ width: 375, height: 760 });
  await inCard(page, ".otp input:last-child");
  await inCard(page, ".core.box [type=submit]");
  await page.setViewportSize({ width: 360, height: 760 });
  await paste(page, code);
  await expect(page.getByRole("heading", { name: "Как да ви наричаме?" })).toBeVisible();
  await inCard(page, ".core.box [type=submit]");
  await inCard(page, "#nm");
  await inCard(page, ".stepper .t");
  /* the label of the button is not cut inside it either */
  const cut = await page.locator(".core.box .pill").evaluateAll((els) => els.filter((e) => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1).length);
  expect(cut).toBe(0);
  expect(errors).toEqual([]);
});

test("login: \"Назад\" says where it goes: the bar on a phone, a text link under the main button at 1440", async ({ page }, info) => {
  await open(page);
  await toCode(page, rnd());
  const back = page.getByRole("button", { name: "Назад: Телефон", exact: true });
  await expect(back).toHaveCount(1);
  if (info.project.name === "desktop") {
    await expect(back).toHaveClass(/\bflow-back\b/);
    await expect(back).toHaveClass(/\blink\b/);
    const [b, s] = [await back.boundingBox(), await page.locator(".core.box [type=submit]").boundingBox()];
    expect(b!.y).toBeGreaterThanOrEqual(s!.y + s!.height);
  } else {
    await expect(back).toHaveClass(/\bpill\b/);
    await expect(page.locator(".acts2").getByRole("button", { name: "Назад: Телефон" })).toBeVisible();
  }
  await back.click();
  await expect(page.locator("#ph")).toBeFocused();
});

test("login: an error while sending the code puts the focus on the title of the message (500 and offline)", async ({ page, context }) => {
  await page.route("**/api/auth/sms/request", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "server", message: "Нещо се обърка при нас." }) }));
  await open(page);
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.locator(".alert [data-alerth]")).toBeFocused();
  await page.unroute("**/api/auth/sms/request");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Изпрати код по SMS" }).first().click();
  await expect(page.locator(".alert [data-alerth]")).toHaveText("Няма връзка с интернет");
  await expect(page.locator(".alert [data-alerth]")).toBeFocused();
  /* the same actions as the cart and the reservation (decision 12.11.2026, кръг 4) */
  await expect(page.locator(".alert")).toContainText("Проверете връзката и опитайте пак");
  await expect(page.locator(".alert a[href=\"tel:+359894365577\"]")).toContainText("Обади се · 0894 36 55 77");
  await expect(page.locator(".alert").getByRole("button", { name: "Опитай пак" })).toBeVisible();
  await context.setOffline(false);
});
