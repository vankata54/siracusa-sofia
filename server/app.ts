/* The Node server: serves dist/ (the static Astro build) and the REST API /api/* + SSE /api/stream.
   Everything business-related goes through src/core (same code as the static demo). */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "@hono/node-server/conninfo";
import { openDb, seedMenu, readMenu } from "./db/index.ts";
import { SqliteRepo } from "./db/repo.ts";
import { webPushSender, type Vapid } from "./push.ts";
import { scryptHasher } from "./hasher.ts";
import { createCore, CoreError, officeDueAt, publicOrder, PUSH_MSG, rid, type Audience, type Core, type Ctx, type OfficeOrder, type RoleId, type NoteStatus, type OrderStatus, type ReservationStatus, type PushSender } from "../src/core/index.ts";
import { state, status, eta } from "../src/lib/status.ts";
import { offers } from "../src/lib/offers.ts";
import { eventsJson } from "../src/lib/events-json.ts";
import { parseTime, sofiaEpoch } from "../src/lib/time.ts";
import { publicSettings } from "../src/core/settings.ts";
import { normPhone } from "../src/lib/format.ts";
import { zoneOfAddress } from "../src/lib/zones.ts";
import { ZONES } from "../src/lib/data.ts";

export interface AppOpts {
  dbFile: string; distDir: string; secure?: boolean;
  /** tests only (SC_PREVIEW_API=1): the API follows the preview clock sent by the page (x-sc-clock) and the lunch menu counts as today's */
  previewApi?: boolean;
  /** the tracking address must carry the order key (default on; TRACK_KEY_REQUIRED=0 turns it off) */
  requireTrackKey?: boolean;
  /** no SMS provider yet: return the code as demoCode (SMS_DEMO=1, tests); otherwise 503 sms_unavailable */
  smsDemo?: boolean;
  /** behind our own reverse proxy: take the client's address from X-Forwarded-For (TRUST_PROXY=1); default off */
  trustProxy?: boolean;
  /** run the timers for the automatic office send (default true; off in unit tests) */
  timers?: boolean;
  /** Web Push: the VAPID keys from .env (server/push.ts vapidFromEnv); without them push is off. pushSender: tests only. */
  vapid?: Vapid | null;
  pushSender?: PushSender;
}

/* a real-time subscriber: staff (cookie) get everything; others only public events and the order / office they asked for */
interface Sub { send: (type: string, data: unknown) => void; staff: boolean; orders: Set<string>; offices: Set<string> }
export function mayReceive(s: Pick<Sub, "staff" | "orders" | "offices">, to: Audience): boolean {
  return s.staff || !!to.public || (!!to.order && s.orders.has(to.order)) || (!!to.office && s.offices.has(to.office));
}

/* compression for text responses (HTML, JS, CSS, SVG, JSON): brotli when the browser takes it, else gzip */
const COMPRESSIBLE = /^(text\/html|text\/javascript|text\/css|image\/svg\+xml|application\/json|application\/xml|text\/plain|application\/manifest\+json)/;
export function pickEncoding(accept: string | undefined): "br" | "gzip" | null {
  const a = String(accept || "").toLowerCase();
  return /\bbr\b/.test(a) ? "br" : /\bgzip\b/.test(a) ? "gzip" : null;
}
export function compressBuf(buf: Buffer, enc: "br" | "gzip"): Buffer {
  return enc === "br" ? zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }) : zlib.gzipSync(buf, { level: 9 });
}

const STAFF_COOKIE = "sc_staff", USER_COOKIE = "sc_user";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4",
};

