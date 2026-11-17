/* The manager's ("Управител") and the owner's ("Собственик") modules for the screens (src/modules/upravitel, sobstvenik).
   Server: fetch("/api/boss/...", "/api/owner/..."). Demo: the same core in the browser with the demo session. The RIGHTS
   ARE IN THE CORE (src/core/shift.ts, owner.ts): the same 401 "auth" / 403 "forbidden" / 404 / 409 / 422 (ApiError: code,
   message for people on "ти", fields) on the server and in the demo. Every action writes a line in the log; the screens
   hear "shift.update" (the manager's actions) and the frame's events (order.*, floor.*, kitchen.busy, driver.course …).

   MONEY: the manager NEVER gets a sum over several orders (`money: false`, `today` / `tablesSum` null) unless the role has
   "Финанси и гориво"; one order's `total`, one table's `sum` and a driver's `cash` are allowed. The owner's module: every
   sum is null without "Финанси и гориво" and finance() answers 403.

   THE CONTRACT. bossApi.* ("Управител": the main admin, the owner, the manager; others 403):
   now()                        MgrNow: date, now "19:42", status, money; pulse {tables {busy, total, salon, garden} ("4 от 20"),
                                inWork (= the admin's tab "В работа"), late {n (= the admin's "Закъснява"), open, seen}, calls,
                                reservations {n, people, until "21:42"}, closed}; problems[] by urgency (Problem: key, kind call |
                                qr | out | ask | late, sev, tone hot | ember | warn | solved, icon, title, meta, since (timer),
                                lateMin, done, actions[], ref); waits {orders[] (WaitOrder: total of the order, out[] names,
                                outAll, fresh), reservations[], blocks[], notes, n}; kitchen (MgrKitchen: open, busy {on, atHm,
                                by, etaMin, etaBusyMin}, sections[] {wait, late, tablet {online, text}}, soldOut[]); fresh[] (web
                                orders still "Приета"); counts {problems, waits, now (the badge, each thing once)}; today
                                {sum, n} | null (finance only); settings {callManager, qrManager}
   hall()                       MgrHall ("Залата"; hall | reservations): tiles[] (state call | bill | qr | ready | wait | busy |
                                res | free, label, since, waiter, walkin, next), tonight[] (TonightRes: lateMin only when the
                                table is not occupied, canConfirm), waitlist[], legend, canWalkin, tablesSum (finance only)
   table(ref)                   MgrTable: the sheet of a table (waiter, waiters on shift, occupiedSince, orders, sum of the
                                table, calls, next (future only), walkin)
   setWaiter(ref, username)     who serves the table -> MgrTable           walkin(ref, allow)   "Блокирай за гости без резервация" (hall)
   team()                       MgrTeam ("Екипът"; staff): waiters[] (tables, calls, qr, late, avgSec | null), unassigned[],
                                tables[] (owner), kitchen, drivers[] (status, course, cash, cashWhen "end" | "now", car.missing),
                                driversWaiting, asks[], problems[], shiftOver
   setTables(who, tables, to?)  "Смени масите" (at least one; 422 fields.tables) -> {team, undo {id, until}}
   setTablesUndo(id)            "Отмени": every waiter's tables exactly as before -> MgrTeam (409 undo_late)
   search(q)                    MgrSearch: tables, orders (№ / 3+ digits; masked phone; ONE order's total), reservations,
                                people (waiters, drivers, kitchen sections), soldOut, today ("оборот", finance only)
   accept(no, {without?})       "Приеми" -> "Готви се" (answer 31) -> {no, status, without[], undo {id, until}}. 409 has_out
                                (error.out = the names: ask "Обади се на клиента" / "Приеми без него"), all_out, not_accepted
   acceptUndo(id)               "Отмени": back to "Приета" with its sums (409 undo_late / started)
   callCustomer(no)             "Обади се на клиента": the WHOLE number (answer 32), logged order.call -> {no, name, phone, addr, zone}
   ack(key, "seen" | "called")  "Видях" / "Готово, обадих се" (key "late:<№>" | "out:<№>"), for the shift -> MgrNow
   ackUndo(key)                 -> MgrNow
   callGo(id) / callAssign(id, waiter) / callUndo(id)       a call over the manager's minutes: "Отивам" / "Възложи на…" / "Отмени"
   qrConfirm(table, grams?)     "Потвърди и прати" -> {no, now}
   qrAssign(session, waiter) / qrAssignUndo(session)        "Възложи на…" a QR order / "Отмени"
   answer(ask, "return" | "pickup" | "deliver")             the driver's "адрес извън зоните" -> {answer, undoUntil, now}
   answerUndo(ask)              -> MgrNow
   resConfirm(id, undo?)        "Потвърди" a new reservation (undo: back to "Нова") -> ResRow
   block(ref, "block" | "clear")  a no-show: "Блокирай номера" / "Не блокирай" (no "Отмени") -> BlockRow
   busy(on)                     "Натоварено" -> MgrKitchen              backIn(dish, back = true)  "Върни" (false = the "Отмени") -> MgrKitchen
   on(type, fn)                 real time ("shift.update", "order.status", "floor.call" …; returns the unsubscribe)

   ownerApi.* ("Собственик": the owner and the main admin; others 403):
   today()                      OwnerToday: sales {sum, n} (= the admin dashboard), usual {sum, orders, days, label "обичайното за
                                понеделник до 19:42"}, vsUsual {pct, measure}, alert ({pct, dir, text, sub} at 20%+ with 10+ usual
                                orders) | null, lastWeek {sum, label "Миналия понеделник по това време"}, avg, cancelled, byHour
                                {labels (15 min), cur (cumulative, null after now), usual, nowIndex} | null, live {inWork, tables,
                                reservations}, byChannel[5], last7 {days[] with weekAgo, total, weekAgo}, waits, money, sample
   trends({period, from, to, compare: "prev" | "year", dish})   OwnerTrends: totals / prev (the same numbers as "Отчети"), cmp
                                {kind, from, to}, byDay[] / byHour[] with cmp, byChannel[], peak (day × hour), top {byCount,
                                byRevenue}, together[], customers {new, returning}, times {cookMin, deliveryMin, callSec | null},
                                offers {lunch, code}, dish, csv (rows; "Примерни данни" last), missing
   finance(q)                   OwnerFinance (403 without "Финанси и гориво"): revenue, pay / prevPay {online {cash, card,
                                voucher}, table {cash, card, unpaid}}, fuel {total, byDay, byDriver, byCar}, delivery {fuelPer,
                                fees[] ([ЛИПСВА] where unknown)}, cash {rows[] (toHand / handed), handTo [ЛИПСВА]}, cost [ЛИПСВА], csv
   decisions()                  OwnerDecisions: canAnswer (the owner only), questions[] (word for word, def, hasDefault,
                                answer | null), groups, counts, next, blocks {rows (pending), canDecide}, mail, google, waits
   answer(id, {answer: "default" | "other", text?})   the owner only -> {question, replaced, applied, msg, undoUntil}
                                (msg when applied: "Агенцията вече го е приложила. Новият отговор отива пак за преглед.")
   answerUndo(id)               "Отмени": the earlier answer (or none) -> QuestionView
   block(ref, action)           a no-show -> BlockRow       setMail({weekly?, monthly?})  the e-mail reports -> MailSettings
   on(type, fn)                 real time ("note.created", "note.status", "owner.answer", order.* …) */
