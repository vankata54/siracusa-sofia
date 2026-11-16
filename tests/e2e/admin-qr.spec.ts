import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { E, USER, errors } from "./own-server.ts";
import { readQr, matrixOfPath } from "./qr-read.ts";

/* /admin/qr/ (design/pages-admin/qr.html): the QR code on the label is read back (tests/e2e/qr-read.ts, an independent
   decoder) and it is the address of the site + the table's code from /api/admin/qr, and /api/table/<код> gives that
   table; "Нов код" asks first, the old code stops (404), the new label reads the new address; the choice for the print,
   the A4 sheets (8 per sheet) and the print layout; the rights; 360; axe. The shared e2e server (no rebuild here); the
   projects use different tables (phone S5, desktop S6). */
type QrRow = { id: string; n: number; zone: string; code: string; url: string };
const isPhone = (page: Page) => (page.viewportSize()?.width || 1440) < 700;
const tableOf = (page: Page) => (isPhone(page) ? "S5" : "S6");
async function signIn(ctx: BrowserContext, role: string) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
const rows = async (page: Page) => (await (await page.context().request.get("/api/admin/qr")).json()) as QrRow[];
async function labelText(page: Page) {
  const d = await page.locator("[data-label] path[data-qrpath]").getAttribute("d");
  return readQr(matrixOfPath(d!));
}

test.beforeAll(() => { test.skip(!E.ADMIN_PASSWORD || !E.MARKETING_PASSWORD, "no .env with the passwords (node scripts/make-env.mjs)"); });

test("the label's QR code reads the address of the table's code; „Нов код“ stops the old one", async ({ page }) => {
  const errs = errors(page);
  await signIn(page.context(), "admin");
  const id = tableOf(page), r0 = (await rows(page)).find((x) => x.id === id)!;
  expect(r0.code).toMatch(/^[a-z2-9]{8}$/);
  await page.goto("/admin/qr/#t=" + id);
  await expect(page.locator(".sa-h1")).toHaveText("QR генератор");
  await expect(page.locator("#qr-t")).toHaveValue(id);
  const site = await page.locator("[data-qr-site]").getAttribute("data-qr-site");
  const q = await labelText(page);
  expect(q.text).toBe(site + "/masa/" + r0.code + "/");
  expect([q.version, q.ecl]).toEqual([4, "Q"]);
  await expect(page.locator("[data-url]")).toContainText("/masa/" + r0.code + "/");
  const t = await page.context().request.get("/api/table/" + r0.code);
  expect(t.status()).toBe(200);
  expect((await t.json()).id).toBe(id);
  /* "Нов код" */
  await page.locator("[data-regen]").click();
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh).toContainText("Старият етикет на маса " + r0.n + " спира да работи веднага");
  await sh.locator("[data-yes]").click();
  await expect(page.locator(".sa-toast")).toContainText("Нов код за маса " + r0.n + ". Старият етикет вече не работи.");
  const r1 = (await rows(page)).find((x) => x.id === id)!;
  expect(r1.code).not.toBe(r0.code);
  await expect(page.locator(".qr-row[aria-current='true']")).toContainText("Нов код: отпечатайте етикета");
  expect((await labelText(page)).text).toBe(site + "/masa/" + r1.code + "/");
  expect((await page.context().request.get("/api/table/" + r0.code)).status()).toBe(404);
  expect((await (await page.context().request.get("/api/table/" + r1.code)).json()).id).toBe(id);
  expect(errs).toEqual([]);
});

test("the choice for the print: „Нито една“, „Избери градината“, the A4 sheets and the print layout (8 per sheet)", async ({ page }) => {
  await signIn(page.context(), "admin");
  const all = await rows(page), garden = all.filter((x) => x.zone === "garden");
  await page.goto("/admin/qr/");
  await expect(page.locator("[data-cnt]")).toContainText(all.length + " етикет");
  await expect(page.locator(".qr-a4")).toHaveCount(Math.ceil(all.length / 8));
  await page.locator("[data-none]").click();
  await expect(page.locator("[data-cnt]")).toHaveText("Няма избрани маси");
  await expect(page.locator(".sa-head [data-print]")).toBeDisabled();
  await expect(page.locator("main")).toContainText("Не сте избрали маси за печат.");
  await page.locator('[data-zsel="garden"]').click();
  await expect(page.locator("[data-cnt]")).toContainText(garden.length + " етикет");
  await expect(page.locator(".qr-a4cap").first()).toContainText("маси " + garden.slice(0, 8).map((x) => x.n).join(", "));
  await page.locator("[data-all]").click();
  /* the print: built on beforeprint, A4 pages of 8, only the labels are shown */
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.locator("#qr-print .pg")).toHaveCount(Math.ceil(all.length / 8));
  await expect(page.locator("#qr-print .pg").first().locator(".qrl")).toHaveCount(Math.min(8, all.length));
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#qr-print")).toBeVisible();
  await expect(page.locator(".sa-app")).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
});

test("rights: marketing has no „QR генератор“; the core refuses a new code (403)", async ({ page }) => {
  await signIn(page.context(), "marketing");
  await page.goto("/admin/qr/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  expect((await page.context().request.post("/api/admin/qr/S1")).status()).toBe(403);
});

test("phone: 360 without a horizontal scroll, „Покажи“ shows the label; axe without serious @phone", async ({ page }) => {
  await signIn(page.context(), "admin");
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/admin/qr/");
  await expect(page.locator(".qr-stage")).toBeVisible();
  const over = await page.evaluate(() => { const sc = document.querySelector(".sa-scroller")!; return document.documentElement.scrollWidth > innerWidth || sc.scrollWidth > sc.clientWidth; });
  expect(over).toBe(false);
  await page.locator('[data-show="S2"]').click();
  await expect(page.locator("#qr-t")).toHaveValue("S2");
  await expect(page.locator(".qr-stage")).toBeInViewport();
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});

test("desktop: „Предишна“ / „Следваща“; axe without serious (light and dark) @desktop", async ({ page }) => {
  await signIn(page.context(), "admin");
  await page.goto("/admin/qr/#t=S1");
  await expect(page.locator("#qr-t")).toHaveValue("S1");
  await page.locator('[data-step="1"]').click();
  await expect(page.locator("#qr-t")).toHaveValue("S2");
  expect(page.url()).toContain("#t=S2");
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const r = await new AxeBuilder({ page }).analyze();
    expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", ")), scheme).toEqual([]);
  }
});
