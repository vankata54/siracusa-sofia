/* The manager's module ("Управител": Сега · Залата · Екипът; design/pages-upravitel, README + _mgr.js + _seed-shift.js;
   decisions 16.11 and 17.11.2026, answers 29-32). One core for the server and the demo: it reads the other cores (the
   hall live, the waiters' shifts, the kitchen, the drivers, the orders, the reservations) and never keeps a copy of an
   order. Its own small document is COL.modState "shift:<day>": what the manager saw or solved this shift ("Видях",
   "Готово, обадих се"), to whom he gave a call or a QR order, and what "Отмени" may take back.
   RIGHTS (in every function): the main admin, the owner and the manager (by role); "Залата" needs the section "Залата"
   or "Резервации", "Екипът" the section "Персонал", every action the section of its object (orders, reservations ...).
   MONEY (decision 16.11, MODULES-BRIEF 5.1): the manager NEVER gets a sum over several orders (turnover, "Днес: X €",
   sums by channel or day) unless the role has "Финанси и гориво"; the sum of ONE order, of ONE table and a driver's
   cash are allowed. `money` says which; `today` is null without it (tests/unit/boss-core-shift.test.ts).
   Every action writes a line in the log (call.take, order.call, order.note, shift.tables, hall.update and the other
   cores' own lines) and tells the screens `shift.update`. */
import { COL, emit, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Iso, type Order, type OrderStatus, type Reservation } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { audit } from "./audit.ts";
import { may, invalid, serial, maskPhone, round2, RIGHTS_MSG } from "./rights.ts";
import { FINISHED, STATUS_LABEL, setOrderStatus } from "./orders.ts";
import { LATE_PICKUP_MIN } from "./orders-admin.ts";
import { liveZones } from "./zones.ts";
import { getSettings } from "./settings.ts";
import { notesWaiting } from "./notes.ts";
import { search as adminSearch } from "./admin.ts";
import { hallLive, tableDetail, callTake as fCallTake, callUndo as fCallUndo, qrConfirm as fQrConfirm, staffSearch, TABLE_STATE_LABEL, type HallLive, type TableStateKey } from "./floor-staff.ts";
import { shiftView, shiftSetTables, openShifts, type WaiterShift } from "./floor-shift.ts";
import { openSessions, saveSession, emitCall, emitSession, lockKey, ZONE_NAME, type TableSession } from "./floor.ts";
import { kitchenSummary, kitchenSoldOut, kitchenSetOut, kitchenSetBusy, K_ALL } from "./kitchen.ts";
import { kitchenConfig, secOfLine, LUNCH_CAT } from "./kitchen-base.ts";
import { drivers as driversView, answer as dAnswer, answerUndo as dAnswerUndo, ANSWER_LABEL, type AskAnswer, type DriversView } from "./driver.ts";
import { blockList, blockDecide, resSetStatus, RES_STATUS_LABEL, type BlockRow, type ResRow } from "./reservations-admin.ts";
import { getHall, saveHall } from "./hall.ts";
import { LUNCH_PICKUP_DISCOUNT } from "../lib/lunch.ts";
import { findDish } from "../lib/data.ts";
import { state } from "../lib/status.ts";
import { sofiaYmd, sofiaNow, minutes } from "../lib/time.ts";

/* ---------- rights, words ---------- */
export const MANAGER_ROLES = ["admin", "owner", "manager"];
export const MGR_MSG = {
  forbidden: "Модулът Управител е за управителя, собственика и главния админ.",
  noOrder: "Няма такава поръчка.",
  notAccepted: "Поръчката вече не чака „Приеми“. Обнови екрана.",
  hasOut: (names: string) => "В поръчката има изчерпано: " + names + ". Обади се на клиента или я приеми без него.",
  allOut: "Всички ястия в поръчката са изчерпани: откажи я от „Поръчки“ в админа, ако клиентът не иска друго.",
  without: (names: string) => "Без „" + names + "“ (изчерпано днес), клиентът е уведомен.",
  undo: "Вече не може да се отмени.",
  started: "Кухнята вече започна поръчката. Отмени я от „Поръчки“ в админа.",
  call: "Това повикване вече го няма. Обнови екрана.",
  taken: (who: string) => "Повикването вече е поето от " + who + ".",
  waiter: "Избери сервитьор, който е на смяна.",
  qr: "Няма QR поръчка за потвърждение. Обнови екрана.",
  key: "Няма такъв проблем. Обнови екрана.",
  what: "Избери „Видях“ или „Готово, обадих се“.",
};
/** "Отмени" of the manager's actions: the screen shows it 6 s, the core accepts it this long */
export const MGR_UNDO_MS = 15_000;
/** the reservations of the pulse: the next 2 hours (not after 23:00) */
export const RES_AHEAD_MIN = 120;
/** after 21:00 the drivers' cash is "За предаване сега"; after 23:00 "Смяната приключи" */
export const CASH_NOW_MIN = 1260, SHIFT_OVER_MIN = 1380;

export function needManager(s: StaffCtx | null | undefined, sec?: string | string[]): StaffCtx {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (!MANAGER_ROLES.includes(s.user.role)) throw new CoreError("forbidden", MGR_MSG.forbidden, 403);
  if (sec && !may(s, sec)) throw new CoreError("forbidden", RIGHTS_MSG.forbidden, 403);
  return s;
}
/** a sum over several orders only with "Финанси и гориво" (the rule of the module, in the core) */
export const managerMoney = (s: StaffCtx): boolean => may(s, "finance");

/* ---------- the rule "Закъснява" (the admin's orders: core/orders-admin.ts) ----------
   Today's unfinished orders, not for a later hour: delivery after the promised time (the zone's minutes), pickup and a
   table after 20 minutes, if not ready yet. lateMin: by how many minutes (0 = not late). */
export function lateMinOf(o: Order, today: string, now: number, zoneMin: Map<string, number>): number {
  if (FINISHED.includes(o.status) || o.status === "cancelled" || o.sched || sofiaYmd(new Date(o.ts || o.createdAt)) !== today) return 0;
  if (o.mode !== "delivery" && o.status === "ready") return 0;
  const placed = +o.placedAt.slice(0, 2) * 60 + +o.placedAt.slice(3);
  const due = /^\d{2}:\d{2}$/.test(o.at) ? +o.at.slice(0, 2) * 60 + +o.at.slice(3) : placed + (o.mode === "delivery" ? zoneMin.get(o.zone) || 35 : LATE_PICKUP_MIN);
  return now > due ? now - due : 0;
}
const isTable = (o: Pick<Order, "channel" | "table">) => o.channel === "qr" || o.channel === "waiter" || !!o.table;
/** "Доставка" / "Вземане" / "Маса" / "Офис" */
export const chName = (o: Pick<Order, "channel" | "mode" | "table">): string => (isTable(o) ? "Маса" : o.channel === "office" ? "Офис" : o.mode === "delivery" ? "Доставка" : "Вземане");
const hmOf = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const hmIso = (i: string) => { const c = sofiaNow(new Date(i)); return hmOf(c.h * 60 + c.m); };
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);

