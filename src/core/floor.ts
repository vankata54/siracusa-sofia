/* The hall, live (stage D): the sitting at a table ("session"), shared by the QR table of the guests and the waiter.
   This file is the base: the document, the rules that both sides read (line status, the bill, the calls) and the views.
   The guests' functions are in floor-guest.ts, the waiter's in floor-staff.ts, the shift in floor-shift.ts.

   THE SITTING (COL.tableSessions, one open per table):
   - opened by the first scan of the table's permanent QR code (hall.ts tableByQr) or by the waiter's first action on the
     table; closed with the bill ("Затвори масата"); a sitting never continues on the next day: an open one from an
     earlier day (Sofia) with nothing unpaid and nothing waiting is closed by the next scan or the next look at the hall;
   - the phones: a random token per browser (never a name), numbered "Телефон 1…7" in the order they came;
   - the shared cart: everybody at the table may change any line (OPEN-QUESTIONS, modules 5);
   - the FIRST QR order waits for the waiter ("Потвърди и прати" / "Откажи" with a reason from the list); a rejection puts
     the dishes back in the cart and the next send waits again. An order with a `per100` steak always waits: the waiter
     enters the grams when he confirms (OPEN-QUESTIONS, modules 7). The next QR orders go straight to the kitchen;
   - the orders are real Orders (orders.ts createTableOrder): the kitchen core sets `sec`, `ks`, `readyAt` on the lines,
     "Сервирах" sets `servedAt`; all lines served -> "Взета" (shown "Сервирана");
   - calls: one active per kind until "Обслужено" or the guest's cancel; the same kind is locked settings.callCooldown
     minutes AFTER "Обслужено"; after settings.callManager minutes without "Отивам" it is flagged for the manager;
   - the bill: a line of an order is `<№>:<index>`; a phone asks for "one" (what is left), "guests" (its own dishes) or
     "dishes" (its picks); what another phone asked for is never asked twice; a payment keeps its lines, nothing is paid
     twice and a payment is never more than the rest (the sum always comes from the lines);
   - the rating: one per phone, the -10% code "SC10-…" from the codes of the core; the text is for the manager only.

   RIGHTS: the guests by the table code + their token (floor-guest.ts); the staff: the section "Сервитьор", and the main
   admin, the owner and the manager always (needFloor). Every staff action writes a line in the log.
   REAL TIME: floor.session to the guests of the sitting (what any guest may see) and to the staff; floor.call, floor.qr,
   order.new, order.line, shift.update to the staff. */
import { COL, emit, iso, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, type Iso, type Order, type OrderLine, type OrderStatus, type Settings } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { may, isBoss, serial, RIGHTS_MSG } from "./rights.ts";
import { liveHall } from "./hall.ts";
import type { HallTable } from "./site-data.ts";
import { getSettings } from "./settings.ts";
import { soldOutToday, outNow, type SoldOutToday } from "./menu.ts";
import { tableBlock, LUNCH_TABLE_MISSING } from "./orders.ts";
import { RATING_DISCOUNT } from "./codes.ts";
import { byId, removedById, RESTAURANT } from "../lib/data.ts";
import { parseMods } from "../lib/pricing.ts";
import { state } from "../lib/status.ts";
import { sofiaYmd } from "../lib/time.ts";

