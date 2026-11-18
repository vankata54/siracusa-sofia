/* The Node server: serves dist/ (the static Astro build) and the REST API /api/* + SSE /api/stream.
   Everything business-related goes through src/core (same code as the static demo). */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { openDb, seedMenu } from "./db/index.ts";
import { menuRoutes } from "./routes/menu.ts";
import { ordersAdminRoutes } from "./routes/orders-admin.ts";
import { reservationsAdminRoutes } from "./routes/reservations-admin.ts";
import { hallRoutes } from "./routes/hall.ts";
import { zonesRoutes } from "./routes/zones.ts";
import { offersRoutes } from "./routes/offers.ts";
import { eventsRoutes } from "./routes/events.ts";
import { customersRoutes } from "./routes/customers.ts";
import { reportsRoutes } from "./routes/reports.ts";
import { staffAdminRoutes } from "./routes/staff-admin.ts";
import { kitchenRoutes } from "./routes/kitchen.ts";
import { floorRoutes, KNOWN_COOKIE, guestCookie } from "./routes/floor.ts";
import { siteRoutes as siteDataRoutes } from "./routes/site.ts";
import { driverRoutes } from "./routes/driver.ts";
import { bossRoutes } from "./routes/boss.ts";
import { createPublisher, astroBuild, buildHash, weeklyDue, type BuildFn, type Publisher } from "./publish.ts";
import type { SiteBuild } from "../src/core/site-data.ts";
import { SqliteRepo } from "./db/repo.ts";
import { webPushSender, type Vapid } from "./push.ts";
import { scryptHasher } from "./hasher.ts";
import { createCore, CoreError, homeOf, officeDueAt, publicOrder, PUSH_MSG, rid, type Audience, type Core, type Ctx, type OfficeOrder, type RoleId, type NoteStatus, type OrderStatus, type ReservationStatus, type PushSender } from "../src/core/index.ts";
import { state, status, eta } from "../src/lib/status.ts";
import { parseTime, sofiaEpoch } from "../src/lib/time.ts";
import { publicSettings, settingsAllowed } from "../src/core/settings.ts";
import { maskFeedback, maskList, serial } from "../src/core/rights.ts";
import { normPhone } from "../src/lib/format.ts";
import { zoneOfAddress } from "../src/lib/zones.ts";

export interface AppOpts {
  dbFile: string; distDir: string; secure?: boolean;
  /** tests only (SC_PREVIEW_API=1): the API follows the preview clock sent by the page (x-sc-clock) and the lunch menu counts as today's */
  previewApi?: boolean;
  /** the tracking address must carry the order key (default on; TRACK_KEY_REQUIRED=0 turns it off) */
  requireTrackKey?: boolean;
  /** no SMS provider yet: return the code as demoCode (SMS_DEMO=1, tests); otherwise 503 sms_unavailable */
  smsDemo?: boolean;
  /** behind our own reverse proxy: take the client's address from X-Forwarded-For (TRUST_PROXY=1); default off */
  trustProxy?: boolean | "cloudflare";
  /** tests: the site's pages for "Предложи подобрение" (else read from distDir) */
  routes?: string[];
  /** run the timers for the automatic office send (default true; off in unit tests) */
  timers?: boolean;
  /** Web Push: the VAPID keys from .env (server/push.ts vapidFromEnv); without them push is off. pushSender: tests only. */
  vapid?: Vapid | null;
  pushSender?: PushSender;
  /** the rebuild of the site after "Публикувай" of the menu (server/publish.ts): default `astro build` in this folder;
      tests pass their own function (no real build); null = no rebuild */
  build?: BuildFn | null;
  /** uploaded photos (default: data/media next to the database) */
  mediaDir?: string;
}

/* a real-time subscriber: staff (cookie) get everything; others only public events and the order / office they asked for */
interface Sub { send: (type: string, data: unknown) => void; staff: boolean; orders: Set<string>; offices: Set<string>;
  /** the table sessions (sittings) this subscriber is a guest of (core/floor.ts) */
  tables?: Set<string>;
  /** a staff member: the role and the sections (the hall's live events only for those who work in the hall) */
  role?: string; sections?: string[] }
/** the hall live (the guests' notes, calls, carts) is for the roles that work in the hall: the main admin, owner, manager and
    who has "Сервитьор", "Залата" or "Поръчки"; marketing, the kitchen and the driver do not get it (servitor.review-2, round 2) */
/** the events a driver's phone needs (review 2 of the driver): his own module, the statuses and new orders (a ready
    delivery), the menu and "Натоварено"; never the totals of the orders, the notes, the owner's answers, the shift */