/* ---------- the shift's own document ---------- */
interface Ack { at: Iso; by: string; name: string; what: "seen" | "called" }
interface Given { to: string; name: string; at: Iso; by: string }
interface UndoRec { id: string; kind: "accept" | "tables"; at: Iso; by: string; no?: string; order?: Pick<Order, "sub" | "disc" | "total" | "codeDisc" | "profileDisc" | "staffNotes" | "times">; before?: Record<string, string[]> }
interface ShiftDoc { id: string; date: string; ack: Record<string, Ack>; qr: Record<string, Given>; calls: Record<string, Given>; undo: Record<string, UndoRec>; updatedAt?: Iso }
const docId = (day: string) => "shift:" + day;
async function getDoc(ctx: Ctx): Promise<ShiftDoc> {
  const day = sofiaYmd(nowDate(ctx)), d = await ctx.repo.get<ShiftDoc>(COL.modState, docId(day));
  return d && d.date === day ? { ...d, ack: d.ack || {}, qr: d.qr || {}, calls: d.calls || {}, undo: d.undo || {} } : { id: docId(day), date: day, ack: {}, qr: {}, calls: {}, undo: {} };
}
async function putDoc(ctx: Ctx, d: ShiftDoc): Promise<void> {
  /* old undo records go away (they are never valid after the window) */
  const t = nowDate(ctx).getTime();
  for (const k of Object.keys(d.undo)) if (t - Date.parse(d.undo[k].at) > MGR_UNDO_MS * 4) delete d.undo[k];
  d.updatedAt = iso(ctx);
  await ctx.repo.put(COL.modState, d);
}
const withDoc = <T>(ctx: Ctx, fn: (d: ShiftDoc) => Promise<T>): Promise<T> => serial(ctx.repo, "mgr-shift", async () => { const d = await getDoc(ctx); const r = await fn(d); await putDoc(ctx, d); return r; });
const say = (ctx: Ctx, what: string, data: Record<string, unknown> = {}) => emit(ctx, "shift.update", { what, ...data });
const fresh = (ctx: Ctx, at: string) => nowDate(ctx).getTime() - Date.parse(at) <= MGR_UNDO_MS;

/* ---------- the views ---------- */
export interface ProblemRef { call?: string; session?: string; table?: { id: string; n: number }; no?: string; ask?: string; waiter?: { username: string; name: string } | null; mode?: "delivery" | "pickup" | "table" }
export interface Problem {
  /** stable key: "call:<id>", "qr:<session>", "out:<№>", "ask:<id>", "late:<№>" */
  key: string; kind: "call" | "qr" | "out" | "ask" | "late";
  /** urgency (higher first); a solved late order is -1 (at the bottom, "решено") */
  sev: number; tone: "hot" | "ember" | "warn" | "solved"; icon: string;
  title: string; meta: string;
  /** the live timer (the call, the QR order, the question) */
  since: Iso | null;
  /** a late order: by how many minutes */
  lateMin: number | null;
  /** "Видях" / "Готово, обадих се" this shift */
  done: { at: Iso; by: string; what: "seen" | "called" } | null;
  /** the actions: "go" ("Отивам"), "assign" ("Възложи на…"), "confirm" ("Потвърди и прати"), "call" ("Обади се на клиента"),
      "without" ("Приеми без него"), "return" | "pickup" | "deliver" (the three answers), "kitchen" ("Виж в кухнята"), "seen" ("Видях") */
  actions: string[];
  ref: ProblemRef;
}
export interface WaitOrder {
  no: string; placedAt: string; ts: number; channel: Order["channel"]; channelName: string; mode: Order["mode"]; at: string; sched: string;
  name: string; phone: string; zone: string; lines: { name: string; q: number; out: boolean }[];
  /** the sum of THIS order (allowed) */ total: number;
  /** the sold-out dishes in it: "Приеми" asks first ("Обади се на клиента" / "Приеми без него") */ out: string[]; outAll: boolean; fresh: boolean;
}
export interface WaitRes { id: string; date: string; time: string; name: string; people: number; tableN: number | null; occasion: string; phone: string }
export interface MgrKitchen {
  open: boolean;
  busy: { on: boolean; at: Iso | null; atHm: string; by: string | null; extra: number; etaMin: number; etaBusyMin: number };
  sections: { id: string; n: string; short: string; icon: string; wait: number; late: number; soon: number; oldestMin: number | null; out: number; tablet: { online: boolean; text: string; lastHm: string } }[];
  soldOut: { id: string; n: string; secName: string; atHm: string; by: string | null }[];
}
export interface MgrNow {
  date: string; now: string; status: { open: boolean; kitchen: boolean; delivery: boolean }; money: boolean;
  pulse: {
    tables: { busy: number; total: number; salon: number; garden: number };
    /** the same number as the admin's tab "В работа" (today) */ inWork: number;
    /** the same number as the admin's "Закъснява"; open: not seen yet this shift */ late: { n: number; open: number; seen: number };
    calls: number;
    /** the next 2 hours (until "21:42") */ reservations: { n: number; people: number; until: string };
    closed: boolean;
  };
  problems: Problem[];
  waits: { orders: WaitOrder[] | null; reservations: WaitRes[] | null; blocks: BlockRow[] | null; notes: Awaited<ReturnType<typeof notesWaiting>>; n: number };
  kitchen: MgrKitchen;
  /** the web orders still "Приета" (the sound / "Нова онлайн поръчка" of the frame), the oldest first */
  fresh: string[];
  /** the badge of "Сега": each thing once (an order with a sold-out dish is a problem and waits for "Приеми") */
  counts: { problems: number; waits: number; now: number };
  /** "Днес: X € от N поръчки": ONLY with "Финанси и гориво", else null */
  today: { sum: number; n: number } | null;
  settings: { callManager: number; qrManager: number };
}

interface World {
  ctx: Ctx; s: StaffCtx; day: string; now: number; nowMs: number; orders: Order[]; zoneMin: Map<string, number>; names: Map<string, string>;
  hall: HallLive; doc: ShiftDoc; set: { callManager: number; qrManager: number };
}
async function world(ctx: Ctx, s: StaffCtx): Promise<World> {
  const [orders, zones, staff, hall, doc, st] = await Promise.all([ctx.repo.list<Order>(COL.orders), liveZones(ctx), ctx.repo.list<{ id: string; username: string; name: string }>(COL.staff), hallLive(ctx, s), getDoc(ctx), getSettings(ctx)]);
  return { ctx, s, day: sofiaYmd(nowDate(ctx)), now: minutes(ctx.clock), nowMs: nowDate(ctx).getTime(), orders, zoneMin: new Map(zones.map((z) => [z.n, z.etaMin])), names: new Map(staff.map((u) => [u.username, u.name])),
    hall, doc, set: { callManager: st.callManager, qrManager: st.qrManager || 3 } };
}
const lateOrders = (w: World) => w.orders.map((o) => ({ o, m: lateMinOf(o, w.day, w.now, w.zoneMin) })).filter((x) => x.m > 0);

