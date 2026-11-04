/* Pencil notes ("молив"): what to change, on which element. The next Claude session reads
   GET /api/admin/notes?status=new (or docs/NOTES.json) and works through them. */
import { COL, emit, iso, rid, type Ctx } from "./ctx.ts";
import { CoreError, type FeedbackNote, type NoteStatus } from "./types.ts";
import { audit } from "./audit.ts";

export type NoteInput = Omit<FeedbackNote, "id" | "status" | "createdAt" | "updatedAt" | "author">;

export async function createNote(ctx: Ctx, n: NoteInput, author: string): Promise<FeedbackNote> {
  if (!String(n.text || "").trim()) throw Object.assign(new CoreError("invalid", "Напишете какво да се промени.", 422), { fields: { text: "Напишете какво да се промени." } });
  if (!n.module || !n.url) throw new CoreError("invalid", "Липсва модул или адрес.", 422);
  const now = iso(ctx);
  const note: FeedbackNote = {
    id: rid(8), module: String(n.module), url: String(n.url), selector: String(n.selector || ""), editId: n.editId || null,
    text: String(n.text).trim().slice(0, 4000), elementText: n.elementText ? String(n.elementText).slice(0, 500) : "",
    viewport: { w: +n.viewport?.w || 0, h: +n.viewport?.h || 0 },
    screenshot: n.screenshot && String(n.screenshot).startsWith("data:image/") && String(n.screenshot).length < 1_500_000 ? n.screenshot : null,
    author, status: "new", createdAt: now, updatedAt: now,
  };
  await ctx.repo.put(COL.notes, note);
  emit(ctx, "note.created", { id: note.id, module: note.module });
  return note;
}

export async function listNotes(ctx: Ctx, f: { status?: NoteStatus; module?: string } = {}): Promise<FeedbackNote[]> {
  const where: Partial<FeedbackNote> = {};
  if (f.status) where.status = f.status;
  if (f.module) where.module = f.module;
  return (await ctx.repo.list<FeedbackNote>(COL.notes, where)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function setNoteStatus(ctx: Ctx, id: string, status: NoteStatus, actor: string): Promise<FeedbackNote> {
  if (!["new", "doing", "done"].includes(status)) throw new CoreError("bad_status", "Невалиден статус.");
  const n = await ctx.repo.get<FeedbackNote>(COL.notes, id);
  if (!n) throw new CoreError("not_found", "Няма такава бележка.", 404);
  n.status = status; n.updatedAt = iso(ctx);
  await ctx.repo.put(COL.notes, n);
  await audit(ctx, actor, "note.status", id, { status });
  emit(ctx, "note.status", { id, status });
  return n;
}

export async function deleteNote(ctx: Ctx, id: string, actor: string): Promise<void> {
  await ctx.repo.del(COL.notes, id);
  await audit(ctx, actor, "note.delete", id);
}
