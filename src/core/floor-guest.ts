/* The QR table: what the guests may do (no sign-in). Every call is authorised by the table's code (hall.ts tableByQr:
   an unknown or replaced code is 404 "Този код вече не работи") and the phone's own random token; a phone that is not in
   the sitting gets 403 "guest" ("Сканирайте кода на масата отново."), a closed sitting 409 "session_closed".
   The rules are in floor.ts (the head comment) and in orders.ts (the checks of a table order). One change at a time per
   table (rights.ts serial). Every change tells the phones of the sitting and the staff (floor.session). */
import { COL, emit, iso, nowDate, randomDigits, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Order, type Rating } from "./types.ts";
import { serial } from "./rights.ts";
import { tableByQr } from "./hall.ts";
import { getSettings } from "./settings.ts";
import { soldOutToday, outNow } from "./menu.ts";
import { MSG, removedMsg, createTableOrder, checkTableLines, tableKitchenOpen, tableBlock, TABLE_MSG } from "./orders.ts";
import { CODE_PREFIX, CODE_DIGITS, RATING_DISCOUNT } from "./codes.ts";
import { byId, removedById, ORDER_RULES, RESTAURANT } from "../lib/data.ts";
import { parseMods } from "../lib/pricing.ts";
import { sofiaYmd } from "../lib/time.ts";
import {
  FLOOR_MSG, CALL_KINDS, MAX_PHONES, CALL_NOTE_MAX, RATING_TEXT_MAX, FLOOR_UNDO_MS, lockKey, openSessionOf, saveSession, newSession, sessionOrders,
  floorEnv, guestViewOf, emitSession, emitCall, closeIfStale, callState, billLines, billWant, sendToWaiter, canRate, phoneLabel, phoneOf,
  type CallKind, type TableSession, type FloorGuest, type FloorCartLine, type GuestView,
} from "./floor.ts";

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
type Tbl = { id: string; n: number; zone: "salon" | "garden"; seats: number };
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const noSession = () => new CoreError("guest", FLOOR_MSG.noSession, 403);
const closedErr = () => new CoreError("session_closed", FLOOR_MSG.closed, 409);

async function viewOf(ctx: Ctx, s: TableSession, gid: string, orders?: Order[]): Promise<GuestView> {
  return guestViewOf(ctx, s, orders || (await sessionOrders(ctx, s)), await floorEnv(ctx, s), gid);
}
/** the table of the code (404) and the token in a valid shape (403) */
async function enter(ctx: Ctx, code: string, tok: string): Promise<Tbl> {
  const t = await tableByQr(ctx, code);
  if (!TOKEN.test(String(tok || ""))) throw noSession();
  return t;
}
/** the newest sitting of the table (open or closed) that this phone is a guest of */
async function mineOf(ctx: Ctx, tableId: string, tok: string): Promise<TableSession | null> {
  return (await ctx.repo.list<TableSession>(COL.tableSessions, { table: tableId } as Partial<TableSession>)).filter((x) => x.guests.some((g) => g.tok === tok)).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0] || null;
}
/** One change of the open sitting by one of its phones. closedOk: also the last closed sitting of that phone (the view
    after the close, the rating). */
async function withGuest<R>(ctx: Ctx, code: string, tok: string, fn: (s: TableSession, g: FloorGuest, t: Tbl) => Promise<R>, closedOk = false): Promise<R> {
  const t = await enter(ctx, code, tok);
  return serial(ctx.repo, lockKey(t.id), async () => {
    let s = await openSessionOf(ctx, t.id);
    if (!s || !s.guests.some((g) => g.tok === tok)) {
      s = await mineOf(ctx, t.id, tok);
      if (!s) throw noSession();
      if (!closedOk) throw closedErr();
    }
    return fn(s, s.guests.find((g) => g.tok === tok)!, t);
  });
}

/** The start of every screen: the sitting of this table for this phone. The first scan opens a sitting and adds the phone
    to it ("Телефон N", up to 7). A phone whose sitting was closed today keeps seeing that closed sitting (the bill is paid,
    the rating) and is NOT added to the next guests' sitting, until it scans again: `fresh: true`. The next day is a new start. */
