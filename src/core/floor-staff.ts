/* The hall for the waiter (section "Сервитьор"; the main admin, the owner and the manager may do the same). The rules are
   in floor.ts (the head comment); every function checks the right itself and every action writes a line in the log.
   - the hall live: every table in use with its state (Вика + reason > Чака сметка > QR поръчка > Готово > Чака поръчка >
     Заета > Свободна), since when it waits, whose table it is, the calls and the QR orders that wait, the counters and
     ONE number for the queue (the same in the hall, in the bar and in "Повиквания");
   - calls: "Отивам" (the colleagues see who took it), "Обслужено", "Отмени" for a few seconds;
   - a QR order that waits: "Потвърди и прати" (the grams of a steak "за 100 гр." are entered here) / "Откажи" with a reason;
   - a table: the orders by bill ("Обща сметка" / "Гост 1"), every line with its state and "Сервирах" (+ "Отмени"), the
     bill (one / by guest / by dish, cash / card, "Маркирай платено"), "Затвори масата";
   - "Нова поръчка" → "Към кухнята": an Order with the channel "waiter" in the table's sitting (a free table gets one);
   - "Готови": the lines the kitchen marked ready and nobody served, by table, the oldest first, my tables first;
   - the search of the waiter: tables, orders at the tables, today's reservations (phones masked), sold out today. */
import { COL, emit, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Iso, type Order, type OrderStatus, type Rating, type Reservation } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { audit } from "./audit.ts";
import { may, isBoss, invalid, serial, maskPhone, RIGHTS_MSG } from "./rights.ts";
import { liveHall } from "./hall.ts";
import type { HallTable } from "./site-data.ts";
import { getSettings } from "./settings.ts";
import { soldOutToday, outNow, type SoldOutToday } from "./menu.ts";
import { createTableOrder, checkTableLines, tableKitchenOpen, tableBlock, setOrderStatus, STATUS_LABEL, type TableLine } from "./orders.ts";
import { byId, items } from "../lib/data.ts";
import { parseMods } from "../lib/pricing.ts";
import { searchDishes, latin } from "../lib/search.ts";
import { sofiaYmd } from "../lib/time.ts";
import { shiftDay } from "../lib/shift-day.ts";
import {
  FLOOR_MSG, CALL_STAFF, CALL_WARN_MIN, REJECT_REASONS, ZONE_NAME, BILL_ALL, FLOOR_UNDO_MS, LINE_LABEL, needFloor, lockKey, openSessionOf, openSessions, saveSession, newSession,
  sessionOrders, tableOf, billLines, sumOf, r2, phoneOf, phoneLabel, callLate, emitSession, emitCall, closeIfStale, patchOrder, lineTouch,
  type BillLine, type CallKind, type FloorCall, type FloorPayment, type LineSt, type RejectReason, type TableSession,
} from "./floor.ts";
import { openShifts, tableOwners, type TableOwner } from "./floor-shift.ts";

/* ---------- shapes ---------- */
export type TableStateKey = "call" | "bill" | "qr" | "ready" | "wait" | "busy" | "free";
export const TABLE_STATE_LABEL: Record<TableStateKey, string> = { call: "Вика", bill: "Чака сметка", qr: "QR поръчка", ready: "Готово за сервиране", wait: "Чака поръчка", busy: "Заета", free: "Свободна" };
type TRef = { id: string; n: number; zone: "salon" | "garden" };
export interface HallCall {
  id: string; table: TRef; session: string; kind: CallKind; label: string; note: string; at: Iso; /** the phone that called, or null */ phone: number | null;
  /** more requests in the same call (a second phone asked for the bill) */ joined: number;
  taken: { by: string; name: string; at: Iso; mine: boolean; /** given by the manager ("Възложи на…") */ assigned?: boolean } | null;
  /** waits over 2 minutes / over the manager's minutes without "Отивам" (it is with the manager too) */
  warn: boolean; late: boolean;
  /** my table / in my queue (nobody took it, or I did) */
  mine: boolean; forMe: boolean;
}
export interface HallQr { table: TRef; session: string; at: Iso; /** portions, the sum of the priced lines, a steak without a price */ n: number; sum: number; open: boolean; /** over settings.qrManager minutes: with the manager */ late: boolean; mine: boolean; forMe: boolean;
  /** the manager gave it to a waiter ("Възложи на…"): his name; forMe only for him */ to?: { username: string; name: string } }
export interface HallTile {
  id: string; n: number; zone: "salon" | "garden"; seats: number; state: TableStateKey; /** "Вика · Сметка" */ label: string; reason: CallKind | null;
  /** since when (the call, the QR order, the oldest ready dish, the sitting); waits: a timer "чака 2:15" belongs here */
  since: Iso | null; waits: boolean; owner: { username: string; name: string } | null; mine: boolean; session: string | null;
}
export interface HallLive {
  now: Iso; me: { username: string; name: string; onShift: boolean; since: Iso | null; tables: number[] };
  tables: HallTile[]; calls: HallCall[]; qr: HallQr[];
  /** queue: the ONE number of "what waits for me" (calls nobody took or I took + QR orders for me); ready: dishes ready and not served */
  counters: { queue: number; calls: number; qr: number; ready: number; readyTables: number; free: number; busy: number };
  settings: { warnMin: number; callManager: number; qrManager: number; callCooldown: number };
}
export interface StaffLine {
  /** "<№>:<index>" */ key: string; no: string; idx: number; id: string; name: string; q: number; mods: string[]; note: string; grams: number | null; unit: number; sum: number;
  st: LineSt; stLabel: string; out: boolean; paid: boolean; /** "Телефон 2" (a QR line) / "Гост 1" / "" */ guest: string; readyAt: Iso | null; servedAt: Iso | null; canUnserve: boolean;
  /** "Изчерпано днес" before the kitchen started it: the kitchen waits for "Махни" (outDrop) */ decide: boolean;
}
export interface StaffOrder { no: string; placedAt: string; ts: number; channel: "qr" | "waiter"; /** confirmed by a waiter */ via: boolean; source: string; by: string; note: string; status: OrderStatus; statusLabel: string; lines: StaffLine[]; sum: number }
export interface StaffBill { name: string; sum: number; paid: number; rest: number; orders: StaffOrder[] }
export interface PendingLine {
  key: string; id: string; name: string; q: number; mods: string[]; per100: boolean; /** the price for 100 g of a steak */ price100: number | null; unit: number | null; sum: number | null; phone: number;
  /** added or changed by a phone the waiter has not confirmed yet ("нов телефон"; only after the table's first confirmed QR order) */ isNew: boolean;
  /** why it cannot go to the kitchen now (not in the sum): the waiter takes it out ("Махни", qrDrop) before "Потвърди и прати" */
  block: "" | "sold_out" | "removed" | "lunch" | "breakfast";
}
export interface TableDetail {
  table: TRef & { zoneName: string; seats: number }; owner: { username: string; name: string } | null; mine: boolean;
  state: TableStateKey; label: string; since: Iso | null;
  session: { id: string; openedAt: Iso; by: "qr" | "waiter"; phones: number; cart: number } | null;
  calls: HallCall[];
  pending: { at: Iso; phone: number; late: boolean; lines: PendingLine[]; n: number; sum: number; open: boolean; /** lines that cannot go now */ blocked: number } | null;
  bills: StaffBill[]; total: number; paid: number; rest: number;
  payments: { id: string; at: Iso; by: string; how: "cash" | "card"; sum: number; keys: string[]; label: string }[];
  /** what the phones asked for (the waiter sees the sums) */
  requests: { phone: number; at: Iso; pay: "cash" | "card"; split: "one" | "guests" | "dishes"; keys: string[]; sum: number }[];
  unserved: { key: string; name: string; q: number }[];
  /** "Затвори масата" is possible (everything is paid, no QR order waits) */
  canClose: boolean;
  reasons: { key: RejectReason; label: string }[];
}
export interface ReadyGroup { table: TRef; mine: boolean; owner: { username: string; name: string } | null; since: Iso;
  lines: { key: string; no: string; idx: number; name: string; q: number; mods: string[]; note: string; grams: number | null; bill: string; cat: string; readyAt: Iso }[] }

