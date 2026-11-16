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

import { scrubPersonal } from "./scrub.ts";
export { scrubPersonal };
const clean = (s: unknown, max: number) => scrubPersonal(String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim()).slice(0, max);
/* the secret key of an order never goes into a note: /porachka/1042-k7f3m2pq/ -> /porachka/ */
const noKeys = (p: string) => p.replace(/^\/porachka\/[^/?#]*\/?/, "/porachka/");
/** the address of the note: only a path of this site ("/..."), never "//host", "javascript:" or markup; a customer's
    note keeps only the path (no "?" or "#", they can hold codes and keys), a staff note keeps the screen state after "#" */
function noteUrl(raw: unknown, keepHash: boolean): string {
  let u = String(raw ?? "").replace(/[\u0000-\u001f\s]/g, "").slice(0, 600);
  if (!/^\/(?!\/|\\)/.test(u) || /[<>"'`]/.test(u)) return "";
  const hash = u.includes("#") ? u.slice(u.indexOf("#")) : "";
  const path = u.split("#")[0];
  u = noKeys(keepHash ? path : path.split("?")[0]) + (keepHash ? hash : "");
  return scrubPersonal(u);
}
/** a CSS selector / an id from the page: plain text, short, no personal data */
const plain = (s: unknown, max: number) => scrubPersonal(String(s ?? "").replace(/[\u0000-\u001f]/g, "").trim()).slice(0, max);
const SHOT = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

function build(ctx: Ctx, n: NoteInput, author: string, source: NoteSource, emptyMsg: string): FeedbackNote {
  const text = clean(n.text, 4000);
  if (!text) throw Object.assign(new CoreError("invalid", emptyMsg, 422), { fields: { text: emptyMsg } });
  const module = String(n.module ?? "").trim().slice(0, 20), url = noteUrl(n.url, source.type === "staff");
  if (!module || !url) throw new CoreError("invalid", "Липсва модул или адрес.", 422);
  if (!MODULES.includes(module)) throw new CoreError("invalid", "Непознат модул.", 422);
  const now = iso(ctx);
  const w = Math.round(+(n.viewport && n.viewport.w) || 0), h = Math.round(+(n.viewport && n.viewport.h) || 0);
  return {
    id: rid(8), module, url, selector: plain(n.selector, 600), editId: n.editId ? plain(n.editId, 80) : null,
    text, elementText: n.elementText ? clean(n.elementText, 500) : "",
    viewport: { w: w > 0 && w < 10000 ? w : 0, h: h > 0 && h < 10000 ? h : 0 },
    screenshot: n.screenshot && String(n.screenshot).length < 1_500_000 && SHOT.test(String(n.screenshot)) ? n.screenshot : null,
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
  if (!p.startsWith("/") || p.startsWith("//") || /^\/(admin|api|servitor|kuhnya|shofyor)(\/|$)/i.test(p)) return false;
  const norm = p.endsWith("/") ? p : p + "/";
  return routes.includes(norm) || /^\/porachka\/\d{1,9}(?:-[a-z0-9]{4,32})?\/$/.test(norm);
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

/* the order of the steps (decision 15.11.2026: first review, then "Публикувай"); the way back is one step ("Отмени") */
export const NOTE_FLOW: Record<NoteStatus, NoteStatus[]> = {
  new: ["approved", "rejected"],
  approved: ["doing", "rejected", "new"],
  doing: ["review", "rejected", "approved"],
  review: ["published", "doing", "rejected"],
  published: ["review"],
  rejected: ["new"],
};

/** actor: the username (the log); extra.who: the name shown in the note's history */
export async function setNoteStatus(ctx: Ctx, id: string, status: NoteStatus, actor: string, extra: { reason?: string; change?: FeedbackNote["change"]; who?: string } = {}): Promise<FeedbackNote> {
  if (!NOTE_STATUSES.includes(status)) throw new CoreError("bad_status", "Невалиден статус.");
  const n = await ctx.repo.get<FeedbackNote>(COL.notes, id);
  if (!n) throw new CoreError("not_found", "Няма такава бележка.", 404);
  if (n.status !== status && !NOTE_FLOW[n.status].includes(status)) throw new CoreError("bad_step", "Тази стъпка не е позволена за бележката сега. Опреснете страницата.", 409);
  const reason = clean(extra.reason, 1000);
  if (status === "rejected" && !reason) throw Object.assign(new CoreError("invalid", NOTE_MSG.reason, 422), { fields: { reason: NOTE_MSG.reason } });
  const at = iso(ctx);
  n.status = status; n.updatedAt = at;
  if (status === "rejected") n.reason = reason; else if (status === "new") delete n.reason;
  if (extra.change !== undefined) n.change = extra.change ? { summary: clean(extra.change.summary, 2000), before: extra.change.before ? clean(extra.change.before, 2000) : undefined, after: extra.change.after ? clean(extra.change.after, 2000) : undefined } : null;
  (n.history ||= []).push({ status, at, who: String(extra.who || actor).slice(0, 80) });
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
/** "Отмени" after "Изтрий": the same note back (main admin only, checked by the caller); checked like a new one */
export async function restoreNote(ctx: Ctx, n: FeedbackNote, actor: string): Promise<FeedbackNote> {
  if (!n || typeof n !== "object" || !/^[0-9a-f]{8,32}$/.test(String(n.id)) || !NOTE_STATUSES.includes(n.status)) throw new CoreError("invalid", "Невалидна бележка.", 422);
  if (await ctx.repo.get(COL.notes, n.id)) throw new CoreError("exists", "Бележката вече е върната.", 409);
  const src: NoteSource = n.source && n.source.type === "client" ? { type: "client" } : n.source && n.source.type === "staff" ? { type: "staff", role: n.source.role, user: String(n.source.user).slice(0, 64) } : { type: "staff", role: "admin", user: actor };
  const b = build(ctx, n, String(n.author || "").slice(0, 80), src, NOTE_MSG.empty);
  const at = (v: unknown) => (typeof v === "string" && !isNaN(Date.parse(v)) ? v : b.createdAt);
  const back: FeedbackNote = {
    ...b, id: n.id, status: n.status, createdAt: at(n.createdAt), updatedAt: at(n.updatedAt),
    reason: n.reason ? clean(n.reason, 1000) : undefined,
    change: n.change ? { summary: clean(n.change.summary, 2000), before: n.change.before ? clean(n.change.before, 2000) : undefined, after: n.change.after ? clean(n.change.after, 2000) : undefined } : null,
    history: Array.isArray(n.history) ? n.history.filter((h) => h && NOTE_STATUSES.includes(h.status)).slice(-50).map((h) => ({ status: h.status, at: at(h.at), who: String(h.who || "").slice(0, 80) })) : b.history,
  };
  await ctx.repo.put(COL.notes, back);
  await audit(ctx, actor, "note.restore", n.id);
  return back;
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
