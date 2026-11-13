/* Web Push for one order, loaded only when the guest taps "Включи известията" (tracking page). Registers /sw.js (push only,
   no cache), asks the browser for a subscription with the server's VAPID key and gives it to the order (api.push).
   Answers: "on" (the server will send), "local" (no push server, e.g. the demo or a browser without push: the page keeps
   its in-browser notification while it is open), "denied" (the guest or the browser said no). */
import { api } from "./api.ts";

export type PushResult = "on" | "local" | "denied";

const b64 = (s: string): Uint8Array => {
  const p = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function pushOrder(no: string | number): Promise<PushResult> {
  if (!("Notification" in window)) return "denied";
  let perm = Notification.permission;
  if (perm === "default") { try { perm = await Notification.requestPermission(); } catch { /* old API */ } }
  if (perm !== "granted") return "denied";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || document.documentElement.dataset.demo) return "local";
  try {
    const key = await api.push.key();
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) as BufferSource }));
    await api.push.subscribe(no, sub.toJSON());
    return "on";
  } catch {
    /* no push server (503), an old browser, a blocked push service, an order that just ended: the page still tells the
       guest while it is open */
    return "local";
  }
}

/** "Изключи": the order forgets this browser (the browser keeps its subscription for other orders) */
export async function pushOff(no: string | number): Promise<void> {
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined;
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) await api.push.unsubscribe(no, sub.endpoint);
  } catch { /* nothing to undo */ }
}
