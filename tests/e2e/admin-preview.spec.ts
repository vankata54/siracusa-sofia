import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";

/* "Модулите на живо" (/admin/preview/, stage C, part 1): the device, the screen and the hour change and stay in the
   address; the frame is the same origin and loads the real page; the pencil outlines inside the frame and saves the
   frame's address and the device's size, and #n=<id> shows the note again; the preview leaves the viewer's cart, prefs
   and cookie answer as they were; the rights; 360 without horizontal scroll. The passwords come from .env. */
function env(): Record<string, string> {
  try { return Object.fromEntries(fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])); } catch { return {}; }
}
const E = env();
const USER: Record<string, [string, string]> = { admin: [E.ADMIN_USER || "admin", E.ADMIN_PASSWORD], marketing: ["marketing", E.MARKETING_PASSWORD], owner: ["owner", E.OWNER_PASSWORD] };
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
/** the frame's address, page and origin */
const frameInfo = (page: Page) => page.evaluate(() => {
  const f = document.querySelector<HTMLIFrameElement>("[data-frame]")!;
  try { const w = f.contentWindow!; return { same: w.location.origin === location.origin, path: w.location.pathname, search: w.location.search, page: w.document.documentElement.dataset.page || "", ready: w.document.readyState }; }
  catch { return { same: false, path: "", search: "", page: "", ready: "" }; }
});
/* a change of the hash reloads the preview (src/admin/preview.ts): a read during that reload is simply tried again */
const loaded = (page: Page, path: string) => expect.poll(async () => { const i = await frameInfo(page).catch(() => null); return i && i.ready === "complete" ? i.path : ""; }).toBe(path);
const hash = (page: Page) => page.evaluate(() => location.hash);
/** a screen by the picker (the computer) or by the sheet "Екран" of the floating bar (the phone) */
async function pick(page: Page, k: string) {
  if (await page.locator("#pv-s").isVisible()) { await page.selectOption("#pv-s", k); return; }
  await page.locator('.pv-fbar [data-fb="screen"]').click();
  await page.locator('.sheetwrap.on [data-pick="' + k + '"]').click();
}

test("@desktop device, screen and hour change, stay in the address; the frame is the same origin with the real page", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await page.goto("/admin/preview/#m=site&p=home&d=phone");
  await loaded(page, "/");
  let fi = await frameInfo(page);
  expect(fi.same).toBe(true);
  expect(fi.page).toBe("home");
  expect(fi.search).toContain("preview=1");
  await expect(page.locator("[data-cap]")).toContainText("390 × 844");
  await expect(page.frameLocator("[data-frame]").locator("h1").first()).toBeVisible();
  /* the device */
  await page.locator('.pv-tools [data-dev="tablet"]').click();
  await expect(page.locator("[data-cap]")).toContainText("820 × 1180");
  expect(await hash(page)).toContain("d=tablet");
  await page.locator(".pv-tools [data-rot]").click();
  await expect(page.locator("[data-cap]")).toContainText("1180 × 820");
  expect(await hash(page)).toContain("o=land");
  /* the screen */
  await page.selectOption("#pv-s", "menu");
  await loaded(page, "/menu/");
  expect(await hash(page)).toContain("p=menu");
  /* the hour of the site: ?preview=1&t=21:30, the frame says it */
  await page.selectOption("#pv-t", "21:30");
  await expect.poll(async () => (await frameInfo(page)).search).toContain("t=21%3A30");
  expect(await hash(page)).toContain("t=21:30");
  await expect(page.frameLocator("[data-frame]").locator(".status").first()).toContainText("Доставката приключи", { timeout: 10_000 });
  /* the address keeps the choice */
  await page.reload();
  await loaded(page, "/menu/");
  await expect(page.locator("#pv-s")).toHaveValue("menu");
  await expect(page.locator("#pv-t")).toHaveValue("21:30");
  await expect(page.locator("[data-cap]")).toContainText("1180 × 820");
  await expect(page.locator('.pv-tools [data-dev="tablet"]')).toHaveAttribute("aria-pressed", "true");
  /* "Предишен": back to the first screen; the computer has the browser bar with the address */
  await page.locator('[data-step="-1"]').click();
  await loaded(page, "/");
  await page.locator('.pv-tools [data-dev="desktop"]').click();
  await expect(page.locator("[data-cap]")).toContainText("1440 × 900");
  await expect(page.locator(".pv-chrome .url")).toHaveText("siracusa · /");
  /* the new device loads the frame again: wait for it, then read it */
  await loaded(page, "/");
  fi = await frameInfo(page);
  expect(fi.path).toBe("/");
  /* "Отвори в нов раздел": the same page with the hour */
  await expect(page.locator("[data-newtab]")).toHaveAttribute("href", /^\/\?t=21:30&preview=1$/);
  expect(errs).toEqual([]);
});

