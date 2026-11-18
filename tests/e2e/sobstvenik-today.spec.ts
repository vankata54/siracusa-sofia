import { test, expect } from "@playwright/test";
import { signIn, webOrder, errors, axe, ready, layout, isPhone, eur, seedPast } from "./sobstvenik-helpers.ts";

test.beforeAll(() => seedPast());

/* "Собственик" › "Днес" (/sobstvenik/, src/modules/sobstvenik/today.ts) on the real server and its core: the main number
   equals the admin dashboard's "Днес: X € от N поръчки" after web orders made through the site's API (and it follows a new
   order live), the one comparison, "Чака те" for the owner only, "Таблица" with the right names, "Смяната сега", a new
   restaurant without history, the bar without connection, the manager goes to his home, the layout at 360 / 390 / 1024 /
   1440 in light and dark (with every "Таблица" open too), axe, no console errors. */

test("„Днес“ = the dashboard's „Днес: X € от N поръчки“ and it follows a new order live", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "owner");
  await webOrder(context, [{ id: "kebapcheta", q: 2 }]);
  await webOrder(context, [{ id: "shopska-salata", q: 1 }]);
  await page.goto("/sobstvenik/");
  await ready(page, "Днес");
  const sum = async () => ((await (await context.request.get("/api/admin/summary")).json()) as { today: { sales: { sum: number; n: number } } }).today.sales;
  let s = await sum();
  await expect(page.locator(".td-hero .sum")).toHaveText(eur(s.sum));
  await expect(page.locator(".td-hero .of")).toHaveText("от " + s.n + " " + (s.n === 1 ? "поръчка" : "поръчки"));
  /* a new order: the number changes by itself */
  await webOrder(context, [{ id: "kebapcheta", q: 1 }]);
  s = await sum();
  await expect(page.locator(".td-hero .sum")).toHaveText(eur(s.sum), { timeout: 10_000 });
  /* "Миналия … по това време" is a sum with cents, without a percent */
  await expect(page.locator(".td-hero .lw").filter({ hasText: "по това време" })).toHaveText(/^(Миналия|Миналата) [а-я]+ по това време: \d+,\d\d €$/);
  /* "На живо": the tables of the conditional plan say so */
  await expect(page.locator(".bs-main")).toContainText("Масите са условни: [ЛИПСВА: истински маси и план]");
  await expect(page.locator(".td-hero")).toContainText("Пълният отчет в админа");
  await expect(page.locator('.td-hero a.link')).toHaveAttribute("href", "/admin/reports/#p=today");
  /* "На живо": "Смяната сега" leads to the manager's module */
  await expect(page.locator('a.pill-red[href="/upravitel/"]')).toHaveText(/Смяната сега/);
  /* the five channels */
  await expect(page.locator("#channels .ow-hb .r")).toHaveCount(5);
  await expect(page.locator("#channels")).toContainText("Вземане от сайта");
  expect(errs).toEqual([]);
});

test("„Таблица“ / „Графика“: the names start with the visible word, the table has its caption; the focus stays", async ({ page, context }) => {
  await signIn(context, "owner");
  await webOrder(context);
  await page.goto("/sobstvenik/");
  await ready(page, "Днес");
  for (const [id, title] of [["hour", "Оборот по час"], ["ch", "По канал"], ["week", "Последните 7 дни"]]) {
    const b = page.locator('[data-tbl="' + id + '"]');
    await expect(b).toHaveAccessibleName("Таблица: " + title);
    await b.click();
    await expect(page.locator('[data-tbl="' + id + '"]')).toHaveAccessibleName("Графика: " + title);
    await expect(page.locator('[data-tbl="' + id + '"]')).toBeFocused();
    await expect(page.locator("#h-" + id).locator("xpath=ancestor::section[1]").locator("table caption")).toHaveText(title);
  }
  await page.locator('[data-tbl="ch"]').click();
  await expect(page.locator('[data-tbl="ch"]')).toHaveAccessibleName("Таблица: По канал");
});

test("no connection: the bar of the frame, the numbers stay", async ({ page, context }) => {
  await signIn(context, "owner");
  await page.goto("/sobstvenik/");
  await ready(page, "Днес");
  const before = await page.locator(".td-hero .sum").textContent();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.locator(".bs-net")).toBeVisible();
  await expect(page.locator(".bs-net")).toContainText("Няма връзка · Показваме данните от");
  await expect(page.locator(".td-hero .sum")).toHaveText(before!);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.locator(".bs-net")).toBeHidden({ timeout: 10_000 });
});

test("the manager has no „Собственик“: he goes to his home; without a session: the sign-in", async ({ page, context }) => {
  await page.goto("/sobstvenik/");
  await expect(page).toHaveURL(/\/admin\/vhod\/#next=%2Fsobstvenik%2F$/);
  await signIn(context, "manager");
  await page.goto("/sobstvenik/");
  await expect(page).not.toHaveURL(/\/sobstvenik\//);
  expect((await context.request.get("/api/owner/today")).status()).toBe(403);
});

for (const theme of ["light", "dark"] as const) {
  test("the layout and axe, " + theme + ": no horizontal scroll, text ≥ 14 px, targets ≥ 48 px, with the tables open too", async ({ page, context }) => {
    const errs = errors(page);
    await page.emulateMedia({ colorScheme: theme });
    await signIn(context, "owner");
    await webOrder(context);
    for (const [w, h] of isPhone(page) ? [[390, 844], [360, 740]] : [[1440, 900], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto("/sobstvenik/");
      await ready(page, "Днес");
      for (const tables of [false, true]) {
        if (tables) for (const b of await page.locator("[data-tbl]").all()) await b.click();
        const l = await layout(page);
        expect(l.side, w + " side").toBe(false);
        expect(l.tiny, w + " tiny").toEqual([]);
        expect(l.small, w + " small").toEqual([]);
        expect(await axe(page), w + " " + theme + (tables ? " tables" : "")).toEqual([]);
      }
      /* the pencil in its place: on the row of the bottom nav (phone) or at the bottom of the rail */
      await expect(page.locator(".bs-penslot .sa-pen-btn")).toBeVisible();
    }
    expect(errs).toEqual([]);
  });
}
