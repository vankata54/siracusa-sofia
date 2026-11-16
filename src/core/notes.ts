/* Pencil notes ("молив") and recommendations (decision 15.11.2026).
   - Every staff role writes recommendations with the pencil (they change nothing); customers write one with
     "Предложи подобрение" on the site (no sign-in, POST /api/notes/suggest: only site addresses, no personal data).
   - Statuses: new -> approved -> doing -> review -> published, or rejected (with a reason). Only the role admin changes
     them ("Одобри и изпълни", "Публикувай"); nothing goes straight to the live site.
   - The next Claude session reads GET /api/admin/notes?status=approved (or docs/NOTES.json, only the approved ones). */
import { COL, emit, iso, rid, type Ctx } from "./ctx.ts";
import { CoreError, NOTE_STATUSES, type FeedbackNote, type NoteSource, type NoteStatus, type NotesSeen } from "./types.ts";
import { audit } from "./audit.ts";
import type { StaffCtx } from "./staff.ts";

export type NoteInput = Pick<FeedbackNote, "module" | "url" | "selector" | "text" | "viewport"> & Partial<Pick<FeedbackNote, "editId" | "elementText" | "screenshot">>;

const MODULES = ["site", "masa", "waiter", "watch", "kitchen", "driver", "admin", "owner", "manager"];
export const NOTE_MSG = {
  empty: "Напишете какво да се промени.",
  emptyClient: "Напишете какво да подобрим.",
  reason: "Напишете защо се отхвърля.",
  adminOnly: "Само главният админ може това.",
};

/* personal data never stays in a note: phone numbers and e-mail addresses become a marker (server and demo) */
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;
const PHONE = /(?:\+|00)?\d(?:[\s().\/-]?\d){7,}/g;
export function scrubPersonal(s: string): string {
  return String(s || "").replace(EMAIL, "[имейл]").replace(PHONE, "[телефон]");
}
const clean = (s: unknown, max: number) => scrubPersonal(String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim()).slice(0, max);
/** a CSS selector or address from the page: plain text, short */
const plain = (s: unknown, max: number) => String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, max);

function build(ctx: Ctx, n: NoteInput, author: string, source: NoteSource, emptyMsg: string): FeedbackNote {
  const text = clean(n.text, 4000);
  if (!text) throw Object.assign(new CoreError("invalid", emptyMsg, 422), { fields: { text: emptyMsg } });
  const module = plain(n.module, 20), url = plain(n.url, 600);
  if (!module || !url) throw new CoreError("invalid", "Липсва модул или адрес.", 422);
  if (!MODULES.includes(module)) throw new CoreError("invalid", "Непознат модул.", 422);
  const now = iso(ctx);
  const w = Math.round(+(n.viewport && n.viewport.w) || 0), h = Math.round(+(n.viewport && n.viewport.h) || 0);
  return {
    id: rid(8), module, url, selector: plain(n.selector, 600), editId: n.editId ? plain(n.editId, 80) : null,
    text, elementText: n.elementText ? clean(n.elementText, 500) : "",
    viewport: { w: w > 0 && w < 10000 ? w : 0, h: h > 0 && h < 10000 ? h : 0 },
    screenshot: n.screenshot && String(n.screenshot).startsWith("data:image/") && String(n.screenshot).length < 1_500_000 ? n.screenshot : null,
    author, source, status: "new", createdAt: now, updatedAt: now, history: [{ status: "new", at: now, who: author }],
  };
}

/** a staff recommendation or note (any role; the pencil) */
export async function createNote(ctx: Ctx, n: NoteInput, who: StaffCtx | string): Promise<FeedbackNote> {
  const s = typeof who === "string" ? null : who;
  const author = s ? s.user.name : String(who);
  const source: NoteSource = s ? { type: "staff", role: s.user.role, user: s.user.username } : { type: "staff", role: "admin", user: String(who) };
  const note = build(ctx, n, author, source, NOTE_MSG.empty);
  await ctx.repo.put(COL.notes, note);
  await audit(ctx, source.user, "note.create", note.id, { module: note.module });
  emit(ctx, "note.created", { id: note.id, module: note.module });
  return note;
}

/* the site's own pages (POST /api/notes/suggest accepts only these, decision 15.11.2026) */
export function isSiteUrl(url: string, routes: string[]): boolean {
  const p = String(url || "").split("#")[0].split("?")[0];
  if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/admin") || p.startsWith("/api")) return false;
  const norm = p.endsWith("/") ? p : p + "/";
  return routes.includes(norm) || /^\/porachka\/[^/]+\/$/.test(norm);
}

/** "Предложи подобрение" from a customer: the server checks the address and the limit (3 an hour per device and per IP) */
export async function suggestNote(ctx: Ctx, n: NoteInput, routes: string[] | null): Promise<{ id: string }> {
  if (routes && !isSiteUrl(n.url, routes)) throw new CoreError("invalid", "Тази страница не е от сайта.", 422);
  const note = build(ctx, { ...n, module: "site", screenshot: null }, "Клиент от сайта", { type: "client" }, NOTE_MSG.emptyClient);
  await ctx.repo.put(COL.notes, note);
  emit(ctx, "note.created", { id: note.id, module: note.module });
  return { id: note.id };
}

