/* The admin, part 3 on the server: every new route answers 401 without a session and 403 for a role without the right
   (direct requests, no screen), the public data follows the admin at once, and a change of the site data rebuilds the
   site through the same queue as the menu (a replaced build: no real astro run). */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.ts";
import { items } from "../../src/lib/data.ts";
import type { RoleId } from "../../src/core/index.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-adm3-"));
const dist = path.join(tmp, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), "<p>start</p>");
fs.writeFileSync(path.join(dist, "redirects.json"), "{}");
const builds: { site: Record<string, unknown> | null }[] = [];
let delay = 0;
const build = async (menuFile: string, outDir: string, siteFile?: string) => {
  JSON.parse(fs.readFileSync(menuFile, "utf8"));
  if (delay) await new Promise((r) => setTimeout(r, delay));
  builds.push({ site: siteFile ? JSON.parse(fs.readFileSync(siteFile, "utf8")) : null });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), "<p>build " + builds.length + "</p>");
};
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const PW = "test-password-123";

describe("admin part 3: routes", async () => {
  const { app, core, publisher } = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build, smsDemo: true, previewApi: false });
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r, role: r, password: PW });
  const cookie: Record<string, string> = {};
  for (const r of ROLES) cookie[r] = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: r, password: PW }) })).headers.get("set-cookie")!.split(";")[0];
  const req = (method: string, url: string, who?: RoleId, body?: unknown) => app.request(url, { method, headers: { "content-type": "application/json", ...(who ? { cookie: cookie[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const dish = items.find((x) => x.cat === "pitsi" && !x.t.includes("out"))!;

  /* [method, url, body, the roles that pass the rights check] */
  const BOSS: RoleId[] = ["admin", "owner", "manager"];
  const W: RoleId[] = [...BOSS, "waiter"], M: RoleId[] = [...BOSS, "marketing"];
  const ROUTES: [string, string, unknown, RoleId[]][] = [
    ["GET", "/api/admin/orders/list", null, W],
    ["GET", "/api/admin/orders/9999/detail", null, W],
    ["POST", "/api/admin/orders/9999/phone", null, W],
    ["POST", "/api/admin/orders/9999/cancel", { reason: "x" }, W],
    ["POST", "/api/admin/orders/phone", { lines: [] }, BOSS],
    ["GET", "/api/admin/reservations/day", null, W],
    ["GET", "/api/admin/reservations/month", null, W],
    ["GET", "/api/admin/reservations/free?date=2026-12-01&time=19:00", null, W],
    ["POST", "/api/admin/reservations/new", {}, W],
    ["POST", "/api/admin/reservations/nope/status", { status: "confirmed" }, W],
    ["POST", "/api/admin/reservations/nope/table", { table: null }, W],
    ["POST", "/api/admin/reservations/nope/phone", null, W],
    ["GET", "/api/admin/blocks", null, W],
    ["POST", "/api/admin/blocks", { phone: "1" }, BOSS],
    ["POST", "/api/admin/blocks/nope", { action: "block" }, BOSS],
    ["GET", "/api/admin/hall", null, W],
    ["PUT", "/api/admin/hall", { version: 999 }, BOSS],
    ["GET", "/api/admin/qr", null, BOSS],
    ["POST", "/api/admin/qr/nope", null, BOSS],
    ["GET", "/api/admin/zones", null, BOSS],
    ["PATCH", "/api/admin/zones/nope", {}, BOSS],
    ["GET", "/api/admin/offers", null, M],
    ["POST", "/api/admin/offers/nope/toggle", { on: true }, M],
    ["PATCH", "/api/admin/offers/nope", {}, M],
    ["POST", "/api/admin/offers", {}, M],
    ["DELETE", "/api/admin/offers/nope", null, M],
    ["POST", "/api/admin/codes/check", { code: "x" }, M],
    ["GET", "/api/admin/vouchers", null, M],
    ["POST", "/api/admin/vouchers", {}, M],
    ["POST", "/api/admin/vouchers/use", { code: "x" }, [...M, "waiter"]],
    ["GET", "/api/admin/events", null, M],
    ["POST", "/api/admin/events", {}, M],
    ["PATCH", "/api/admin/events/nope", {}, M],
    ["POST", "/api/admin/events/nope/publish", { on: true }, M],
    ["DELETE", "/api/admin/events/nope", null, M],
    ["GET", "/api/admin/customers", null, BOSS],
    ["GET", "/api/admin/customers/nope", null, BOSS],
    ["POST", "/api/admin/customers/nope/contact", null, BOSS],
    ["GET", "/api/admin/customers/nope/export", null, BOSS],
    ["DELETE", "/api/admin/customers/nope", null, BOSS],
    ["GET", "/api/admin/messages", null, BOSS],
    ["GET", "/api/admin/messages?kind=inquiries", null, M],
    ["GET", "/api/admin/reports", null, BOSS],
    ["GET", "/api/admin/staff/list", null, BOSS],
    ["POST", "/api/admin/staff", {}, BOSS],
    ["PATCH", "/api/admin/staff/nope", {}, BOSS],
    ["POST", "/api/admin/staff/nope/active", { active: false }, BOSS],
    ["POST", "/api/admin/staff/nope/pin", {}, BOSS],
    ["DELETE", "/api/admin/staff/nope/pin", null, BOSS],
    ["GET", "/api/admin/site/state", null, M],
  ];

  it("401 without a session on every route", async () => {
    for (const [m, u, b] of ROUTES) expect([m, u, (await req(m, u, undefined, b ?? undefined)).status]).toEqual([m, u, 401]);
  });
  it("403 for every role without the right, never 403 for a role with it (each route, each role)", async () => {
    for (const [m, u, b, ok] of ROUTES) for (const r of ROLES) {
      const st = (await req(m, u, r, b ?? undefined)).status;
      expect([m, u, r, st === 403]).toEqual([m, u, r, !ok.includes(r)]);
    }
  });
  it("the old routes keep their rights and mask the phones of their raw lists", async () => {
    expect((await req("GET", "/api/admin/orders", "kitchen")).status).toBe(403);
    expect((await req("GET", "/api/admin/feedback", "marketing")).status).toBe(403);
    await core.feedback.create({ name: "Иван", contact: "0888777111", message: "Здравейте, имате ли паркинг?" });
    await core.reservations.create({ date: "2026-12-20", time: "19:00", people: 2, name: "Гост", phone: "0888777222", email: "gost@primer.bg" });
    const fb = await (await req("GET", "/api/admin/feedback", "manager")).json();
    expect(fb[0].contact).toBe("0888 •• •• 11");
    const rs = await (await req("GET", "/api/admin/reservations", "waiter")).json();
    expect(rs[0]).toMatchObject({ phone: "0888 •• •• 22", email: "g•••@primer.bg" });
    expect(rs[0].key).toBeUndefined();
    /* the old status PATCH follows the admin's rules (too early for "Дошли") */
    const early = await req("PATCH", "/api/admin/reservations/" + rs[0].id, "waiter", { status: "seated" });
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe("too_early");
  });

  it("orders: phone order (201), masked list, 'Покажи телефона' into the log, 'Откажи' with a reason, the reason on the tracking page", async () => {
    const r = await req("POST", "/api/admin/orders/phone", "manager", { phone: "0888123499", name: "Обаждане", mode: "pickup", lines: [{ id: dish.id, q: 1 }] });
    const body = await r.json();
    if (r.status !== 201) expect(body).toMatchObject({ error: expect.stringMatching(/closed|invalid/) }); /* outside the kitchen hours the core says so */
    else {
      expect(body).toMatchObject({ channel: "phone", phone: "0888 •• •• 99", by: "manager" });
      const l = await (await req("GET", "/api/admin/orders/list?status=work", "waiter")).json();
      expect(JSON.stringify(l)).not.toContain("0888123499");
      expect((await (await req("POST", "/api/admin/orders/" + body.no + "/phone", "waiter")).json()).phone).toBe("0888123499");
      expect((await req("POST", "/api/admin/orders/" + body.no + "/cancel", "manager", { reason: "" })).status).toBe(422);
      const c = await (await req("POST", "/api/admin/orders/" + body.no + "/cancel", "manager", { reason: "Клиентът се отказа" })).json();
      expect(c).toMatchObject({ status: "cancelled", reason: "Клиентът се отказа" });
      const o = (await core.orders.get(body.no))!;
      expect((await (await app.request("/api/orders/" + o.no + "-" + o.key)).json()).reason).toBe("Клиентът се отказа");
    }
  });

  it("public data follows the admin at once: zones, events, offers, the QR table", async () => {
    expect((await req("PATCH", "/api/admin/zones/gorublyane", "manager", { fee: "2,50", version: 0 })).status).toBe(200);
    expect((await (await app.request("/api/zones")).json()).find((z: { slug: string }) => z.slug === "gorublyane")).toMatchObject({ fee: 2.5, on: true, to: "21:00" });
    expect((await (await app.request("/api/zones/check?q=" + encodeURIComponent("кв. Горубляне"))).json())).toMatchObject({ type: "zone", zone: { slug: "gorublyane", fee: 2.5 } });
    const e = await (await req("POST", "/api/admin/events", "marketing", { n: "Джаз вечер", cat: "Жива музика", date: "2026-12-30", time: "20:00", priceMode: "free", publish: true })).json();
    expect(e).toMatchObject({ id: "dzhaz-vecher", status: "published" });
    expect((await (await app.request("/api/events")).json()).map((x: { id: string }) => x.id)).toContain("dzhaz-vecher");
    expect((await req("POST", "/api/admin/offers/signup/toggle", "marketing", { on: false })).status).toBe(200);
    expect((await (await app.request("/api/offers")).json()).some((o: { id: string }) => o.id === "signup")).toBe(false);
    const qr = await (await req("GET", "/api/admin/qr", "manager")).json();
    expect((await (await app.request("/api/table/" + qr[0].code)).json())).toMatchObject({ id: qr[0].id });
    expect((await app.request("/api/table/abcdefgh")).status).toBe(404);
  });

  it("the site data rebuilds the site through the menu's queue: SITE_FILE with the data, 301 for a gone event", async () => {
    const p = publisher()!;
    await p.idle();
    const last = builds[builds.length - 1];
    expect(last.site).toBeTruthy();
    expect((last.site!.zones as { slug: string; fee?: number | null }[]).find((z) => z.slug === "gorublyane")!.fee).toBe(2.5);
    expect((last.site!.events as { id: string }[]).map((x) => x.id)).toContain("dzhaz-vecher");
    expect(last.site!.offersOff).toEqual(["signup"]);
    /* a gone event: 301 to /sabitia/ from the new build's redirects.json */
    const n = builds.length;
    expect((await req("DELETE", "/api/admin/events/dzhaz-vecher", "marketing")).status).toBe(200);
    await p.idle();
    expect(builds.length).toBe(n + 1);
    expect(JSON.parse(fs.readFileSync(path.join(dist, "redirects.json"), "utf8"))["/sabitia/dzhaz-vecher/"]).toBe("/sabitia/");
    const r = await app.request("/sabitia/dzhaz-vecher/");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("/sabitia/");
    /* several changes while a build runs: one more build with the newest data */
    const m = builds.length;
    delay = 150; /* a build takes time: the changes meanwhile wait as one */
    await Promise.all([1, 2, 3].map((i) => req("PATCH", "/api/admin/zones/druzhba-1", "manager", { etaMin: 30 + i })));
    await p.idle();
    expect(builds.length).toBeLessThanOrEqual(m + 2);
    expect((builds[builds.length - 1].site!.zones as { slug: string; etaMin: number }[])[0].etaMin).toBe((await core.zones.live())[0].etaMin);
    const st = await (await req("GET", "/api/admin/site/state", "marketing")).json();
    expect(st).toMatchObject({ mode: "server", build: { state: "done" }, sections: { zones: { by: "manager" } } });
  });

  it("customers: 'Изтрий' with the window; staff: 'Изберете друг ПИН.'; reports without personal data", async () => {
    const list = await (await req("GET", "/api/admin/staff/list", "manager")).json();
    const w = list.rows.find((u: { role: string }) => u.role === "waiter"), k = list.rows.find((u: { role: string }) => u.role === "kitchen");
    const p = await (await req("POST", "/api/admin/staff/" + w.id + "/pin", "manager", { pin: "5832" })).json();
    expect(p.pin).toBe("5832");
    const bad = await req("POST", "/api/admin/staff/" + k.id + "/pin", "manager", { pin: "5832" });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "invalid", message: "Изберете друг ПИН." });
    expect((await (await req("POST", "/api/admin/staff/" + k.id + "/pin", "manager", {})).json()).pin).toMatch(/^\d{4}$/);
    const rep = await (await req("GET", "/api/admin/reports?period=7", "owner")).json();
    expect(rep).toMatchObject({ period: "7", cost: null });
    expect(JSON.stringify(rep)).not.toMatch(/0888/);
    expect((await req("GET", "/api/admin/reports?period=custom&from=2026-01-01&to=2026-12-31", "owner")).status).toBe(422);
  });
});
