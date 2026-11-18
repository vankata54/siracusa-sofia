import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { signIn, errors, axe, ready, layout, isPhone, twoNoShows, rnd } from "./sobstvenik-helpers.ts";

/* "Собственик" › "Решения" (/sobstvenik/reshenia/, src/modules/sobstvenik/decisions.ts) on the real server: the
   questions of the agency ("Съгласен" -> ONE note kind "answer" in the admin's notes, the next question comes, "Отмени"
   takes it back, "Друго" with an empty text shows "Напиши отговора си.", "Промени отговора" keeps one note with its
   history), the main admin reads only, "Блокирай" / "Не блокирай" a no-show (two no-shows made through the admin's
   reservations) with the confirmation and the focus on the card's title, the layout and axe.
   The answers are shared state: the flow runs once (@desktop), in order. */

type Note = { id: string; kind?: string; q?: { id: string; answer: string; other: string }; answers?: unknown[] };
const answers = async (ctx: BrowserContext, qid: string) => ((await (await ctx.request.get("/api/admin/notes?kind=answer")).json()) as Note[]).filter((n) => n.q && n.q.id === qid);
const card = (page: Page) => page.locator("#dc-focus");
async function waitCount(page: Page): Promise<number> { const t = (await page.locator('.dc-filter [data-f="wait"]').textContent()) || ""; return +(t.match(/(\d+)\s*$/) || ["", "0"])[1]; }