import { api, http, pick, demoTok, ApiError } from "./api.ts";
import type { Core } from "./api-types.ts";
import type {
  StaffCtx, MgrNow, Problem, ProblemRef, WaitOrder, WaitRes, MgrKitchen, MgrHall, MgrTile, MgrTileState, MgrTable, TonightRes, MgrTeam, MgrSearch, ResRow, BlockRow, AskAnswer,
  OwnerToday, OwnerWaits, OwnerTrends, TrendQuery, OwnerFinance, PayBlock, OwnerQuestion, QuestionView, OwnerDecisions, AnswerInput, AnswerResult, MailSettings, Compare, Period, Ch5, ChKey, Peak, Pair, Times, OrderStatus,
} from "./api-types-boss.ts";

export { ApiError };
export type {
  MgrNow, Problem, ProblemRef, WaitOrder, WaitRes, MgrKitchen, MgrHall, MgrTile, MgrTileState, MgrTable, TonightRes, MgrTeam, MgrSearch, ResRow, BlockRow, AskAnswer,
  OwnerToday, OwnerWaits, OwnerTrends, TrendQuery, OwnerFinance, PayBlock, OwnerQuestion, QuestionView, OwnerDecisions, AnswerInput, AnswerResult, MailSettings, Compare, Period, Ch5, ChKey, Peak, Pair, Times,
};

