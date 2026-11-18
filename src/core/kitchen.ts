/* The kitchen (stage D; the specification is the approved prototype design/pages-kuhnya: README, _kitchen.js, the screens).
   One core for the server and the demo. Every function takes the signed-in staff member and checks the rights itself:
   the section "Кухня", and the main admin / the owner / the manager may do everything. Every action writes a line in the
   log; the screens hear `order.line`, `order.status`, `kitchen.busy`, `menu.soldout` (and `order.new` from orders.ts).

   - Sections: the kitchen's settings (core/kitchen-base.ts), the conditional map of the prototype by default, marked
     "[ЛИПСВА: секции на кухнята]"; "all" is the head chef's view ("Общ изглед"). Add-ons are never a line: "+ Гъби" under
     the dish.
   - Time: the deadline in the kitchen is the arrival + the norm of the channel (20 min) + the minutes of "Натоварено" the
     order was PLACED under (Order.kBusy: accepted orders keep their deadline). An order for an hour (a pickup slot, "за
     утре", a later delivery by phone) keeps the promised hour: it waits in "По-късно", enters the queue `enterBefore`
     (20) minutes before the hour and its deadline is the hour itself. Everything is computed from timestamps; the
     screen only ticks.
   - The queue (FIFO by the moment of entering) of a section: orders "Приета" / "Готви се" with at least one line of the
     section that is not ready. A section that ticked its last line leaves its queue exactly as with "Готово".
   - "Започни": "Приета" -> "Готви се" through the existing status rules, the section's lines `ks: "cook"`; a line:
     `ks: "ready"` + readyAt; every line of every section ready -> "Готова" (setOrderStatus: times, push, tracking).
     The waiter is told per ready section of a table order, the driver and the customer only when the whole order is
     ready (OPEN-QUESTIONS 20). "Върни": back to the queue while nobody took or served it.
   - Every action is idempotent (it SETS a state, a repeat changes nothing and writes nothing) and takes `at`: the moment
     it was made on the tablet (actions sent after a reconnect keep their real time): not in the future, not before the
     shift day (from 04:00 Sofia).
   - "Изчерпано днес" is the one switch of core/menu.ts (today only, resets at midnight Sofia); the kitchen adds: the
     lines of accepted, unfinished orders with the dish (or the add-on) get `out`, and the result says in how many orders
     and who is told (the waiter for a table, the manager for delivery and pickup, OPEN-QUESTIONS 19).
   - "Натоварено" is the one setting (core/settings.ts: busy, busyAt, busyBy) + the day's log; any section may switch it.
   - Tablets: a heartbeat per section (module_state) for "Таблетът работи" / "без връзка от 19:37". */
import { audit } from "./audit.ts";
import { COL, emit, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, type Channel, type Iso, type Order, type OrderLine, type OrderStatus } from "./types.ts";
import { DEFAULT_ROLES, type StaffCtx } from "./staff.ts";
import { may, isBoss, invalid, serial, RIGHTS_MSG } from "./rights.ts";
import { getOrder, setOrderStatus, orderDay, lunchOk } from "./orders.ts";
import { getSettings, updateSettings } from "./settings.ts";
import { setSoldOut, soldOutToday, soldOutMeta, outNow } from "./menu.ts";
import { liveHall } from "./hall.ts";
import { liveZones } from "./zones.ts";
import { kitchenConfig, secOfCat, secOfLine, hasSec, isAddonCat, busyLog, K_ALL, K_MISSING, LUNCH_CAT, DEFAULT_KITCHEN, type KitchenConfig, type KSectionDef } from "./kitchen-base.ts";
import { byId, cats, items, lunch, findDish, ORDER_RULES, type Dish } from "../lib/data.ts";
import { eta } from "../lib/status.ts";
import { sofiaYmd, sofiaNow, sofiaEpoch } from "../lib/time.ts";
import { SHIFT_DAY_FROM, shiftDay } from "../lib/shift-day.ts";
import { searchDishes, latin } from "../lib/search.ts";

export { K_ALL, K_MISSING, DEFAULT_KITCHEN, type KitchenConfig, type KSectionDef };

/* ---------- constants and texts (the same on the server and in the demo) ---------- */
export type KState = "wait" | "cook" | "ready";
export type KTimer = "ok" | "soon" | "late";
export type KKind = "table" | "delivery" | "pickup";
export const KS_TEXT: Record<KState, string> = { wait: "чака", cook: "готви се", ready: "готово" };
/** a tablet counts as working this long after its last heartbeat (the screen beats every KITCHEN_BEAT_SEC) */
export const TABLET_ALIVE_SEC = 90, KITCHEN_BEAT_SEC = 30;
/** "Върни" on the screen (README: 10 s), the second tap on a line the screen ignores (0,8 s) */
export const KITCHEN_UNDO_SEC = 10, KITCHEN_TAP_GUARD_MS = 800;
/** the reminder that "Натоварено" is still on (OPEN-QUESTIONS 15: with a reminder after 60 min) */
export const BUSY_REMIND_MIN = 60;
/** the shift day starts at 04:00 Sofia: an action made at 23:58 and sent at 00:02 still counts (one rule for the whole
    restaurant: src/lib/shift-day.ts) */
export { SHIFT_DAY_FROM };
/** the tablet's clock may run this far ahead of the server */
export const AT_SKEW_MS = 60_000;
export const HEAD_CHEF = "Главен готвач", ALL_NAME = "Общ изглед";

export const K_MSG = {
  notFound: "Няма такава поръчка.",
  sec: "Няма такава секция.",
  line: "Няма такъв ред в поръчката.",
  lineSec: "Този ред е на друга секция.",
  atBad: "Часът на действието е невалиден.",
  atFuture: "Часовникът на таблета е напред. Провери го и опитай пак.",
  atOld: "Действието е от предишен ден и не се записва.",
  served: "Ястието вече е сервирано и не може да се върне в опашката.",
  taken: "Шофьорът вече взе поръчката и тя не може да се върне в опашката.",
  dish: "Няма такова ястие в менюто.",
  conflict: "Някой друг промени настройките на кухнята. Зареди ги пак.",
  changed: "Друг таблет промени поръчката. Виж я отново на екрана.",
  boss: RIGHTS_MSG.boss,
};
const CLOSED_WORD: Partial<Record<OrderStatus, string>> = { ready: "готова", on_way: "на път", delivered: "доставена", picked_up: "взета", cancelled: "отказана" };
const closedWord = (o: Order) => (o.status === "picked_up" && kindOf(o) === "table" ? "сервирана" : CLOSED_WORD[o.status] || "приключена");
/** an action on an order that left the kitchen: 409 "closed" */
const closedErr = (o: Order, back = false) => new CoreError("closed", "Поръчката вече е " + closedWord(o) + (back ? " и не може да се върне в опашката." : ". Опресни опашката."), 409);

/* ---------- rights ---------- */
/** the section "Кухня"; the main admin, the owner and the manager always (401 without a session, 403 otherwise) */
function kNeed(s: StaffCtx | null | undefined): StaffCtx {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (!(isBoss(s) || may(s, "kitchen"))) throw new CoreError("forbidden", RIGHTS_MSG.forbidden, 403);
  return s;
}
/** the name shown for who did it: "Кухня · Скара", "Главен готвач", or the role of a boss ("Управител") */
export function kitchenWho(s: StaffCtx, cfg: KitchenConfig, sec?: string | null): string {
  if (s.user.role !== "kitchen") return DEFAULT_ROLES.find((r) => r.id === s.user.role)?.n || s.user.name || s.user.username;
  if (sec === K_ALL) return HEAD_CHEF;
  const d = cfg.sections.find((x) => x.id === sec);
  return d ? "Кухня · " + d.short : "Кухня";
}
function viewOf(cfg: KitchenConfig, sec: unknown): string {
  if (sec === K_ALL || hasSec(cfg, sec)) return sec as string;
  throw Object.assign(new CoreError("bad_sec", K_MSG.sec, 422), { fields: { sec: K_MSG.sec } });
}

/* ---------- time ---------- */
const p2 = (n: number) => String(n).padStart(2, "0");
/** "19:42" in Sofia */
export const hm = (ms: number): string => { const c = sofiaNow(new Date(ms)); return p2(c.h) + ":" + p2(c.m); };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
/** the start of the shift day of `now` (epoch ms): the latest 04:00 Sofia */
export function shiftStart(now: Date): number {
  return sofiaEpoch(shiftDay(now), SHIFT_DAY_FROM);
}
/** The moment an action was made on the tablet: now without `at`; an ISO time or epoch ms otherwise. 422 "bad_at" for a
    time in the future (more than a minute: the tablet's clock) or before the shift day. */
export function actionAt(ctx: Ctx, at?: unknown): Date {
  const now = nowDate(ctx);
  if (at == null || at === "") return now;
  const t = typeof at === "number" ? at : Date.parse(String(at));
  const bad = (m: string) => Object.assign(new CoreError("bad_at", m, 422), { fields: { at: m } });
  if (!Number.isFinite(t)) throw bad(K_MSG.atBad);
  if (t > now.getTime() + AT_SKEW_MS) throw bad(K_MSG.atFuture);
  if (t < shiftStart(now)) throw bad(K_MSG.atOld);
  return new Date(Math.min(t, now.getTime()));
}