/* ---------- words (one place: the server and the demo say the same) ---------- */
export type CallKind = "order" | "bill" | "water" | "other";
export const CALL_KINDS: CallKind[] = ["order", "bill", "water", "other"];
/** the guests' tiles / the waiter's short words */
export const CALL_LABEL: Record<CallKind, string> = { order: "Поръчка", bill: "Сметка", water: "Вода или прибори", other: "Друго" };
export const CALL_STAFF: Record<CallKind, string> = { order: "Поръчка", bill: "Сметка", water: "Вода / прибори", other: "Друго" };
export type RejectReason = "test" | "gaveup" | "manual";
/** the waiter's list (design/pages-servitor/table.html) and what the guests read (design/pages-masa/_masa.js) */
export const REJECT_REASONS: Record<RejectReason, { staff: string; guest: string }> = {
  test: { staff: "Тестова или по грешка", guest: "Изглежда, че е изпратена по грешка или за проба." },
  gaveup: { staff: "Гостите се отказаха", guest: "Сервитьорът отбеляза, че сте се отказали от нея." },
  manual: { staff: "Ще я въведа аз", guest: "Сервитьорът ще я приеме лично, на масата." },
};
export const ZONE_NAME: Record<"salon" | "garden", string> = { salon: "Салон", garden: "Градина" };
export const BILL_ALL = "Обща сметка";
export const MAX_PHONES = 7, CALL_NOTE_MAX = 200, RATING_TEXT_MAX = 2000;
/** the colour of a waiting call changes after 2 minutes (OPEN-QUESTIONS, modules 1); the manager's minutes are a setting */
export const CALL_WARN_MIN = 2;
/** "Отмени" after "Обслужено", "Отивам", "Сервирах", "Откажи": the screens show it 5 seconds, the core allows 15 */
export const FLOOR_UNDO_MS = 15_000;
export const FLOOR_MSG = {
  table: "Няма такава маса.",
  noSession: "Сканирайте кода на масата отново.",
  closed: "Масата е затворена. Ако останете още, сканирайте кода на масата отново.",
  full: "На масата вече има " + MAX_PHONES + " телефона. Поръчайте от някой от тях или повикайте сервитьор.",
  line: "Това ястие вече не е в количката.",
  pendingEmpty: "Количката е празна.",
  callKind: "Изберете за какво викате сервитьора.",
  callActive: "Вече повикахме. Сервитьорът вижда масата ви и колко чакате.",
  callCool: "Сервитьорът току-що беше при вас. Същото повикване може пак след малко.",
  callNone: "Няма такова повикване.",
  nothingOrdered: "Още нищо не е поръчано.",
  billAll: "Всичко вече е поискано.",
  billMine: "От този телефон няма поръчани ястия.",
  billPick: "Отметнете какво плащате.",
  billPay: "Изберете „В брой“ или „С карта“.",
  billSplit: "Изберете „Една сметка“, „По гости“ или „По ястия“.",
  billAsked: "Вече поискахте сметката. За промяна кажете на сервитьора, когато дойде.",
  picked: (who: string) => who + " плаща това ястие.",
  pickGone: "Това ястие вече е платено или поискано.",
  rateEarly: "Оценката е след сметката.",
  rateAnswer: "Изберете „Да“ или „Не“.",
  /* the staff ("ти") */
  sFree: "Масата е свободна.",
  sNoPending: "Няма QR поръчка за потвърждение. Обнови екрана.",
  sReason: "Избери причина за отказа.",
  sUndo: "Вече не може да се отмени.",
  sCall: "Това повикване вече го няма. Обнови екрана.",
  sTaken: (who: string) => "Повикването вече е поето от " + who + ".",
  sLine: "Няма такъв ред в поръчката. Обнови екрана.",
  sNotReady: "Ястието още не е готово в кухнята.",
  sPayNothing: "Избери какво се плаща.",
  sPaid: "Част от избраното вече е платено. Обнови екрана.",
  sPayHow: "Избери „В брой“ или „Карта“.",
  sUnpaid: "Масата се затваря след като сметката е платена.",
  sPendingOpen: "Има QR поръчка за потвърждение. Първо я потвърди или откажи.",
  sUnserved: "Има несервирани ястия. Избери „Затвори въпреки това“.",
  sGuest: "Сметките са „Гост 1“, „Гост 2“ …",
};

