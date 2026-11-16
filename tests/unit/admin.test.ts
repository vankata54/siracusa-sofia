/* The admin frame (etap C, part 1): rights in the core (guard), sign-in by role with the lockout per username and address,
   notes and recommendations (statuses, source, "Моите препоръки", the badge, personal data), the dashboard ("Чака те",
   "Днес: X €"), "Търси навсякъде" by role, and the server routes that use them. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, scrubPersonal, isSiteUrl, maskPhone, normKey, type Hasher } from "../../src/core/index.ts";
import { createApp } from "../../server/app.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s", hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
let NOW = new Date("2026-11-15T17:42:00Z");
const mk = () => createCore({ repo: new MemoryRepo(), hasher, now: () => NOW, clock: "19:42", smsDemo: true });
const PW = "a-long-password-1";
async function people(core: ReturnType<typeof mk>) {
  for (const [u, r] of [["admin", "admin"], ["owner", "owner"], ["manager", "manager"], ["waiter", "waiter"], ["kitchen", "kitchen"], ["marketing", "marketing"]] as const)
    await core.staff.upsert({ username: u, name: u === "admin" ? "Главен админ" : u, role: r, password: PW });
  const tok: Record<string, string> = {};
  for (const u of ["admin", "owner", "manager", "waiter", "kitchen", "marketing"]) tok[u] = (await core.staff.login(u, PW, "1.1.1." + u.length)).token;
  const s = async (u: string) => (await core.staff.bySession(tok[u]))!;
  return { tok, s };
}
const note = { module: "site", url: "/menu/", selector: "main h1", text: "По-голямо заглавие", viewport: { w: 390, h: 844 } };

describe("admin: roles, sign-in, guard", () => {
  it("sections include Настройки; Табло stays for every role; only the main admin changes roles", async () => {
    const core = mk(); const { tok } = await people(core);
    const roles = await core.staff.roles();
    expect(roles.find((r) => r.id === "admin")!.sections).toContain("settings");
    expect(roles.find((r) => r.id === "manager")!.sections).toContain("settings");
    expect(roles.find((r) => r.id === "waiter")!.sections).toEqual(["dashboard", "waiter", "orders", "reservations"]);
    const r = await core.staff.setRole("waiter", ["orders"], "admin");
    expect(r.sections).toEqual(["dashboard", "orders"]);
    expect((await core.audit.list()).find((a) => a.action === "role.update")!.data).toMatchObject({ removed: ["waiter", "reservations"], added: [] });
    await expect(core.staff.guard(tok.owner, "roles", true)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(core.staff.guard(tok.kitchen, "menu")).rejects.toMatchObject({ code: "forbidden" });
    await expect(core.staff.guard("nope", "menu")).rejects.toMatchObject({ code: "auth", status: 401 });
    expect((await core.staff.guard(tok.admin, "anything", true)).user.role).toBe("admin");
  });

  it("sign-in: home by role; the same message; lockout after 10 per username AND per address", async () => {
    const core = mk(); await people(core);
    expect((await core.staff.login("waiter", PW, "9.9.9.9")).home).toBe("app:waiter");
    expect((await core.staff.login("Owner", PW, "9.9.9.9")).home).toBe("dashboard");
    /* per username: 10 wrong from different addresses lock the username, also from a new address */
    for (let i = 0; i < 9; i++) await expect(core.staff.login("manager", "x", "2.0.0." + i)).rejects.toMatchObject({ code: "bad_login" });
    await expect(core.staff.login("manager", "x", "2.0.0.9")).rejects.toMatchObject({ code: "throttled", status: 429 });
    await expect(core.staff.login("manager", PW, "3.3.3.3")).rejects.toMatchObject({ code: "throttled" });
    /* per address: a higher second limit (50), so 10 wrong of colleagues do not lock the restaurant */
    for (let i = 0; i < 10; i++) await core.staff.login("ghost" + i, "x", "4.4.4.4").catch(() => undefined);
    expect((await core.staff.login("owner", PW, "4.4.4.4")).user.username).toBe("owner");
    for (let i = 0; i < 41; i++) await core.staff.login("ghost" + i, "x", "4.4.4.4").catch(() => undefined);
    await expect(core.staff.login("owner", PW, "4.4.4.4")).rejects.toMatchObject({ code: "throttled" });
    expect((await core.staff.login("owner", PW, "5.5.5.5")).user.username).toBe("owner");
    /* the last attempts say how many are left */
    const e = await core.staff.login("kitchen", "x", "6.0.0.1").catch((x) => x);
    expect(e).toMatchObject({ code: "bad_login", message: "Грешен потребител или парола." });
    /* 15 minutes later the username works again */
    NOW = new Date(NOW.getTime() + 16 * 60_000);
    expect((await core.staff.login("manager", PW, "3.3.3.3")).user.username).toBe("manager");
    NOW = new Date("2026-11-15T17:42:00Z");
    expect((await core.audit.list(500)).filter((a) => a.action === "staff.login_failed").length).toBeGreaterThan(10);
  });
});