export function kindOf(o: Pick<Order, "mode" | "channel" | "table">): KKind {
  return o.table || o.channel === "qr" || o.channel === "waiter" ? "table" : o.mode === "delivery" ? "delivery" : "pickup";
}
/** the hour promised to the customer (epoch ms), null = as soon as possible */
export function promisedAt(o: Pick<Order, "sched" | "slot" | "at" | "createdAt">): number | null {
  const slot = o.sched ? String(o.slot || o.at || "") : o.slot && o.slot !== "asap" ? String(o.slot) : "";
  if (!HHMM.test(slot)) return null;
  const day = o.sched ? orderDay(o) : sofiaYmd(new Date(o.createdAt));
  return sofiaEpoch(day, +slot.slice(0, 2) * 60 + +slot.slice(3));
}
export interface KTiming { arrived: number; forAt: number | null; enter: number; due: number; /** the place in the FIFO */ key: number; busyMin: number; sched: boolean }
/** When the order arrived, when it enters the queue and its deadline in the kitchen (epoch ms). */
export function timingOf(o: Order, cfg: KitchenConfig): KTiming {
  const arrived = Date.parse((o.times && o.times.accepted) || o.createdAt);
  const forAt = promisedAt(o);
  if (forAt != null) { const enter = Math.max(arrived, forAt - cfg.enterBefore * 60_000); return { arrived, forAt, enter, due: forAt, key: enter, busyMin: 0, sched: true }; }
  const busyMin = Math.max(0, +(o.kBusy || 0) || 0);
  return { arrived, forAt: null, enter: arrived, due: arrived + (cfg.norm[kindOf(o)] + busyMin) * 60_000, key: arrived, busyMin, sched: false };
}
export function timerOf(due: number, now: number, cfg: KitchenConfig): { timer: KTimer; left: number } {
  const left = Math.floor((due - now) / 1000);
  return { timer: left < 0 ? "late" : left <= cfg.soon * 60 ? "soon" : "ok", left };
}

/* ---------- views: the shapes the screens get ---------- */
export interface KSrc { kind: KKind;
  /** the small line: "Салон" / "Градина", "Доставка", "Вземане в 20:05" (a pickup for an hour: "Вземане", the tag says "за 20:03") */
  k: string;
  /** the big line: "Маса 12" / "№ 1042" */
  t: string;
  /** "Маса 12" / "Доставка № 1042" / "Вземане № 1043" */
  text: string;
  /** whom "Готово" tells: "сервитьора" / "шофьора" / "клиента" */
  who: string; zone: string; table: string | null; tableNo: number | null }
export interface KLineView { /** the index in the order's lines: the key of every line action */ i: number; id: string; q: number; name: string; sec: string; ks: KState; readyAt: Iso | null;
  /** "без …" (without the word "без"), the add-ons ("+ …") with "изчерпано днес", the line's note, the weight of a per-100-g steak */
  no: string[]; add: { n: string; out: boolean }[]; note: string; grams: number | null; weight: string;
  /** the dish is "Изчерпано днес" (marked after the order was accepted) */
  out: boolean }
export interface KSecState { id: string; short: string; n: string; state: KState }
export interface KOther { i: number; q: number; name: string; sec: string; short: string; state: KState; out: boolean }
export interface KTicket {
  no: string; kind: KKind; src: KSrc; channel: Channel; status: OrderStatus;
  /** epoch ms + "HH:MM" in Sofia */
  arrived: number; arrivedHm: string; due: number; dueHm: string; key: number;
  /** an order for an hour: the hour ("за 20:03"), when it entered / enters the queue; tomorrow: the hour is on a later day */
  sched: boolean; forAt: number | null; forHm: string; enter: number; enterHm: string; tomorrow: boolean;
  /** at `now` of the view (the screen ticks): seconds to the deadline (negative: late by that much) */
  timer: KTimer; left: number;
  /** "готви се от 19:22" (this view's lines), "+20 мин" (placed under "Натоварено"), "Нова" / "Нова · от сайта" */
  startedAt: number | null; startedHm: string; busyMin: number; isNew: boolean; web: boolean;
  /** delivery: "шофьор 19:50" (= the kitchen's deadline: the driver leaves after it); pickup: "Вземане в 20:05"; what the customer was told */
  driverHm: string; pickupHm: string; customerAt: string;
  note: string; lines: KLineView[]; others: KOther[]; secs: KSecState[];
}
export interface KLater { no: string; kind: KKind; src: KSrc; forAt: number; forHm: string; enter: number; enterHm: string; tomorrow: boolean; lines: KLineView[] }
export interface KBusy { on: boolean; at: Iso | null; atHm: string; by: string | null; /** the minutes "Натоварено" adds */ extra: number;
  /** on for BUSY_REMIND_MIN or more: the queue and "Общ изглед" remind too (OPEN-QUESTIONS 34) */ remind: boolean }
export interface KConfigView {
  sections: KSectionDef[]; all: { id: string; n: string; who: string; icon: string }; lunch: string; other: string;
  norm: KitchenConfig["norm"]; soon: number; enterBefore: number; busyMin: number; delivery: { etaMin: number; etaBusyMin: number };
  stateText: Record<KState, string>; undoSec: number; tapGuardMs: number; beatSec: number;
  version: number; at: Iso | null; by: string | null; canEdit: boolean;
  /** what is still the conditional default of the prototype: "[ЛИПСВА: секции на кухнята]", "[ЛИПСВА: норми за време]" */
  missing: string[];
}
export interface KQueue { sec: string; now: number; tickets: KTicket[]; later: KLater[]; busy: KBusy;
  counts: { wait: number; late: number; soon: number; later: number; out: number; outAll: number }; lastDone: { text: string; hm: string } | null; missing: string[] }
export interface KAct {
  ok: true; /** nothing changed (a repeat) */ same: boolean; no: string; sec: string; status: OrderStatus;
  /** the lines this call changed (pass them to back() for an exact "Върни") */ changed: number[];
  /** the section of the action has no line left to cook; every line of every section is ready */
  secReady: boolean; orderReady: boolean;
  /** who was told, the sections still cooking (short names), the sentence for the notice */
  notify: ("waiter" | "driver" | "customer")[]; waiting: string[]; msg: string;
  /** the ticket of this view after the action; null when it left the view's queue */
  ticket: KTicket | null; src: KSrc;
}
export interface KDoneRow { no: string; kind: KKind; src: KSrc; doneAt: number; doneHm: string; lines: KLineView[];
  /** "за 19 мин" and "навреме" / "с 3 мин закъснение" */
  tookMin: number; lateMin: number; onTime: boolean; text: string; lateText: string;
  /** "Върни в опашката" is still possible (nobody took or served it); why not */
  canBack: boolean; why: string }
export interface KDone { sec: string; now: number; rows: KDoneRow[]; counts: { n: number; onTime: number } }
export interface KTablet { sec: string; n: string; online: boolean; lastAt: Iso | null; lastHm: string; /** "Таблетът работи" / "без връзка от 19:37" / "Няма таблет днес" */ text: string }
export interface KSummary {
  now: number; busy: KBusy;
  sections: { id: string; n: string; short: string; icon: string; wait: number; late: number; soon: number; /** minutes the oldest waits; null: nothing waits */ oldestMin: number | null; out: number; tablet: KTablet }[];
  totals: { orders: number; late: number; soon: number; out: number; later: number; tabletsOnline: number };
  rows: { no: string; kind: KKind; src: KSrc; arrived: number; arrivedHm: string; due: number; dueHm: string; sched: boolean; forHm: string; timer: KTimer; left: number; secs: KSecState[] }[];
  missing: string[];
}
export interface KOutItem { id: string; n: string; g: string; out: boolean }
export interface KOutRow { id: string; n: string; /** the dish's section, or "shared" for an add-on */ sec: string; secName: string; at: Iso | null; atHm: string;
  /** who marked it ("Кухня · Скара", "Управител"); null: sold out in the menu data */ by: string | null; mine: boolean;
  /** sold out in the menu's data (the admin), not by today's switch: it does NOT come back by itself at midnight */ menu: boolean }
export interface KSoldOut { sec: string; groups: { cat: string; n: string; note: string; shared: boolean; sec: string; items: KOutItem[] }[]; list: KOutRow[];
  counts: { mine: number; all: number }; /** one source: today only, back by itself at midnight (Sofia) */ resets: string; missing: string[] }
export interface KOutResult { ok: true; same: boolean; id: string; n: string; out: boolean;
  /** accepted, unfinished orders with the dish: how many, which, who is told */
  orders: number; nos: string[]; waiter: boolean; manager: boolean; who: string; msg: string }
export interface KBusyView extends KBusy {
  norm: KitchenConfig["norm"]; remindAfterMin: number;
  /** what the customer sees for delivery: "около 35 мин" / "Възможни са закъснения · около 55 мин" */
  customer: { normal: string; busy: string; etaMin: number; etaBusyMin: number };
  /** the restaurant's own quarter as the example "по квартал": Дружба 2: 25 -> 45 */
  zone: { n: string; etaMin: number; busyMin: number } | null;
  log: { on: Iso; onHm: string; off: Iso | null; offHm: string; by: string; offBy: string }[]; missing: string[];
}
export interface KFound { no: string; kind: KKind; src: KSrc; lines: { q: number; name: string; hit: boolean }[]; later: boolean; timer: KTimer | ""; left: number; due: number; dueHm: string; enterHm: string; tomorrow: boolean }
export interface KSearch { q: string; sec: string; now: number; act: KFound[]; later: KFound[]; dish: string[] }
export interface KOpt { /** the section (or "all") of the tablet */ sec?: string; /** when it was done on the tablet (ISO or epoch ms) */ at?: string | number;
  /** what the tablet saw when the action was made: the state of each line it acts on (index -> state). With it the action is
      written only while those lines are still so (or already where the action leads): 409 "conflict" otherwise */
  saw?: Record<string, KState> }

