/* Pencil notes ("молив") and recommendations (decision 15.11.2026).
   - Every staff role writes recommendations with the pencil (they change nothing); customers write one with
     "Предложи подобрение" on the site (no sign-in, POST /api/notes/suggest: only site addresses, no personal data).
   - Statuses: new -> approved -> doing -> review -> published, or rejected (with a reason). Only the role admin changes
     them ("Одобри и изпълни", "Публикувай"); nothing goes straight to the live site.
   - The next Claude session reads GET /api/admin/notes?status=approved (or docs/NOTES.json, only the approved ones). */
import { COL, emit, iso, rid, type Ctx } from "./ctx.ts";
import { CoreError, NOTE_STATUSES, type FeedbackNote, type NoteQuestion, type NoteSource, type NoteStatus, type NotesSeen } from "./types.ts";
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
/* cut first (a 60 KB text never reaches the patterns), then scrub, then cut again (a marker can be longer than the number) */
const clean = (s: unknown, max: number) => scrubPersonal(String(s ?? "").slice(0, max + 64).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim(), max + 64).slice(0, max);
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
const plain = (s: unknown, max: number) => scrubPersonal(String(s ?? "").slice(0, max + 64).replace(/[\u0000-\u001f]/g, "").trim(), max + 64).slice(0, max);
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