test("@desktop the pencil outlines inside the frame and saves the frame's address and the device's size; #n= shows it again", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await page.goto("/admin/preview/#m=site&p=menu&d=phone");
  await loaded(page, "/menu/");
  /* the first touch of the page wakes the sound ("Звук: докоснете" -> "Звук" moves the bar): touch the stage first */
  await page.locator(".pv-cap").click({ force: true });
  await page.locator('.sa-top [data-sa="pen"]').click();
  await expect(page.locator('.sa-top [data-sa="pen"]')).toHaveAttribute("aria-pressed", "true");
  const h1 = page.frameLocator("[data-frame]").locator("h1").first();
  await h1.hover();
  /* the outline is drawn in the frame's own document */
  await expect.poll(() => page.evaluate(() => {
    const d = document.querySelector<HTMLIFrameElement>("[data-frame]")!.contentDocument!, l = d.querySelector("sa-pen-layer");
    return !!l && !!l.shadowRoot && !!l.shadowRoot.querySelector(".box.on");
  })).toBe(true);
  await h1.click();
  const text = "Проверка от прегледа " + Math.random().toString(36).slice(2, 8);
  await page.locator("sa-pen-ui textarea").fill(text);
  await page.locator("sa-pen-ui [data-save]").click();
  let note: { id: string; url: string; module: string; viewport: { w: number; h: number } } | undefined;
  await expect.poll(async () => {
    const list = await (await context.request.get("/api/admin/notes")).json() as { id: string; url: string; module: string; text: string; viewport: { w: number; h: number } }[];
    note = list.find((n) => n.text === text); return !!note;
  }).toBe(true);
  expect(note!.url).toBe("/menu/");
  expect(note!.module).toBe("site");
  expect(note!.viewport).toEqual({ w: 390, h: 844 });
  /* #n=<id>: the same address and size, the element outlined and the note above */
  await page.goto("/admin/preview/#n=" + note!.id);
  await loaded(page, "/menu/");
  await expect(page.locator(".pv-nb")).toContainText("Бележка: " + text);
  await expect(page.locator("[data-cap]")).toContainText("390 × 844");
  expect(await hash(page)).toContain("n=" + note!.id);
  await expect.poll(() => page.evaluate(() => {
    const d = document.querySelector<HTMLIFrameElement>("[data-frame]")!.contentDocument!, l = d.querySelector("sa-pen-layer");
    return !!l && !!l.shadowRoot && !!l.shadowRoot.querySelector(".box.on");
  })).toBe(true);
  await page.locator("[data-hide-note]").click();
  await expect(page.locator(".pv-nb")).toHaveCount(0);
  expect(errs).toEqual([]);
});