export async function guestOpen(ctx: Ctx, code: string, tok: string, fresh = false): Promise<GuestView> {
  const t = await enter(ctx, code, tok);
  return serial(ctx.repo, lockKey(t.id), async () => {
    let s = await openSessionOf(ctx, t.id);
    if (s && (await closeIfStale(ctx, s))) { await emitSession(ctx, s); s = null; }
    if (!fresh && !(s && s.guests.some((g) => g.tok === tok))) {
      const last = await mineOf(ctx, t.id, tok);
      /* (a sitting from an earlier day that the core closed by itself is not "closed today") */
      if (last && last.status === "closed" && last.closedBy !== "system" && sofiaYmd(new Date(last.closedAt || last.openedAt)) === sofiaYmd(nowDate(ctx))) return viewOf(ctx, last, last.guests.find((g) => g.tok === tok)!.id);
    }
    if (!s) s = newSession(ctx, t, "qr", rid(12));
    let g = s.guests.find((x) => x.tok === tok);
    if (!g) {
      let n = 1;
      while (s.guests.some((x) => x.n === n)) n++;
      if (n > MAX_PHONES) throw new CoreError("table_full", FLOOR_MSG.full, 409);
      g = { id: "p" + n, n, tok, at: iso(ctx) };
      s.guests.push(g);
      await saveSession(ctx, s);
      await emitSession(ctx, s);
    }
    return viewOf(ctx, s, g.id);
  });
}
/** The view again (after an event): never opens a sitting and never adds a phone. */
export async function guestView(ctx: Ctx, code: string, tok: string): Promise<GuestView> {
  return withGuest(ctx, code, tok, (s, g) => viewOf(ctx, s, g.id), true);
}
/** /api/stream?table=<code>&g=<token>: the id of the sitting this phone is a guest of, or null */
export async function streamSession(ctx: Ctx, code: string, tok: string): Promise<string | null> {
  try {
    const t = await enter(ctx, code, tok), o = await openSessionOf(ctx, t.id);
    const s = o && o.guests.some((g) => g.tok === tok) ? o : await mineOf(ctx, t.id, tok);
    return s ? s.id : null;
  } catch { return null; }
}

/* ---------- the shared cart ---------- */
const modsKey = (m: string[]) => m.join(",");
function mustBeOpen(s: TableSession) { if (s.status !== "open") throw closedErr(); }
/** one dish for the cart: on the menu, not sold out, orderable from a table now; the clean modifications */
async function dishFor(ctx: Ctx, id: unknown, mods: unknown): Promise<{ id: string; mods: string[] }> {
  const k = typeof id === "string" ? id : "";
  if (!own(byId, k)) {
    if (own(removedById, k)) throw Object.assign(new CoreError("removed", removedMsg([removedById[k].n]), 409), { lines: [k] });
    throw new CoreError("unknown_item", MSG.unknown, 422);
  }
  const x = byId[k];
  if (mods != null && (!Array.isArray(mods) || mods.some((m) => typeof m !== "string"))) throw new CoreError("bad_mod", "Невалидна промяна на „" + x.n + "“.", 422);
  const pm = parseMods(x, ((mods as string[] | undefined) || []).map((m) => m.trim()).filter(Boolean));
  if (pm.bad) throw new CoreError("bad_mod", "Промяната „" + pm.bad + "“ не е възможна за „" + x.n + "“.", 422);
  if (x.lunch) throw Object.assign(new CoreError("lunch_table", TABLE_MSG.guest.lunch, 409), { lines: [k] });
  if (outNow(x, await soldOutToday(ctx))) throw Object.assign(new CoreError("sold_out", "„" + x.n + "“ е изчерпано днес.", 409), { lines: [k] });
  /* breakfast after 11:30 (and anything else the table rules refuse): the same check the order makes */
  if (tableBlock(ctx, k) === "breakfast") throw Object.assign(new CoreError("breakfast_closed", "„" + x.n + "“ е от закуските, а те са до 11:30.", 409), { lines: [k] });
  return { id: k, mods: pm.mods };
}
const qtyOf = (q: unknown, min: number): number => {
  const v = typeof q === "string" && /^\d+$/.test(q) ? +q : q;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > ORDER_RULES.maxQty) throw new CoreError("bad_qty", TABLE_MSG.guest.qty, 422);
  return v;
};
async function changed(ctx: Ctx, s: TableSession, gid: string): Promise<GuestView> {
  await saveSession(ctx, s);
  const orders = await sessionOrders(ctx, s), env = await floorEnv(ctx, s);
  await emitSession(ctx, s, orders, env);
  return guestViewOf(ctx, s, orders, env, gid);
}

