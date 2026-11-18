/* Orders in the admin (section "Поръчки"; design/pages-admin/orders.html, README-2 "Поръчките за деня: полета"):
   - the list with filters (status or "work" / "done", channel, the Sofia day, text: №, the last digits of the phone, the
     address), the phone masked; "Закъснява" by the zone's minutes (delivery) or 20 minutes (pickup, table);
   - the detail (the steps with their times, the lines with the unit price, the sums), the phone and e-mail masked;
   - "Покажи телефона": the whole number on purpose, into the log (order.phone_view);
   - the status: the existing one step (orders.ts stepAllowed); "Откажи" with a reason (required, the customer sees it);
   - "Нова поръчка по телефон" (the main admin, the owner, the manager): the customer's phone and name, delivery or
     pickup, the time ("Възможно най-скоро" or later today), the dishes; the price, the zone, the hours and the lunch rules
     come from the core (createOrder, channel "phone"); no marketing consent, no profile bonus, no code, no guest limits.
     Log: order.create with the staff member. The kitchen hears it like a web order (order.created). */
import { liveOrders, ordersPage, OPEN_STATUSES } from "./order-index.ts";
import { audit } from "./audit.ts";
import { COL, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, PAY_LABEL, type Channel, type Order, type OrderStatus, type PayMethod } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, needBoss, may, invalid, maskPhone, maskEmail, serial } from "./rights.ts";
import { createOrder, setOrderStatus, FINISHED, STATUS_LABEL, FLOW, nextStatus } from "./orders.ts";
import { liveZones } from "./zones.ts";
import { sofiaYmd, minutes, addDaysYmd } from "../lib/time.ts";
import type { Cart } from "../lib/cart.ts";

export const CHANNEL_LABEL: Record<Channel, string> = { web: "Сайт", qr: "Маса", waiter: "Маса", phone: "Телефон", office: "Офис" };
export const LATE_PICKUP_MIN = 20;
export const ORDERS_MSG = {
  notFound: "Няма такава поръчка.",
  reason: "Напишете причината (до 200 знака): клиентът я вижда.",
};

export interface OrderRow {
  no: string; status: OrderStatus; statusLabel: string; channel: Channel; channelLabel: string; mode: Order["mode"];
  placedAt: string; ts: number; at: string; sched: string; zone: string; table: string | null; name: string; phone: string;
  lines: { id: string; name: string; q: number; mods: string[] }[]; sub: number; disc: number; fee: number | null; total: number;
  pay: PayMethod; payLabel: string; next: OrderStatus | null; late: boolean; minutesAgo: number; reason?: string; by?: string;
}
export interface OrderDetail extends OrderRow {
  addr: string; email: string; note?: string; code?: string; codeDisc?: number; profileDisc?: number; discKind?: Order["discKind"];
  times: Partial<Record<OrderStatus, string>>; steps: { status: OrderStatus; label: string; at: string | null }[];
  lines: { id: string; name: string; q: number; mods: string[]; unit: number | null; sum: number | null }[];
}
export interface OrdersQuery { status?: OrderStatus | "work" | "done"; channel?: Channel | "table"; day?: string; q?: string; limit?: number }

const dayOf = (o: Order) => sofiaYmd(new Date(o.ts || o.createdAt));
async function lateOf(ctx: Ctx, o: Order, zoneMin: Map<string, number>): Promise<boolean> {
  if (FINISHED.includes(o.status) || o.status === "cancelled" || o.sched || dayOf(o) !== sofiaYmd(nowDate(ctx))) return false;
  /* pickup and a table order are late only while not ready (the same rule as the manager's module: core/shift.ts lateMinOf) */
  if (o.mode !== "delivery" && o.status === "ready") return false;
  const placed = +o.placedAt.slice(0, 2) * 60 + +o.placedAt.slice(3), now = minutes(ctx.clock);
  const due = /^\d{2}:\d{2}$/.test(o.at) ? +o.at.slice(0, 2) * 60 + +o.at.slice(3) : placed + (o.mode === "delivery" ? zoneMin.get(o.zone) || 35 : LATE_PICKUP_MIN);
  return now > due;
}
function rowOf(o: Order, late: boolean, now: number): OrderRow {
  const placed = +o.placedAt.slice(0, 2) * 60 + +o.placedAt.slice(3);
  return {
    no: o.no, status: o.status, statusLabel: STATUS_LABEL[o.status], channel: o.channel, channelLabel: CHANNEL_LABEL[o.channel] || o.channel, mode: o.mode,
    placedAt: o.placedAt, ts: o.ts, at: o.at, sched: o.sched, zone: o.zone, table: o.table || null, name: o.name, phone: maskPhone(o.phone),
    lines: o.lines.map((l) => ({ id: l.id, name: l.name || l.id, q: l.q, mods: l.mods })), sub: o.sub, disc: o.disc, fee: o.fee, total: o.total,
    pay: o.pay, payLabel: o.payLabel, next: o.status === "cancelled" ? null : nextStatus(o), late, minutesAgo: Math.max(0, now - placed),
    ...(o.reason ? { reason: o.reason } : {}), ...(o.by ? { by: o.by } : {}),
  };
}

