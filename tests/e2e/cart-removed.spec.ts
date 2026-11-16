import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { readEnv } from "../../scripts/env.mjs";

/* A dish taken off the menu in the admin (decision 15.11.2026), end to end with a REAL rebuild: this file starts its own
   server (port E2E_PORT + 1, its own copy of the build in <DIST_DIR>-cartrm and its own database), so "Публикувай" never
   touches the build the other tests use. Admin: removes "Шкембе" and publishes -> the server rebuilds the site (astro build
   into <dist>-next, the folders change places) -> the cart line says "Шкембе вече не е в менюто." and is not counted,
   the old address answers 301 to "Супи", the core refuses an order with it. Phone layout only (the cart logic is the same). */
const PORT = +(process.env.E2E_PORT || 8788) + 1;
const SRC = process.env.DIST_DIR || "dist-e2e";
const DIST = SRC + "-cartrm";
const DB = "data/e2e-cartrm-" + PORT + ".db";
const BASE = "http://localhost:" + PORT;
const env = readEnv() as Record<string, string | undefined>;
let srv: ChildProcess | null = null;

const rmAll = () => { for (const d of [DIST, DIST + "-prev", DIST + "-next"]) fs.rmSync(d, { recursive: true, force: true }); for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true }); };
async function until<T>(fn: () => Promise<T | null | undefined | false>, ms: number, what: string): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error("timeout: " + what);
    await new Promise((r) => setTimeout(r, 300));
  }
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(240_000);
  test.skip(!env.ADMIN_PASSWORD, "no .env with the admin password (node scripts/make-env.mjs)");
  rmAll();
  fs.cpSync(SRC, DIST, { recursive: true });
  srv = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/index.ts"], {
    env: { ...process.env, PORT: String(PORT), DIST_DIR: DIST, DB_FILE: DB, SC_PREVIEW_API: "1", SMS_DEMO: "1" }, stdio: "ignore",
  });
  await until(async () => (await fetch(BASE + "/api/health")).ok, 30_000, "server start");
  const login = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: env.ADMIN_USER || "admin", password: env.ADMIN_PASSWORD }) });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(BASE + "/api/" + p, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: await r.json() };
  };
  const d = (await call("GET", "admin/menu/draft")).j;
  d.menu.items = d.menu.items.filter((x: { id: string }) => x.id !== "shkembe");
  const s = await call("PUT", "admin/menu/draft", { menu: d.menu, version: d.version });
  expect(s.status).toBe(200);
  const p = await call("POST", "admin/menu/publish", { version: s.j.version });
  expect(p.status).toBe(200);
  const st = await until(async () => { const r = (await call("GET", "admin/menu/publish")).j; return r.build.state === "done" || r.build.state === "error" ? r : null; }, 180_000, "rebuild");
  expect(st.build.error || "").toBe("");
  expect(st.build).toMatchObject({ state: "done", how: "build" });
});

test.afterAll(async () => {
  if (srv && srv.pid) { srv.kill("SIGTERM"); await new Promise((r) => setTimeout(r, 300)); }
  rmAll();
});

function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (409|422)/.test(m.text())) errors.push(m.text()); });
  return errors;
}

test("cart: a removed dish says '… вече не е в менюто' and is not counted @phone", async ({ page }) => {
  const errors = watch(page);
  await page.addInitScript(() => {
    if (sessionStorage.getItem("ck-init")) return;
    sessionStorage.setItem("ck-init", "1");
    localStorage.setItem("sc-cookie", '"min"');
    localStorage.setItem("sc-cart", JSON.stringify({ mode: "pickup", lines: [
      { key: "tarator", id: "tarator", q: 1, mods: [], extra: 0 },
      { key: "shkembe", id: "shkembe", q: 2, mods: [], extra: 0, p: 3.5, n: "Шкембе" },
    ] }));
  });
  await page.goto(BASE + "/kolichka/?preview=1&t=12:30");
  await expect(page.locator(".ln")).toHaveCount(2);
  const gone = page.locator(".ln.out", { hasText: "Шкембе" });
  await expect(gone.locator(".ln-outmsg")).toContainText("Шкембе вече не е в менюто.");
  await expect(gone.locator(".ln-outmsg")).toContainText("Няма да го включим в поръчката.");
  await expect(gone).not.toContainText("Изчерпано днес");
  await expect(gone.locator(".counter")).toHaveCount(0);
  await expect(gone.locator(".ln-tot")).toHaveText("Не се брои");
  /* the total is the taratorʼs alone */
  const tar = await page.locator(".ln:not(.out) .ln-tot .price").innerText();
  await expect(page.locator(".ck-bar .js-next")).toContainText(tar.replace(/\s/g, " "));
  expect(errors).toEqual([]);
});

test("the old address of the removed dish answers 301 to its category; the category no longer lists it @phone", async ({ page, request }) => {
  const r = await request.get(BASE + "/menu/supi/shkembe/", { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers()["location"]).toBe("/menu/supi/");
  await page.goto(BASE + "/menu/supi/?preview=1&t=12:30");
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator('a[href="/menu/supi/shkembe/"]')).toHaveCount(0);
  await expect(page.locator('a[href="/menu/supi/tarator/"]').first()).toBeVisible();
  const sm = await (await request.get(BASE + "/sitemap.xml")).text();
  expect(sm).not.toContain("/menu/supi/shkembe/");
  expect(sm).toContain("/menu/supi/tarator/");
});

test("the core refuses an order with the removed dish (409 removed) @phone", async ({ request }) => {
  const r = await request.post(BASE + "/api/orders", { data: { cart: { mode: "pickup", lines: [{ id: "tarator", q: 1 }, { id: "shkembe", q: 1 }] }, name: "Тест", phone: "0888000111", sched: "утре", slot: "12:00" } });
  expect(r.status()).toBe(409);
  expect(await r.json()).toMatchObject({ error: "removed", message: "Шкембе вече не е в менюто.", lines: ["shkembe"] });
  const m = await (await request.get(BASE + "/api/menu")).json();
  expect(m.items.some((x: { id: string }) => x.id === "shkembe")).toBe(false);
});
