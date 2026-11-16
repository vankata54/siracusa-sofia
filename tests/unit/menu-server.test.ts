import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.ts";
import { sniffImage } from "../../server/routes/menu.ts";
import { menuHash } from "../../server/publish.ts";
import { redirectMap } from "../../scripts/build-checks.mjs";
import { builtinMenu } from "../../src/core/menu-edit.ts";

/* The menu editor on the server: routes and rights, 409, photos (type by content, size), "Публикувай" with a replaced
   rebuild (no real astro run): the folders change places, redirects.json is reloaded (301 for a removed dish), /api/menu. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-menu-"));
const dist = path.join(tmp, "dist"), media = path.join(tmp, "media");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), "<p>start</p>");
fs.writeFileSync(path.join(dist, "redirects.json"), "{}");
let builds = 0, fail = false;
const build = async (menuFile: string, outDir: string) => {
  const m = JSON.parse(fs.readFileSync(menuFile, "utf8"));
  if (fail) throw new Error("build-checks: test failure");
  builds++;
  fs.mkdirSync(path.join(outDir, "menu"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), "<p>build " + builds + ": " + m.items.length + " dishes</p>");
};
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("menu editor API", async () => {
  const { app, core, publisher } = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build, mediaDir: media });
  await core.staff.upsert({ username: "admin", name: "Поли", role: "admin", password: "test-password-123" });
  await core.staff.upsert({ username: "mkt", name: "Маркетинг", role: "marketing", password: "test-password-123" });
  const login = async (u: string) => (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: "test-password-123" }) })).headers.get("set-cookie")!.split(";")[0];
  const admin = await login("admin"), mkt = await login("mkt");
  const req = (method: string, url: string, cookie?: string, body?: unknown) => app.request(url, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it("rights: 401 without a session, 403 without the section 'Меню'", async () => {
    expect((await req("GET", "/api/admin/menu/draft")).status).toBe(401);
    expect((await req("GET", "/api/admin/menu/draft", mkt)).status).toBe(403);
    expect((await req("POST", "/api/admin/menu/publish", mkt, { version: 0 })).status).toBe(403);
    expect((await req("POST", "/api/admin/media", mkt)).status).toBe(403);
    expect((await req("GET", "/api/admin/lunch", mkt)).status).toBe(403);
    const r = await req("GET", "/api/admin/menu/draft", admin);
    expect(r.status).toBe(200);
    expect((await r.json()).version).toBe(0);
  });
  it("409 for an old version of the draft (with the current version)", async () => {
    const d = await (await req("GET", "/api/admin/menu/draft", admin)).json();
    d.menu.items[0].p = 1.23;
    expect((await req("PUT", "/api/admin/menu/draft", admin, { menu: d.menu, version: d.version })).status).toBe(200);
    const r = await req("PUT", "/api/admin/menu/draft", admin, { menu: d.menu, version: d.version });
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ error: "conflict", message: "Някой друг промени черновата. Заредете я пак.", version: 1 });
    const bad = await req("PUT", "/api/admin/menu/draft", admin, { menu: { ...d.menu, items: [{ ...d.menu.items[0], p: -1 }] }, version: 1 });
    expect(bad.status).toBe(422);
    expect((await bad.json()).fields["items." + d.menu.items[0].id + ".p"]).toBe("Напишете цена като 10,22.");
    expect((await req("POST", "/api/admin/menu/draft/discard", admin, { version: 1 })).status).toBe(200);
  });
  it("photos: the type by content (not by name or header), up to 5 MB, a long cache and nosniff", async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
    expect(sniffImage(png)).toBe("png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
    expect(sniffImage(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("webp");
    const up = (body: Uint8Array, type: string, len?: number) => app.request("/api/admin/media", { method: "POST", headers: { "content-type": type, cookie: admin, ...(len ? { "content-length": String(len) } : {}) }, body: body as unknown as BodyInit });
    const r = await up(png, "application/octet-stream");
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j).toMatchObject({ type: "image/png", bytes: 12 });
    expect(j.url).toMatch(/^\/media\/[a-f0-9]{64}\.png$/);
    const g = await app.request(j.url);
    expect(g.status).toBe(200);
    expect(g.headers.get("content-type")).toBe("image/png");
    expect(g.headers.get("x-content-type-options")).toBe("nosniff");
    expect(g.headers.get("cache-control")).toMatch(/max-age=31536000/);
    /* an HTML file named and sent as a PNG */
    const html = await up(new TextEncoder().encode("<html><script>alert(1)</script>"), "image/png");
    expect(html.status).toBe(415);
    expect((await html.json()).message).toBe("Качете снимка в WebP, JPEG или PNG.");
    const big = new Uint8Array(5 * 1024 * 1024 + 10); big.set(png);
    const tooBig = await up(big, "image/png", big.length);
    expect(tooBig.status).toBe(413);
    expect((await app.request("/media/../secret.png")).status).toBe(404);
    expect((await app.request("/media/" + "a".repeat(64) + ".png")).status).toBe(404);
    /* a photo from the upload passes the draft; one that was never uploaded does not */
    const d = await (await req("GET", "/api/admin/menu/draft", admin)).json();
    d.menu.items[0].photo = "/media/" + "b".repeat(64) + ".png";
    const miss = await req("PUT", "/api/admin/menu/draft", admin, { menu: d.menu, version: d.version });
    expect(miss.status).toBe(422);
    d.menu.items[0].photo = j.url;
    const saved = await req("PUT", "/api/admin/menu/draft", admin, { menu: d.menu, version: d.version });
    expect(saved.status).toBe(200);
    /* "Откажи" without the version: 422 (someone else's draft is never thrown away blindly) */
    expect((await req("POST", "/api/admin/menu/draft/discard", admin, {})).status).toBe(422);
    expect((await req("POST", "/api/admin/menu/draft/discard", admin, { version: (await saved.json()).version })).status).toBe(200);
  });
  it("publish: the site rebuilds (queue), the folders change places, a removed dish answers 301 to its category, /api/menu is new", async () => {
    const d = await (await req("GET", "/api/admin/menu/draft", admin)).json();
    d.menu.items = d.menu.items.filter((x: { id: string }) => x.id !== "shkembe");
    d.menu.items.find((x: { id: string }) => x.id === "pitsa-margarita").p = 7.5;
    const s = await (await req("PUT", "/api/admin/menu/draft", admin, { menu: d.menu, version: d.version })).json();
    expect(s.changes.dishes.removed[0]).toMatchObject({ id: "shkembe", to: "/menu/supi/" });
    const p = await req("POST", "/api/admin/menu/publish", admin, { version: s.version });
    expect(p.status).toBe(200);
    const pj = await p.json();
    expect(pj).toMatchObject({ mode: "server", version: 1 });
    expect(["queued", "building", "done"]).toContain(pj.build.state);
    await publisher()!.idle();
    const st = await (await req("GET", "/api/admin/menu/publish", admin)).json();
    expect(st.build).toMatchObject({ state: "done", how: "build" });
    expect(fs.readFileSync(path.join(dist, "index.html"), "utf8")).toMatch(/build 1: 126 dishes/);
    expect(fs.readFileSync(dist + "-prev/index.html", "utf8")).toBe("<p>start</p>");
    expect(fs.existsSync(dist + "-next")).toBe(false);
    const r = await app.request("/menu/supi/shkembe/?x=1");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/menu/supi/?x=1");
    expect((await app.request("/.menu-hash")).status).toBe(404);
    const m = await (await app.request("/api/menu")).json();
    expect(m.items.some((x: { id: string }) => x.id === "shkembe")).toBe(false);
    expect(m.items.find((x: { id: string }) => x.id === "pitsa-margarita").p).toBe(7.5);
    expect(m.removed.map((x: { id: string }) => x.id)).toEqual(["shkembe"]);
    /* an order with the removed dish: 409 "removed" with the line */
    const o = await req("POST", "/api/orders", undefined, { cart: { mode: "pickup", lines: [{ id: "shkembe", q: 1 }] }, name: "Иван", phone: "0888123456", sched: "утре", slot: "12:00" });
    expect(o.status).toBe(409);
    expect(await o.json()).toMatchObject({ error: "removed", message: "Шкембе вече не е в менюто.", lines: ["shkembe"] });
  });
  it("rollback: the previous folder comes back without a build ('swap'); the 301 goes away", async () => {
    const st = await (await req("GET", "/api/admin/menu/publish", admin)).json();
    expect((await req("POST", "/api/admin/menu/rollback", admin, { version: 0 })).status).toBe(409);
    const r = await req("POST", "/api/admin/menu/rollback", admin, { version: st.version });
    expect(r.status).toBe(200);
    await publisher()!.idle();
    const after = await (await req("GET", "/api/admin/menu/publish", admin)).json();
    expect(after.version).toBe(2);
    /* the previous folder was the starting build (no hash): built again; a second rollback swaps */
    expect(after.build.state).toBe("done");
    expect((await app.request("/menu/supi/shkembe/")).status).toBe(404);
    expect((await (await app.request("/api/menu")).json()).items.some((x: { id: string }) => x.id === "shkembe")).toBe(true);
    const n = builds;
    await req("POST", "/api/admin/menu/rollback", admin, { version: 2 });
    await publisher()!.idle();
    const again = await (await req("GET", "/api/admin/menu/publish", admin)).json();
    expect(again.build).toMatchObject({ state: "done", how: "swap" });
    expect(builds).toBe(n);
    expect((await app.request("/menu/supi/shkembe/")).status).toBe(301);
  });
  it("a failed build: the old site stays and the state says why", async () => {
    const before = fs.readFileSync(path.join(dist, "index.html"), "utf8");
    const d = await (await req("GET", "/api/admin/menu/draft", admin)).json();
    d.menu.items[1].p = 3.33;
    const s = await (await req("PUT", "/api/admin/menu/draft", admin, { menu: d.menu, version: d.version })).json();
    fail = true;
    await req("POST", "/api/admin/menu/publish", admin, { version: s.version });
    await publisher()!.idle();
    fail = false;
    const st = await (await req("GET", "/api/admin/menu/publish", admin)).json();
    expect(st.build.state).toBe("error");
    expect(st.build.error).toMatch(/^Сайтът не се пресглоби, остава предишният\./);
    expect(fs.readFileSync(path.join(dist, "index.html"), "utf8")).toBe(before);
  });
  it("lunch PIN over the API: set by the main admin, shown once, never read back", async () => {
    const r = await req("PUT", "/api/admin/lunch/pin", admin, { pin: "2580" });
    expect(await r.json()).toMatchObject({ pin: "2580" });
    const st = await (await req("GET", "/api/admin/lunch/pin", admin)).json();
    expect(st).toMatchObject({ pinSet: true, boss: true });
    expect(JSON.stringify(st)).not.toContain("2580");
    const v = await (await req("GET", "/api/admin/lunch", admin)).json();
    expect(v.catalog.length).toBeGreaterThan(0);
  });
});

describe("the 301 table and the content hash", () => {
  it("redirectMap: the cut ids and the editor's redirects; menuHash ignores the redirects", () => {
    const m = builtinMenu();
    const base = redirectMap(m);
    expect(Object.keys(base)).toHaveLength(11);
    const m2 = { ...m, redirects: { "/menu/supi/shkembe/": "/menu/supi/" } };
    expect(redirectMap(m2)["/menu/supi/shkembe/"]).toBe("/menu/supi/");
    expect(menuHash(m2)).toBe(menuHash(m));
    expect(menuHash({ ...m, items: m.items.slice(1) })).not.toBe(menuHash(m));
  });
});