/** "+": one more of a dish (the same dish with the same changes from the same phone is one line) */
export async function guestCartAdd(ctx: Ctx, code: string, tok: string, p: { id: string; q?: number; mods?: string[] }): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    tableKitchenOpen(ctx, "guest");
    const q = qtyOf(p && p.q == null ? 1 : p && p.q, 1), d = await dishFor(ctx, p && p.id, p && p.mods);
    const have = s.cart.find((l) => l.who === g.id && l.id === d.id && modsKey(l.mods) === modsKey(d.mods));
    if (have) { if (have.q + q > ORDER_RULES.maxQty) throw new CoreError("bad_qty", TABLE_MSG.guest.qty, 422); have.q += q; }
    else {
      if (s.cart.length >= ORDER_RULES.maxLines) throw new CoreError("too_many", TABLE_MSG.guest.lines, 422);
      s.cart.push({ key: rid(5), id: d.id, q, mods: d.mods, who: g.id, at: iso(ctx) });
    }
    return changed(ctx, s, g.id);
  });
}
/** the counter of a line (any line of the table); 0 removes it */
export async function guestCartQty(ctx: Ctx, code: string, tok: string, key: string, q: number): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const v = qtyOf(q, 0), l = s.cart.find((x) => x.key === String(key));
    if (!l) throw new CoreError("not_found", FLOOR_MSG.line, 404);
    if (v === 0) s.cart = s.cart.filter((x) => x !== l); else l.q = v;
    return changed(ctx, s, g.id);
  });
}
/** removes a line and returns it (`gone`), so the screen can offer "Отмени" (guestCartRestore) */
export async function guestCartRemove(ctx: Ctx, code: string, tok: string, key: string): Promise<{ view: GuestView; gone: FloorCartLine | null }> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const l = s.cart.find((x) => x.key === String(key)) || null;
    if (!l) throw new CoreError("not_found", FLOOR_MSG.line, 404);
    s.cart = s.cart.filter((x) => x !== l);
    return { view: await changed(ctx, s, g.id), gone: l };
  });
}
/** "Отмени" after a removal: the line comes back as it was (its phone, its changes), checked again */
export async function guestCartRestore(ctx: Ctx, code: string, tok: string, line: Partial<FloorCartLine>): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const l = line && typeof line === "object" ? line : {};
    const q = qtyOf(l.q, 1), d = await dishFor(ctx, l.id, l.mods);
    const who = s.guests.some((x) => x.id === l.who) ? (l.who as string) : g.id;
    if (s.cart.length >= ORDER_RULES.maxLines) throw new CoreError("too_many", TABLE_MSG.guest.lines, 422);
    const key = typeof l.key === "string" && /^[0-9a-f]{10}$/.test(l.key) && !s.cart.some((x) => x.key === l.key) ? l.key : rid(5);
    s.cart.push({ key, id: d.id, q, mods: d.mods, who, at: iso(ctx) });
    return changed(ctx, s, g.id);
  });
}

/** "Изпрати към сервитьора" (the first QR order, and any order with a steak "за 100 гр.") / "Изпрати към кухнята".
    to: "waiter" (it waits for "Потвърди и прати"; a send while one waits joins it) or "kitchen" (no: the order's number). */
