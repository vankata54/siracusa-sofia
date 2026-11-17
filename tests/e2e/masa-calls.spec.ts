import { test, expect } from "@playwright/test";
import { PV, codeOf, phone, staff, tableN, watch, tok } from "./masa-helpers.ts";
import { E } from "./own-server.ts";
import { ownServer, signIn } from "./own-server.ts";
import { assertPortFree } from "./_port.ts";

/* QR маса · „Повикай сервитьор“: the call with a live timer from the core's time, the second phone sees it, „Отмени
   повикването“ with „Отмени“, „Друго“ with a few words; the waiter „Отивам“ / „Обслужено“ → the same call is locked
   („Пак след 2:5x“) with the explanation; the manager line after settings.callManager minutes (an own server: the
   admin sets 1 minute there and the test waits the real minute). */
test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD || !E.WAITER_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("calls: active with a live timer on two phones, cancel and „Отмени“, „Друго“, locked after „Обслужено“", async ({ page, browser, baseURL }) => {
  test.setTimeout(60_000);
  const errs = watch(page);
  const n = tableN(page, 4), t = await codeOf(browser, baseURL!, n);
  const W = await staff(browser, baseURL!, "waiter");
  await W.clear(n);
  const p2 = await phone(browser, page, baseURL!);
  try {
    await page.goto("/masa/" + t.code + "/povikvane/" + PV);
    await expect(page.locator(".tile")).toHaveCount(4);
    await expect(page.locator('.tile[href$="/smetka/"]')).toContainText("Сметка");
    await expect(page.locator(".why")).toContainText("ако минат 5 мин, известяваме и управителя");
    await expect(page.locator(".why")).toContainText("същото повикване може пак след 3 мин");
    await page.locator('[data-call="water"]').click();
    const live = page.locator(".coming");
    await expect(live.locator("h2")).toContainText(/Сервитьорът идва · чакате 0:0\d/);
    await expect(live).toContainText("Вода или прибори · повикан в 19:42");
    const t0 = await live.locator("[data-wt]").textContent();
    await expect(live.locator("[data-wt]")).not.toHaveText(t0!, { timeout: 4000 }); /* the timer runs */
    await expect(page.locator('[data-locked="water"]')).toContainText("Вече повикахме");
    /* the other phone sees the call */
    await p2.page.goto("/masa/" + t.code + "/povikvane/" + PV);
    await expect(p2.page.locator(".coming")).toContainText("Вода или прибори");
    /* pressing it again only explains */
    await page.locator('[data-locked="water"]').dispatchEvent("click");
    await expect(page.locator(".toast")).toContainText("Вече повикахме. Сервитьорът вижда, че чакате");
    await expect(page.locator(".why.hl")).toBeVisible();
    /* „Отмени повикването“ → „Отмени“: the same call, the same time */
    await live.locator("[data-cancel]").click();
    await expect(page.locator(".coming")).toHaveCount(0);
    await expect(p2.page.locator(".coming")).toHaveCount(0);
    await page.locator(".toast button", { hasText: "Отмени" }).click();
    await expect(page.locator(".coming")).toContainText("Вода или прибори");
    /* „Друго“ with a few words, from the second phone */
    await p2.page.locator('[data-call="other"]').click();
    const sh = p2.page.locator(".sheetwrap.on .sheet");
    await sh.locator("#oth").fill("детско столче");
    await sh.locator("[data-osend]").click();
    await expect(page.locator(".coming", { hasText: "Друго" })).toContainText("„детско столче“");
    /* the waiter: „Отивам“, „Обслужено“ → locked for the cooldown, with the reason */
    const hall = await W.hall();
    const call = hall.calls.find((c: { table: { n: number }; kind: string }) => c.table.n === n && c.kind === "water");
    expect(call).toBeTruthy();
    await W.ok(W.r.post("/api/floor/call/" + call.id + "/take"));
    await W.ok(W.r.post("/api/floor/call/" + call.id + "/done"));
    const locked = page.locator('[data-locked="water"]');
    await expect(locked).toContainText("Сервитьорът току-що дойде");
    await expect(locked).toContainText(/Пак след [23]:\d\d/);
    await expect(locked).toHaveAttribute("aria-disabled", "true");
    await locked.dispatchEvent("click");
    await expect(page.locator(".toast")).toContainText(/Сервитьорът току-що дойде\. Пак след [23]:\d\d/);
    /* the core refuses the same call too (another phone) */
    const r = await W.r.post("/api/floor/t/" + t.code + "/call", { data: { g: await p2.page.evaluate(() => localStorage.getItem("sc-masa-g")), kind: "water" } });
    expect(r.status()).toBe(409);
    expect((await r.json()).retryIn).toBeGreaterThan(100);
    /* the other tiles work at once */
    await expect(page.locator('[data-call="order"]')).toBeEnabled();
    expect(errs).toEqual([]);
    expect(p2.errors).toEqual([]);
  } finally { await W.clear(n).catch(() => {}); await p2.ctx.close(); await W.ctx.close(); }
});

test("the manager line after settings.callManager minutes (the admin sets 1 minute) @phone", async ({ page }) => {
  test.setTimeout(120_000);
  const port = +(process.env.E2E_PORT || 8788) + 7;
  await assertPortFree(port);
  const own = await ownServer("masa-mgr", 7);
  try {
    const ctx = page.context();
    await signIn(ctx, own.base, "admin");
    expect((await ctx.request.patch(own.base + "/api/admin/settings", { data: { callManager: 1 } })).status()).toBe(200);
    const code = ((await (await ctx.request.get(own.base + "/api/admin/qr")).json()) as { n: number; code: string }[]).find((x) => x.n === 3)!.code;
    await ctx.addInitScript((x) => localStorage.setItem("sc-masa-g", x), tok("mgr"));
    await page.goto(own.base + "/masa/" + code + "/povikvane/" + PV);
    await expect(page.locator(".why")).toContainText("ако минат 1 мин, известяваме и управителя");
    await page.locator('[data-call="order"]').click();
    await expect(page.locator(".coming")).toContainText("Ако не отговори до 1 мин, известието отива и при управителя.");
    /* the real minute (the page counts from the core's time, so a faked page clock would not count) */
    await expect(page.locator(".coming .mgr")).toHaveText("Чакате над 1 мин. Известихме и управителя.", { timeout: 75_000 });
    await expect(page.locator(".coming [data-wt]")).toHaveText(/^1:0\d$/);
  } finally { await own.stop(); }
});
