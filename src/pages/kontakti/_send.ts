/* Contacts (/kontakti/): sending the feedback form through the core (api.feedback.create: server and demo).
   Errors from the core are ApiError with fields name / contact / message; "offline" becomes OfflineError. */
import type { Sent } from "./_live.ts";
import { loadModule } from "../../lib/load.ts";

const apiChunk = () => import("../../client/api.ts");

export class OfflineError extends Error { constructor() { super("offline"); } }

export async function sendFeedback(msg: Sent, opts: { offline?: boolean } = {}): Promise<{ ok: true }> {
  if (opts.offline || (typeof navigator !== "undefined" && navigator.onLine === false)) throw new OfflineError();
  /* a failed load is retried (the browser would remember it); still failing = no connection */
  const { api, ApiError } = await loadModule(apiChunk).catch(() => { throw new OfflineError(); });
  try {
    await api.feedback.create({ name: msg.name, contact: msg.contact, mode: msg.mode, message: msg.msg, topic: msg.topic || undefined });
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError && e.code === "offline") throw new OfflineError();
    throw e;
  }
}