export async function guestSend(ctx: Ctx, code: string, tok: string): Promise<{ view: GuestView; to: "waiter" | "kitchen"; no: string | null }> {
  return withGuest(ctx, code, tok, async (s, g, t) => {
    mustBeOpen(s);
    if (!s.cart.length) throw new CoreError("empty", MSG.empty);
    tableKitchenOpen(ctx, "guest");
    const orders = await sessionOrders(ctx, s), today = await soldOutToday(ctx);
    const all = [...(s.pending ? s.pending.lines : []), ...s.cart];
    const c = checkTableLines(ctx, s.cart.map((l) => ({ id: l.id, q: l.q, mods: l.mods })), today, "later", "guest");
    /* the limits of one online order count the dishes that already wait for the waiter too */
    let n = c.n, sub = c.sub;
    if (s.pending) { try { const pc = checkTableLines(ctx, s.pending.lines.map((l) => ({ id: l.id, q: l.q, mods: l.mods })), today, "later", "guest"); n += pc.n; sub += pc.sub; } catch { /* the waiter sees it when he confirms */ } }
    if (n > ORDER_RULES.maxPortions || sub > ORDER_RULES.maxTotal || all.length > ORDER_RULES.maxLines) throw new CoreError("too_big", TABLE_MSG.guest.big, 422);
    const now = iso(ctx);
    if (s.pending || sendToWaiter(s, orders, s.cart)) {
      /* the timer of the waiting order does not start again when more dishes join it */
      s.pending = s.pending ? { ...s.pending, lines: all } : { at: now, by: g.id, lines: s.cart };
      s.cart = []; s.rejected = null;
      const view = await changed(ctx, s, g.id);
      emit(ctx, "floor.qr", { table: s.table, n: t.n, session: s.id, state: "pending", at: s.pending.at, lines: n });
      return { view, to: "waiter" as const, no: null };
    }
    const o = await createTableOrder(ctx, { table: t.id, tableN: t.n, session: s.id, channel: "qr", via: "", lines: s.cart.map((l) => ({ id: l.id, q: l.q, mods: l.mods, guest: l.who })) });
    s.orders.push(o.no); s.cart = []; s.rejected = null;
    return { view: await changed(ctx, s, g.id), to: "kitchen" as const, no: o.no };
  });
}
/** "Разбрах" under "Сервитьорът отказа поръчката": the notice goes away for the whole table */
export async function guestRejectedOk(ctx: Ctx, code: string, tok: string): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    if (!s.rejected || s.status !== "open") return viewOf(ctx, s, g.id);
    s.rejected = null;
    return changed(ctx, s, g.id);
  });
}

/* ---------- calls ---------- */
const kindOf = (k: unknown): CallKind => { if (!CALL_KINDS.includes(k as CallKind)) throw Object.assign(new CoreError("invalid", FLOOR_MSG.callKind, 422), { fields: { kind: FLOOR_MSG.callKind } }); return k as CallKind; };
const coolErr = (until: number, nowMs: number) => Object.assign(new CoreError("call_cooldown", FLOOR_MSG.callCool, 409), { retryIn: Math.max(1, Math.ceil((until - nowMs) / 1000)) });

/** "Повикай сервитьор": Поръчка | Сметка | Вода или прибори | Друго (+ a few words). 409 "call_active" while the same call
    waits, 409 "call_cooldown" (+ retryIn seconds) for settings.callCooldown minutes after "Обслужено". */
export async function guestCall(ctx: Ctx, code: string, tok: string, kind: CallKind, note?: string): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const k = kindOf(kind), st = await getSettings(ctx), nowMs = nowDate(ctx).getTime(), cs = callState(s, k, nowMs, st.callCooldown);
    if (cs.state === "active") throw new CoreError("call_active", FLOOR_MSG.callActive, 409);
    if (cs.state === "cool") throw coolErr(cs.until!, nowMs);
    const c = { id: rid(6), kind: k, note: String(note == null ? "" : note).replace(/\s+/g, " ").trim().slice(0, CALL_NOTE_MAX), at: iso(ctx), by: g.id, taken: null, done: null };
    s.calls.push(c);
    const view = await changed(ctx, s, g.id);
    emitCall(ctx, s, c);
    return view;
  });
}
/** "Не ни трябва вече": the call is free again at once. The call "Сметка" belongs to every phone that asked for the bill:
    the phone takes its own request back, the call goes only when no request is left. */
