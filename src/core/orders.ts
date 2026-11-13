/* Orders: numbers from № 1042, the same shape as "sc-order" in the prototype, status flow, real-time events.
   Rules checked here (the same on the server and in the demo, same codes and texts):
   - the price comes ONLY from the menu (pricing.ts): `extra`, `p`, `n`, `name`, `unit` from the client are ignored;
     add-ons only from the "dobavki" category, removals only of the dish's own ingredients;
   - q is a whole number 1..50, at most 40 lines, unknown dishes and sold-out dishes are refused;
   - delivery until 21:00, kitchen until 22:30: a delivery that is no longer possible is refused (never silently pickup);
   - lunch dishes only from today's lunch menu (lunchIsToday) and in its hours; -30% after 15:00 only for pickup;
   - the pickup time: "HH:MM" from pickupSlots() (future, opening hours, every 15 min, 20 min for the kitchen, 3 hours ahead);
   - the zone comes from the address (zones.ts), the zone sent by the client is only used to answer "Дружба 1 или 2?";
   - a discount code from the internal rating: once, -10% on the dishes, never together with the lunch -30%. */
import { COL, emit, iso, nowDate, randomKey, type Ctx } from "./ctx.ts";
import { CoreError, PAY_LABEL, type Channel, type Customer, type Order, type OrderStatus, type PayMethod } from "./types.ts";

/** the coupon a new profile gets (customers.ts): -10% once, from the first order after sign-up */
export const PROFILE_COUPON = "PROFIL10";
import { audit } from "./audit.ts";
import { pushStatus } from "./push.ts";
import { getSettings } from "./settings.ts";
import { findCode, markCodeUsed } from "./codes.ts";
import { bonusTaken, markBonusTaken } from "./customers.ts";
import { price, parseMods, slotAllowed, pickupToday, slotBusy } from "../lib/pricing.ts";
import { lineKey, sanitize, type Cart, type Mode } from "../lib/cart.ts";
import { hasStreet, zoneByName, zoneOfAddress } from "../lib/zones.ts";
export { hasStreet };
import { minutes, sofiaYmd, addDaysYmd } from "../lib/time.ts";
import { outNow, soldOutToday, type SoldOutToday } from "./menu.ts";
import { state } from "../lib/status.ts";
import { byId, MENU_LUNCH_DATE, ORDER_RULES, type Zone } from "../lib/data.ts";
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
  /** discount code from the internal rating ("SC10-XXXXXXXX") */
  code?: string;
}

export const FLOW: Record<"delivery" | "pickup", OrderStatus[]> = {
  delivery: ["accepted", "cooking", "ready", "on_way", "delivered"],
  pickup: ["accepted", "cooking", "ready", "picked_up"],
};
export const STATUS_LABEL: Record<OrderStatus, string> = {
  accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път", delivered: "Доставена", picked_up: "Взета", cancelled: "Отказана",
};
export const FINISHED: OrderStatus[] = ["delivered", "picked_up"];

/* ---------- messages (one place: the server and the demo show the same text) ---------- */
export const MSG = {
  empty: "Количката е празна.",
  unknown: "Едно от ястията вече го няма в менюто. Обновете количката.",
  qty: "Броят на едно ястие е от 1 до " + ORDER_RULES.maxQty + ". За по-голяма поръчка се обадете на 0894 36 55 77.",
  lines: "В една поръчка може до " + ORDER_RULES.maxLines + " различни ястия. За по-голяма поръчка се обадете на 0894 36 55 77.",
  big: "За голяма поръчка (над " + ORDER_RULES.maxPortions + " порции или " + ORDER_RULES.maxTotal + " €) се обадете на 0894 36 55 77: ще я приготвим навреме.",
  closedEarly: "Кухнята отваря в 10:00. Поръчайте за днес с час от 10:30.",
  closed: "Кухнята вече не приема поръчки за днес. Поръчайте за утре.",
  deliveryClosed: "Доставката приключи за днес в 21:00. Поръчки за вземане до 22:30.",
  lunchDelivery: "Обедното меню след 15:00 е само за вземане от място.",
  lunchSched: "Обедното меню не може да се поръча предварително.",
  lunchStale: "Обедното меню за днес още не е качено. Махнете обедните ястия от количката.",
  sched: "Поръчка „за днес“ с час се прави само преди 10:00. Обновете страницата.",
  slot: "Изберете час от списъка.",
  slotBusy: "Този час вече е зает: кухнята е пълна.",
  addr: "Напишете адреса за доставка.",
  addrOut: "Адресът е извън зоната ни. Изберете „Вземи от място“.",
  addrQuarter: "Добавете и квартала, например „Дружба 2, бл. 311“.",
  addrStreet: "Добавете улица или блок, например „Дружба 2, бл. 311“, за да ви намери шофьорът.",
};