describe("admin: notes and recommendations", () => {
  it("source, statuses with history, reason for rejected, the approved export", async () => {
    const core = mk(); const { s } = await people(core);
    const a = await core.notes.create(note, await s("waiter"));
    expect(a).toMatchObject({ status: "new", source: { type: "staff", role: "waiter", user: "waiter" }, author: "waiter" });
    await expect(core.notes.setStatus(a.id, "rejected", "Главен админ")).rejects.toMatchObject({ code: "invalid", fields: { reason: expect.any(String) } });
    await core.notes.setStatus(a.id, "approved", "Главен админ");
    expect((await core.notes.approved()).map((n) => n.id)).toEqual([a.id]);
    await core.notes.setStatus(a.id, "doing", "Главен админ");
    const b = await core.notes.setStatus(a.id, "review", "Главен админ", { change: { summary: "Заглавието е 32 px", before: "28 px", after: "32 px" } });
    expect(b.history!.map((h) => h.status)).toEqual(["new", "approved", "doing", "review"]);
    expect(b.change).toMatchObject({ summary: "Заглавието е 32 px" });
    await expect(core.notes.setStatus(a.id, "done" as never, "x")).rejects.toMatchObject({ code: "bad_status" });
    expect((await core.notes.list({ source: "waiter" })).length).toBe(1);
    expect((await core.notes.list({ source: "client" })).length).toBe(0);
  });

  it("the badge: main admin = new + review; others = their recommendations with a new status since they last looked", async () => {
    const core = mk(); const { s } = await people(core);
    const w = await s("waiter"), adm = await s("admin");
    const n1 = await core.notes.create(note, w);
    await core.notes.create({ ...note, text: "Друго" }, await s("marketing"));
    expect(await core.notes.waiting(adm)).toMatchObject({ n: 2, newN: 2, reviewN: 0, title: "2 чакат одобрение" });
    expect((await core.notes.waiting(w)).n).toBe(0);
    await core.notes.setStatus(n1.id, "approved", "Главен админ");
    expect(await core.notes.waiting(w)).toMatchObject({ n: 1, title: "1 ваша препоръка е с нов статус" });
    NOW = new Date(NOW.getTime() + 1000);
    await core.notes.seen(w);
    expect((await core.notes.waiting(w)).n).toBe(0);
    expect((await core.notes.mine(w)).map((n) => n.id)).toEqual([n1.id]);
    expect(await core.notes.waiting(adm)).toMatchObject({ n: 1, title: "1 чака одобрение" });
    NOW = new Date("2026-11-15T17:42:00Z");
  });

  it("personal data never stays; the customer's note only for the site's own pages", async () => {
    expect(scrubPersonal("Обадете се на 0888 12 34 56 или ivan@abv.bg")).toBe("Обадете се на [телефон] или [имейл]");
    expect(scrubPersonal("+359 888 123 456")).toBe("[телефон]");
    expect(scrubPersonal("Цената е 12,50 € за 2 порции")).toBe("Цената е 12,50 € за 2 порции");
    const routes = ["/", "/menu/", "/menu/pitsi/"];
    expect(isSiteUrl("/menu/pitsi/#x", routes)).toBe(true);
    expect(isSiteUrl("/menu/pitsi", routes)).toBe(true);
    expect(isSiteUrl("/porachka/1042-abcd23/", routes)).toBe(true);
    for (const bad of ["/admin/", "/api/x", "https://evil.com/", "//evil.com/", "/nope/"]) expect(isSiteUrl(bad, routes)).toBe(false);
    const core = mk();
    const r = await core.notes.suggest({ ...note, url: "/menu/", text: "Пишете ми на ivan@abv.bg", elementText: "0888123456" }, routes);
    const [n] = await core.notes.list();
    expect(n).toMatchObject({ id: r.id, module: "site", text: "Пишете ми на [имейл]", elementText: "[телефон]", source: { type: "client" }, author: "Клиент от сайта" });
    await expect(core.notes.suggest({ ...note, url: "/admin/roles/" }, routes)).rejects.toMatchObject({ code: "invalid" });
    await expect(core.notes.suggest({ ...note, text: "  " }, routes)).rejects.toMatchObject({ fields: { text: "Напишете какво да подобрим." } });
  });
});