/* ---------- the world of one call ---------- */
interface World { ctx: Ctx; cfg: KitchenConfig; now: number; today: string; tables: Map<string, { n: number; zone: string }>; out: Set<string>; addon: Map<string, string>; seen: Record<string, string[]> }
interface SeenDoc { id: "kitchen:seen"; day: string; map: Record<string, string[]>; updatedAt?: Iso }
const low = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
async function seenMap(ctx: Ctx): Promise<SeenDoc> {
  const day = sofiaYmd(new Date(shiftStart(nowDate(ctx))));
  const d = await ctx.repo.get<SeenDoc>(COL.modState, "kitchen:seen");
  return d && d.day === day ? d : { id: "kitchen:seen", day, map: {} };
}
async function world(ctx: Ctx): Promise<World> {
  const now = nowDate(ctx), [cfg, hall, sold, seen] = await Promise.all([kitchenConfig(ctx), liveHall(ctx), soldOutToday(ctx), seenMap(ctx)]);
  const out = new Set<string>(), addon = new Map<string, string>();
  for (const x of [...items, ...lunch]) { if (outNow(x, sold)) out.add(x.id); if (isAddonCat(x.cat)) addon.set(low(x.n), x.id); }
  return { ctx, cfg, now: now.getTime(), today: sofiaYmd(now), tables: new Map(hall.tables.map((t) => [t.id, { n: t.n, zone: t.zone === "garden" ? "Градина" : "Салон" }])), out, addon, seen: seen.map };
}
const secDef = (cfg: KitchenConfig, id: string) => cfg.sections.find((s) => s.id === id)!;
const missingOf = (cfg: KitchenConfig): string[] => [cfg.confirmed.sections ? "" : K_MISSING.sections, cfg.confirmed.norms ? "" : K_MISSING.norms].filter(Boolean);
const ksOf = (l: OrderLine): KState => (l.ks === "cook" || l.ks === "ready" ? l.ks : "wait");
const idxOf = (cfg: KitchenConfig, o: Order, view: string): number[] => o.lines.map((_, i) => i).filter((i) => view === K_ALL || secOfLine(cfg, o.lines[i]) === view);
/** one state of a section in an order, the same everywhere: чака / готви се / готово (null: no line of it) */
export function secState(cfg: KitchenConfig, o: Order, sec: string): KState | null {
  const ls = o.lines.filter((l) => secOfLine(cfg, l) === sec);
  if (!ls.length) return null;
  if (ls.every((l) => ksOf(l) === "ready")) return "ready";
  return ls.some((l) => ksOf(l) !== "wait") ? "cook" : "wait";
}
const secStates = (cfg: KitchenConfig, o: Order): KSecState[] =>
  cfg.sections.map((s) => ({ id: s.id, short: s.short, n: s.n, state: secState(cfg, o, s.id) })).filter((x): x is KSecState => x.state != null);
const OPEN: OrderStatus[] = ["accepted", "cooking"];
/** in the active queue of a view now: "Приета" / "Готви се", entered (or already started), a line of the view not ready */
function inQueue(w: World, o: Order, view: string, t: KTiming): boolean {
  return OPEN.includes(o.status) && (t.enter <= w.now || o.status === "cooking") && idxOf(w.cfg, o, view).some((i) => ksOf(o.lines[i]) !== "ready");
}
function inLater(w: World, o: Order, view: string, t: KTiming): boolean {
  return o.status === "accepted" && t.forAt != null && t.enter > w.now && idxOf(w.cfg, o, view).length > 0;
}

function srcOf(w: World, o: Order, t: KTiming): KSrc {
  const kind = kindOf(o);
  if (kind === "table") {
    const tb = o.table ? w.tables.get(o.table) : undefined, name = "Маса " + (tb ? tb.n : o.table || "");
    return { kind, k: tb ? tb.zone : "Салон", t: name.trim(), text: name.trim(), who: "сервитьора", zone: tb ? tb.zone : "", table: o.table || null, tableNo: tb ? tb.n : null };
  }
  if (kind === "delivery") return { kind, k: "Доставка", t: "№ " + o.no, text: "Доставка № " + o.no, who: "шофьора", zone: o.zone || "", table: null, tableNo: null };
  return { kind, k: "Вземане" + (t.sched ? "" : " в " + hm(t.due)), t: "№ " + o.no, text: "Вземане № " + o.no, who: "клиента", zone: "", table: null, tableNo: null };
}
/** is the food of this order made today (an order "за утре" is not touched by today's "Изчерпано днес") */
const forToday = (w: World, t: KTiming): boolean => t.forAt == null || sofiaYmd(new Date(t.forAt)) <= w.today;
function lineView(w: World, o: Order, i: number, t: KTiming): KLineView {
  const l = o.lines[i], x = findDish(l.id), ks = ksOf(l), live = ks !== "ready" && forToday(w, t);
  /* "Изчерпано днес" on a line: a waiting line follows the switch; a line already being cooked keeps what it had when it
     was started (a pizza in the oven is made and served, decision of the chief 18.11) */
  const outNowFor = (id: string | undefined): boolean => live && !!id && (ks === "wait" ? w.out.has(id) : !!l.out);
  const no: string[] = [], add: KLineView["add"] = [], extra: string[] = [];
  for (const m of l.mods || []) {
    if (m.startsWith("+")) { const n = m.slice(1).trim(), id = w.addon.get(low(n)); add.push({ n, out: outNowFor(id) }); }
    else if (/^без\s/i.test(m)) no.push(m.replace(/^без\s+/i, "").trim());
    else if (m.trim()) extra.push(m.trim()); /* any other wish on the line reads as a note */
  }
  const grams = typeof l.grams === "number" && l.grams > 0 ? l.grams : null;
  return { i, id: l.id, q: l.q, name: l.name || (x ? x.n : l.id), sec: secOfLine(w.cfg, l), ks, readyAt: l.readyAt || null, no, add, note: [l.note || "", ...extra].filter(Boolean).join(" · "), grams, weight: grams ? grams + " гр." : "", out: outNowFor(l.id) };
}
function ticketOf(w: World, o: Order, view: string, t = timingOf(o, w.cfg)): KTicket {
  const mine = idxOf(w.cfg, o, view), kind = kindOf(o), tm = timerOf(t.due, w.now, w.cfg);
  const started = mine.map((i) => o.lines[i].cookAt).filter((x): x is string => !!x).map((x) => Date.parse(x)).sort((a, b) => a - b)[0] ?? null;
  const fresh = mine.every((i) => ksOf(o.lines[i]) === "wait") && !(w.seen[o.no] || []).includes(view);
  const others: KOther[] = view === K_ALL ? [] : o.lines.map((l, i) => ({ l, i })).filter((x) => !mine.includes(x.i)).map(({ l, i }) => {
    const sec = secOfLine(w.cfg, l), st = ksOf(l) === "ready" ? "ready" : secState(w.cfg, o, sec) === "cook" ? "cook" : "wait";
    const v = lineView(w, o, i, t);
    return { i, q: l.q, name: v.name, sec, short: secDef(w.cfg, sec).short, state: st as KState, out: v.out };
  });
  return {
    no: o.no, kind, src: srcOf(w, o, t), channel: o.channel, status: o.status,
    arrived: t.arrived, arrivedHm: hm(t.arrived), due: t.due, dueHm: hm(t.due), key: t.key,
    sched: t.sched, forAt: t.forAt, forHm: t.forAt != null ? hm(t.forAt) : "", enter: t.enter, enterHm: hm(t.enter), tomorrow: t.forAt != null && sofiaYmd(new Date(t.forAt)) > w.today,
    timer: tm.timer, left: tm.left, startedAt: started, startedHm: started != null ? hm(started) : "", busyMin: t.busyMin, isNew: fresh, web: o.channel === "web",
    driverHm: kind === "delivery" ? hm(t.due) : "", pickupHm: kind === "pickup" ? hm(t.due) : "", customerAt: o.at || "",
    note: o.note || "", lines: mine.map((i) => lineView(w, o, i, t)), others, secs: secStates(w.cfg, o),
  };
}
const fifo = (a: { key: number; no: string }, b: { key: number; no: string }) => a.key - b.key || +a.no - +b.no;
async function openOrders(ctx: Ctx): Promise<Order[]> {
  const [a, c] = await Promise.all([ctx.repo.list<Order>(COL.orders, { status: "accepted" } as Partial<Order>), ctx.repo.list<Order>(COL.orders, { status: "cooking" } as Partial<Order>)]);
  return [...a, ...c];
}
function busyOf(k: { busy: boolean; busyAt?: string | null; busyBy?: string | null; etaMin: number; etaBusyMin: number }, now: number): KBusy {
  return { remind: !!k.busy && !!k.busyAt && now - Date.parse(k.busyAt) >= BUSY_REMIND_MIN * 60_000, on: !!k.busy, at: k.busy ? k.busyAt || null : null, atHm: k.busy && k.busyAt ? hm(Date.parse(k.busyAt)) : "", by: k.busy ? k.busyBy || null : null, extra: Math.max(0, k.etaBusyMin - k.etaMin) };
}
/** the sold-out dishes now: of a section (its dishes + the shared add-ons) and of the whole kitchen */
function outCounts(w: World, view: string): { mine: number; all: number } {
  let mine = 0, all = 0;
  for (const id of w.out) { const x = byId[id]; if (!x) continue; all++; if (view === K_ALL || isAddonCat(x.cat) || secOfCat(w.cfg, x.cat) === view) mine++; }
  return { mine, all };
}