function invalid(fields: Record<string, string>): never {
  throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields });
}

/** Lunch dishes are sold only from the lunch menu of today (in preview the menu counts as today's). */
export function lunchOk(ctx: Ctx): boolean {
  return !!ctx.preview || sofiaYmd(nowDate(ctx)) === MENU_LUNCH_DATE;
}

/** Checks the raw lines from the client and returns a clean cart (prices from the menu only). */
/** today: the "Изчерпано днес" switches (core/menu.ts) for the day the food is made; {} = the menu data only (an order for tomorrow) */
export function checkLines(ctx: Ctx, raw: unknown, mode: Mode, today: SoldOutToday, opts: { lunchOnly?: boolean } = {}): Cart {
  const lines = raw && typeof raw === "object" && Array.isArray((raw as { lines?: unknown }).lines) ? (raw as { lines: unknown[] }).lines : [];
  if (!lines.length) throw new CoreError("empty", MSG.empty);
  if (lines.length > ORDER_RULES.maxLines) throw new CoreError("too_many", MSG.lines, 422);
  const out: Cart["lines"] = [];
  for (const l0 of lines) {
    const l = (l0 && typeof l0 === "object" ? l0 : {}) as { id?: unknown; q?: unknown; mods?: unknown };
    const x = typeof l.id === "string" ? byId[l.id] : undefined;
    if (!x) throw new CoreError("unknown_item", MSG.unknown, 422);
    const q = typeof l.q === "string" && /^\d+$/.test(l.q) ? +l.q : l.q;
    if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > ORDER_RULES.maxQty) throw new CoreError("bad_qty", MSG.qty, 422);
    if (l.mods != null && (!Array.isArray(l.mods) || l.mods.some((m) => typeof m !== "string"))) throw new CoreError("bad_mod", "Невалидна промяна на „" + x.n + "“.", 422);
    const mods = ((l.mods as string[] | undefined) || []).map((m) => m.trim()).filter(Boolean);
    const pm = parseMods(x, mods);
    if (pm.bad) throw new CoreError("bad_mod", "Промяната „" + pm.bad + "“ не е възможна за „" + x.n + "“.", 422);
    if (outNow(x, today)) throw new CoreError("sold_out", "„" + x.n + "“ е изчерпано днес. Махнете го от количката.", 409);
    if (opts.lunchOnly && !x.lunch) throw new CoreError("not_lunch", "В общата поръчка са само ястия от обедното меню.", 422);
    if (x.lunch && !lunchOk(ctx)) throw new CoreError("lunch_stale", MSG.lunchStale, 409);
    out.push({ key: lineKey(x.id, pm.mods), id: x.id, q, mods: pm.mods, extra: 0 });
  }
  return sanitize({ lines: out, mode });
}

/** The delivery zone from the address (the server never trusts a zone sent by the client). */
export function resolveZone(addr: string, clientZone?: string, requireStreet = false): { zone: Zone; addr: string } | { error: string } {
  const a = String(addr || "").trim().slice(0, 300);
  if (!a) return { error: MSG.addr };
  /* a web order needs the street or block: "Дружба" alone does not get the driver to the door */
  if (requireStreet && !hasStreet(a)) return { error: MSG.addrStreet };
  const r = zoneOfAddress(a), cz = clientZone ? zoneByName(clientZone) : null;
  if (r.type === "zone") return { zone: r.zone, addr: a };
  if (r.type === "ask") return cz && r.opts.some((z) => z.n === cz.n) ? { zone: cz, addr: a } : { error: "Уточнете квартала: " + r.q };
  if (r.type === "out" || r.type === "short") return { error: MSG.addrOut };
  /* a street or a block without the quarter ("бл. 311"): the quarter chosen in the list, added to the address for the driver */
  if (cz) return { zone: cz, addr: a.toLowerCase().includes(cz.n.toLowerCase()) ? a : a + ", " + cz.n };
  return { error: MSG.addrQuarter };
}

