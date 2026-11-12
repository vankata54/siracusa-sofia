/* One client for every screen. Server build: fetch("/api/...") + EventSource("/api/stream").
   Demo build (DEMO=1, <html data-demo="1">, static files, no server): the same core runs in the browser on localStorage
   (src/client/api-demo.ts, loaded only in the demo build) and real-time events go through BroadcastChannel between tabs.
   Same method names, same results, same error codes and texts.
   SIZE: this file must not import the core or the menu (they would ship to every page with the API). Only types here.

   Secrets kept in this browser (localStorage "sc-keys") and added to the calls by this file, so the pages do not handle them:
   - the order key (tracking address /porachka/<no>-<key>/), from orders.create;
   - the office organizer token (orgKey) from office.create / office.get(code, orgKey), and the colleague's pid from office.join;
   - the reservation key from reservations.create (get / cancel). */
import type { Core, OrderInput, ReservationInput, CelebrationInput, NoteInput, ProfilePatch, NoteStatus, OrderStatus, ReservationStatus, OfficeParticipant, Customer,
  Order, PublicOrder, OfficeOrder, PublicOffice, Reservation, Subscription, Settings, Audience, Feedback, FeedbackInput } from "./api-types.ts";
import type { SettingsPatch } from "../core/settings.ts";
import type { SiteEventJson } from "../lib/events.ts";
import type { Menu } from "../data/menu.ts";
import { clockOverride, isPreview } from "../lib/time.ts";
import { loadModule } from "../lib/load.ts";

/* the demo core exists only in the demo build (Vite drops the import from the server build) */
const BUILD_DEMO: boolean = typeof __DEMO__ !== "undefined" && __DEMO__;
export const DEMO = BUILD_DEMO && typeof document !== "undefined" && document.documentElement.dataset.demo === "1";

export class ApiError extends Error {
  code: string; status: number; fields?: Record<string, string>;
  /** seconds to wait ("too_soon": a new SMS code) */
  retryIn?: number;
  constructor(code: string, message: string, status = 400, fields?: Record<string, string>, retryIn?: number) { super(message); this.code = code; this.status = status; this.fields = fields; if (retryIn != null) this.retryIn = retryIn; }
}

/* ---------- keys kept in this browser ---------- */
interface Keys { orders: Record<string, string>; org: Record<string, string>; pid: Record<string, string>; res: Record<string, string> }
function keys(): Keys {
  try { const k = JSON.parse(localStorage.getItem("sc-keys") || "{}"); return { orders: k.orders || {}, org: k.org || {}, pid: k.pid || {}, res: k.res || {} }; }
  catch { return { orders: {}, org: {}, pid: {}, res: {} }; }
}
function remember(kind: keyof Keys, id: string, v: string | undefined | null) {
  if (!id || !v) return;
  try { const k = keys(); k[kind][id] = v; localStorage.setItem("sc-keys", JSON.stringify(k)); } catch { /* private mode */ }
}
/** "1042" -> "1042-k7f3m2pq" when this browser knows the key */
export function trackId(no: string | number): string {
  const s = String(no);
  if (s.includes("-")) return s;
  const k = keys().orders[s];
  return k ? s + "-" + k : s;
}

