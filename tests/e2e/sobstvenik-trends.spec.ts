import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { signIn, webOrder, errors, axe, ready, layout, isPhone, eur, seedPast } from "./sobstvenik-helpers.ts";

test.beforeAll(() => seedPast());

/* "Собственик" › "Тенденции" (/sobstvenik/tendentsii/) and "Финанси и гориво" (/sobstvenik/finansi/) on the real
   server: the period and "Сравни с" (the hash, the line "спрямо …", "Миналата година" = 364 days back), the KPIs equal
   the core (the same as "Отчети"), "Избери дати" over 92 days, "Изтегли CSV" (the file name, the header first, the
   rows), "Таблица", the e-mail switches (ownerApi.setMail, "Отмени"), the dish card from the search (#dish=), the
   finance screen and its CSV, the manager's way, the layout and axe. */

test("the period and „Сравни с“: the hash, the line, the KPIs = the core; „Миналата година“ is 364 days back", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  await webOrder(context, [{ id: "kebapcheta", q: 2 }]);
  await page.goto("/sobstvenik/tendentsii/");
  await ready(page, "Тенденции", ".ow-kpis, .ow-card");
  await expect(page.locator('.ow-per [data-per="7"]')).toHaveAttribute("aria-pressed", "true");
  const core = async (q: string) => (await (await context.request.get("/api/owner/trends" + q)).json()) as { totals: { orders: number; revenue: number }; from: string; to: string; cmp: { from: string; to: string } };
  let c = await core("?period=7");
  await expect(page.locator(".ow-kpi").first().locator("b")).toHaveText(String(c.totals.orders));
  await expect(page.locator(".ow-kpi").nth(1).locator("b")).toHaveText(eur(c.totals.revenue));
  await expect(page.locator(".tr-acts .ow-meta")).toContainText("спрямо предишния период:");
  /* 30 days */
  await page.locator('.ow-per [data-per="30"]').click();
  await expect(page).toHaveURL(/#p=30$/);
  await expect(page.locator('.ow-per [data-per="30"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.ow-per [data-per="30"]')).toBeFocused();
  c = await core("?period=30");
  await expect(page.locator(".ow-kpi").first().locator("b")).toHaveText(String(c.totals.orders));
  /* "Днес": the same weekday last week */
  await page.locator('.ow-per [data-per="today"]').click();
  await expect(page.locator(".tr-acts .ow-meta")).toContainText("спрямо същия ден миналата седмица:");
  await expect(page.locator("#h-main")).toHaveText(/^Оборот по час/);
  /* "Миналата година": the same weekdays 364 days back */
  await page.locator('.ow-per [data-cmp="year"]').click();
  await expect(page).toHaveURL(/#p=today&c=year$/);
  c = await core("?period=today&compare=year");
  const back = (Date.parse(c.from) - Date.parse(c.cmp.from)) / 864e5;
  expect(back).toBe(364);
  await expect(page.locator(".tr-acts .ow-meta")).toContainText("същите дни от седмицата миналата година:");
  await expect(page.locator(".tr-acts .ow-meta")).toContainText(c.cmp.from.slice(0, 4));
  /* the address keeps the choice */
  await page.reload();
  await ready(page, "Тенденции", ".ow-kpis, .ow-card");
  await expect(page.locator('.ow-per [data-per="today"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.ow-per [data-cmp="year"]')).toHaveAttribute("aria-pressed", "true");
  expect(errs).toEqual([]);
});

test("„Избери дати“: over 92 days -> the notice and 92 days", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto("/sobstvenik/tendentsii/#p=custom");
  await ready(page, "Тенденции", ".ow-per");
  const a = page.locator("#ow-a");
  await expect(a).toBeVisible();
  const to = await page.locator("#ow-b").inputValue();
  const from = new Date(Date.parse(to) - 150 * 864e5).toISOString().slice(0, 10);
  await a.fill(from);
  await expect(page.locator(".bs-toast")).toContainText("Най-много 92 дни: показваме");
  const v = new Date(Date.parse(to) - 91 * 864e5).toISOString().slice(0, 10);
  await expect(page.locator("#ow-a")).toHaveValue(v);
  await expect(page.locator("#ow-ch")).toContainText("Най-много 92 дни.");
  await expect(page).toHaveURL(new RegExp("p=custom.*a=" + v));
});

