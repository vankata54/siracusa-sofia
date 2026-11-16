import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ownServer, signIn, errors, E, type Own } from "./own-server.ts";

/* /admin/hall/ (design/pages-admin/hall.html): the panel of a table (seats, "Само с резервация"), the frame's bar
   "N промени", "Запази плана" (the core gets the plan with its version; [ЛИПСВА: истински маси и план] goes away; the
   server rebuilds the site and the screen follows it) and "Отмени"; the keyboard and the mouse move a table; joining;
   a new table and "Махни масата" (never deleted: off); 409 -> "Зареди пак"; leaving unsaved asks; the rights; 360; axe.
   A saved plan rebuilds the site, so every project has its own server (E2E_PORT + 7 / + 8, a copy of the build). */
let S: Own;
test.describe.configure({ mode: "serial" });
test.beforeAll(async ({}, info: TestInfo) => {
  test.setTimeout(120_000);
  test.skip(!E.ADMIN_PASSWORD || !E.MARKETING_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)");
  S = await ownServer("hall-" + info.project.name, info.project.name === "phone" ? 7 : 8);
});
test.afterAll(async ({ request }) => {
  test.setTimeout(240_000);
  if (!S) return;
  /* let the rebuild of the last save finish before the server stops */
  const l = await request.post(S.base + "/api/auth/login", { data: { username: E.ADMIN_USER || "admin", password: E.ADMIN_PASSWORD } });
  if (l.ok()) for (let i = 0; i < 200; i++) { const st = (await (await request.get(S.base + "/api/admin/site/state")).json()) as { build: { state: string } }; if (st.build.state !== "queued" && st.build.state !== "building") break; await new Promise((r) => setTimeout(r, 1000)); }
  await S.stop();
});

type HT = { id: string; n: number; zone: string; seats: number; cx: number; cy: number; walkin: boolean; off: boolean };
type HV = { version: number; tables: HT[]; merges: string[][]; missing: string };
const hall = async (page: Page) => (await (await page.context().request.get(S.base + "/api/admin/hall")).json()) as HV;
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const bar = (page: Page) => page.locator(".hl-pbar");
async function open(page: Page, hash = "") {
  await page.goto(S.base + "/admin/hall/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Залата и масите");
  await expect(page.locator(".hl-bar")).toBeVisible();
}
async function undo(page: Page) {
  await expect(page.locator(".sa-toast")).toHaveClass(/\bon\b/);
  await page.waitForTimeout(400);
  await page.locator(".sa-toast [data-tu]").click({ force: true });
}

test("the panel: seats and „Само с резервация“, „Запази плана“ with the version, the rebuild line, „Отмени“", async ({ page }) => {
  const errs = errors(page);
  await signIn(page.context(), S.base, "admin");
  const h0 = await hall(page), t = h0.tables.find((x) => x.id === "S5")!;
  expect(h0.missing).toBe("[ЛИПСВА: истински маси и план]");
  await open(page, "#v=list");
  await expect(page.locator(".hl-warn")).toContainText("[ЛИПСВА: истински маси и план]");
  await page.locator('[data-pick="S5"]').click();
  const panel = page.locator(".hl-panel");
  await expect(panel.locator("h2")).toContainText("Маса " + t.n);
  await panel.locator('[data-seat="1"]').click();
  await expect(panel.locator("output")).toHaveText(String(t.seats + 1));
  await panel.locator("label.hl-sw").filter({ hasText: "Само с резервация" }).click();
  await expect(panel.locator('[data-f="walkin"]')).toBeChecked();
  await expect(bar(page)).toHaveClass(/\bon\b/);
  await expect(bar(page).locator("[data-n]")).toContainText("1 промяна");
  await bar(page).locator("[data-save]").click();
  await expect(page.locator(".sa-toast")).toContainText("Планът е запазен · 1 промяна");
  await expect(page.locator(".sa-toast")).toContainText("Сайтът се пресглобява");
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  await expect(page.locator(".hl-warn")).toHaveCount(0);
  await expect(page.locator(".hl-site")).toBeVisible();
  const h1 = await hall(page), t1 = h1.tables.find((x) => x.id === "S5")!;
  expect(h1.version).toBe(h0.version + 1);
  expect([t1.seats, t1.walkin]).toEqual([t.seats + 1, false]);
  await undo(page);
  await expect(page.locator(".sa-toast")).toContainText("Върнат е предишният план");
  const t2 = (await hall(page)).tables.find((x) => x.id === "S5")!;
  expect([t2.seats, t2.walkin]).toEqual([t.seats, true]);
  expect(errs).toEqual([]);
});

