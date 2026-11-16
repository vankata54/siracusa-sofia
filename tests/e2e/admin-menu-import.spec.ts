import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readEnv } from "../../scripts/env.mjs";

/* /admin/menu/vnos/ (design/pages-admin/menu-import.html, version 4): a real file field (PDF or a picture up to 20 MB, also
   by dropping), „Добави към менюто“ / „Замени цялото меню“. The automatic reading is stage E: the screen says so honestly
   (no sample draft), and the dishes go in through the quick table -> „Сложи в черновата на менюто“ -> /admin/menu/#review=1.
   Only the desktop project writes the shared draft (on the shared e2e server) and takes it back; the phone checks the screen. */
const env = readEnv() as Record<string, string | undefined>;
async function signIn(ctx: BrowserContext) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: env.ADMIN_USER || "admin", password: env.ADMIN_PASSWORD } });
  expect(r.status()).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (40[13]|409|422)/.test(m.text())) list.push(m.text()); });
  return list;
}
async function open(page: Page) {
  await page.goto("/admin/menu/vnos/");
  await expect(page.locator(".sa-h1")).toHaveText("Внос на меню");
  await expect(page.locator(".im-drop")).toBeVisible();
}
const PDF = { name: "novo-menyu.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%test\n") };

test("a file is taken honestly (name, size, kind; reading is stage E), a wrong one is refused", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context);
  await open(page);
  await expect(page.locator(".stepper")).toContainText("Стъпка 1 от 3");
  await page.setInputFiles("#im-f", { name: "menu.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.locator("#im-f-e")).toContainText("„menu.txt“ не е PDF или снимка.");
  await page.setInputFiles("#im-f", PDF);
  await expect(page.locator(".im-ok")).toContainText("novo-menyu.pdf");
  await expect(page.locator(".im-ok")).toContainText("под 1 KB · PDF");
  await expect(page.locator(".im-ok")).toContainText("Автоматичното четене на менюто идва в етап E.");
  await expect(page.locator(".stepper")).toContainText("Стъпка 2 от 3");
  /* no sample draft is shown as if it were read */
  await expect(page.locator("main")).not.toContainText("Примерно ястие");
  await page.locator('[data-mode="replace"]').click();
  await expect(page.locator(".im-warn")).toContainText("ястия ще се махнат от сайта след „Публикувай“");
  await page.locator('[data-mode="add"]').click();
  /* the checks before the draft */
  await page.locator("[data-put]").click();
  await expect(page.locator("[data-err]")).toHaveText("Няма редове за внос: попълнете поне един.");
  await page.locator(".im-r").first().locator('[data-fld="n"]').fill("Ястие без цена");
  await page.locator("[data-put]").click();
  await expect(page.locator("[data-err]")).toHaveText("1 ред без име или цена. Попълнете ги или махнете реда.");
  expect(errs).toEqual([]);
});

test("the quick table goes into the draft and opens the summary in „Меню“ @desktop", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context);
  await open(page);
  await page.locator("[data-addrow]").click();
  await expect(page.locator(".im-r")).toHaveCount(4);
  const r1 = page.locator(".im-r").nth(0), r2 = page.locator(".im-r").nth(1);
  await r1.locator('[data-fld="n"]').fill("Внос проба едно");
  await r1.locator('[data-fld="cat"]').selectOption("salati");
  await r1.locator('[data-fld="p"]').fill("6,40");
  await r2.locator('[data-fld="n"]').fill("Внос проба две");
  await r2.locator('[data-fld="g"]').fill("300 гр.");
  await r2.locator('[data-fld="p"]').fill("8");
  await expect(page.locator("[data-counts]")).toContainText("Ще се внесат2");
  await page.locator("[data-put]").click();
  await expect(page).toHaveURL(/\/admin\/menu\/#review=1$/);
  const sh = page.locator(".sheetwrap.on .sheet");
  await expect(sh).toContainText("Нови ястия · 2");
  await expect(sh).toContainText("Внос проба едно");
  await expect(sh).toContainText("Салати · 6,40 €");
  /* back: the draft goes away */
  const d = await (await context.request.get("/api/admin/menu/draft")).json();
  expect(d.changes.dishes.added.length).toBe(2);
  expect((await context.request.post("/api/admin/menu/draft/discard", { data: { version: d.version } })).status()).toBe(200);
  expect(errs).toEqual([]);
});

test("360 without horizontal scroll, axe without serious @phone", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context);
  await open(page);
  await page.setInputFiles("#im-f", PDF);
  await expect(page.locator(".im-ok")).toBeVisible();
  const over = await page.evaluate(() => { const s = document.querySelector(".sa-scroller") as HTMLElement; return Math.max(document.documentElement.scrollWidth - innerWidth, s.scrollWidth - s.clientWidth); });
  expect(over).toBeLessThanOrEqual(0);
  const v = (await new AxeBuilder({ page }).analyze()).violations.filter((x) => x.impact === "serious" || x.impact === "critical").map((x) => x.id);
  expect(v).toEqual([]);
});
