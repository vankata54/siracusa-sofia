/* Web Push for the order status (tracking page, "Включи известията" -> "Известие"). One browser subscribes to ONE order
   with the tracking key; when the kitchen / driver changes the status, the server sends a short notification. Nothing
   personal in the text (no name, address, phone), only the order number, the step and the tracking address.
   The sending itself is the server's (web-push with the VAPID keys from .env, ctx.push); the demo has no push server
   (ctx.push is missing: subscribe answers 503 push_unavailable and the page keeps its in-browser notification). */
import { COL, iso, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Iso, type Order, type OrderStatus } from "./types.ts";
import { findTracked, parseTrack, FINISHED } from "./orders.ts";

export interface PushKeys { p256dh: string; auth: string }
export interface PushSub { id: string; orderNo: string; endpoint: string; keys: PushKeys; createdAt: Iso }
export interface PushPayload { title: string; body: string; url: string; tag: string }
/** the server's sender: sends to every subscription, returns the endpoints that are gone (404 / 410) */
export type PushSender = (subs: PushSub[], payload: PushPayload) => Promise<string[]>;

export const PUSH_MAX_PER_ORDER = 5;
export const PUSH_MSG = {
  unavailable: "Известията в браузъра още не работят. Ще видите статуса тук.",
  bad: "Браузърът не даде данни за известията. Опитайте пак.",
  finished: "Поръчката вече е приключила.",
};

/** the words of each step (the same steps as the tracking page; delivery and pickup differ only at "ready") */
export function pushText(o: Pick<Order, "mode" | "status">): string {
  const s: OrderStatus = o.status;
  if (s === "ready") return o.mode === "delivery" ? "Поръчката е готова и скоро тръгва към вас." : "Поръчката е готова. Можете да я вземете.";
  const T: Record<Exclude<OrderStatus, "ready">, string> = {
    accepted: "Приехме поръчката.",
    cooking: "Приготвяме поръчката ви.",
    on_way: "Шофьорът е на път към вас.",
    delivered: "Поръчката е доставена. Добър апетит!",
    picked_up: "Поръчката е взета. Добър апетит!",
    cancelled: "Поръчката е отказана. Обадете ни се на 0894 36 55 77.",
  };
  return T[s];
}

const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
function cleanSub(v: unknown): { endpoint: string; keys: PushKeys } | null {
  const s = (v && typeof v === "object" ? v : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const endpoint = String(s.endpoint || ""), p256dh = String(s.keys?.p256dh || ""), auth = String(s.keys?.auth || "");
  let u: URL | null = null;
  try { u = new URL(endpoint); } catch { /* not a URL */ }
  if (!u || u.protocol !== "https:" || endpoint.length > 1000) return null;
  /* P-256 public key (65 bytes, about 87 characters) and the 16-byte auth secret (about 22) in base64url */
  if (!B64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100 || !B64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;
  return { endpoint, keys: { p256dh, auth } };
}

async function tracked(ctx: Ctx, id: string): Promise<Order> {
  const t = parseTrack(id);
  const o = t && t.key ? await findTracked(ctx, id) : null;
  if (!o) throw new CoreError("not_found", "Няма такава поръчка.", 404);
  return o;
}

export async function pushSubscribe(ctx: Ctx, id: string, sub: unknown): Promise<{ ok: true }> {
  if (!ctx.push) throw new CoreError("push_unavailable", PUSH_MSG.unavailable, 503);
  const o = await tracked(ctx, id);
  if (FINISHED.includes(o.status) || o.status === "cancelled") throw new CoreError("finished", PUSH_MSG.finished, 409);
  const s = cleanSub(sub);
  if (!s) throw new CoreError("invalid", PUSH_MSG.bad, 422);
  const mine = await ctx.repo.list<PushSub>(COL.push, { orderNo: o.no });
  if (mine.some((x) => x.endpoint === s.endpoint)) return { ok: true };
  /* the oldest goes when a sixth browser subscribes (a family on several phones is fine, a flood is not) */
  const old = mine.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, Math.max(0, mine.length - PUSH_MAX_PER_ORDER + 1));
  for (const x of old) await ctx.repo.del(COL.push, x.id);
  await ctx.repo.put<PushSub>(COL.push, { id: rid(12), orderNo: o.no, endpoint: s.endpoint, keys: s.keys, createdAt: iso(ctx) });
  return { ok: true };
}

export async function pushUnsubscribe(ctx: Ctx, id: string, endpoint: string): Promise<{ ok: true }> {
  const o = await tracked(ctx, id);
  for (const x of await ctx.repo.list<PushSub>(COL.push, { orderNo: o.no })) if (x.endpoint === String(endpoint || "")) await ctx.repo.del(COL.push, x.id);
  return { ok: true };
}

/** After a status change: send to the order's browsers, forget the ones that are gone, and all of them when it ends. */
export async function pushStatus(ctx: Ctx, o: Order): Promise<number> {
  if (!ctx.push) return 0;
  const subs = await ctx.repo.list<PushSub>(COL.push, { orderNo: o.no });
  if (!subs.length) return 0;
  const id = o.no + (o.key ? "-" + o.key : "");
  const payload: PushPayload = { title: "Поръчка № " + o.no + " · Siracusa", body: pushText(o), url: "/porachka/" + id + "/", tag: "sc-order-" + o.no };
  let gone: string[] = [];
  try { gone = await ctx.push(subs, payload); } catch { /* a push service that is down never breaks the status change */ }
  const end = FINISHED.includes(o.status) || o.status === "cancelled";
  for (const x of subs) if (end || gone.includes(x.endpoint)) await ctx.repo.del(COL.push, x.id);
  return subs.length;
}