describe("admin: dashboard and search by role", () => {
  it("Чака те, Днес and the sales only for the owner and the main admin", async () => {
    const core = mk(); const { s } = await people(core);
    await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 2, mods: [], extra: 0 }] } as never, name: "Клиент 1", phone: "0888123456", pay: "cash" });
    await core.notes.create(note, await s("waiter"));
    const adm = await core.admin.summary(await s("admin"));
    expect(adm.waiting).toMatchObject({ orders: 1, reservations: 0, noShows: 0, notes: { n: 1 } });
    expect(adm.today.sales).toMatchObject({ n: 1, sample: false });
    expect(adm.today.sales!.sum).toBeGreaterThan(0);
    expect(adm.today.inWork).toBe(1);
    const own = await core.admin.summary(await s("owner"));
    expect(own.today.sales!.n).toBe(1);
    const man = await core.admin.summary(await s("manager"));
    expect(man.today.sales).toBeNull();
    const mkt = await core.admin.summary(await s("marketing"));
    expect(mkt.waiting).toMatchObject({ orders: null, reservations: null, noShows: null });
    expect(mkt.today).toMatchObject({ inWork: null, sales: null, soldOut: null });
    const kit = await core.admin.summary(await s("kitchen"));
    expect(typeof kit.today.soldOut).toBe("number");
  });

  it("no-shows: the second one of a phone waits for a decision", async () => {
    const core = mk(); const { s } = await people(core);
    const mkRes = async (date: string) => (await core.reservations.create({ date, time: "19:00", people: 2, name: "Клиент 2", phone: "0888 55 44 33", marketing: false } as never));
    const a = await mkRes("2026-11-20"), b = await mkRes("2026-11-21");
    await core.reservations.setStatus(a.id, "no_show", "manager");
    expect((await core.admin.summary(await s("manager"))).waiting.noShows).toBe(0);
    await core.reservations.setStatus(b.id, "no_show", "manager");
    expect((await core.admin.summary(await s("manager"))).waiting.noShows).toBe(1);
    expect((await core.admin.summary(await s("waiter"))).waiting.noShows).toBeNull();
  });

  it("search: only what the role sees, phones masked, the exact match wins", async () => {
    const core = mk(); const { s } = await people(core);
    const o = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] } as never, name: "Клиент 3", phone: "0888123456", pay: "cash" });
    await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] } as never, name: "Клиент 33", phone: "0899000000", pay: "cash" });
    const r = await core.admin.search(await s("admin"), "Клиент 3");
    expect(r.orders!.map((h) => h.id)).toEqual([o.no]);
    expect(r.orders![0].phone).toBe("0888 •• •• 56");
    expect((await core.admin.search(await s("admin"), o.no)).orders![0]).toMatchObject({ id: o.no, exact: true });
    expect((await core.admin.search(await s("admin"), "klient")).orders!.length).toBe(2);
    expect((await core.admin.search(await s("marketing"), "Клиент")).orders).toBeNull();
    expect((await core.admin.search(await s("kitchen"), "0888123456")).customers).toBeNull();
    expect(maskPhone("+359888123456")).toBe("0888 •• •• 56");
    expect(normKey("Шопска")).toBe(normKey("shopska"));
  });
});

