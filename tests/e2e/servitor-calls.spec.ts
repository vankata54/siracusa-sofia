import { test, expect } from "@playwright/test";
import { admin, kitchen, newWaiter, signInCtx, startShift, endShift, guest, freeTable, cook, errors, serious, ready } from "./servitor-helpers.ts";
import { floorLock } from "./_floor-lock.ts";
floorLock(); /* the live hall is shared: one such test at a time (tests/e2e/_floor-lock.ts) */

/* "Повиквания" (/servitor/povikvania/; design/pages-servitor/calls.html) and "Готови" (/servitor/gotovi/; ready.html) on
   the real server: ONE queue number (the badge and "За мен N"), the QR order to confirm with "Отвори масата", "Отивам" →
   "Обслужено", two waiters (the other's taken call is dimmed with "Поема <име>"), a table order cooked by the kitchen comes
   live in "Готови" → "Сервирах" + "Отмени". Each test has its own waiters and tables. */
test.describe.configure({ mode: "serial" });

test("@phone the queue: a call and a QR order come live; ONE number; „Отивам“ → „Обслужено“; „Отвори масата“", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), w = await newWaiter(a);
  await freeTable(a, 5); await freeTable(a, 6);
  await startShift(w, [5, 6]);
  try {
    await signInCtx(context, w);
    await page.goto("/servitor/povikvania/");
    await ready(page);
    await expect(page.locator(".st-top h1")).toHaveText("Повиквания");
    await expect(page.locator('[data-f="mine"]')).toHaveAttribute("aria-pressed", "true");
    const g5 = await guest(a, 5), g6 = await guest(a, 6);
    expect((await g5.call("order")).status).toBe(200);
    const c5 = page.locator("article.callc", { has: page.locator(".t1 b", { hasText: /^Маса 5$/ }) });
    await expect(c5).toBeVisible();
    await expect(c5).toHaveAttribute("aria-label", "Маса 5, Поръчка");
    await expect(c5.locator(".meta")).toContainText("Моя маса");
    await expect(c5.locator(".timer b")).toHaveText(/^\d+:\d\d$/);
    await expect(c5.locator(".zone")).toHaveText("Салон");
    /* the first QR order of the sitting waits for the waiter: in the same queue, with "Отвори масата" */
    expect((await g6.post("cart/add", { id: "pitsa-margarita" })).status).toBe(200);
    expect((await g6.post("send")).body.to).toBe("waiter");
    const q6 = page.locator("article.callc.qrc", { has: page.locator(".t1 b", { hasText: /^Маса 6$/ }) });
    await expect(q6).toBeVisible();
    await expect(q6.locator(".why")).toHaveText("QR поръчка · 1 артикул");
    await expect(q6.locator(".meta")).toContainText("Първата поръчка от QR чака моето потвърждение · ");
    await expect(q6.locator("a", { hasText: "Отвори масата" })).toHaveAttribute("href", "/servitor/masa/#6");
    /* ONE number: "За мен N" = the badge (the same load) */
    const nums = await page.evaluate(() => [document.querySelector('[data-f="mine"] .n')!.textContent, document.querySelector('.st-nav [data-cnt="calls"] [data-n]')!.textContent]);
    expect(nums[0]).toBe(nums[1]);
    expect(+nums[0]!).toBeGreaterThanOrEqual(2);
    expect(await serious(page)).toEqual([]);
    /* "Отивам": green frame, "Отивам · от 0:00", at the bottom; "Обслужено" with "Отмени" */
    await c5.locator("button", { hasText: "Отивам" }).click();
    await expect(page.locator(".st-toast")).toHaveText("Маса 5: отивам. Колегите виждат, че масата е поета.");
    await expect(c5).toHaveClass(/mine-taken/);
    await expect(c5.locator(".meta")).toContainText(/Отивам · от \d+:\d\d/);
    await c5.locator("button", { hasText: "Обслужено" }).click();
    await expect(c5).toHaveCount(0);
    await expect(page.locator(".st-toast button")).toHaveText("Отмени");
    /* "Отвори масата" leads to the table */
    await q6.locator("a", { hasText: "Отвори масата" }).click();
    await expect(page).toHaveURL(/\/servitor\/masa\/#6$/);
    expect(errs).toEqual([]);
  } finally { await endShift(w); await freeTable(a, 5); await freeTable(a, 6); }
});