/* ---------- real-time bus: subscription by key ---------- */
type Fn = (data: unknown, type: string) => void;
const subs = new Map<string, Set<Fn>>();
const watching = { orders: new Set<string>(), offices: new Set<string>() };
/** delivers an event to this page's listeners if the page may see it (public, its order, its office order, or staff) */
export function busFire(type: string, data: unknown, to: Audience = {}) {
  const staff = (() => { try { return !!localStorage.getItem("sc-demo-staff"); } catch { return false; } })();
  const ok = staff || !!to.public || (!!to.order && [...watching.orders].some((w) => w.split("-")[0] === to.order)) || (!!to.office && watching.offices.has(to.office));
  if (!ok) return;
  subs.get(type)?.forEach((f) => f(data, type));
  subs.get("*")?.forEach((f) => f(data, type));
}
let bc: BroadcastChannel | null = null, es: EventSource | null = null, esUrl = "";
export function demoChannel(): BroadcastChannel | null {
  if (!bc && typeof BroadcastChannel !== "undefined") { bc = new BroadcastChannel("sc-demo"); bc.onmessage = (e) => busFire(e.data.type, e.data.data, e.data.to); }
  return bc;
}
function streamUrl(): string {
  const q = new URLSearchParams();
  if (watching.orders.size) q.set("order", [...watching.orders].join(","));
  if (watching.offices.size) q.set("office", [...watching.offices].join(","));
  const s = q.toString();
  return "/api/stream" + (s ? "?" + s : "");
}
function connect() {
  if (DEMO) { demoChannel(); return; }
  if (typeof EventSource === "undefined" || !subs.size) return;
  const u = streamUrl();
  if (es && esUrl === u) return;
  es?.close();
  es = new EventSource(u); esUrl = u;
  for (const type of subs.keys()) if (type !== "*") es.addEventListener(type, (e) => { let d: unknown = null; try { d = JSON.parse((e as MessageEvent).data); } catch { /* ignore */ } subs.get(type)?.forEach((f) => f(d, type)); subs.get("*")?.forEach((f) => f(d, type)); });
}
function watchOrder(id: string) { if (!watching.orders.has(id)) { [...watching.orders].forEach((w) => { if (w.split("-")[0] === id.split("-")[0]) watching.orders.delete(w); }); watching.orders.add(id); if (subs.size) connect(); } }
function watchOffice(code: string) { if (code && !watching.offices.has(code)) { watching.offices.add(code); if (subs.size) connect(); } }

