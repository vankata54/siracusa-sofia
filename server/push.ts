/* Web Push sender for src/core/push.ts: web-push with the VAPID keys from .env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
   made by scripts/make-env.mjs; never in git). Without the keys push is off: /api/push/key answers 503. */
import webpush from "web-push";
import type { PushSender } from "../src/core/index.ts";

export interface Vapid { publicKey: string; privateKey: string; subject: string }

/** the keys from the environment, or null (push off) */
export function vapidFromEnv(env: Record<string, string | undefined> = process.env): Vapid | null {
  const publicKey = env.VAPID_PUBLIC_KEY || "", privateKey = env.VAPID_PRIVATE_KEY || "";
  if (!publicKey || !privateKey) return null;
  /* the contact the push services may use: the site's address (never a personal e-mail) */
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT || env.SITE_URL || "https://siracusa-sofia.com" };
}

export function webPushSender(v: Vapid): PushSender {
  return async (subs, payload) => {
    const gone: string[] = [];
    await Promise.all(subs.map((s) => webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: 3600, urgency: "high", vapidDetails: v, timeout: 10_000 })
      .catch((e: { statusCode?: number; message?: string }) => {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(s.endpoint);
        else console.warn("push: " + (e && (e.statusCode || e.message)));
      })));
    return gone;
  };
}