/** kind: "answer" = only the owner's answers to the questions ("Отговори на въпроси"), "note" = everything else */
export type NoteFilter = { status?: NoteStatus; module?: string; source?: string; kind?: "answer" | "note" };
const bySource = (n: FeedbackNote, src: string) => {
  const s = n.source;
  if (src === "client") return !!s && s.type === "client";
  return !!s && s.type === "staff" ? s.role === src : src === "admin";
};
export async function listNotes(ctx: Ctx, f: NoteFilter = {}): Promise<FeedbackNote[]> {
  const where: Partial<FeedbackNote> = {};
  if (f.status) where.status = f.status;
  if (f.module) where.module = f.module;
  const kind = f.kind === "answer" || f.kind === "note" ? f.kind : null;
  return (await ctx.repo.list<FeedbackNote>(COL.notes, where)).filter((n) => (!f.source || bySource(n, f.source)) && (!kind || (kind === "answer") === (n.kind === "answer")))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
export async function setNoteStatus(ctx: Ctx, id: string, status: NoteStatus, actor: string, extra: { reason?: string; change?: FeedbackNote["change"]; who?: string; fix?: string } = {}): Promise<FeedbackNote> {
  if (!NOTE_STATUSES.includes(status)) throw new CoreError("bad_status", "Невалиден статус.");
  const n = await ctx.repo.get<FeedbackNote>(COL.notes, id);
  if (!n) throw new CoreError("not_found", "Няма такава бележка.", 404);
  if (n.status !== status && !NOTE_FLOW[n.status].includes(status)) throw new CoreError("bad_step", "Тази стъпка не е позволена за бележката сега. Опреснете страницата.", 409);
  const reason = clean(extra.reason, 1000);
  if (status === "rejected" && !reason) throw Object.assign(new CoreError("invalid", NOTE_MSG.reason, 422), { fields: { reason: NOTE_MSG.reason } });
  const at = iso(ctx);
  n.status = status; n.updatedAt = at;
  if (status === "rejected") n.reason = reason; else if (status === "new") delete n.reason;
  /* "Върни за поправка" (review -> doing): what to fix, for the next session */
  const fix = clean(extra.fix, 1000);
  if (status === "doing" && fix) n.fix = fix; else if (status !== "doing") delete n.fix;
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
  /* an answer of the owner stays an answer (its question and the earlier answers) */
  if (n.kind === "answer" && n.q && typeof n.q === "object") { back.kind = "answer"; back.q = n.q; if (Array.isArray(n.answers)) back.answers = n.answers.slice(-20); }
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

/* ---------- the owner's answers to the questions of the agency ("Решения", core/owner.ts) ----------
   One note per question (kind "answer"): a new answer replaces the text and the question of the same note, keeps the earlier
   one in `answers` (the newest last) and puts the status back to "new" (the main admin reviews it again); "Отмени" brings
   the earlier one back exactly (text, status, history), or removes the note when it was the first answer. Nothing in the
   system changes until the main admin applies it (decision 16.11.2026). The rights are checked by the caller (owner.ts). */
export const ANSWER_APPLIED: NoteStatus[] = ["approved", "doing", "review", "published"];
export async function answerNote(ctx: Ctx, qid: string, all?: FeedbackNote[]): Promise<FeedbackNote | null> {
  return (all || (await listNotes(ctx, { kind: "answer" }))).find((n) => n.kind === "answer" && !!n.q && n.q.id === qid) || null;
}
export interface SavedAnswer { note: FeedbackNote; replaced: boolean; /** the agency had already approved or applied the earlier answer */ applied: boolean }
export async function saveAnswer(ctx: Ctx, s: StaffCtx, q: NoteQuestion, text: string, url: string): Promise<SavedAnswer> {
  const cur = await answerNote(ctx, q.id), now = iso(ctx), clean4 = clean(text, 4000);
  if (!cur) {
    const n = build(ctx, { module: "owner", url, selector: '[data-qid="' + q.id + '"]', editId: "own.decisions.question", text: clean4, elementText: q.text, viewport: { w: 0, h: 0 } },
      s.user.name, { type: "staff", role: s.user.role, user: s.user.username }, NOTE_MSG.empty);
    n.kind = "answer"; n.q = q;
    await ctx.repo.put(COL.notes, n);
    await audit(ctx, s.user.username, "note.create", n.id, { module: n.module, kind: "answer", question: q.id, answer: q.answer });
    emit(ctx, "note.created", { id: n.id, module: n.module, kind: "answer" });
    return { note: n, replaced: false, applied: false };
  }
  const applied = ANSWER_APPLIED.includes(cur.status);
  cur.answers = [...(cur.answers || []), { at: cur.updatedAt, text: cur.text, q: cur.q!, status: cur.status, ...(cur.reason ? { reason: cur.reason } : {}), history: (cur.history || []).slice(-50) }].slice(-20);
  cur.text = clean4; cur.q = q; cur.status = "new"; cur.updatedAt = now; delete cur.reason; delete cur.fix; cur.change = null;
  (cur.history ||= []).push({ status: "new", at: now, who: s.user.name });
  await ctx.repo.put(COL.notes, cur);
  await audit(ctx, s.user.username, "note.update", cur.id, { kind: "answer", question: q.id, answer: q.answer, was: cur.answers[cur.answers.length - 1].q.answer, applied });
  emit(ctx, "note.status", { id: cur.id, status: "new" });
  return { note: cur, replaced: true, applied };
}
/** "Отмени" of the last answer to a question (only its author, within `windowMs`): the earlier answer back, or no note.
    Returns the note after it (null: removed). 409 "undo_late" otherwise. */
export async function undoAnswer(ctx: Ctx, s: StaffCtx, qid: string, windowMs: number): Promise<FeedbackNote | null> {
  const n = await answerNote(ctx, qid), late = () => new CoreError("undo_late", "Вече не може да се отмени.", 409);
  if (!n || !n.source || n.source.type !== "staff" || n.source.user !== s.user.username) throw late();
  if (Date.parse(iso(ctx)) - Date.parse(n.updatedAt) > windowMs) throw late();
  const prev = (n.answers || []).pop();
  if (!prev) {
    await ctx.repo.del(COL.notes, n.id);
    await audit(ctx, s.user.username, "note.delete", n.id, { kind: "answer", question: qid, undo: true });
    emit(ctx, "note.status", { id: n.id, status: "deleted" });
    return null;
  }
  n.text = prev.text; n.q = prev.q; n.status = prev.status; n.updatedAt = prev.at; n.history = prev.history || n.history;
  if (prev.reason) n.reason = prev.reason; else delete n.reason;
  await ctx.repo.put(COL.notes, n);
  await audit(ctx, s.user.username, "note.update", n.id, { kind: "answer", question: qid, undo: true });
  emit(ctx, "note.status", { id: n.id, status: n.status });
  return n;
}
