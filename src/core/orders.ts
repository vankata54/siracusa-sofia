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
import { CoreError, PAY_LABEL, type Channel, type Customer, type Order, type OrderLine, type OrderStatus, type PayMethod } from "./types.ts";

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
import { byId, removedById, MENU_LUNCH_DATE, ORDER_RULES, type Zone } from "../lib/data.ts";
import { liveZone, zoneRule } from "./zones.ts";
import { liveOffers, offerApplies, orderOfferContext } from "./offer-rules.ts";
import { hhmm, normPhone } from "../lib/format.ts";
import { stampKitchen } from "./kitchen-base.ts";

export const FIRST_ORDER_NO = 1042;
export const OFFER_OFF_MSG = "Тази отстъпка е изключена в момента.";
export const OFFER_OUT_MSG = "Кодът не важи за тази поръчка (ден, час, канал или ястия).";

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
  /** a phone order: the staff member who took it (orders-admin.ts) */
  by?: string;
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
  phoneSlot: "Изберете час от списъка: доставка до 20:45, през 15 минути, след времето за квартала.",
  slot: "Изберете час от списъка.",
  slotBusy: "Този час вече е зает: кухнята е пълна.",
  addr: "Напишете адреса за доставка.",
  addrOut: "Адресът е извън зоната ни. Изберете „Вземи от място“.",
  addrQuarter: "Добавете и квартала, например „Дружба 2, бл. 311“.",
  addrStreet: "Добавете улица или блок, например „Дружба 2, бл. 311“, за да ви намери шофьорът.",
};