/* ---------- the document ---------- */
export interface FloorGuest { /** "p1" … "p7" */ id: string; n: number; tok: string; at: Iso }
export interface FloorCartLine { key: string; id: string; q: number; mods: string[]; /** the phone that added it ("p2") */ who: string; at: Iso }
export interface FloorCall {
  id: string; kind: CallKind; note: string; at: Iso; /** the phone ("p2"), or null: asked through the bill */ by: string | null;
  /** how many more requests joined this call (a second phone asking for the bill) */
  joined?: number;
  taken?: { by: string; name: string; at: Iso } | null;
  /** auto: served by another action of the waiter (his order for the table, the payment), not by "Обслужено": such a
      call is not counted in the answer times */
  done?: { how: "served" | "cancel" | "closed"; at: Iso; by: string; auto?: boolean } | null;
}
export interface FloorBillReq { at: Iso; pay: "cash" | "card"; split: "one" | "guests" | "dishes"; keys: string[] }
export interface FloorPayment { id: string; at: Iso; by: string; how: "cash" | "card"; sum: number; keys: string[]; label: string }
export interface FloorRating { ratingId: string; happy: boolean; sent: boolean; code: string; at: Iso }
export interface TableSession {
  id: string; /** the hall's table id ("S12") and its number when the sitting opened */ table: string; n: number;
  status: "open" | "closed"; rev: number; by: "qr" | "waiter";
  openedAt: Iso; closedAt?: Iso; closedBy?: string;
  guests: FloorGuest[]; cart: FloorCartLine[];
  /** the QR order that waits for the waiter (not an Order yet) */
  pending: { at: Iso; by: string; lines: FloorCartLine[] } | null;
  /** the last rejection, until "Разбрах" or the next send; keys: the cart lines it gave back (for the waiter's "Отмени") */
  rejected: { at: Iso; reason: RejectReason; n: number; keys: string[]; by: string; pendingAt: Iso; pendingBy: string } | null;
  /** the numbers of the sitting's orders */
  orders: string[];
  /** the waiter's order ids already made at this table (core/floor-staff.ts staffOrder: no double order after a resend) */
  rids?: Record<string, string[]>;
  calls: FloorCall[];
  bills: Record<string, FloorBillReq>;
  /** "По ястия": line key -> the phone that pays it */
  picks: Record<string, string>;
  payments: FloorPayment[];
  ratings: Record<string, FloorRating>;
  createdAt: Iso; updatedAt: Iso;
}

/* ---------- rights ---------- */
/** the waiter's section; the main admin, the owner and the manager may do everything a waiter may */
export function mayFloor(s: StaffCtx | null | undefined): boolean { return !!s && !!s.user && (may(s, "waiter") || isBoss(s)); }
export function needFloor(s: StaffCtx | null | undefined): StaffCtx {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (!mayFloor(s)) throw new CoreError("forbidden", RIGHTS_MSG.forbidden, 403);
  return s;
}

/* ---------- storage ---------- */
export const lockKey = (tableId: string) => "floor:" + tableId;
const newest = (l: TableSession[]) => l.sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0] || null;
export async function openSessionOf(ctx: Ctx, tableId: string): Promise<TableSession | null> {
  return newest(await ctx.repo.list<TableSession>(COL.tableSessions, { table: tableId, status: "open" } as Partial<TableSession>));
}
export async function lastSessionOf(ctx: Ctx, tableId: string): Promise<TableSession | null> {
  return newest(await ctx.repo.list<TableSession>(COL.tableSessions, { table: tableId } as Partial<TableSession>));
}
export async function openSessions(ctx: Ctx): Promise<TableSession[]> {
  return ctx.repo.list<TableSession>(COL.tableSessions, { status: "open" } as Partial<TableSession>);
}
export async function saveSession(ctx: Ctx, s: TableSession): Promise<TableSession> {
  s.rev = (s.rev || 0) + 1; s.updatedAt = iso(ctx);
  await ctx.repo.put(COL.tableSessions, s);
  return s;
}
export function newSession(ctx: Ctx, t: { id: string; n: number }, by: "qr" | "waiter", id: string): TableSession {
  const now = iso(ctx);
  return { id, table: t.id, n: t.n, status: "open", rev: 0, by, openedAt: now, guests: [], cart: [], pending: null, rejected: null, orders: [], calls: [], bills: {}, picks: {}, payments: [], ratings: {}, createdAt: now, updatedAt: now };
}
export async function sessionOrders(ctx: Ctx, s: Pick<TableSession, "orders">): Promise<Order[]> {
  const out: Order[] = [];
  for (const no of s.orders) { const o = await ctx.repo.get<Order>(COL.orders, no); if (o) out.push(o); }
  return out;
}
/** a table in use, by its id ("S12") or by its number ("12") */
export async function tableOf(ctx: Ctx, ref: string | number): Promise<HallTable> {
  const r = String(ref == null ? "" : ref).trim(), h = await liveHall(ctx);
  const t = h.tables.find((x) => !x.off && x.id === r) || (/^\d{1,3}$/.test(r) ? h.tables.find((x) => !x.off && x.n === +r) : undefined);
  if (!t) throw new CoreError("not_found", FLOOR_MSG.table, 404);
  return t;
}