test("@phone two waiters: the other's taken call is dimmed with „Поема <име>“ in „Всички“ and not in „За мен“", async ({ page, context }) => {
  const a = await admin(), w1 = await newWaiter(a), w2 = await newWaiter(a);
  await freeTable(a, 8); await freeTable(a, 9);
  await startShift(w1, [8]); await startShift(w2, [9]);
  try {
    await signInCtx(context, w1);
    await page.goto("/servitor/povikvania/");
    await ready(page);
    const g9 = await guest(a, 9);
    expect((await g9.call("bill")).status).toBe(200);
    const c9 = page.locator("article.callc", { has: page.locator(".t1 b", { hasText: /^Маса 9$/ }) });
    /* nobody took it yet: it is in my queue too, and says why */
    await expect(c9.locator(".meta")).toContainText("Маса на " + w2.name + " · никой не го е поел, затова е и при мен");
    const hall = await (await w2.api.get("/api/floor/hall")).json();
    const id = hall.calls.find((c: { table: { n: number } }) => c.table.n === 9).id;
    expect((await w2.api.post("/api/floor/call/" + id + "/take")).status()).toBe(200);
    await expect(c9).toHaveCount(0);
    await page.locator('[data-f="all"]').click();
    await expect(c9).toHaveClass(/other-taken/);
    await expect(c9.locator(".meta")).toContainText("Поема " + w2.name);
    await expect(c9.locator("button")).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector(".callc.other-taken")!).opacity)).toBe("0.7");
    /* the colleague's call cannot be closed by me (the core says who has it) */
    const r = await w1.api.post("/api/floor/call/" + id + "/done");
    expect(r.status()).toBe(409);
    expect((await r.json()).message).toBe("Повикването вече е поето от " + w2.name + ".");
  } finally { await endShift(w1); await endShift(w2); await freeTable(a, 8); await freeTable(a, 9); }
});

test("@phone „Готови“: a table order cooked by the kitchen comes live; „Сервирах“ and „Отмени“", async ({ page, context }) => {
  const errs = errors(page);
  const a = await admin(), k = await kitchen(), w = await newWaiter(a);
  await freeTable(a, 10);
  await startShift(w, [10]);
  try {
    await signInCtx(context, w);
    await page.goto("/servitor/gotovi/");
    await ready(page);
    await expect(page.locator(".st-top h1")).toHaveText("Готови");
    const o = await (await w.api.post("/api/floor/table/10/order", { data: { lines: [{ id: "pitsa-margarita", q: 2, note: "без маслини" }, { id: "gratska-salata", q: 1 }] } })).json();
    expect(o.orders.length).toBe(1);
    await cook(k, o.orders[0]);
    const card = page.locator("article.rcard", { has: page.locator(".hd b", { hasText: /^Маса 10$/ }) });
    await expect(card).toBeVisible();
    await expect(card).not.toHaveClass(/other/);
    await expect(card.locator(".hd .tm")).toHaveText(/^чака \d+:\d\d$/);
    await expect(card.locator(".oline")).toHaveCount(2);
    await expect(card.locator(".oline").first().locator(".q")).toHaveText("2×");
    await expect(card.locator(".oline .note")).toHaveText("без маслини");
    await expect(card.locator(".oline .cat").first()).toHaveText("Пици на пещ");
    await expect(card.locator("a", { hasText: "Масата" })).toHaveAttribute("href", "/servitor/masa/#10");
    await expect(page.locator('.st-nav [data-cnt="ready"]')).toBeVisible();
    expect(await serious(page)).toEqual([]);
    await card.locator("button", { hasText: "Сервирах" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator(".st-toast span")).toHaveText("Маса 10: сервирано");
    let d = await (await w.api.get("/api/floor/table/10")).json();
    expect(d.bills[0].orders[0].statusLabel).toBe("Сервирана");
    await page.locator(".st-toast button", { hasText: "Отмени" }).click();
    await expect(card).toBeVisible();
    d = await (await w.api.get("/api/floor/table/10")).json();
    expect(d.bills[0].orders[0].lines.every((l: { st: string }) => l.st === "ready")).toBe(true);
    expect(errs).toEqual([]);
  } finally { await endShift(w); await freeTable(a, 10); }
});