test("the preview leaves the viewer's cart, prefs and cookie answer as they were (the frame is the same origin)", async ({ page, context }) => {
  const errs = errors(page);
  await signIn(context, "admin");
  await page.goto("/admin/");
  const mine = JSON.stringify({ v: 2, mode: "delivery", lines: [{ id: "kebapcheta", q: 3 }] });
  await page.evaluate((c) => { localStorage.setItem("sc-cart", c); localStorage.removeItem("sc-prefs"); localStorage.removeItem("sc-cookie"); sessionStorage.removeItem("sc-pv"); }, mine);
  const own = () => page.evaluate(() => ({ cart: localStorage.getItem("sc-cart"), prefs: localStorage.getItem("sc-prefs"), cookie: localStorage.getItem("sc-cookie"), journal: localStorage.getItem("sa-pv-own"), pv: sessionStorage.getItem("sc-pv") }));
  await page.goto("/admin/preview/#m=site&p=menu&d=phone&t=12:30&th=dark");
  await loaded(page, "/menu/");
  /* the frame got the theme and no cookie banner, the viewer's storage did not */
  expect(await page.evaluate(() => document.querySelector<HTMLIFrameElement>("[data-frame]")!.contentDocument!.documentElement.dataset.theme)).toBe("dark");
  await expect.poll(async () => (await own()).prefs).toBeNull();
  /* a dish into the frame's cart: the frame counts it, the viewer's cart stays */
  const before = await page.evaluate(() => (document.querySelector<HTMLIFrameElement>("[data-frame]")!.contentWindow as unknown as { SC: { cart: { count(): number } } }).SC.cart.count());
  await page.frameLocator("[data-frame]").locator("button.plus[data-add]").first().click();
  await expect.poll(() => page.evaluate(() => (document.querySelector<HTMLIFrameElement>("[data-frame]")!.contentWindow as unknown as { SC: { cart: { count(): number } } }).SC.cart.count())).toBeGreaterThan(before);
  await expect.poll(async () => (await own()).cart).toBe(mine);
  /* the frame's next page still has the frame's cart */
  await pick(page, "cart");
  await loaded(page, "/kolichka/");
  expect(await page.evaluate(() => (document.querySelector<HTMLIFrameElement>("[data-frame]")!.contentWindow as unknown as { SC: { cart: { count(): number } } }).SC.cart.count())).toBeGreaterThan(before);
  await expect.poll(async () => (await own()).cart).toBe(mine);
  /* leaving the preview: everything as before */
  await page.goto("/admin/");
  await expect(page.locator(".sa-h1")).toBeVisible();
  expect(await own()).toEqual({ cart: mine, prefs: null, cookie: null, journal: null, pv: null });
  expect(errs).toEqual([]);
});

test("rights: a module without the right shows the first allowed with a notice; a role without the site: „Нямате права за този раздел.“", async ({ page, context }) => {
  await signIn(context, "marketing");
  await page.goto("/admin/preview/#m=kitchen&p=app&d=tablet");
  await expect(page.locator(".sa-toast")).toContainText("Нямате права за „Кухня“; показваме „Клиентски сайт“.");
  await expect(page.locator("#pv-m option")).toHaveText(["Клиентски сайт", "QR маса", "Админ"]);
  await loaded(page, "/");
  /* the same role without the section "Клиентски сайт" (the answer of /api/auth/me changed in the test) */
  await page.route("**/api/auth/me", async (r) => {
    const res = await r.fetch(); const me = await res.json() as { sections: string[] };
    me.sections = me.sections.filter((s) => s !== "site");
    await r.fulfill({ response: res, json: me });
  });
  await page.goto("/admin/preview/");
  await expect(page.locator(".sa-noperm h1")).toHaveText("Нямате права за този раздел.");
  await expect(page.locator("[data-frame]")).toHaveCount(0);
});

test("@phone 360: the device on the whole screen, the floating bar, no horizontal scroll; „Екран“ picks a screen", async ({ page, context }) => {
  const errs = errors(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(context, "admin");
  await page.goto("/admin/preview/#m=site&p=home&d=phone");
  await loaded(page, "/");
  await expect(page.locator(".pv-fbar")).toBeVisible();
  await expect(page.locator(".pv-fbar > *")).toHaveText(["Табло", "Екран", "Устройство", "Молив"]);
  await expect(page.locator(".sa-top")).toBeHidden();
  const over = () => page.evaluate(() => Math.max(document.documentElement.scrollWidth - innerWidth, ...[...document.querySelectorAll(".sa-scroller")].map((s) => s.scrollWidth - s.clientWidth)));
  expect(await over()).toBeLessThanOrEqual(0);
  /* the frame fills the width */
  expect(await page.evaluate(() => document.querySelector<HTMLIFrameElement>("[data-frame]")!.getBoundingClientRect().width)).toBe(360);
  /* every target in the bar at least 48 px */
  for (const h of await page.locator(".pv-fbar > *").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(48);
  await page.locator('.pv-fbar [data-fb="screen"]').click();
  await expect(page.locator(".sheetwrap.on h2")).toHaveText("Клиентски сайт: екран");
  expect(await over()).toBeLessThanOrEqual(0);
  await page.locator('.sheetwrap.on [data-pick="contacts"]').click();
  await loaded(page, "/kontakti/");
  expect(await hash(page)).toContain("p=contacts");
  /* "Молив" of the bar: on and off */
  await page.locator('.pv-fbar [data-sa="pen"]').click();
  await expect(page.locator('.pv-fbar [data-sa="pen"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('.pv-fbar [data-sa="pen"]').click();
  await expect(page.locator('.pv-fbar [data-sa="pen"]')).toHaveAttribute("aria-pressed", "false");
  expect(errs).toEqual([]);
});