/** The list (newest first). day: "YYYY-MM-DD" (Sofia, default today; "all" for every day). */
export async function ordersList(ctx: Ctx, s: StaffCtx, q: OrdersQuery = {}): Promise<{ day: string; rows: OrderRow[]; counts: Record<string, number> }> {
  need(s, "orders");
  const today = sofiaYmd(nowDate(ctx)), day = q.day === "all" ? "all" : q.day && /^\d{4}-\d{2}-\d{2}$/.test(q.day) ? q.day : today;
  const zoneMin = new Map((await liveZones(ctx)).map((z) => [z.n, z.etaMin]));
  /* never the whole table: a day reads the days around it by the index (a calendar day holds orders of the shift day
     before it, 00:00-04:00, and the pre-orders "за утре" of the day after); "Всички дни" asks the repo for the counts by
     status and the newest orders that pass the filters, by its columns (core/order-index.ts) */
  const text = String(q.q || "").trim().toLowerCase(), dg = text.replace(/\D/g, "");
  const now = minutes(ctx.clock), limit = Math.min(500, Math.max(1, q.limit || 300));
  const counts: Record<string, number> = { work: 0, done: 0 };
  let shown: Order[];
  if (day === "all") {
    const statuses = !q.status ? null : q.status === "work" ? OPEN_STATUSES : q.status === "done" ? FINISHED : [q.status];
    const channels = !q.channel ? null : q.channel === "table" ? ["qr", "waiter"] : [q.channel];
    const r = await ordersPage(ctx, { statuses, channels, text, digits: dg, limit });
    for (const [k, v] of Object.entries(r.counts)) { counts[k] = v; if (FINISHED.includes(k as Order["status"])) counts.done += v; else if (k !== "cancelled") counts.work += v; }
    shown = r.orders;
  } else {
    const all = (await liveOrders(ctx, addDaysYmd(day, -1), addDaysYmd(day, 1))).filter((o) => dayOf(o) === day).sort((a, b) => +b.no - +a.no);
    for (const o of all) { counts[o.status] = (counts[o.status] || 0) + 1; if (FINISHED.includes(o.status)) counts.done++; else if (o.status !== "cancelled") counts.work++; }
    const ch = (o: Order) => !q.channel || (q.channel === "table" ? o.channel === "qr" || o.channel === "waiter" : o.channel === q.channel);
    const st = (o: Order) => !q.status || (q.status === "work" ? !FINISHED.includes(o.status) && o.status !== "cancelled" : q.status === "done" ? FINISHED.includes(o.status) : o.status === q.status);
    const tx = (o: Order) => !text || o.no === dg || (dg.length >= 3 && o.phone.endsWith(dg)) || (text.length >= 3 && (o.addr || "").toLowerCase().includes(text)) || (text.length >= 2 && o.name.toLowerCase().includes(text));
    shown = all.filter((o) => ch(o) && st(o) && tx(o)).slice(0, limit);
  }
  return { day, rows: await Promise.all(shown.map(async (o) => rowOf(o, await lateOf(ctx, o, zoneMin), now))), counts };
}