test("a period over 92 days in the address: set right with the notice, never an error", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  const t = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
  await page.goto("/sobstvenik/tendentsii/#p=custom&a=2025-01-01&b=" + t);
  await ready(page, "Тенденции", ".ow-kpis, .ow-card");
  await expect(page.locator(".bs-toast")).toContainText("Най-много 92 дни: показваме");
  const a = new Date(Date.parse(t) - 91 * 864e5).toISOString().slice(0, 10);
  await expect(page.locator("#ow-a")).toHaveValue(a);
  await expect(page).toHaveURL(new RegExp("a=" + a));
  await expect(page.locator(".ow-banner.danger")).toHaveCount(0);
  /* a broken date: the default period, no error */
  await page.goto("/sobstvenik/finansi/#p=custom&a=2026-02-31&b=" + t);
  await ready(page, "Финанси и гориво", ".ow-kpis, .ow-card");
  await expect(page.locator(".ow-banner.danger")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("„Изтегли CSV“: the name, the header first, a row per day", async ({ page, context }) => {
  await signIn(context, "owner");
  await webOrder(context);
  await page.goto("/sobstvenik/tendentsii/");
  await ready(page, "Тенденции", ".ow-kpis");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("[data-csv]").click()]);
  expect(dl.suggestedFilename()).toMatch(/^siracusa-tendentsii-\d{4}-\d\d-\d\d-\d{4}-\d\d-\d\d\.csv$/);
  const txt = fs.readFileSync((await dl.path())!, "utf8").replace(/^﻿/, "");
  const rows = txt.split("\n");
  expect(rows[0]).toBe("Ден;Поръчки;Отказани;Оборот €;Среден бон €;Резервации;Неявили се;Сравнение: ден;Сравнение: поръчки;Сравнение: оборот €");
  expect(rows.length).toBe(1 + 7);
  expect(rows[7]).toMatch(/^\d{4}-\d\d-\d\d;\d+;\d+;\d+,\d\d;/);
  expect(txt).not.toContain("Примерни данни");
  await expect(page.locator(".bs-toast")).toContainText("Изтеглено: 7 дни в CSV");
});

test("„Таблица“ on every chart (the peak hours: the hours × the days); the dish card from #dish=", async ({ page, context }) => {
  await signIn(context, "owner");
  await webOrder(context, [{ id: "kebapcheta", q: 3 }]);
  await page.goto("/sobstvenik/tendentsii/");
  await ready(page, "Тенденции", ".ow-kpis");
  for (const [id, title] of [["main", "Оборот по ден"], ["heat", "Пикови часове"], ["ch", "По канал"], ["top", "Най-поръчвани ястия"]]) {
    await expect(page.locator('[data-tbl="' + id + '"]')).toHaveAccessibleName("Таблица: " + title);
    await page.locator('[data-tbl="' + id + '"]').click();
    await expect(page.locator('[data-tbl="' + id + '"]')).toHaveAccessibleName("Графика: " + title);
  }
  const heat = page.locator("#heat table");
  await expect(heat.locator("tbody tr")).toHaveCount(13);
  await expect(heat.locator("thead th")).toHaveCount(8);
  /* the top dishes with the real names; a dish opens its card */
  await page.locator('[data-tbl="top"]').click();
  const first = page.locator(".ow-top10 [data-dish]").first();
  await expect(first).toContainText("Кебапчета");
  await first.click();
  await expect(page).toHaveURL(/dish=kebapcheta/);
  await expect(page.locator("#h-ds")).toHaveText("Кебапчета");
  await expect(page.locator("#h-ds")).toBeFocused();
  await expect(page.locator("#dish")).toContainText("Продадени за периода");
  await page.locator("[data-undish]").click();
  await expect(page.locator("#dish")).toHaveCount(0);
});

test("@desktop „Отчети по имейл“: the switches go to the core; „Отмени“ brings it back", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto("/sobstvenik/tendentsii/");
  await ready(page, "Тенденции", ".ow-card");
  const sw = page.locator('[data-mail="weekly"]');
  await expect(page.locator("#h-ml")).toContainText("[ЛИПСВА: имейл за отчетите]");
  const was = await sw.isChecked();
  await sw.click({ force: true });
  await expect(page.locator(".bs-toast")).toContainText(was ? "Изключено: отчетът всеки понеделник в 6:00" : "Включено: отчетът всеки понеделник в 6:00");
  const mail = async () => ((await (await context.request.get("/api/owner/decisions")).json()) as { mail: { weekly: boolean } }).mail.weekly;
  expect(await mail()).toBe(!was);
  await page.locator(".bs-toast [data-tu]").click();
  await expect.poll(mail).toBe(was);
});