export async function createOrder(ctx: Ctx, input: OrderInput): Promise<Order> {
  const raw = (input && input.cart) || ({} as Cart);
  const mode: Mode = raw.mode === "pickup" ? "pickup" : "delivery";
  const sched = input.sched === "утре" || input.sched === "днес" ? input.sched : "";
  /* today's "Изчерпано днес" does not touch an order for tomorrow */
  const cart = checkLines(ctx, raw, mode, sched === "утре" ? {} : await soldOutToday(ctx));
  const m = minutes(ctx.clock), s = state(ctx.clock);
  if (sched === "днес" && m >= 600) throw new CoreError("bad_sched", MSG.sched, 409);
  if (!sched && !s.kitchen) throw new CoreError("closed", m < 600 ? MSG.closedEarly : MSG.closed, 409);
  if (!sched && mode === "delivery" && !s.delivery) throw new CoreError("delivery_closed", MSG.deliveryClosed, 409);

  const settings = await getSettings(ctx);
  const errs: Record<string, string> = {};
  /* the discount code (checked again inside the transaction) */
  const codeIn = String(input.code || "").trim();
  let codePct = 0;
  if (codeIn) { const c = await findCode(ctx, codeIn); if ("error" in c) errs.code = c.error; else codePct = c.rating.pct; }

  let zone: Zone | null = null, addr = "";
  if (mode === "delivery") { const z = resolveZone(input.addr || "", input.zone, (input.channel || "web") === "web"); if ("error" in z) errs.addr = z.error; else { zone = z.zone; addr = z.addr; } }
  /* the profile bonus: signed in (userId from the session, never from the body) with the profile's phone, unused coupon */
  const phone0 = normPhone(input.phone);
  const prof = input.userId ? await ctx.repo.get<Customer>(COL.customers, input.userId) : null;
  const bonus0 = prof && phone0 && prof.phone === phone0 ? (prof.coupons || []).find((c) => c.code === PROFILE_COUPON && !c.used) : undefined;
  const bonus = bonus0 && !(await bonusTaken(ctx, phone0!)) ? bonus0 : undefined;
  const P = price(cart, { zone, scheduled: !!sched, clock: ctx.clock, busy: settings.kitchen.busy, codePct, profilePct: bonus ? bonus.pct : 0 });
  if (!String(input.name || "").trim()) errs.name = "Напишете името си.";
  const phone = normPhone(input.phone);
  if (!phone) errs.phone = "Телефонът трябва да е 10 цифри, например 0888 12 34 56.";
  if (input.email && (String(input.email).length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(input.email).trim()))) errs.email = "Проверете имейла, например ime@primer.bg.";

  const slot = String(input.slot || "asap");
  if (sched) { if (!slotAllowed(P, slot, ctx.clock, true)) errs.slot = MSG.slot; }
  else if (mode === "pickup" && (slot === "asap" ? !pickupToday(P, ctx.clock).asap : !slotAllowed(P, slot, ctx.clock, false))) errs.slot = MSG.slot; /* the one pickup rule (lib/pricing.ts) */
  else if (mode === "pickup" && slot !== "asap" && slotBusy(+slot.slice(0, 2) * 60 + +slot.slice(3), m, settings.kitchen.busy)) errs.slot = MSG.slotBusy; /* "заето" (the same rule as the screen) */
  if (Object.keys(errs).length) invalid(errs);
  /* a big order goes by phone (the office has its own limits per person, the sum limit is the same) */
  if ((input.channel || "web") !== "office" && P.n > ORDER_RULES.maxPortions) throw new CoreError("too_big", MSG.big, 422);
  if (P.sub > ORDER_RULES.maxTotal) throw new CoreError("too_big", MSG.big, 422);
  if (P.conflict === "delivery") throw new CoreError("lunch_delivery", MSG.lunchDelivery, 409);
  if (P.conflict === "sched") throw new CoreError("lunch_sched", MSG.lunchSched, 409);

  let atMin: number | null;
  if (sched) atMin = null;
  else if (mode === "delivery") atMin = m + P.etaMin;
  else if (slot === "asap") atMin = P.hasTrad ? Math.ceil(P.earliest / 5) * 5 : m;
  else atMin = +slot.slice(0, 2) * 60 + +slot.slice(3);
  const at = sched ? slot : mode === "delivery" ? hhmm(atMin!) : slot === "asap" && !P.hasTrad ? "веднага" : hhmm(atMin!);

  const pay: PayMethod = input.pay && PAY_LABEL[input.pay] ? input.pay : "cash";
  const useCode = codeIn && P.discKind === "code";
  const make = async (): Promise<Order> => {
    const no = String(await ctx.repo.seq("order_no", FIRST_ORDER_NO));
    if (useCode) await markCodeUsed(ctx, codeIn, no);   /* throws if someone used it a moment ago: nothing is saved */
    if (P.discKind === "profile" && prof) {
      const c = await ctx.repo.get<Customer>(COL.customers, prof.id);
      const k = c ? c.coupons.findIndex((x) => x.code === PROFILE_COUPON && !x.used) : -1;
      if (!c || k < 0) throw new CoreError("bonus_used", "Бонусът с профил вече е използван. Обновете страницата.", 409);
      c.coupons[k] = { ...c.coupons[k], used: true, orderNo: no } as Customer["coupons"][number];
      await ctx.repo.put(COL.customers, c);
      await markBonusTaken(ctx, c.phone, no);
    }
    const ts = nowDate(ctx);
    const o: Order = {
      id: no, no, mode, channel: input.channel || "web",
      lines: P.rows.map((r) => ({ id: r.x.id, q: r.q, mods: r.mods || [], extra: Math.round((r.unit - r.x.p) * 100) / 100, name: r.x.n, unit: r.unit, cat: r.x.cat, course: r.x.course })),
      lunchOnly: P.rows.every((r) => !!r.x.lunch), zone: zone ? zone.n : "", addr,
      pay, payLabel: PAY_LABEL[pay], sub: P.sub, disc: P.disc, fee: P.fee, total: P.total,
      eta: atMin == null ? null : atMin - m, at, sched, slot: sched || mode === "pickup" ? slot : "asap", placedAt: hhmm(m), ts: ts.getTime(),
      status: "accepted", name: String(input.name).trim().slice(0, 80), phone: phone!, email: input.email ? String(input.email).trim() : undefined,
      note: input.note ? String(input.note).trim().slice(0, 2000) : undefined,
      marketing: input.marketing === true, userId: input.userId || null,
      /* a table only for QR / waiter orders (never from a web order's body) */
      table: input.channel === "qr" || input.channel === "waiter" ? input.table || null : null,
      key: randomKey(8), discKind: P.discKind, ...(useCode ? { code: codeIn.toUpperCase(), codeDisc: P.codeDisc } : {}), ...(P.discKind === "profile" ? { profileDisc: P.profileDisc } : {}),
      times: { accepted: ts.toISOString() }, createdAt: ts.toISOString(), updatedAt: ts.toISOString(),
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

/* ---------- public tracking (/porachka/<no>-<key>/) ---------- */
export type PublicOrder = Pick<Order, "id" | "no" | "mode" | "channel" | "status" | "lunchOnly" | "zone" | "pay" | "payLabel" | "sub" | "disc" | "fee" | "total" |
  "eta" | "at" | "sched" | "slot" | "placedAt" | "ts" | "createdAt" | "updatedAt" | "discKind" | "codeDisc" | "profileDisc"> &
  { lines: Order["lines"]; key?: string; times: Partial<Record<OrderStatus, string>>; changes: number };

/** What the tracking page needs, nothing personal: no name, phone, e-mail, address, note, profile, code. */
export function publicOrder(o: Order, withKey = false): PublicOrder {
  const p: PublicOrder = {
    id: o.id, no: o.no, mode: o.mode, channel: o.channel, status: o.status, lunchOnly: o.lunchOnly, zone: o.zone, pay: o.pay, payLabel: o.payLabel,
    sub: o.sub, disc: o.disc, fee: o.fee, total: o.total, eta: o.eta, at: o.at, sched: o.sched, slot: o.slot || (o.at && /^\d{2}:\d{2}$/.test(o.at) && o.mode === "pickup" ? o.at : "asap"), placedAt: o.placedAt, ts: o.ts,
    createdAt: o.createdAt, updatedAt: o.updatedAt, discKind: o.discKind || (o.disc ? "lunch" : ""), codeDisc: o.codeDisc || 0, profileDisc: o.profileDisc || 0,
    lines: o.lines.map((l) => ({ id: l.id, q: l.q, mods: l.mods, extra: l.extra, name: l.name, unit: l.unit, cat: l.cat, course: l.course })),
    times: o.times || { accepted: o.createdAt }, changes: o.changes || 0,
  };
  if (withKey && o.key) p.key = o.key;
  return p;
}

/** "1042" or "1042-k7f3m2pq" -> number and key. */
export function parseTrack(id: string): { no: string; key: string } | null {
  const m = /^(\d{1,9})(?:-([a-z0-9]{4,32}))?$/.exec(String(id || "").trim());
  return m ? { no: m[1], key: m[2] || "" } : null;
}

/** The order for a tracking address, or null. The key must match when given (and when ctx.requireTrackKey is on). */
export async function findTracked(ctx: Ctx, id: string): Promise<Order | null> {
  const t = parseTrack(id);
  if (!t) return null;
  const o = await getOrder(ctx, t.no);
  if (!o) return null;
  if (o.key && (t.key ? t.key !== o.key : !!ctx.requireTrackKey)) return null;
  return o;
}

export async function trackOrder(ctx: Ctx, id: string): Promise<PublicOrder> {
  const o = await findTracked(ctx, id);
  if (!o) throw new CoreError("not_found", "Няма такава поръчка.", 404);
  return publicOrder(o, !!parseTrack(id)?.key);
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
  const now = iso(ctx);
  o.status = status; o.updatedAt = now; o.times = { ...(o.times || { accepted: o.createdAt }), [status]: now };
  await ctx.repo.put(COL.orders, o);
  await audit(ctx, actor, "order.status", o.no, { status });
  emit(ctx, "order.status", { no: o.no, status, at: now }, { order: o.no });
  /* Web Push to the browsers that asked for it: in the background, a slow push service never delays the kitchen */
  pushStatus(ctx, o).catch(() => { /* logged by the sender */ });
  return o;
}

/* ---------- change by the customer: pre-orders only ("за утре", or "за днес" made before 10:00) ----------
   [ЛИПСВА: до кога клиентът може да променя поръчка за утре] The default from docs/OPEN-QUESTIONS.md ("до 1 час преди
   часа") is the safest rule that the tracking page already promises: only while the order is "Приета" (the kitchen has
   not started), only with the tracking key, and at the latest CHANGE_BEFORE_MIN minutes before the old AND the new time.
   Everything is checked again as for a new order (menu, zone, slots, limits, lunch); the price comes from the menu.
   A discount code or the profile bonus the order already used stays with it (it is not used a second time). */
export const CHANGE_BEFORE_MIN = 60;
export interface OrderChange { cart?: Cart; slot?: string; addr?: string; zone?: string; note?: string; pay?: PayMethod }
export const CHANGE_MSG = {
  notSched: "Онлайн се променя само поръчка за по-късен час. За тази се обадете на 0894 36 55 77.",
  started: "Кухнята вече приготвя поръчката. За промяна се обадете на 0894 36 55 77.",
  late: "Промени приемаме до 1 час преди часа на поръчката. Обадете се на 0894 36 55 77.",
  nothing: "Няма какво да променим.",
};

/** the Sofia date ("YYYY-MM-DD") a pre-order is for: the day it was placed, +1 for "утре" */
export function orderDay(o: Pick<Order, "createdAt" | "sched">): string {
  const d = sofiaYmd(new Date(o.createdAt));
  return o.sched === "утре" ? addDaysYmd(d, 1) : d;
}
/** may a pre-order for `day` at `slot` still be changed now? (CHANGE_BEFORE_MIN minutes before) */
function beforeDeadline(ctx: Ctx, day: string, slot: string): boolean {
  const t = /^(\d{2}):(\d{2})$/.exec(slot);
  if (!t) return false;
  const today = sofiaYmd(nowDate(ctx));
  if (day > today) return true;
  if (day < today) return false;
  return minutes(ctx.clock) <= +t[1] * 60 + +t[2] - CHANGE_BEFORE_MIN;
}

export async function changeOrder(ctx: Ctx, id: string, patch: OrderChange): Promise<Order> {
  const t = parseTrack(id);
  const o0 = t && t.key ? await getOrder(ctx, t.no) : null;
  /* only with the key: a number alone never changes anything (and says nothing about the order) */
  if (!o0 || !o0.key || o0.key !== t!.key) throw new CoreError("not_found", "Няма такава поръчка.", 404);
  if (!o0.sched) throw new CoreError("not_changeable", CHANGE_MSG.notSched, 409);
  if (o0.status !== "accepted") throw new CoreError("not_changeable", CHANGE_MSG.started, 409);
  const day = orderDay(o0);
  if (!beforeDeadline(ctx, day, String(o0.slot || o0.at))) throw new CoreError("too_late", CHANGE_MSG.late, 409);
  const p = patch && typeof patch === "object" ? patch : {};
  if (p.cart === undefined && p.slot === undefined && p.addr === undefined && p.zone === undefined && p.note === undefined && p.pay === undefined) throw new CoreError("invalid", CHANGE_MSG.nothing, 422);

  const today = sofiaYmd(nowDate(ctx)) === day;
  const mode: Mode = p.cart ? (p.cart.mode === "pickup" ? "pickup" : "delivery") : o0.mode;
  const raw = p.cart ? { ...p.cart, mode } : { mode, lines: o0.lines.map((l) => ({ key: lineKey(l.id, l.mods), id: l.id, q: l.q, mods: l.mods, extra: 0 })) };
  const cart = checkLines(ctx, raw, mode, today ? await soldOutToday(ctx) : {});
  const errs: Record<string, string> = {};
  let zone: Zone | null = null, addr = "";
  if (mode === "delivery") {
    const z = resolveZone(p.addr !== undefined ? String(p.addr) : o0.addr, p.zone !== undefined ? p.zone : o0.zone, (o0.channel || "web") === "web");
    if ("error" in z) errs.addr = z.error; else { zone = z.zone; addr = z.addr; }
  }
  /* the discounts the order already has: the same percentage, never a second use */
  let codePct = 0, profilePct = 0;
  if (o0.code) { const r = (await ctx.repo.list<{ id: string; code: string; pct: number }>(COL.ratings)).find((x) => x.code === o0.code); codePct = r ? r.pct : 0; }
  if (o0.discKind === "profile" && o0.userId) {
    const c = await ctx.repo.get<Customer>(COL.customers, o0.userId);
    const k = c ? (c.coupons || []).find((x) => x.code === PROFILE_COUPON && (x as { orderNo?: string }).orderNo === o0.no) : undefined;
    profilePct = k ? k.pct : 0;
  }
  const settings = await getSettings(ctx);
  const P = price(cart, { zone, scheduled: true, clock: ctx.clock, busy: settings.kitchen.busy, codePct, profilePct });
  const slot = p.slot !== undefined ? String(p.slot) : String(o0.slot || o0.at);
  if (!slotAllowed(P, slot, ctx.clock, true) || !beforeDeadline(ctx, day, slot)) errs.slot = today && slotAllowed(P, slot, ctx.clock, true) ? CHANGE_MSG.late : MSG.slot;
  if (Object.keys(errs).length) invalid(errs);
  if ((o0.channel || "web") !== "office" && P.n > ORDER_RULES.maxPortions) throw new CoreError("too_big", MSG.big, 422);
  if (P.sub > ORDER_RULES.maxTotal) throw new CoreError("too_big", MSG.big, 422);
  if (P.conflict === "delivery") throw new CoreError("lunch_delivery", MSG.lunchDelivery, 409);
  if (P.conflict === "sched") throw new CoreError("lunch_sched", MSG.lunchSched, 409);

  const pay: PayMethod = p.pay && PAY_LABEL[p.pay] ? p.pay : o0.pay;
  const apply = async (): Promise<Order> => {
    const o = await getOrder(ctx, o0.no);
    /* the kitchen may have started in the meantime */
    if (!o || o.status !== "accepted") throw new CoreError("not_changeable", CHANGE_MSG.started, 409);
    const now = iso(ctx);
    Object.assign(o, {
      mode, zone: zone ? zone.n : "", addr, pay, payLabel: PAY_LABEL[pay],
      lines: P.rows.map((r) => ({ id: r.x.id, q: r.q, mods: r.mods || [], extra: Math.round((r.unit - r.x.p) * 100) / 100, name: r.x.n, unit: r.unit, cat: r.x.cat, course: r.x.course })),
      lunchOnly: P.rows.every((r) => !!r.x.lunch), sub: P.sub, disc: P.disc, fee: P.fee, total: P.total,
      slot, at: slot, discKind: P.discKind,
      ...(o.code ? { codeDisc: P.codeDisc } : {}), ...(o.discKind === "profile" ? { profileDisc: P.profileDisc } : {}),
      note: p.note !== undefined ? (String(p.note).trim().slice(0, 2000) || undefined) : o.note,
      changes: (o.changes || 0) + 1, changedAt: now, updatedAt: now,
    });
    await ctx.repo.put(COL.orders, o);
    return o;
  };
  const o = ctx.repo.transaction ? await ctx.repo.transaction(apply) : await apply();
  await audit(ctx, "customer", "order.change", o.no, { slot: o.slot, total: o.total, mode: o.mode });
  emit(ctx, "order.changed", { no: o.no, slot: o.slot, total: o.total, mode: o.mode }, { order: o.no });
  return o;
}