async function problemsOf(w: World): Promise<Problem[]> {
  const out: Problem[] = [], ack = w.doc.ack, cfg = await kitchenConfig(w.ctx);
  const tileOf = (id: string) => w.hall.tables.find((t) => t.id === id);
  const sinceMin = (at: string) => (w.nowMs - Date.parse(at)) / 60_000;
  /* a call nobody took for settings.callManager minutes */
  for (const c of w.hall.calls) {
    if (c.taken || !c.late) continue;
    const t = tileOf(c.table.id), wt = t && t.owner;
    out.push({ key: "call:" + c.id, kind: "call", sev: 100 + sinceMin(c.at), tone: "hot", icon: c.kind === "bill" ? "receipt" : "hand-waving",
      title: "Маса " + c.table.n + " · " + (c.kind === "bill" ? "Сметка" : "Вика"), meta: (wt ? wt.name + " не е отговорил" : "Никой не е отговорил") + " · изпратено на теб",
      since: c.at, lateMin: null, done: null, actions: ["go", "assign"], ref: { call: c.id, session: c.session, table: { id: c.table.id, n: c.table.n }, waiter: wt || null } });
  }
  /* a QR order nobody confirmed for settings.qrManager minutes (answer 29: 3) */
  for (const q of w.hall.qr) {
    if (!q.late) continue;
    const t = tileOf(q.table.id), wt = t && t.owner, given = w.doc.qr[q.session];
    out.push({ key: "qr:" + q.session, kind: "qr", sev: 80 + sinceMin(q.at), tone: "hot", icon: "qr-code", title: "Маса " + q.table.n + " · QR поръчка",
      meta: q.n + (q.n === 1 ? " ястие" : " ястия") + " · никой не я е потвърдил" + (given ? " · възложена на " + given.name : wt ? " · " + wt.name : ""),
      since: q.at, lateMin: null, done: null, actions: ["confirm", "assign"], ref: { session: q.session, table: { id: q.table.id, n: q.table.n }, waiter: given ? { username: given.to, name: given.name } : wt || null } });
  }
  /* a driver asks: the address is outside the zones (answer 30: three answers) */
  const asks = (await w.ctx.repo.list<{ id: string; order: string; driver: string; name: string; at: string; status: string; addr: string }>(COL.asks)).filter((a) => a.status === "open");
  for (const a of asks) out.push({ key: "ask:" + a.id, kind: "ask", sev: 85 + sinceMin(a.at), tone: "warn", icon: "map-pin", title: (w.names.get(a.driver) || a.name) + " · адрес извън зоните",
    meta: "№ " + a.order + (a.addr ? " · " + a.addr : "") + " · пита какво да прави", since: a.at, lateMin: null, done: null, actions: ["return", "pickup", "deliver"], ref: { ask: a.id, no: a.order } });
  /* a sold-out dish in an accepted delivery / pickup order (the kitchen marked the line `out`; OPEN-QUESTIONS 19) */
  for (const o of w.orders) {
    if ((o.status !== "accepted" && o.status !== "cooking") || isTable(o)) continue;
    const names = [...new Set(o.lines.filter((l) => l.out).map((l) => l.name || l.id))];
    if (!names.length || ack["out:" + o.no]) continue;
    out.push({ key: "out:" + o.no, kind: "out", sev: 95, tone: "ember", icon: "warning", title: "№ " + o.no + " · Изчерпано: " + names.join(", "),
      meta: chName(o) + " · " + (o.name || "") + " · " + (o.status === "accepted" ? "чака „Приеми“" : "в кухнята") + " · обади се и предложи друго",
      since: null, lateMin: null, done: null, actions: o.status === "accepted" ? ["call", "without"] : ["call"], ref: { no: o.no, mode: o.mode } });
  }
  /* late orders: a delivery grows twice as fast; the solved ones stay at the bottom ("решено") */
  for (const { o, m } of lateOrders(w)) {
    const tbl = isTable(o), road = o.status === "on_way", a = ack["late:" + o.no] || null;
    const tn = tbl && o.table ? (tileOf(o.table)?.n ?? o.table) : null;
    const secs = [...new Set(o.lines.map((l) => secOfLine(cfg, l)))].map((id) => cfg.sections.find((x) => x.id === id)?.n || id);
    const meta = (road ? "На път · " + (o.driver ? w.names.get(o.driver) || o.driver : "шофьор") + (o.zone ? " · " + o.zone : "") : STATUS_LABEL[o.status] + (secs.length ? " · " + secs.join(", ") : "")) + " · приета " + o.placedAt;
    out.push({ key: "late:" + o.no, kind: "late", sev: a ? -1 : o.mode === "delivery" ? 70 + 2 * m : 60 + m, tone: a ? "solved" : "warn", icon: road ? "moped" : tbl ? "chair" : "chef-hat",
      title: (tbl ? "Маса " + tn + " · № " + o.no : chName(o) + " № " + o.no) + " · закъснява " + m + " мин",
      meta: a ? meta + " · " + (a.what === "called" ? "обади се" : "видяно") + " " + hmIso(a.at) : meta,
      since: null, lateMin: m, done: a ? { at: a.at, by: a.name, what: a.what } : null, actions: a ? [] : tbl ? ["kitchen", "seen"] : ["call"], ref: { no: o.no, mode: tbl ? "table" : o.mode, ...(tbl && o.table ? { table: { id: o.table, n: +(tn || 0) } } : {}) } });
  }
  return out.sort((a, b) => b.sev - a.sev || (a.key < b.key ? -1 : 1));
}

function waitOrder(o: Order, freshNos: Set<string>): WaitOrder {
  const outN = [...new Set(o.lines.filter((l) => l.out).map((l) => l.name || l.id))];
  return { no: o.no, placedAt: o.placedAt, ts: o.ts, channel: o.channel, channelName: chName(o), mode: o.mode, at: o.at, sched: o.sched, name: o.name, phone: maskPhone(o.phone), zone: o.zone,
    lines: o.lines.map((l) => ({ name: l.name || l.id, q: l.q, out: !!l.out })), total: o.total, out: outN, outAll: o.lines.length > 0 && o.lines.every((l) => l.out), fresh: freshNos.has(o.no) };
}
async function kitchenOf(ctx: Ctx, s: StaffCtx): Promise<MgrKitchen> {
  const [k, so, st] = await Promise.all([kitchenSummary(ctx, s), kitchenSoldOut(ctx, s, K_ALL), getSettings(ctx)]);
  return {
    open: state(ctx.clock).kitchen,
    busy: { on: k.busy.on, at: k.busy.at, atHm: k.busy.atHm, by: k.busy.by, extra: k.busy.extra, etaMin: st.kitchen.etaMin, etaBusyMin: st.kitchen.etaBusyMin },
    sections: k.sections.map((x) => ({ id: x.id, n: x.n, short: x.short, icon: x.icon, wait: x.wait, late: x.late, soon: x.soon, oldestMin: x.oldestMin, out: x.out, tablet: { online: x.tablet.online, text: x.tablet.text, lastHm: x.tablet.lastHm } })),
    soldOut: so.list.map((r) => ({ id: r.id, n: r.n, secName: r.secName, atHm: r.atHm, by: r.by })),
  };
}