/* ---------- helpers ---------- */
const tref = (t: Pick<HallTable, "id" | "n" | "zone">): TRef => ({ id: t.id, n: t.n, zone: t.zone });
const readyAtOf = (b: BillLine): Iso => b.l.readyAt || (b.o.times && b.o.times.ready) || b.o.updatedAt;
const tableLabel = (o: Order) => (o.status === "picked_up" ? "Сервирана" : STATUS_LABEL[o.status]);
const guestOf = (g?: string) => { const p = phoneOf(g); return p ? phoneLabel(p) : g || ""; };
function stateOf(s: TableSession | null, lines: BillLine[]): { state: TableStateKey; label: string; reason: CallKind | null; since: Iso | null; waits: boolean } {
  if (!s) return { state: "free", label: TABLE_STATE_LABEL.free, reason: null, since: null, waits: false };
  const act = s.calls.filter((c) => !c.done).sort((a, b) => (a.at < b.at ? -1 : 1)), c = act.find((x) => x.kind !== "bill"), b = act.find((x) => x.kind === "bill");
  if (c) return { state: "call", label: "Вика · " + CALL_STAFF[c.kind], reason: c.kind, since: c.at, waits: true };
  if (b) return { state: "bill", label: TABLE_STATE_LABEL.bill, reason: "bill", since: b.at, waits: true };
  if (s.pending) return { state: "qr", label: TABLE_STATE_LABEL.qr, reason: null, since: s.pending.at, waits: true };
  const rd = lines.filter((x) => !x.out && x.st === "ready").map(readyAtOf).sort()[0];
  if (rd) return { state: "ready", label: TABLE_STATE_LABEL.ready, reason: null, since: rd, waits: true };
  if (!lines.length) return { state: "wait", label: TABLE_STATE_LABEL.wait, reason: null, since: s.openedAt, waits: true };
  return { state: "busy", label: TABLE_STATE_LABEL.busy, reason: null, since: s.openedAt, waits: false };
}
function callView(c: FloorCall, s: TableSession, t: TRef, me: StaffCtx, owner: TableOwner | undefined, nowMs: number, managerMin: number): HallCall {
  const tk = c.taken ? { by: c.taken.by, name: c.taken.name, at: c.taken.at, mine: c.taken.by === me.user.username, ...(c.taken.assigned ? { assigned: true } : {}) } : null;
  return { id: c.id, table: t, session: s.id, kind: c.kind, label: CALL_STAFF[c.kind], note: c.note, at: c.at, phone: phoneOf(c.by), joined: c.joined || 0, taken: tk,
    warn: !c.taken && nowMs - Date.parse(c.at) >= CALL_WARN_MIN * 60_000, late: callLate(c, nowMs, managerMin), mine: !!owner && owner.user === me.user.id, forMe: !tk || tk.mine };
}
function pendingView(ctx: Ctx, s: TableSession, today: SoldOutToday): { lines: PendingLine[]; n: number; sum: number; open: boolean; blocked: number } {
  const seen = s.seen || [], confirmed = seen.length > 0;
  const lines: PendingLine[] = (s.pending ? s.pending.lines : []).map((l) => {
    const x = Object.prototype.hasOwnProperty.call(byId, l.id) ? byId[l.id] : undefined, per100 = !!(x && x.per100);
    const block: PendingLine["block"] = !x ? "removed" : outNow(x, today) ? "sold_out" : tableBlock(ctx, x.id);
    let unit: number | null = null;
    if (x && !per100) { try { unit = checkOne(l.id, l.mods); } catch { unit = x.p; } }
    return { key: l.key, id: l.id, name: x ? x.n : l.id, q: l.q, mods: l.mods, per100, price100: per100 ? x.p : null, unit, sum: unit == null ? null : r2(unit * l.q), phone: phoneOf(l.who) || 0,
      isNew: confirmed && lineTouch(l).some((w) => !seen.includes(w)), block };
  });
  const live = lines.filter((l) => !l.block);
  return { lines, n: lines.reduce((a, l) => a + l.q, 0), sum: r2(live.reduce((a, l) => a + (l.sum || 0), 0)), open: live.some((l) => l.sum == null), blocked: lines.length - live.length };
}
const checkOne = (id: string, mods: string[]): number => r2(byId[id].p + parseMods(byId[id], mods).extra);

/** the open sittings with their orders (sittings left open from an earlier day with nothing unpaid are closed first) */
async function liveSessions(ctx: Ctx): Promise<{ s: TableSession; orders: Order[]; lines: BillLine[] }[]> {
  const out: { s: TableSession; orders: Order[]; lines: BillLine[] }[] = [];
  for (const s of await openSessions(ctx)) {
    if (await closeIfStale(ctx, s)) { await emitSession(ctx, s); continue; }
    const orders = await sessionOrders(ctx, s);
    out.push({ s, orders, lines: billLines(orders) });
  }
  return out;
}

/* ---------- the hall live ---------- */
export async function hallLive(ctx: Ctx, s: StaffCtx): Promise<HallLive> {
  needFloor(s);
  const hall = (await liveHall(ctx)).tables.filter((t) => !t.off).sort((a, b) => a.n - b.n), shifts = await openShifts(ctx), owners = await tableOwners(ctx, shifts), st = await getSettings(ctx);
  const live = await liveSessions(ctx), nowD = nowDate(ctx), nowMs = nowD.getTime(), myShift = shifts.find((x) => x.user === s.user.id) || null;
  const today = await soldOutToday(ctx);
  const qrMin = st.qrManager || 3;
  const tiles: HallTile[] = [], calls: HallCall[] = [], qr: HallQr[] = [];
  let ready = 0, readyTables = 0;
  for (const t of hall) {
    const L = live.find((x) => x.s.table === t.id) || null, o = owners.get(t.id), mine = !!o && o.user === s.user.id;
    const sv = stateOf(L ? L.s : null, L ? L.lines : []);
    tiles.push({ id: t.id, n: t.n, zone: t.zone, seats: t.seats, state: sv.state, label: sv.label, reason: sv.reason, since: sv.since, waits: sv.waits, owner: o ? { username: o.username, name: o.name } : null, mine, session: L ? L.s.id : null });
    if (!L) continue;
    for (const c of L.s.calls) if (!c.done) calls.push(callView(c, L.s, tref(t), s, o, nowMs, st.callManager));
    if (L.s.pending) { const p = pendingView(ctx, L.s, today); qr.push({ table: tref(t), session: L.s.id, at: L.s.pending.at, n: p.n, sum: p.sum, open: p.open, late: nowMs - Date.parse(L.s.pending.at) >= qrMin * 60_000, mine,
      forMe: L.s.pending.to ? L.s.pending.to.by === s.user.username : mine || !o || !myShift, ...(L.s.pending.to ? { to: { username: L.s.pending.to.by, name: L.s.pending.to.name } } : {}) }); }
    const r = L.lines.filter((x) => !x.out && x.st === "ready").length;
    ready += r; if (r) readyTables++;
  }
  calls.sort((a, b) => (a.at < b.at ? -1 : 1)); qr.sort((a, b) => (a.at < b.at ? -1 : 1));
  return {
    now: nowD.toISOString(),
    me: { username: s.user.username, name: s.user.name, onShift: !!myShift, since: myShift ? myShift.startedAt : null, tables: myShift ? hall.filter((t) => myShift.tables.includes(t.id)).map((t) => t.n) : [] },
    tables: tiles, calls, qr,
    counters: { queue: calls.filter((c) => c.forMe).length + qr.filter((x) => x.forMe).length, calls: calls.length, qr: qr.length, ready, readyTables, free: tiles.filter((t) => t.state === "free").length, busy: tiles.filter((t) => t.state !== "free").length },
    settings: { warnMin: CALL_WARN_MIN, callManager: st.callManager, qrManager: qrMin, callCooldown: st.callCooldown },
  };
}