const DRIVER_HEARS = /^(driver\.|order\.status$|order\.new$|menu\.|kitchen\.busy$|stream\.)/;
export function staffMayHear(s: Pick<Sub, "role" | "sections">, type?: string): boolean {
  if (s.role === "driver" && type && !DRIVER_HEARS.test(type)) return false;
  if (!type || !type.startsWith("floor.")) return true;
  return s.role === "admin" || s.role === "owner" || s.role === "manager" || !!s.sections && s.sections.some((x) => x === "waiter" || x === "hall" || x === "orders");
}
/** the owner's answers to the agency's questions (owner.answer, their notes) reach the office only: the main admin, the
    owner, the manager and the roles with "Бележки"; never the kitchen, the waiter or the driver (decision of the chief) */
export const officeHears = (s: Pick<Sub, "role" | "sections">): boolean => s.role === "admin" || s.role === "owner" || s.role === "manager" || (!!s.sections && s.sections.includes("notes"));
export function mayReceive(s: Pick<Sub, "staff" | "orders" | "offices" | "tables" | "role" | "sections">, to: Audience, type?: string): boolean {
  if (to.office_only) return s.staff && staffMayHear(s, type) && officeHears(s);
  return (s.staff && staffMayHear(s, type)) || !!to.public || (!!to.order && s.orders.has(to.order)) || (!!to.office && s.offices.has(to.office)) || (!!to.table && !!s.tables && s.tables.has(to.table));
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
/* the screens of the QR table: /masa/<код>/<екран>/ is answered with the static page /masa/<екран>/ */
const MASA_PAGES = ["menu", "kolichka", "povikvane", "smetka"];
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2",
  ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".webmanifest": "application/manifest+json", ".mp4": "video/mp4",
};