/** "Шкембе вече не е в менюто." / "Шкембе и Таратор вече не са в менюто." */
export function removedMsg(names: string[]): string {
  const u = [...new Set(names)];
  return u.length === 1 ? u[0] + " вече не е в менюто." : u.slice(0, -1).join(", ") + " и " + u[u.length - 1] + " вече не са в менюто.";
}

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
  /* a dish taken off the menu (decision 15.11.2026): refused by name; `lines` / `fields` tell the cart which line it is */
  const gone = lines.map((l0, i) => ({ i, id: l0 && typeof l0 === "object" ? (l0 as { id?: unknown }).id : undefined }))
    .filter((g) => typeof g.id === "string" && !Object.prototype.hasOwnProperty.call(byId, g.id) && Object.prototype.hasOwnProperty.call(removedById, g.id));
  if (gone.length) {
    const names = gone.map((g) => removedById[g.id as string].n), msg = removedMsg(names);
    throw Object.assign(new CoreError("removed", msg, 409), { lines: gone.map((g) => g.id as string), fields: Object.fromEntries(gone.map((g) => ["lines." + g.i, removedById[g.id as string].n + " вече не е в менюто."])) });
  }
  for (const l0 of lines) {
    const l = (l0 && typeof l0 === "object" ? l0 : {}) as { id?: unknown; q?: unknown; mods?: unknown };
    const x = typeof l.id === "string" && Object.prototype.hasOwnProperty.call(byId, l.id) ? byId[l.id] : undefined;
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

  const channel: Channel = input.channel || "web";
  let zone: Zone | null = null, addr = "", zoneRow: Awaited<ReturnType<typeof liveZone>> = null;
  /* the zone from the address; the fee, the minutes and the rules (off, minimum, hours) from the admin's live zones */
  if (mode === "delivery") {
    const z = resolveZone(input.addr || "", input.zone, channel === "web" || channel === "phone");
    if ("error" in z) errs.addr = z.error;
    else { addr = z.addr; zoneRow = await liveZone(ctx, z.zone); zone = zoneRow ? zoneRow.zone : z.zone; }
  }
  /* the offers' rules (the admin): the profile bonus and the rating code only when their offer is on and the order fits */
  const offs = await liveOffers(ctx);
  const oc = orderOfferContext(ctx, { mode, channel, sched, slot: String(input.slot || "asap"), lines: cart.lines });
  if (codePct && !errs.code && !offerApplies(offs.find((o) => o.id === "rating"), oc)) { errs.code = offs.find((o) => o.id === "rating")?.on === false ? OFFER_OFF_MSG : OFFER_OUT_MSG; codePct = 0; }
  /* the profile bonus: signed in (userId from the session, never from the body) with the profile's phone, unused coupon */
  const phone0 = normPhone(input.phone);
  const prof = input.userId ? await ctx.repo.get<Customer>(COL.customers, input.userId) : null;
  const bonus0 = prof && phone0 && prof.phone === phone0 ? (prof.coupons || []).find((c) => c.code === PROFILE_COUPON && !c.used) : undefined;
  const bonus = bonus0 && !(await bonusTaken(ctx, phone0!)) && offerApplies(offs.find((o) => o.id === "signup"), oc) ? bonus0 : undefined;
  const P = price(cart, { zone, scheduled: !!sched, clock: ctx.clock, busy: settings.kitchen.busy, codePct, profilePct: bonus ? bonus.pct : 0 });
  if (!String(input.name || "").trim()) errs.name = "Напишете името си.";
  const phone = normPhone(input.phone);
  if (!phone) errs.phone = "Телефонът трябва да е 10 цифри, например 0888 12 34 56.";
  if (input.email && (String(input.email).length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(input.email).trim()))) errs.email = "Проверете имейла, например ime@primer.bg.";

  const slot = String(input.slot || "asap");
  /* a phone order (the staff, orders-admin.ts) may be delivered later today: "HH:MM" every 15 min, after the zone's minutes, until 20:45 */
  const phoneLater = !sched && channel === "phone" && mode === "delivery" && slot !== "asap";
  const slotMin = /^\d{2}:\d{2}$/.test(slot) ? +slot.slice(0, 2) * 60 + +slot.slice(3) : -1;
  if (phoneLater) { if (slotMin < 0 || slotMin % ORDER_RULES.slotStep || slotMin < m + P.etaMin || slotMin > ORDER_RULES.preorderDeliveryUntil) errs.slot = MSG.phoneSlot; }
  else if (sched) { if (!slotAllowed(P, slot, ctx.clock, true)) errs.slot = MSG.slot; }
  else if (mode === "pickup" && (slot === "asap" ? !pickupToday(P, ctx.clock).asap : !slotAllowed(P, slot, ctx.clock, false))) errs.slot = MSG.slot; /* the one pickup rule (lib/pricing.ts) */
  else if (mode === "pickup" && slot !== "asap" && slotBusy(+slot.slice(0, 2) * 60 + +slot.slice(3), m, settings.kitchen.busy)) errs.slot = MSG.slotBusy; /* "заето" (the same rule as the screen) */
  /* the zone's rules: off, the hours (now, or the time of a pre-order / a later delivery), the minimum order */
  if (zoneRow && !errs.addr) {
    const rule = zoneRule(zoneRow.row, { now: sched || phoneLater ? null : m, slot: (sched || phoneLater) && slotMin >= 0 ? slotMin : null, sub: P.sub });
    if (rule) { if (rule.code === "delivery_closed" && rule.field === "addr" && !Object.keys(errs).length) throw new CoreError("delivery_closed", rule.msg, 409); errs[rule.field] = rule.msg; }
  }
  if (Object.keys(errs).length) invalid(errs);
  /* a big order goes by phone (the office has its own limits per person, the sum limit is the same) */
  if ((input.channel || "web") !== "office" && P.n > ORDER_RULES.maxPortions) throw new CoreError("too_big", MSG.big, 422);
  if (P.sub > ORDER_RULES.maxTotal) throw new CoreError("too_big", MSG.big, 422);
  if (P.conflict === "delivery") throw new CoreError("lunch_delivery", MSG.lunchDelivery, 409);
  if (P.conflict === "sched") throw new CoreError("lunch_sched", MSG.lunchSched, 409);

  let atMin: number | null;
  if (sched) atMin = null;
  else if (phoneLater) atMin = slotMin;
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
      id: no, no, mode, channel,
      lines: P.rows.map((r) => ({ id: r.x.id, q: r.q, mods: r.mods || [], extra: Math.round((r.unit - r.x.p) * 100) / 100, name: r.x.n, unit: r.unit, cat: r.x.cat, course: r.x.course })),
      lunchOnly: P.rows.every((r) => !!r.x.lunch), zone: zone ? zone.n : "", addr,
      pay, payLabel: PAY_LABEL[pay], sub: P.sub, disc: P.disc, fee: P.fee, total: P.total,
      eta: atMin == null ? null : atMin - m, at, sched, slot: sched || mode === "pickup" || phoneLater ? slot : "asap", placedAt: hhmm(m), ts: ts.getTime(),
      status: "accepted", name: String(input.name).trim().slice(0, 80), phone: phone!, email: input.email ? String(input.email).trim() : undefined,
      note: input.note ? String(input.note).trim().slice(0, 2000) : undefined,
      marketing: input.marketing === true, userId: input.userId || null,
      /* a table only for QR / waiter orders (never from a web order's body) */
      table: input.channel === "qr" || input.channel === "waiter" ? input.table || null : null,
      key: randomKey(8), discKind: P.discKind, ...(channel === "phone" && input.by ? { by: String(input.by) } : {}), ...(useCode ? { code: codeIn.toUpperCase(), codeDisc: P.codeDisc } : {}), ...(P.discKind === "profile" ? { profileDisc: P.profileDisc } : {}),
      times: { accepted: ts.toISOString() }, createdAt: ts.toISOString(), updatedAt: ts.toISOString(),
    };
    /* the kitchen (core/kitchen.ts): every line gets its section and ks "wait"; "+20 мин" only for an order placed under "Натоварено" */
    await stampKitchen(ctx, o, settings.kitchen.busy ? settings.kitchen.etaBusyMin - settings.kitchen.etaMin : 0);
    await ctx.repo.put(COL.orders, o);
    return o;
  };
  const o = ctx.repo.transaction ? await ctx.repo.transaction(make) : await make();
  emit(ctx, "order.created", { no: o.no, mode: o.mode, total: o.total, status: o.status, channel: o.channel });
  emit(ctx, "order.new", { no: o.no, channel: o.channel, mode: o.mode, table: o.table || null, session: o.session || null, sched: o.sched, slot: o.slot || "asap", secs: [...new Set(o.lines.map((l) => l.sec))] });
  return o;
}