/* ---------- one table ---------- */
async function detailOf(ctx: Ctx, me: StaffCtx, t: HallTable, s: TableSession | null): Promise<TableDetail> {
  const owners = await tableOwners(ctx), o = owners.get(t.id), st = await getSettings(ctx), nowMs = nowDate(ctx).getTime();
  const orders = s ? await sessionOrders(ctx, s) : [], lines = billLines(orders), sv = stateOf(s, lines);
  const bills: StaffBill[] = [];
  for (const ord of orders.filter((x) => x.status !== "cancelled").sort((a, b) => a.ts - b.ts || +a.no - +b.no)) {
    const name = ord.bill || BILL_ALL;
    let b = bills.find((x) => x.name === name);
    if (!b) { b = { name, sum: 0, paid: 0, rest: 0, orders: [] }; bills.push(b); }
    const ls: StaffLine[] = lines.filter((x) => x.no === ord.no).map((x) => ({
      key: x.key, no: x.no, idx: x.idx, id: x.l.id, name: x.l.name || x.l.id, q: x.l.q, mods: x.l.mods || [], note: x.l.note || "", grams: x.l.grams || null, unit: x.l.unit ?? 0, sum: x.sum,
      st: x.st, stLabel: LINE_LABEL[x.st], out: x.out, paid: x.paid, guest: guestOf(x.l.guest), readyAt: x.st === "ready" ? readyAtOf(x) : x.l.readyAt || null, servedAt: x.l.servedAt || null,
      /* only who served it (or the management) may take "Сервирах" back: the core refuses the others, the screen does not offer it */
      decide: !!x.l.out && !x.l.dropped && (x.l.ks || "wait") === "wait" && ["accepted", "cooking"].includes(ord.status),
      canUnserve: !!x.l.servedAt && nowMs - Date.parse(x.l.servedAt) <= FLOOR_UNDO_MS && (!x.l.servedBy || x.l.servedBy === me.user.username || isBoss(me)),
    }));
    b.orders.push({ no: ord.no, placedAt: ord.placedAt, ts: ord.ts, channel: ord.channel === "waiter" ? "waiter" : "qr", via: ord.via === "waiter", source: ord.channel === "waiter" ? "от сервитьор" : "от QR", by: ord.by || "", note: ord.note || "", status: ord.status, statusLabel: tableLabel(ord), lines: ls, sum: sumOf(ls) });
    b.sum = r2(b.sum + sumOf(ls)); b.paid = r2(b.paid + sumOf(ls.filter((l) => l.paid))); b.rest = r2(b.sum - b.paid);
  }
  /* "Обща сметка" first, then "Гост 1", "Гост 2" … */
  bills.sort((a, b) => (a.name === BILL_ALL ? -1 : b.name === BILL_ALL ? 1 : a.name.localeCompare(b.name, "bg", { numeric: true })));
  const total = sumOf(lines), paid = sumOf(lines.filter((x) => x.paid)), rest = r2(total - paid), p = s && s.pending ? pendingView(ctx, s, await soldOutToday(ctx)) : null;
  return {
    table: { ...tref(t), zoneName: ZONE_NAME[t.zone], seats: t.seats }, owner: o ? { username: o.username, name: o.name } : null, mine: !!o && o.user === me.user.id,
    state: sv.state, label: sv.label, since: sv.since,
    session: s ? { id: s.id, openedAt: s.openedAt, by: s.by, phones: s.guests.length, cart: s.cart.reduce((a, l) => a + l.q, 0) } : null,
    calls: s ? s.calls.filter((c) => !c.done).sort((a, b) => (a.at < b.at ? -1 : 1)).map((c) => callView(c, s, tref(t), me, o, nowMs, st.callManager)) : [],
    pending: s && s.pending && p ? { at: s.pending.at, phone: phoneOf(s.pending.by) || 0, late: nowMs - Date.parse(s.pending.at) >= (st.qrManager || 3) * 60_000, ...p } : null,
    bills, total, paid, rest,
    payments: s ? s.payments.map((x) => ({ ...x })) : [],
    requests: s ? Object.keys(s.bills).map((k) => ({ phone: phoneOf(k) || 0, at: s.bills[k].at, pay: s.bills[k].pay, split: s.bills[k].split, keys: s.bills[k].keys, sum: sumOf(lines.filter((x) => s.bills[k].keys.includes(x.key))) })).sort((a, b) => (a.at < b.at ? -1 : 1)) : [],
    unserved: lines.filter((x) => !x.out && x.st !== "served").map((x) => ({ key: x.key, name: (x.l.name || x.l.id) + (x.l.grams ? " · " + x.l.grams + " гр." : ""), q: x.l.q })),
    canClose: !!s && !s.pending && rest < 0.005,
    reasons: (Object.keys(REJECT_REASONS) as RejectReason[]).map((k) => ({ key: k, label: REJECT_REASONS[k].staff })),
  };
}
/** a table by its id ("S12") or its number ("12") */
export async function tableDetail(ctx: Ctx, s: StaffCtx, ref: string | number): Promise<TableDetail> {
  needFloor(s);
  const t = await tableOf(ctx, ref);
  return detailOf(ctx, s, t, await openSessionOf(ctx, t.id));
}
/** one change of a table's sitting; create: a free table gets a sitting (the waiter's first action) */
async function onTable<R>(ctx: Ctx, ref: string | number, create: boolean, fn: (sit: TableSession, t: HallTable, fresh: boolean) => Promise<R>): Promise<R> {
  const t = await tableOf(ctx, ref);
  return serial(ctx.repo, lockKey(t.id), async () => {
    let sit = await openSessionOf(ctx, t.id), fresh = false;
    if (sit && (await closeIfStale(ctx, sit))) { await emitSession(ctx, sit); sit = null; }
    if (!sit) { if (!create) throw new CoreError("no_session", FLOOR_MSG.sFree, 409); sit = newSession(ctx, t, "waiter", rid(12)); fresh = true; }
    return fn(sit, t, fresh);
  });
}
const done = async (ctx: Ctx, me: StaffCtx, t: HallTable, sit: TableSession): Promise<TableDetail> => { await saveSession(ctx, sit); await emitSession(ctx, sit); return detailOf(ctx, me, t, sit.status === "open" ? sit : null); };

