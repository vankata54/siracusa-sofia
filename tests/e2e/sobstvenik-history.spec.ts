import { test, expect } from "@playwright/test";
import { ownServer, signIn, dbPut, type Own } from "./own-server.ts";

/* "Собственик" with history (an own server and database: the past days are written straight into it, the API never
   takes an order for an earlier day): "Днес" compares with ONE base (the turnover against "обичайното за <ден> до
   <час>", sign + % + word), "Миналия <ден> по това време: X €" is a sum on a second line without a percent, the alert
   is the core's; "Тенденции" with "Миналата година" (364 days back) shows the core's difference on every KPI. */

let S: Own;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { S = await ownServer("own-hist", 7); seed(); });
test.afterAll(async () => { if (S) await S.stop(); });

const ymd = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d);
const eur = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",") + " €";
function seed() {
  const now = Date.now(), L = [["kebapcheta", "Кебапчета", 7.61], ["shopska-salata", "Шопска салата", 4.75], ["pitsa-margarita", "Пица Маргарита", 7.15]] as const;
  let no = 7000;
  const put = (daysBack: number, k: number) => {
    const ts = now - daysBack * 864e5, min = 600 + ((k * 37) % 660), placedAt = String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0");
    const d = new Date(ts), day = ymd(d), at = Date.parse(day + "T" + placedAt + ":00+02:00");
    const l = L[k % 3], total = Math.round(l[2] * (1 + (k % 2)) * 100) / 100, id = String(++no);
    const o = { id, no: id, key: "k" + id, mode: "pickup", channel: k % 4 === 0 ? "office" : "web", lines: [{ id: l[0], name: l[1], unit: l[2], q: 1 + (k % 2), mods: [], extra: 0 }], sub: total, disc: 0, fee: 0, total, pay: "cash", payLabel: "В брой",
      status: "picked", placedAt, ts: at, phone: "08881234" + String(k % 50).padStart(2, "0"), name: "Клиент", zone: "", addr: "", times: {}, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString() };
    dbPut(S.db, "orders", o, { no: +id, mode: o.mode, status: o.status, phone: o.phone, total: o.total, channel: o.channel });
  };
  for (let day = 1; day <= 30; day++) for (let k = 0; k < 18; k++) put(day, k + day);
  for (let k = 0; k < 12; k++) put(364, k);
}

test("@desktop „Днес“ with history: one comparison, the last week as a sum, the alert of the core", async ({ page, context }) => {
  await signIn(context, S.base, "owner");
  await page.goto(S.base + "/sobstvenik/");
  await expect(page.locator(".td-hero .sum")).toBeVisible();
  const t = (await (await context.request.get(S.base + "/api/owner/today")).json()) as { usual: { sum: number; label: string }; lastWeek: { sum: number; label: string }; sales: { sum: number }; alert: { text: string } | null; weekday: string; now: string };
  await expect(page.locator(".ow-banner").filter({ hasText: "Още събираме история" })).toHaveCount(0);
  const lw = page.locator(".td-hero .lw");
  await expect(lw).toHaveText(t.lastWeek.label + ": " + eur(t.lastWeek.sum));
  expect(await lw.textContent()).not.toContain("%");
  if (t.usual.sum) {
    const p = Math.round(((t.sales.sum - t.usual.sum) / t.usual.sum) * 100);
    await expect(page.locator(".td-hero .cmp .ow-d")).toContainText((p > 0 ? "+" : "") + p + "%");
    await expect(page.locator(".td-hero .cmp .ow-d")).toContainText((p === 0 ? "без промяна" : p > 0 ? "повече" : "по-малко") + " от обичайното за " + t.weekday + " до ");
    await expect(page.locator(".td-hero .cmp .ow-d svg")).toHaveCount(1);
  }
  if (t.alert) await expect(page.locator(".td-alert")).toContainText(t.alert.text);
  else await expect(page.locator(".td-alert")).toHaveCount(0);
  /* the hourly table has the usual */
  await page.locator('[data-tbl="hour"]').click();
  await expect(page.locator("#hourly table thead")).toContainText("Обичайно");
  /* the last 7 days: the same total as the core */
  const tr = (await (await context.request.get(S.base + "/api/owner/trends?period=7")).json()) as { totals: { revenue: number } };
  await expect(page.locator("#h-week").locator("xpath=ancestor::section[1]").locator(".ow-big")).toHaveText(eur(tr.totals.revenue));
});

test("@desktop „Тенденции“ › „Миналата година“: every KPI with the core's difference", async ({ page, context }) => {
  await signIn(context, S.base, "owner");
  await page.goto(S.base + "/sobstvenik/tendentsii/#c=year");
  await expect(page.locator(".ow-kpi").first()).toBeVisible();
  const r = (await (await context.request.get(S.base + "/api/owner/trends?period=7&compare=year")).json()) as { totals: { orders: number; revenue: number }; prev: { orders: number; revenue: number }; cmp: { from: string } };
  const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100), sg = (p: number) => (p > 0 ? "+" : "") + p + "%";
  await expect(page.locator(".ow-kpi").nth(0).locator(".ow-d")).toContainText(sg(pct(r.totals.orders, r.prev.orders)));
  await expect(page.locator(".ow-kpi").nth(1).locator(".ow-d")).toContainText(sg(pct(r.totals.revenue, r.prev.revenue)));
  await expect(page.locator(".tr-acts .ow-meta")).toContainText("същите дни от седмицата миналата година");
  await expect(page.locator(".tr-acts .ow-meta")).toContainText(r.cmp.from.slice(0, 4));
  /* the comparison line and its legend */
  await expect(page.locator("#h-main").locator("xpath=ancestor::section[1]").locator(".ow-lgd")).toContainText("Миналата година");
});