describe("admin: server routes", async () => {
  const { app, core } = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, trustProxy: true, routes: ["/", "/menu/", "/kontakti/"] });
  for (const [u, r] of [["admin", "admin"], ["waiter", "waiter"], ["owner", "owner"]] as const) await core.staff.upsert({ username: u, name: u, role: r, password: PW });
  const json = (method: string, body?: unknown, cookie?: string, ip = "10.0.0.1") => ({ method, headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const login = async (u: string, ip = "10.0.0.1") => { const r = await app.request("/api/auth/login", json("POST", { username: u, password: PW }, undefined, ip)); return { body: await r.json(), cookie: r.headers.get("set-cookie")!.split(";")[0] }; };

  it("login answers with home; me has it; the waiter writes a recommendation but cannot approve or list all", async () => {
    const w = await login("waiter"), a = await login("admin");
    expect(w.body.home).toBe("app:waiter");
    expect((await (await app.request("/api/auth/me", { headers: { cookie: w.cookie } })).json()).home).toBe("app:waiter");
    const n = await (await app.request("/api/admin/notes", json("POST", note, w.cookie))).json();
    expect(n.source).toMatchObject({ type: "staff", role: "waiter" });
    expect((await app.request("/api/admin/notes", { headers: { cookie: w.cookie } })).status).toBe(403);
    expect((await (await app.request("/api/admin/notes/mine", { headers: { cookie: w.cookie } })).json()).length).toBe(1);
    expect((await app.request("/api/admin/notes/" + n.id, json("PATCH", { status: "approved" }, w.cookie))).status).toBe(403);
    expect((await app.request("/api/admin/notes/" + n.id, json("PATCH", { status: "approved" }, a.cookie))).status).toBe(200);
    expect((await (await app.request("/api/admin/notes?status=approved", { headers: { cookie: a.cookie } })).json()).length).toBe(1);
    expect((await (await app.request("/api/admin/notes/waiting", { headers: { cookie: w.cookie } })).json()).n).toBe(1);
    await app.request("/api/admin/notes/seen", json("POST", {}, w.cookie));
    expect((await (await app.request("/api/admin/notes/waiting", { headers: { cookie: w.cookie } })).json()).n).toBe(0);
    const del = await (await app.request("/api/admin/notes/" + n.id, json("DELETE", undefined, a.cookie))).json();
    expect((await app.request("/api/admin/notes/restore", json("POST", { note: del.note }, a.cookie))).status).toBe(201);
    expect((await app.request("/api/admin/roles/owner", json("PUT", { sections: ["dashboard"] }, (await login("owner")).cookie))).status).toBe(403);
    expect((await app.request("/api/admin/summary", { headers: { cookie: w.cookie } })).status).toBe(200);
    expect((await app.request("/api/admin/summary")).status).toBe(401);
  });

  it("the kitchen moves an order only to cooking / ready", async () => {
    await core.staff.upsert({ username: "kitchen", name: "Кухня", role: "kitchen", password: PW });
    const k = await login("kitchen");
    const o = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] } as never, name: "Клиент 4", phone: "0888123499", pay: "cash", sched: "утре", slot: "12:00" });
    expect((await app.request("/api/admin/orders/" + o.no, json("PATCH", { status: "cancelled", reason: "x" }, k.cookie))).status).toBe(409);
    expect((await app.request("/api/admin/orders/" + o.no, json("PATCH", { status: "cooking" }, k.cookie))).status).toBe(200);
  });

  it("Предложи подобрение: public, only site pages, 3 an hour per IP", async () => {
    const send = (ip: string, url = "/") => app.request("/api/notes/suggest", json("POST", { ...note, url, text: "Хубаво, но 0888123456" }, undefined, ip));
    const r = await send("20.0.0.1");
    expect(r.status).toBe(201);
    expect((await send("20.0.0.2", "/admin/")).status).toBe(422);
    expect((await send("20.0.0.2", "/servitor/")).status).toBe(422);
    expect((await send("20.0.0.1")).status).toBe(201);
    expect((await send("20.0.0.1")).status).toBe(201);
    const four = await send("20.0.0.1");
    expect(four.status).toBe(429);
    expect((await four.json()).retryIn).toBeGreaterThan(0);
    const all = await core.notes.list({ source: "client" });
    expect(all.every((n) => n.text.includes("[телефон]"))).toBe(true);
  });

  it("sign-in lockout per username works through the server", async () => {
    await core.staff.upsert({ username: "lock", name: "x", role: "manager", password: PW });
    for (let i = 0; i < 10; i++) await app.request("/api/auth/login", json("POST", { username: "lock", password: "x" }, undefined, "30.0.0." + i));
    const r = await app.request("/api/auth/login", json("POST", { username: "lock", password: PW }, undefined, "31.0.0.1"));
    expect(r.status).toBe(429);
    expect((await r.json()).message).toBe("Твърде много опити. Опитайте след 15 минути.");
  });
});

