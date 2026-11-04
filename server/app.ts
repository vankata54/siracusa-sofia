/* The Node server: serves dist/ (the static Astro build) and the REST API /api/* + SSE /api/stream.
   Everything business-related goes through src/core (same code as the static demo). */
import fs from "node:fs";
import path from "node:path";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { openDb, seedMenu, readMenu } from "./db/index.ts";
import { SqliteRepo } from "./db/repo.ts";
import { scryptHasher } from "./hasher.ts";
import { createCore, CoreError, type Ctx, type RoleId, type NoteStatus, type OrderStatus, type ReservationStatus } from "../src/core/index.ts";
import { state, status, eta } from "../src/lib/status.ts";
import { offers } from "../src/lib/offers.ts";
import { events } from "../src/lib/events.ts";
import { zoneOfAddress } from "../src/lib/zones.ts";
import { ZONES } from "../src/lib/data.ts";

export interface AppOpts { dbFile: string; distDir: string; secure?: boolean }

const STAFF_COOKIE = "sc_staff", USER_COOKIE = "sc_user";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4",
};

export function createApp(opts: AppOpts) {
  const { sqlite, db } = openDb(opts.dbFile);
  seedMenu(db);
  const clients = new Set<(type: string, data: unknown) => void>();
  const ctx: Ctx = { repo: new SqliteRepo(sqlite), hasher: scryptHasher, emit: (type, data) => clients.forEach((f) => f(type, data)) };
  const core = createCore(ctx);
  const app = new Hono();
  const dist = path.resolve(opts.distDir);

  /* ---------- helpers ---------- */
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, secure: !!opts.secure, path: "/" };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { return {}; } };
  async function staff(c: Context, section?: string) {
    const s = await core.staff.bySession(getCookie(c, STAFF_COOKIE));
    if (!s) throw new CoreError("auth", "Влезте отново.", 401);
    if (section && !(s.user.role === "admin" || s.sections.includes(section))) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
    return s;
  }
  async function customer(c: Context) {
    const u = await core.customers.bySession(getCookie(c, USER_COOKIE));
    if (!u) throw new CoreError("auth", "Влезте с телефона си.", 401);
    return u;
  }
  /* login throttling: 10 failed attempts per IP per 15 min */
  const fails = new Map<string, { n: number; until: number }>();
  const ip = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";

  app.onError((err, c) => {
    if (err instanceof CoreError) return c.json({ error: err.code, message: err.message, fields: (err as CoreError & { fields?: unknown }).fields }, err.status as 400);
    console.error(err);
    return c.json({ error: "server", message: "Нещо се обърка. Опитайте пак." }, 500);
  });

  /* CSRF: state-changing API calls must come from our own origin (SameSite=Lax cookies cover the rest) */
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin && new URL(origin).host !== c.req.header("host")) return c.json({ error: "origin", message: "Забранен адрес." }, 403);
    }
    c.header("Cache-Control", "no-store");
    await next();
  });

  /* ---------- public data ---------- */
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/menu", (c) => c.json(readMenu(db)));
  app.get("/api/status", (c) => c.json({ state: state(), status: status(), eta: eta() }));
  app.get("/api/offers", (c) => c.json(offers()));
  app.get("/api/events", (c) => c.json(events()));
  app.get("/api/zones", (c) => c.json(ZONES));
  app.get("/api/zones/check", (c) => c.json(zoneOfAddress(c.req.query("q") || "")));

  /* ---------- orders ---------- */
  app.post("/api/orders", async (c) => {
    const b = await body(c), u = await core.customers.bySession(getCookie(c, USER_COOKIE));
    return c.json(await core.orders.create({ ...b, channel: "web", userId: u ? u.id : null }), 201);
  });
  app.get("/api/orders/:no", async (c) => {
    const o = await core.orders.get(c.req.param("no"));
    if (!o) throw new CoreError("not_found", "Няма такава поръчка.", 404);
    /* public tracking view: no personal data */
    const { phone: _p, email: _e, name, addr: _a, ...pub } = o;
    return c.json({ ...pub, name: name.split(" ")[0] });
  });
  app.get("/api/admin/orders", async (c) => { await staff(c, "orders"); return c.json(await core.orders.list(c.req.query("status") ? { status: c.req.query("status") as OrderStatus } : {})); });
  app.patch("/api/admin/orders/:no", async (c) => {
    const s = await staff(c); const b = await body(c);
    return c.json(await core.orders.setStatus(c.req.param("no"), b.status, s.user.username));
  });

  /* ---------- reservations, celebrations, office, subscriptions ---------- */
  app.post("/api/reservations", async (c) => c.json(await core.reservations.create(await body(c)), 201));
  app.get("/api/reservations/taken", async (c) => c.json(await core.reservations.taken(c.req.query("date") || "", c.req.query("time") || "")));
  app.get("/api/admin/reservations", async (c) => { await staff(c, "reservations"); return c.json(await core.reservations.list()); });
  app.patch("/api/admin/reservations/:id", async (c) => { const s = await staff(c, "reservations"); const b = await body(c); return c.json(await core.reservations.setStatus(c.req.param("id"), b.status as ReservationStatus, s.user.username)); });
  app.post("/api/celebrations", async (c) => c.json(await core.celebrations.create(await body(c)), 201));
  app.post("/api/office", async (c) => c.json(await core.office.create(await body(c)), 201));
  app.get("/api/office/:code", async (c) => { const o = await core.office.get(c.req.param("code")); if (!o) throw new CoreError("not_found", "Тази обща поръчка не съществува.", 404); return c.json(o); });
  app.post("/api/office/:code/join", async (c) => c.json(await core.office.join(c.req.param("code"), await body(c))));
  app.post("/api/office/:code/submit", async (c) => c.json(await core.office.submit(c.req.param("code"), await body(c))));
  app.post("/api/subscribe", async (c) => { const b = await body(c); return c.json(await core.subscriptions.subscribe(b.email, b.consent), 201); });
  app.post("/api/ratings", async (c) => c.json(await core.ratings.submit(await body(c)), 201));

  /* ---------- customers: SMS sign-in (v1: the code is returned and shown on screen) ---------- */
  app.post("/api/auth/sms/request", async (c) => c.json(await core.customers.requestCode((await body(c)).phone)));
  app.post("/api/auth/sms/verify", async (c) => {
    const b = await body(c);
    const r = await core.customers.verifyCode(b.phone, b.code, { name: b.name, marketing: b.marketing });
    setCookie(c, USER_COOKIE, r.token, { ...cookieOpts, maxAge: 30 * 24 * 3600 });
    return c.json({ customer: r.customer, isNew: r.isNew });
  });
  app.post("/api/auth/sms/logout", async (c) => { const t = getCookie(c, USER_COOKIE); if (t) await core.customers.logout(t); deleteCookie(c, USER_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  app.get("/api/me", async (c) => c.json(await core.customers.bySession(getCookie(c, USER_COOKIE))));
  app.patch("/api/me", async (c) => { const u = await customer(c); return c.json(await core.customers.update(u.id, await body(c))); });
  app.delete("/api/me", async (c) => { const u = await customer(c); await core.customers.remove(u.id); deleteCookie(c, USER_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  app.get("/api/me/orders", async (c) => c.json(await core.customers.orders(await customer(c))));
  app.get("/api/me/export", async (c) => { const data = await core.customers.export(await customer(c)); c.header("Content-Disposition", 'attachment; filename="siracusa-moite-danni.json"'); return c.json(data); });
  app.post("/api/me/favorites", async (c) => { const u = await customer(c); return c.json(await core.customers.toggleFav(u.id, (await body(c)).id)); });
  app.post("/api/me/addresses", async (c) => { const u = await customer(c); return c.json(await core.customers.addAddress(u.id, await body(c))); });
  app.delete("/api/me/addresses/:id", async (c) => { const u = await customer(c); return c.json(await core.customers.removeAddress(u.id, c.req.param("id"))); });

  /* ---------- staff sign-in ---------- */
  app.post("/api/auth/login", async (c) => {
    const key = ip(c), f = fails.get(key);
    if (f && f.n >= 10 && f.until > Date.now()) throw new CoreError("throttled", "Твърде много опити. Опитайте след 15 минути.", 429);
    const b = await body(c);
    try {
      const r = await core.staff.login(b.username, b.password);
      fails.delete(key);
      setCookie(c, STAFF_COOKIE, r.token, { ...cookieOpts, maxAge: 12 * 3600 });
      return c.json({ user: r.user });
    } catch (e) {
      const cur = fails.get(key);
      fails.set(key, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw e;
    }
  });
  app.post("/api/auth/logout", async (c) => { const t = getCookie(c, STAFF_COOKIE); if (t) await core.staff.logout(t); deleteCookie(c, STAFF_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  app.get("/api/auth/me", async (c) => c.json(await core.staff.bySession(getCookie(c, STAFF_COOKIE))));

  /* ---------- admin ---------- */
  app.get("/api/admin/staff", async (c) => { await staff(c, "staff"); return c.json(await core.staff.list()); });
  app.get("/api/admin/roles", async (c) => { await staff(c); return c.json(await core.staff.roles()); });
  app.put("/api/admin/roles/:id", async (c) => { const s = await staff(c, "roles"); return c.json(await core.staff.setRole(c.req.param("id") as RoleId, (await body(c)).sections || [], s.user.username)); });
  app.get("/api/admin/notes", async (c) => { await staff(c, "notes"); return c.json(await core.notes.list({ status: c.req.query("status") as NoteStatus | undefined, module: c.req.query("module") })); });
  app.post("/api/admin/notes", async (c) => { const s = await staff(c, "notes"); return c.json(await core.notes.create(await body(c), s.user.username), 201); });
  app.patch("/api/admin/notes/:id", async (c) => { const s = await staff(c, "notes"); return c.json(await core.notes.setStatus(c.req.param("id"), (await body(c)).status, s.user.username)); });
  app.delete("/api/admin/notes/:id", async (c) => { const s = await staff(c, "notes"); await core.notes.remove(c.req.param("id"), s.user.username); return c.json({ ok: true }); });
  app.get("/api/admin/audit", async (c) => { await staff(c, "audit"); return c.json(await core.audit.list()); });

  /* ---------- real time ---------- */
  app.get("/api/stream", (c) => streamSSE(c, async (stream) => {
    const send = (type: string, data: unknown) => { stream.writeSSE({ event: type, data: JSON.stringify(data) }).catch(() => {}); };
    clients.add(send);
    stream.onAbort(() => { clients.delete(send); });
    await stream.writeSSE({ event: "hello", data: "{}" });
    while (!stream.aborted) { await stream.sleep(25_000); await stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {}); }
    clients.delete(send);
  }));
  app.all("/api/*", (c) => c.json({ error: "not_found", message: "Няма такъв адрес в API." }, 404));

  /* ---------- static files from dist/ ---------- */
  const file = (rel: string): string | null => {
    const p = path.resolve(dist, "." + rel);
    if (!p.startsWith(dist)) return null;
    try { const st = fs.statSync(p); if (st.isFile()) return p; if (st.isDirectory() && fs.existsSync(path.join(p, "index.html"))) return path.join(p, "index.html"); } catch { /* missing */ }
    return null;
  };
  const send = (c: Context, p: string, code = 200) => {
    const ext = path.extname(p);
    c.header("Content-Type", MIME[ext] || "application/octet-stream");
    c.header("Cache-Control", p.includes(`${path.sep}_astro${path.sep}`) ? "public, max-age=31536000, immutable" : ext === ".html" ? "no-cache" : "public, max-age=3600");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    return c.body(fs.readFileSync(p), code as 200);
  };
  app.get("*", (c) => {
    let rel = decodeURIComponent(new URL(c.req.url).pathname);
    /* /porachka/1042/ -> the one static tracking page (it reads the number from the address) */
    const tr = /^\/porachka\/[^/]+\/?$/.exec(rel);
    if (tr) { const p = file("/porachka/"); if (p) return send(c, p); }
    const p = file(rel);
    if (p) {
      if (!rel.endsWith("/") && !path.extname(rel) && p.endsWith("index.html")) return c.redirect(rel + "/", 301);
      return send(c, p);
    }
    const nf = file("/404.html");
    return nf ? send(c, nf, 404) : c.text("Not found", 404);
  });

  return { app, core, sqlite, db };
}