/* ---------- the lines of the orders ---------- */
export type LineSt = "accepted" | "cooking" | "ready" | "served";
export const LINE_LABEL: Record<LineSt, string> = { accepted: "Прието", cooking: "Готви се", ready: "Готово за сервиране", served: "Сервирано" };
/** the state of one line: "Сервирах", else the kitchen's line state, else the status of the order */
export function lineSt(o: Pick<Order, "status">, l: Pick<OrderLine, "ks" | "servedAt">): LineSt {
  if (l.servedAt || o.status === "picked_up") return "served";
  /* the whole order is "Готова" (also "Готово" with a hold in the kitchen): every line is ready to serve */
  if (l.ks === "ready" || o.status === "ready") return "ready";
  if (l.ks === "cook") return "cooking";
  if (l.ks === "wait") return "accepted";
  return o.status === "cooking" ? "cooking" : "accepted";
}
/** One write to an existing order: read again and changed under the order's own lock ("order:<№>", the same lock the
    kitchen core takes), so "Сервирах" / "Маркирай платено" and a kitchen tick never overwrite each other. fn changes the
    order in place (false: nothing to save). Never call setOrderStatus inside: it may take the same lock. */
export async function patchOrder(ctx: Ctx, no: string, fn: (o: Order) => void | false): Promise<Order | null> {
  return serial(ctx.repo, "order:" + no, async () => {
    const o = await ctx.repo.get<Order>(COL.orders, no);
    if (!o) return null;
    if (fn(o) === false) return o;
    o.updatedAt = iso(ctx);
    await ctx.repo.put(COL.orders, o);
    return o;
  });
}
export const lineKey = (no: string, idx: number) => no + ":" + idx;
export const r2 = (v: number): number => Math.round(v * 100) / 100;
export interface BillLine {
  key: string; no: string; idx: number; o: Order; l: OrderLine; st: LineSt;
  /** 0 for a line the kitchen marked "Изчерпано" after the order (it is not charged and not served) */
  sum: number; out: boolean; paid: boolean;
}
/** every line of the sitting's orders that counts (cancelled orders do not) */
export function billLines(orders: Order[]): BillLine[] {
  const out: BillLine[] = [];
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    o.lines.forEach((l, idx) => out.push({ key: lineKey(o.no, idx), no: o.no, idx, o, l, st: lineSt(o, l), out: !!l.out, sum: l.out ? 0 : r2((l.unit ?? 0) * l.q), paid: !!l.paid }));
  }
  return out;
}
export const sumOf = (l: { sum: number }[]): number => r2(l.reduce((a, x) => a + x.sum, 0));
/** the phone of a QR line ("p3" -> 3), or null (a waiter's line) */
export const phoneOf = (guest?: string | null): number | null => { const m = /^p([1-7])$/.exec(String(guest || "")); return m ? +m[1] : null; };
export const phoneLabel = (n: number) => "Телефон " + n;

