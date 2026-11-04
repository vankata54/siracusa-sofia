/* One client for every screen. Server build: fetch("/api/...") + EventSource("/api/stream").
   Demo build (<html data-demo="1">, static files, no server): the same core runs in the browser on localStorage
   (KVRepo) and real-time events go through BroadcastChannel between tabs. Same method names, same results, same errors. */
import { createCore, KVRepo, CoreError, type Core, type Hasher, type StaffUser, type RoleId } from "../core/index.ts";
import type { OrderInput } from "../core/orders.ts";
import type { ReservationInput, CelebrationInput } from "../core/reservations.ts";
import type { NoteInput } from "../core/notes.ts";
import type { ProfilePatch } from "../core/customers.ts";
import type { NoteStatus, OrderStatus, ReservationStatus, OfficeParticipant, Customer } from "../core/types.ts";
import { MENU } from "../data/menu.ts";
import { state, status, eta } from "../lib/status.ts";
import { offers } from "../lib/offers.ts";
import { events } from "../lib/events.ts";

export const DEMO = typeof document !== "undefined" && document.documentElement.dataset.demo === "1";

export class ApiError extends Error {
  code: string; status: number; fields?: Record<string, string>;
  constructor(code: string, message: string, status = 400, fields?: Record<string, string>) { super(message); this.code = code; this.status = status; this.fields = fields; }
}

/* ---------- real-time bus ---------- */
type Fn = (data: unknown, type: string) => void;
const subs = new Map<string, Set<Fn>>();
function fire(type: string, data: unknown) {
  subs.get(type)?.forEach((f) => f(data, type));
  subs.get("*")?.forEach((f) => f(data, type));
}
let bc: BroadcastChannel | null = null, es: EventSource | null = null;
function connect(type: string) {
  if (DEMO) {
    if (!bc && typeof BroadcastChannel !== "undefined") { bc = new BroadcastChannel("sc-demo"); bc.onmessage = (e) => fire(e.data.type, e.data.data); }
    return;
  }
  if (!es) es = new EventSource("/api/stream");
  if (type !== "*" && !subs.get(type)?.size) es.addEventListener(type, (e) => fire(type, JSON.parse((e as MessageEvent).data)));
}

/* ---------- demo core (lazy) ---------- */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 120000 }, key, 256));
}
export const webHasher: Hasher = {
  async hash(p) { const a = new Uint8Array(16); crypto.getRandomValues(a); const salt = hex(a.buffer); return { salt, hash: await pbkdf2(p, salt), algo: "pbkdf2" }; },
  async verify(p, salt, hash) { return (await pbkdf2(p, salt)) === hash; },
};
let demoCore: Core | null = null;
async function core(): Promise<Core> {
  if (demoCore) return demoCore;
  demoCore = createCore({
    repo: new KVRepo(localStorage), hasher: webHasher, demo: true,
    emit: (type, data) => { fire(type, data); bc?.postMessage({ type, data }); },
  });
  /* staff accounts: PBKDF2 hashes built from .env at `npm run build:demo` (never the passwords) */
  const list = typeof __DEMO_STAFF__ !== "undefined" ? __DEMO_STAFF__ : [];
  for (const s of list) {
    const have = (await demoCore.ctx.repo.list<StaffUser>("staff_users", { username: s.username }))[0];
    if (!have || have.hash !== s.hash) await demoCore.ctx.repo.put<StaffUser>("staff_users", { id: have ? have.id : "u-" + s.username, username: s.username, name: s.name, role: s.role as RoleId, salt: s.salt, hash: s.hash, algo: "pbkdf2", active: true, createdAt: new Date().toISOString() });
  }
  return demoCore;
}
const TOK = { staff: "sc-demo-staff", user: "sc-demo-user" };
const tok = (k: keyof typeof TOK) => { try { return localStorage.getItem(TOK[k]); } catch { return null; } };
const setTok = (k: keyof typeof TOK, v: string | null) => { try { v ? localStorage.setItem(TOK[k], v) : localStorage.removeItem(TOK[k]); } catch { /* ignore */ } };

