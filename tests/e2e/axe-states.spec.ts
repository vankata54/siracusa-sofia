import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* axe in the states a first load does not show (BUILD-TODO, priority 1-2): the floor plan and a full hour in the
   reservation, the busy slots in /vzemi-ot-myasto/ and in the cart, the loading skeletons. Goal: 0 serious / critical. */
async function noCookie(page: Page) { await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } }); }
/** waits for the entrance animations (.rv and the like, under 2 s) to end: axe measures the colours as they are on screen.
    Endless ones and the slow progress bar of the home carousel (6 s, restarted per slide) are not waited for. */
async function settle(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => {
    const t = a.effect?.getTiming();
    return a.playState !== "running" || !t || t.iterations === Infinity || Number(t.duration) >= 2000;
  }));
}
async function axe(page: Page, include: string) {
  await settle(page);
  const r = await new AxeBuilder({ page }).include(include).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "));
}
const pad = (n: number) => String(n).padStart(2, "0");
function future(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + days);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); while (last.getDay() !== 6) last.setDate(last.getDate() - 1);
  if (d.getDate() === last.getDate()) d.setDate(d.getDate() + 1);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}
const isPhone = (page: Page) => (page.viewportSize()?.width || 0) < 900;

test("axe: reservation floor plan (step 2) and a full hour, the name starts with \"Маса\" and holds the visible text", async ({ page }) => {
  await noCookie(page);
  await page.goto("/rezervatsia/?preview=1&t=12:30#" + future(11));
  await expect(page.locator("[data-flow] .cal")).toBeVisible();
  await page.locator(".slot", { hasText: "19:30" }).click();
  await (isPhone(page) ? page.locator(".rabar [data-act=next]") : page.locator(".aside [data-act=next]")).click();
  await expect(page.locator(".fp").first()).toBeVisible();
  /* every table, in both zones: free, taken, unfit; then one selected */
  expect(await axe(page, ".fp")).toEqual([]);
  const t = page.locator(".tbl.free").first();
  await expect(t).toHaveAttribute("aria-label", /^Маса \d+, \d места\. Свободна/);
  await expect(page.locator(".tbl.unfit").first()).toHaveAttribute("aria-label", /^Маса \d+, \d места\. Не е подходяща за 2 души$/);
  await t.click();
  await page.locator(".sheet [data-pick]").click();
  await expect(page.locator(".tbl.sel")).toHaveAttribute("aria-label", /^Маса \d+, избрана\. За \d души/);
  expect(await axe(page, ".fp")).toEqual([]);
  await page.locator('.zseg [data-zone="garden"]').click();
  await expect(page.locator(".fp .lawn")).toHaveCount(1);
  expect(await axe(page, ".fp")).toEqual([]);

  /* a full hour on the event day (preview): "19:00 пълно" is the start of the name */
  await page.goto("/rezervatsia/?preview=1&t=12:30");
  await expect(page.locator("[data-flow] .cal")).toBeVisible();
  await page.locator('[data-proto="event"]').click();
  const full = page.locator(".slot.full", { hasText: "19:00" });
  await expect(full).toHaveAttribute("aria-label", /^19:00 пълно\. /);
  expect(await axe(page, ".slots")).toEqual([]);
});

test("axe: busy slots in /vzemi-ot-myasto/ and in the cart", async ({ page }) => {
  await noCookie(page);
  await page.goto("/vzemi-ot-myasto/?preview=1&t=12:30");
  await expect(page.locator("[data-live][data-ready]")).toHaveCount(1);
  await page.locator('[data-sim="busy"]').click();
  const busy = page.locator(".pk-slot[disabled]").first();
  await expect(busy).toHaveAttribute("aria-label", /^\d\d:\d\d заето: пълна кухня$/);
  expect(await axe(page, ".pk-slots")).toEqual([]);

  await page.addInitScript(() => {
    if (sessionStorage.getItem("ax-init")) return;
    sessionStorage.setItem("ax-init", "1");
    localStorage.removeItem("sc-checkout");
    localStorage.setItem("sc-cart", JSON.stringify({ mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] }));
  });
  await page.goto("/kolichka/?preview=1&t=12:30");
  await (isPhone(page) ? page.locator(".ck-bar .js-next") : page.locator(".sum-cta .js-next")).click();
  await expect(page.locator("h1")).toHaveText("Кога ще я вземете?");
  const cb = page.locator(".slot[disabled]").first();
  await expect(cb).toHaveAttribute("aria-label", /^\d\d:\d\d заето: пълна кухня$/);
  expect(await axe(page, ".slots")).toEqual([]);
});

test("axe: loading skeletons (menu, category, allergens, tracking, home) are hidden, the words are a status", async ({ page }) => {
  await noCookie(page);
  /* the static skeleton of /porachka/ while the order is still on its way */
  await page.route("**/api/orders/**", () => { /* never answers: the skeleton stays */ });
  await page.goto("/porachka/1042-abc/");
  await expect(page.locator(".trk[aria-hidden=true]")).toHaveCount(1);
  await expect(page.locator(".vh[role=status]", { hasText: "Зареждаме поръчката…" })).toHaveCount(1);
  expect(await axe(page, "main")).toEqual([]);
  await page.unroute("**/api/orders/**");

  for (const path of ["/menu/?preview=1", "/menu/pitsi/?preview=1", "/alergeni/?preview=1", "/porachka/?preview=1"]) {
    await page.goto(path);
    await page.getByRole("button", { name: "Зареждане", exact: true }).click();
    await expect(page.locator("main [aria-hidden=true] .skel").first()).toBeAttached();
    await expect(page.locator("main [aria-label^='Зареждаме'], main [aria-label='Зареждане']")).toHaveCount(0);
    expect(await axe(page, "main"), path).toEqual([]);
  }
  await page.goto("/?preview=1#loading");
  await expect(page.locator(".rail.pop[aria-hidden=true]")).toHaveCount(1);
  await expect(page.locator(".vh[role=status]", { hasText: "Зареждаме любимите ястия…" })).toHaveCount(1);
  expect(await axe(page, "main")).toEqual([]);
});