/** the demo: the staff session of this browser (401 without it); the rights are checked by the core function */
const g = (c: Core): Promise<StaffCtx> => c.staff.guard(demoTok("staff"));
const e = encodeURIComponent;
const qs = (o: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const k of Object.keys(o)) { const v = o[k]; if (v) u.set(k, v); } const s = u.toString(); return s ? "?" + s : ""; };
const tq = (q: TrendQuery = {}) => qs({ period: q.period, from: q.from, to: q.to, compare: q.compare, dish: q.dish });
type Accepted = { no: string; status: OrderStatus; without: string[]; undo: { id: string; until: number } };

export const bossApi = {
  now: pick(async (c) => c.shift.now(await g(c)), () => http<MgrNow>("GET", "boss/now")),
  hall: pick(async (c) => c.shift.hall(await g(c)), () => http<MgrHall>("GET", "boss/hall")),
  table: pick(async (c, ref: string | number) => c.shift.table(await g(c), ref), (ref) => http<MgrTable>("GET", "boss/hall/" + e(String(ref)))),
  setWaiter: pick(async (c, ref: string | number, waiter: string) => c.shift.setWaiter(await g(c), ref, waiter), (ref, waiter) => http<MgrTable>("POST", "boss/hall/" + e(String(ref)) + "/waiter", { waiter })),
  walkin: pick(async (c, ref: string | number, allow: boolean) => c.shift.walkin(await g(c), ref, allow), (ref, allow) => http<MgrTable>("POST", "boss/hall/" + e(String(ref)) + "/walkin", { allow })),
  team: pick(async (c) => c.shift.team(await g(c)), () => http<MgrTeam>("GET", "boss/team")),
  setTables: pick(async (c, who: string, tables: (string | number)[], to?: string | null) => c.shift.setTables(await g(c), who, tables, to),
    (who: string, tables: (string | number)[], to?: string | null) => http<{ team: MgrTeam; undo: { id: string; until: number } }>("POST", "boss/team/tables", { who, tables, to: to ?? null })),
  setTablesUndo: pick(async (c, id: string) => c.shift.setTablesUndo(await g(c), id), (id) => http<MgrTeam>("POST", "boss/team/tables/undo", { id })),
  search: pick(async (c, q: string) => c.shift.search(await g(c), q), (q) => http<MgrSearch>("GET", "boss/search?q=" + e(q))),
  accept: pick(async (c, no: string, o: { without?: boolean } = {}) => c.shift.accept(await g(c), no, o), (no: string, o: { without?: boolean } = {}) => http<Accepted>("POST", "boss/orders/" + e(no) + "/accept", { without: o.without === true })),
  acceptUndo: pick(async (c, id: string) => c.shift.acceptUndo(await g(c), id), (id) => http<{ no: string; status: OrderStatus }>("POST", "boss/orders/undo", { id })),
  callCustomer: pick(async (c, no: string) => c.shift.callCustomer(await g(c), no), (no) => http<{ no: string; name: string; phone: string; addr: string; zone: string; channelName: string }>("POST", "boss/orders/" + e(no) + "/call")),
  ack: pick(async (c, key: string, what: "seen" | "called") => c.shift.ack(await g(c), key, what), (key, what) => http<MgrNow>("POST", "boss/ack", { key, what })),
  ackUndo: pick(async (c, key: string) => c.shift.ackUndo(await g(c), key), (key) => http<MgrNow>("POST", "boss/ack/undo", { key })),
  callGo: pick(async (c, id: string) => c.shift.callGo(await g(c), id), (id) => http<MgrNow>("POST", "boss/calls/" + e(id) + "/go")),
  callAssign: pick(async (c, id: string, waiter: string) => c.shift.callAssign(await g(c), id, waiter), (id, waiter) => http<MgrNow>("POST", "boss/calls/" + e(id) + "/assign", { waiter })),
  callUndo: pick(async (c, id: string) => c.shift.callUndo(await g(c), id), (id) => http<MgrNow>("POST", "boss/calls/" + e(id) + "/undo")),
  qrConfirm: pick(async (c, table: string | number, grams: Record<string, number> = {}) => c.shift.qrConfirm(await g(c), table, grams),
    (table: string | number, grams: Record<string, number> = {}) => http<{ no: string; now: MgrNow }>("POST", "boss/qr/" + e(String(table)) + "/confirm", { grams })),
  qrAssign: pick(async (c, session: string, waiter: string) => c.shift.qrAssign(await g(c), session, waiter), (session, waiter) => http<MgrNow>("POST", "boss/qr/" + e(session) + "/assign", { waiter })),
  qrAssignUndo: pick(async (c, session: string) => c.shift.qrAssignUndo(await g(c), session), (session) => http<MgrNow>("POST", "boss/qr/" + e(session) + "/undo")),
  answer: pick(async (c, ask: string, a: AskAnswer) => c.shift.answer(await g(c), ask, a), (ask, a) => http<{ answer: string; undoUntil: number; now: MgrNow }>("POST", "boss/asks/" + e(ask) + "/answer", { answer: a })),
  answerUndo: pick(async (c, ask: string) => c.shift.answerUndo(await g(c), ask), (ask) => http<MgrNow>("POST", "boss/asks/" + e(ask) + "/undo")),
  resConfirm: pick(async (c, id: string, undo: boolean = false) => c.shift.resConfirm(await g(c), id, undo), (id: string, undo = false) => http<ResRow>("POST", "boss/reservations/" + e(id) + "/confirm", { undo })),
  block: pick(async (c, ref: string, action: "block" | "clear") => c.shift.block(await g(c), ref, action), (ref, action) => http<BlockRow>("POST", "boss/blocks/" + e(ref), { action })),
  busy: pick(async (c, on: boolean) => c.shift.busy(await g(c), on), (on) => http<MgrKitchen>("POST", "boss/kitchen/busy", { on })),
  backIn: pick(async (c, dish: string, back: boolean = true) => c.shift.backIn(await g(c), dish, back), (dish: string, back = true) => http<MgrKitchen>("POST", "boss/kitchen/back", { dish, back })),
  on: (type: string, fn: (data: unknown, type: string) => void): (() => void) => api.on(type, fn),
};