/* ---------- transport ---------- */
const demoChunk = () => import("./api-demo.ts");
async function local<T>(fn: (c: Core) => Promise<T>): Promise<T> {
  const m = await loadModule(demoChunk);
  return m.local(fn);
}
const pad = (n: number) => String(n).padStart(2, "0");
async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  const h: Record<string, string> = {};
  if (body) h["content-type"] = "application/json";
  /* preview frames / tests: the server follows the page's clock only when it runs with SC_PREVIEW_API=1 */
  const ov = isPreview() ? clockOverride() : null;
  if (ov) h["x-sc-clock"] = pad(ov.h) + ":" + pad(ov.m);
  try {
    r = await fetch("/api/" + path, { method, credentials: "same-origin", headers: h, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("offline", "Няма връзка. Проверете интернета и опитайте пак.", 0);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(j?.error || "server", j?.message || "Нещо се обърка. Опитайте пак.", r.status, j?.fields, j?.retryIn);
  return j as T;
}
/** pick the demo or the server implementation */
const pick = <A extends unknown[], T>(demo: (c: Core, ...a: A) => Promise<T>, server: (...a: A) => Promise<T>) =>
  (...a: A): Promise<T> => (DEMO ? local((c) => demo(c, ...a)) : server(...a));
const demoTok = (k: "staff" | "user") => { try { return localStorage.getItem(k === "staff" ? "sc-demo-staff" : "sc-demo-user"); } catch { return null; } };
const setDemoTok = (k: "staff" | "user", v: string | null) => { try { const n = k === "staff" ? "sc-demo-staff" : "sc-demo-user"; v ? localStorage.setItem(n, v) : localStorage.removeItem(n); } catch { /* ignore */ } };

/* "sc-user": the prototype key that SC.user() and the pages read (name, phone, consents). */
function rememberUser(c: Customer | null) {
  try { c ? localStorage.setItem("sc-user", JSON.stringify(c)) : localStorage.removeItem("sc-user"); } catch { /* ignore */ }
}
const noAuth = () => new ApiError("auth", "Влезте с телефона си.", 401);

/** the signed-in customer as the API returns it: + profileBonus (unused -10%, the cart shows it as profilePct: 10) */
export type CustomerView = Customer & { profileBonus: boolean };
export type StatusInfo = { state: unknown; status: unknown; eta: { min: number; busy: boolean; text: string }; kitchen: Settings["kitchen"];
  /** the celebration calculator: "estimate" (show the price) or "offer" (only "Ще ви изпратим оферта"); earlyDays null = no -5% */
  celebrationPrice: Settings["celebrationPrice"]; earlyDays: number | null };
type JoinBody = OfficeParticipant & { pid?: string };
type SubmitBody = Pick<OrderInput, "name" | "phone" | "pay" | "email" | "note">;
type OfficeCreate = { office: string; addr: string; deadline?: string; payer?: "one" | "each"; mode?: "delivery" | "pickup"; name?: string; phone?: string; pay?: "cash" | "card" | "voucher" };

export const api = {
  demo: DEMO,
  /* public data (in the demo straight from the bundled data) */
  /** the live menu: the same shape as src/data/menu.json, "out" in t (and lunch.items[].out) from the kitchen / admin */
  menu: async (): Promise<Menu> => (DEMO ? (await loadModule(demoChunk)).MENU : http<Menu>("GET", "menu")),
  status: async (): Promise<StatusInfo> => (DEMO ? (await loadModule(demoChunk)).statusInfo() : http<StatusInfo>("GET", "status")),
  offers: async () => (DEMO ? (await loadModule(demoChunk)).offers() : http<unknown>("GET", "offers")),
  /** events with the date as "YYYY-MM-DD" */
  events: async (): Promise<SiteEventJson[]> => (DEMO ? (await loadModule(demoChunk)).eventsJson() : http<SiteEventJson[]>("GET", "events")),

  orders: {
    /** returns the whole order (with `key`: the tracking address is SC.url.tracking(order)) */
    create: async (o: Omit<OrderInput, "channel" | "userId">): Promise<Order> => {
      const r = DEMO ? await local(async (c) => { const u = await c.customers.bySession(demoTok("user")); return c.orders.create({ ...o, channel: "web", userId: u ? u.id : null }); }) : await http<Order>("POST", "orders", o);
      remember("orders", r.no, r.key); watchOrder(trackId(r.no));
      return r;
    },
    /** public view for tracking; `no` may be "1042" (the key this browser knows is added) or "1042-k7f3m2pq" */
    get: async (no: string | number): Promise<PublicOrder> => {
      const id = trackId(no);
      const r = DEMO ? await local((c) => c.orders.track(id)) : await http<PublicOrder | { found: false }>("GET", "orders/" + encodeURIComponent(id));
      if ("found" in r && r.found === false) throw new ApiError("not_found", "Няма такава поръчка.", 404);
      const o = r as PublicOrder;
      if (o.key) remember("orders", o.no, o.key);
      watchOrder(trackId(o.no));
      return o;
    },
  },
  /** discount code from the rating, before the order: { code, pct, valid } or ApiError with fields.code */
  codes: {
    check: pick((c, code: string) => c.codes.check(code), async (code) => {
      const r = await http<{ code: string; pct: number; valid: true } | { valid: false; error: { code: string; message: string; fields?: Record<string, string> } }>("POST", "codes/check", { code });
      if (!r.valid) throw new ApiError(r.error.code, r.error.message, 422, r.error.fields);
      return r;
    }),
  },
  reservations: {
    /** returns the reservation with `key` (kept in this browser for get / cancel) */
    /** r.replaces: {id, key?} of the booking being changed (the key this browser kept is added) */
    create: async (r: ReservationInput): Promise<Reservation> => {
      if (r.replaces && r.replaces.id) r = { ...r, replaces: { id: r.replaces.id, key: keys().res[r.replaces.id] || r.replaces.key || "" } };
      const x = DEMO ? await local((c) => c.reservations.create(r)) : await http<Reservation>("POST", "reservations", r);
      remember("res", x.id, x.key);
      return x;
    },
    /** except: the id of the guest's own booking during a change (its key from this browser is added); its table is not counted */
    taken: async (date: string, time: string, except?: string): Promise<string[]> => {
      const k = except ? keys().res[except] || "" : "";
      if (DEMO) return local((c) => c.reservations.taken(date, time, except, k));
      return http<string[]>("GET", `reservations/taken?date=${encodeURIComponent(date)}&time=${encodeURIComponent(time)}` + (except ? `&except=${encodeURIComponent(except)}&k=${encodeURIComponent(k)}` : ""));
    },
    /** key: from the SMS link; without it, the key this browser kept */
    get: async (id: string, key?: string): Promise<Reservation> => {
      const k = key || keys().res[id] || "";
      const r = DEMO ? await local((c) => c.reservations.get(id, k)) : await http<Reservation>("GET", "reservations/" + encodeURIComponent(id) + "?k=" + encodeURIComponent(k));
      remember("res", id, k); /* the key from the SMS link works after a reload too */
      return r;
    },
    cancel: async (id: string, key?: string): Promise<Reservation> => {
      const k = keys().res[id] || key || "";
      return DEMO ? local((c) => c.reservations.cancel(id, k)) : http<Reservation>("POST", "reservations/" + encodeURIComponent(id) + "/cancel", { key: k });
    },
  },
  celebrations: { create: pick((c, x: CelebrationInput) => c.celebrations.create(x), (x) => http("POST", "celebrations", x)) },
  office: {
    /** returns the order with `orgKey` (kept in this browser; for "continue on another device" put it in the organizer's link) */
    create: async (o: OfficeCreate): Promise<OfficeOrder> => {
      const r = DEMO ? await local((c) => c.office.create(o)) : await http<OfficeOrder>("POST", "office", o);
      remember("org", r.code, r.orgKey); watchOffice(r.code);
      return r;
    },
    /** orgKey: from the organizer's link (another device); kept when it is right (isOrg in the answer) */
    get: async (code: string, orgKey?: string): Promise<PublicOffice | null> => {
      const k = orgKey || keys().org[code] || "";
      const r = DEMO ? await local((c) => c.office.get(code, k || null)) : await http<PublicOffice | null>("GET", "office/" + encodeURIComponent(code) + (k ? "?k=" + encodeURIComponent(k) : ""));
      if (r && r.isOrg && orgKey) remember("org", code, orgKey);
      if (r) watchOffice(code);
      return r;
    },
    /** a colleague's choice: the organizer (this browser has orgKey) may write any name; a colleague only their own entry (pid) */
    join: async (code: string, p: JoinBody): Promise<PublicOffice & { pid: string }> => {
      const k = keys(), org = k.org[code];
      const b = { ...p, ...(org ? { orgKey: org } : { pid: p.pid || k.pid[code] }) };
      const r = DEMO ? await local((c) => c.office.join(code, b)) : await http<PublicOffice & { pid: string }>("POST", `office/${encodeURIComponent(code)}/join`, b);
      if (!org) remember("pid", code, r.pid);
      watchOffice(code);
      return r;
    },
    submit: async (code: string, contact: SubmitBody): Promise<{ office: PublicOffice; order: Order }> => {
      const b = { ...contact, orgKey: keys().org[code] };
      const r = DEMO ? await local((c) => c.office.submit(code, b)) : await http<{ office: PublicOffice; order: Order }>("POST", `office/${encodeURIComponent(code)}/submit`, b);
      remember("orders", r.order.no, r.order.key);
      return r;
    },
    /** the organizer adds / changes name, phone, how they pay (for the automatic send at the deadline); orgKey: this browser's by default */
    update: async (code: string, orgKey: string | null | undefined, patch: { name?: string; phone?: string; pay?: "cash" | "card" | "voucher" }): Promise<PublicOffice> => {
      const k = orgKey || keys().org[code] || "";
      return DEMO ? local((c) => c.office.update(code, k, patch)) : http<PublicOffice>("POST", `office/${encodeURIComponent(code)}/update`, { ...patch, orgKey: k });
    },
    /** the organizer token this browser holds (for the organizer's link), or "" */
    orgKey: (code: string): string => keys().org[code] || "",
  },
  /** topics: the chosen event categories (none = all) */
  subscribe: pick((c, email: string, consent: boolean, topics?: string[]) => c.subscriptions.subscribe(email, consent, topics), (email, consent, topics) => http<Subscription>("POST", "subscribe", { email, consent, topics })),
  /** contact message (/kontakti/): { ok, id } or ApiError "invalid" with fields name / contact / message (429 "throttled" on the server) */
  feedback: {
    create: pick(async (c, f: FeedbackInput) => { const r = await c.feedback.create(f); return { ok: true as const, id: r.id }; },
      (f) => http<{ ok: true; id: string }>("POST", "feedback", f)),
  },
  ratings: {
    submit: pick((c, r: { orderNo: string; happy: boolean; text?: string }) => c.ratings.submit({ ...r, orderNo: trackId(r.orderNo) }),
      (r) => http<{ code: string; pct: number; google: string | null; googleMissing: boolean }>("POST", "ratings", { ...r, orderNo: trackId(r.orderNo) })),
  },

  /* customers: SMS sign-in (the code is returned as demoCode and shown on screen in v1) */
  auth: {
    /** demoCode only in the demo / test mode (no SMS provider); known: the number has a profile; too_soon -> e.retryIn seconds */
    smsRequest: pick((c, phone: string) => c.customers.requestCode(phone), (phone) => http<{ sent: true; phone: string; demoCode?: string; resendIn: number; known: boolean }>("POST", "auth/sms/request", { phone })),
    smsVerify: async (phone: string, code: string, extra: { name?: string; marketing?: boolean } = {}) => {
      const r = DEMO
        ? await local(async (c) => { const v = await c.customers.verifyCode(phone, code, extra); setDemoTok("user", v.token); return { customer: (await c.customers.view(v.customer))!, isNew: v.isNew }; })
        : await http<{ customer: Customer; isNew: boolean }>("POST", "auth/sms/verify", { phone, code, ...extra });
      rememberUser(r.customer);
      return r;
    },
    logout: async () => { if (DEMO) { const t = demoTok("user"); if (t) await local((c) => c.customers.logout(t)); setDemoTok("user", null); } else await http("POST", "auth/sms/logout"); rememberUser(null); },
    /** the signed-in customer or null; null also clears "sc-user" (an expired session must not look signed in) */
    me: async (): Promise<CustomerView | null> => {
      const r = DEMO ? await local(async (c) => c.customers.view(await c.customers.bySession(demoTok("user")))) : await http<CustomerView | null>("GET", "me");
      if (!r) rememberUser(null);
      return r;
    },
    update: pick(async (c, patch: ProfilePatch) => { const u = await c.customers.bySession(demoTok("user")); if (!u) throw noAuth(); const r = (await c.customers.view(await c.customers.update(u.id, patch)))!; rememberUser(r); return r; }, async (patch) => { const r = await http<CustomerView>("PATCH", "me", patch); rememberUser(r); return r; }),
    remove: pick(async (c) => { const u = await c.customers.bySession(demoTok("user")); if (u) await c.customers.remove(u.id); setDemoTok("user", null); rememberUser(null); return { ok: true }; }, async () => { const r = await http<{ ok: boolean }>("DELETE", "me"); rememberUser(null); return r; }),
    orders: pick(async (c) => { const u = await c.customers.bySession(demoTok("user")); return u ? c.customers.orders(u) : []; }, () => http<Order[]>("GET", "me/orders")),
    export: pick(async (c) => { const u = await c.customers.bySession(demoTok("user")); if (!u) throw noAuth(); return c.customers.export(u); }, () => http<unknown>("GET", "me/export")),
    /** "Моите кодове" from the ratings: { code, pct, orderNo, used, usedBy, createdAt }[] */
    codes: pick(async (c) => { const u = await c.customers.bySession(demoTok("user")); return u ? c.customers.codes(u) : []; }, () => http<{ code: string; pct: number; orderNo: string; used: boolean; usedBy: string | null; createdAt: string }[]>("GET", "me/codes")),
    /** saved addresses: the list is customer.addrs (auth.me()); add / remove return the updated customer */
    addAddress: pick(async (c, a: { label: string; addr: string; zone: string }) => { const u = await c.customers.bySession(demoTok("user")); if (!u) throw noAuth(); const r = await c.customers.addAddress(u.id, a); rememberUser(r); return r; },
      async (a) => { const r = await http<Customer>("POST", "me/addresses", a); rememberUser(r); return r; }),
    removeAddress: pick(async (c, id: string) => { const u = await c.customers.bySession(demoTok("user")); if (!u) throw noAuth(); const r = await c.customers.removeAddress(u.id, id); rememberUser(r); return r; },
      async (id) => { const r = await http<Customer>("DELETE", "me/addresses/" + encodeURIComponent(id)); rememberUser(r); return r; }),
    addresses: async () => ((await api.auth.me())?.addrs || []),
    toggleFav: pick(async (c, id: string) => { const u = await c.customers.bySession(demoTok("user")); if (!u) throw noAuth(); return c.customers.toggleFav(u.id, id); }, (id) => http<Customer>("POST", "me/favorites", { id })),
  },

  /* staff sign-in (server: scrypt + httpOnly cookie; demo: PBKDF2 hashes from the build, token in localStorage) */
  staff: {
    login: pick(async (c, username: string, password: string) => { const r = await c.staff.login(username, password); setDemoTok("staff", r.token); return { user: r.user as unknown }; }, (username, password) => http<{ user: unknown }>("POST", "auth/login", { username, password })),
    logout: pick(async (c) => { const t = demoTok("staff"); if (t) await c.staff.logout(t); setDemoTok("staff", null); return { ok: true }; }, () => http<{ ok: boolean }>("POST", "auth/logout")),
    me: pick((c) => c.staff.bySession(demoTok("staff")), () => http<unknown>("GET", "auth/me")),
  },

  /* admin (the server checks the role x section matrix; the demo checks the session only) */
  admin: {
    orders: pick((c, s?: OrderStatus) => c.orders.list(s ? { status: s } : {}), (s) => http<Order[]>("GET", "admin/orders" + (s ? "?status=" + s : ""))),
    setOrderStatus: pick((c, no: string, s: OrderStatus) => c.orders.setStatus(no, s, "demo"), (no, s) => http<Order>("PATCH", "admin/orders/" + no, { status: s })),
    reservations: pick((c) => c.reservations.list(), () => http<Reservation[]>("GET", "admin/reservations")),
    setReservationStatus: pick((c, id: string, s: ReservationStatus) => c.reservations.setStatus(id, s, "demo"), (id, s) => http<Reservation>("PATCH", "admin/reservations/" + id, { status: s })),
    /** kitchen "Натоварено" + minutes, reservation length */
    settings: pick((c) => c.settings.get(), () => http<Settings>("GET", "admin/settings")),
    setSettings: pick((c, p: SettingsPatch) => c.settings.update(p, "demo"), (p) => http<Settings>("PATCH", "admin/settings", p)),
    staff: pick((c) => c.staff.list(), () => http<unknown[]>("GET", "admin/staff")),
    roles: pick((c) => c.staff.roles(), () => http<unknown[]>("GET", "admin/roles")),
    setRole: pick((c, id: Parameters<Core["staff"]["setRole"]>[0], sections: string[]) => c.staff.setRole(id, sections, "demo"), (id, sections) => http<unknown>("PUT", "admin/roles/" + id, { sections })),
    notes: pick((c, f: { status?: NoteStatus; module?: string } = {}) => c.notes.list(f), (f = {}) => http<unknown[]>("GET", "admin/notes?" + new URLSearchParams(f as Record<string, string>))),
    createNote: pick(async (c, n: NoteInput) => { const s = await c.staff.bySession(demoTok("staff")); return c.notes.create(n, s ? s.user.username : "demo"); }, (n) => http<unknown>("POST", "admin/notes", n)),
    setNoteStatus: pick((c, id: string, s: NoteStatus) => c.notes.setStatus(id, s, "demo"), (id, s) => http<unknown>("PATCH", "admin/notes/" + id, { status: s })),
    deleteNote: pick(async (c, id: string) => { await c.notes.remove(id, "demo"); return { ok: true }; }, (id) => http<{ ok: boolean }>("DELETE", "admin/notes/" + id)),
    audit: pick((c) => c.audit.list(), () => http<unknown[]>("GET", "admin/audit")),
    feedback: pick((c) => c.feedback.list(), () => http<Feedback[]>("GET", "admin/feedback")),
  },

  /** Follow an order / office order in real time without reading it first (api.orders.get / api.office.* do it themselves). */
  watch(w: { order?: string | number; office?: string }) { if (w.order != null) watchOrder(trackId(w.order)); if (w.office) watchOffice(w.office); },

  /** Real-time: api.on("order.status", (data) => ...). Returns an unsubscribe function. "*" = everything this page may see.
      A page receives public events and only the events of the orders / office orders it has read or created. */
  on(type: string, fn: Fn): () => void {
    const isNew = !subs.has(type);
    if (isNew) subs.set(type, new Set());
    subs.get(type)!.add(fn);
    if (isNew && es && type !== "*") { es.close(); es = null; esUrl = ""; }
    connect();
    return () => { subs.get(type)?.delete(fn); };
  },
};
export default api;
