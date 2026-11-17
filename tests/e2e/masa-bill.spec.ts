import { test, expect } from "@playwright/test";
import { PV, codeOf, phone, staff, tableN, watch, guest, tok } from "./masa-helpers.ts";
import { E } from "./own-server.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* QR маса · the bill from two (and three) phones: „По ястия“ with the shared picks („Телефон 1 плаща“ locked, „Още никой
   не плаща“ / „Всички ястия са разпределени“), „Поискай моята част“, the other phone's line without its sum, „Поискай
   останалото“, „Всичко вече е поискано“ for a third phone; the rating with BOTH answers: the -10% code for both, the
   Google line for both (never a discount for a Google review), the text only to the manager. */
test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD || !E.WAITER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("the bill by dishes from two phones, the rest, „Всичко вече е поискано“; the rating Да and Не", async ({ page, browser, baseURL }) => {
  test.setTimeout(90_000);
  const errs = watch(page);
  const n = tableN(page, 5), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const A = tok("bill-a" + n), B = tok("bill-b" + n), C = tok("bill-c" + n);
  const ga = guest(W.r, t.code, A), gb = guest(W.r, t.code, B);
  const p2 = await phone(browser, page, baseURL!, B), p3 = await phone(browser, page, baseURL!, C);
  try {
    /* phone 1: Шопска салата 4,75; phone 2: Кебапчета 7,61 + Пържени картофи 2,19 */
    const v1 = await ga.open(true); await gb.open(true);
    await ga.add("shopska-salata"); await gb.add("kebapcheta"); await gb.add("parzheni-kartofi");
    await ga.send(); await W.confirm(n);
    const me = v1.me.phone as number;
    await page.addInitScript((x) => localStorage.setItem("sc-masa-g", x), A);
    await page.goto("/masa/" + t.code + "/smetka/" + PV);
    await p2.page.goto("/masa/" + t.code + "/smetka/" + PV);
    await expect(page.locator(".tot .price")).toHaveText("14,55 €");
    await expect(page.locator("[data-req]")).toHaveText("Поискай сметката · 14,55 €");
    /* phone 1: „По ястия“ ticks its own dish */
    await page.locator('[data-split="dishes"]').click();
    await expect(page.locator(".bl.pick", { hasText: "Шопска салата" }).locator("input")).toBeChecked();
    await expect(page.locator(".mine .price")).toHaveText("4,75 €");
    await expect(page.locator(".unas")).toHaveText(/Още никой не плаща: 2 ястия\s*9,80 €/);
    /* phone 2 sees it locked, live */
    await p2.page.locator('[data-split="dishes"]').click();
    const taken = p2.page.locator(".bl.taken", { hasText: "Шопска салата" });
    await expect(taken).toContainText("Телефон " + me + " плаща");
    await expect(taken.locator("input")).toBeDisabled();
    await expect(p2.page.locator(".unas")).toContainText("Всички ястия са разпределени");
    await expect(page.locator(".unas")).toContainText("Всички ястия са разпределени");
    /* phone 1 asks for its part */
    await page.locator("[data-req]").click();
    await expect(page.locator(".coming h2")).toContainText(/Сервитьорът идва със сметката · чакате 0:0\d/);
    await expect(page.locator(".coming .kvs")).toContainText("Вашата част4,75 €");
    /* phone 2: the other's request in one short line, without its sum; "Една сметка" = the rest */
    const oth = p2.page.locator(".mnote .oth");
    await expect(oth).toHaveText(new RegExp("Телефон " + me + " плаща своята част отделно \\(в брой\\) · \\d\\d:\\d\\d"));
    await expect(oth).not.toContainText("€");
    await p2.page.locator('[data-split="one"]').click();
    await expect(p2.page.locator(".mine")).toContainText("Остават9,80 €");
    await p2.page.locator('[data-pay="card"]').click();
    await expect(p2.page.locator("[data-req]")).toHaveText("Поискай останалото · 9,80 €");
    await p2.page.locator("[data-req]").click();
    await expect(p2.page.locator(".coming .kvs")).toContainText("С карта");
    /* the bill call joined the first: the same waiting time on both phones */
    /* a third phone: everything is asked for already */
    await p3.page.goto("/masa/" + t.code + "/smetka/" + PV);
    await expect(p3.page.locator("[data-req]")).toHaveText("Всичко вече е поискано");
    await expect(p3.page.locator("[data-req]")).toHaveAttribute("aria-disabled", "true");
    await expect(p3.page.locator(".mnote .oth")).toHaveCount(2);

    /* the rating: „Да“ → the code and the Google line; „Не“ → the text for the manager, the code and the Google line */
    await expect(page.locator(".rate h2")).toHaveText("Останахте ли доволни?");
    await page.locator('[data-rate="yes"]').click();
    await expect(page.locator(".code [data-code]")).toHaveText(/^SC10-\d+$/);
    await expect(page.locator(".rate")).toContainText("Кодът е за оценката ви тук. Отзивът в Google е по желание и не носи отстъпка.");
    await expect(page.locator(".rate")).toContainText("Напиши отзив в Google");
    await expect(page.locator(".rate .missing")).toHaveText("[ЛИПСВА: линк за отзив в Google]");
    await p2.page.locator('[data-rate="no"]').click();
    await expect(p2.page.locator(".ans h3")).toHaveText("Съжаляваме. Благодарим, че ни казвате.");
    await expect(p2.page.locator(".code [data-code]")).toHaveText(/^SC10-\d+$/);
    await expect(p2.page.locator(".rate")).toContainText("Кодът е за оценката ви тук. Отзивът в Google е по желание и не носи отстъпка.");
    await expect(p2.page.locator(".rate")).toContainText("Отзив в Google");
    await expect(p2.page.locator(".rate .missing")).toHaveText("[ЛИПСВА: линк за отзив в Google]");
    await expect(p2.page.locator("label[for=fb]")).toHaveText("Как да подобрим обслужването?");
    await p2.page.locator("[data-fb]").click();
    await expect(p2.page.locator("#fbe")).toHaveText("Напишете няколко думи, за да го изпратим.");
    await p2.page.locator("#fb").fill("Чакахме дълго за сметката.");
    await p2.page.locator("[data-fb]").click();
    await expect(p2.page.locator(".fbsent")).toContainText("Изпратихме го на управителя.");
    /* the codes are personal and different; phone 1 never sees phone 2's answer */
    expect(await page.locator(".code [data-code]").textContent()).not.toBe(await p2.page.locator(".code [data-code]").textContent());
    await expect(page.locator(".fbsent")).toHaveCount(0);
    /* the text reaches the manager */
    const M = await staff(browser, baseURL!, "admin");
    const rt = await M.ok(M.r.get("/api/floor/ratings"));
    expect(JSON.stringify(rt)).toContain("Чакахме дълго за сметката.");
    await M.ctx.close();
    expect(errs).toEqual([]);
    expect(p2.errors).toEqual([]);
  } finally { await W.clear(n).catch(() => {}); await p2.ctx.close(); await p3.ctx.close(); await W.ctx.close(); }
});
