/* The kitchen for the screens (src/modules/kuhnya/*). Server: fetch("/api/kitchen/..."). Demo: the same core in the browser
   with the demo session. The rights are in the core (the section "Кухня"; the main admin, the owner and the manager
   always): 401 "auth", 403 "forbidden". Errors are ApiError (code, message for people, fields), the same in both.

   THE CONTRACT (kitchenApi.*). `sec` is the tablet's section: "topla" | "skara" | "pesht" | "studeni" (from config()) or
   "all" ("Общ изглед", the head chef). Times are epoch ms (`now`, `due`, `arrived` …) with a ready "HH:MM" in Sofia next
   to them (`dueHm` …); the screen ticks: left = Math.floor((due - (Date.now() + offset)) / 1000), offset = now - Date.now()
   at the moment of the answer. Every action is idempotent (`same: true` = nothing changed) and takes `at`: when it was
   made on the tablet (ISO or epoch ms; actions kept offline are sent later with their real time; 422 "bad_at" for a time
   in the future or before the shift day).

   config()                      the sections (id, n, short, icon, cats), the norms (norm, soon, enterBefore, busyMin),
                                 stateText (чака / готви се / готово), undoSec 10, tapGuardMs 800, beatSec 30, missing[]
                                 ("[ЛИПСВА: секции на кухнята]", "[ЛИПСВА: норми за време]")
   setConfig(patch, version?)    the admin later: sections / norms (main admin, owner, manager; 409 conflict)
   queue(sec)                    {now, tickets[] FIFO, later[] ("По-късно": forHm, enterHm, tomorrow), busy, counts {wait, late,
                                 soon, later, out, outAll}, lastDone (only when the queue is empty), missing[]}. A ticket: src
                                 {kind, k, t, text, who}, arrivedHm, dueHm, timer "ok" | "soon" | "late" + left (s), startedHm
                                 ("готви се от"), busyMin ("+20 мин"), isNew + web ("Нова · от сайта"), sched + forHm ("за
                                 20:03"), driverHm ("шофьор 19:50"), note, lines[] {i, q, name, ks, no[], add[{n, out}], note,
                                 weight, out}, others[] ("Други секции": q, name, short, state, out), secs[] {id, short, state}
   start(no, sec, {at})          "Започни": the section's lines "cook", the order "Готви се"
   line(no, i, ready, {sec, at}) a line ready / not ready (i = lines[].i). The last line of the section = "Готово" for it
   done(no, sec, {at})           "Готово" for the section: all its lines ready
   back(no, sec, {lines, at})    "Върни" (pass KAct.changed as lines) and "Върни в опашката"; 409 "served" / "taken" / "closed"
   seen(no, sec)                 "Виж": the ticket is no longer "Нова"
     -> start / line / done / back return KAct {same, changed[], secReady, orderReady, status, notify[] ("waiter" | "driver" |
        "customer"), waiting[] (short names still cooking), msg ("Известихме сервитьора. Още чака: Пещ."), ticket | null
        (null: it left this queue), src}
   doneToday(sec)                {rows[] newest first: doneHm, src, lines[], text "за 19 мин", lateText "навреме" / "с 3 мин
                                 закъснение", onTime, canBack + why; counts {n, onTime}}
   summary()                     "Общ изглед": sections[] {wait, late, soon, oldestMin, out, tablet {online, text}}, totals
                                 {orders, late, soon, out, later, tabletsOnline}, rows[] {src, arrivedHm, dueHm, timer, left, secs[]}, busy
   soldOut(sec)                  groups[] (the section's categories, "Обедно меню", "Добавки" shared: true) with items {id, n,
                                 g, out}; list[] of every sold-out dish {n, secName, atHm, by, mine}; counts {mine, all}; resets
   setOut(id, out, {sec, at})    "Отбележи изчерпано" / "Върни в менюто": {orders, nos[], waiter, manager, who, msg}
   busy()                        {on, at, atHm, by, extra, norm, remind, customer {normal, busy}, zone, log[] of the day}
   setBusy(on, {sec, at})        the one switch for the whole kitchen; the same view + same
   beat(sec, {device})           the tablet's heartbeat, every config().beatSec seconds; {now} = the server's clock
   tablets()                     every section's tablet: {online, lastHm, text "Таблетът работи" / "без връзка от 19:37"}
   search(sec, q)                "Търси": {act[], later[], dish[]}; a row: src, lines[{q, name, hit}], timer, left, enterHm

   Real time (api.on from ./api.ts): "order.new" {no, channel, mode, table, sched, slot, secs[]} (ring, then queue(sec)),
   "order.line" {no, kind: "start" | "line" | "sec_ready" | "back" | "out" | "seen", sec, lines[], notify[], …}, "order.status"
   {no, status, at}, "kitchen.busy" {busy, at, etaMin, etaBusyMin, extra} (public, no names), "menu.soldout" {id, out},
   "stream.lost" / "stream.back". */
