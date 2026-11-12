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
import { getSettings } from "./settings.ts";
import { findCode, markCodeUsed } from "./codes.ts";
import { bonusTaken, markBonusTaken } from "./customers.ts";
import { price, parseMods, slotAllowed } from "../lib/pricing.ts";
import { lineKey, sanitize, type Cart, type Mode } from "../lib/cart.ts";
import { zoneByName, zoneOfAddress } from "../lib/zones.ts";
import { minutes, sofiaYmd } from "../lib/time.ts";
import { state } from "../lib/status.ts";
import { byId, isOut, MENU_LUNCH_DATE, ORDER_RULES, type Zone } from "../lib/data.ts";
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
  closedEarly: "Кухнята отваря в 10:00. Поръчайте за днес с час от 10:30.",
  closed: "Кухнята вече не приема поръчки за днес. Поръчайте за утре.",
  deliveryClosed: "Доставката приключи за днес в 21:00. Можете да я вземете от ресторанта до 22:30.",
  lunchDelivery: "Обедното меню след 15:00 е само за вземане от място.",
  lunchSched: "Обедното меню не може да се поръча предварително.",
  lunchStale: "Обедното меню за днес още не е качено. Махнете обедните ястия от количката.",
  sched: "Поръчка „за днес“ с час се прави само преди 10:00. Обновете страницата.",
  slot: "Изберете час от списъка.",
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
export function checkLines(ctx: Ctx, raw: unknown, mode: Mode, opts: { lunchOnly?: boolean } = {}): Cart {
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
    if (isOut(x)) throw new CoreError("sold_out", "„" + x.n + "“ е изчерпано днес. Махнете го от количката.", 409);
    if (opts.lunchOnly && !x.lunch) throw new CoreError("not_lunch", "В общата поръчка са само ястия от обедното меню.", 422);
    if (x.lunch && !lunchOk(ctx)) throw new CoreError("lunch_stale", MSG.lunchStale, 409);
    out.push({ key: lineKey(x.id, pm.mods), id: x.id, q, mods: pm.mods, extra: 0 });
  }
  return sanitize({ lines: out, mode });
}

/** The delivery zone from the address (the server never trusts a zone sent by the client). */
/** Is there more than the quarter: after taking away "ж.к.", "кв.", "София" and the quarter names (Дружба 1/2, НПЗ Искър,
    Гара Искър, Бусманци, Горубляне), something must remain: a number (block, street number) or a word (street, landmark). */
export function hasStreet(addr: string): boolean {
  const rest = String(addr).toLowerCase()
    .replace(/ж\.?\s*к\.?|кв\.|гр\.|(^|\s)с\.|софия/g, " ")
    .replace(/дружба\s*(1|2|i{1,2}|едно|две)?(?![0-9a-zа-я])|друба\s*(1|2)?|нпз\s*искър|гара\s*искър|искър|искар|бусманци|горубляне/g, " ")
    .replace(/[^а-яa-z0-9]+/g, " ").trim();
  return /\d/.test(rest) || /[а-яa-z]{3,}/.test(rest);
}
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
  const cart = checkLines(ctx, raw, mode);
  const sched = input.sched === "утре" || input.sched === "днес" ? input.sched : "";
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
  else if (mode === "pickup" && slot !== "asap" && !slotAllowed(P, slot, ctx.clock, false)) errs.slot = MSG.slot;
  if (Object.keys(errs).length) invalid(errs);
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
      lines: P.rows.map((r) => ({ id: r.x.id, q: r.q, mods: r.mods || [], extra: Math.round((r.unit - r.x.p) * 100) / 100, name: r.x.n, unit: r.unit })),
      lunchOnly: P.rows.every((r) => !!r.x.lunch), zone: zone ? zone.n : "", addr,
      pay, payLabel: PAY_LABEL[pay], sub: P.sub, disc: P.disc, fee: P.fee, total: P.total,
      eta: atMin == null ? null : atMin - m, at, sched, placedAt: hhmm(m), ts: ts.getTime(),
      status: "accepted", name: String(input.name).trim().slice(0, 80), phone: phone!, email: input.email ? String(input.email).trim() : undefined,
      note: input.note ? String(input.note).trim().slice(0, 2000) : undefined,
      marketing: input.marketing === true, userId: input.userId || null,
      /* a table only for QR / waiter orders (never from a web order's body) */
      table: input.channel === "qr" || input.channel === "waiter" ? input.table || null : null,
      key: randomKey(8), discKind: P.discKind, ...(useCode ? { code: codeIn.toUpperCase(), codeDisc: P.codeDisc } : {}), ...(P.discKind === "profile" ? { profileDisc: P.profileDisc } : {}),
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

/* ---------- public tracking (/porachka/<no>-<key>/) ---------- */
export type PublicOrder = Pick<Order, "id" | "no" | "mode" | "channel" | "status" | "lunchOnly" | "zone" | "pay" | "payLabel" | "sub" | "disc" | "fee" | "total" |
  "eta" | "at" | "sched" | "placedAt" | "ts" | "createdAt" | "updatedAt" | "discKind" | "codeDisc" | "profileDisc"> & { lines: Order["lines"]; key?: string };

/** What the tracking page needs, nothing personal: no name, phone, e-mail, address, note, profile, code. */
export function publicOrder(o: Order, withKey = false): PublicOrder {
  const p: PublicOrder = {
    id: o.id, no: o.no, mode: o.mode, channel: o.channel, status: o.status, lunchOnly: o.lunchOnly, zone: o.zone, pay: o.pay, payLabel: o.payLabel,
    sub: o.sub, disc: o.disc, fee: o.fee, total: o.total, eta: o.eta, at: o.at, sched: o.sched, placedAt: o.placedAt, ts: o.ts,
    createdAt: o.createdAt, updatedAt: o.updatedAt, discKind: o.discKind || (o.disc ? "lunch" : ""), codeDisc: o.codeDisc || 0, profileDisc: o.profileDisc || 0,
    lines: o.lines.map((l) => ({ id: l.id, q: l.q, mods: l.mods, extra: l.extra, name: l.name, unit: l.unit })),
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
  o.status = status; o.updatedAt = iso(ctx);
  await ctx.repo.put(COL.orders, o);
  await audit(ctx, actor, "order.status", o.no, { status });
  emit(ctx, "order.status", { no: o.no, status }, { order: o.no });
  return o;
}