/** guests sat down, no order yet ("Чака поръчка"): opens the sitting. [the waiter's prototype has no button for it] */
export async function seat(ctx: Ctx, s: StaffCtx, ref: string | number): Promise<TableDetail> {
  needFloor(s);
  return onTable(ctx, ref, true, async (sit, t, fresh) => {
    if (!fresh) return detailOf(ctx, s, t, sit);
    await audit(ctx, s.user.username, "floor.seat", t.id, { n: t.n });
    return done(ctx, s, t, sit);
  });
}

/* ---------- calls ---------- */
async function onCall<R>(ctx: Ctx, id: string, fn: (sit: TableSession, c: FloorCall, t: HallTable) => Promise<R>): Promise<R> {
  const hit = (await openSessions(ctx)).find((x) => x.calls.some((c) => c.id === String(id)));
  if (!hit) throw new CoreError("not_found", FLOOR_MSG.sCall, 404);
  return onTable(ctx, hit.table, false, async (sit, t) => {
    const c = sit.calls.find((x) => x.id === String(id));
    if (!c) throw new CoreError("not_found", FLOOR_MSG.sCall, 404);
    return fn(sit, c, t);
  });
}
const afterCall = async (ctx: Ctx, me: StaffCtx, sit: TableSession, c: FloorCall): Promise<HallLive> => { await saveSession(ctx, sit); emitCall(ctx, sit, c); await emitSession(ctx, sit); return hallLive(ctx, me); };
/** "Отивам": the call is mine, the colleagues see it. 409 "taken" when a colleague has it. */
export async function callTake(ctx: Ctx, s: StaffCtx, id: string): Promise<HallLive> {
  needFloor(s);
  return onCall(ctx, id, async (sit, c, t) => {
    if (c.done) throw new CoreError("not_found", FLOOR_MSG.sCall, 404);
    if (c.taken && c.taken.by !== s.user.username) throw new CoreError("taken", FLOOR_MSG.sTaken(c.taken.name), 409);
    if (c.taken) return hallLive(ctx, s);
    c.taken = { by: s.user.username, name: s.user.name, at: iso(ctx) };
    await audit(ctx, s.user.username, "floor.call_take", t.id, { n: t.n, kind: c.kind, waited: Math.round((Date.parse(c.taken.at) - Date.parse(c.at)) / 1000) });
    return afterCall(ctx, s, sit, c);
  });
}
/** "Обслужено" (also without "Отивам" first). A call a colleague took: only he, or the manager / owner / main admin. */
export async function callDone(ctx: Ctx, s: StaffCtx, id: string): Promise<HallLive> {
  needFloor(s);
  return onCall(ctx, id, async (sit, c, t) => {
    if (c.done) return hallLive(ctx, s);
    if (c.taken && c.taken.by !== s.user.username && !isBoss(s)) throw new CoreError("taken", FLOOR_MSG.sTaken(c.taken.name), 409);
    c.done = { how: "served", at: iso(ctx), by: s.user.username };
    await audit(ctx, s.user.username, "floor.call_done", t.id, { n: t.n, kind: c.kind });
    return afterCall(ctx, s, sit, c);
  });
}
/** "Отмени" (15 s): my "Обслужено" (the call waits again with its old time), else my "Отивам". */
export async function callUndo(ctx: Ctx, s: StaffCtx, id: string): Promise<HallLive> {
  needFloor(s);
  return onCall(ctx, id, async (sit, c, t) => {
    const nowMs = nowDate(ctx).getTime(), fresh = (at: string) => nowMs - Date.parse(at) <= FLOOR_UNDO_MS;
    if (c.done && c.done.how === "served" && c.done.by === s.user.username && fresh(c.done.at) && !sit.calls.some((x) => x !== c && x.kind === c.kind && !x.done)) c.done = null;
    else if (!c.done && c.taken && c.taken.by === s.user.username && fresh(c.taken.at)) c.taken = null;
    else throw new CoreError("undo_late", FLOOR_MSG.sUndo, 409);
    await audit(ctx, s.user.username, "floor.call_undo", t.id, { n: t.n, kind: c.kind });
    return afterCall(ctx, s, sit, c);
  });
}

/* ---------- the QR order that waits ---------- */
/** "Потвърди и прати": the waiting QR order becomes an Order (the same checks and prices as every order).
    grams: {<line key>: grams} for the steaks "за 100 гр." (100-2000; 422 fields "grams.<key>"). */
export async function qrConfirm(ctx: Ctx, s: StaffCtx, ref: string | number, grams: Record<string, number> = {}): Promise<TableDetail & { no: string }> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    if (!sit.pending) throw new CoreError("no_pending", FLOOR_MSG.sNoPending, 409);
    const pl = sit.pending.lines, g = grams && typeof grams === "object" ? grams : {};
    let o: Order;
    try {
      o = await createTableOrder(ctx, { table: t.id, tableN: t.n, session: sit.id, channel: "qr", via: "waiter", by: s.user.username, speak: "staff",
        lines: pl.map((l) => ({ id: l.id, q: l.q, mods: l.mods, guest: l.who, grams: g[l.key] == null ? null : +g[l.key] })) });
    } catch (e) {
      const f = (e as { fields?: Record<string, string> }).fields;
      if (e instanceof CoreError && f) { const nf: Record<string, string> = {}; for (const k of Object.keys(f)) { const m = /^lines\.(\d+)\.grams$/.exec(k); nf[m && pl[+m[1]] ? "grams." + pl[+m[1]].key : k] = f[k]; } (e as CoreError & { fields?: unknown }).fields = nf; }
      throw e;
    }
    /* the waiter has seen these phones now: their next orders may go straight to the kitchen (decision 18.11.2026) */
    sit.seen = [...new Set([...(sit.seen || []), ...pl.flatMap(lineTouch)])];
    sit.orders.push(o.no); sit.pending = null; sit.rejected = null;
    await audit(ctx, s.user.username, "floor.qr_confirm", o.no, { table: t.n, total: o.total, lines: o.lines.length });
    emit(ctx, "floor.qr", { table: t.id, n: t.n, session: sit.id, state: "confirmed", no: o.no });
    return { ...(await done(ctx, s, t, sit)), no: o.no };
  });
}
/** "Махни" on one line of the waiting QR order (a dish sold out since the guests sent it, or one off the menu): the line
    leaves the order (the guests see the order without it), the rest waits for "Потвърди и прати". The last line cannot go
    this way (409 "last_line": "Откажи" the order). Log: floor.qr_drop. */