export function createApp(opts: AppOpts) {
  const { sqlite, db } = openDb(opts.dbFile);
  seedMenu(db);
  const clients = new Set<Sub>();
  const ctx: Ctx = {
    repo: new SqliteRepo(sqlite), hasher: scryptHasher, requireTrackKey: opts.requireTrackKey !== false, smsDemo: !!opts.smsDemo, noLimits: !!opts.previewApi,
    emit: (type, data, to) => clients.forEach((s) => { if (mayReceive(s, to || {})) s.send(type, data); }),
    push: opts.pushSender || (opts.vapid ? webPushSender(opts.vapid) : undefined),
  };
  const core = createCore(ctx);
  void core.settings.get(); /* kitchen minutes and "Натоварено" into this process */
  /* preview core for one request (tests only): the page's clock, the lunch menu as today's */
  const coreFor = (c: Context): Core => {
    if (!opts.previewApi) return core;
    const t = c.req.header("x-sc-clock");
    return t && parseTime(t) ? createCore({ ...ctx, clock: t, preview: true }) : core;
  };
  const app = new Hono();
  const dist = path.resolve(opts.distDir);

  /* ---------- helpers ---------- */
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, secure: !!opts.secure, path: "/" };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { return {}; } };
  /** section: one section, or a list (any of them is enough) */
  async function staff(c: Context, section?: string | string[]) {
    const s = await core.staff.bySession(getCookie(c, STAFF_COOKIE));
    if (!s) throw new CoreError("auth", "Влезте отново.", 401);
    const need = section ? (Array.isArray(section) ? section : [section]) : [];
    if (need.length && !(s.user.role === "admin" || need.some((x) => s.sections.includes(x)))) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
    return s;
  }
  async function customer(c: Context) {
    const u = await core.customers.bySession(getCookie(c, USER_COOKIE));
    if (!u) throw new CoreError("auth", "Влезте с телефона си.", 401);
    return u;
  }
  /* login throttling: 10 failed attempts per IP per 15 min */
  const fails = new Map<string, { n: number; until: number }>();
  /* the client's address: X-Forwarded-For only behind our own proxy (TRUST_PROXY=1), else the socket's address
     (a header from the internet could be anything) */
  const ip = (c: Context): string => {
    if (opts.trustProxy) { const f = c.req.header("x-forwarded-for"); if (f) return f.split(",")[0].trim(); }
    let a = "";
    try { a = getConnInfo(c).remote.address || ""; } catch { /* no socket (tests, some runtimes) */ }
    /* no address at all: never one key for the whole site; the device cookie (or the phone in the phone keys) separates people */
    return a || "local:" + (getCookie(c, "sc_dev") || "anon");
  };

  app.onError((err, c) => {
    if (err instanceof CoreError) { const x = err as CoreError & { fields?: unknown; retryIn?: number }; return c.json({ error: err.code, message: err.message, fields: x.fields, ...(x.retryIn != null ? { retryIn: x.retryIn } : {}) }, err.status as 400); }
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
    /* compress JSON over 1 KB (the menu); never the SSE stream */
    const ct = c.res.headers.get("content-type") || "", enc = pickEncoding(c.req.header("accept-encoding"));
    if (enc && ct.startsWith("application/json") && !c.res.headers.get("content-encoding")) {
      const buf = Buffer.from(await c.res.clone().arrayBuffer());
      if (buf.length > 1024) {
        const h = new Headers(c.res.headers);
        h.set("Content-Encoding", enc); h.set("Vary", "Accept-Encoding"); h.delete("Content-Length");
        c.res = new Response(new Uint8Array(compressBuf(buf, enc)), { status: c.res.status, headers: h });
      }
    }
  });

  /* ---------- public data ---------- */
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.get("/api/menu", async (c) => c.json(readMenu(db, await core.menu.soldOutToday())));
  app.get("/api/status", async (c) => { const st = await core.settings.get(); return c.json({ state: state(), status: status(), eta: eta(), ...publicSettings(st) }); });
  app.get("/api/offers", (c) => c.json(offers()));
  app.get("/api/events", (c) => c.json(eventsJson()));
  app.get("/api/zones", (c) => c.json(ZONES));
  app.get("/api/zones/check", (c) => c.json(zoneOfAddress(c.req.query("q") || "")));

  /* ---------- orders ---------- */
  app.post("/api/orders", async (c) => {
    const b = await body(c), user = await core.customers.bySession(getCookie(c, USER_COOKIE));
    /* at most 20 orders per IP and 5 per phone in 10 min (off in the test mode); an order refused as invalid (422) does not count */
    const undos = [limit("ord-ip:" + ip(c), 20, 10, TRY_LATER(10))];
    const ph = normPhone(b && b.phone);
    if (ph) undos.push(limit("ord-phone:" + ph, 5, 10, "С този телефон вече има няколко поръчки за кратко време. Обадете ни се на 0894 36 55 77."));
    if (b && b.code) codeGate(c);
    return c.json(await counted(undos, () => coreFor(c).orders.create({ ...b, channel: "web", userId: user ? user.id : null })), 201);
  });
  /* public tracking: /api/orders/1042-k7f3m2pq (or the number alone for orders without a key, until TRACK_KEY_REQUIRED) */
  /* unknown number or wrong key: 200 {found:false} (an expected answer, no console error; it does not tell whether the
     number exists); api.orders.get() turns it into the usual ApiError 404 "not_found" */
  app.get("/api/orders/:id", async (c) => {
    const o = await core.orders.find(c.req.param("id"));
    return c.json(o ? await core.orders.track(c.req.param("id")) : { found: false });
  });
  /* a pre-order changed by the customer (only with the key in the address; core/orders.ts changeOrder): at most 20 per IP
     in 10 min; the answer is the public view, as for tracking */
  app.patch("/api/orders/:id", async (c) => {
    const b = await body(c);
    const undo = limit("ord-change:" + ip(c), 20, 10, TRY_LATER(10));
    return c.json(await counted([undo], async () => publicOrder(await coreFor(c).orders.change(c.req.param("id"), b), true)));
  });
  /* Web Push for one order (core/push.ts): the public key for the browser, subscribe / unsubscribe with the tracking key */
  app.get("/api/push/key", (c) => (opts.vapid || opts.pushSender ? c.json({ key: opts.vapid ? opts.vapid.publicKey : "test" }) : c.json({ error: "push_unavailable", message: PUSH_MSG.unavailable }, 503)));
  app.post("/api/push/subscribe", async (c) => {
    const b = await body(c);
    const undo = limit("push:" + ip(c), 20, 10, TRY_LATER(10));
    return c.json(await counted([undo], () => core.push.subscribe(String(b && b.order || ""), b && b.sub)), 201);
  });
  app.post("/api/push/unsubscribe", async (c) => { const b = await body(c); return c.json(await core.push.unsubscribe(String(b && b.order || ""), String(b && b.endpoint || ""))); });
  /* code checks: at most 30 per IP in 15 min (the codes are 10 digits, guessing must stay slow); the order itself also counts */
  const codeTries = new Map<string, { n: number; until: number }>();
  const codeGate = (c: Context) => {
    const k = ip(c), t = codeTries.get(k), now = Date.now();
    const n = t && t.until > now ? t.n + 1 : 1;
    codeTries.set(k, { n, until: t && t.until > now ? t.until : now + 15 * 60_000 });
    if (n > 30 && !opts.previewApi) throw new CoreError("throttled", "Твърде много опити с код. Опитайте след 15 минути.", 429);
  };
  /* an invalid code is an expected answer, not an HTTP error (no red line in the browser console):
     200 { valid: false, error: { code, message, fields } }; api.codes.check() turns it back into the same ApiError */
  app.post("/api/codes/check", async (c) => {
    codeGate(c);
    try { return c.json(await core.codes.check(String((await body(c)).code || ""))); }
    catch (e) {
      if (e instanceof CoreError && e.status === 422) return c.json({ valid: false, error: { code: e.code, message: e.message, fields: (e as CoreError & { fields?: unknown }).fields } });
      throw e;
    }
  });
  app.get("/api/admin/orders", async (c) => { await staff(c, "orders"); return c.json(await core.orders.list(c.req.query("status") ? { status: c.req.query("status") as OrderStatus } : {})); });
  app.patch("/api/admin/orders/:no", async (c) => {
    const s = await staff(c); const b = await body(c);
    return c.json(await core.orders.setStatus(c.req.param("no"), b.status, s.user.username));
  });

  /* ---------- settings: kitchen "Натоварено" + minutes, reservation length ---------- */
  app.get("/api/admin/settings", async (c) => { await staff(c); return c.json(await core.settings.get()); });
  /* "Изчерпано днес" (kitchen, menu, lunch menu): {out: true|false}; one source in the core, read by /api/menu and the order check */
  app.put("/api/admin/menu/:id/sold-out", async (c) => {
    const s = await staff(c, ["menu", "kitchen", "lunch"]);
    return c.json(await core.menu.setSoldOut(c.req.param("id"), (await body(c)).out as boolean, s.user.username));
  });
  app.patch("/api/admin/settings", async (c) => {
    const b = await body(c);
    const s = await staff(c, b.resMinutes != null ? "reservations" : "kitchen");
    if (b.resMinutes != null && b.kitchen) await staff(c, "kitchen");
    if ((b.celebrationPrice != null || b.earlyDays !== undefined) && !(s.user.role === "admin" || s.sections.includes("offers"))) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
    return c.json(await core.settings.update({ kitchen: b.kitchen, resMinutes: b.resMinutes, celebrationPrice: b.celebrationPrice, earlyDays: b.earlyDays }, s.user.username));
  });

  /* ---------- rate limits (off in the test mode SC_PREVIEW_API=1) ---------- */
  const hits = new Map<string, number[]>();
  /** at most `max` requests per `key` in `minutes`; 429 "throttled" with a text for people */
  /** returns undo(): a request refused for invalid data (422) gives its place back */
  const limit = (key: string, max: number, minutes: number, msg: string): (() => void) => {
    if (opts.previewApi) return () => {};
    const now = Date.now(), list = (hits.get(key) || []).filter((t) => t > now - minutes * 60_000);
    /* retryIn: the seconds until the oldest hit leaves the window (the page locks its button exactly that long) */
    if (list.length >= max) { hits.set(key, list); throw Object.assign(new CoreError("throttled", msg, 429), { retryIn: Math.max(1, Math.ceil((list[0] + minutes * 60_000 - now) / 1000)) }); }
    list.push(now); hits.set(key, list);
    return () => { const i = list.lastIndexOf(now); if (i > -1) list.splice(i, 1); };
  };
  /** run fn; when it fails with 422 (invalid data), the places taken in the limits are given back */
  const counted = async <T>(undos: (() => void)[], fn: () => Promise<T>): Promise<T> => {
    try { return await fn(); }
    catch (e) { if (e instanceof CoreError && e.status === 422) undos.forEach((u) => u()); throw e; }
  };
  const TRY_LATER = (m: number) => "Твърде много заявки за кратко време. Опитайте след " + m + " минути или ни се обадете на 0894 36 55 77.";

  /* ---------- reservations, celebrations, office, subscriptions ---------- */
  app.post("/api/reservations", async (c) => {
    const b = await body(c), ph = normPhone(b && b.phone);
    const u = [limit("res-ip:" + ip(c), 10, 10, TRY_LATER(10))];
    if (ph) u.push(limit("res-phone:" + ph, 5, 60, "За този телефон вече има няколко заявки за резервация. Обадете ни се на 0894 36 55 77 и ще помогнем."));
    return c.json(await counted(u, () => coreFor(c).reservations.create(b)), 201);
  });
  app.get("/api/reservations/taken", async (c) => c.json(await core.reservations.taken(c.req.query("date") || "", c.req.query("time") || "", c.req.query("except") || undefined, c.req.query("k") || undefined)));
  app.get("/api/reservations/:id", async (c) => c.json(await core.reservations.get(c.req.param("id"), c.req.query("k") || "")));
  app.post("/api/reservations/:id/cancel", async (c) => c.json(await coreFor(c).reservations.cancel(c.req.param("id"), String((await body(c)).key || ""))));
  app.get("/api/admin/reservations", async (c) => { await staff(c, "reservations"); return c.json(await core.reservations.list()); });
  app.patch("/api/admin/reservations/:id", async (c) => { const s = await staff(c, "reservations"); const b = await body(c); return c.json(await core.reservations.setStatus(c.req.param("id"), b.status as ReservationStatus, s.user.username)); });
  app.post("/api/celebrations", async (c) => { limit("celeb-ip:" + ip(c), 5, 10, TRY_LATER(10)); return c.json(await core.celebrations.create(await body(c)), 201); });
  app.post("/api/office", async (c) => { const o = await coreFor(c).office.create(await body(c)); schedule(o); return c.json(o, 201); });
  /* wrong office codes (unknown or not the organizer's): at most 20 per IP + device (cookie sc_dev) in 10 min, and 200 per
     IP whatever the cookie. Only wrong codes count, so colleagues behind one office IP are not blocked by one another;
     a device that is over the limit gets 429 for every office code (the answer never tells whether a code exists). */
  const DEV_COOKIE = "sc_dev";
  const officeMiss = new Map<string, number[]>();
  const recent = (k: string) => { const now = Date.now(), l = (officeMiss.get(k) || []).filter((t) => t > now - 10 * 60_000); officeMiss.set(k, l); return l; };
  const officeGate = (c: Context) => {
    let dev: string = getCookie(c, DEV_COOKIE) || "";
    if (!dev || !/^[0-9a-f]{16,32}$/.test(dev)) { dev = rid(12); setCookie(c, DEV_COOKIE, dev, { ...cookieOpts, maxAge: 365 * 24 * 3600 }); }
    const kIp = "ip:" + ip(c), kDev = "dev:" + ip(c) + ":" + dev;
    if (!opts.previewApi && (recent(kDev).length >= 20 || recent(kIp).length >= 200)) throw new CoreError("throttled", "Твърде много опити с грешна връзка. Опитайте след 10 минути.", 429);
    return () => { const now = Date.now(); recent(kDev).push(now); recent(kIp).push(now); };
  };
  const wrongCode = (e: unknown) => e instanceof CoreError && (e.code === "not_found" || e.code === "forbidden");
  app.get("/api/office/:code", async (c) => {
    const miss = officeGate(c);
    const o = await coreFor(c).office.get(c.req.param("code"), c.req.query("k") || null);
    if (!o) { miss(); throw new CoreError("not_found", "Тази обща поръчка не съществува.", 404); }
    return c.json(o);
  });
  app.post("/api/office/:code/join", async (c) => {
    const miss = officeGate(c);
    try { return c.json(await coreFor(c).office.join(c.req.param("code"), await body(c))); }
    catch (e) { if (wrongCode(e)) miss(); throw e; }
  });
  /* update / submit: an unknown code and someone else's code get the same 403 and count as wrong tries */
  app.post("/api/office/:code/update", async (c) => {
    const miss = officeGate(c), b = await body(c);
    try { return c.json(await core.office.update(c.req.param("code"), String(b.orgKey || ""), { name: b.name, phone: b.phone, pay: b.pay })); }
    catch (e) { if (wrongCode(e)) miss(); throw e; }
  });
  app.post("/api/office/:code/submit", async (c) => {
    const miss = officeGate(c);
    try { return c.json(await coreFor(c).office.submit(c.req.param("code"), await body(c))); }
    catch (e) { if (wrongCode(e)) miss(); throw e; }
  });
  app.post("/api/subscribe", async (c) => { limit("sub-ip:" + ip(c), 10, 10, TRY_LATER(10)); const b = await body(c); return c.json(await core.subscriptions.subscribe(b.email, b.consent, b.topics), 201); });
  app.post("/api/ratings", async (c) => c.json(await core.ratings.submit(await body(c)), 201));
  /* contact messages: at most 5 per IP in 10 min */
  const fbTries = new Map<string, number[]>();
  app.post("/api/feedback", async (c) => {
    const k = ip(c), now = Date.now(), list = (fbTries.get(k) || []).filter((t) => t > now - 10 * 60_000);
    if (list.length >= 5 && !opts.previewApi) throw new CoreError("throttled", "Изпратихте няколко съобщения току-що. Опитайте след 10 минути или ни се обадете на 0894 36 55 77.", 429);
    const r = await core.feedback.create(await body(c));
    list.push(now); fbTries.set(k, list);
    return c.json({ ok: true, id: r.id }, 201);
  });
  app.get("/api/admin/feedback", async (c) => { await staff(c, "customers"); return c.json(await core.feedback.list()); });

  /* ---------- customers: SMS sign-in (v1: the code is returned and shown on screen) ---------- */
  /* SMS codes: at most 10 requests per IP in 10 min (the core adds 30 s and 5 an hour per number) */
  const smsTries = new Map<string, number[]>();
  app.post("/api/auth/sms/request", async (c) => {
    const k = ip(c), now = Date.now(), list = (smsTries.get(k) || []).filter((t) => t > now - 10 * 60_000);
    if (list.length >= 10 && !opts.previewApi) throw new CoreError("throttled", "Твърде много опити. Опитайте след 10 минути.", 429);
    list.push(now); smsTries.set(k, list);
    return c.json(await core.customers.requestCode((await body(c)).phone));
  });
  app.post("/api/auth/sms/verify", async (c) => {
    const b = await body(c);
    const r = await core.customers.verifyCode(b.phone, b.code, { name: b.name, marketing: b.marketing });
    setCookie(c, USER_COOKIE, r.token, { ...cookieOpts, maxAge: 30 * 24 * 3600 });
    return c.json({ customer: await core.customers.view(r.customer), isNew: r.isNew });
  });
  app.post("/api/auth/sms/logout", async (c) => { const t = getCookie(c, USER_COOKIE); if (t) await core.customers.logout(t); deleteCookie(c, USER_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  /* the customer + profileBonus (an unused -10% the cart shows before the order); notify in the current shape */
  app.get("/api/me", async (c) => c.json(await core.customers.view(await core.customers.bySession(getCookie(c, USER_COOKIE)))));
  app.patch("/api/me", async (c) => { const u = await customer(c); return c.json(await core.customers.view(await core.customers.update(u.id, await body(c)))); });
  app.delete("/api/me", async (c) => { const u = await customer(c); await core.customers.remove(u.id); deleteCookie(c, USER_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  app.get("/api/me/orders", async (c) => c.json(await core.customers.orders(await customer(c))));
  app.get("/api/me/codes", async (c) => c.json(await core.customers.codes(await customer(c))));
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

  /* ---------- real time ----------
     /api/stream?order=1042-k7f3m2pq&office=173012: public events (reservations freed/taken, kitchen minutes) + only the
     events of these orders / office orders. Staff (cookie) get everything. Unknown keys are ignored. */
  app.get("/api/stream", async (c) => {
    const isStaff = !!(await core.staff.bySession(getCookie(c, STAFF_COOKIE)));
    const orders = new Set<string>(), offices = new Set<string>();
    for (const id of (c.req.query("order") || "").split(",").filter(Boolean).slice(0, 10)) { const o = await core.orders.find(id); if (o) orders.add(o.no); }
    for (const code of (c.req.query("office") || "").split(",").filter(Boolean).slice(0, 10)) { const o = await core.office.raw(code); if (o) offices.add(o.code); }
    return streamSSE(c, async (stream) => {
      const sub: Sub = { staff: isStaff, orders, offices, send: (type, data) => { stream.writeSSE({ event: type, data: JSON.stringify(data) }).catch(() => {}); } };
      clients.add(sub);
      stream.onAbort(() => { clients.delete(sub); });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ orders: [...orders], offices: [...offices] }) });
      while (!stream.aborted) { await stream.sleep(25_000); await stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {}); }
      clients.delete(sub);
    });
  });

  /* ---------- the office deadline: send without an open page (a timer per order + a sweep every minute) ---------- */
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sweep = () => core.office.sendDue().catch((e) => console.error("office auto-send", e));
  function schedule(o: OfficeOrder) {
    if (opts.timers === false || o.status !== "open") return;
    const ms = officeDueAt(o, sofiaEpoch) - Date.now() + 1000;
    clearTimeout(timers.get(o.code));
    if (ms < 0x7fffffff) timers.set(o.code, setTimeout(() => { timers.delete(o.code); sweep(); }, Math.max(0, ms)));
  }
  if (opts.timers !== false) {
    ctx.repo.list<OfficeOrder>("office_orders").then((all) => all.filter((o) => o.status === "open").forEach(schedule)).then(sweep);
    setInterval(sweep, 60_000).unref();
  }

  app.all("/api/*", (c) => c.json({ error: "not_found", message: "Няма такъв адрес в API." }, 404));

  /* ---------- static files from dist/ ---------- */
  const file = (rel: string): string | null => {
    const p = path.resolve(dist, "." + rel);
    if (!p.startsWith(dist)) return null;
    try { const st = fs.statSync(p); if (st.isFile()) return p; if (st.isDirectory() && fs.existsSync(path.join(p, "index.html"))) return path.join(p, "index.html"); } catch { /* missing */ }
    return null;
  };
  const zcache = new Map<string, { mtime: number; br?: Buffer; gzip?: Buffer }>();
  const send = (c: Context, p: string, code = 200) => {
    const ext = path.extname(p), type = MIME[ext] || "application/octet-stream";
    c.header("Content-Type", type);
    c.header("Cache-Control", p.includes(`${path.sep}_astro${path.sep}`) ? "public, max-age=31536000, immutable" : ext === ".html" ? "no-cache" : "public, max-age=3600");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    const st = fs.statSync(p), enc = COMPRESSIBLE.test(type) && st.size > 1024 ? pickEncoding(c.req.header("accept-encoding")) : null;
    if (COMPRESSIBLE.test(type)) c.header("Vary", "Accept-Encoding");
    if (!enc) return c.body(fs.readFileSync(p), code as 200);
    /* compressed once per file version, kept in memory (the build is a few MB) */
    let z = zcache.get(p);
    if (!z || z.mtime !== st.mtimeMs) { z = { mtime: st.mtimeMs }; zcache.set(p, z); }
    const buf = z[enc] || (z[enc] = compressBuf(fs.readFileSync(p), enc));
    c.header("Content-Encoding", enc);
    return c.body(new Uint8Array(buf), code as 200);
  };
  /* old dish addresses (cut ids) -> the new ones: the table comes from the build (scripts/build-checks.mjs, decision 12.11.2026) */
  let moved: Record<string, string> = {};
  try { moved = JSON.parse(fs.readFileSync(path.join(dist, "redirects.json"), "utf8")); } catch { /* no table: nothing moved */ }
  app.get("*", (c) => {
    const u = new URL(c.req.url);
    let rel = decodeURIComponent(u.pathname);
    const to = moved[rel.endsWith("/") ? rel : rel + "/"];
    if (to) return c.redirect(to + u.search, 301);
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

  return { app, core, sqlite, db, sweep };
}
