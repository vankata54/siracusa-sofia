import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";

/* /admin/audit/ (design/pages-admin/audit.html): who, when, what in plain words (a failed sign-in, a note approved),
   by days ("Днес · нд, 15 ноември") with the hour "19:42", the filters (search, kind, period, "Махни филтрите"),
   the key of the core only for the main admin, read-only for the owner, "Нямате права" for the manager, 360, axe.
   A failed sign-in uses an unknown user name (the lockout counts per user name and per address: one attempt per project). */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], owner: ["owner", E.OWNER_PASSWORD], manager: ["manager", E.MANAGER_PASSWORD], waiter: ["waiter", E.WAITER_PASSWORD] };
async function signIn(ctx: BrowserContext, role: keyof typeof USER) {
  const r = await ctx.request.post("/api/auth/login", { data: { username: USER[role][0], password: USER[role][1] } });
  expect(r.status(), "sign-in " + role).toBe(200);
}
function errors(page: Page) {
  const list: string[] = [];
  page.on("pageerror", (e) => list.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of 40[13]/.test(m.text())) list.push(m.text()); });
  return list;
}
async function openAudit(page: Page, hash = "") {
  await page.goto("/admin/audit/" + hash);
  await expect(page.locator(".sa-h1")).toHaveText("Дневник");
  await expect(page.locator(".au-bar")).toBeVisible();
}

test("a failed sign-in in plain words: „Грешен вход: потребител „…““, „Непознат“, today, the hour; the kind filter", async ({ page, context }, info) => {
  const errs = errors(page);
  const name = "nobody-audit-" + info.project.name + "-" + Math.random().toString(36).slice(2, 7);
  expect((await context.request.post("/api/auth/login", { data: { username: name, password: "wrong-password-1" } })).status()).toBe(401);
  await signIn(context, "admin");
  await openAudit(page);
  await page.fill("#au-q", name);
  const row = page.locator(".au-e").filter({ hasText: name });
  await expect(row).toHaveCount(1);
  await expect(row.locator(".tx p")).toHaveText("Грешен вход: потребител „" + name + "“");
  await expect(row.locator(".meta")).toContainText("Непознат");
  await expect(row.locator(".meta code")).toHaveText("staff.login_failed");
  await expect(row.locator(".t")).toHaveText(/^\d\d:\d\d$/);
  await expect(page.locator(".au-day h2").first()).toHaveText(/^Днес · (пн|вт|ср|чт|пт|сб|нд), \d{1,2} (януари|февруари|март|април|май|юни|юли|август|септември|октомври|ноември|декември)\d+$/);
  /* the kind "Вход" hides it, "Грешен вход" shows it */
  await page.locator('.au-bar [data-g="login"]').click();
  await expect(row).toHaveCount(0);
  await expect(page.locator(".sa-empty h3")).toHaveText("Нищо за този филтър.");
  await page.locator("[data-clear]").click();
  await expect(page.locator("#au-q")).toHaveValue("");
  await page.fill("#au-q", name);
  await page.locator('.au-bar [data-g="fail"]').click();
  await expect(page.locator('.au-bar [data-g="fail"]')).toHaveAttribute("aria-pressed", "true");
  await expect(row).toHaveCount(1);
  await expect(page).toHaveURL(/#g=fail/);
  expect(errs).toEqual([]);
});

test("a note approved: „Бележка: Одобрена · „…““ with the name of the main admin", async ({ page, context, browser }) => {
  const text = "Дневник " + Math.random().toString(36).slice(2, 8);
  const w = await browser.newContext(); await signIn(w, "waiter");
  const id = (await (await w.request.post("/api/admin/notes", { data: { module: "waiter", url: "/servitor/", selector: "h1", text, viewport: { w: 390, h: 844 } } })).json()).id;
  await w.close();
  await signIn(context, "admin");
  expect((await context.request.patch("/api/admin/notes/" + id, { data: { status: "approved" } })).status()).toBe(200);
  await openAudit(page);
  await page.fill("#au-q", text);
  await expect(page.locator(".au-e").filter({ hasText: "Бележка: Одобрена · „" + text + "“" })).toHaveCount(1);
  await expect(page.locator(".au-e").filter({ hasText: "Нова бележка (Сервитьор) · „" + text + "“" })).toHaveCount(1);
});

test("the owner reads it without the key of the core; the manager has no rights", async ({ page, context }) => {
  await signIn(context, "owner");
  await openAudit(page, "#p=all");
  await expect(page.locator(".au-e").first()).toBeVisible();
  await expect(page.locator(".au-e code")).toHaveCount(0);
  await expect(page.locator("#au-p")).toHaveValue("all");
  await expect(page.locator(".au-note")).toContainText("Само за четене.");
  await expect(page.locator(".au-note .missing")).toHaveText("[ЛИПСВА: срок на пазене]");
  await signIn(context, "manager");
  await page.goto("/admin/audit/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
});

test("„Изтегли CSV“ has the rows in plain words", async ({ page, context }) => {
  await signIn(context, "admin");
  await openAudit(page);
  await expect(page.locator(".au-e").first()).toBeVisible();
  const dl = page.waitForEvent("download");
  await page.locator("[data-csv]").click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe("siracusa-dnevnik.csv");
  const csv = fs.readFileSync((await d.path())!, "utf8");
  expect(csv.split("\n")[0]).toContain('"Кога";"Кой";"Роля";"Действие";"Какво"');
  expect(csv).toContain('"Вход"');
});

test("@phone 360: no horizontal scroll", async ({ page, context }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await openAudit(page);
  await expect(page.locator(".au-e").first()).toBeVisible();
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll(".sa-scroller")].map((s) => s.scrollWidth - s.clientWidth)))).toBeLessThanOrEqual(0);
});

test("axe: no serious on „Дневник“", async ({ page, context }) => {
  await signIn(context, "admin");
  await openAudit(page);
  await expect(page.locator(".au-e").first()).toBeVisible();
  const r = await new AxeBuilder({ page }).analyze();
  expect(r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
});