/* ---------- the settings of the kitchen ---------- */
export async function kitchenConfigView(ctx: Ctx, s: StaffCtx): Promise<KConfigView> {
  kNeed(s);
  const [cfg, st] = await Promise.all([kitchenConfig(ctx), getSettings(ctx)]);
  return {
    sections: cfg.sections, all: { id: K_ALL, n: ALL_NAME, who: HEAD_CHEF, icon: "chef-hat" }, lunch: cfg.lunch, other: cfg.other,
    norm: cfg.norm, soon: cfg.soon, enterBefore: cfg.enterBefore, busyMin: Math.max(0, st.kitchen.etaBusyMin - st.kitchen.etaMin),
    delivery: { etaMin: st.kitchen.etaMin, etaBusyMin: st.kitchen.etaBusyMin }, stateText: KS_TEXT, undoSec: KITCHEN_UNDO_SEC, tapGuardMs: KITCHEN_TAP_GUARD_MS, beatSec: KITCHEN_BEAT_SEC,
    version: cfg.version, at: cfg.at, by: cfg.by, canEdit: isBoss(s) && may(s, ["settings", "kitchen"]), missing: missingOf(cfg),
  };
}
export interface KConfigPatch { sections?: Partial<KSectionDef>[]; lunch?: string; other?: string; norm?: Partial<KitchenConfig["norm"]>; soon?: number; enterBefore?: number }
/** The admin (later): the sections with their categories and the norms. Only the main admin, the owner and the manager,
    with "Настройки" or "Кухня". A saved part is no longer [ЛИПСВА]. 409 "conflict" for an old version. Log: kitchen.config. */
export async function kitchenSetConfig(ctx: Ctx, s: StaffCtx, patch: KConfigPatch, version?: number): Promise<KConfigView> {
  kNeed(s);
  if (!(isBoss(s) && may(s, ["settings", "kitchen"]))) throw new CoreError("forbidden", K_MSG.boss, 403);
  const p = patch && typeof patch === "object" ? patch : {};
  await serial(ctx.repo, "kitchen:config", async () => {
    const cur = await kitchenConfig(ctx);
    if (version != null && version !== cur.version) throw Object.assign(new CoreError("conflict", K_MSG.conflict, 409), { version: cur.version });
    const f: Record<string, string> = {};
    let sections = cur.sections;
    if (p.sections !== undefined) {
      const list = Array.isArray(p.sections) ? p.sections : [];
      if (list.length < 1 || list.length > 8) f.sections = "Секциите са от 1 до 8.";
      const ids = new Set<string>(), seenCats = new Set<string>();
      sections = list.slice(0, 8).map((r, i) => {
        const x = (r && typeof r === "object" ? r : {}) as Partial<KSectionDef>, old = cur.sections.find((c) => c.id === x.id);
        const id = String(x.id || "").trim(), n = String(x.n ?? old?.n ?? "").replace(/\s+/g, " ").trim(), short = String(x.short ?? old?.short ?? n).replace(/\s+/g, " ").trim();
        if (!/^[a-z][a-z0-9-]{1,19}$/.test(id) || id === K_ALL || ids.has(id)) f["sections." + i + ".id"] = "Ключът е с малки латински букви и не се повтаря.";
        ids.add(id);
        if (!n || n.length > 40) f["sections." + i + ".n"] = "Името е до 40 знака.";
        if (!short || short.length > 16) f["sections." + i + ".short"] = "Краткото име е до 16 знака.";
        const cs = [...new Set((Array.isArray(x.cats) ? x.cats : old?.cats || []).map((c) => String(c)))].filter((c) => /^[a-z0-9-]{1,60}$/.test(c) && c !== LUNCH_CAT && !isAddonCat(c));
        if (cs.some((c) => seenCats.has(c))) f["sections." + i + ".cats"] = "Една категория е само в една секция.";
        cs.forEach((c) => seenCats.add(c));
        return { id, n, short, icon: /^[a-z0-9-]{1,40}$/.test(String(x.icon ?? old?.icon ?? "")) ? String(x.icon ?? old?.icon) : "cooking-pot", cats: cs };
      });
    }
    const has = (id: unknown) => typeof id === "string" && sections.some((x) => x.id === id);
    const lunchSec = p.lunch === undefined ? cur.lunch : p.lunch, other = p.other === undefined ? cur.other : p.other;
    if (!has(lunchSec)) f.lunch = K_MSG.sec;
    if (!has(other)) f.other = K_MSG.sec;
    const norm = { ...cur.norm, ...(p.norm && typeof p.norm === "object" ? p.norm : {}) };
    for (const k of ["table", "pickup", "delivery"] as const) if (!Number.isInteger(norm[k]) || norm[k] < 5 || norm[k] > 120) f["norm." + k] = "Минутите са цяло число от 5 до 120.";
    const soon = p.soon === undefined ? cur.soon : p.soon, enterBefore = p.enterBefore === undefined ? cur.enterBefore : p.enterBefore;
    if (!Number.isInteger(soon) || soon < 1 || soon > 30 || soon >= Math.min(norm.table, norm.pickup, norm.delivery)) f.soon = "„Наближава“ е цяло число от 1 до 30 и по-малко от срока.";
    if (!Number.isInteger(enterBefore) || enterBefore < 5 || enterBefore > 120) f.enterBefore = "Минутите са цяло число от 5 до 120.";
    if (Object.keys(f).length) invalid(f);
    const at = nowDate(ctx).toISOString();
    const next: KitchenConfig = {
      id: "kitchen", sections, lunch: lunchSec, other, norm: { table: norm.table, pickup: norm.pickup, delivery: norm.delivery }, soon, enterBefore,
      confirmed: { sections: cur.confirmed.sections || p.sections !== undefined || p.lunch !== undefined || p.other !== undefined, norms: cur.confirmed.norms || p.norm !== undefined || p.soon !== undefined || p.enterBefore !== undefined },
      version: cur.version + 1, at, by: s.user.username,
    };
    await ctx.repo.put(COL.settings, next);
    await audit(ctx, s.user.username, "kitchen.config", "kitchen", p);
    emit(ctx, "kitchen.config", { version: next.version });
  });
  return kitchenConfigView(ctx, s);
}

/* ---------- the queue ---------- */
export async function kitchenQueue(ctx: Ctx, s: StaffCtx, sec: string): Promise<KQueue> {
  kNeed(s);
  const w = await world(ctx), view = viewOf(w.cfg, sec);
  const [open, st] = await Promise.all([openOrders(ctx), getSettings(ctx)]);
  const tickets: KTicket[] = [], later: KLater[] = [];
  for (const o of open) {
    const t = timingOf(o, w.cfg);
    if (inQueue(w, o, view, t)) tickets.push(ticketOf(w, o, view, t));
    else if (inLater(w, o, view, t)) later.push({ no: o.no, kind: kindOf(o), src: srcOf(w, o, t), forAt: t.forAt!, forHm: hm(t.forAt!), enter: t.enter, enterHm: hm(t.enter), tomorrow: sofiaYmd(new Date(t.forAt!)) > w.today, lines: idxOf(w.cfg, o, view).map((i) => lineView(w, o, i, t)) });
  }
  tickets.sort(fifo); later.sort((a, b) => a.enter - b.enter || +a.no - +b.no);
  const oc = outCounts(w, view);
  /* "Последна изпълнена: Маса 11 в 19:40" is shown only in the empty queue */
  const last = tickets.length ? undefined : (await doneRows(ctx, w, view))[0];
  return {
    sec: view, now: w.now, tickets, later, busy: busyOf(st.kitchen, w.now),
    counts: { wait: tickets.length, late: tickets.filter((t) => t.timer === "late").length, soon: tickets.filter((t) => t.timer === "soon").length, later: later.length, out: oc.mine, outAll: oc.all },
    lastDone: last ? { text: last.src.text, hm: last.doneHm } : null, missing: missingOf(w.cfg),
  };
}

/* ---------- actions on an order ---------- */
/** one change of an order at a time (the kitchen's tablets, the head chef, the manager) */
const locked = <T>(ctx: Ctx, no: string, fn: (o: Order) => Promise<T>): Promise<T> =>
  serial(ctx.repo, "order:" + no, async () => { const o = await getOrder(ctx, String(no || "")); if (!o) throw new CoreError("not_found", K_MSG.notFound, 404); return fn(o); });