export function createApp(opts: AppOpts) {
  const { sqlite, db } = openDb(opts.dbFile);
  seedMenu(db);
  const clients = new Set<Sub>();
  const dataDir = opts.dbFile === ":memory:" ? path.resolve("data") : path.dirname(path.resolve(opts.dbFile));
  const mediaDir = path.resolve(opts.mediaDir || path.join(dataDir, "media"));
  /* the photos of the fuel receipts: apart from the public /media/, served only to the staff (server/routes/driver.ts) */
  const receiptsDir = path.join(path.dirname(mediaDir), "receipts");
  let publisher: Publisher | null = null;
  const ctx: Ctx = {
    repo: new SqliteRepo(sqlite), hasher: scryptHasher, requireTrackKey: opts.requireTrackKey !== false, smsDemo: !!opts.smsDemo, noLimits: !!opts.previewApi,
    emit: (type, data, to) => {
      clients.forEach((s) => { if (mayReceive(s, to || {}, type)) s.send(type, data); });
      /* a line of a table order changed in the kitchen (order.line goes to the staff): the guests of that sitting get
         floor.session with the new line states (core/floor.ts sessionTouched) */
      const sid = type === "order.line" && !(to && to.table) && data && typeof (data as { session?: unknown }).session === "string" ? (data as { session: string }).session : "";
      if (sid && [...clients].some((s) => s.tables && s.tables.has(sid))) void core.floor.touched(sid).catch((e) => console.error("floor touched", e));
    },
    push: opts.pushSender || (opts.vapid ? webPushSender(opts.vapid) : undefined),
    /* the live menu changed (publish, rollback, today's lunch menu): rebuild the site, one build at a time (with the site data) */
    onMenu: (m) => { if (publisher) void siteFor().then((site) => publisher!.enqueue(m, site)).catch((e) => console.error("site data", e)); },
    /* the site data changed (zones, hall, events, offers): the same queue, with the effective menu */
    onSite: (site) => { if (publisher) void core.menuEdit.effective().then((m) => publisher!.enqueue(m, site)).catch((e) => console.error("site data", e)); },
    mediaExists: (u) => { const m = /^\/media\/([a-f0-9]{64}\.(?:webp|jpg|png))$/.exec(u), r = /^\/api\/driver\/receipts\/([a-f0-9]{64}\.(?:webp|jpg|png))$/.exec(u); return m ? fs.existsSync(path.join(mediaDir, m[1])) : !!r && fs.existsSync(path.join(receiptsDir, r[1])); },
  };
  const core = createCore(ctx);
  /* the site data for a rebuild: null while nothing was changed (the build uses the built-in data, as `npm run build`) */
  const siteFor = async (): Promise<SiteBuild | null> => ((await core.site.version()) > 0 ? core.site.build() : null);
  const booted = core.menuEdit.boot(); /* the published menu into this process (src/lib/data.ts) */
  void core.settings.get(); /* kitchen minutes and "Натоварено" into this process */
  /* preview core for one request (tests only): the page's clock, the lunch menu as today's */
  const coreFor = (c: Context): Core => {
    if (!opts.previewApi) return core;
    const t = c.req.header("x-sc-clock");
    return t && parseTime(t) ? createCore({ ...ctx, clock: t, preview: true }) : core;
  };
  const app = new Hono();
  const dist = path.resolve(opts.distDir);
  /* the site's own pages (every folder of dist/ with an index.html, without the admin): "Предложи подобрение" accepts only these */
  /* read again when the build changes (a new build, "Публикувай" of the menu): keyed by the mtime of dist/index.html */
  let routesCache: { at: number; list: string[] } | null = null;
  const siteRoutes = (): string[] => {
    if (opts.routes) return opts.routes;
    let at = 0;
    try { at = fs.statSync(path.join(dist, "index.html")).mtimeMs; } catch { /* no build yet */ }
    if (routesCache && routesCache.at === at && at) return routesCache.list;
    const out: string[] = [];
    const STAFF_DIRS = ["admin", "servitor", "kuhnya", "shofyor", "masa"];
    const walk = (dir: string, rel: string) => {
      let list: fs.Dirent[] = [];
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      if (list.some((e) => e.isFile() && e.name === "index.html")) out.push(rel + "/");
      for (const e of list) if (e.isDirectory() && !e.name.startsWith("_") && !(rel === "" && STAFF_DIRS.includes(e.name))) walk(path.join(dir, e.name), rel + "/" + e.name);
    };
    walk(dist, "");
    routesCache = { at, list: out };
    return out;
  };
  /* ---------- helpers ---------- */
  const cookieOpts = { httpOnly: true, sameSite: "Lax" as const, secure: !!opts.secure, path: "/" };
  const body = async (c: Context) => { try { return await c.req.json(); } catch { return {}; } };
  /** section: one section, or a list (any of them is enough); adminOnly: the role admin only. The check is in the core
      (staff.guard), the same one the demo uses. */
  const staff = (c: Context, section?: string | string[], adminOnly = false) => core.staff.guard(getCookie(c, STAFF_COOKIE), section, adminOnly);
  async function customer(c: Context) {
    const u = await core.customers.bySession(getCookie(c, USER_COOKIE));
    if (!u) throw new CoreError("auth", "Влезте с телефона си.", 401);
    return u;
  }
  /* the client's address: X-Forwarded-For only behind our own proxy (TRUST_PROXY=1), else the socket's address
     (a header from the internet could be anything) */
  const ip = (c: Context): string => {
    /* behind our own proxy the real address is the LAST one in X-Forwarded-For (nginx $proxy_add_x_forwarded_for adds it
       on the right; the left ones the client can write himself); behind Cloudflare: CF-Connecting-IP (TRUST_PROXY=cloudflare) */
    if (opts.trustProxy === "cloudflare") { const cf = c.req.header("cf-connecting-ip"); if (cf) return cf.trim(); }
    if (opts.trustProxy) { const f = c.req.header("x-forwarded-for"); if (f) { const l = f.split(",").map((x) => x.trim()).filter(Boolean); if (l.length) return l[l.length - 1]; } }
    let a = "";
    try { a = getConnInfo(c).remote.address || ""; } catch { /* no socket (tests, some runtimes) */ }
    /* no address at all: never one key for the whole site; the device cookie (or the phone in the phone keys) separates people */
    return a || "local:" + (getCookie(c, "sc_dev") || "anon");
  };

  app.onError((err, c) => {
    if (err instanceof CoreError) {
      const x = err as CoreError & { fields?: unknown; retryIn?: number; left?: number; lines?: string[]; pinSet?: boolean; version?: number };
      return c.json({ error: err.code, message: err.message, fields: x.fields, ...(x.retryIn != null ? { retryIn: x.retryIn } : {}), ...(x.left != null ? { left: x.left } : {}),
        ...(x.lines ? { lines: x.lines } : {}), ...(x.pinSet != null ? { pinSet: x.pinSet } : {}), ...(x.version != null ? { version: x.version } : {}) }, err.status as 400);
    }
    console.error(err);
    return c.json({ error: "server", message: "Нещо се обърка. Опитайте пак." }, 500);
  });

  /* CSRF: state-changing API calls must come from our own origin (SameSite=Lax cookies cover the rest) */
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      let host = "";
      try { host = origin ? new URL(origin).host : ""; } catch { host = "?"; }
      if (origin && host !== c.req.header("host")) return c.json({ error: "origin", message: "Забранен адрес." }, 403);
      /* body size: 2 MB for a note with a screenshot, 64 KB for everything else (never a 2 MB password through scrypt) */
      /* a photo of the menu up to 5 MB, the whole draft of the menu up to 2 MB */
      const max = c.req.path === "/api/admin/media" || c.req.path === "/api/driver/receipt" ? 5 * 1024 * 1024 + 1024 : /^\/api\/admin\/(notes|menu\/draft)/.test(c.req.path) ? 2_100_000 : 65_536, len = +(c.req.header("content-length") || 0);
      if (len > max) return c.json({ error: "too_large", message: "Заявката е твърде голяма." }, 413);
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

  /* the real size of the body as it is read (also with Transfer-Encoding: chunked, where there is no Content-Length):
     2 MB for a note with a screenshot, 5 MB for a photo of the menu, 64 KB for everything else */
  const tooLarge = (c: Context) => c.json({ error: "too_large", message: "Заявката е твърде голяма." }, 413);
  const LIMITS = { small: bodyLimit({ maxSize: 65_536, onError: tooLarge }), notes: bodyLimit({ maxSize: 2_100_000, onError: tooLarge }), media: bodyLimit({ maxSize: 5_300_000, onError: tooLarge }) };
  app.use("/api/*", (c, next) => (["GET", "HEAD", "OPTIONS"].includes(c.req.method) ? next() : (/^\/api\/admin\/(notes|menu\/draft)/.test(c.req.path) ? LIMITS.notes : /^\/api\/(admin\/media|driver\/receipt)/.test(c.req.path) ? LIMITS.media : LIMITS.small)(c, next)));

  /* ---------- public data ---------- */
  app.get("/api/health", (c) => c.json({ ok: true }));
  /* the live menu from the core (published in the admin, else the built-in one) with today's "Изчерпано днес" */
  app.get("/api/menu", async (c) => c.json(await core.menuEdit.site()));
  app.get("/api/status", async (c) => { const st = await core.settings.get(); return c.json({ state: state(), status: status(), eta: eta(), ...publicSettings(st) }); });
  /* the offers, events and zones from the admin's live data (core/site-data.ts): at once, before the rebuild of the site */
  app.get("/api/offers", async (c) => c.json(await coreFor(c).offersAdmin.public()));
  app.get("/api/events", async (c) => c.json(await core.eventsAdmin.public()));
  app.get("/api/zones", async (c) => c.json(await core.zones.public()));
  app.get("/api/zones/check", async (c) => {
    const r = zoneOfAddress(c.req.query("q") || ""), live = await core.zones.public(), z = (x: { slug: string }) => live.find((l) => l.slug === x.slug) || x;
    return c.json(r.type === "zone" ? { ...r, zone: z(r.zone) } : r.type === "ask" ? { ...r, opts: r.opts.map(z) } : r);
  });

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
  /* without the keys: 200 {key: null} (an expected answer, no error in the console); the page keeps its own notification */
  app.get("/api/push/key", (c) => c.json({ key: opts.vapid ? opts.vapid.publicKey : opts.pushSender ? "test" : null }));
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
  /* the raw list (the screens use /api/admin/orders/list): the phone masked, no tracking key */
  app.get("/api/admin/orders", async (c) => { await staff(c, "orders"); return c.json(maskList(await core.orders.list(c.req.query("status") ? { status: c.req.query("status") as OrderStatus } : {}))); });
  /* the status by section and step (core/orders.ts stepAllowed): "Поръчки" one step, the kitchen and the driver their own */
  /* {status, reason}: "Отказана" needs a reason here too (the customer sees it), the same as /cancel */
  app.patch("/api/admin/orders/:no", async (c) => {
    const s = await staff(c, ["orders", "kitchen", "driver"]), b = await body(c);
    if (b.status === "cancelled" && !(typeof b.reason === "string" && b.reason.trim())) throw Object.assign(new CoreError("invalid", "Напишете причината за отказа.", 422), { fields: { reason: "Напишете причината за отказа." } });
    /* under the order's lock, like the kitchen, the hall and the driver (core/rights.ts serial "order:<№>") */
    const no = c.req.param("no");
    return c.json(await serial(core.ctx.repo, "order:" + no, () => core.orders.setStatus(no, b.status as OrderStatus, s.user.username, s, typeof b.reason === "string" ? b.reason : undefined)));
  });

  /* ---------- settings: kitchen "Натоварено" + minutes, reservation length ---------- */
  app.get("/api/admin/settings", async (c) => { await staff(c); return c.json(await core.settings.view()); });
  /* "Изчерпано днес" (kitchen, menu, lunch menu): {out: true|false}; one source in the core, read by /api/menu and the order check */
  app.put("/api/admin/menu/:id/sold-out", async (c) => {
    const s = await staff(c, ["menu", "kitchen", "lunch"]);
    /* the menu's dishes go the kitchen's way (the lines of the accepted orders are marked too), the lunch dishes only switch */
    return c.json(await core.kitchen.adminSetOut(s, c.req.param("id"), (await body(c)).out as boolean));
  });
  app.patch("/api/admin/settings", async (c) => {
    const b = await body(c);
    /* who may change what: core/settings.ts settingsNeed (the same check in the demo) */
    const s = await staff(c);
    settingsAllowed(s, b);
    return c.json(await core.settings.update({ kitchen: b.kitchen, resMinutes: b.resMinutes, celebrationPrice: b.celebrationPrice, earlyDays: b.earlyDays, noShowLimit: b.noShowLimit, callCooldown: b.callCooldown, callManager: b.callManager, qrManager: b.qrManager }, s.user.username));
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
  /* the raw list (the screens use /api/admin/reservations/day): the phone masked, no key; the status by the admin's rules */
  app.get("/api/admin/reservations", async (c) => { await staff(c, "reservations"); return c.json(maskList(await core.reservations.list())); });
  app.patch("/api/admin/reservations/:id", async (c) => { const s = await staff(c); const b = await body(c); return c.json(await core.resAdmin.setStatus(s, c.req.param("id"), b.status as ReservationStatus)); });
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
  /* the contact masked as in every list of the admin (the whole one: POST /api/admin/messages/:id/contact, into the log) */
  app.get("/api/admin/feedback", async (c) => { await staff(c, "customers"); return c.json(maskFeedback(await core.feedback.list())); });

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
  /* the lockout (10 wrong per username and per address, 15 min) is in the core (staff.ts), the same in the demo */
  app.post("/api/auth/login", async (c) => {
    const b = await body(c);
    /* a right password makes this device known (a long-lived httpOnly cookie): only there the personal PIN works */
    let dev: string = getCookie(c, KNOWN_COOKIE) || "";
    if (!/^[0-9a-f]{48}$/.test(dev)) dev = rid(24);
    const r = await core.staff.login(b.username, b.password, ip(c), dev);
    setCookie(c, STAFF_COOKIE, r.token, { ...cookieOpts, maxAge: 12 * 3600 });
    setCookie(c, KNOWN_COOKIE, dev, { ...cookieOpts, maxAge: 400 * 24 * 3600 });
    return c.json({ user: r.user, home: r.home });
  });
  app.post("/api/auth/logout", async (c) => { const t = getCookie(c, STAFF_COOKIE); if (t) await core.staff.logout(t); deleteCookie(c, STAFF_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  app.get("/api/auth/me", async (c) => { const s = await core.staff.bySession(getCookie(c, STAFF_COOKIE)); return c.json(s ? { ...s, home: homeOf(s.user.role) } : null); });

  /* ---------- admin ---------- */
  app.get("/api/admin/staff", async (c) => { await staff(c, "staff"); return c.json(await core.staff.list()); });
  app.get("/api/admin/roles", async (c) => { await staff(c); return c.json(await core.staff.roles()); });
  /* the role x section matrix: only the main admin changes it (decision 15.11.2026); "Роли и права" lets others look */
  app.put("/api/admin/roles/:id", async (c) => { const s = await staff(c, "roles", true); return c.json(await core.staff.setRole(c.req.param("id") as RoleId, (await body(c)).sections || [], s.user.username)); });
  /* the dashboard: "Чака те", "Днес" (and "Днес: X € от N поръчки" for the owner and the main admin), the badges */
  app.get("/api/admin/summary", async (c) => c.json(await core.admin.summary(await staff(c))));
  app.get("/api/admin/search", async (c) => c.json(await core.admin.search(await staff(c), c.req.query("q") || "")));
  /* notes: every staff member writes recommendations and sees his own; the section "Бележки" sees all;
     the status (approve, run, publish, reject), delete and restore are for the role admin only */
  app.get("/api/admin/notes", async (c) => {
    await staff(c, "notes");
    const st = c.req.query("status") as NoteStatus | undefined;
    const kind = c.req.query("kind"); /* "answer": "Отговори на въпроси" (the owner's answers), "note": the rest */
    return c.json(st === "approved" ? await core.notes.approved() : await core.notes.list({ status: st, module: c.req.query("module"), source: c.req.query("source"), kind: kind === "answer" || kind === "note" ? kind : undefined }));
  });
  app.get("/api/admin/notes/mine", async (c) => c.json(await core.notes.mine(await staff(c))));
  app.get("/api/admin/notes/waiting", async (c) => c.json(await core.notes.waiting(await staff(c))));
  app.post("/api/admin/notes/seen", async (c) => c.json(await core.notes.seen(await staff(c))));
  /* docs/NOTES.json: the approved ones only (what the next session works on) */
  app.get("/api/admin/notes/export", async (c) => { await staff(c, "notes"); c.header("Content-Disposition", 'attachment; filename="NOTES.json"'); return c.json(await core.notes.approved()); });
  app.post("/api/admin/notes", async (c) => { const s = await staff(c); return c.json(await core.notes.create(await body(c), s), 201); });
  app.patch("/api/admin/notes/:id", async (c) => { const s = await staff(c, undefined, true); const b = await body(c); return c.json(await core.notes.setStatus(c.req.param("id"), b.status, s.user.username, { reason: b.reason, change: b.change, who: s.user.name, fix: b.fix })); });
  app.delete("/api/admin/notes/:id", async (c) => { const s = await staff(c, undefined, true); return c.json({ ok: true, note: await core.notes.remove(c.req.param("id"), s.user.username) }); });
  app.post("/api/admin/notes/restore", async (c) => { const s = await staff(c, undefined, true); return c.json(await core.notes.restore((await body(c)).note, s.user.username), 201); });
  /* "Предложи подобрение" on the site: no sign-in; only addresses of the site's own pages; personal data filtered in the
     core; at most 3 an hour per device (cookie sc_dev) and per IP (behind a proxy TRUST_PROXY=1 is a must) */
  app.post("/api/notes/suggest", async (c) => {
    let dev: string = getCookie(c, "sc_dev") || "";
    if (!/^[0-9a-f]{16,32}$/.test(dev)) { dev = rid(12); setCookie(c, "sc_dev", dev, { ...cookieOpts, maxAge: 365 * 24 * 3600 }); }
    const msg = "Благодарим! Вече получихме няколко предложения от вас. Можете да пишете пак след час.";
    const undos = [limit("sug-ip:" + ip(c), 3, 60, msg), limit("sug-dev:" + dev, 3, 60, msg)];
    return c.json(await counted(undos, async () => core.notes.suggest(await body(c), siteRoutes())), 201);
  });
  app.get("/api/admin/audit", async (c) => {
    await staff(c, "audit");
    const q = (k: string) => c.req.query(k) || undefined;
    return c.json(await core.audit.list({ limit: q("limit") ? +q("limit")! : undefined, before: q("before"), from: q("from"), to: q("to"), who: q("who"), action: q("action"), q: q("q") }));
  });

  /* ---------- real time ----------
     /api/stream?order=1042-k7f3m2pq&office=173012: public events (reservations freed/taken, kitchen minutes) + only the
     events of these orders / office orders. Staff (cookie) get everything. Unknown keys are ignored. */
  app.get("/api/stream", async (c) => {
    const me = await core.staff.bySession(getCookie(c, STAFF_COOKIE)), isStaff = !!me;
    const orders = new Set<string>(), offices = new Set<string>();
    for (const id of (c.req.query("order") || "").split(",").filter(Boolean).slice(0, 10)) { const o = await core.orders.find(id); if (o) orders.add(o.no); }
    for (const code of (c.req.query("office") || "").split(",").filter(Boolean).slice(0, 10)) { const o = await core.office.raw(code); if (o) offices.add(o.code); }
    /* ?table=<the table's code>: the sitting this phone is a guest of (core/floor-guest.ts). The phone's token comes only
       from its httpOnly cookie for this table (server/routes/floor.ts guestCookie), never from the address: a token in
       the address would stay in the access log of the proxy */
    const tables = new Set<string>(), tCode = /^[a-z2-9]{8}$/.test(c.req.query("table") || "") ? (c.req.query("table") as string) : "", tGuest = tCode ? getCookie(c, guestCookie(tCode)) || "" : "";
    const seat = async () => { const sid = tCode && tGuest ? await core.floor.stream(tCode, tGuest) : null; tables.clear(); if (sid) tables.add(sid); };
    await seat();
    return streamSSE(c, async (stream) => {
      const sub: Sub = { staff: isStaff, role: me ? me.user.role : undefined, sections: me ? me.sections : undefined, orders, offices, tables, send: (type, data) => { stream.writeSSE({ event: type, data: JSON.stringify(data) }).catch(() => {}); } };
      clients.add(sub);
      stream.onAbort(() => { clients.delete(sub); });
      await stream.writeSSE({ event: "hello", data: JSON.stringify({ orders: [...orders], offices: [...offices], tables: [...tables] }) });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        /* the staff session can end (sign-out, 12 h): from then on only public events and the own orders */
        /* the session may have ended, or its rights changed in "Роли и права": the next events follow the current ones */
        if (sub.staff) { const now = await core.staff.bySession(getCookie(c, STAFF_COOKIE)); if (!now) sub.staff = false; else { sub.role = now.user.role; sub.sections = now.sections; } }
        /* the sitting can end and a new one open at the same table while the page stays open */
        if (tCode) await seat().catch(() => {});
        await stream.writeSSE({ event: "ping", data: "{}" }).catch(() => {});
      }
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

  /* the menu editor, photos, the lunch menu (server/routes/menu.ts) */
  menuRoutes(app, { core, staff, body, cookieOpts, mediaDir, publisher: (publisher = makePublisher()),
    rebuild: async () => { if (publisher) { const [m, site] = await Promise.all([core.menuEdit.effective(), siteFor()]); publisher.enqueue(m, site); } } });
  /* the admin, part 3 (server/routes/*.ts): the rights are in the core, a route passes the signed-in staff member */
  const adm = { core, staff: (c: Context) => staff(c), body, coreFor };
  ordersAdminRoutes(app, adm);
  reservationsAdminRoutes(app, adm);
  hallRoutes(app, adm);
  zonesRoutes(app, adm);
  offersRoutes(app, adm);
  eventsRoutes(app, adm);
  customersRoutes(app, adm);
  reportsRoutes(app, adm);
  staffAdminRoutes(app, adm);
  siteDataRoutes(app, { ...adm, publisher: () => publisher });
  /* stage D, the kitchen (server/routes/kitchen.ts) */
  kitchenRoutes(app, adm);
  /* the driver (core/driver.ts): the shift, the deliveries, fuel (+ the photo of a receipt), the manager's views */
  driverRoutes(app, { ...adm, mediaDir, receiptsDir });
  /* stage D: the hall live, the waiter's search, the PIN on a known device (server/routes/floor.ts) */
  floorRoutes(app, { ...adm, limit, ip, cookieOpts });
  /* stage D, step 6: the manager's and the owner's modules (server/routes/boss.ts; core/shift.ts, core/owner.ts) */
  bossRoutes(app, adm);

  app.all("/api/*", (c) => c.json({ error: "not_found", message: "Няма такъв адрес в API." }, 404));

  /* ---------- static files from dist/ ---------- */
  /* the folder the site is served from: <dist>; for the moment between the renames of a rebuild (server/publish.ts) <dist>
     is missing and <dist>-prev has a whole site (the old one, or the one "Върни" brings back): no 404 in between */
  const prevDir = dist + "-prev";
  const root = (): string => (fs.existsSync(path.join(dist, "index.html")) || !fs.existsSync(path.join(prevDir, "index.html")) ? dist : prevDir);
  const file = (rel: string): string | null => {
    const r = root(), p = path.resolve(r, "." + rel);
    if (!(p === r || p.startsWith(r + path.sep)) || /\/\./.test(rel)) return null; /* never a dot file (.menu-hash of the rebuild) */
    try { const st = fs.statSync(p); if (st.isFile()) return p; if (st.isDirectory() && fs.existsSync(path.join(p, "index.html"))) return path.join(p, "index.html"); } catch { /* missing */ }
    /* a page opened just before a rebuild still asks for the scripts and styles of its own build: those (hashed, never
       changed) come from the previous build until the page is opened again */
    if (rel.startsWith("/_astro/") && r === dist) {
      const q = path.resolve(prevDir, "." + rel);
      if (q.startsWith(prevDir + path.sep)) { try { if (fs.statSync(q).isFile()) return q; } catch { /* missing */ } }
    }
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
    if (!z || z.mtime !== st.mtimeMs + st.size) { z = { mtime: st.mtimeMs + st.size }; zcache.set(p, z); }
    const buf = z[enc] || (z[enc] = compressBuf(fs.readFileSync(p), enc));
    c.header("Content-Encoding", enc);
    return c.body(new Uint8Array(buf), code as 200);
  };
  /* old dish addresses (cut ids) -> the new ones: the table comes from the build (scripts/build-checks.mjs, decision 12.11.2026) */
  /* read again after a rebuild of the menu (server/publish.ts onSwap): removed dishes -> their category (decision 15.11.2026) */
  let moved: Record<string, string> = {};
  const loadMoved = () => { try { moved = JSON.parse(fs.readFileSync(path.join(dist, "redirects.json"), "utf8")); } catch { moved = {}; /* no table: nothing moved */ } };
  loadMoved();
  app.get("*", (c) => {
    const u = new URL(c.req.url);
    let rel = decodeURIComponent(u.pathname);
    const to = moved[rel.endsWith("/") ? rel : rel + "/"];
    if (to) return c.redirect(to + u.search, 301);
    /* /porachka/1042/ -> the one static tracking page (it reads the number from the address) */
    const tr = /^\/porachka\/[^/]+\/?$/.exec(rel);
    if (tr) { const p = file("/porachka/"); if (p) return send(c, p); }
    /* /masa/<код>/ (the QR label of a table, core/hall.ts) -> the one QR table page, when the build has it (etap D) */
    /* /masa/<код>/<екран>/ -> the page of that screen (src/modules/routes.ts MASA_SCREENS); a screen's own folder is not a code */
    const ms = /^\/masa\/([a-z2-9]{8})(?:\/(menu|kolichka|povikvane|smetka))?\/?$/.exec(rel);
    if (ms && !MASA_PAGES.includes(ms[1])) { const p = file("/masa/" + (ms[2] ? ms[2] + "/" : "")); if (p) return send(c, p); }
    const p = file(rel);
    if (p) {
      if (!rel.endsWith("/") && !path.extname(rel) && p.endsWith("index.html")) return c.redirect(rel + "/", 301);
      return send(c, p);
    }
    const nf = file("/404.html");
    return nf ? send(c, nf, 404) : c.text("Not found", 404);
  });

  /* the rebuild queue (server/publish.ts); a new dist: the 301 table, the site's pages and the compressed files again */
  function makePublisher(): Publisher | null {
    const build = opts.build === null ? null : opts.build || (process.env.VITEST ? null : astroBuild(process.cwd()));
    if (!build) return null;
    return createPublisher({ distDir: opts.distDir, dataDir, build, onSwap: () => { loadMoved(); routesCache = null; zcache.clear(); } });
  }
  /* a published menu that the site on disk was not built with (e.g. a fresh `npm run build` after a deploy): rebuild once */
  void booted.then(async () => {
    await core.site.boot();
    if (!publisher) return;
    const live = await core.menuEdit.live(), eff = await core.menuEdit.effective(), site = await siteFor();
    if ((live.version > 0 || eff.lunch.date !== live.menu.lunch.date || site) && publisher.builtHash() !== buildHash(eff, site)) publisher.enqueue(eff, site);
  }).catch((e) => console.error("menu boot", e));
  /* today's published lunch menu starts at midnight (Sofia): checked every 5 minutes, the site rebuilds when it changed */
  if (opts.timers !== false) setInterval(() => { core.menuEdit.refresh("tick").catch((e) => console.error("menu refresh", e)); }, 5 * 60_000).unref();
  /* the weekly rebuild (server/publish.ts weeklyDue): a site older than a week is built again between 04:00 and 05:00 in
     Sofia with the live menu and site data (the dates of the events in the pages come from the build); checked every 20 min */
  const weekly = async (at = new Date()): Promise<boolean> => {
    if (!publisher || !weeklyDue(at, publisher.builtAt())) return false;
    const st = publisher.state();
    if (st.state === "building" || st.state === "queued" || st.waiting) return false;
    const [m, site] = await Promise.all([core.menuEdit.effective(), siteFor()]);
    await core.audit.log("system", "site.weekly");
    publisher.enqueue(m, site, true);
    return true;
  };
  if (opts.timers !== false) setInterval(() => { weekly().catch((e) => console.error("weekly rebuild", e)); }, 20 * 60_000).unref();
  /* "Изтрий" of a customer (GDPR): deleted for good once the window for "Отмени" has passed (core/customers-admin.ts) */
  if (opts.timers !== false) setInterval(() => { core.customersAdmin.purge().catch((e) => console.error("customers purge", e)); }, 5_000).unref();

  return { app, core, sqlite, db, sweep, weekly, publisher: () => publisher };
}