export async function getOrder(ctx: Ctx, no: string): Promise<Order | null> {
  return ctx.repo.get<Order>(COL.orders, String(no));
}

/* ---------- public tracking (/porachka/<no>-<key>/) ---------- */
export type PublicOrder = Pick<Order, "id" | "no" | "mode" | "channel" | "status" | "lunchOnly" | "zone" | "pay" | "payLabel" | "sub" | "disc" | "fee" | "total" |
  "eta" | "at" | "sched" | "slot" | "placedAt" | "ts" | "createdAt" | "updatedAt" | "discKind" | "codeDisc" | "profileDisc"> &
  { lines: Order["lines"]; key?: string; times: Partial<Record<OrderStatus, string>>; changes: number;
    /** "Откажи" in the admin: why (the customer sees it) */
    reason?: string;
    /** the driver (core/driver.ts): "Шофьорът е пред входа" since (ISO, only while "На път"), and hold: the driver
        reported a problem (a neutral state: never which one, never who the driver is) */
    arrivedAt?: string; hold?: boolean };

/** What the tracking page needs, nothing personal: no name, phone, e-mail, address, note, profile, code. */
export function publicOrder(o: Order, withKey = false): PublicOrder {
  const p: PublicOrder = {
    id: o.id, no: o.no, mode: o.mode, channel: o.channel, status: o.status, lunchOnly: o.lunchOnly, zone: o.zone, pay: o.pay, payLabel: o.payLabel,
    sub: o.sub, disc: o.disc, fee: o.fee, total: o.total, eta: o.eta, at: o.at, sched: o.sched, slot: o.slot || (o.at && /^\d{2}:\d{2}$/.test(o.at) && o.mode === "pickup" ? o.at : "asap"), placedAt: o.placedAt, ts: o.ts,
    createdAt: o.createdAt, updatedAt: o.updatedAt, discKind: o.discKind || (o.disc ? "lunch" : ""), codeDisc: o.codeDisc || 0, profileDisc: o.profileDisc || 0,
    /* a line accepted without ("Приеми без него"): shown "Изчерпано днес", not in the total */
    lines: o.lines.map((l) => ({ id: l.id, q: l.q, mods: l.mods, extra: l.extra, name: l.name, unit: l.unit, cat: l.cat, course: l.course, ...(l.dropped ? { out: true } : {}) })),
    times: o.times || { accepted: o.createdAt }, changes: o.changes || 0,
  };
  const hold = !!o.problem && o.problem.solved !== "delivered" && !FINISHED.includes(o.status) && o.status !== "cancelled";
  /* "Шофьорът е пред входа" only while he is there: never with a problem (the customer reads the neutral state) */
  if (o.status === "on_way" && o.arrivedAt && !hold) p.arrivedAt = o.arrivedAt;
  if (hold) p.hold = true;
  if (withKey && o.key) p.key = o.key;
  if (o.status === "cancelled" && o.reason) p.reason = o.reason;
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

/** Who may move an order from its status to `to` (a staff member from the admin or a module):
    - "Поръчки": one step forward or back ("Отмени"), "Отказана" from any open status, and back from "Отказана" to the
      status it had (the way back from a finished order is one step);
    - "Кухня": only "Приета" -> "Готви се" -> "Готова"; "Шофьор": only "Готова" -> "На път" -> "Доставена".
    Finished and cancelled orders stay as they are for everyone else. */
export function stepAllowed(o: Pick<Order, "mode" | "status" | "prevStatus">, to: OrderStatus, s: { user: { role: string }; sections: string[] }): boolean {
  if (o.status === to) return true;
  const f = FLOW[o.mode], i = f.indexOf(o.status), j = f.indexOf(to);
  const has = (x: string) => s.user.role === "admin" || s.sections.includes(x);
  if (has("orders")) {
    if (o.status === "cancelled") return to === (o.prevStatus || "accepted");
    if (to === "cancelled") return !FINISHED.includes(o.status);
    return i > -1 && j > -1 && Math.abs(i - j) === 1;
  }
  const pairs: [string, OrderStatus, OrderStatus][] = [["kitchen", "accepted", "cooking"], ["kitchen", "cooking", "ready"], ["driver", "ready", "on_way"], ["driver", "on_way", "delivered"]];
  return pairs.some(([sec, a, b]) => has(sec) && o.status === a && to === b && j > -1);
}

/** who hears a status: the subscribers of the order, and for a table order the guests of its sitting (core/floor.ts) */
const statusAudience = (o: Pick<Order, "no" | "session">) => ({ order: o.no, ...(o.session ? { table: o.session } : {}) });

/** The kitchen's lines follow a status set from outside the kitchen ("Поръчки" in the admin, PATCH; decision of the chief
    18.11, "проверка 2 на кухнята"), so an order never leaves the queues without its lines: "Готова" and later = every
    line ready; back to "Готви се" from "Готова" (every line ready) = they are cooked again; back to "Приета" = they wait.
    The kitchen's own steps (core/kitchen.ts) move the lines first, so for them nothing changes here. Returns the moved
    indexes. */
export function alignKitchen(o: Order, from: OrderStatus, status: OrderStatus, now: string): number[] {
  const moved: number[] = [], ks = (l: OrderLine) => (l.ks === "cook" || l.ks === "ready" ? l.ks : "wait");
  const set = (l: OrderLine, i: number, to: "wait" | "cook" | "ready") => { l.ks = to; (l as OrderLine & { ksAt?: string }).ksAt = now; moved.push(i); };
  /* a line the order was accepted without ("Приеми без него", "Махни") is only for reference: never moved */
  const lines = o.lines || [];
  if (["ready", "on_way", "delivered", "picked_up"].includes(status)) lines.forEach((l, i) => { if (!l.dropped && ks(l) !== "ready") { set(l, i, "ready"); l.readyAt = now; } });
  else if (status === "cooking" && from !== "accepted" && from !== "cancelled" && lines.length && lines.every((l) => l.dropped || ks(l) === "ready")) lines.forEach((l, i) => { if (l.dropped) return; set(l, i, "cook"); delete l.readyAt; if (!l.cookAt) l.cookAt = now; });
  else if (status === "accepted" && from !== "cancelled") lines.forEach((l, i) => { if (!l.dropped && ks(l) !== "wait" && !l.servedAt) { set(l, i, "wait"); delete l.readyAt; delete l.cookAt; } });
  return moved;
}

export async function setOrderStatus(ctx: Ctx, no: string, status: OrderStatus, actor = "system", by?: { user: { role: string }; sections: string[] }, reason?: string): Promise<Order> {
  const o = await getOrder(ctx, no);
  if (!o) throw new CoreError("not_found", "Няма такава поръчка.", 404);
  if (status !== "cancelled" && FLOW[o.mode].indexOf(status) < 0) throw new CoreError("bad_status", "Невалиден статус за този вид поръчка.");
  if (by && !stepAllowed(o, status, by)) throw new CoreError("bad_step", "Тази стъпка не е позволена за поръчката сега. Опреснете страницата.", 409);
  /* the same status again (two people pressed it): nothing to write, no line in the log; the pages still hear it once more */
  if (o.status === status) { emit(ctx, "order.status", { no: o.no, status, at: (o.times && o.times[status]) || o.updatedAt }, statusAudience(o)); return o; }
  const now = iso(ctx);
  if (status === "cancelled" && o.status !== "cancelled") o.prevStatus = o.status;
  else if (status !== "cancelled") { delete o.prevStatus; delete o.reason; }
  /* "Откажи" with a reason (orders-admin.ts requires it; the customer sees it on the tracking page) */
  if (status === "cancelled" && reason) o.reason = String(reason).replace(/\s+/g, " ").trim().slice(0, 200);
  const from = o.status;
  o.status = status; o.updatedAt = now; o.times = { ...(o.times || { accepted: o.createdAt }), [status]: now };
  const moved = from === "cancelled" ? [] : alignKitchen(o, from, status, now);
  await ctx.repo.put(COL.orders, o);
  await audit(ctx, actor, "order.status", o.no, { status, ...(o.reason && status === "cancelled" ? { reason: o.reason } : {}), ...(moved.length ? { lines: moved } : {}) });
  /* the kitchen's screens hear that its lines moved (a step from "Поръчки" in the admin) */
  if (moved.length) emit(ctx, "order.line", { no: o.no, kind: "status", sec: "all", status, table: o.table || null, session: o.session || null, lines: moved, at: now }, o.session ? { table: o.session } : {});
  emit(ctx, "order.status", { no: o.no, status, at: now }, statusAudience(o));
  /* Web Push to the browsers that asked for it: in the background, a slow push service never delays the kitchen */
  pushStatus(ctx, o).catch(() => { /* logged by the sender */ });
  return o;
}

/* ---------- change by the customer: pre-orders only ("за утре", or "за днес" made before 10:00) ----------
   The rule (decision of 14.11.2026, Поли): until 1 hour before the time of the order (the kitchen starts 20 min before
   it), only while the order is "Приета" (the kitchen has not started), only with the tracking key, and at the latest
   CHANGE_BEFORE_MIN minutes before the old AND the new time.
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
  let zone: Zone | null = null, addr = "", zoneRow: Awaited<ReturnType<typeof liveZone>> = null;
  if (mode === "delivery") {
    const z = resolveZone(p.addr !== undefined ? String(p.addr) : o0.addr, p.zone !== undefined ? p.zone : o0.zone, (o0.channel || "web") === "web");
    if ("error" in z) errs.addr = z.error; else { addr = z.addr; zoneRow = await liveZone(ctx, z.zone); zone = zoneRow ? zoneRow.zone : z.zone; }
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
  if (zoneRow && !errs.addr && !errs.slot) { const rule = zoneRule(zoneRow.row, { slot: +slot.slice(0, 2) * 60 + +slot.slice(3), sub: P.sub }); if (rule) errs[rule.field] = rule.msg; }
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
    await stampKitchen(ctx, o);
    await ctx.repo.put(COL.orders, o);
    return o;
  };
  const o = ctx.repo.transaction ? await ctx.repo.transaction(apply) : await apply();
  await audit(ctx, "customer", "order.change", o.no, { slot: o.slot, total: o.total, mode: o.mode });
  emit(ctx, "order.changed", { no: o.no, slot: o.slot, total: o.total, mode: o.mode }, { order: o.no });
  return o;
}

/* ---------- table orders (stage D, core/floor.ts): the guests' QR order and the waiter's "Нова поръчка" ----------
   An order at a table has no customer, address, time slot, payment, code or bonus: channel "qr" | "waiter", mode "pickup",
   `table` (the hall's table id), `session` (the sitting), `bill` ("Обща сметка" / "Гост 1"), `via` ("waiter": confirmed by
   the waiter). The same checks as every order (checkLines: unknown and removed dishes, the quantity, the add-ons from the
   menu, "Изчерпано днес") and the same price path (pricing.ts: the dish + its add-ons), plus the table's own rules:
   - the kitchen takes orders 10:00-22:30; breakfast until 11:30;
   - the lunch menu is not ordered from a table: [ЛИПСВА: обедно меню от масата] (OPEN-QUESTIONS, modules 6);
   - a `per100` steak needs its weight: 100-2000 g per piece, the unit price is price * grams / 100 (OPEN-QUESTIONS, modules 7);
   - a QR order keeps the limits of one online order (60 portions, 500 €); the waiter's order has none.
   The texts follow who reads them: the guests ("вие") or the staff ("ти"), the codes are the same. */
export interface TableLine { id: string; q: number; mods?: string[]; note?: string; grams?: number | null; guest?: string }
export interface TableOrderInput {
  table: string; tableN: number; session: string; channel: "qr" | "waiter"; lines: TableLine[]; note?: string; bill?: string; via?: "waiter" | "";
  /** the staff member (the waiter's order, or the waiter who confirmed a QR order) */
  by?: string;
  /** who reads the errors (default: the staff for "waiter", the guests for "qr") */
  speak?: "guest" | "staff";
}
export interface TableRow { id: string; name: string; q: number; mods: string[]; per100: boolean; grams: number | null;
  /** null: a `per100` steak without its weight yet */
  unit: number | null; sum: number | null; extra: number; cat: string; course: string; note?: string; guest?: string }
export const GRAMS_MIN = 100, GRAMS_MAX = 2000, LINE_NOTE_MAX = 140, TABLE_NOTE_MAX = 300;
export const LUNCH_TABLE_MISSING = "[ЛИПСВА: обедно меню от масата]";
export const TABLE_MSG = {
  guest: {
    closedEarly: "Кухнята отваря в 10:00. Менюто е за разглеждане, а за нещо друго повикайте сервитьор.",
    closed: "Кухнята приема поръчки до 22:30. За сметката или нещо друго повикайте сервитьор.",
    breakfast: (n: string) => "„" + n + "“ е от закуските, а те са до 11:30. Махнете го от количката.",
    lunch: "Обедното меню не се поръчва от телефона. Повикайте сервитьор.",
    qty: "Броят на едно ястие е от 1 до " + ORDER_RULES.maxQty + ". За повече повикайте сервитьор.",
    lines: "В една поръчка може до " + ORDER_RULES.maxLines + " различни ястия. За повече повикайте сервитьор.",
    big: "За толкова голяма поръчка повикайте сервитьор.",
    grams: "Грамажът е от " + GRAMS_MIN + " до " + GRAMS_MAX + " гр.",
  },
  staff: {
    closedEarly: "Кухнята отваря в 10:00, затова изпращането е спряно.",
    closed: "Кухнята приема поръчки до 22:30, затова изпращането е спряно. За нещо по изключение: управителят.",
    breakfast: (n: string) => "„" + n + "“ е от закуските, а те са до 11:30. Махни го от поръчката.",
    lunch: "Обедното меню не се въвежда на маса. " + LUNCH_TABLE_MISSING,
    qty: "Броят на едно ястие е от 1 до " + ORDER_RULES.maxQty + ".",
    lines: "В една поръчка може до " + ORDER_RULES.maxLines + " различни ястия. Раздели я на две.",
    big: "QR поръчката е над " + ORDER_RULES.maxPortions + " порции или " + ORDER_RULES.maxTotal + " €. Откажи я и я въведи на части.",
    grams: "Въведи грамажа: от " + GRAMS_MIN + " до " + GRAMS_MAX + " гр. За повече: две отделни парчета.",
    empty: "Поръчката е празна.",
    unknown: "Едно от ястията вече го няма в менюто. Обнови екрана.",
  },
};
/** the kitchen takes table orders now (10:00-22:30): 409 "closed" otherwise */
export function tableKitchenOpen(ctx: Ctx, speak: "guest" | "staff" = "guest"): void {
  if (!state(ctx.clock).kitchen) throw new CoreError("closed", minutes(ctx.clock) < 600 ? TABLE_MSG[speak].closedEarly : TABLE_MSG[speak].closed, 409);
}
const isBreakfast = (x: { cat: string; course?: string }) => x.course === "breakfast" || x.cat === "zakuski";
/** why this dish cannot be ordered from a table now ("" = it can): "lunch" | "breakfast" (the cart of the table marks the line) */
export function tableBlock(ctx: Ctx, id: string): "" | "lunch" | "breakfast" {
  const x = Object.prototype.hasOwnProperty.call(byId, id) ? byId[id] : undefined;
  return !x ? "" : x.lunch ? "lunch" : isBreakfast(x) && !state(ctx.clock).breakfast ? "breakfast" : "";
}
/** The lines of a table order, checked and priced. grams: "required" (the order is made now) or "later" (the guests'
    cart: the waiter enters the weight when he confirms; such a line has unit and sum null). */
export function checkTableLines(ctx: Ctx, lines: TableLine[], today: SoldOutToday, grams: "required" | "later", speak: "guest" | "staff" = "guest"): { rows: TableRow[]; n: number; sub: number; open: boolean } {
  const T = TABLE_MSG[speak], list = Array.isArray(lines) ? lines : [];
  list.forEach((l, i) => {
    const b = l && typeof l.id === "string" ? tableBlock(ctx, l.id) : "";
    if (b === "lunch") throw Object.assign(new CoreError("lunch_table", T.lunch, 409), { lines: [l.id], fields: { ["lines." + i]: T.lunch } });
    if (b === "breakfast") throw Object.assign(new CoreError("breakfast_closed", T.breakfast(byId[l.id].n), 409), { lines: [l.id], fields: { ["lines." + i]: T.breakfast(byId[l.id].n) } });
  });
  let cart: Cart;
  try { cart = checkLines(ctx, { lines: list.map((l) => ({ id: l && l.id, q: l && l.q, mods: l && l.mods })) }, "pickup", today); }
  catch (e) {
    if (e instanceof CoreError) {
      if (e.code === "bad_qty") e.message = T.qty;
      else if (e.code === "too_many") e.message = T.lines;
      else if (speak === "staff") e.message = e.code === "empty" ? TABLE_MSG.staff.empty : e.code === "unknown_item" ? TABLE_MSG.staff.unknown : e.message.replace("Махнете го от количката.", "Махни го от поръчката.");
    }
    throw e;
  }
  const P = price(cart, { clock: ctx.clock });
  const f: Record<string, string> = {}, rows: TableRow[] = [];
  let sub = 0, n = 0, open = false;
  P.rows.forEach((r, i) => {
    const src = list[i] || ({} as TableLine), x = r.x, extra = round2m(r.unit - x.p);
    let g: number | null = null, unit: number | null = r.unit;
    if (x.per100) {
      const v = src.grams == null || (src.grams as unknown) === "" ? null : +src.grams;
      if (v == null) { if (grams === "required") f["lines." + i + ".grams"] = T.grams; unit = null; open = true; }
      else if (!Number.isInteger(v) || v < GRAMS_MIN || v > GRAMS_MAX) { f["lines." + i + ".grams"] = T.grams; unit = null; }
      else { g = v; unit = round2m(round2m((x.p * v) / 100) + extra); }
    }
    const sum = unit == null ? null : round2m(unit * r.q);
    const note = src.note == null ? "" : String(src.note).replace(/\s+/g, " ").trim().slice(0, LINE_NOTE_MAX);
    const guest = src.guest == null ? "" : String(src.guest).trim().slice(0, 24);
    rows.push({ id: x.id, name: x.n, q: r.q, mods: r.mods || [], per100: !!x.per100, grams: g, unit, sum, extra, cat: x.cat, course: x.course, ...(note ? { note } : {}), ...(guest ? { guest } : {}) });
    n += r.q; if (sum != null) sub += sum;
  });
  if (Object.keys(f).length) invalid(f);
  return { rows, n, sub: round2m(sub), open };
}
const round2m = (v: number): number => Math.round(v * 100) / 100;

export async function createTableOrder(ctx: Ctx, i: TableOrderInput): Promise<Order> {
  const speak = i.speak || (i.channel === "waiter" ? "staff" : "guest");
  tableKitchenOpen(ctx, speak);
  const c = checkTableLines(ctx, i.lines, await soldOutToday(ctx), "required", speak);
  if (i.channel === "qr" && (c.n > ORDER_RULES.maxPortions || c.sub > ORDER_RULES.maxTotal)) throw new CoreError("too_big", TABLE_MSG[speak].big, 422);
  const m = minutes(ctx.clock);
  const make = async (): Promise<Order> => {
    const no = String(await ctx.repo.seq("order_no", FIRST_ORDER_NO)), ts = nowDate(ctx), at = ts.toISOString();
    const note = i.note ? String(i.note).replace(/\s+/g, " ").trim().slice(0, TABLE_NOTE_MAX) : "";
    const o: Order = {
      id: no, no, mode: "pickup", channel: i.channel,
      lines: c.rows.map((r) => ({ id: r.id, q: r.q, mods: r.mods, extra: r.extra, name: r.name, unit: r.unit as number, cat: r.cat, course: r.course,
        ...(r.note ? { note: r.note } : {}), ...(r.grams ? { grams: r.grams } : {}), ...(r.guest ? { guest: r.guest } : {}) })),
      lunchOnly: false, zone: "", addr: "", pay: "cash", payLabel: "На масата", sub: c.sub, disc: 0, fee: 0, total: c.sub,
      eta: null, at: "веднага", sched: "", slot: "asap", placedAt: hhmm(m), ts: ts.getTime(), status: "accepted",
      name: "Маса " + i.tableN, phone: "", ...(note ? { note } : {}), marketing: false, userId: null, table: i.table, key: randomKey(8), discKind: "",
      session: i.session, bill: i.bill || "Обща сметка", via: i.via || "", ...(i.by ? { by: String(i.by) } : {}),
      times: { accepted: at }, createdAt: at, updatedAt: at,
    };
    /* the kitchen: the lines get `sec` and `ks: "wait"` like createOrder's, and "Натоварено" adds its minutes to the deadline */
    const st = await getSettings(ctx);
    await stampKitchen(ctx, o, st.kitchen.busy ? st.kitchen.etaBusyMin - st.kitchen.etaMin : 0);
    await ctx.repo.put(COL.orders, o);
    return o;
  };
  const o = ctx.repo.transaction ? await ctx.repo.transaction(make) : await make();
  /* the kitchen and the hall hear it (staff only): a table order is not "a new online order" (order.created) */
  emit(ctx, "order.new", { no: o.no, channel: o.channel, mode: o.mode, table: o.table, n: i.tableN, session: o.session, bill: o.bill, status: o.status, lines: c.n, total: o.total,
    sched: "", slot: "asap", secs: [...new Set(o.lines.map((l) => l.sec))] });
  return o;
}