/* ---------- calls ---------- */
export interface CallState { state: "free" | "active" | "cool"; call: FloorCall | null; /** "cool": when the same call is possible again (epoch ms) */ until: number | null }
export function callState(s: TableSession, kind: CallKind, nowMs: number, cooldownMin: number): CallState {
  const active = s.calls.find((c) => c.kind === kind && !c.done);
  if (active) return { state: "active", call: active, until: null };
  const served = s.calls.filter((c) => c.kind === kind && c.done && c.done.how === "served").sort((a, b) => (a.done!.at < b.done!.at ? 1 : -1))[0];
  if (served) { const until = Date.parse(served.done!.at) + cooldownMin * 60_000; if (until > nowMs) return { state: "cool", call: served, until }; }
  return { state: "free", call: null, until: null };
}
/** nobody said "Отивам" for settings.callManager minutes */
export const callLate = (c: FloorCall, nowMs: number, managerMin: number): boolean => !c.done && !c.taken && nowMs - Date.parse(c.at) >= managerMin * 60_000;

/* ---------- what the guests see ---------- */
export interface GuestCartLine {
  key: string; id: string; name: string; q: number; mods: string[]; per100: boolean;
  /** the unit price and the sum; null for a `per100` steak (the waiter enters the grams) */
  unit: number | null; sum: number | null; phone: number; mine: boolean; at: Iso;
  /** why it cannot be sent now: "sold_out" | "removed" | "lunch" | "breakfast" | "" */
  block: "" | "sold_out" | "removed" | "lunch" | "breakfast";
}
export interface GuestOrderLine {
  /** "<№>:<index>": the key for "По ястия" */
  key: string; id: string; name: string; q: number; mods: string[]; grams: number | null; unit: number; sum: number;
  /** the phone that ordered it, or null (the waiter took it); who: "Телефон 2" / "Гост 1" / "Сервитьор" */
  phone: number | null; mine: boolean; who: string;
  /** "Прието" / "Готви се" / "Сервирано" */
  st: "accepted" | "cooking" | "served"; stLabel: string;
  /** sold out after the order: not cooked, not charged */
  out: boolean; paid: boolean;
}
export interface GuestOrder { no: string; placedAt: string; ts: number; channel: "qr" | "waiter"; /** went through the waiter's confirmation */ via: boolean; status: OrderStatus; lines: GuestOrderLine[]; sum: number }
export interface GuestCall { kind: CallKind; label: string; note: string; at: Iso; /** a waiter said "Отивам" */ taken: boolean; /** waited over the manager's minutes */ manager: boolean }
export interface GuestBillOption { keys: string[]; sum: number }
export interface GuestView {
  /** the id of the sitting and its revision (grows with every change) */
  session: string; rev: number; status: "open" | "closed"; openedAt: Iso; closedAt: Iso | null; now: Iso;
  table: { n: number; zone: "salon" | "garden"; zoneName: string };
  /** this phone; null in the real-time payload (floor.session), which is the same for every phone */
  me: { phone: number; label: string } | null;
  phones: { phone: number; mine: boolean }[];
  /** the kitchen takes orders now (10:00-22:30); before: it has not opened yet; breakfast: until 11:30 */
  kitchen: { open: boolean; before: boolean; breakfast: boolean };
  /** the sitting is open and the kitchen takes orders */
  canOrder: boolean;
  /** the lunch menu from the table: not decided ([ЛИПСВА], OPEN-QUESTIONS modules 6); lunch dishes are refused */
  lunch: string;
  settings: { callCooldown: number; callManager: number };
  cart: { lines: GuestCartLine[]; n: number; sum: number; /** a steak without a price yet */ open: boolean;
    /** the next send waits for the waiter ("Изпрати към сервитьора"), else it goes to the kitchen */ toWaiter: boolean };
  pending: { at: Iso; phone: number; lines: GuestCartLine[]; n: number; sum: number; open: boolean } | null;
  rejected: { at: Iso; reason: RejectReason; text: string; n: number } | null;
  orders: GuestOrder[];
  total: number; paid: number; rest: number;
  calls: { active: GuestCall[]; state: Record<CallKind, { state: "free" | "active" | "cool"; at: Iso | null; until: Iso | null }> };
  bill: {
    /** this phone's request (with its sum); the others without sums */
    mine: { at: Iso; pay: "cash" | "card"; split: "one" | "guests" | "dishes"; keys: string[]; sum: number } | null;
    others: { phone: number; at: Iso; pay: "cash" | "card"; split: "one" | "guests" | "dishes" }[];
    /** "По ястия": line key -> phone */
    picks: Record<string, number>;
    /** the lines nobody has asked for and nobody has paid */
    free: string[];
    /** what this phone would ask for now with each way (null in the real-time payload) */
    want: Record<"one" | "guests" | "dishes", GuestBillOption> | null;
  };
  rating: { happy: boolean; sent: boolean; code: string; pct: number; at: Iso } | null;
  canRate: boolean;
  /** the link for a Google review, shown for both answers, never for a discount; null: [ЛИПСВА: линк] */
  google: string | null;
}

