/* The admin and staff part of the API client (only the admin pages and the staff modules import it; the site's pages
   never load it). Server: fetch("/api/admin/..."), the rights are checked on the server. Demo: the same core in the
   browser, and every call goes through the same check (core.staff.guard) with the demo session, so the demo shows
   exactly what the server would allow. */
import { http, pick, demoTok, setDemoTok, ApiError } from "./api.ts";
import type { Core, NoteInput, NoteStatus, OrderStatus, ReservationStatus, Order, Reservation, Settings, Feedback, FeedbackNote, Role, RoleId, AuditEntry } from "./api-types.ts";
import type { SettingsPatch } from "../core/settings.ts";
import { settingsAllowed } from "../core/settings-guard.ts";
import { maskFeedback, maskList } from "../core/rights.ts";
import type { PublicStaff, Summary, SearchAnswer, NoteFilter, ResRow } from "../core/index.ts";
import type { HoursInfo } from "../core/reservations-admin.ts";
import type { AuditFilter } from "../core/audit.ts";

export { ApiError };
export type Me = { user: PublicStaff; sections: string[]; home: string };
type Waiting = Summary["waiting"]["notes"];
/* the same as core/staff.ts homeOf() (kept here so this file does not pull the core into the server build) */
const HOME: Partial<Record<RoleId, string>> = { waiter: "app:waiter", kitchen: "app:kitchen", driver: "app:driver" };

/** the demo: the staff session of this browser, checked like on the server */
const g = (c: Core, need?: string | string[], adminOnly = false) => c.staff.guard(demoTok("staff"), need, adminOnly);
const q = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const k of Object.keys(o)) { const v = o[k]; if (v) u.set(k, v); } const s = u.toString(); return s ? "?" + s : ""; };

export const staffApi = {
  /* sign-in: server scrypt + httpOnly cookie; demo PBKDF2 hashes from the build, token in localStorage.
     home: "dashboard" or "app:waiter" | "app:kitchen" | "app:driver" (the staff apps, decision 15.11.2026) */
  login: pick(async (c, username: string, password: string) => { const r = await c.staff.login(username, password, "demo"); setDemoTok("staff", r.token); return { user: r.user, home: r.home }; },
    (username, password) => http<{ user: PublicStaff; home: string }>("POST", "auth/login", { username, password })),
  logout: pick(async (c) => { const t = demoTok("staff"); if (t) await c.staff.logout(t); setDemoTok("staff", null); return { ok: true }; }, () => http<{ ok: boolean }>("POST", "auth/logout")),
  /** null without a session */
  me: pick(async (c): Promise<Me | null> => { const s = await c.staff.bySession(demoTok("staff")); return s ? { ...s, home: HOME[s.user.role] || "dashboard" } : null; },
    () => http<Me | null>("GET", "auth/me")),
};