export async function qrDrop(ctx: Ctx, s: StaffCtx, ref: string | number, key: string): Promise<TableDetail> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    if (!sit.pending) throw new CoreError("no_pending", FLOOR_MSG.sNoPending, 409);
    const l = sit.pending.lines.find((x) => x.key === String(key || ""));
    if (!l) throw new CoreError("not_found", FLOOR_MSG.sLine, 404);
    if (sit.pending.lines.length < 2) throw new CoreError("last_line", FLOOR_MSG.sLastLine, 409);
    sit.pending.lines = sit.pending.lines.filter((x) => x !== l);
    const x = byId[l.id];
    await audit(ctx, s.user.username, "floor.qr_drop", t.id, { n: t.n, id: l.id, q: l.q, out: !!(x && outNow(x, await soldOutToday(ctx))) });
    emit(ctx, "floor.qr", { table: t.id, n: t.n, session: sit.id, state: "pending", at: sit.pending.at, dropped: l.id });
    return done(ctx, s, t, sit);
  });
}
/** "Махни" on a line of a SENT table order that the kitchen marked "Изчерпано днес" before it started it (decision of the
    chief 18.11, round 3 of the kitchen): the waiter (or the management) decides; the line stays in the order only for
    reference (`dropped`), the kitchen no longer waits for it, the guests' view and the bill follow (it was never charged);
    when everything else is ready the order is "Готова". The last line of an order cancels the order with the reason
    "Изчерпано днес" (decision of the chief 18.11, round 4 of the kitchen: the waiter's module has no other way out; the
    card leaves the kitchen, the sum is 0 €). Everything under the order's lock, the status change too.
    Log: floor.out_drop (+ the order's own log of the status). */
export const OUT_DROP_MSG = { notOut: "Това ястие вече не чака решение. Опресни масата.", reason: "Изчерпано днес" };
export async function outDrop(ctx: Ctx, s: StaffCtx, ref: string | number, key: string): Promise<TableDetail> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    const b = billLines(await sessionOrders(ctx, sit)).find((x) => x.key === String(key || ""));
    if (!b) throw new CoreError("not_found", FLOOR_MSG.sLine, 404);
    const res = await serial(ctx.repo, "order:" + b.no, async () => {
      const o = await ctx.repo.get<Order>(COL.orders, b.no);
      if (!o) throw new CoreError("not_found", FLOOR_MSG.sLine, 404);
      const l = o.lines[b.idx];
      if (!l || !l.out || l.dropped || (l.ks || "wait") !== "wait" || !["accepted", "cooking"].includes(o.status)) throw new CoreError("not_out", OUT_DROP_MSG.notOut, 409);
      const last = o.lines.every((x, i) => i === b.idx || x.dropped);
      l.dropped = true;
      o.sub = sumOf(o.lines.filter((x) => !x.out).map((x) => ({ sum: r2((x.unit ?? 0) * x.q) }))); o.total = o.sub;
      o.updatedAt = iso(ctx);
      await ctx.repo.put(COL.orders, o);
      if (last) return { o: await setOrderStatus(ctx, o.no, "cancelled", s.user.username, undefined, OUT_DROP_MSG.reason), last };
      /* everything the kitchen makes is ready already: the order is "Готова" (the waiter sees it in "Готови") */
      const rest = o.lines.filter((x) => !x.dropped);
      if (o.status === "cooking" && rest.length && rest.every((x) => x.ks === "ready")) return { o: await setOrderStatus(ctx, o.no, "ready", s.user.username), last };
      return { o, last };
    });
    await audit(ctx, s.user.username, "floor.out_drop", t.id, { n: t.n, no: b.no, idx: b.idx, id: b.l.id, q: b.l.q, cancelled: res.last });
    emit(ctx, "order.line", { no: b.no, kind: "drop", sec: "all", idx: b.idx, lines: [b.idx], table: sit.table, session: sit.id, status: res.o.status }, { table: sit.id, order: b.no });
    return done(ctx, s, t, sit);
  });
}
/** "Откажи" with a reason from the list ("test" | "gaveup" | "manual"): the dishes go back to the guests' cart. */
export async function qrReject(ctx: Ctx, s: StaffCtx, ref: string | number, reason: RejectReason): Promise<TableDetail> {
  needFloor(s);
  if (!Object.prototype.hasOwnProperty.call(REJECT_REASONS, String(reason))) invalid({ reason: FLOOR_MSG.sReason }, FLOOR_MSG.sReason);
  return onTable(ctx, ref, false, async (sit, t) => {
    if (!sit.pending) throw new CoreError("no_pending", FLOOR_MSG.sNoPending, 409);
    const p = sit.pending;
    sit.cart = [...p.lines, ...sit.cart];
    sit.rejected = { at: iso(ctx), reason, n: p.lines.reduce((a, l) => a + l.q, 0), keys: p.lines.map((l) => l.key), by: s.user.username, pendingAt: p.at, pendingBy: p.by };
    sit.pending = null;
    await audit(ctx, s.user.username, "floor.qr_reject", t.id, { n: t.n, reason, text: REJECT_REASONS[reason].staff });
    emit(ctx, "floor.qr", { table: t.id, n: t.n, session: sit.id, state: "rejected", reason });
    return done(ctx, s, t, sit);
  });
}
/** "Отмени" after "Откажи" (15 s, the same waiter): the dishes still in the cart wait for the confirmation again */
export async function qrRejectUndo(ctx: Ctx, s: StaffCtx, ref: string | number): Promise<TableDetail> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    const r = sit.rejected, back = r ? sit.cart.filter((l) => r.keys.includes(l.key)) : [];
    if (!r || r.by !== s.user.username || nowDate(ctx).getTime() - Date.parse(r.at) > FLOOR_UNDO_MS || sit.pending || !back.length) throw new CoreError("undo_late", FLOOR_MSG.sUndo, 409);
    sit.pending = { at: r.pendingAt, by: r.pendingBy, lines: back };
    sit.cart = sit.cart.filter((l) => !r.keys.includes(l.key)); sit.rejected = null;
    await audit(ctx, s.user.username, "floor.qr_reject_undo", t.id, { n: t.n });
    emit(ctx, "floor.qr", { table: t.id, n: t.n, session: sit.id, state: "pending", at: sit.pending.at });
    return done(ctx, s, t, sit);
  });
}

/* ---------- "Нова поръчка" → "Към кухнята" ---------- */
export interface StaffOrderInput {
  /** guest: "" (one bill) or "Гост 1" … "Гост 20" (separate bills: one order per guest); grams: a `per100` steak, 100-2000 */
  lines: { id: string; q: number; mods?: string[]; note?: string; grams?: number | null; guest?: string }[];
  /** a note for the whole order */
  note?: string;
  /** the phone's id of this order (the same when it is sent again after a lost answer or from the offline outbox):
      a repeated id returns the orders made the first time, never a second order */
  rid?: string;
}
const RID = /^[A-Za-z0-9_-]{8,40}$/;
const GUEST = /^Гост ([1-9]|1\d|20)$/;
/** The waiter's order for a table (no payment, no address, no customer cart): added to the table's sitting; a free table
    gets a sitting. Everything is checked before anything is saved. Returns the numbers and the table. */