/** "Сега": the pulse, "Проблеми сега" by urgency, "Чака те", the kitchen */
export async function managerNow(ctx: Ctx, s: StaffCtx): Promise<MgrNow> {
  needManager(s);
  const w = await world(ctx, s), st = state(ctx.clock), money = managerMoney(s);
  const tiles = w.hall.tables, problems = await problemsOf(w);
  const today = w.orders.filter((o) => sofiaYmd(new Date(o.ts || o.createdAt)) === w.day);
  const late = lateOrders(w), seen = late.filter((x) => !!w.doc.ack["late:" + x.o.no]).length;
  const end = Math.min(w.now + RES_AHEAD_MIN, SHIFT_OVER_MIN);
  const resToday = may(s, "reservations") || may(s, "hall") ? (await ctx.repo.list<Reservation>(COL.reservations, { date: w.day } as Partial<Reservation>)) : [];
  const res2 = resToday.filter((r) => (r.status === "new" || r.status === "confirmed") && toMin(r.time) >= w.now && toMin(r.time) <= end);
  const freshNos = w.orders.filter((o) => o.status === "accepted" && o.channel === "web").sort((a, b) => a.ts - b.ts).map((o) => o.no);
  const fs = new Set(freshNos);
  /* "Чака те": the rule of the admin's dashboard (core/admin.ts summary), only what the role sees */
  const orders = may(s, "orders") ? w.orders.filter((o) => o.status === "accepted").sort((a, b) => a.ts - b.ts).map((o) => waitOrder(o, fs)) : null;
  const tn = new Map(tiles.map((t) => [t.id, t.n]));
  const reservations = may(s, "reservations") ? resToday.filter((r) => r.status === "new").sort((a, b) => (a.time < b.time ? -1 : 1))
    .map((r) => ({ id: r.id, date: r.date, time: r.time, name: r.name, people: r.people, tableN: r.table ? tn.get(r.table) ?? null : null, occasion: r.occasion || "", phone: maskPhone(r.phone) })) : null;
  const blocks = may(s, ["reservations", "customers"]) ? (await blockList(ctx, s)).rows.filter((b) => b.status === "pending") : null;
  const notes = await notesWaiting(ctx, s);
  const wn = (orders ? orders.length : 0) + (reservations ? reservations.length : 0) + (blocks ? blocks.length : 0) + notes.n;
  const open = problems.filter((p) => !p.done), dup = open.filter((p) => p.kind === "out" && !!orders && orders.some((o) => o.no === p.ref.no)).length;
  const sales = today.filter((o) => o.status !== "cancelled");
  return {
    date: w.day, now: hmOf(w.now), status: { open: st.open, kitchen: st.kitchen, delivery: st.delivery }, money,
    pulse: {
      tables: { busy: tiles.filter((t) => t.state !== "free").length, total: tiles.length, salon: tiles.filter((t) => t.state !== "free" && t.zone === "salon").length, garden: tiles.filter((t) => t.state !== "free" && t.zone === "garden").length },
      inWork: today.filter((o) => !FINISHED.includes(o.status) && o.status !== "cancelled").length,
      late: { n: late.length, open: late.length - seen, seen }, calls: w.hall.calls.filter((c) => !c.taken).length,
      reservations: { n: res2.length, people: res2.reduce((a, r) => a + r.people, 0), until: hmOf(end) }, closed: !st.open,
    },
    problems, waits: { orders, reservations, blocks, notes, n: wn }, kitchen: await kitchenOf(ctx, s), fresh: freshNos,
    counts: { problems: open.length, waits: wn, now: open.length + wn - dup },
    today: money ? { sum: round2(sales.reduce((a, o) => a + (o.total || 0), 0)), n: sales.length } : null,
    settings: w.set,
  };
}

/* ---------- "Залата" ---------- */
export type MgrTileState = TableStateKey | "res";
export const MGR_TILE_LABEL: Record<MgrTileState, string> = { ...TABLE_STATE_LABEL, call: "Вика", bill: "Сметка", ready: "Готово", busy: "Заета", res: "Резервирана" };
export interface TonightRes { id: string; time: string; name: string; people: number; tableId: string | null; tableN: number | null; zone: string; occasion: string; note: string; status: Reservation["status"]; statusLabel: string; phone: string;
  /** "Закъснява 42 мин": the time passed and the table is not occupied (an occupied table means the guests came) */ lateMin: number | null; canConfirm: boolean }
export interface MgrTile { id: string; n: number; zone: "salon" | "garden"; zoneName: string; seats: number; state: MgrTileState; label: string; since: Iso | null; waits: boolean;
  waiter: { username: string; name: string } | null; session: string | null; walkin: boolean; next: { id: string; time: string; name: string; people: number } | null }
export interface MgrHall { now: string; money: boolean; tiles: MgrTile[]; tonight: TonightRes[]; waitlist: TonightRes[]; legend: [MgrTileState, string][]; canWalkin: boolean; canReservations: boolean;
  /** the open tables' sum: ONLY with "Финанси и гориво" */ tablesSum: number | null }