/** the existing status rules, as the kitchen: "Приета" -> "Готви се" -> "Готова" (stepAllowed); the rights were checked by kNeed */
const AS_KITCHEN = (_s: StaffCtx) => ({ user: { role: "kitchen" }, sections: ["kitchen"] });
/** the status follows the lines: something started -> "Готви се"; every line ready -> "Готова" (times, push, tracking) */
async function settle(cx: Ctx, s: StaffCtx, o: Order): Promise<Order> {
  let cur = o;
  if (cur.status === "accepted" && cur.lines.some((l) => ksOf(l) !== "wait")) cur = await setOrderStatus(cx, cur.no, "cooking", s.user.username, AS_KITCHEN(s));
  if (cur.status === "cooking" && cur.lines.length > 0 && cur.lines.every((l) => ksOf(l) === "ready")) cur = await setOrderStatus(cx, cur.no, "ready", s.user.username, AS_KITCHEN(s));
  return cur;
}
const joinAnd = (a: string[]): string => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " и " + a[a.length - 1]);
interface Told { notify: KAct["notify"]; waiting: string[]; msg: string }
/** a section (or the whole order) became ready: who is told and the sentence of the notice (prototype queue.html finish()) */
function toldReady(cfg: KitchenConfig, o: Order): Told {
  const kind = kindOf(o), waiting = secStates(cfg, o).filter((x) => x.state !== "ready").map((x) => x.short);
  if (kind === "table") return { notify: ["waiter"], waiting, msg: "Известихме сервитьора." + (waiting.length ? " Още чака: " + waiting.join(", ") + "." : "") };
  if (waiting.length) return { notify: [], waiting, msg: "Чака още " + waiting.join(", ") + ". " + (kind === "delivery" ? "Шофьорът" : "Клиентът") + " ще бъде известен, когато всичко е готово." };
  return kind === "delivery" ? { notify: ["driver", "customer"], waiting, msg: "Известихме шофьора." } : { notify: ["customer"], waiting, msg: "Известихме клиента." };
}
const NONE: Told = { notify: [], waiting: [], msg: "" };
type LineEvent = "start" | "line" | "sec_ready" | "back" | "out" | "seen";
/** `order.line`: the staff, and the guests of the table's sitting (no personal data in it) */
function emitLine(ctx: Ctx, o: Order, kind: LineEvent, sec: string, at: Date, extra: Record<string, unknown> = {}): void {
  emit(ctx, "order.line", { no: o.no, kind, sec, status: o.status, table: o.table || null, session: o.session || null, at: at.toISOString(), ...extra }, o.session ? { table: o.session } : {});
}
async function actResult(ctx: Ctx, o: Order, view: string, sec: string, changed: number[], told: Told, same: boolean): Promise<KAct> {
  const w = await world(ctx), t = timingOf(o, w.cfg);
  const secs = sec === K_ALL ? w.cfg.sections.map((x) => x.id) : [sec];
  return {
    ok: true, same, no: o.no, sec, status: o.status, changed,
    secReady: secs.every((id) => { const st = secState(w.cfg, o, id); return st == null || st === "ready"; }), orderReady: o.lines.length > 0 && o.lines.every((l) => ksOf(l) === "ready"),
    notify: told.notify, waiting: told.waiting, msg: told.msg, ticket: inQueue(w, o, view, t) ? ticketOf(w, o, view, t) : null, src: srcOf(w, o, t),
  };
}
/** the section of the lines that just became ready is done (and maybe the order): the status, the event, who is told */
async function afterReady(ctx: Ctx, cx: Ctx, s: StaffCtx, o: Order, cfg: KitchenConfig, secs: string[], changed: number[], at: Date): Promise<{ o: Order; told: Told }> {
  const o2 = await settle(cx, s, o);
  const doneSecs = secs.filter((id) => secState(cfg, o2, id) === "ready");
  if (!doneSecs.length) { emitLine(ctx, o2, "line", secs[0], at, { lines: changed, ks: "ready" }); return { o: o2, told: NONE }; }
  const told = toldReady(cfg, o2), orderReady = o2.lines.every((l) => ksOf(l) === "ready");
  for (const id of doneSecs) emitLine(ctx, o2, "sec_ready", id, at, { lines: changed.filter((i) => secOfLine(cfg, o2.lines[i]) === id), ks: "ready", secReady: true, orderReady, notify: told.notify, waiting: told.waiting });
  return { o: o2, told };
}
/** the moment of an action on this order: never before the order itself (a tablet whose clock runs behind) */
const whenFor = (at: Date, o: Order): Date => new Date(Math.max(at.getTime(), Date.parse((o.times && o.times.accepted) || o.createdAt) || 0));
const tooLate = (o: Order): boolean => !["accepted", "cooking", "ready"].includes(o.status);
/** may these lines go back to cooking: nobody took or served them */
function revertError(o: Order, idx: number[]): CoreError | null {
  if (tooLate(o)) return closedErr(o, true);
  if (idx.some((i) => !!o.lines[i].servedAt)) return new CoreError("served", K_MSG.served, 409);
  if (o.status === "ready" && kindOf(o) === "delivery" && o.pickedAt) return new CoreError("taken", K_MSG.taken, 409);
  return null;
}
/** the lines go back to cooking; an order that had become "Готова" returns to "Готви се" */
async function revert(ctx: Ctx, cx: Ctx, s: StaffCtx, o: Order, cfg: KitchenConfig, idx: number[], sec: string, at: Date): Promise<{ o: Order; told: Told }> {
  const err = revertError(o, idx);
  if (err) throw err;
  const kind = kindOf(o), wasReady = o.status === "ready";
  const secsBefore = [...new Set(idx.map((i) => secOfLine(cfg, o.lines[i])))].filter((id) => secState(cfg, o, id) === "ready");
  for (const i of idx) { const l = o.lines[i]; setKs(l, l.cookAt ? "cook" : "wait", at); delete l.readyAt; }
  o.updatedAt = at.toISOString();
  await cx.repo.put(COL.orders, o);
  let cur = o;
  if (wasReady) cur = await setOrderStatus(cx, o.no, "cooking", s.user.username);
  /* who learns that it is not ready after all: the waiter if a section of a table had been announced; the driver and the customer if the whole order had */
  const notify: KAct["notify"] = kind === "table" ? (secsBefore.length ? ["waiter"] : []) : wasReady ? (kind === "delivery" ? ["driver", "customer"] : ["customer"]) : [];
  const told: Told = { notify, waiting: secStates(cfg, cur).filter((x) => x.state !== "ready").map((x) => x.short), msg: notify.length ? "Известихме " + (kind === "table" ? "сервитьора" : kind === "delivery" ? "шофьора" : "клиента") + ", че поръчката още не е готова." : "" };
  emitLine(ctx, cur, "back", sec, at, { lines: idx, ks: "cook", secReady: false, orderReady: false, notify });
  return { o: cur, told };
}

/* ---------- what the tablet saw (decision of the chief 18.11, "проверка 2 на кухнята") ----------
   Every line keeps the moment its state last changed (`ksAt`, written by the kitchen and by "Поръчки" in the admin). An
   action carries `saw` (the state of each line it acts on, as the tablet showed it) and `at`. It is written only if each
   of those lines is still in that state and was not changed after the action was made, or is already where the action
   leads (a repeat, or two tablets doing the same: nothing to say). Otherwise 409 "conflict": "Друг таблет промени
   поръчката." and the tablet loads the new state. Without `saw` (older clients, the API) nothing is checked. */
type KLine = OrderLine & { ksAt?: Iso };
/** the state of the line changes now (the moment is kept for the check above) */
export function setKs(l: OrderLine, ks: KState, at: Date): void { l.ks = ks; (l as KLine).ksAt = at.toISOString(); }
function sawCheck(o: Order, saw: KOpt["saw"], at: Date, reached: (cur: KState) => boolean): void {
  if (!saw || typeof saw !== "object") return;
  for (const k of Object.keys(saw)) {
    const i = +k, l = Number.isInteger(i) ? o.lines[i] : undefined, was = saw[k];
    if (!l || !["wait", "cook", "ready"].includes(was)) continue;
    const cur = ksOf(l), when = Date.parse((l as KLine).ksAt || "") || 0;
    if (reached(cur)) continue;
    if (cur !== was || when > at.getTime()) throw Object.assign(new CoreError("conflict", K_MSG.changed, 409), { fields: { saw: K_MSG.changed } });
  }
}

/** "Започни": the section's waiting lines are being cooked ("готви се от"); "Приета" -> "Готви се". Log: kitchen.start. */
export async function kitchenStart(ctx: Ctx, s: StaffCtx, no: string, sec: string, opt: KOpt = {}): Promise<KAct> {
  kNeed(s);
  const cfg = await kitchenConfig(ctx), view = viewOf(cfg, sec), at0 = actionAt(ctx, opt.at);
  const { o, changed } = await locked(ctx, no, async (o) => {
    sawCheck(o, opt.saw, at0, (cur) => cur !== "wait");
    const idx = idxOf(cfg, o, view).filter((i) => ksOf(o.lines[i]) === "wait");
    if (!idx.length) return { o, changed: idx };
    if (tooLate(o)) throw closedErr(o);
    const at = whenFor(at0, o), cx: Ctx = { ...ctx, now: () => at };
    for (const i of idx) { setKs(o.lines[i], "cook", at); o.lines[i].cookAt = at.toISOString(); }
    o.updatedAt = at.toISOString();
    await ctx.repo.put(COL.orders, o);
    const o2 = await settle(cx, s, o);
    await audit(ctx, s.user.username, "kitchen.start", o.no, { sec: view, lines: idx, at: at.toISOString() });
    emitLine(ctx, o2, "start", view, at, { lines: idx, ks: "cook" });
    return { o: o2, changed: idx };
  });
  return actResult(ctx, o, view, view, changed, NONE, !changed.length);
}

/** A line is ready (ready: true) or not after all (false). `i` is the index in the order's lines; `sec` is required (as
    for start / done / back): a tablet acts only on the lines of its section ("all": every section). The last line of its
    section: the section is done exactly as with "Готово". Log: kitchen.line. */