function cartLineView(ctx: Ctx, l: FloorCartLine, me: string | null, today: SoldOutToday): GuestCartLine {
  const x = Object.prototype.hasOwnProperty.call(byId, l.id) ? byId[l.id] : undefined, gone = !x && Object.prototype.hasOwnProperty.call(removedById, l.id) ? removedById[l.id] : undefined;
  const d = x || gone, per100 = !!(d && d.per100);
  const unit = !d || per100 ? null : r2(d.p + parseMods(d, l.mods).extra);
  const tb = x ? tableBlock(ctx, x.id) : "";
  return { key: l.key, id: l.id, name: d ? d.n : l.id, q: l.q, mods: l.mods, per100, unit, sum: unit == null ? null : r2(unit * l.q), phone: phoneOf(l.who) || 0, mine: l.who === me, at: l.at,
    block: !x ? "removed" : outNow(x, today) ? "sold_out" : tb };
}
const cartTotals = (lines: GuestCartLine[]) => ({ n: lines.reduce((a, l) => a + l.q, 0), sum: r2(lines.reduce((a, l) => a + (l.sum || 0), 0)), open: lines.some((l) => l.sum == null) });

/** the bill request of a phone would cover these lines now */
export function billWant(s: TableSession, lines: BillLine[], gid: string, split: "one" | "guests" | "dishes"): BillLine[] {
  const covered = new Set<string>();
  for (const k of Object.keys(s.bills)) if (k !== gid) s.bills[k].keys.forEach((x) => covered.add(x));
  const open = lines.filter((b) => !b.out && !b.paid && !covered.has(b.key));
  return split === "one" ? open : split === "guests" ? open.filter((b) => b.l.guest === gid) : open.filter((b) => s.picks[b.key] === gid);
}
/** does the next QR send wait for the waiter: no confirmed QR order yet in this sitting, or a steak without its weight */
export function sendToWaiter(s: TableSession, orders: Order[], lines: { id: string }[]): boolean {
  return !orders.some((o) => o.channel === "qr" && o.status !== "cancelled") || lines.some((l) => !!(byId[l.id] && byId[l.id].per100));
}

export interface FloorEnv { table: Pick<HallTable, "id" | "n" | "zone">; settings: Settings; today: SoldOutToday }
export async function floorEnv(ctx: Ctx, s: Pick<TableSession, "table" | "n">): Promise<FloorEnv> {
  const h = await liveHall(ctx), t = h.tables.find((x) => x.id === s.table);
  return { table: t ? { id: t.id, n: t.n, zone: t.zone } : { id: s.table, n: s.n, zone: "salon" }, settings: await getSettings(ctx), today: await soldOutToday(ctx) };
}