async function tonightOf(ctx: Ctx, s: StaffCtx, w: { day: string; now: number; tiles: HallLive["tables"] }): Promise<{ tonight: TonightRes[]; waitlist: TonightRes[]; all: Reservation[]; row: (r: Reservation) => TonightRes }> {
  const all = (await ctx.repo.list<Reservation>(COL.reservations, { date: w.day } as Partial<Reservation>)).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.createdAt < b.createdAt ? -1 : 1));
  const tile = (id: string | null) => (id ? w.tiles.find((t) => t.id === id) : undefined);
  const row = (r: Reservation): TonightRes => {
    const t = tile(r.table), occupied = !!t && t.state !== "free", m = toMin(r.time);
    return { id: r.id, time: r.time, name: r.name, people: r.people, tableId: r.table, tableN: t ? t.n : null, zone: r.zone ? ZONE_NAME[r.zone] : "", occasion: r.occasion || "", note: r.note || "", status: r.status, statusLabel: RES_STATUS_LABEL[r.status],
      phone: maskPhone(r.phone), lateMin: m < w.now && !occupied ? w.now - m : null, canConfirm: r.status === "new" && may(s, "reservations") };
  };
  /* up to the end of the evening: the new and confirmed ones still to come (or up to 60 min late); a past time with the
     table occupied is not listed (the guests came) */
  const tonight = all.filter((r) => (r.status === "new" || r.status === "confirmed") && toMin(r.time) >= w.now - 60 && !(toMin(r.time) < w.now && (tile(r.table)?.state || "free") !== "free")).map(row);
  return { tonight, waitlist: all.filter((r) => r.status === "waitlist").map(row), all, row };
}
export async function managerHall(ctx: Ctx, s: StaffCtx): Promise<MgrHall> {
  needManager(s, ["hall", "reservations"]);
  const hall = await hallLive(ctx, s), plan = (await getHall(ctx, s)).tables, day = sofiaYmd(nowDate(ctx)), now = minutes(ctx.clock);
  const { tonight, waitlist, all } = await tonightOf(ctx, s, { day, now, tiles: hall.tables });
  const ahead = all.filter((r) => (r.status === "new" || r.status === "confirmed") && toMin(r.time) >= now);
  const tiles: MgrTile[] = hall.tables.map((t) => {
    const next = ahead.find((r) => r.table === t.id) || null, res = t.state === "free" && !!next && toMin(next.time) - now <= 60;
    const st: MgrTileState = res ? "res" : t.state;
    return { id: t.id, n: t.n, zone: t.zone, zoneName: ZONE_NAME[t.zone], seats: t.seats, state: st, label: MGR_TILE_LABEL[st], since: t.since, waits: t.waits, waiter: t.owner, session: t.session,
      walkin: plan.find((x) => x.id === t.id)?.walkin !== false, next: next ? { id: next.id, time: next.time, name: next.name, people: next.people } : null };
  });
  let tablesSum: number | null = null;
  if (managerMoney(s)) { let sum = 0; for (const t of hall.tables.filter((x) => x.session)) sum += (await tableDetail(ctx, s, t.id)).total; tablesSum = round2(sum); }
  return { now: hmOf(now), money: managerMoney(s), tiles, tonight, waitlist, legend: (["call", "bill", "qr", "ready", "wait", "busy", "res", "free"] as MgrTileState[]).map((k) => [k, MGR_TILE_LABEL[k]]),
    canWalkin: may(s, "hall"), canReservations: may(s, "reservations"), tablesSum };
}
export interface MgrTable {
  table: { id: string; n: number; zone: "salon" | "garden"; zoneName: string; seats: number }; state: MgrTileState; label: string; since: Iso | null;
  waiter: { username: string; name: string } | null; waiters: { username: string; name: string; tables: number }[]; occupiedSince: Iso | null;
  orders: { no: string; placedAt: string; status: OrderStatus; statusLabel: string; bill: string; total: number; lines: { name: string; q: number; st: string }[] }[];
  /** the sum of THIS table (allowed) */ sum: number; paid: number; rest: number;
  calls: { id: string; kind: string; label: string; at: Iso; taken: { by: string; name: string } | null }[];
  /** the next reservation of the table: a future time only */ next: TonightRes | null;
  walkin: boolean; canWalkin: boolean; canChangeWaiter: boolean;
}
export async function managerTable(ctx: Ctx, s: StaffCtx, ref: string | number): Promise<MgrTable> {
  needManager(s, ["hall", "reservations"]);
  const d = await tableDetail(ctx, s, ref), hall = await hallLive(ctx, s), plan = (await getHall(ctx, s)).tables, shifts = await openShifts(ctx);
  const day = sofiaYmd(nowDate(ctx)), now = minutes(ctx.clock), t = hall.tables.find((x) => x.id === d.table.id)!;
  const { all, row } = await tonightOf(ctx, s, { day, now, tiles: hall.tables });
  const nx = all.filter((r) => r.table === d.table.id && (r.status === "new" || r.status === "confirmed") && toMin(r.time) >= now)[0] || null;
  const next = nx ? row(nx) : null;
  const st: MgrTileState = t && t.state === "free" && nx && toMin(nx.time) - now <= 60 ? "res" : d.state;
  return {
    table: d.table, state: st, label: MGR_TILE_LABEL[st], since: d.since, waiter: d.owner,
    waiters: shifts.map((x) => ({ username: x.username, name: x.name, tables: x.tables.length })), occupiedSince: d.session ? d.session.openedAt : null,
    orders: d.bills.flatMap((b) => b.orders.map((o) => ({ no: o.no, placedAt: o.placedAt, status: o.status, statusLabel: o.statusLabel, bill: b.name, total: o.sum, lines: o.lines.map((l) => ({ name: l.name, q: l.q, st: l.stLabel })) }))),
    sum: d.total, paid: d.paid, rest: d.rest,
    calls: d.calls.map((c) => ({ id: c.id, kind: c.kind, label: c.label, at: c.at, taken: c.taken ? { by: c.taken.by, name: c.taken.name } : null })),
    next, walkin: plan.find((x) => x.id === d.table.id)?.walkin !== false, canWalkin: may(s, "hall"), canChangeWaiter: shifts.length > 0,
  };
}
/** "Обслужва" with one tap: the table goes to this waiter on shift (it leaves its old waiter). Log: shift.tables (floor-shift.ts). */
export async function managerSetWaiter(ctx: Ctx, s: StaffCtx, ref: string | number, waiter: string): Promise<MgrTable> {
  needManager(s, ["hall", "reservations"]);
  const shifts = await openShifts(ctx), w = shifts.find((x) => x.username === String(waiter || "") || x.user === String(waiter || ""));
  if (!w) invalid({ waiter: MGR_MSG.waiter }, MGR_MSG.waiter);
  const d = await tableDetail(ctx, s, ref);
  if (!w!.tables.includes(d.table.id)) await shiftSetTables(ctx, s, w!.username, [...w!.tables, d.table.id]);
  say(ctx, "table.waiter", { table: d.table.id, n: d.table.n, to: w!.username });
  return managerTable(ctx, s, d.table.id);
}
/** "Блокирай за гости без резервация" (allow false) / back (true): the table in the hall's plan (core/hall.ts, log hall.update) */
export async function managerWalkin(ctx: Ctx, s: StaffCtx, ref: string | number, allow: boolean): Promise<MgrTable> {
  needManager(s, "hall");
  if (typeof allow !== "boolean") invalid({ allow: "Избери „само с резервация“ или „и за гости без резервация“." });
  const d = await tableDetail(ctx, s, ref), h = await getHall(ctx, s);
  const cur = h.tables.find((t) => t.id === d.table.id);
  if (cur && cur.walkin !== allow) await saveHall(ctx, s, { tables: h.tables.map((t) => (t.id === d.table.id ? { ...t, walkin: allow } : t)), merges: h.merges, gardenOpen: h.gardenOpen }, h.version);
  say(ctx, "hall.walkin", { table: d.table.id, n: d.table.n, walkin: allow });
  return managerTable(ctx, s, d.table.id);
}

/* ---------- "Екипът" ---------- */
export interface MgrTeam {
  now: string; shiftOver: boolean;
  waiters: { username: string; name: string; since: Iso; tables: { id: string; n: number; zone: "salon" | "garden" }[]; calls: number; qr: number; late: number;
    /** the average answer time today (seconds) from the real calls, null without data */ avgSec: number | null; answered: number }[];
  unassigned: { id: string; n: number; zone: "salon" | "garden" }[];
  /** every table in use with its waiter (the sheet "Смени масите") */
  tables: { id: string; n: number; zone: "salon" | "garden"; owner: string | null; ownerName: string | null }[];
  kitchen: MgrKitchen;
  drivers: (DriversView["drivers"][number] & { cashWhen: "end" | "now" })[];
  driversWaiting: number; asks: DriversView["asks"]; problems: DriversView["problems"];
}
export async function managerTeam(ctx: Ctx, s: StaffCtx): Promise<MgrTeam> {
  needManager(s, "staff");
  const [sv, hall, dv] = await Promise.all([shiftView(ctx, s), hallLive(ctx, s), driversView(ctx, s)]);
  const now = minutes(ctx.clock);
  return {
    now: hmOf(now), shiftOver: now >= SHIFT_OVER_MIN,
    waiters: sv.waiters.map((w) => ({ username: w.username, name: w.name, since: w.since, tables: w.tables, calls: w.waiting, qr: hall.qr.filter((q) => w.tables.some((t) => t.id === q.table.id)).length, late: w.late, avgSec: w.avgSec, answered: w.answered })),
    unassigned: sv.unassigned,
    tables: hall.tables.map((t) => ({ id: t.id, n: t.n, zone: t.zone, owner: t.owner ? t.owner.username : null, ownerName: t.owner ? t.owner.name : null })),
    kitchen: await kitchenOf(ctx, s),
    drivers: dv.drivers.map((d) => ({ ...d, cashWhen: now >= CASH_NOW_MIN ? "now" : "end" })), driversWaiting: dv.waiting, asks: dv.asks, problems: dv.problems,
  };
}
/** "Смени масите": the waiter's new tables (at least one); taken from a colleague, dropped to the colleague (floor-shift.ts,
    log shift.tables). Returns the team and the "Отмени" id. */