test("the keyboard and the mouse move a table; „Откажи промените“ @desktop", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await open(page, "#v=plan");
  const h0 = await hall(page), t = h0.tables.find((x) => x.id === "S2")!;
  const g = page.locator('.tb[data-t="S2"]');
  await g.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.tb[data-t="S2"]')).toHaveAttribute("transform", "translate(" + (t.cx + 10) + " " + t.cy + ")");
  await expect(page.locator('.tb[data-t="S2"]')).toBeFocused();
  await expect(bar(page).locator("[data-n]")).toContainText("1 промяна");
  await bar(page).locator("[data-cancel]").click();
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  /* the mouse */
  const box = (await page.locator('.tb[data-t="S7"] .tt').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect(bar(page).locator("[data-n]")).toContainText("1 промяна");
  await expect(page.locator(".hl-panel h2")).toContainText("Маса 7");
  await bar(page).locator("[data-save]").click();
  await expect(page.locator(".sa-toast")).toContainText("Планът е запазен");
  const t7a = h0.tables.find((x) => x.id === "S7")!, t7 = (await hall(page)).tables.find((x) => x.id === "S7")!;
  expect(t7.cx).toBeGreaterThan(t7a.cx);
});

test("joining two tables, a new table and „Махни масата“ (kept as off)", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await open(page, "#v=list&z=garden");
  await page.locator('[data-pick="G1"]').click();
  await page.locator(".hl-panel [data-join]").first().click();
  await expect(page.locator(".sa-toast")).toContainText("са обединени");
  await expect(page.locator(".hl-panel")).toContainText("Обединена с маса");
  await page.locator(".sa-head [data-add]").click();
  await expect(page.locator(".sa-toast")).toContainText("Нова маса");
  await expect(bar(page).locator("[data-n]")).toContainText("2 промени");
  await bar(page).locator("[data-save]").click();
  await expect(page.locator(".sa-toast")).toContainText("Планът е запазен · 2 промени");
  let h = await hall(page);
  expect(h.merges.some((g) => g.includes("G1"))).toBe(true);
  const nt = h.tables.find((x) => x.zone === "garden" && x.id === "G9")!;
  expect(nt).toBeTruthy();
  await expect(page.locator(".hl-panel h2")).toContainText("Маса " + nt.n);
  /* remove the new table */
  await page.locator(".hl-panel [data-off]").click();
  await page.locator(".sheetwrap.on [data-yes]").click();
  await expect(page.locator(".sa-toast")).toContainText("е махната (още не е запазено)");
  await bar(page).locator("[data-save]").click();
  await expect(page.locator(".sa-toast")).toContainText("Планът е запазен");
  h = await hall(page);
  expect(h.tables.find((x) => x.id === "G9")!.off).toBe(true);
  await expect(page.locator('[data-pick="G9"]')).toHaveCount(0);
});

test("409: someone else saved first -> „Зареди пак“; leaving with unsaved changes asks first", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await open(page, "#v=list");
  await page.locator('[data-pick="S3"]').click();
  await page.locator(".hl-panel [data-seat='-1']").click();
  /* another screen saves the garden */
  const h = await hall(page);
  const r = await page.context().request.put(S.base + "/api/admin/hall", { data: { gardenOpen: !(h as unknown as { gardenOpen: boolean }).gardenOpen, version: h.version } });
  expect(r.status()).toBe(200);
  /* leaving asks first */
  await page.locator('.sa-side a[href="/admin/qr/"], .sa-bnav a[href="/admin/"]').filter({ visible: true }).first().click();
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh).toContainText("Незапазени промени");
  await sh.locator("[data-close]").click();
  await bar(page).locator("[data-save]").click();
  await expect(page.locator(".hl-conf")).toContainText("Някой друг промени плана току-що.");
  await expect(bar(page)).not.toHaveClass(/\bon\b/);
  await page.locator("[data-reload]").click();
  await expect(page.locator(".hl-conf")).toHaveCount(0);
  await page.locator('[data-pick="S3"]').click();
  await expect(page.locator(".hl-panel output")).toHaveText(String(h.tables.find((x) => x.id === "S3")!.seats));
  /* put the garden back */
  const h2 = await hall(page);
  await page.context().request.put(S.base + "/api/admin/hall", { data: { gardenOpen: true, version: h2.version } });
});

test("rights: marketing has no „Залата“; the core refuses a save (403)", async ({ page }) => {
  await signIn(page.context(), S.base, "marketing");
  await page.goto(S.base + "/admin/hall/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  const r = await page.context().request.put(S.base + "/api/admin/hall", { data: { gardenOpen: false } });
  expect(r.status()).toBe(403);
});

test("phone: „Списък“ by default, 360 without a horizontal scroll; axe without serious @phone", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await page.setViewportSize({ width: 360, height: 740 });
  await open(page);
  expect(isPhone(page)).toBe(true);
  await expect(page.locator('[data-view="list"]')).toHaveAttribute("aria-selected", "true");
  await page.locator('[data-pick="S1"]').click();
  await expect(page.locator(".hl-panel h2")).toContainText("Маса 1");
  const over = await page.evaluate(() => { const sc = document.querySelector(".sa-scroller")!; return document.documentElement.scrollWidth > innerWidth || sc.scrollWidth > sc.clientWidth; });
  expect(over).toBe(false);
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});

test("desktop: the plan; axe without serious @desktop", async ({ page }) => {
  await signIn(page.context(), S.base, "admin");
  await open(page, "#t=S6");
  await expect(page.locator(".fp")).toBeVisible();
  await expect(page.locator(".hl-panel h2")).toContainText("Маса 6");
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});
