import { test, expect, type Page } from "@playwright/test";

/* Login (/vhod/): phone -> SMS code (6 boxes, the code comes back as demoCode and is shown as demo) -> name for a new
   profile (marketing unticked) -> -10% "от следващата поръчка"; returning number goes on to /profil/ or ?next=;
   wrong code, too many tries (limit in the core), blocked number, invalid phone, already signed in, noindex. */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  /* expected API answers (wrong code 401, blocked 403, expired 410, too many 429) show as resource errors in Chromium */
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|403|410|422|429)/.test(m.text())) errors.push(m.text()); });
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
  const again = page.getByRole("button", { name: "Изпрати нов код" });
  await expect(again).toBeVisible();
  /* within 30 s the core answers too_soon: the countdown comes back, no error */
  await again.click();
  await expect(page.locator("[data-resend]")).toContainText("Изпрати нов код след");
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
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  await expect(page.locator(".alert")).toContainText("Няма връзка с интернет");
  await expect(page.locator(".alert")).toContainText("Номерът ви е запазен");
});

test("login: too many SMS (429): the action is the call, not 'Опитай пак'", async ({ page }) => {
  await page.route("**/api/auth/sms/request", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "throttled", message: "Твърде много опити. Опитайте след 10 минути." }) }));
  await open(page);
  await page.locator("#ph").fill(rnd());
  await page.getByRole("button", { name: "Изпрати код по SMS" }).click();
  const al = page.locator(".alert");
  await expect(al).toContainText("Твърде много опити");
  await expect(al.locator('a[href="tel:+359894365577"]')).toContainText("Обади се · 0894 36 55 77");
  await expect(al.getByRole("button", { name: "Опитай пак" })).toHaveCount(0);
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
  await context.setOffline(false);
});