export async function managerSetTables(ctx: Ctx, s: StaffCtx, who: string, tables: (string | number)[], to?: string | null): Promise<{ team: MgrTeam; undo: { id: string; until: number } }> {
  needManager(s, "staff");
  const before = Object.fromEntries((await openShifts(ctx)).map((x) => [x.user, x.tables.slice()]));
  await shiftSetTables(ctx, s, who, tables, to);
  const id = rid(6), at = iso(ctx);
  await withDoc(ctx, async (d) => { d.undo[id] = { id, kind: "tables", at, by: s.user.username, before }; });
  return { team: await managerTeam(ctx, s), undo: { id, until: Date.parse(at) + MGR_UNDO_MS } };
}
/** "Отмени" after "Смени масите": every waiter's tables exactly as before. Log: shift.tables (undo). */
export async function managerSetTablesUndo(ctx: Ctx, s: StaffCtx, id: string): Promise<MgrTeam> {
  needManager(s, "staff");
  const rec = await withDoc(ctx, async (d) => { const r = d.undo[String(id || "")]; if (!r || r.kind !== "tables" || r.by !== s.user.username || !fresh(ctx, r.at)) throw new CoreError("undo_late", MGR_MSG.undo, 409); delete d.undo[r.id]; return r; });
  /* the same lock as core/floor-shift.ts: the shifts are written exactly as they were */
  await serial(ctx.repo, "floor-shift", async () => {
    const now = iso(ctx);
    for (const sh of await openShifts(ctx)) {
      const was = rec.before![sh.user];
      if (!was || JSON.stringify(was) === JSON.stringify(sh.tables)) continue;
      const next: WaiterShift = { ...sh, tables: was, updatedAt: now };
      await ctx.repo.put(COL.shifts, next);
      emit(ctx, "shift.update", { user: next.user, username: next.username, name: next.name, status: next.status, tables: next.tables });
    }
  });
  await audit(ctx, s.user.username, "shift.tables", "undo", { undo: true });
  return managerTeam(ctx, s);
}

/* ---------- the actions of "Сега" ---------- */
async function getOrder(ctx: Ctx, no: string): Promise<Order> {
  const o = await ctx.repo.get<Order>(COL.orders, String(no || ""));
  if (!o) throw new CoreError("not_found", MGR_MSG.noOrder, 404);
  return o;
}
/** the sums of an order without its sold-out lines (the lines stay, marked `out`, so the kitchen's line numbers never move) */
export function sumsWithout(o: Order): Pick<Order, "sub" | "disc" | "total"> & { codeDisc?: number; profileDisc?: number } {
  const keep = o.lines.filter((l) => !l.out), sub = round2(keep.reduce((a, l) => a + (l.unit || 0) * l.q, 0));
  let disc = 0;
  if (o.discKind === "lunch") disc = round2(keep.filter((l) => l.cat === LUNCH_CAT || !!findDish(l.id)?.lunch).reduce((a, l) => a + Math.round(round2((l.unit || 0) * l.q) * Math.round(LUNCH_PICKUP_DISCOUNT * 100)) / 100, 0));
  else if (o.discKind === "code" || o.discKind === "profile") { const p = o.sub ? Math.round((o.disc / o.sub) * 100) : 0; disc = round2((sub * p) / 100); }
  return { sub, disc, total: round2(sub - disc + (o.fee || 0)), ...(o.discKind === "code" ? { codeDisc: disc } : {}), ...(o.discKind === "profile" ? { profileDisc: disc } : {}) };
}
/** "Приеми": straight to "Готви се" (answer 31). An order with a sold-out line is not sent quietly: 409 "has_out" (the screen
    asks "Обади се на клиента" / "Приеми без него"); without: true accepts it without the sold-out dishes (the sums again,
    a note on the order, a line in the log). Returns the order's number and the "Отмени" id. */
export async function managerAccept(ctx: Ctx, s: StaffCtx, no: string, opt: { without?: boolean } = {}): Promise<{ no: string; status: OrderStatus; without: string[]; undo: { id: string; until: number } }> {
  needManager(s, "orders");
  const o0 = await getOrder(ctx, no);
  if (o0.status !== "accepted") throw new CoreError("not_accepted", MGR_MSG.notAccepted, 409);
  const names = [...new Set(o0.lines.filter((l) => l.out).map((l) => l.name || l.id))];
  if (names.length && o0.lines.every((l) => l.out)) throw new CoreError("all_out", MGR_MSG.allOut, 409);
  if (names.length && !(opt && opt.without === true)) throw Object.assign(new CoreError("has_out", MGR_MSG.hasOut(names.join(", ")), 409), { out: names });
  const snap = { sub: o0.sub, disc: o0.disc, total: o0.total, codeDisc: o0.codeDisc, profileDisc: o0.profileDisc, staffNotes: o0.staffNotes, times: o0.times };
  if (names.length) {
    await serial(ctx.repo, "order:" + o0.no, async () => {
      const o = await getOrder(ctx, o0.no);
      if (o.status !== "accepted") throw new CoreError("not_accepted", MGR_MSG.notAccepted, 409);
      Object.assign(o, sumsWithout(o));
      o.staffNotes = [...(o.staffNotes || []), { at: iso(ctx), by: s.user.username, text: MGR_MSG.without(names.join(", ")) }];
      o.updatedAt = iso(ctx);
      await ctx.repo.put(COL.orders, o);
    });
    await audit(ctx, s.user.username, "order.note", o0.no, { text: MGR_MSG.without(names.join(", ")), without: names });
  }
  const o = await setOrderStatus(ctx, o0.no, "cooking", s.user.username, s);
  const id = rid(6), at = iso(ctx);
  await withDoc(ctx, async (d) => { d.undo[id] = { id, kind: "accept", at, by: s.user.username, no: o.no, order: snap }; if (names.length) d.ack["out:" + o.no] = { at, by: s.user.username, name: s.user.name, what: "called" }; });
  say(ctx, "order.accept", { no: o.no, without: names });
  return { no: o.no, status: o.status, without: names, undo: { id, until: Date.parse(at) + MGR_UNDO_MS } };
}
/** "Отмени" after "Приеми": back to "Приета" with its sums and its time of arrival, while the kitchen has not started it */
export async function managerAcceptUndo(ctx: Ctx, s: StaffCtx, id: string): Promise<{ no: string; status: OrderStatus }> {
  needManager(s, "orders");
  const rec = await withDoc(ctx, async (d) => { const r = d.undo[String(id || "")]; if (!r || r.kind !== "accept" || r.by !== s.user.username || !fresh(ctx, r.at)) throw new CoreError("undo_late", MGR_MSG.undo, 409); return r; });
  const o0 = await getOrder(ctx, rec.no!);
  if (o0.status !== "cooking") throw new CoreError("undo_late", MGR_MSG.undo, 409);
  if (o0.lines.some((l) => l.ks === "cook" || l.ks === "ready")) throw new CoreError("started", MGR_MSG.started, 409);
  await setOrderStatus(ctx, o0.no, "accepted", s.user.username, s);
  await serial(ctx.repo, "order:" + o0.no, async () => {
    const o = await getOrder(ctx, o0.no), b = rec.order!;
    o.sub = b.sub; o.disc = b.disc; o.total = b.total; o.times = b.times;
    if (b.codeDisc === undefined) delete o.codeDisc; else o.codeDisc = b.codeDisc;
    if (b.profileDisc === undefined) delete o.profileDisc; else o.profileDisc = b.profileDisc;
    if (b.staffNotes === undefined) delete o.staffNotes; else o.staffNotes = b.staffNotes;
    o.updatedAt = iso(ctx);
    await ctx.repo.put(COL.orders, o);
  });
  await withDoc(ctx, async (d) => { delete d.undo[rec.id]; delete d.ack["out:" + o0.no]; });
  await audit(ctx, s.user.username, "order.note", o0.no, { text: "Отменено: отново „Приета“", undo: true });
  say(ctx, "order.accept", { no: o0.no, undo: true });
  return { no: o0.no, status: "accepted" };
}
/** "Обади се на клиента": the whole number (answer 32), the call goes into the log (order.call) */
export async function managerCallCustomer(ctx: Ctx, s: StaffCtx, no: string): Promise<{ no: string; name: string; phone: string; addr: string; zone: string; channelName: string }> {
  needManager(s, "orders");
  const o = await getOrder(ctx, no);
  await audit(ctx, s.user.username, "order.call", o.no, { phone_view: true });
  return { no: o.no, name: o.name, phone: o.phone, addr: o.addr, zone: o.zone, channelName: chName(o) };
}
const ACK_TEXT = { seen: "видях закъснението", called: "обади се на клиента" };
/** "Видях" (seen: a late table order) / "Готово, обадих се" (called: a late delivery or pickup, a sold-out dish), remembered
    for the shift. key: "late:<№>" | "out:<№>". Log: order.note (seen) / order.call (called). */
