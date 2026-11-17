/* The kitchen on the server (server/routes/kitchen.ts): every route answers 401 without a session and 403 for a role
   without the right (direct requests, no screen); the main flow through HTTP: a web order -> the queue -> "Започни" ->
   "Готово" -> the tracking page says "Готова"; "Натоварено" and "Изчерпано днес" reach the site and the admin at once. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../../server/app.ts";
import type { RoleId } from "../../src/core/index.ts";
import { kitchenApi, ApiError } from "../../src/client/api-kitchen.ts";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-kitchen-"));
const dist = path.join(tmp, "dist");
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), "<p>start</p>");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const ROLES: RoleId[] = ["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"];
const PW = "test-password-123";

describe("the kitchen: routes", async () => {
  /* the test mode: the page's clock (x-sc-clock) so an order can be placed at any hour of the real day */
  const { app, core } = createApp({ dbFile: ":memory:", distDir: dist, timers: false, build: async () => undefined, smsDemo: true, previewApi: true });
  for (const r of ROLES) await core.staff.upsert({ username: r, name: r, role: r, password: PW });
  const cookie: Record<string, string> = {};
  for (const r of ROLES) cookie[r] = (await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: r, password: PW }) })).headers.get("set-cookie")!.split(";")[0];
  const req = (method: string, url: string, who?: RoleId, body?: unknown, headers: Record<string, string> = {}) =>
    app.request(url, { method, headers: { "content-type": "application/json", ...(who ? { cookie: cookie[who] } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const web = async (lines: { id: string; q: number; mods?: string[] }[]) =>
    (await req("POST", "/api/orders", undefined, { cart: { mode: "delivery", lines }, addr: "ж.к. Дружба 2, бл. 311", name: "Иван", phone: "0888123456", pay: "cash" }, { "x-sc-clock": "19:42" })).json();

  const K: RoleId[] = ["admin", "owner", "manager", "kitchen"];
  const ROUTES: [string, string, unknown][] = [
    ["GET", "/api/kitchen/config", null], ["GET", "/api/kitchen/queue?sec=skara", null], ["POST", "/api/kitchen/orders/9999/start", { sec: "skara" }],
    ["POST", "/api/kitchen/orders/9999/line", { i: 0, ready: true }], ["POST", "/api/kitchen/orders/9999/done", { sec: "skara" }], ["POST", "/api/kitchen/orders/9999/back", { sec: "skara" }],
    ["POST", "/api/kitchen/orders/9999/seen", { sec: "skara" }], ["GET", "/api/kitchen/done?sec=skara", null], ["GET", "/api/kitchen/summary", null], ["GET", "/api/kitchen/sold-out?sec=skara", null],
    ["PUT", "/api/kitchen/sold-out/no-such-dish", { out: true }], ["GET", "/api/kitchen/busy", null], ["PUT", "/api/kitchen/busy", { on: "x" }], ["POST", "/api/kitchen/beat", { sec: "skara" }],
    ["GET", "/api/kitchen/tablets", null], ["GET", "/api/kitchen/search?sec=skara&q=12", null],
  ];
  it("401 without a session, 403 for the waiter, the driver and marketing, on every route", async () => {
    for (const [m, url, body] of ROUTES) {
      const anon = await req(m, url, undefined, body ?? undefined);
      expect(anon.status, m + " " + url).toBe(401);
      expect((await anon.json()).error).toBe("auth");
      for (const r of ROLES) {
        const res = await req(m, url, r, body ?? undefined);
        if (K.includes(r)) expect(res.status, m + " " + url + " " + r).not.toBe(403);
        else { expect(res.status, m + " " + url + " " + r).toBe(403); expect((await res.json()).error).toBe("forbidden"); }
      }
    }
    /* the settings of the kitchen: only a boss */
    expect((await req("PUT", "/api/kitchen/config", "kitchen", { soon: 4 })).status).toBe(403);
    expect((await req("PUT", "/api/kitchen/config", undefined, { soon: 4 })).status).toBe(401);
    const bad = await req("PUT", "/api/kitchen/busy", "kitchen", { on: "x" });
    expect([bad.status, (await bad.json()).fields.on]).toEqual([422, "Избери „включено“ или „изключено“."]);
    expect((await req("GET", "/api/kitchen/queue?sec=bar", "kitchen")).status).toBe(422);
  });

  it("a web order goes through the kitchen: the queue, „Започни“, the lines, „Готово“, the tracking page", async () => {
    const o = await web([{ id: "kebapcheta", q: 2, mods: ["без лук"] }, { id: "pitsa-margarita", q: 1, mods: ["+ Гъби"] }]);
    expect(o.lines.map((l: { sec: string; ks: string }) => [l.sec, l.ks])).toEqual([["skara", "wait"], ["pesht", "wait"]]);
    const q = await (await req("GET", "/api/kitchen/queue?sec=skara", "kitchen")).json();
    expect(q.tickets.map((t: { no: string }) => t.no)).toEqual([o.no]);
    expect(q.tickets[0]).toMatchObject({ isNew: true, web: true, timer: "ok", src: { text: "Доставка № " + o.no }, lines: [{ i: 0, q: 2, name: "Кебапчета", no: ["лук"], ks: "wait" }], others: [{ name: "Пица Маргарита", short: "Пещ", state: "wait" }] });
    expect((await (await req("POST", "/api/kitchen/orders/" + o.no + "/seen", "kitchen", { sec: "skara" })).json()).same).toBe(false);
    const st = await (await req("POST", "/api/kitchen/orders/" + o.no + "/start", "kitchen", { sec: "skara" })).json();
    expect(st).toMatchObject({ status: "cooking", changed: [0], ticket: { isNew: false } });
    const l = await (await req("POST", "/api/kitchen/orders/" + o.no + "/line", "kitchen", { i: 0, ready: true, sec: "skara", at: Date.now() })).json();
    expect(l).toMatchObject({ secReady: true, orderReady: false, ticket: null, waiting: ["Пещ"], notify: [] });
    expect((await (await req("GET", "/api/orders/" + o.no + "-" + o.key)).json()).status).toBe("cooking");
    const fin = await (await req("POST", "/api/kitchen/orders/" + o.no + "/done", "manager", { sec: "all" })).json();
    expect(fin).toMatchObject({ status: "ready", orderReady: true, notify: ["driver", "customer"], msg: "Известихме шофьора." });
    expect((await (await req("GET", "/api/orders/" + o.no + "-" + o.key)).json()).status).toBe("ready");
    expect((await (await req("GET", "/api/kitchen/done?sec=skara", "kitchen")).json()).rows.map((r: { no: string }) => r.no)).toEqual([o.no]);
    /* „Върни“; the kitchen never moves it to the driver's steps */
    const back = await (await req("POST", "/api/kitchen/orders/" + o.no + "/back", "kitchen", { sec: "pesht", lines: fin.changed })).json();
    expect(back).toMatchObject({ status: "cooking", changed: [1] });
    expect((await req("POST", "/api/admin/orders/" + o.no + "/step", "kitchen", { status: "on_way" })).status).toBe(409);
    const future = await req("POST", "/api/kitchen/orders/" + o.no + "/done", "kitchen", { sec: "pesht", at: Date.now() + 3_600_000 });
    expect([future.status, (await future.json()).error]).toEqual([422, "bad_at"]);
    const found = await (await req("GET", "/api/kitchen/search?sec=pesht&q=" + encodeURIComponent("пица"), "kitchen")).json();
    expect(found.act.map((r: { no: string }) => r.no)).toEqual([o.no]);
    const sum = await (await req("GET", "/api/kitchen/summary", "kitchen")).json();
    expect(sum.rows.map((r: { no: string }) => r.no)).toEqual([o.no]);
  });

  it("„Натоварено“ and „Изчерпано днес“ reach the site and the admin at once; the tablet's heartbeat", async () => {
    const on = await (await req("PUT", "/api/kitchen/busy", "kitchen", { on: true, sec: "skara" })).json();
    expect(on).toMatchObject({ on: true, by: "Кухня · Скара", same: false });
    expect((await (await req("GET", "/api/status")).json()).kitchen).toEqual({ busy: true, etaMin: 35, etaBusyMin: 55 }); /* public: no names */
    expect((await (await req("GET", "/api/admin/settings", "manager")).json()).kitchen).toMatchObject({ busy: true, busyBy: "Кухня · Скара" });
    const o = await web([{ id: "svinski-vrat", q: 1 }]);
    expect(o.kBusy).toBe(20);
    expect((await (await req("PUT", "/api/kitchen/busy", "manager", { on: false })).json()).log[0]).toMatchObject({ by: "Кухня · Скара", offBy: "Управител" });

    const out = await (await req("PUT", "/api/kitchen/sold-out/svinski-vrat", "kitchen", { out: true, sec: "skara" })).json();
    expect(out).toMatchObject({ out: true, orders: 1, nos: [o.no], waiter: false, manager: true, who: "управителя (доставка и вземане)" });
    const menu = await (await req("GET", "/api/menu")).json();
    expect(menu.items.find((x: { id: string }) => x.id === "svinski-vrat").t).toContain("out");
    expect((await (await req("GET", "/api/kitchen/sold-out?sec=skara", "kitchen")).json()).list.find((x: { id: string }) => x.id === "svinski-vrat")).toMatchObject({ by: "Кухня · Скара", mine: true });
    expect((await (await req("PUT", "/api/kitchen/sold-out/svinski-vrat", "kitchen", { out: false })).json()).out).toBe(false);

    expect((await (await req("POST", "/api/kitchen/beat", "kitchen", { sec: "skara", device: "tab-1" })).json()).counted).toBe(true);
    const tabs = await (await req("GET", "/api/kitchen/tablets", "manager")).json();
    expect(tabs.find((t: { sec: string }) => t.sec === "skara")).toMatchObject({ online: true, text: "Таблетът работи" });
    const cfg = await (await req("GET", "/api/kitchen/config", "kitchen")).json();
    expect(cfg.missing).toEqual(["[ЛИПСВА: секции на кухнята]", "[ЛИПСВА: норми за време]"]);
    const saved = await (await req("PUT", "/api/kitchen/config", "manager", { soon: 4, version: cfg.version })).json();
    expect(saved).toMatchObject({ soon: 4, version: cfg.version + 1, missing: ["[ЛИПСВА: секции на кухнята]"] });
    expect((await req("PUT", "/api/kitchen/config", "manager", { soon: 3, version: cfg.version })).status).toBe(409);
  });

  it("the client (src/client/api-kitchen.ts) reaches every route: the same results and the same errors as the core", async () => {
    let who: RoleId = "kitchen";
    const real = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit = {}) => app.request(url, { ...init, headers: { ...(init.headers as Record<string, string>), cookie: cookie[who] } })) as never;
    try {
      const o = await web([{ id: "kebapcheta", q: 1 }, { id: "shopska-salata", q: 1 }]);
      const cfg = await kitchenApi.config();
      expect(cfg.sections.map((x) => x.id)).toEqual(["topla", "skara", "pesht", "studeni"]);
      expect((await kitchenApi.queue("skara")).tickets.map((t) => t.no)).toContain(o.no);
      expect(await kitchenApi.seen(o.no, "skara")).toEqual({ ok: true, same: false });
      expect((await kitchenApi.start(o.no, "skara", { at: Date.now() })).status).toBe("cooking");
      const l = await kitchenApi.line(o.no, 0, true, { sec: "skara", at: new Date().toISOString() });
      expect([l.secReady, l.ticket]).toEqual([true, null]);
      expect((await kitchenApi.back(o.no, "skara", { lines: l.changed })).changed).toEqual([0]);
      expect((await kitchenApi.done(o.no, "all")).status).toBe("ready");
      expect((await kitchenApi.doneToday("studeni")).rows.map((r) => r.no)).toContain(o.no);
      expect((await kitchenApi.summary()).sections).toHaveLength(4);
      expect((await kitchenApi.soldOut("skara")).groups[0].n).toBe("Скара Bertha");
      expect(await kitchenApi.setOut("tiramisu", true, { sec: "studeni" })).toMatchObject({ out: true, orders: 0 });
      expect((await kitchenApi.setOut("tiramisu", false)).out).toBe(false);
      expect((await kitchenApi.setBusy(true, { sec: "all" })).by).toBe("Главен готвач");
      expect((await kitchenApi.busy()).on).toBe(true);
      expect((await kitchenApi.setBusy(false)).on).toBe(false);
      expect((await kitchenApi.beat("skara", { device: "tab-1" })).counted).toBe(true);
      expect((await kitchenApi.tablets()).map((t) => t.sec)).toEqual(["topla", "skara", "pesht", "studeni", "all"]);
      expect((await kitchenApi.search("all", "доставка")).sec).toBe("all");
      const e1 = await kitchenApi.done(o.no, "skara", { at: Date.now() + 3_600_000 }).catch((e) => e);
      expect(e1).toBeInstanceOf(ApiError);
      expect(e1).toMatchObject({ code: "bad_at", status: 422, message: "Часовникът на таблета е напред. Провери го и опитай пак.", fields: { at: "Часовникът на таблета е напред. Провери го и опитай пак." } });
      expect(await kitchenApi.setConfig({ soon: 5 }).catch((e) => [e.code, e.status])).toEqual(["forbidden", 403]);
      who = "manager";
      expect((await kitchenApi.setConfig({ soon: 5 }, (await kitchenApi.config()).version)).soon).toBe(5);
      who = "waiter";
      expect(await kitchenApi.queue("skara").catch((e) => [e.code, e.status, e.message])).toEqual(["forbidden", 403, "Нямате права за този раздел."]);
    } finally { globalThis.fetch = real; }
  });
});