export async function kitchenLine(ctx: Ctx, s: StaffCtx, no: string, i: number, ready: boolean, opt: KOpt = {}): Promise<KAct> {
  kNeed(s);
  const cfg = await kitchenConfig(ctx), view = viewOf(cfg, opt.sec), at0 = actionAt(ctx, opt.at);
  const k = typeof i === "string" && /^\d+$/.test(i) ? +i : i;
  if (typeof ready !== "boolean") invalid({ ready: "Избери „готово“ или „не е готово“." });
  const r = await locked(ctx, no, async (o) => {
    const l = Number.isInteger(k) ? o.lines[k] : undefined;
    if (!l) throw Object.assign(new CoreError("bad_line", K_MSG.line, 422), { fields: { i: K_MSG.line } });
    const sec = secOfLine(cfg, l);
    if (view !== K_ALL && view !== sec) throw Object.assign(new CoreError("bad_line", K_MSG.lineSec, 422), { fields: { i: K_MSG.lineSec } });
    sawCheck(o, opt.saw, at0, (cur) => (cur === "ready") === ready);
    if ((ksOf(l) === "ready") === ready) return { o, sec, changed: [] as number[], told: NONE };
    if (tooLate(o)) throw closedErr(o, !ready);
    const at = whenFor(at0, o), cx: Ctx = { ...ctx, now: () => at };
    if (!ready) {
      const x = await revert(ctx, cx, s, o, cfg, [k], sec, at);
      await audit(ctx, s.user.username, "kitchen.line", o.no, { i: k, id: l.id, ready: false, sec, at: at.toISOString() });
      return { o: x.o, sec, changed: [k], told: x.told };
    }
    setKs(l, "ready", at); l.readyAt = at.toISOString();
    o.updatedAt = at.toISOString();
    await ctx.repo.put(COL.orders, o);
    const x = await afterReady(ctx, cx, s, o, cfg, [sec], [k], at);
    await audit(ctx, s.user.username, "kitchen.line", o.no, { i: k, id: l.id, ready: true, sec, at: at.toISOString() });
    return { o: x.o, sec, changed: [k], told: x.told };
  });
  return actResult(ctx, r.o, view, r.sec, r.changed, r.told, !r.changed.length);
}

/** "Готово" for the section (or for every section from "Общ изглед"): all its lines are ready. Log: kitchen.done. */
export async function kitchenDone(ctx: Ctx, s: StaffCtx, no: string, sec: string, opt: KOpt = {}): Promise<KAct> {
  kNeed(s);
  const cfg = await kitchenConfig(ctx), view = viewOf(cfg, sec), at0 = actionAt(ctx, opt.at);
  const r = await locked(ctx, no, async (o) => {
    sawCheck(o, opt.saw, at0, (cur) => cur === "ready");
    const mine = idxOf(cfg, o, view), idx = mine.filter((i) => ksOf(o.lines[i]) !== "ready");
    if (!idx.length) return { o, changed: idx, told: NONE };
    if (tooLate(o)) throw closedErr(o);
    const at = whenFor(at0, o), cx: Ctx = { ...ctx, now: () => at };
    for (const i of idx) { setKs(o.lines[i], "ready", at); o.lines[i].readyAt = at.toISOString(); }
    o.updatedAt = at.toISOString();
    await ctx.repo.put(COL.orders, o);
    const x = await afterReady(ctx, cx, s, o, cfg, [...new Set(idx.map((i) => secOfLine(cfg, o.lines[i])))], idx, at);
    await audit(ctx, s.user.username, "kitchen.done", o.no, { sec: view, lines: idx, at: at.toISOString() });
    return { o: x.o, changed: idx, told: x.told };
  });
  return actResult(ctx, r.o, view, view, r.changed, r.told, !r.changed.length);
}

/** "Върни" (10 s after "Готово") and "Върни в опашката" (from "Изпълнени днес"): the lines go back to cooking. `lines`:
    exactly the ones "Готово" changed (KAct.changed); without it every ready line of the section. An order that had become
    "Готова" returns to "Готви се" while nobody took or served it: 409 "served" / "taken" / "closed" otherwise. Log: kitchen.back. */
export async function kitchenBack(ctx: Ctx, s: StaffCtx, no: string, sec: string, opt: KOpt & { lines?: number[] } = {}): Promise<KAct> {
  kNeed(s);
  const cfg = await kitchenConfig(ctx), view = viewOf(cfg, sec), at0 = actionAt(ctx, opt.at);
  const r = await locked(ctx, no, async (o) => {
    sawCheck(o, opt.saw, at0, (cur) => cur !== "ready");
    const mine = idxOf(cfg, o, view), at = whenFor(at0, o), cx: Ctx = { ...ctx, now: () => at };
    let idx = mine;
    if (Array.isArray(opt.lines)) {
      if (opt.lines.some((i) => !Number.isInteger(i) || !o.lines[i])) throw Object.assign(new CoreError("bad_line", K_MSG.line, 422), { fields: { lines: K_MSG.line } });
      if (opt.lines.some((i) => !mine.includes(i))) throw Object.assign(new CoreError("bad_line", K_MSG.lineSec, 422), { fields: { lines: K_MSG.lineSec } });
      idx = [...new Set(opt.lines)];
    }
    idx = idx.filter((i) => ksOf(o.lines[i]) === "ready");
    if (!idx.length) return { o, changed: idx, told: NONE };
    const x = await revert(ctx, cx, s, o, cfg, idx, view, at);
    await audit(ctx, s.user.username, "kitchen.back", o.no, { sec: view, lines: idx, at: at.toISOString() });
    return { o: x.o, changed: idx, told: x.told };
  });
  return actResult(ctx, r.o, view, view, r.changed, r.told, !r.changed.length);
}

/** "Виж": the ticket is no longer "Нова" for this view (also after "Започни" or a ticked line, by itself). No log. */
export async function kitchenSeen(ctx: Ctx, s: StaffCtx, no: string, sec: string): Promise<{ ok: true; same: boolean }> {
  kNeed(s);
  const cfg = await kitchenConfig(ctx), view = viewOf(cfg, sec);
  const o = await getOrder(ctx, String(no || ""));
  if (!o) throw new CoreError("not_found", K_MSG.notFound, 404);
  return serial(ctx.repo, "kitchen:seen", async () => {
    const d = await seenMap(ctx), list = d.map[o.no] || [];
    if (list.includes(view)) return { ok: true as const, same: true };
    d.map[o.no] = [...list, view]; d.updatedAt = nowDate(ctx).toISOString();
    await ctx.repo.put(COL.modState, d);
    emitLine(ctx, o, "seen", view, nowDate(ctx));
    return { ok: true as const, same: false };
  });
}

/* ---------- "Изпълнени днес" ---------- */
async function doneRows(ctx: Ctx, w: World, view: string): Promise<KDoneRow[]> {
  const from = shiftStart(new Date(w.now)), rows: KDoneRow[] = [];
  for (const o of await ctx.repo.list<Order>(COL.orders)) {
    if (o.status === "cancelled") continue;
    const mine = idxOf(w.cfg, o, view);
    if (!mine.length || mine.some((i) => ksOf(o.lines[i]) !== "ready")) continue;
    const doneAt = Math.max(0, ...mine.map((i) => (o.lines[i].readyAt ? Date.parse(o.lines[i].readyAt!) : 0)));
    if (!doneAt || doneAt < from) continue;
    const t = timingOf(o, w.cfg), took = Math.max(0, doneAt - t.key), tookMin = took < 60_000 ? 0 : Math.max(1, Math.round(took / 60_000)), lateMin = Math.max(0, Math.round((doneAt - t.due) / 60_000));
    const err = revertError(o, mine);
    rows.push({ no: o.no, kind: kindOf(o), src: srcOf(w, o, t), doneAt, doneHm: hm(doneAt), lines: mine.map((i) => lineView(w, o, i, t)), tookMin, lateMin, onTime: lateMin === 0,
      text: tookMin ? "за " + tookMin + " мин" : "под 1 мин", lateText: lateMin > 0 ? "с " + lateMin + " мин закъснение" : "навреме", canBack: !err, why: err ? err.message : "" });
  }
  return rows.sort((a, b) => b.doneAt - a.doneAt || +b.no - +a.no);
}
/** The section's finished orders of the shift day, newest first: time, source, its lines, "за 19 мин · навреме". */
export async function kitchenDoneToday(ctx: Ctx, s: StaffCtx, sec: string): Promise<KDone> {
  kNeed(s);
  const w = await world(ctx), view = viewOf(w.cfg, sec), rows = await doneRows(ctx, w, view);
  return { sec: view, now: w.now, rows, counts: { n: rows.length, onTime: rows.filter((r) => r.onTime).length } };
}

/* ---------- tablets ---------- */
interface TabDoc { id: string; sec: string; at: Iso; user: string; device?: string }
const tabId = (sec: string) => "kitchen:tab:" + sec;
/** "Таблетът работи" / "без връзка от 19:37" (seen earlier in this shift day) / "Няма таблет днес" (never, or only on an earlier day) */
function tabletOf(d: TabDoc | null, sec: string, n: string, now: number): KTablet {
  const last = d ? Date.parse(d.at) : 0, online = !!d && now - last <= TABLET_ALIVE_SEC * 1000, today = !!d && last >= shiftStart(new Date(now));
  return { sec, n, online, lastAt: d ? d.at : null, lastHm: d ? hm(last) : "", text: online ? "Таблетът работи" : today ? "без връзка от " + hm(last) : "Няма таблет днес" };
}
/** The heartbeat of the section's tablet (every KITCHEN_BEAT_SEC). Only an account with the role "Кухня" counts as the
    tablet (a manager looking at the screen does not). Returns the server's time so the tablet can correct its timers. */
