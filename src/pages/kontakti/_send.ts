/* Contacts (/kontakti/): sending the feedback form through the core (api.feedback.create: server and demo).
   Errors from the core are ApiError with fields name / contact / message; "offline" becomes OfflineError. */
import type { Sent } from "./_live.ts";

export class OfflineError extends Error { constructor() { super("offline"); } }

export async function sendFeedback(msg: Sent, opts: { offline?: boolean } = {}): Promise<{ ok: true }> {
  if (opts.offline || (typeof navigator !== "undefined" && navigator.onLine === false)) throw new OfflineError();
  const { api, ApiError } = await import("../../client/api.ts");
  try {
    await api.feedback.create({ name: msg.name, contact: msg.contact, mode: msg.mode, message: msg.msg, topic: msg.topic || undefined });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.code === "offline") throw new OfflineError();
    throw e;
  }
}