describe("admin: after the flows review (round 1)", () => {
  it("parallel wrong attempts cannot slip past the lockout", async () => {
    const core = mk(); await people(core);
    const r = await Promise.allSettled(Array.from({ length: 30 }, (_, i) => core.staff.login("kitchen", "wrong-" + i, "7.0.0." + i)));
    const codes = r.map((x) => (x.status === "rejected" ? (x.reason as { code: string }).code : "ok"));
    expect(codes.filter((c) => c === "bad_login").length).toBeLessThanOrEqual(9);
    expect(codes.filter((c) => c === "throttled").length).toBeGreaterThanOrEqual(21);
  });

  it("personal data in any script and with separators; the order key and the query never stay", async () => {
    for (const x of ["０８８８１２３４５６", "٠٨٨٨١٢٣٤٥٦", "088８123456", "+359 (888) 12-34-56", "0888 - 123 - 456", "0888\u2013123\u2013456"]) expect(scrubPersonal("т: " + x)).toBe("т: [телефон]");
    for (const x of ["ivan @ abv.bg", "ivan＠abv.bg", "ivan@abv . bg"]) expect(scrubPersonal(x)).toBe("[имейл]");
    expect(scrubPersonal("На 15.11.2026 в 19:00, 12,50 €")).toBe("На 15.11.2026 в 19:00, 12,50 €");
    const core = mk(); const { s } = await people(core);
    const routes = ["/", "/menu/"];
    await core.notes.suggest({ ...note, url: "/porachka/1042-75p5eqmf/#x", text: "Добре" }, routes);
    await core.notes.suggest({ ...note, url: "/menu/?phone=0888123456#tel0888123456", selector: 'a[href="tel:0888 123 456"]', editId: "0888123456", text: "Добре" }, routes);
    const l = await core.notes.list({ source: "client" });
    expect(l.map((n) => n.url).sort()).toEqual(["/menu/", "/porachka/"]);
    const m = l.find((n) => n.url === "/menu/")!;
    expect(m.selector).toBe('a[href="tel:[телефон]"]');
    expect(m.editId).toBe("[телефон]");
    await expect(core.notes.suggest({ ...note, url: "/porachka/<img src=x onerror=alert(1)>/" }, routes)).rejects.toMatchObject({ code: "invalid" });
    /* staff: only a path of the site, only png / jpeg / webp screenshots; the order key goes */
    const w = await s("driver" as never).catch(() => s("waiter"));
    await expect(core.notes.create({ ...note, url: "javascript:alert(1)" }, w)).rejects.toMatchObject({ code: "invalid" });
    await expect(core.notes.create({ ...note, url: "//evil.com/x" }, w)).rejects.toMatchObject({ code: "invalid" });
    const sv = await core.notes.create({ ...note, screenshot: "data:image/svg+xml,<svg onload=alert(1)>" }, w);
    expect(sv.screenshot).toBeNull();
    const k = await core.notes.create({ ...note, url: "/porachka/1042-75p5eqmf/" }, w);
    expect(k.url).toBe("/porachka/");
    const h = await core.notes.create({ ...note, url: "/admin/notes/#s=new" }, w);
    expect(h.url).toBe("/admin/notes/#s=new");
  });

  it("the note steps go in order; restore checks the note like a new one", async () => {
    const core = mk(); const { s } = await people(core);
    const n = await core.notes.create(note, await s("waiter"));
    await expect(core.notes.setStatus(n.id, "published", "admin")).rejects.toMatchObject({ code: "bad_step", status: 409 });
    await core.notes.setStatus(n.id, "approved", "admin", { who: "Главен админ" });
    await core.notes.setStatus(n.id, "new", "admin");
    const a = await core.notes.setStatus(n.id, "approved", "admin", { who: "Главен админ" });
    expect(a.history!.at(-1)!.who).toBe("Главен админ");
    await expect(core.notes.restore({ id: "zz1", status: "new" } as never, "admin")).rejects.toMatchObject({ code: "invalid" });
    const gone = await core.notes.remove(n.id, "admin");
    const back = await core.notes.restore({ ...gone!, url: "javascript:x" }, "admin").catch((e) => e);
    expect(back).toMatchObject({ code: "invalid" });
    expect((await core.notes.restore(gone!, "admin")).status).toBe("approved");
  });

  it("order steps by section: the kitchen never brings back a cancelled order; the way back with Отмени", async () => {
    const core = mk(); const { s } = await people(core);
    const o = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] } as never, name: "Клиент 5", phone: "0888123477", pay: "cash" });
    const kit = await s("kitchen"), man = await s("manager");
    await expect(core.orders.setStatus(o.no, "ready", "kitchen", kit)).rejects.toMatchObject({ code: "bad_step" });
    await core.orders.setStatus(o.no, "cooking", "kitchen", kit);
    await core.orders.setStatus(o.no, "cancelled", "manager", man);
    await expect(core.orders.setStatus(o.no, "cooking", "kitchen", kit)).rejects.toMatchObject({ code: "bad_step" });
    await expect(core.orders.setStatus(o.no, "ready", "manager", man)).rejects.toMatchObject({ code: "bad_step" });
    expect((await core.orders.setStatus(o.no, "cooking", "manager", man)).status).toBe("cooking");
    await expect(core.orders.setStatus(o.no, "picked_up", "manager", man)).rejects.toMatchObject({ code: "bad_step" });
  });

  it("server: the real address is the last X-Forwarded-For; Origin null is 403; a big body is 413", async () => {
    const { app } = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, trustProxy: true, routes: ["/"] });
    const send = (i: number) => app.request("/api/notes/suggest", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9." + i + ", 203.0.113.7" }, body: JSON.stringify({ ...note, url: "/", text: "Добре" }) });
    const st: number[] = [];
    for (let i = 0; i < 5; i++) st.push((await send(i)).status);
    expect(st).toEqual([201, 201, 201, 429, 429]);
    expect((await app.request("/api/notes/suggest", { method: "POST", headers: { "content-type": "application/json", origin: "null" }, body: "{}" })).status).toBe(403);
    expect((await app.request("/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "content-length": "3000000" }, body: "{}" })).status).toBe(413);
  });
});