export async function guestCallCancel(ctx: Ctx, code: string, tok: string, kind: CallKind): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const k = kindOf(kind), c = s.calls.find((x) => x.kind === k && !x.done);
    if (!c) throw new CoreError("not_found", FLOOR_MSG.callNone, 404);
    if (k === "bill") {
      if (s.bills[g.id]) { delete s.bills[g.id]; for (const key of Object.keys(s.picks)) if (s.picks[key] === g.id && !billPaid(s, key)) delete s.picks[key]; }
      if (Object.keys(s.bills).length) return changed(ctx, s, g.id);
    }
    c.done = { how: "cancel", at: iso(ctx), by: g.id };
    const view = await changed(ctx, s, g.id);
    emitCall(ctx, s, c);
    return view;
  });
}
const billPaid = (s: TableSession, key: string) => s.payments.some((p) => p.keys.includes(key));
/** "Отмени" after a cancel (a few seconds): the same call waits again, its time does not start over. Not for "Сметка". */
export async function guestCallRestore(ctx: Ctx, code: string, tok: string, kind: CallKind): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const k = kindOf(kind), nowMs = nowDate(ctx).getTime();
    const c = s.calls.filter((x) => x.kind === k && x.done && x.done.how === "cancel" && x.done.by === g.id).sort((a, b) => (a.done!.at < b.done!.at ? 1 : -1))[0];
    if (!c || k === "bill" || nowMs - Date.parse(c.done!.at) > FLOOR_UNDO_MS || s.calls.some((x) => x.kind === k && !x.done)) throw new CoreError("not_found", FLOOR_MSG.callNone, 404);
    c.done = null;
    const view = await changed(ctx, s, g.id);
    emitCall(ctx, s, c);
    return view;
  });
}

/* ---------- the bill ---------- */
/** "Поискай сметката": pay "cash" | "card"; split "one" (what is left of the table's bill), "guests" (the dishes of this
    phone), "dishes" (this phone's picks). What another phone asked for is never asked twice. The request joins the call
    "Сметка" that already waits (its time goes on). */
export async function guestBill(ctx: Ctx, code: string, tok: string, p: { pay: "cash" | "card"; split: "one" | "guests" | "dishes" }): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const q = p && typeof p === "object" ? p : ({} as { pay: "cash" | "card"; split: "one" | "guests" | "dishes" }), f: Record<string, string> = {};
    if (q.pay !== "cash" && q.pay !== "card") f.pay = FLOOR_MSG.billPay;
    if (q.split !== "one" && q.split !== "guests" && q.split !== "dishes") f.split = FLOOR_MSG.billSplit;
    if (Object.keys(f).length) throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields: f });
    const orders = await sessionOrders(ctx, s), lines = billLines(orders);
    if (!lines.length) throw new CoreError("nothing_ordered", FLOOR_MSG.nothingOrdered, 409);
    const st = await getSettings(ctx), nowMs = nowDate(ctx).getTime(), cs = callState(s, "bill", nowMs, st.callCooldown), mine = s.bills[g.id];
    /* the waiter has just brought the bill this phone asked for: the same request again waits like every call */
    if (cs.state === "cool" && mine && mine.at <= cs.call!.done!.at) throw coolErr(cs.until!, nowMs);
    const want = billWant(s, lines, g.id, q.split);
    if (!want.length) throw new CoreError("bill_nothing", q.split === "one" ? FLOOR_MSG.billAll : q.split === "guests" ? FLOOR_MSG.billMine : FLOOR_MSG.billPick, 409);
    s.bills[g.id] = { at: iso(ctx), pay: q.pay, split: q.split, keys: want.map((b) => b.key) };
    let c = cs.state === "active" ? cs.call! : null;
    if (c) c.joined = (c.joined || 0) + (mine ? 0 : 1);
    else { c = { id: rid(6), kind: "bill", note: "", at: iso(ctx), by: g.id, taken: null, done: null }; s.calls.push(c); }
    const view = await changed(ctx, s, g.id);
    emitCall(ctx, s, c);
    return view;
  });
}
/** "По ястия": ticks (on) or frees (off) lines for this phone. A line another phone ticked, asked for or paid is refused. */
export async function guestPick(ctx: Ctx, code: string, tok: string, keys: string | string[], on: boolean): Promise<GuestView> {
  return withGuest(ctx, code, tok, async (s, g) => {
    mustBeOpen(s);
    const list = [...new Set((Array.isArray(keys) ? keys : [keys]).map(String))].slice(0, 200);
    const lines = billLines(await sessionOrders(ctx, s));
    if (s.bills[g.id]) throw new CoreError("bill_asked", FLOOR_MSG.billAsked, 409);
    const asked = new Map<string, string>();
    for (const k of Object.keys(s.bills)) s.bills[k].keys.forEach((x) => asked.set(x, k));
    for (const key of list) {
      const b = lines.find((x) => x.key === key);
      if (!b || b.out || b.paid || asked.has(key)) throw new CoreError("pick_gone", FLOOR_MSG.pickGone, 409);
      const owner = s.picks[key];
      if (owner && owner !== g.id) throw new CoreError("picked", FLOOR_MSG.picked(phoneLabel(phoneOf(owner) || 0)), 409);
    }
    for (const key of list) { if (on) s.picks[key] = g.id; else delete s.picks[key]; }
    return changed(ctx, s, g.id);
  });
}