export async function staffOrder(ctx: Ctx, s: StaffCtx, ref: string | number, input: StaffOrderInput): Promise<TableDetail & { orders: string[] }> {
  needFloor(s);
  const inp = input && typeof input === "object" ? input : ({} as StaffOrderInput);
  const lines: TableLine[] = (Array.isArray(inp.lines) ? inp.lines : []).map((l) => ({ id: String(l && l.id), q: l && l.q, mods: Array.isArray(l && l.mods) ? l.mods : [], note: l && l.note, grams: l && l.grams, guest: l && l.guest ? String(l.guest).trim() : "" }));
  const f: Record<string, string> = {};
  lines.forEach((l, i) => { if (l.guest && !GUEST.test(l.guest)) f["lines." + i + ".guest"] = FLOOR_MSG.sGuest; });
  if (Object.keys(f).length) invalid(f);
  const rid = typeof inp.rid === "string" && RID.test(inp.rid) ? inp.rid : "";
  return onTable(ctx, ref, true, async (sit, t, fresh) => {
    if (rid && sit.rids && sit.rids[rid]) return { ...(await done(ctx, s, t, sit)), orders: sit.rids[rid] };
    /* the table was paid and closed meanwhile (a lost answer, then the outbox): the rid of a sitting of this table that
       closed in the same shift day gives its orders again, never a second order (the new sitting is not even saved) */
    if (rid) {
      const day = shiftDay(nowDate(ctx));
      const past = (await ctx.repo.list<TableSession>(COL.tableSessions, { table: t.id } as Partial<TableSession>))
        .find((x) => x.id !== sit.id && x.rids && x.rids[rid] && shiftDay(new Date(x.closedAt || x.openedAt)) === day);
      if (past) return { ...(await detailOf(ctx, s, t, fresh ? null : sit)), orders: past.rids![rid] };
    }
    tableKitchenOpen(ctx, "staff");
    checkTableLines(ctx, lines, await soldOutToday(ctx), "required", "staff");
    const groups = new Map<string, TableLine[]>();
    for (const l of lines) { const k = l.guest || BILL_ALL; groups.set(k, [...(groups.get(k) || []), l]); }
    const nos: string[] = [];
    let total = 0;
    for (const [bill, ls] of groups) {
      const o = await createTableOrder(ctx, { table: t.id, tableN: t.n, session: sit.id, channel: "waiter", lines: ls.map((l) => ({ ...l, guest: l.guest || undefined })), note: inp.note, bill, by: s.user.username, speak: "staff" });
      sit.orders.push(o.no); nos.push(o.no); total = r2(total + o.total);
    }
    /* the waiter is at the table taking the order: the call "Поръчка" is served */
    const now = iso(ctx), served = sit.calls.filter((c) => c.kind === "order" && !c.done);
    served.forEach((c) => { c.done = { how: "served", at: now, by: s.user.username, auto: true }; });
    if (rid) { const keep = Object.entries(sit.rids || {}).slice(-49); sit.rids = Object.fromEntries([...keep, [rid, nos]]); }
    await audit(ctx, s.user.username, "floor.order", nos.join(","), { table: t.n, orders: nos, total, bills: [...groups.keys()] });
    const d = await done(ctx, s, t, sit);
    served.forEach((c) => emitCall(ctx, sit, c));
    return { ...d, orders: nos };
  });
}

/* ---------- "Сервирах" ---------- */
const lineEvent = (ctx: Ctx, sit: TableSession, b: BillLine) => emit(ctx, "order.line", { no: b.no, idx: b.idx, table: sit.table, session: sit.id, ks: b.l.ks || null, servedAt: b.l.servedAt || null }, { table: sit.id, order: b.no });
/** "Сервирах": the lines by key ("<№>:<index>"), or every ready line of the table (no keys). Only a line that is ready
    (409 "not_ready"). All lines of an order served -> the order is "Взета" (shown "Сервирана"). */
export async function serve(ctx: Ctx, s: StaffCtx, ref: string | number, keys?: string[]): Promise<TableDetail & { served: string[] }> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    const orders = await sessionOrders(ctx, sit), lines = billLines(orders);
    const want = Array.isArray(keys) && keys.length ? [...new Set(keys.map(String))].map((k) => { const b = lines.find((x) => x.key === k); if (!b) throw new CoreError("not_found", FLOOR_MSG.sLine, 404); return b; }) : lines.filter((b) => !b.out && b.st === "ready");
    const todo = want.filter((b) => b.st !== "served" && !b.out);
    if (todo.some((b) => b.st !== "ready")) throw new CoreError("not_ready", FLOOR_MSG.sNotReady, 409);
    const now = iso(ctx), saved: Order[] = [];
    /* each order is read again and written under its own lock (the kitchen may be marking another line of it right now) */
    for (const no of new Set(todo.map((b) => b.no))) {
      const o = await patchOrder(ctx, no, (o) => { for (const b of todo) if (b.no === no && o.lines[b.idx]) { o.lines[b.idx].servedAt = now; o.lines[b.idx].servedBy = s.user.username; b.l = o.lines[b.idx]; } });
      if (o) saved.push(o);
    }
    if (todo.length) await audit(ctx, s.user.username, "floor.serve", t.id, { n: t.n, lines: todo.map((b) => b.key) });
    for (const b of todo) lineEvent(ctx, sit, b);
    /* every line served (a sold-out line does not count): the order is finished */
    for (const o of saved) if (o.status !== "picked_up" && o.status !== "cancelled" && o.lines.every((l) => l.servedAt || l.out)) await setOrderStatus(ctx, o.no, "picked_up", s.user.username);
    return { ...(await done(ctx, s, t, sit)), served: todo.map((b) => b.key) };
  });
}
/** "Отмени" after "Сервирах" (15 s): the lines are ready again; an order that became "Сервирана" goes back to where it was */
export async function unserve(ctx: Ctx, s: StaffCtx, ref: string | number, keys: string[]): Promise<TableDetail> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    const orders = await sessionOrders(ctx, sit), lines = billLines(orders), nowMs = nowDate(ctx).getTime();
    const want = [...new Set((Array.isArray(keys) ? keys : []).map(String))].map((k) => { const b = lines.find((x) => x.key === k); if (!b) throw new CoreError("not_found", FLOOR_MSG.sLine, 404); return b; });
    if (!want.length || want.some((b) => !b.l.servedAt || nowMs - Date.parse(b.l.servedAt) > FLOOR_UNDO_MS)) throw new CoreError("undo_late", FLOOR_MSG.sUndo, 409);
    /* "Отмени" after "Сервирах": the one who served it (or the main admin, owner, manager) */
    if (!isBoss(s) && want.some((b) => b.l.servedBy && b.l.servedBy !== s.user.username)) throw new CoreError("forbidden", "Само който е сервирал, може да го върне.", 403);
    const now = iso(ctx);
    for (const no of new Set(want.map((b) => b.no))) {
      let back: OrderStatus | null = null;
      await patchOrder(ctx, no, (o) => {
        for (const b of want) if (b.no === no && o.lines[b.idx]) { delete o.lines[b.idx].servedAt; b.l = o.lines[b.idx]; }
        if (o.status !== "picked_up") return;
        /* where the kitchen left it: by its line states, else by the times of the statuses */
        const times = { ...(o.times || {}) }, liveL = o.lines.filter((l) => !l.out);
        delete times.picked_up;
        o.status = liveL.length && liveL.every((l) => l.ks === "ready") ? "ready" : liveL.some((l) => l.ks === "cook" || l.ks === "ready") ? "cooking"
          : (["ready", "cooking", "accepted"] as OrderStatus[]).find((x) => times[x]) || "accepted";
        o.times = times; back = o.status;
      });
      if (back) {
        emit(ctx, "order.status", { no, status: back, at: now }, { order: no, table: sit.id });
        await audit(ctx, s.user.username, "order.status", no, { status: back, undo: true });
      }
    }
    await audit(ctx, s.user.username, "floor.unserve", t.id, { n: t.n, lines: want.map((b) => b.key) });
    for (const b of want) lineEvent(ctx, sit, b);
    return done(ctx, s, t, sit);
  });
}
/** "Готови": the ready lines nobody served, by table: my tables first, then the oldest first */
export async function ready(ctx: Ctx, s: StaffCtx): Promise<ReadyGroup[]> {
  needFloor(s);
  const hall = (await liveHall(ctx)).tables, owners = await tableOwners(ctx), out: ReadyGroup[] = [];
  for (const L of await liveSessions(ctx)) {
    const t = hall.find((x) => x.id === L.s.table), rd = L.lines.filter((b) => !b.out && b.st === "ready").sort((a, b) => (readyAtOf(a) < readyAtOf(b) ? -1 : 1));
    if (!t || !rd.length) continue;
    const o = owners.get(t.id);
    out.push({ table: tref(t), mine: !!o && o.user === s.user.id, owner: o ? { username: o.username, name: o.name } : null, since: readyAtOf(rd[0]),
      lines: rd.map((b) => ({ key: b.key, no: b.no, idx: b.idx, name: b.l.name || b.l.id, q: b.l.q, mods: b.l.mods || [], note: b.l.note || "", grams: b.l.grams || null, bill: b.o.bill && b.o.bill !== BILL_ALL ? b.o.bill : "", cat: b.l.cat || "", readyAt: readyAtOf(b) })) });
  }
  return out.sort((a, b) => Number(b.mine) - Number(a.mine) || (a.since < b.since ? -1 : 1));
}