test("„Финанси и гориво“: the revenue = the core, the payment, the cash of the drivers, the CSV", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  await webOrder(context);
  await page.goto("/sobstvenik/finansi/");
  await ready(page, "Финанси и гориво", ".ow-kpis, .ow-card");
  const f = (await (await context.request.get("/api/owner/finance?period=7")).json()) as { revenue: { cur: number } };
  await expect(page.locator(".ow-kpi").first().locator("b")).toHaveText(eur(f.revenue.cur));
  await expect(page.locator("#pay")).toContainText("Карта при получаване");
  await expect(page.locator("#cash")).toContainText("Пари в брой от шофьорите");
  await expect(page.locator("#cash")).toContainText("[ЛИПСВА: на кого се предават парите]");
  await expect(page.locator("#cost")).toContainText("[ЛИПСВА: себестойност на ястията]");
  await expect(page.locator(".bs-main")).toContainText("Спестено от по-краткия път");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.locator("[data-csv]").click()]);
  expect(dl.suggestedFilename()).toMatch(/^siracusa-finansi-\d{4}-\d\d-\d\d-\d{4}-\d\d-\d\d\.csv$/);
  const rows = fs.readFileSync((await dl.path())!, "utf8").replace(/^﻿/, "").split("\n");
  expect(rows[0]).toBe("Ден;Оборот €;Поръчки;В брой €;Карта при получаване €;Ваучер €;На маса €;Гориво €;Литри;Сравнение: ден;Сравнение: оборот €;Сравнение: гориво €");
  expect(rows.length).toBe(8);
  /* the manager: the core says 403, the module is not his */
  const base = new URL(page.url()).origin, ctx = await page.context().browser()!.newContext({ baseURL: base });
  const p2 = await ctx.newPage();
  await signIn(ctx, "manager");
  expect((await ctx.request.get("/api/owner/finance")).status()).toBe(403);
  await p2.goto("/sobstvenik/finansi/");
  await expect(p2).not.toHaveURL(/\/sobstvenik\//);
  await ctx.close();
  expect(errs).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test("the layout and axe of „Тенденции“ and „Финанси“, " + theme + ", with every table open too", async ({ page, context }) => {
    const errs = errors(page);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(context, "owner");
    await webOrder(context, [{ id: "kebapcheta", q: 1 }, { id: "shopska-salata", q: 1 }]);
    for (const [w, h] of isPhone(page) ? [[390, 844], [360, 740]] : [[1440, 900], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      for (const [path, title] of [["/sobstvenik/tendentsii/", "Тенденции"], ["/sobstvenik/finansi/", "Финанси и гориво"]]) {
        await page.goto(path);
        await ready(page, title, ".ow-kpis, .ow-card");
        for (const tables of [false, true]) {
          if (tables) for (const b of await page.locator("[data-tbl]").all()) await b.click();
          const l = await layout(page);
          expect(l.side, path + " " + w).toBe(false);
          expect(l.tiny, path + " " + w).toEqual([]);
          expect(l.small, path + " " + w).toEqual([]);
          expect(await axe(page), path + " " + w + " " + theme + (tables ? " tables" : "")).toEqual([]);
        }
      }
    }
    expect(errs).toEqual([]);
  });
}

test("@desktop the search: the KPIs by a word, „смяна“ -> „Смяната сега“, a dish with its sales -> its card", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  await webOrder(context, [{ id: "kebapcheta", q: 2 }]);
  await page.goto("/sobstvenik/");
  await ready(page, "Днес");
  const q = page.locator("#bs-q"), box = page.locator("#bs-dres");
  await q.click(); await q.fill("оборот");
  await expect(box.locator('section[aria-label="Показатели"] a').first()).toContainText("Оборот днес");
  await q.fill("смяна");
  await expect(box.locator('a[href="/upravitel/"]')).toContainText("Смяната сега");
  await q.fill("кебапчета");
  const d = box.locator('a[href*="dish=kebapcheta"]').first();
  await expect(d).toContainText(/\d+ бро(й|я)/);
  await d.click();
  await expect(page).toHaveURL(/\/sobstvenik\/tendentsii\/#dish=kebapcheta$/);
  await expect(page.locator("#h-ds")).toHaveText("Кебапчета");
  expect(errs).toEqual([]);
});