export const adminApi = {
  summary: pick(async (c) => c.admin.summary(await g(c)), () => http<Summary>("GET", "admin/summary")),
  search: pick(async (c, text: string) => c.admin.search(await g(c), text), (text) => http<SearchAnswer>("GET", "admin/search" + q({ q: text }))),

  /* roles: everyone signed in reads; only the main admin changes */
  roles: pick(async (c) => { await g(c); return c.staff.roles(); }, () => http<Role[]>("GET", "admin/roles")),
  setRole: pick(async (c, id: RoleId, sections: string[]) => { const s = await g(c, "roles", true); return c.staff.setRole(id, sections, s.user.username); }, (id, sections) => http<Role>("PUT", "admin/roles/" + id, { sections })),

  /* notes and recommendations */
  notes: pick(async (c, f: NoteFilter = {}) => { await g(c, "notes"); return f.status === "approved" ? c.notes.approved() : c.notes.list(f); },
    (f = {}) => http<FeedbackNote[]>("GET", "admin/notes" + q(f as Record<string, string>))),
  myNotes: pick(async (c) => c.notes.mine(await g(c)), () => http<FeedbackNote[]>("GET", "admin/notes/mine")),
  notesWaiting: pick(async (c) => c.notes.waiting(await g(c)), () => http<Waiting>("GET", "admin/notes/waiting")),
  notesSeen: pick(async (c) => c.notes.seen(await g(c)), () => http<{ id: string; at: string }>("POST", "admin/notes/seen")),
  exportNotes: pick(async (c) => { await g(c, "notes"); return c.notes.approved(); }, () => http<FeedbackNote[]>("GET", "admin/notes/export")),
  createNote: pick(async (c, n: NoteInput) => c.notes.create(n, await g(c)), (n) => http<FeedbackNote>("POST", "admin/notes", n)),
  setNoteStatus: pick(async (c, id: string, status: NoteStatus, extra: { reason?: string; change?: FeedbackNote["change"]; fix?: string } = {}) => { const s = await g(c, undefined, true); return c.notes.setStatus(id, status, s.user.username, { ...extra, who: s.user.name }); },
    (id, status, extra = {}) => http<FeedbackNote>("PATCH", "admin/notes/" + encodeURIComponent(id), { status, ...extra })),
  deleteNote: pick(async (c, id: string) => { const s = await g(c, undefined, true); return { ok: true, note: await c.notes.remove(id, s.user.username) }; },
    (id) => http<{ ok: boolean; note: FeedbackNote | null }>("DELETE", "admin/notes/" + encodeURIComponent(id))),
  restoreNote: pick(async (c, note: FeedbackNote) => { const s = await g(c, undefined, true); return c.notes.restore(note, s.user.username); }, (note) => http<FeedbackNote>("POST", "admin/notes/restore", { note })),

  /** newest first; f.before (ISO) pages back; from / to "YYYY-MM-DD", who (username), action (prefix), q (text) */
  audit: pick(async (c, f: AuditFilter = {}) => { await g(c, "audit"); return c.audit.list(f); }, (f = {}) => http<(AuditEntry & { role?: string })[]>("GET", "admin/audit" + q(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v == null ? undefined : String(v)]))))),

  /* the sections of part 3 use these (kept from api.ts, now with the same checks as the server) */
  /* the raw lists with the phone masked (the screens of part 3: api-admin-3.ts) */
  orders: pick(async (c, s?: OrderStatus) => { await g(c, "orders"); return maskList(await c.orders.list(s ? { status: s } : {})); }, (s) => http<Order[]>("GET", "admin/orders" + q({ status: s }))),
  setOrderStatus: pick(async (c, no: string, st: OrderStatus) => { const s = await g(c, ["orders", "kitchen", "driver"]); return c.orders.setStatus(no, st, s.user.username, s); },
    (no, st) => http<Order>("PATCH", "admin/orders/" + no, { status: st })),
  reservations: pick(async (c) => { await g(c, "reservations"); return maskList(await c.reservations.list()); }, () => http<Reservation[]>("GET", "admin/reservations")),
  /** the admin's rules (core/reservations-admin.ts resSetStatus): the row of "Резервации" */
  setReservationStatus: pick(async (c, id: string, st: ReservationStatus) => c.resAdmin.setStatus(await g(c), id, st),
    (id, st) => http<ResRow>("PATCH", "admin/reservations/" + id, { status: st })),
  /** + hours (read only: the core's rules) */
  settings: pick(async (c) => { await g(c); return c.settings.view(); }, () => http<Settings & { hours: HoursInfo }>("GET", "admin/settings")),
  setSettings: pick(async (c, p: SettingsPatch) => { const s = await g(c); settingsAllowed(s, p); return c.settings.update(p, s.user.username); }, (p) => http<Settings>("PATCH", "admin/settings", p)),
  /** "Изчерпано днес" for one dish (kitchen, menu, lunch menu); only for today */
  setSoldOut: pick(async (c, id: string, out: boolean) => c.kitchen.adminSetOut(await g(c, ["menu", "kitchen", "lunch"]), id, out),
    (id, out) => http<{ id: string; out: boolean }>("PUT", "admin/menu/" + encodeURIComponent(id) + "/sold-out", { out })),
  staff: pick(async (c) => { await g(c, "staff"); return c.staff.list(); }, () => http<PublicStaff[]>("GET", "admin/staff")),
  /** the contact masked (the whole one: customersAdminApi.messageContact, into the log) */
  feedback: pick(async (c) => { await g(c, "customers"); return maskFeedback(await c.feedback.list()); }, () => http<Feedback[]>("GET", "admin/feedback")),
};