/** The view of a sitting for one phone (gid), or the shared one (gid null: nothing personal, the same for every phone). */
export function guestViewOf(ctx: Ctx, s: TableSession, orders: Order[], env: FloorEnv, gid: string | null): GuestView {
  const nowD = nowDate(ctx), nowMs = nowD.getTime(), st = state(ctx.clock), me = gid ? s.guests.find((g) => g.id === gid) || null : null;
  const lines = billLines(orders);
  const cart = s.cart.map((l) => cartLineView(ctx, l, gid, env.today));
  const pend = s.pending ? s.pending.lines.map((l) => cartLineView(ctx, l, gid, env.today)) : null;
  const gOrders: GuestOrder[] = orders.filter((o) => o.status !== "cancelled").sort((a, b) => a.ts - b.ts || +a.no - +b.no).map((o) => {
    const ls: GuestOrderLine[] = o.lines.map((l, idx) => {
      const ph = phoneOf(l.guest), stt = lineSt(o, l), gs = stt === "served" ? "served" : stt === "accepted" ? "accepted" : "cooking";
      return { key: lineKey(o.no, idx), id: l.id, name: l.name || l.id, q: l.q, mods: l.mods || [], grams: l.grams || null, unit: l.unit ?? 0, sum: l.out ? 0 : r2((l.unit ?? 0) * l.q),
        phone: ph, mine: !!gid && l.guest === gid, who: ph ? phoneLabel(ph) : l.guest || "Сервитьор", st: gs, stLabel: LINE_LABEL[gs], out: !!l.out, paid: !!l.paid };
    });
    return { no: o.no, placedAt: o.placedAt, ts: o.ts, channel: o.channel === "waiter" ? "waiter" : "qr", via: o.via === "waiter", status: o.status, lines: ls, sum: sumOf(ls) };
  });
  const total = sumOf(lines), paid = sumOf(lines.filter((b) => b.paid)), covered = new Set<string>();
  for (const k of Object.keys(s.bills)) s.bills[k].keys.forEach((x) => covered.add(x));
  const calls: GuestView["calls"] = { active: [], state: {} as GuestView["calls"]["state"] };
  for (const k of CALL_KINDS) {
    const c = callState(s, k, nowMs, env.settings.callCooldown);
    calls.state[k] = { state: c.state, at: c.state === "active" ? c.call!.at : null, until: c.until ? new Date(c.until).toISOString() : null };
    if (c.state === "active") calls.active.push({ kind: k, label: CALL_LABEL[k], note: c.call!.note, at: c.call!.at, taken: !!c.call!.taken, manager: callLate(c.call!, nowMs, env.settings.callManager) });
  }
  calls.active.sort((a, b) => (a.at < b.at ? -1 : 1));
  const mineBill = gid ? s.bills[gid] : undefined, rate = gid ? s.ratings[gid] : undefined;
  const opt = (split: "one" | "guests" | "dishes"): GuestBillOption => { const w = billWant(s, lines, gid!, split); return { keys: w.map((b) => b.key), sum: sumOf(w) }; };
  const picks: Record<string, number> = {};
  for (const k of Object.keys(s.picks)) { const n = phoneOf(s.picks[k]); if (n) picks[k] = n; }
  return {
    session: s.id, rev: s.rev, status: s.status, openedAt: s.openedAt, closedAt: s.closedAt || null, now: nowD.toISOString(),
    table: { n: env.table.n, zone: env.table.zone, zoneName: ZONE_NAME[env.table.zone] },
    me: me ? { phone: me.n, label: phoneLabel(me.n) } : null,
    phones: s.guests.map((g) => ({ phone: g.n, mine: g.id === gid })).sort((a, b) => a.phone - b.phone),
    kitchen: { open: st.kitchen, before: st.m < 600, breakfast: st.breakfast },
    canOrder: s.status === "open" && st.kitchen,
    lunch: LUNCH_TABLE_MISSING,
    settings: { callCooldown: env.settings.callCooldown, callManager: env.settings.callManager },
    cart: { lines: cart, ...cartTotals(cart), toWaiter: sendToWaiter(s, orders, s.cart) },
    pending: s.pending && pend ? { at: s.pending.at, phone: phoneOf(s.pending.by) || 0, lines: pend, ...cartTotals(pend) } : null,
    rejected: s.rejected ? { at: s.rejected.at, reason: s.rejected.reason, text: REJECT_REASONS[s.rejected.reason].guest, n: s.rejected.n } : null,
    orders: gOrders, total, paid, rest: r2(total - paid),
    calls,
    bill: {
      mine: mineBill ? { at: mineBill.at, pay: mineBill.pay, split: mineBill.split, keys: mineBill.keys, sum: sumOf(lines.filter((b) => mineBill.keys.includes(b.key))) } : null,
      others: Object.keys(s.bills).filter((k) => k !== gid).map((k) => ({ phone: phoneOf(k) || 0, at: s.bills[k].at, pay: s.bills[k].pay, split: s.bills[k].split })).sort((a, b) => (a.at < b.at ? -1 : 1)),
      picks, free: lines.filter((b) => !b.out && !b.paid && !covered.has(b.key)).map((b) => b.key),
      want: gid ? { one: opt("one"), guests: opt("guests"), dishes: opt("dishes") } : null,
    },
    rating: rate ? { happy: rate.happy, sent: rate.sent, code: rate.code, pct: RATING_DISCOUNT, at: rate.at } : null,
    canRate: !!gid && canRate(s, gid),
    google: RESTAURANT.googleReview,
  };
}
/** the rating comes with the bill: after this phone asked for it, after someone asked for the whole bill, or after the close */
export function canRate(s: TableSession, gid: string): boolean {
  return s.orders.length > 0 && (s.status === "closed" || !!s.bills[gid] || Object.keys(s.bills).some((k) => s.bills[k].split === "one"));
}

