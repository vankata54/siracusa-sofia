/* Orders: numbers from № 1042, the same shape as "sc-order" in the prototype, status flow, real-time events. */
import { COL, emit, iso, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, PAY_LABEL, type Channel, type Order, type OrderStatus, type PayMethod } from "./types.ts";
import { audit } from "./audit.ts";
import { price } from "../lib/pricing.ts";
import { sanitize, type Cart } from "../lib/cart.ts";
import { zoneByName } from "../lib/zones.ts";
import { minutes } from "../lib/time.ts";
import { hhmm, normPhone } from "../lib/format.ts";

export const FIRST_ORDER_NO = 1042;

export interface OrderInput {
  cart: Cart;
  zone?: string; addr?: string;
  pay?: PayMethod;
  name: string; phone: string; email?: string; note?: string;
  marketing?: boolean;
  sched?: "" | "днес" | "утре";
  slot?: string;           // "asap" | "HH:MM"
  channel?: Channel;
  userId?: string | null;
  table?: string | null;
}

export const FLOW: Record<"delivery" | "pickup", OrderStatus[]> = {
  delivery: ["accepted", "cooking", "ready", "on_way", "delivered"],
  pickup: ["accepted", "cooking", "ready", "picked_up"],
};
export const STATUS_LABEL: Record<OrderStatus, string> = {
  accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път", delivered: "Доставена", picked_up: "Взета", cancelled: "Отказана",
};

export async function createOrder(ctx: Ctx, input: OrderInput): Promise<Order> {
  const cart = sanitize(input.cart);
  const sched = input.sched || "";
  const zone = cart.mode === "delivery" && input.zone ? zoneByName(input.zone) : null;
  const P = price(cart, { zone, scheduled: !!sched, clock: ctx.clock });
  const errs: Record<string, string> = {};
  if (!P.n) throw new CoreError("empty", "Количката е празна.");
  if (!String(input.name || "").trim()) errs.name = "Напишете името си.";
  const phone = normPhone(input.phone);
  if (!phone) errs.phone = "Телефонът трябва да е 10 цифри, например 0888 12 34 56.";
  if (P.mode === "delivery") {
    if (!zone) errs.addr = "Адресът е извън зоната ни. Изберете „Вземи от място“.";
    if (!String(input.addr || "").trim()) errs.addr = "Напишете адреса за доставка.";
  }
  if (Object.keys(errs).length) throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields: errs });
  if (P.closed && !sched) throw new CoreError("closed", "Кухнята вече не приема поръчки за днес. Поръчайте за утре.", 409);
  if (P.conflict === "delivery") throw new CoreError("lunch_delivery", "Обедното меню след 15:00 е само за вземане от място.", 409);
  if (P.conflict === "sched") throw new CoreError("lunch_sched", "Обедното меню не може да се поръча предварително.", 409);

  const m = minutes(ctx.clock), slot = input.slot || "asap";
  let atMin: number | null;
  if (sched) atMin = null;
  else if (P.mode === "delivery") atMin = m + P.etaMin;
  else if (slot === "asap") atMin = P.hasTrad ? Math.ceil(P.earliest / 5) * 5 : m;
  else atMin = +slot.slice(0, 2) * 60 + +slot.slice(3);
  const at = sched ? slot : P.mode === "delivery" ? hhmm(atMin!) : slot === "asap" && !P.hasTrad ? "веднага" : hhmm(atMin!);

  const pay: PayMethod = input.pay && PAY_LABEL[input.pay] ? input.pay : "cash";
  const make = async (): Promise<Order> => {
    const no = String(await ctx.repo.seq("order_no", FIRST_ORDER_NO));
    const live = P.rows.filter((r) => !r.out);
    const ts = nowDate(ctx);
    const o: Order = {
      id: no, no, mode: P.mode, channel: input.channel || "web",
      lines: live.map((r) => ({ id: r.x.id, q: r.q, mods: r.mods || [], extra: r.unit - r.x.p, name: r.x.n, unit: r.unit })),
      lunchOnly: live.every((r) => !!r.x.lunch), zone: P.mode === "delivery" && zone ? zone.n : "", addr: P.mode === "delivery" ? String(input.addr || "").trim() : "",
      pay, payLabel: PAY_LABEL[pay], sub: P.sub, disc: P.disc, fee: P.fee, total: P.total,
      eta: atMin == null ? null : atMin - m, at, sched, placedAt: hhmm(m), ts: ts.getTime(),
      status: "accepted", name: String(input.name).trim(), phone: phone!, email: input.email || undefined, note: input.note || undefined,
      marketing: input.marketing === true, userId: input.userId || null, table: input.table || null,
      createdAt: ts.toISOString(), updatedAt: ts.toISOString(),
    };
    await ctx.repo.put(COL.orders, o);
    return o;
  };
  const o = ctx.repo.transaction ? await ctx.repo.transaction(make) : await make();
  emit(ctx, "order.created", { no: o.no, mode: o.mode, total: o.total, status: o.status });
  return o;
}

export async function getOrder(ctx: Ctx, no: string): Promise<Order | null> {
  return ctx.repo.get<Order>(COL.orders, String(no));
}

export async function listOrders(ctx: Ctx, where: Partial<Order> = {}): Promise<Order[]> {
  const all = await ctx.repo.list<Order>(COL.orders, where as Partial<Order>);
  return all.sort((a, b) => +b.no - +a.no);
}

export function nextStatus(o: Pick<Order, "mode" | "status">): OrderStatus | null {
  const f = FLOW[o.mode], i = f.indexOf(o.status);
  return i > -1 && i < f.length - 1 ? f[i + 1] : null;
}

export async function setOrderStatus(ctx: Ctx, no: string, status: OrderStatus, actor = "system"): Promise<Order> {
  const o = await getOrder(ctx, no);
  if (!o) throw new CoreError("not_found", "Няма такава поръчка.", 404);
  if (status !== "cancelled" && FLOW[o.mode].indexOf(status) < 0) throw new CoreError("bad_status", "Невалиден статус за този вид поръчка.");
  o.status = status; o.updatedAt = iso(ctx);
  await ctx.repo.put(COL.orders, o);
  await audit(ctx, actor, "order.status", o.no, { status });
  emit(ctx, "order.status", { no: o.no, status });
  return o;
}