export async function kitchenBeat(ctx: Ctx, s: StaffCtx, sec: string, opt: { device?: string } = {}): Promise<{ ok: true; now: number; counted: boolean }> {
  kNeed(s);
  const cfg = await kitchenConfig(ctx), view = viewOf(cfg, sec), now = nowDate(ctx);
  if (s.user.role !== "kitchen") return { ok: true, now: now.getTime(), counted: false };
  const prev = await ctx.repo.get<TabDoc>(COL.modState, tabId(view));
  const device = typeof opt.device === "string" ? opt.device.replace(/[^\w-]/g, "").slice(0, 40) : "";
  await ctx.repo.put<TabDoc>(COL.modState, { id: tabId(view), sec: view, at: now.toISOString(), user: s.user.username, ...(device ? { device } : {}) });
  /* back after a gap (or the first time): the manager's screen hears it at once; going silent is seen from lastAt */
  if (!prev || now.getTime() - Date.parse(prev.at) > TABLET_ALIVE_SEC * 1000) emit(ctx, "shift.update", { what: "tablet", sec: view, online: true, at: now.toISOString() });
  return { ok: true, now: now.getTime(), counted: true };
}
async function tabletList(ctx: Ctx, cfg: KitchenConfig, now: number): Promise<KTablet[]> {
  const defs = [...cfg.sections.map((x) => ({ id: x.id, n: x.n })), { id: K_ALL, n: ALL_NAME }];
  return Promise.all(defs.map(async (d) => tabletOf(await ctx.repo.get<TabDoc>(COL.modState, tabId(d.id)), d.id, d.n, now)));
}
/** every section's tablet (+ "Общ изглед"): "Таблетът работи" / "без връзка от 19:37" (the manager's module) */
export async function kitchenTablets(ctx: Ctx, s: StaffCtx): Promise<KTablet[]> {
  kNeed(s);
  return tabletList(ctx, await kitchenConfig(ctx), nowDate(ctx).getTime());
}

/* ---------- "Общ изглед" ---------- */
export async function kitchenSummary(ctx: Ctx, s: StaffCtx): Promise<KSummary> {
  kNeed(s);
  const w = await world(ctx);
  const [open, st, tabs] = await Promise.all([openOrders(ctx), getSettings(ctx), tabletList(ctx, w.cfg, w.now)]);
  const act = open.map((o) => ({ o, t: timingOf(o, w.cfg) })).filter((x) => inQueue(w, x.o, K_ALL, x.t)).sort((a, b) => fifo({ key: a.t.key, no: a.o.no }, { key: b.t.key, no: b.o.no }));
  const sections = w.cfg.sections.map((d) => {
    const mine = act.filter((x) => inQueue(w, x.o, d.id, x.t)), tm = mine.map((x) => timerOf(x.t.due, w.now, w.cfg).timer);
    /* counted as in the section's tab: its dishes + the shared add-ons (review 1, round 2) */
    let out = 0; for (const id of w.out) { const x = byId[id]; if (x && (isAddonCat(x.cat) || secOfCat(w.cfg, x.cat) === d.id)) out++; }
    return { id: d.id, n: d.n, short: d.short, icon: d.icon, wait: mine.length, late: tm.filter((x) => x === "late").length, soon: tm.filter((x) => x === "soon").length,
      oldestMin: mine.length ? Math.max(0, Math.round((w.now - Math.min(...mine.map((x) => x.t.key))) / 60_000)) : null, out, tablet: tabs.find((t) => t.sec === d.id)! };
  });
  const rows = act.map(({ o, t }) => { const tm = timerOf(t.due, w.now, w.cfg); return { no: o.no, kind: kindOf(o), src: srcOf(w, o, t), arrived: t.arrived, arrivedHm: hm(t.arrived), due: t.due, dueHm: hm(t.due), sched: t.sched, forHm: t.forAt != null ? hm(t.forAt) : "", timer: tm.timer, left: tm.left, secs: secStates(w.cfg, o) }; });
  return {
    now: w.now, busy: busyOf(st.kitchen, w.now), sections, rows, missing: missingOf(w.cfg),
    totals: { orders: rows.length, late: rows.filter((r) => r.timer === "late").length, soon: rows.filter((r) => r.timer === "soon").length, out: outCounts(w, K_ALL).all,
      later: open.filter((o) => inLater(w, o, K_ALL, timingOf(o, w.cfg))).length, tabletsOnline: tabs.filter((t) => t.sec !== K_ALL && t.online).length },
  };
}

/* ---------- "Изчерпано днес" ---------- */
/** what really happens at midnight: only today's marks go; a dish sold out in the menu's data stays so (the admin) */
export const SOLD_OUT_RESETS = "В полунощ се връща в менюто всичко, отбелязано днес тук.";
/** The tiles of the section (its categories, the lunch menu in its section, "Добавки · за всички секции") and the list
    of every sold-out dish with who and when. */
export async function kitchenSoldOut(ctx: Ctx, s: StaffCtx, sec: string): Promise<KSoldOut> {
  kNeed(s);
  const w = await world(ctx), view = viewOf(w.cfg, sec);
  const [meta, staff] = await Promise.all([soldOutMeta(ctx), ctx.repo.list<{ id: string; username: string; name: string; role: string }>(COL.staff)]);
  const item = (x: Dish): KOutItem => ({ id: x.id, n: x.n, g: x.g || "", out: w.out.has(x.id) });
  const groups: KSoldOut["groups"] = [];
  for (const d of w.cfg.sections) {
    if (view !== K_ALL && view !== d.id) continue;
    for (const c of cats) if (!isAddonCat(c.id) && secOfCat(w.cfg, c.id) === d.id) groups.push({ cat: c.id, n: c.n, note: "", shared: false, sec: d.id, items: items.filter((x) => x.cat === c.id).map(item) });
    /* the lunch menu only on its day (the same rule as the order check) */
    if (secOfCat(w.cfg, LUNCH_CAT) === d.id && lunch.length && lunchOk(ctx)) groups.push({ cat: LUNCH_CAT, n: "Обедно меню", note: w.cfg.confirmed.sections ? "" : "условно в „" + d.n + "“", shared: false, sec: d.id, items: lunch.map(item) });
  }
  const shared = items.filter((x) => isAddonCat(x.cat));
  if (shared.length) groups.push({ cat: ORDER_RULES.addonCat, n: cats.find((c) => c.id === ORDER_RULES.addonCat)?.n || "Добавки", note: "за всички секции: готвят се с основното ястие", shared: true, sec: "shared", items: shared.map(item) });
  const who = (m: { by: string; as?: string } | undefined): string | null => {
    if (!m) return null;
    if (m.as) return m.as;
    const u = staff.find((x) => x.username === m.by);
    return u ? (u.role === "kitchen" ? "Кухня" : DEFAULT_ROLES.find((r) => r.id === u.role)?.n || u.name) : m.by;
  };
  const list: KOutRow[] = [...w.out].map((id) => {
    const x = byId[id], sh = isAddonCat(x.cat), sc = sh ? "shared" : secOfCat(w.cfg, x.cat), m = meta[id];
    return { id, n: x.n, sec: sc, secName: sh ? "Добавка, всички секции" : secDef(w.cfg, sc).n, at: m ? m.at : null, atHm: m ? hm(Date.parse(m.at)) : "", by: who(m), mine: view === K_ALL || sh || sc === view, menu: !m };
  }).sort((a, b) => Number(b.mine) - Number(a.mine) || (b.at || "").localeCompare(a.at || "") || a.n.localeCompare(b.n, "bg"));
  return { sec: view, groups: groups.filter((g) => g.items.length), list, counts: { mine: list.filter((r) => r.mine).length, all: list.length }, resets: SOLD_OUT_RESETS, missing: missingOf(w.cfg).filter((m) => m === K_MISSING.sections) };
}
/** The dish (or add-on) is "Изчерпано днес" / back in the menu: the one switch of core/menu.ts (site, QR, waiter, the cart
    check) + the lines of accepted, unfinished orders of today with it get `out` (cleared on the way back). The result
    says in how many orders it is and who is told: the waiter (a table), the manager (delivery and pickup). */