test.describe.serial("@desktop the questions of the agency", () => {
  test("„Съгласен“ -> a note in „Бележки“, the next question, „Отмени“; „Друго“ empty -> the error; „Промени отговора“ keeps one note", async ({ page, context }) => {
    const errs = errors(page);
    await signIn(context, "owner");
    await page.goto("/sobstvenik/reshenia/");
    await ready(page, "Решения", "#dc-focus, .ow-empty");
    await expect(page.locator(".ow-lead")).toContainText("Тук решаваш.");
    const n0 = await waitCount(page), q1 = (await card(page).getAttribute("data-qid"))!;
    await expect(card(page).locator(".eye")).toContainText("Въпрос 1 от " + n0);
    await expect(card(page)).toContainText("Агенцията прилага отговора. Нищо не се сменя, докато тя не го одобри.");
    /* "Съгласен" */
    await card(page).locator("[data-agree]").click();
    await expect(page.locator(".bs-toast")).toContainText("Отговорът е при агенцията");
    await expect(card(page)).not.toHaveAttribute("data-qid", q1);
    await expect(card(page).locator(".eye")).toContainText("Въпрос 1 от " + (n0 - 1));
    await expect(page.locator("#dc-qt")).toBeFocused();
    let l = await answers(context, q1);
    expect(l.length).toBe(1);
    expect(l[0].q!.answer).toBe("default");
    /* "Отмени": the note goes, the question is back */
    await page.locator(".bs-toast [data-tu]").click();
    await expect.poll(async () => (await answers(context, q1)).length).toBe(0);
    await expect(card(page)).toHaveAttribute("data-qid", q1);
    expect(await waitCount(page)).toBe(n0);
    /* again "Съгласен" (kept), then "Друго" on the next one: empty -> the error under the field */
    await card(page).locator("[data-agree]").click();
    await expect(card(page)).not.toHaveAttribute("data-qid", q1);
    let q2 = (await card(page).getAttribute("data-qid"))!;
    if (!(await card(page).locator("[data-other]").count())) { await card(page).locator("[data-next]").click(); q2 = (await card(page).getAttribute("data-qid"))!; }
    await card(page).locator("[data-other]").click();
    await expect(page.locator("#dc-other")).toBeFocused();
    await card(page).locator("[data-send]").click();
    await expect(page.locator("#dc-oe")).toHaveText("Напиши отговора си.");
    await expect(page.locator("#dc-other")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#dc-other")).toBeFocused();
    expect((await answers(context, q2)).length).toBe(0);
    await page.locator("#dc-other").fill("Да, но само в събота.");
    await card(page).locator("[data-send]").click();
    await expect(page.locator(".bs-toast")).toContainText("Отговорът е при агенцията");
    await expect.poll(async () => (await answers(context, q2)).map((n) => n.q!.other)).toEqual(["Да, но само в събота."]);
    /* "Отговорени": "Промени отговора" on the first one keeps ONE note with its history */
    await page.locator('.dc-filter [data-f="done"]').click();
    await expect(page).toHaveURL(/f=done/);
    await page.locator('.dc-row[data-q="' + q1 + '"]').click();
    await expect(card(page)).toHaveAttribute("data-qid", q1);
    await expect(card(page).locator(".dc-ans")).toContainText("Съгласен с варианта по подразбиране");
    await card(page).locator("[data-change]").click();
    await page.locator("#dc-other").fill("Само на място, без изключения.");
    await card(page).locator("[data-send]").click();
    await expect(page.locator(".bs-toast")).toContainText("Отговорът е сменен");
    await expect.poll(async () => { const x = await answers(context, q1); return x.length + ":" + (x[0] && x[0].q!.other); }).toBe("1:Само на място, без изключения.");
    l = await answers(context, q1);
    expect((l[0].answers || []).length).toBeGreaterThan(0);
    await expect(card(page).locator(".dc-ans")).toContainText("отговорът е сменян");
    /* the note is in the admin's "Бележки" as the owner's (the filter of the answers) */
    expect(l[0].kind).toBe("answer");
    expect(await axe(page)).toEqual([]);
    expect(errs).toEqual([]);
  });

  test("no connection: the answer is kept on the phone, shown on its card, the next question comes; it goes when the connection is back", async ({ page, context }) => {
    await signIn(context, "owner");
    await page.goto("/sobstvenik/reshenia/");
    await ready(page, "Решения", "#dc-focus, .ow-empty");
    const q = (await card(page).getAttribute("data-qid"))!, n = await waitCount(page);
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(page.locator(".bs-net")).toBeVisible();
    if (!(await card(page).locator("[data-agree]").count())) { await card(page).locator("[data-other]").click(); await page.locator("#dc-other").fill("Да."); await card(page).locator("[data-send]").click(); }
    else await card(page).locator("[data-agree]").click();
    await expect(page.locator(".bs-toast")).toHaveText(/^Отговорът (на т\. \S+ )?е записан на телефона\. Тръгва сам, щом има връзка\.$/);
    await expect(card(page)).not.toHaveAttribute("data-qid", q);
    expect(await waitCount(page)).toBe(n - 1);
    await page.locator('.dc-filter [data-f="done"]').click();
    await page.locator('.dc-row[data-q="' + q + '"]').click();
    await expect(card(page).locator(".dc-ans.kept")).toContainText("Записан на телефона, още не е изпратен.");
    await expect(page.locator('.dc-row[data-q="' + q + '"]')).toContainText("Записан");
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(async () => (await answers(context, q)).length, { timeout: 15_000 }).toBe(1);
    await expect(card(page).locator(".dc-ans.kept")).toHaveCount(0, { timeout: 10_000 });
  });

  test("the main admin reads only: „Отговаря собственикът“, no „Съгласен“, the core says 403", async ({ page, context }) => {
    await signIn(context, "admin");
    await page.goto("/sobstvenik/reshenia/");
    await ready(page, "Решения", "#dc-focus, .ow-empty");
    await expect(page.locator(".ow-lead")).toContainText("Тук ги виждаш само за четене.");
    await expect(card(page).locator(".dc-ro")).toContainText("Отговаря собственикът.");
    await expect(page.locator("[data-agree], [data-other]")).toHaveCount(0);
    const r = await context.request.post("/api/owner/questions/r2", { data: { answer: "default" } });
    expect(r.status()).toBe(403);
  });
});

test("no-shows: „Блокирай“ with the confirmation, „Не блокирай“; the number masked, no „Отмени“, the focus on the title", async ({ page, context, browser }) => {
  const errs = errors(page);
  const base = (await context.request.get("/api/health")).url().replace(/\/api\/health$/, "");
  const adm = await browser.newContext({ baseURL: base });
  await signIn(adm, "admin");
  const a = "Неявил " + rnd(), b = "Неявил " + rnd();
  await twoNoShows(adm, a); await twoNoShows(adm, b);
  await adm.close();
  await signIn(context, "owner");
  await page.goto("/sobstvenik/reshenia/#noshow");
  await ready(page, "Решения", "#noshow");
  const it = (name: string) => page.locator("#noshow .it").filter({ hasText: name });
  await expect(it(a)).toContainText(/0899 •• •• \d\d/);
  await expect(it(a)).toContainText("2 неявявания");
  await it(a).locator('[data-bl="block"]').click();
  const sh = page.locator(".bs-sheetwrap .bs-sheet");
  await expect(sh.locator("h2")).toHaveText("Да блокирам ли?");
  await sh.locator("[data-yes]").click();
  await expect(page.locator(".bs-toast")).toContainText(a + " е блокиран.");
  await expect(page.locator(".bs-toast [data-tu]")).toHaveCount(0);
  await expect(page.locator(".bs-toast a")).toHaveAttribute("href", "/admin/reservations/#blocks");
  await expect(it(a)).toHaveCount(0);
  await expect(page.locator("#dc-nh")).toBeFocused();
  await expect(page.locator("#noshow")).toContainText(/\d+ блокира(н номер|ни номера)\./);
  await it(b).locator('[data-bl="clear"]').click();
  await expect(page.locator(".bs-toast")).toContainText(b + " не е блокиран.");
  await expect(it(b)).toHaveCount(0);
  await expect(page.locator("#dc-nh")).toBeFocused();
  const bl = (await (await context.request.get("/api/admin/blocks")).json()) as { rows: { name: string; status: string }[] };
  expect(bl.rows.find((x) => x.name === a)!.status).toBe("blocked");
  expect(errs).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test("the layout and axe of „Решения“, " + theme, async ({ page, context }) => {
    const errs = errors(page);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(context, "owner");
    for (const [w, h] of isPhone(page) ? [[390, 844], [360, 740]] : [[1440, 900], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/sobstvenik/reshenia/");
      await ready(page, "Решения", "#dc-focus, .ow-empty");
      const l = await layout(page);
      expect(l.side, String(w)).toBe(false);
      expect(l.tiny, String(w)).toEqual([]);
      expect(l.small, String(w)).toEqual([]);
      expect(await axe(page), w + " " + theme).toEqual([]);
      /* the card sticky on the left and the list on the right on a wide computer */
      if (w === 1440) {
        const [m, li] = [await page.locator(".dc-main").boundingBox(), await page.locator(".dc-list").boundingBox()];
        expect(li!.x).toBeGreaterThan(m!.x + m!.width - 1);
      }
    }
    expect(errs).toEqual([]);
  });
}