/* ---------- the bill ---------- */
/** "Маркирай платено · X €": how "cash" | "card"; what: `keys` (by dish), `bill` ("Гост 1": by guest) or nothing (one bill:
    everything that is left). The sum comes from the lines; a paid line is never paid again (409 "paid"). */
export async function pay(ctx: Ctx, s: StaffCtx, ref: string | number, p: { how: "cash" | "card"; keys?: string[]; bill?: string }): Promise<TableDetail & { payment: FloorPayment }> {
  needFloor(s);
  const q = p && typeof p === "object" ? p : ({} as { how: "cash" | "card"; keys?: string[]; bill?: string });
  if (q.how !== "cash" && q.how !== "card") invalid({ how: FLOOR_MSG.sPayHow }, FLOOR_MSG.sPayHow);
  return onTable(ctx, ref, false, async (sit, t) => {
    const orders = await sessionOrders(ctx, sit), lines = billLines(orders).filter((b) => !b.out);
    let target: BillLine[], label: string;
    if (Array.isArray(q.keys) && q.keys.length) {
      target = [...new Set(q.keys.map(String))].map((k) => { const b = lines.find((x) => x.key === k); if (!b) throw new CoreError("not_found", FLOOR_MSG.sLine, 404); return b; });
      if (target.some((b) => b.paid)) throw new CoreError("paid", FLOOR_MSG.sPaid, 409);
      label = "По ястия";
    } else if (q.bill) { target = lines.filter((b) => (b.o.bill || BILL_ALL) === String(q.bill) && !b.paid); label = String(q.bill).slice(0, 24); }
    else { target = lines.filter((b) => !b.paid); label = "Една сметка"; }
    if (!target.length) invalid({ keys: FLOOR_MSG.sPayNothing }, FLOOR_MSG.sPayNothing);
    const now = iso(ctx), pm: FloorPayment = { id: rid(6), at: now, by: s.user.username, how: q.how, sum: sumOf(target), keys: target.map((b) => b.key), label };
    for (const no of new Set(target.map((x) => x.no))) await patchOrder(ctx, no, (o) => {
      for (const x of target) if (x.no === no && o.lines[x.idx]) o.lines[x.idx].paid = pm.id;
      /* the order's own sum follows what the table really pays: a line sold out after the order is not charged */
      if (o.lines.some((l) => l.out)) { o.sub = sumOf(o.lines.filter((l) => !l.out).map((l) => ({ sum: r2((l.unit ?? 0) * l.q) }))); o.total = o.sub; }
    });
    sit.payments.push(pm);
    /* the waiter brought the bill: the call "Сметка" is served once everything the phones asked for is paid */
    const asked = Object.keys(sit.bills).flatMap((k) => sit.bills[k].keys), paidKeys = new Set(sit.payments.flatMap((x) => x.keys));
    const served = asked.every((k) => paidKeys.has(k)) ? sit.calls.filter((c) => c.kind === "bill" && !c.done) : [];
    served.forEach((c) => { c.done = { how: "served", at: now, by: s.user.username, auto: true }; });
    await audit(ctx, s.user.username, "floor.pay", t.id, { n: t.n, sum: pm.sum, how: pm.how, lines: pm.keys.length, label });
    const d = await done(ctx, s, t, sit);
    served.forEach((c) => emitCall(ctx, sit, c));
    return { ...d, payment: pm };
  });
}
/** "Затвори масата": only when everything is paid and no QR order waits. Unserved dishes: 409 "unserved" with their list
    (`lines`), then `force: true` ("Затвори въпреки това"). The sitting ends, the table is free, the next scan opens a new one. */
export async function closeTable(ctx: Ctx, s: StaffCtx, ref: string | number, force = false): Promise<TableDetail> {
  needFloor(s);
  return onTable(ctx, ref, false, async (sit, t) => {
    if (sit.pending) throw new CoreError("pending", FLOOR_MSG.sPendingOpen, 409);
    const orders = await sessionOrders(ctx, sit), lines = billLines(orders), rest = r2(sumOf(lines) - sumOf(lines.filter((b) => b.paid)));
    if (rest >= 0.005) throw new CoreError("unpaid", FLOOR_MSG.sUnpaid, 409);
    const un = lines.filter((b) => !b.out && b.st !== "served");
    if (un.length && force !== true) throw Object.assign(new CoreError("unserved", FLOOR_MSG.sUnserved, 409), { lines: un.map((b) => b.l.q + "× " + (b.l.name || b.l.id) + (b.l.grams ? " · " + b.l.grams + " гр." : "")) });
    const now = iso(ctx);
    sit.status = "closed"; sit.closedAt = now; sit.closedBy = s.user.username;
    sit.calls.forEach((c) => { if (!c.done) c.done = { how: "closed", at: now, by: s.user.username }; });
    /* the paid orders that were not served to the end leave the kitchen's screen too */
    for (const o of orders) if (o.status !== "picked_up" && o.status !== "cancelled") await setOrderStatus(ctx, o.no, "picked_up", s.user.username);
    await audit(ctx, s.user.username, "floor.close", t.id, { n: t.n, total: sumOf(lines), orders: sit.orders, unserved: un.length, forced: un.length > 0 });
    return done(ctx, s, t, sit);
  });
}

/* ---------- the search of the waiter (GET /api/staff/search) ---------- */
export interface StaffSearch {
  tables: { id: string; n: number; zone: "salon" | "garden"; state: TableStateKey; label: string; mine: boolean }[];
  /** orders at the tables now: by number, or by a dish in them */
  orders: { no: string; table: TRef; placedAt: string; status: OrderStatus; statusLabel: string; bill: string; total: number; lines: { name: string; q: number; st: LineSt }[]; mine: boolean }[];
  /** today's reservations (the phone masked); null without the section "Резервации" */
  reservations: { id: string; time: string; people: number; tableN: number | null; name: string; phone: string; note: string; status: string }[] | null;
  /** "Изчерпано днес" (asked with the word, e.g. "изчерпано") */
  soldOut: { id: string; name: string }[];
}
const lat = (x: string) => latin(String(x || "")).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim();
const SW: Record<TableStateKey, string[]> = { call: ["вика", "повикване", "повиквания"], bill: ["сметка", "сметки"], qr: ["qr", "кюар"], ready: ["готово", "готови"], wait: ["чака", "чакат"], busy: ["заета", "заети"], free: ["свободна", "свободни", "свободно"] };
const STOP = ["маса", "маси", "masa", "masi", "table", "tables", "на", "за", "с", "и"].map(lat);
const stem = (w: string) => (w.length > 5 ? w.slice(0, w.length - 1) : w);
const wordHit = (q: string, list: string[]) => list.some((w) => { const l = lat(w); return q.length >= 3 && (l.indexOf(q) === 0 || q.indexOf(stem(l)) === 0); });
/** One field, the waiter's own things only (the dishes are searched in the browser, lib/search.ts): tables (a number,
    "свободни", "сметка", "градина", "моите"), orders at the tables ("2187" or a dish), today's reservations ("19:30",
    the whole phone number only, a name), "изчерпано". */