export async function kitchenSetOut(ctx: Ctx, s: StaffCtx, dishId: string, out: boolean, opt: KOpt = {}): Promise<KOutResult> {
  kNeed(s);
  const id = String(dishId || "");
  if (!Object.prototype.hasOwnProperty.call(byId, id)) throw new CoreError("not_found", K_MSG.dish, 404);
  if (typeof out !== "boolean") invalid({ out: "Избери „Изчерпано днес“ или „Има“." });
  const cfg = await kitchenConfig(ctx), at = actionAt(ctx, opt.at), cx: Ctx = { ...ctx, now: () => at };
  const view = opt.sec == null || opt.sec === "" ? "" : viewOf(cfg, opt.sec), x = byId[id];
  const same = outNow(x, await soldOutToday(ctx)) === out;
  if (!same) await setSoldOut(cx, id, out, s.user.username, kitchenWho(s, cfg, view));
  /* sold out: the lines the kitchen has NOT started yet (today's "Приета" / "Готви се" orders; a line being cooked or
     ready keeps its dish: it is made, the guest gets it and pays for it, decision of the chief 18.11). Back in the menu:
     the mark goes from every line of today that has it, whatever its state now. */
  const w = await world(ctx), addonName = isAddonCat(x.cat) ? low(x.n) : "";
  const adds = (l: OrderLine): string[] => (l.mods || []).filter((m) => m.startsWith("+")).map((m) => low(m.slice(1)));
  const has = (l: OrderLine) => l.id === id || (!!addonName && adds(l).includes(addonName));
  const from = shiftStart(nowDate(ctx));
  const pool = out ? await openOrders(ctx) : (await ctx.repo.list<Order>(COL.orders)).filter((o) => o.status !== "cancelled" && Date.parse(o.createdAt) >= from && o.lines.some((l) => !!l.out));
  const hits: Order[] = [];
  for (const o0 of pool) {
    if (!forToday(w, timingOf(o0, cfg))) continue;
    const touches = (l: OrderLine) => has(l) && (out ? ksOf(l) === "wait" : !!l.out);
    if (!o0.lines.some(touches)) continue;
    const o = await locked(ctx, o0.no, async (o) => {
      const idx: number[] = [];
      o.lines.forEach((l, i) => {
        if (!touches(l)) return;
        /* still marked while the dish or one of its add-ons is sold out */
        const still = w.out.has(l.id) || adds(l).some((n) => { const a = w.addon.get(n); return !!a && w.out.has(a); });
        if (still === !!l.out) return;
        if (still) l.out = true; else delete l.out;
        idx.push(i);
      });
      if (!idx.length) return o; /* a repeat: already marked, nobody is told twice */
      o.updatedAt = nowDate(ctx).toISOString();
      await ctx.repo.put(COL.orders, o);
      emitLine(ctx, o, "out", view || secOfCat(cfg, x.cat), at, { lines: idx, dish: { id, n: x.n }, out, notify: out ? [kindOf(o) === "table" ? "waiter" : "manager"] : [] });
      return o;
    });
    hits.push(o);
  }
  const waiter = hits.some((o) => kindOf(o) === "table"), manager = hits.some((o) => kindOf(o) !== "table");
  const who = [waiter ? "сервитьора" : "", manager ? "управителя (доставка и вземане)" : ""].filter(Boolean).join(" и ");
  const n = hits.length;
  /* short enough for the notice's one line (review 1, small 9): in how many, whom we told */
  const told = [waiter ? "сервитьора" : "", manager ? "управителя" : ""].filter(Boolean).join(" и ");
  const msg = !out ? "Бутонът „+“ се върна навсякъде." : n ? "В " + n + (n === 1 ? " приета поръчка" : " приети поръчки") + " · известихме " + told + "." : "Сайт, QR и сервитьор: без „+“. Wolt и Foodpanda: скрито.";
  if (n && !same) await audit(ctx, s.user.username, "kitchen.out", id, { out, orders: hits.map((o) => o.no), tell: [waiter ? "waiter" : "", manager ? "manager" : ""].filter(Boolean) });
  return { ok: true, same, id, n: x.n, out, orders: n, nos: hits.map((o) => o.no), waiter: out && waiter, manager: out && manager, who: out ? who : "", msg };
}

/* ---------- "Натоварено" ---------- */
export async function kitchenBusy(ctx: Ctx, s: StaffCtx): Promise<KBusyView> {
  kNeed(s);
  const [cfg, st, log, zones] = await Promise.all([kitchenConfig(ctx), getSettings(ctx), busyLog(ctx), liveZones(ctx)]);
  const now = nowDate(ctx), from = shiftStart(now), b = busyOf(st.kitchen, now.getTime());
  const z = zones.find((r) => r.n === "Дружба 2") || zones[0];
  return {
    ...b, norm: cfg.norm, remindAfterMin: BUSY_REMIND_MIN,
    customer: { normal: eta(undefined, false).text, busy: eta(undefined, true).text, etaMin: st.kitchen.etaMin, etaBusyMin: st.kitchen.etaBusyMin },
    zone: z ? { n: z.n, etaMin: z.etaMin, busyMin: z.etaMin + b.extra } : null,
    log: log.filter((x) => !x.off || Date.parse(x.off) >= from || Date.parse(x.on) >= from).map((x) => ({ on: x.on, onHm: hm(Date.parse(x.on)), off: x.off, offHm: x.off ? hm(Date.parse(x.off)) : "", by: x.by, offBy: x.offBy || "" })),
    missing: missingOf(cfg).filter((m) => m === K_MISSING.norms),
  };
}
/** The one switch for the whole kitchen (any section, the head chef, the manager): +minutes for NEW orders only; the site,
    the admin and the manager's module hear `kitchen.busy` at once. Log: kitchen.busy_on / kitchen.busy_off (settings.ts). */
export async function kitchenSetBusy(ctx: Ctx, s: StaffCtx, on: boolean, opt: KOpt = {}): Promise<KBusyView & { same: boolean }> {
  kNeed(s);
  if (typeof on !== "boolean") invalid({ on: "Избери „включено“ или „изключено“." });
  const cfg = await kitchenConfig(ctx), at = actionAt(ctx, opt.at);
  const view = opt.sec == null || opt.sec === "" ? "" : viewOf(cfg, opt.sec);
  const same = (await getSettings(ctx)).kitchen.busy === on;
  if (!same) await updateSettings({ ...ctx, now: () => at }, { kitchen: { busy: on } }, s.user.username, kitchenWho(s, cfg, view));
  return { ...(await kitchenBusy(ctx, s)), same };
}

/* ---------- "Търси" (design/pages-kuhnya/_find.js; the dish names through the shared search, lib/search.ts) ---------- */
const lat = (s: string): string => latin(String(s || "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const F_KIND: Record<KKind, string[]> = { table: ["маса", "маси", "салон", "градина"], delivery: ["доставка", "доставки", "шофьор"], pickup: ["вземане", "вземания"] };
const F_STATE: Record<"late" | "soon", string[]> = { late: ["закъснява", "закъсняват", "закъснели"], soon: ["наближава", "наближават"] };
const fHit = (w: string, list: string[]): boolean => list.some((x) => { const l = lat(x); return w.length >= 3 && (l.indexOf(w) === 0 || w.indexOf(l.slice(0, Math.max(4, l.length - 1))) === 0); });
/** Only the waiting orders of the section (every section for "all"): number, table, channel, "закъснява" / "наближава",
    dish (also in Latin letters); + "По-късно". The section is checked here, on the server. */
export async function kitchenSearch(ctx: Ctx, s: StaffCtx, sec: string, query: string): Promise<KSearch> {
  kNeed(s);
  const w = await world(ctx), view = viewOf(w.cfg, sec);
  const raw = String(query || "").replace(/\s+/g, " ").trim().slice(0, 80), q = lat(raw);
  const res: KSearch = { q: raw, sec: view, now: w.now, act: [], later: [], dish: [] };
  if (!q) return res;
  const words = q.split(" ").filter(Boolean), nums = raw.match(/\d+/g) || [], txt = words.filter((x) => !/^\d/.test(x));
  const kinds = (Object.keys(F_KIND) as KKind[]).filter((k) => txt.some((x) => fHit(x, F_KIND[k])));
  const states = (Object.keys(F_STATE) as ("late" | "soon")[]).filter((k) => txt.some((x) => fHit(x, F_STATE[k])));
  const rest = txt.filter((x) => !Object.values(F_KIND).some((l) => fHit(x, l)) && !Object.values(F_STATE).some((l) => fHit(x, l)));
  const dishIds = rest.length ? searchDishes([...items, ...lunch], rest.join(" ")).name.map((x) => x.id) : null;
  res.dish = dishIds || [];
  if (!(kinds.length || states.length || nums.length || dishIds)) return res;
  const found = (o: Order, t: KTiming, later: boolean): KFound | null => {
    const kind = kindOf(o), src = srcOf(w, o, t), tm = timerOf(t.due, w.now, w.cfg), mine = idxOf(w.cfg, o, view);
    if (kinds.length && !kinds.includes(kind)) return null;
    if (states.length && (later || !states.includes(tm.timer as "late" | "soon"))) return null;
    const numbers = [o.no, ...(src.tableNo != null ? [String(src.tableNo)] : [])];
    if (nums.length && !nums.every((n) => (kind === "table" ? numbers : [o.no]).some((x) => x.indexOf(n) === 0))) return null;
    if (dishIds && !mine.some((i) => dishIds.includes(o.lines[i].id))) return null;
    return { no: o.no, kind, src, lines: mine.map((i) => ({ q: o.lines[i].q, name: lineView(w, o, i, t).name, hit: !!dishIds && dishIds.includes(o.lines[i].id) })), later,
      timer: later ? "" : tm.timer, left: tm.left, due: t.due, dueHm: hm(t.due), enterHm: hm(t.enter), tomorrow: t.forAt != null && sofiaYmd(new Date(t.forAt)) > w.today };
  };
  const rows = (await openOrders(ctx)).map((o) => ({ o, t: timingOf(o, w.cfg) })).sort((a, b) => fifo({ key: a.t.key, no: a.o.no }, { key: b.t.key, no: b.o.no }));
  for (const { o, t } of rows) {
    const later = !inQueue(w, o, view, t) && inLater(w, o, view, t);
    if (!later && !inQueue(w, o, view, t)) continue;
    const f = found(o, t, later);
    if (f) (later ? res.later : res.act).push(f);
  }
  return res;
}