export type NoteFilter = { status?: NoteStatus; module?: string; source?: string };
const bySource = (n: FeedbackNote, src: string) => {
  const s = n.source;
  if (src === "client") return !!s && s.type === "client";
  return !!s && s.type === "staff" ? s.role === src : src === "admin";
};
export async function listNotes(ctx: Ctx, f: NoteFilter = {}): Promise<FeedbackNote[]> {
  const where: Partial<FeedbackNote> = {};
  if (f.status) where.status = f.status;
  if (f.module) where.module = f.module;
  return (await ctx.repo.list<FeedbackNote>(COL.notes, where)).filter((n) => !f.source || bySource(n, f.source)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** "Моите препоръки": only the caller's own, read-only */
export async function myNotes(ctx: Ctx, s: StaffCtx): Promise<FeedbackNote[]> {
  return (await listNotes(ctx)).filter((n) => n.source && n.source.type === "staff" && n.source.user === s.user.username);
}

/** NOTES.json / GET ?status=approved: the approved ones, oldest approval first */
export async function approvedNotes(ctx: Ctx): Promise<FeedbackNote[]> {
  return (await listNotes(ctx, { status: "approved" })).sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : 1));
}

export async function setNoteStatus(ctx: Ctx, id: string, status: NoteStatus, actor: string, extra: { reason?: string; change?: FeedbackNote["change"] } = {}): Promise<FeedbackNote> {
  if (!NOTE_STATUSES.includes(status)) throw new CoreError("bad_status", "Невалиден статус.");
  const n = await ctx.repo.get<FeedbackNote>(COL.notes, id);
  if (!n) throw new CoreError("not_found", "Няма такава бележка.", 404);
  const reason = clean(extra.reason, 1000);
  if (status === "rejected" && !reason) throw Object.assign(new CoreError("invalid", NOTE_MSG.reason, 422), { fields: { reason: NOTE_MSG.reason } });
  const at = iso(ctx);
  n.status = status; n.updatedAt = at;
  if (status === "rejected") n.reason = reason; else if (status === "new") delete n.reason;
  if (extra.change !== undefined) n.change = extra.change ? { summary: clean(extra.change.summary, 2000), before: extra.change.before ? clean(extra.change.before, 2000) : undefined, after: extra.change.after ? clean(extra.change.after, 2000) : undefined } : null;
  (n.history ||= []).push({ status, at, who: actor });
  await ctx.repo.put(COL.notes, n);
  await audit(ctx, actor, "note.status", id, { status, ...(reason && status === "rejected" ? { reason } : {}) });
  emit(ctx, "note.status", { id, status });
  return n;
}

export async function deleteNote(ctx: Ctx, id: string, actor: string): Promise<FeedbackNote | null> {
  const n = await ctx.repo.get<FeedbackNote>(COL.notes, id);
  await ctx.repo.del(COL.notes, id);
  if (n) await audit(ctx, actor, "note.delete", id);
  return n;
}
/** "Отмени" after "Изтрий": the same note back (main admin only, checked by the caller) */
export async function restoreNote(ctx: Ctx, n: FeedbackNote, actor: string): Promise<FeedbackNote> {
  if (!n || !n.id || !NOTE_STATUSES.includes(n.status)) throw new CoreError("invalid", "Невалидна бележка.", 422);
  if (await ctx.repo.get(COL.notes, n.id)) throw new CoreError("exists", "Бележката вече е върната.", 409);
  await ctx.repo.put(COL.notes, n);
  await audit(ctx, actor, "note.restore", n.id);
  return n;
}

/** The badge "Бележки" = the number in "Чака те" = only what waits for THIS person (decision 15.11.2026, 2).
    Main admin: new (to approve) + "за преглед". Others: their recommendations whose status changed since they last looked. */
export async function notesWaiting(ctx: Ctx, s: StaffCtx): Promise<{ n: number; newN: number; reviewN: number; changedN: number; title: string }> {
  if (s.user.role === "admin") {
    const all = await listNotes(ctx);
    const newN = all.filter((x) => x.status === "new").length, reviewN = all.filter((x) => x.status === "review").length;
    const parts: string[] = [];
    if (newN) parts.push(newN + (newN === 1 ? " чака одобрение" : " чакат одобрение"));
    if (reviewN) parts.push(reviewN + " за преглед");
    return { n: newN + reviewN, newN, reviewN, changedN: 0, title: parts.join(", ") };
  }
  const seen = await ctx.repo.get<NotesSeen>(COL.notesSeen, s.user.id);
  const changedN = (await myNotes(ctx, s)).filter((x) => x.status !== "new" && (!seen || x.updatedAt > seen.at)).length;
  return { n: changedN, newN: 0, reviewN: 0, changedN, title: changedN ? changedN + (changedN === 1 ? " ваша препоръка е с нов статус" : " ваши препоръки са с нов статус") : "" };
}
/** opening "Бележки" / "Моите препоръки" resets the person's badge (kept on the server, not in the browser) */
export async function markNotesSeen(ctx: Ctx, s: StaffCtx): Promise<NotesSeen> {
  const d: NotesSeen = { id: s.user.id, at: iso(ctx) };
  await ctx.repo.put(COL.notesSeen, d);
  return d;
}