async function local<T>(fn: (c: Core) => Promise<T>): Promise<T> {
  try { return await fn(await core()); }
  catch (e) {
    if (e instanceof CoreError) throw new ApiError(e.code, e.message, e.status, (e as CoreError & { fields?: Record<string, string> }).fields);
    throw e;
  }
}
async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch("/api/" + path, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("offline", "Няма връзка. Проверете интернета и опитайте пак.", 0);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(j?.error || "server", j?.message || "Нещо се обърка. Опитайте пак.", r.status, j?.fields);
  return j as T;
}
/** pick the demo or the server implementation */
const pick = <A extends unknown[], T>(demo: (c: Core, ...a: A) => Promise<T>, server: (...a: A) => Promise<T>) =>
  (...a: A): Promise<T> => (DEMO ? local((c) => demo(c, ...a)) : server(...a));

/* "sc-user": the prototype key that SC.user() and the pages read (name, phone, consents). */
function rememberUser(c: Customer | null) {
  try { c ? localStorage.setItem("sc-user", JSON.stringify(c)) : localStorage.removeItem("sc-user"); } catch { /* ignore */ }
}

export const api = {
  demo: DEMO,
  /* public data (in the demo straight from the bundled menu) */
  menu: pick(async () => MENU, () => http<typeof MENU>("GET", "menu")),
  status: pick(async () => ({ state: state(), status: status(), eta: eta() }), () => http("GET", "status")),
  offers: pick(async () => offers(), () => http("GET", "offers")),
  events: pick(async () => events(), () => http("GET", "events")),

  orders: {
    create: pick((c, o: Omit<OrderInput, "channel" | "userId">) => c.orders.create({ ...o, channel: "web" }), (o) => http("POST", "orders", o)),
    get: pick((c, no: string) => c.orders.get(no), (no) => http("GET", "orders/" + encodeURIComponent(no))),
  },
  reservations: {
    create: pick((c, r: ReservationInput) => c.reservations.create(r), (r) => http("POST", "reservations", r)),
    taken: pick((c, date: string, time: string) => c.reservations.taken(date, time), (date, time) => http<string[]>("GET", `reservations/taken?date=${date}&time=${time}`)),
  },
  celebrations: { create: pick((c, x: CelebrationInput) => c.celebrations.create(x), (x) => http("POST", "celebrations", x)) },
  office: {
    create: pick((c, o: Parameters<Core["office"]["create"]>[0]) => c.office.create(o), (o) => http("POST", "office", o)),
    get: pick((c, code: string) => c.office.get(code), (code) => http("GET", "office/" + code)),
    join: pick((c, code: string, p: OfficeParticipant) => c.office.join(code, p), (code, p) => http("POST", `office/${code}/join`, p)),
    submit: pick((c, code: string, contact: Parameters<Core["office"]["submit"]>[1]) => c.office.submit(code, contact), (code, contact) => http("POST", `office/${code}/submit`, contact)),
  },
  subscribe: pick((c, email: string, consent: boolean) => c.subscriptions.subscribe(email, consent), (email, consent) => http("POST", "subscribe", { email, consent })),
  ratings: { submit: pick((c, r: { orderNo: string; happy: boolean; text?: string }) => c.ratings.submit(r), (r) => http("POST", "ratings", r)) },

  /* customers: SMS sign-in (the code is returned as demoCode and shown on screen in v1) */
  auth: {
    smsRequest: pick((c, phone: string) => c.customers.requestCode(phone), (phone) => http<{ sent: true; phone: string; demoCode: string; resendIn: number }>("POST", "auth/sms/request", { phone })),
    smsVerify: async (phone: string, code: string, extra: { name?: string; marketing?: boolean } = {}) => {
      const r = DEMO
        ? await local(async (c) => { const v = await c.customers.verifyCode(phone, code, extra); setTok("user", v.token); return { customer: v.customer, isNew: v.isNew }; })
        : await http<{ customer: Customer; isNew: boolean }>("POST", "auth/sms/verify", { phone, code, ...extra });
      rememberUser(r.customer);
      return r;
    },
    logout: async () => { if (DEMO) { const t = tok("user"); if (t) await local((c) => c.customers.logout(t)); setTok("user", null); } else await http("POST", "auth/sms/logout"); rememberUser(null); },
    me: pick((c) => c.customers.bySession(tok("user")), () => http<Customer | null>("GET", "me")),
    update: pick(async (c, patch: ProfilePatch) => { const u = await c.customers.bySession(tok("user")); if (!u) throw new CoreError("auth", "Влезте с телефона си.", 401); const r = await c.customers.update(u.id, patch); rememberUser(r); return r; }, async (patch) => { const r = await http<Customer>("PATCH", "me", patch); rememberUser(r); return r; }),
    remove: pick(async (c) => { const u = await c.customers.bySession(tok("user")); if (u) await c.customers.remove(u.id); setTok("user", null); rememberUser(null); return { ok: true }; }, async () => { const r = await http<{ ok: boolean }>("DELETE", "me"); rememberUser(null); return r; }),
    orders: pick(async (c) => { const u = await c.customers.bySession(tok("user")); return u ? c.customers.orders(u) : []; }, () => http("GET", "me/orders")),
    export: pick(async (c) => { const u = await c.customers.bySession(tok("user")); if (!u) throw new CoreError("auth", "Влезте с телефона си.", 401); return c.customers.export(u); }, () => http("GET", "me/export")),
    toggleFav: pick(async (c, id: string) => { const u = await c.customers.bySession(tok("user")); if (!u) throw new CoreError("auth", "Влезте с телефона си.", 401); return c.customers.toggleFav(u.id, id); }, (id) => http<Customer>("POST", "me/favorites", { id })),
  },

  /* staff sign-in (server: scrypt + httpOnly cookie; demo: PBKDF2 hashes from the build, token in localStorage) */
  staff: {
    login: pick(async (c, username: string, password: string) => { const r = await c.staff.login(username, password); setTok("staff", r.token); return { user: r.user }; }, (username, password) => http<{ user: unknown }>("POST", "auth/login", { username, password })),
    logout: pick(async (c) => { const t = tok("staff"); if (t) await c.staff.logout(t); setTok("staff", null); return { ok: true }; }, () => http("POST", "auth/logout")),
    me: pick((c) => c.staff.bySession(tok("staff")), () => http("GET", "auth/me")),
  },

  /* admin (the server checks the role x section matrix; the demo checks the session only) */
  admin: {
    orders: pick((c, s?: OrderStatus) => c.orders.list(s ? { status: s } : {}), (s) => http("GET", "admin/orders" + (s ? "?status=" + s : ""))),
    setOrderStatus: pick((c, no: string, s: OrderStatus) => c.orders.setStatus(no, s, "demo"), (no, s) => http("PATCH", "admin/orders/" + no, { status: s })),
    reservations: pick((c) => c.reservations.list(), () => http("GET", "admin/reservations")),
    setReservationStatus: pick((c, id: string, s: ReservationStatus) => c.reservations.setStatus(id, s, "demo"), (id, s) => http("PATCH", "admin/reservations/" + id, { status: s })),
    staff: pick((c) => c.staff.list(), () => http("GET", "admin/staff")),
    roles: pick((c) => c.staff.roles(), () => http("GET", "admin/roles")),
    setRole: pick((c, id: RoleId, sections: string[]) => c.staff.setRole(id, sections, "demo"), (id, sections) => http("PUT", "admin/roles/" + id, { sections })),
    notes: pick((c, f: { status?: NoteStatus; module?: string } = {}) => c.notes.list(f), (f = {}) => http("GET", "admin/notes?" + new URLSearchParams(f as Record<string, string>))),
    createNote: pick(async (c, n: NoteInput) => { const s = await c.staff.bySession(tok("staff")); return c.notes.create(n, s ? s.user.username : "demo"); }, (n) => http("POST", "admin/notes", n)),
    setNoteStatus: pick((c, id: string, s: NoteStatus) => c.notes.setStatus(id, s, "demo"), (id, s) => http("PATCH", "admin/notes/" + id, { status: s })),
    deleteNote: pick(async (c, id: string) => { await c.notes.remove(id, "demo"); return { ok: true }; }, (id) => http("DELETE", "admin/notes/" + id)),
    audit: pick((c) => c.audit.list(), () => http("GET", "admin/audit")),
  },

  /** Real-time: api.on("order.status", (data) => ...). Returns an unsubscribe function. "*" = everything. */
  on(type: string, fn: Fn): () => void {
    connect(type);
    if (!subs.has(type)) subs.set(type, new Set());
    subs.get(type)!.add(fn);
    return () => { subs.get(type)?.delete(fn); };
  },
};
export default api;