export async function managerAck(ctx: Ctx, s: StaffCtx, key: string, what: "seen" | "called"): Promise<MgrNow> {
  needManager(s, "orders");
  const m = /^(late|out):(\d{1,9})$/.exec(String(key || ""));
  if (!m) throw new CoreError("not_found", MGR_MSG.key, 404);
  if (what !== "seen" && what !== "called") invalid({ what: MGR_MSG.what }, MGR_MSG.what);
  await getOrder(ctx, m[2]);
  await withDoc(ctx, async (d) => { d.ack[key] = { at: iso(ctx), by: s.user.username, name: s.user.name, what }; });
  await audit(ctx, s.user.username, what === "called" ? "order.call" : "order.note", m[2], { text: "№ " + m[2] + ": " + ACK_TEXT[what], key });
  say(ctx, "ack", { key, what });
  return managerNow(ctx, s);
}
/** "Отмени" after "Видях" / "Готово, обадих се" */
export async function managerAckUndo(ctx: Ctx, s: StaffCtx, key: string): Promise<MgrNow> {
  needManager(s, "orders");
  const had = await withDoc(ctx, async (d) => { const a = d.ack[String(key || "")]; if (!a || a.by !== s.user.username || !fresh(ctx, a.at)) throw new CoreError("undo_late", MGR_MSG.undo, 409); delete d.ack[key]; return a; });
  await audit(ctx, s.user.username, had.what === "called" ? "order.call" : "order.note", String(key).split(":")[1], { text: "Отменено: " + ACK_TEXT[had.what], key, undo: true });
  say(ctx, "ack", { key, undo: true });
  return managerNow(ctx, s);
}
/* calls and QR orders that went to the manager */
async function findCall(ctx: Ctx, id: string): Promise<{ sit: TableSession; idx: number }> {
  for (const sit of await openSessions(ctx)) { const idx = sit.calls.findIndex((c) => c.id === String(id || "")); if (idx > -1) return { sit, idx }; }
  throw new CoreError("not_found", MGR_MSG.call, 404);
}
/** "Отивам": the manager takes the call himself (core/floor-staff.ts; the waiter sees it is taken). Log: call.take. */
export async function managerCallGo(ctx: Ctx, s: StaffCtx, id: string): Promise<MgrNow> {
  needManager(s);
  const { sit } = await findCall(ctx, id);
  await fCallTake(ctx, s, id);
  await audit(ctx, s.user.username, "call.take", sit.table, { n: sit.n, call: id, by: s.user.username });
  say(ctx, "call.take", { call: id, table: sit.table, to: s.user.username });
  return managerNow(ctx, s);
}
/** "Възложи на…": the call is given to a waiter on shift (he sees it as his, "taken"). Log: call.take. */
export async function managerCallAssign(ctx: Ctx, s: StaffCtx, id: string, waiter: string): Promise<MgrNow> {
  needManager(s);
  const w = (await openShifts(ctx)).find((x) => x.username === String(waiter || "") || x.user === String(waiter || ""));
  if (!w) invalid({ waiter: MGR_MSG.waiter }, MGR_MSG.waiter);
  const { sit: s0 } = await findCall(ctx, id);
  await serial(ctx.repo, lockKey(s0.table), async () => {
    const { sit, idx } = await findCall(ctx, id), c = sit.calls[idx];
    if (c.done) throw new CoreError("not_found", MGR_MSG.call, 404);
    if (c.taken && c.taken.by !== w!.username) throw new CoreError("taken", MGR_MSG.taken(c.taken.name), 409);
    c.taken = { by: w!.username, name: w!.name, at: iso(ctx) };
    await saveSession(ctx, sit); emitCall(ctx, sit, c); await emitSession(ctx, sit);
  });
  await withDoc(ctx, async (d) => { d.calls[id] = { to: w!.username, name: w!.name, at: iso(ctx), by: s.user.username }; });
  await audit(ctx, s.user.username, "call.take", s0.table, { n: s0.n, call: id, assigned: w!.username });
  say(ctx, "call.assign", { call: id, table: s0.table, n: s0.n, to: w!.username });
  return managerNow(ctx, s);
}
/** "Отмени" after "Отивам" (the floor's own undo) or after "Възложи на…" (the call waits again) */
export async function managerCallUndo(ctx: Ctx, s: StaffCtx, id: string): Promise<MgrNow> {
  needManager(s);
  const { sit: s0, idx: i0 } = await findCall(ctx, id), c0 = s0.calls[i0];
  if (c0.taken && c0.taken.by === s.user.username) await fCallUndo(ctx, s, id);
  else {
    const g = await withDoc(ctx, async (d) => { const x = d.calls[id]; if (!x || x.by !== s.user.username || !fresh(ctx, x.at)) throw new CoreError("undo_late", MGR_MSG.undo, 409); delete d.calls[id]; return x; });
    await serial(ctx.repo, lockKey(s0.table), async () => {
      const { sit, idx } = await findCall(ctx, id), c = sit.calls[idx];
      if (c.done || !c.taken || c.taken.by !== g.to) throw new CoreError("undo_late", MGR_MSG.undo, 409);
      c.taken = null;
      await saveSession(ctx, sit); emitCall(ctx, sit, c); await emitSession(ctx, sit);
    });
  }
  await audit(ctx, s.user.username, "call.take", s0.table, { n: s0.n, call: id, undo: true });
  say(ctx, "call.take", { call: id, undo: true });
  return managerNow(ctx, s);
}
/** "Потвърди и прати" a QR order that went to the manager (core/floor-staff.ts: the same checks; log floor.qr_confirm) */
export async function managerQrConfirm(ctx: Ctx, s: StaffCtx, table: string | number, grams: Record<string, number> = {}): Promise<{ no: string; now: MgrNow }> {
  needManager(s);
  const r = await fQrConfirm(ctx, s, table, grams);
  await withDoc(ctx, async (d) => { delete d.qr[r.session ? r.session.id : ""]; });
  say(ctx, "qr.confirm", { table: r.table.id, n: r.table.n, no: r.no });
  return { no: r.no, now: await managerNow(ctx, s) };
}
/** "Възложи на…" a QR order: the waiter is told (shift.update {what: "qr.assign"}); the timer is not reset. Log: call.take. */
export async function managerQrAssign(ctx: Ctx, s: StaffCtx, session: string, waiter: string): Promise<MgrNow> {
  needManager(s);
  const w = (await openShifts(ctx)).find((x) => x.username === String(waiter || "") || x.user === String(waiter || ""));
  if (!w) invalid({ waiter: MGR_MSG.waiter }, MGR_MSG.waiter);
  const sit = (await openSessions(ctx)).find((x) => x.id === String(session || "") && !!x.pending);
  if (!sit) throw new CoreError("no_pending", MGR_MSG.qr, 409);
  await withDoc(ctx, async (d) => { d.qr[sit.id] = { to: w!.username, name: w!.name, at: iso(ctx), by: s.user.username }; });
  await audit(ctx, s.user.username, "call.take", sit.table, { n: sit.n, qr: sit.id, assigned: w!.username });
  say(ctx, "qr.assign", { session: sit.id, table: sit.table, n: sit.n, to: w!.username });
  return managerNow(ctx, s);
}
export async function managerQrAssignUndo(ctx: Ctx, s: StaffCtx, session: string): Promise<MgrNow> {
  needManager(s);
  const g = await withDoc(ctx, async (d) => { const x = d.qr[String(session || "")]; if (!x || x.by !== s.user.username || !fresh(ctx, x.at)) throw new CoreError("undo_late", MGR_MSG.undo, 409); delete d.qr[session]; return x; });
  await audit(ctx, s.user.username, "call.take", String(session), { qr: session, undo: true, was: g.to });
  say(ctx, "qr.assign", { session, undo: true });
  return managerNow(ctx, s);
}
/** the driver's question "адрес извън зоните": one of the three answers (core/driver.ts; log driver.answer) */
export async function managerAnswer(ctx: Ctx, s: StaffCtx, ask: string, a: AskAnswer): Promise<{ answer: string; undoUntil: number; now: MgrNow }> {
  needManager(s);
  const r = await dAnswer(ctx, s, ask, a);
  say(ctx, "ask.answer", { ask, answer: a, order: r.order });
  return { answer: ANSWER_LABEL[a], undoUntil: r.undoUntil || 0, now: await managerNow(ctx, s) };
}
export async function managerAnswerUndo(ctx: Ctx, s: StaffCtx, ask: string): Promise<MgrNow> {
  needManager(s);
  await dAnswerUndo(ctx, s, ask);
  say(ctx, "ask.answer", { ask, undo: true });
  return managerNow(ctx, s);
}
/** "Потвърди" a new reservation (core/reservations-admin.ts; log reservation.status); undo: back to "Нова" */
export async function managerResConfirm(ctx: Ctx, s: StaffCtx, id: string, undo = false): Promise<ResRow> {
  needManager(s, "reservations");
  const r = await resSetStatus(ctx, s, id, undo ? "new" : "confirmed");
  say(ctx, "reservation", { id, status: r.status });
  return r;
}
/** a no-show: "Блокирай номера" / "Не блокирай" (no "Отмени", decision 16.11); log block.* */
export async function managerBlock(ctx: Ctx, s: StaffCtx, ref: string, action: "block" | "clear"): Promise<BlockRow> {
  needManager(s, ["reservations", "customers"]);
  const r = await blockDecide(ctx, s, ref, action);
  say(ctx, "block", { status: r.status });
  return r;
}
/** "Натоварено" (the one setting, core/kitchen.ts; log kitchen.busy_on / _off) */
export async function managerBusy(ctx: Ctx, s: StaffCtx, on: boolean): Promise<MgrKitchen> {
  needManager(s);
  await kitchenSetBusy(ctx, s, on);
  say(ctx, "kitchen.busy", { on });
  return kitchenOf(ctx, s);
}
/** "Върни" a sold-out dish (back: false = "Изчерпано днес" again, the "Отмени"); core/kitchen.ts, log menu.back / menu.sold_out */
export async function managerBackIn(ctx: Ctx, s: StaffCtx, dish: string, back = true): Promise<MgrKitchen> {
  needManager(s);
  await kitchenSetOut(ctx, s, dish, !back);
  say(ctx, "soldout", { id: dish, out: !back });
  return kitchenOf(ctx, s);
}