export async function staffSearch(ctx: Ctx, s: StaffCtx, raw: string): Promise<StaffSearch> {
  needFloor(s);
  const text = String(raw || "").slice(0, 80), q = lat(text), words = q.split(" ").filter((w) => w && !STOP.includes(w));
  const out: StaffSearch = { tables: [], orders: [], reservations: may(s, "reservations") ? [] : null, soldOut: [] };
  if (!q) return out;
  const nums = text.match(/\d+/g) || [], time = /\b(\d{1,2}):(\d{2})\b/.exec(text), txt = words.filter((w) => !/^\d/.test(w));
  const kOut = txt.some((w) => wordHit(w, ["изчерпано", "изчерпани", "изчерпан"]) || w === "out");
  const kRes = txt.some((w) => wordHit(w, ["резервация", "резервации", "резерв"]));
  const kMine = txt.some((w) => wordHit(w, ["моите", "мои", "моя"]));
  const zone = txt.some((w) => wordHit(w, ["салон"])) ? "salon" : txt.some((w) => wordHit(w, ["градина"])) ? "garden" : null;
  const states = (Object.keys(SW) as TableStateKey[]).filter((k) => txt.some((w) => wordHit(w, SW[k])));
  const hall = (await liveHall(ctx)).tables.filter((t) => !t.off).sort((a, b) => a.n - b.n), owners = await tableOwners(ctx), live = await liveSessions(ctx);
  const mineT = (id: string) => { const o = owners.get(id); return !!o && o.user === s.user.id; };
  /* tables */
  const tn = nums.filter((n) => n.length <= 2 && !time);
  if (tn.length || states.length || zone || kMine) for (const t of hall) {
    const L = live.find((x) => x.s.table === t.id), sv = stateOf(L ? L.s : null, L ? L.lines : []);
    let ok = tn.length ? tn.some((n) => String(t.n) === n || (n.length === 1 && String(t.n).indexOf(n) === 0)) : true;
    if (states.length && !states.includes(sv.state)) ok = false;
    if (zone && t.zone !== zone) ok = false;
    if (kMine && !mineT(t.id)) ok = false;
    if (ok) out.tables.push({ id: t.id, n: t.n, zone: t.zone, state: sv.state, label: sv.label, mine: mineT(t.id) });
  }
  out.tables.sort((a, b) => Number(b.mine) - Number(a.mine) || a.n - b.n);
  /* orders at the tables: the number, or a dish found by its name */
  const known = [...Object.keys(SW).flatMap((k) => SW[k as TableStateKey]), "изчерпано", "изчерпани", "резервация", "резервации", "моите", "салон", "градина"];
  const dishWords = txt.filter((w) => !wordHit(w, known)), dq = text.replace(/\d+(:\d+)?/g, " ").trim();
  const ids = dishWords.length && dq ? new Set(searchDishes(items.map((x) => ({ id: x.id, n: x.n, comp: x.comp, al: x.al, t: x.t })), dq).name.map((d) => d.id)) : new Set<string>();
  for (const L of live) {
    const t = hall.find((x) => x.id === L.s.table);
    if (!t) continue;
    for (const o of L.orders) {
      if (o.status === "cancelled") continue;
      if (!(nums.some((n) => n.length >= 3 && o.no.indexOf(n) > -1) || (ids.size && o.lines.some((l) => ids.has(l.id))))) continue;
      out.orders.push({ no: o.no, table: tref(t), placedAt: o.placedAt, status: o.status, statusLabel: tableLabel(o), bill: o.bill || BILL_ALL, total: o.total, mine: mineT(t.id),
        lines: L.lines.filter((b) => b.no === o.no).map((b) => ({ name: b.l.name || b.l.id, q: b.l.q, st: b.st })) });
    }
  }
  out.orders.sort((a, b) => Number(b.mine) - Number(a.mine) || +b.no - +a.no);
  /* today's reservations: the hour, the table, a name. Never by the phone (decision 18.11.2026, round 2): the list shows it
     masked, and even the whole number can be found by trying (about 1 200 requests), without a line in the log */
  if (out.reservations) {
    const today = sofiaYmd(nowDate(ctx)), tnOf = new Map(hall.map((t) => [t.id, t.n]));
    const hm = time ? time[1].padStart(2, "0") + ":" + time[2] : "";
    const list = (await ctx.repo.list<Reservation>(COL.reservations, { date: today } as Partial<Reservation>)).filter((r) => r.status !== "cancelled");
    for (const r of list.sort((a, b) => (a.time < b.time ? -1 : 1))) {
      const n = r.table ? tnOf.get(r.table) ?? null : null;
      let hit = kRes;
      if (!hit && time) hit = r.time === hm;
      if (!hit && !time) hit = nums.some((x) => x.length < 3 && (String(n) === x || r.time.indexOf(x.padStart(2, "0") + ":") === 0));
      if (!hit && txt.length) hit = txt.every((w) => lat(r.name).split(" ").some((p) => p.indexOf(w) === 0));
      if (hit) out.reservations.push({ id: r.id, time: r.time, people: r.people, tableN: n, name: r.name, phone: maskPhone(r.phone), note: r.note || "", status: r.status });
    }
  }
  if (kOut) { const today = await soldOutToday(ctx); out.soldOut = items.filter((x) => outNow(x, today)).map((x) => ({ id: x.id, name: x.n })); }
  return out;
}

/* ---------- the ratings from the tables (the text is for the manager) ---------- */
export interface TableRating { at: Iso; tableN: number | null; phone: number | null; happy: boolean; text: string; orderNo: string }
/** the ratings the guests gave at the tables, the newest first: the main admin, the owner, the manager */
export async function tableRatings(ctx: Ctx, s: StaffCtx, limit = 100): Promise<TableRating[]> {
  needFloor(s);
  if (!isBoss(s)) throw new CoreError("forbidden", RIGHTS_MSG.boss, 403);
  const all = (await ctx.repo.list<Rating>(COL.ratings)).filter((r) => !!r.session).sort((a, b) => ((a.updatedAt || a.createdAt) < (b.updatedAt || b.createdAt) ? 1 : -1)).slice(0, Math.min(500, Math.max(1, limit)));
  const out: TableRating[] = [];
  for (const r of all) { const sit = await ctx.repo.get<TableSession>(COL.tableSessions, r.session!); out.push({ at: r.updatedAt || r.createdAt, tableN: sit ? sit.n : null, phone: phoneOf(r.guest), happy: r.happy, text: r.text || "", orderNo: r.orderNo }); }
  return out;
}