import { http, pick, demoTok, ApiError } from "./api.ts";
import type { Core } from "./api-types.ts";
import type {
  StaffCtx, KConfigView, KConfigPatch, KQueue, KAct, KDone, KSummary, KSoldOut, KOutResult, KBusyView, KTablet, KSearch, KOpt, KTicket, KLater, KLineView, KOther, KSecState,
  KSrc, KState, KTimer, KKind, KBusy, KDoneRow, KOutItem, KOutRow, KFound, KSectionDef,
} from "./api-types-kitchen.ts";

export { ApiError };
export type {
  KConfigView, KConfigPatch, KQueue, KAct, KDone, KSummary, KSoldOut, KOutResult, KBusyView, KTablet, KSearch, KOpt, KTicket, KLater, KLineView, KOther, KSecState, KSrc, KState,
  KTimer, KKind, KBusy, KDoneRow, KOutItem, KOutRow, KFound, KSectionDef,
};

/** the demo: the staff session of this browser (401 without it); the rights are checked by the core function */
const g = (c: Core): Promise<StaffCtx> => c.staff.guard(demoTok("staff"));
const q = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const k of Object.keys(o)) { const v = o[k]; if (v != null && v !== "") u.set(k, v); } const s = u.toString(); return s ? "?" + s : ""; };
const e = encodeURIComponent;

export const kitchenApi = {
  config: pick(async (c) => c.kitchen.config(await g(c)), () => http<KConfigView>("GET", "kitchen/config")),
  setConfig: pick(async (c, p: KConfigPatch, version?: number) => c.kitchen.setConfig(await g(c), p, version), (p: KConfigPatch, version?: number) => http<KConfigView>("PUT", "kitchen/config", { ...p, version })),
  queue: pick(async (c, sec: string) => c.kitchen.queue(await g(c), sec), (sec) => http<KQueue>("GET", "kitchen/queue" + q({ sec }))),
  start: pick(async (c, no: string, sec: string, o: KOpt = {}) => c.kitchen.start(await g(c), no, sec, o), (no, sec, o = {}) => http<KAct>("POST", "kitchen/orders/" + e(no) + "/start", { sec, at: o.at })),
  line: pick(async (c, no: string, i: number, ready: boolean, o: KOpt = {}) => c.kitchen.line(await g(c), no, i, ready, o), (no, i, ready, o = {}) => http<KAct>("POST", "kitchen/orders/" + e(no) + "/line", { i, ready, sec: o.sec, at: o.at })),
  done: pick(async (c, no: string, sec: string, o: KOpt = {}) => c.kitchen.done(await g(c), no, sec, o), (no, sec, o = {}) => http<KAct>("POST", "kitchen/orders/" + e(no) + "/done", { sec, at: o.at })),
  back: pick(async (c, no: string, sec: string, o: KOpt & { lines?: number[] } = {}) => c.kitchen.back(await g(c), no, sec, o), (no, sec, o = {}) => http<KAct>("POST", "kitchen/orders/" + e(no) + "/back", { sec, lines: o.lines, at: o.at })),
  seen: pick(async (c, no: string, sec: string) => c.kitchen.seen(await g(c), no, sec), (no, sec) => http<{ ok: true; same: boolean }>("POST", "kitchen/orders/" + e(no) + "/seen", { sec })),
  doneToday: pick(async (c, sec: string) => c.kitchen.doneToday(await g(c), sec), (sec) => http<KDone>("GET", "kitchen/done" + q({ sec }))),
  summary: pick(async (c) => c.kitchen.summary(await g(c)), () => http<KSummary>("GET", "kitchen/summary")),
  soldOut: pick(async (c, sec: string) => c.kitchen.soldOut(await g(c), sec), (sec) => http<KSoldOut>("GET", "kitchen/sold-out" + q({ sec }))),
  setOut: pick(async (c, id: string, out: boolean, o: KOpt = {}) => c.kitchen.setOut(await g(c), id, out, o), (id, out, o = {}) => http<KOutResult>("PUT", "kitchen/sold-out/" + e(id), { out, sec: o.sec, at: o.at })),
  busy: pick(async (c) => c.kitchen.busy(await g(c)), () => http<KBusyView>("GET", "kitchen/busy")),
  setBusy: pick(async (c, on: boolean, o: KOpt = {}) => c.kitchen.setBusy(await g(c), on, o), (on, o = {}) => http<KBusyView & { same: boolean }>("PUT", "kitchen/busy", { on, sec: o.sec, at: o.at })),
  beat: pick(async (c, sec: string, o: { device?: string } = {}) => c.kitchen.beat(await g(c), sec, o), (sec, o = {}) => http<{ ok: true; now: number; counted: boolean }>("POST", "kitchen/beat", { sec, device: o.device })),
  tablets: pick(async (c) => c.kitchen.tablets(await g(c)), () => http<KTablet[]>("GET", "kitchen/tablets")),
  search: pick(async (c, sec: string, text: string) => c.kitchen.search(await g(c), sec, text), (sec, text) => http<KSearch>("GET", "kitchen/search" + q({ sec, q: text }))),
};