/* ---------- real time ---------- */
/** floor.session: to the guests of the sitting and to the staff; the payload is what any guest may see */
export async function emitSession(ctx: Ctx, s: TableSession, orders?: Order[], env?: FloorEnv): Promise<void> {
  const e = env || (await floorEnv(ctx, s)), os = orders || (await sessionOrders(ctx, s));
  emit(ctx, "floor.session", { id: s.id, table: s.table, n: e.table.n, rev: s.rev, status: s.status, view: guestViewOf(ctx, s, os, e, null) }, { table: s.id });
}
/** The kitchen changed a line or the status of a table order (order.line / order.status from another core): the guests of
    the sitting hear it as floor.session (the same payload as always; `rev` stays, the line states inside are new). */
export async function sessionTouched(ctx: Ctx, sessionId: string): Promise<void> {
  const s = await ctx.repo.get<TableSession>(COL.tableSessions, String(sessionId || ""));
  if (s) await emitSession(ctx, s);
}
export function emitCall(ctx: Ctx, s: TableSession, c: FloorCall): void {
  emit(ctx, "floor.call", { table: s.table, n: s.n, session: s.id, id: c.id, kind: c.kind, at: c.at, taken: c.taken ? { by: c.taken.by, name: c.taken.name, at: c.taken.at } : null, done: c.done ? c.done.how : null });
}

/** a sitting from an earlier day (Sofia) with nothing unpaid and nothing waiting: closed quietly (true when it was) */
export async function closeIfStale(ctx: Ctx, s: TableSession): Promise<boolean> {
  if (s.status !== "open" || sofiaYmd(new Date(s.openedAt)) >= sofiaYmd(nowDate(ctx)) || s.pending) return false;
  const lines = billLines(await sessionOrders(ctx, s));
  if (lines.some((b) => !b.out && !b.paid)) return false;
  const now = iso(ctx);
  s.status = "closed"; s.closedAt = now; s.closedBy = "system";
  s.calls.forEach((c) => { if (!c.done) c.done = { how: "closed", at: now, by: "system" }; });
  await saveSession(ctx, s);
  return true;
}
