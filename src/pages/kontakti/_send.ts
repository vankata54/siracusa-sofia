/* Contacts (/kontakti/): sending the feedback form.
   TEMPORARY: src/client/api.ts has no method for a contact message (and the core has no "feedback" store yet), so the page
   sends through this one thin function. It checks the connection and answers like the prototype (about 1 s); nothing
   leaves the browser. When the boss adds e.g. api.feedback.create({topic, name, mode, contact, msg}), only the body of
   sendFeedback() changes (see reviews-code/contacts.agent.md, "Искания към шефа"). */
import type { Sent } from "./_live.ts";

export class OfflineError extends Error { constructor() { super("offline"); } }

export async function sendFeedback(_msg: Sent, opts: { offline?: boolean } = {}): Promise<{ ok: true }> {
  await new Promise((r) => setTimeout(r, 1100));
  if (opts.offline || (typeof navigator !== "undefined" && navigator.onLine === false)) throw new OfflineError();
  return { ok: true };
}