/* ---------- the search of the module ---------- */
export interface MgrSearch {
  q: string;
  tables: Awaited<ReturnType<typeof staffSearch>>["tables"];
  /** orders by № or 3+ digits of the phone (masked); each with ITS OWN sum */
  orders: { no: string; status: OrderStatus; statusLabel: string; channelName: string; placedAt: string; name: string; phone: string; total: number; exact: boolean }[] | null;
  /** today's reservations (masked) */
  reservations: Awaited<ReturnType<typeof staffSearch>>["reservations"];
  /** the people on shift ("Сервитьор 1", "Шофьор 2"; the kitchen's sections) */
  people: { kind: "waiter" | "driver" | "kitchen"; id: string; name: string; tables: number[] }[];
  soldOut: { id: string; name: string }[];
  /** "оборот": ONLY with "Финанси и гориво", else null */
  today: { sum: number; n: number } | null;
}
const lat = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
export async function managerSearch(ctx: Ctx, s: StaffCtx, raw: string): Promise<MgrSearch> {
  needManager(s);
  const q = String(raw || "").slice(0, 80), lq = lat(q);
  const out: MgrSearch = { q, tables: [], orders: may(s, "orders") ? [] : null, reservations: may(s, "reservations") ? [] : null, people: [], soldOut: [], today: null };
  if (!lq) return out;
  const fl = await staffSearch(ctx, s, q);
  out.tables = fl.tables; out.reservations = fl.reservations; out.soldOut = fl.soldOut;
  if (out.orders) {
    const a = await adminSearch(ctx, s, q), all = new Map((await ctx.repo.list<Order>(COL.orders)).map((o) => [o.no, o]));
    out.orders = (a.orders || []).map((h) => { const o = all.get(h.id)!; return { no: o.no, status: o.status, statusLabel: STATUS_LABEL[o.status], channelName: chName(o), placedAt: o.placedAt, name: o.name, phone: h.phone, total: o.total, exact: h.exact }; });
  }
  /* the people on shift: by a word of the name ("сервитьор 2" is the whole name, the number is part of it) */
  const words = lq.split(" ").filter((w) => w.length >= 3 || /^\d+$/.test(w));
  const hit = (name: string) => { const n = lat(name); return words.length > 0 && words.every((w) => n.split(" ").some((p) => (/^\d+$/.test(w) ? p === w : p.startsWith(w)))); };
  const hall = await hallLive(ctx, s);
  for (const w of await openShifts(ctx)) if (hit(w.name)) out.people.push({ kind: "waiter", id: w.username, name: w.name, tables: hall.tables.filter((t) => w.tables.includes(t.id)).map((t) => t.n) });
  try { for (const d of (await driversView(ctx, s)).drivers) if (hit(d.name)) out.people.push({ kind: "driver", id: d.user, name: d.name, tables: [] }); } catch { /* the role has no drivers' view */ }
  const cfg = await kitchenConfig(ctx);
  for (const x of cfg.sections) if (hit(x.n) || hit(x.short)) out.people.push({ kind: "kitchen", id: x.id, name: x.n, tables: [] });
  if (managerMoney(s) && /оборот|oborot/.test(lq)) {
    const day = sofiaYmd(nowDate(ctx)), l = (await ctx.repo.list<Order>(COL.orders)).filter((o) => sofiaYmd(new Date(o.ts || o.createdAt)) === day && o.status !== "cancelled");
    out.today = { sum: round2(l.reduce((a, o) => a + (o.total || 0), 0)), n: l.length };
  }
  return out;
}