/* ---------- the rating ("Останахте ли доволни?") ---------- */
/** One rating per phone at the table (the answer and the text can change, the code stays): -10% "SC10-…" from the codes
    of the core for both answers; the Google link is shown for both answers and never brings a discount. The text reaches
    only the manager. Also after the table is closed. */
export async function guestRate(ctx: Ctx, code: string, tok: string, p: { happy: boolean; text?: string }): Promise<{ view: GuestView; code: string; pct: number; google: string | null; googleMissing: boolean }> {
  return withGuest(ctx, code, tok, async (s, g) => {
    if (!p || typeof p.happy !== "boolean") throw Object.assign(new CoreError("invalid", FLOOR_MSG.rateAnswer, 422), { fields: { happy: FLOOR_MSG.rateAnswer } });
    if (!canRate(s, g.id)) throw new CoreError("not_finished", FLOOR_MSG.rateEarly, 409);
    const text = p.text ? String(p.text).trim().slice(0, RATING_TEXT_MAX) : "", now = iso(ctx);
    let r = s.ratings[g.id], doc = r ? await ctx.repo.get<Rating>(COL.ratings, r.ratingId) : null;
    if (!r || !doc) {
      let c = CODE_PREFIX + randomDigits(CODE_DIGITS);
      for (let i = 0; i < 5 && (await ctx.repo.list<Rating>(COL.ratings)).some((x) => x.code === c); i++) c = CODE_PREFIX + randomDigits(CODE_DIGITS);
      doc = { id: rid(8), orderNo: s.orders[0], happy: p.happy, ...(text ? { text } : {}), code: c, pct: RATING_DISCOUNT, usedBy: null, usedAt: null, createdAt: now, updatedAt: now, session: s.id, guest: g.id };
      r = { ratingId: doc.id, happy: p.happy, sent: !!text, code: c, at: now };
    } else {
      doc.happy = p.happy; if (text) doc.text = text; doc.updatedAt = now;
      r = { ...r, happy: p.happy, sent: r.sent || !!text, at: now };
    }
    await ctx.repo.put(COL.ratings, doc);
    s.ratings[g.id] = r;
    await saveSession(ctx, s);
    /* the staff hear that a rating came (never the text); the other phones see nothing of it */
    emit(ctx, "rating.created", { orderNo: doc.orderNo, happy: doc.happy, table: s.table, session: s.id });
    return { view: await viewOf(ctx, s, g.id), code: r.code, pct: RATING_DISCOUNT, google: RESTAURANT.googleReview, googleMissing: !RESTAURANT.googleReview };
  }, true);
}
