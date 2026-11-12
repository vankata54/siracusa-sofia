/* Contact messages from /kontakti/ ("Пишете ни"). Kept in the core for the admin; the server limits how often one
   address may send. contact: a phone (10 digits) or an e-mail; mode says which one when the page knows it. */
import { COL, emit, iso, rid, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import { normPhone } from "../lib/format.ts";

export interface FeedbackInput { name: string; contact: string; message: string; mode?: "phone" | "email"; topic?: string }
export interface Feedback {
  id: string; name: string; contact: string; mode: "phone" | "email"; message: string; topic?: string;
  status: "new" | "done"; createdAt: string; updatedAt: string;
}
export const FEEDBACK_MSG = {
  name: "Напишете името си.",
  contact: "Напишете телефон (10 цифри, например 0888 12 34 56) или имейл (например ime@primer.bg).",
  phone: "Телефонът трябва да е 10 цифри, например 0888 12 34 56.",
  email: "Проверете имейла, например ime@primer.bg.",
  message: "Напишете съобщението си (поне няколко думи).",
  long: "Съобщението е твърде дълго (до 2000 знака).",
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function createFeedback(ctx: Ctx, f: FeedbackInput): Promise<Feedback> {
  const errs: Record<string, string> = {};
  const name = String((f && f.name) || "").trim(), raw = String((f && f.contact) || "").trim(), msg = String((f && f.message) || "").trim();
  if (!name || name.length > 80) errs.name = FEEDBACK_MSG.name;
  const asMail = f && f.mode === "email" ? true : f && f.mode === "phone" ? false : raw.includes("@");
  let contact = "";
  if (!raw) errs.contact = FEEDBACK_MSG.contact;
  else if (asMail) { if (EMAIL.test(raw) && raw.length <= 120) contact = raw.toLowerCase(); else errs.contact = FEEDBACK_MSG.email; }
  else { const p = normPhone(raw); if (p) contact = p; else errs.contact = FEEDBACK_MSG.phone; }
  if (msg.length < 3) errs.message = FEEDBACK_MSG.message;
  else if (msg.length > 2000) errs.message = FEEDBACK_MSG.long;
  if (Object.keys(errs).length) throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields: errs });
  const now = iso(ctx);
  const doc: Feedback = {
    id: rid(8), name, contact, mode: asMail ? "email" : "phone", message: msg, ...(f.topic ? { topic: String(f.topic).slice(0, 60) } : {}),
    status: "new", createdAt: now, updatedAt: now,
  };
  await ctx.repo.put(COL.feedback, doc);
  emit(ctx, "feedback.created", { id: doc.id, topic: doc.topic || "" });
  return doc;
}

export async function listFeedback(ctx: Ctx): Promise<Feedback[]> {
  return (await ctx.repo.list<Feedback>(COL.feedback)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