async function getO(ctx: Ctx, no: string): Promise<Order> {
  const o = await ctx.repo.get<Order>(COL.orders, String(no || ""));
  if (!o) throw new CoreError("not_found", ORDERS_MSG.notFound, 404);
  return o;
}
export async function orderDetail(ctx: Ctx, s: StaffCtx, no: string): Promise<OrderDetail> {
  need(s, "orders");
  const o = await getO(ctx, no);
  const zoneMin = new Map((await liveZones(ctx)).map((z) => [z.n, z.etaMin]));
  const r = rowOf(o, await lateOf(ctx, o, zoneMin), minutes(ctx.clock));
  const times = o.times || { accepted: o.createdAt };
  const steps = [...FLOW[o.mode], ...(o.status === "cancelled" ? ["cancelled" as const] : [])].map((st) => ({ status: st, label: STATUS_LABEL[st], at: times[st] || null }));
  return {
    ...r, addr: o.addr, email: maskEmail(o.email), note: o.note, code: o.code, codeDisc: o.codeDisc, profileDisc: o.profileDisc, discKind: o.discKind, times, steps,
    lines: o.lines.map((l) => ({ id: l.id, name: l.name || l.id, q: l.q, mods: l.mods, unit: l.unit ?? null, sum: l.unit != null ? Math.round(l.unit * l.q * 100) / 100 : null })),
  };
}
/** "Покажи телефона": the whole number (and e-mail), and a line in the log */
export async function orderPhone(ctx: Ctx, s: StaffCtx, no: string): Promise<{ phone: string; email: string | null }> {
  need(s, "orders");
  const o = await getO(ctx, no);
  await audit(ctx, s.user.username, "order.phone_view", o.no);
  return { phone: o.phone, email: o.email || null };
}
/** "Откажи" with the reason (required, the customer sees it on the tracking page). The way back: the status step to the
    status it had (orders.ts). Log: order.status (+ the reason). */
export async function orderCancel(ctx: Ctx, s: StaffCtx, no: string, reason: string): Promise<OrderDetail> {
  need(s, "orders");
  const why = String(reason || "").replace(/\s+/g, " ").trim();
  if (!why || why.length > 200) invalid({ reason: ORDERS_MSG.reason });
  await getO(ctx, no);
  /* under the order's lock, as the kitchen's tablets and "step" (review 2 of the kitchen, round 3) */
  await serial(ctx.repo, "order:" + String(no || ""), () => setOrderStatus(ctx, no, "cancelled", s.user.username, s, why));
  return orderDetail(ctx, s, no);
}
/** one step forward / back (or back from "Отказана"): orders.ts stepAllowed */
export async function orderStep(ctx: Ctx, s: StaffCtx, no: string, status: OrderStatus): Promise<OrderDetail | { no: string; status: OrderStatus }> {
  need(s, ["orders", "kitchen", "driver"]);
  if (status === "cancelled" && (s.user.role === "admin" || s.sections.includes("orders"))) throw new CoreError("reason_required", ORDERS_MSG.reason, 422);
  /* one change of an order at a time, together with the kitchen's tablets (core/kitchen.ts: the same lock) */
  const o = await serial(ctx.repo, "order:" + String(no || ""), () => setOrderStatus(ctx, no, status, s.user.username, s));
  return may(s, "orders") ? orderDetail(ctx, s, no) : { no: o.no, status: o.status };
}

export interface PhoneOrderInput {
  phone: string; name: string; mode: "delivery" | "pickup"; addr?: string; zone?: string;
  /** "asap" or "HH:MM" later today (delivery until 20:45, pickup by the pickup rules) */
  slot?: string; lines: Cart["lines"] | { id: string; q: number; mods?: string[] }[]; note?: string; pay?: PayMethod;
}
/** "Нова поръчка по телефон": the main admin, the owner, the manager. Log: order.create. */
export async function phoneOrder(ctx: Ctx, s: StaffCtx, i: PhoneOrderInput): Promise<OrderDetail> {
  needBoss(s, "orders");
  const p = i && typeof i === "object" ? i : ({} as PhoneOrderInput);
  const mode = p.mode === "pickup" ? "pickup" : "delivery";
  const lines = (Array.isArray(p.lines) ? p.lines : []).map((l) => ({ key: "", id: String(l && l.id), q: l && l.q, mods: Array.isArray(l && l.mods) ? l.mods : [], extra: 0 }));
  const o = await createOrder(ctx, {
    cart: { mode, lines } as unknown as Cart, zone: p.zone, addr: p.addr, pay: p.pay && PAY_LABEL[p.pay] ? p.pay : "cash", name: p.name, phone: p.phone,
    note: p.note, marketing: false, sched: "", slot: p.slot || "asap", channel: "phone", userId: null, by: s.user.username,
  });
  await audit(ctx, s.user.username, "order.create", o.no, { channel: "phone", mode: o.mode, total: o.total, at: o.at });
  return orderDetail(ctx, s, o.no);
}