describe("admin: after the flows review (round 2)", () => {
  it("the scrub is linear and cuts first; phones with dots and worded e-mails go", async () => {
    const big = "а".repeat(60_000) + " ivan@abv.bg";
    const t0 = Date.now(); scrubPersonal(big); scrubPersonal("x".repeat(60_000)); expect(Date.now() - t0).toBeLessThan(300);
    expect(scrubPersonal("т. 0888.123.456 и 0888/123456")).toBe("т. [телефон] и [телефон]");
    expect(scrubPersonal("15.11.2026, 12.50 €")).toBe("15.11.2026, 12.50 €");
    expect(scrubPersonal("ivan at abv dot bg")).toBe("[имейл]");
    const core = mk();
    const t1 = Date.now();
    await core.notes.suggest({ ...note, url: "/", text: "б".repeat(60_000) }, ["/"]);
    expect(Date.now() - t1).toBeLessThan(500);
  });
  it("server: a chunked body over the limit is 413", async () => {
    const { app } = createApp({ dbFile: ":memory:", distDir: "dist", timers: false, routes: ["/"] });
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode("x".repeat(4096))); c.close(); } });
    const r = await app.request("/api/notes/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: big, duplex: "half" } as RequestInit);
    expect(r.status).toBe(413);
  });
  it("the same order status again writes nothing", async () => {
    const core = mk(); const { s } = await people(core);
    const o = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] } as never, name: "Клиент 6", phone: "0888123466", pay: "cash" });
    const man = await s("manager");
    await core.orders.setStatus(o.no, "cancelled", "manager", man);
    const n = (await core.audit.list()).length;
    await core.orders.setStatus(o.no, "cancelled", "manager", man);
    expect((await core.audit.list()).length).toBe(n);
  });
});