export const ownerApi = {
  today: pick(async (c) => c.owner.today(await g(c)), () => http<OwnerToday>("GET", "owner/today")),
  trends: pick(async (c, q: TrendQuery = {}) => c.owner.trends(await g(c), q), (q: TrendQuery = {}) => http<OwnerTrends>("GET", "owner/trends" + tq(q))),
  finance: pick(async (c, q: TrendQuery = {}) => c.owner.finance(await g(c), q), (q: TrendQuery = {}) => http<OwnerFinance>("GET", "owner/finance" + tq(q))),
  decisions: pick(async (c) => c.owner.decisions(await g(c)), () => http<OwnerDecisions>("GET", "owner/decisions")),
  answer: pick(async (c, id: string, a: AnswerInput) => c.owner.answer(await g(c), id, a), (id, a) => http<AnswerResult>("POST", "owner/questions/" + e(id), a)),
  answerUndo: pick(async (c, id: string) => c.owner.answerUndo(await g(c), id), (id) => http<QuestionView>("POST", "owner/questions/" + e(id) + "/undo")),
  block: pick(async (c, ref: string, action: "block" | "clear") => c.owner.block(await g(c), ref, action), (ref, action) => http<BlockRow>("POST", "owner/blocks/" + e(ref), { action })),
  setMail: pick(async (c, p: { weekly?: boolean; monthly?: boolean }) => c.owner.setMail(await g(c), p), (p) => http<MailSettings>("PUT", "owner/mail", p)),
  on: (type: string, fn: (data: unknown, type: string) => void): (() => void) => api.on(type, fn),
};
