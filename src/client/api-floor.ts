/* THE HALL LIVE FOR THE SCREENS (stage D): the QR table of the guests, the waiter, the shift, the PIN sign-in.
   Only the pages of the modules import this file (the site's pages never load it). Server: fetch("/api/floor/…").
   Demo: the same core in the browser. In both, EVERY RULE AND RIGHT IS IN THE CORE (src/core/floor*.ts, staff-pin.ts):
   the same ApiError (code, message for people, fields, retryIn, left) on the server and in the demo.
   Types: GuestView, HallLive, TableDetail … are exported below (from the core, types only).

   ───────── masaApi: the QR table (no sign-in; the table's code comes from murl.masaCode()) ─────────
   The phone is a random token this file keeps (localStorage "sc-masa-g"; in the demo per TAB, sessionStorage, so two
   tabs are two phones as in the prototype). Every call returns the fresh GuestView (or {view, …}) and follows the
   sitting in real time. Errors: 404 not_found "Този код вече не работи" (unknown / replaced code), 403 guest (this phone
   is not in the sitting: call open again), 409 session_closed, 409 closed (the kitchen: before 10:00 / after 22:30).
     open(code, fresh?)            the start of every screen: the sitting of this phone; the first scan opens it and the
                                   phone becomes "Телефон N" (up to 7, else 409 table_full). After the close it returns
                                   the closed sitting (status "closed") until fresh = true (a new scan) or the next day.
     get(code)                     the view again (after an event); never opens a sitting, never adds a phone
     cartAdd(code, id, {q?, mods?})  "+" in the shared cart (409 sold_out | removed | lunch_table | breakfast_closed, 422 bad_qty | bad_mod)
     cartQty(code, key, q)         the counter of ANY line of the table; 0 removes it
     cartRemove(code, key)         -> {view, gone}: `gone` goes to cartRestore for "Отмени"
     cartRestore(code, gone)       the removed line back (its phone, its changes)
     send(code)                    -> {view, to, no}: to "waiter" = "Изпрати към сервитьора" (the first QR order of the sitting
                                   and every order with a steak "за 100 гр."; it waits in view.pending) or "kitchen" (no = "№")
     rejectedOk(code)              "Разбрах" under "Сервитьорът отказа поръчката" (view.rejected) for the whole table
     call(code, kind, note?)       kind "order" | "bill" | "water" | "other"; 409 call_active, 409 call_cooldown (+ retryIn s)
     callCancel(code, kind)        "Не ни трябва вече" (free again at once); for "bill": takes this phone's request back
     callRestore(code, kind)       "Отмени" after the cancel (15 s): the same call, the same time
     bill(code, {pay, split})      pay "cash" | "card"; split "one" | "guests" | "dishes" (the picks). Never what another phone
                                   asked for (409 bill_nothing); joins the waiting call "Сметка" (its time goes on)
     pick(code, keys, on)          "По ястия": tick / free lines ("<№>:<index>"); 409 picked (another phone) | pick_gone | bill_asked
     rate(code, {happy, text?})    -> {view, code, pct, google, googleMissing}: the code "SC10-…" -10% for BOTH answers, one per
                                   phone; the Google link for both answers, never for a discount; the text reaches only the manager
     on(fn)                        real time: fn(type, data) on "floor.session" (data.view = the shared GuestView: me null, no
                                   personal parts), "order.line", "order.status". The simplest screen calls get(code) in fn.
                                   Returns the unsubscribe function. Also api.on("stream.lost" | "stream.back").
     token()                       this phone's token (never show it)
   GuestView (read it from the core type): table {n, zone, zoneName}, me {phone, label}, phones, kitchen {open, before,
   breakfast}, canOrder, lunch ("[ЛИПСВА: обедно меню от масата]"), settings {callCooldown, callManager} (minutes),
   cart {lines[{key, id, name, q, mods, unit, sum, per100, phone, mine, block}], n, sum, open, toWaiter}, pending, rejected
   {reason, text, n}, orders[{no, placedAt, via, lines[{key, name, q, sum, phone, mine, who, st "accepted" | "cooking" |
   "served", stLabel, out, paid}]}], total, paid, rest, calls {active[{kind, label, note, at, taken, manager}],
   state[kind] {state "free" | "active" | "cool", at, until}}, bill {mine {…, sum}, others[{phone, pay, split, at}] (no sums),
   picks {key: phone}, free[], want {one, guests, dishes: {keys, sum}}}, rating, canRate, google, now (the server's time).

   ───────── floorApi: the waiter (section "Сервитьор"; the main admin, the owner and the manager too) ─────────
   A table is given by its id ("S12") or its number (12). 401 auth, 403 forbidden.
     hall()                        HallLive: tables[{id, n, zone, seats, state "call" | "bill" | "qr" | "ready" | "wait" | "busy" | "free",
                                   label ("Вика · Сметка"), reason, since, waits, owner {username, name}, mine, session}], calls[{id,
                                   table, kind, label, note, at, phone, taken {by, name, at, mine}, warn (2 min), late (with the manager),
                                   mine, forMe}], qr[{table, at, n, sum, open, late, mine, forMe}], counters {queue (THE one number),
                                   calls, qr, ready, readyTables, free, busy}, me {username, name, onShift, since, tables}, settings
     table(ref)                    TableDetail: state, owner, session, calls, pending {lines[{key, name, q, per100, price100, unit, sum,
                                   phone}], …}, bills[{name "Обща сметка" | "Гост 1", sum, paid, rest, orders[{no, placedAt, source, note,
                                   statusLabel, lines[{key, name, q, mods, note, grams, sum, st, stLabel, out, paid, guest, canUnserve}]}]}],
                                   total, paid, rest, payments, requests (what the phones asked, with sums), unserved, canClose, reasons
     seat(ref)                     guests sat down without an order ("Чака поръчка") [no button in the prototype]
     callTake(id)                  "Отивам" -> HallLive (409 taken: a colleague has it)
     callDone(id)                  "Обслужено" -> HallLive (the cooldown of that kind starts for the guests)
     callUndo(id)                  "Отмени" (15 s): my "Обслужено", else my "Отивам" (409 undo_late)
     qrConfirm(ref, grams?)        "Потвърди и прати" -> TableDetail + no; grams {<pending line key>: 100-2000} for the steaks
                                   (422 fields "grams.<key>"); 409 closed | sold_out | no_pending
     qrReject(ref, reason)         "Откажи": reason "test" | "gaveup" | "manual" (422 fields.reason); the dishes go back to the cart
     qrRejectUndo(ref)             "Отмени" after "Откажи" (15 s)
     qrDrop(ref, key)              "Махни" one line of the waiting QR order (pending.lines[].block "sold_out" …: not in the sum, the
                                   confirmation would be refused); the guests see the order without it. 409 last_line (use "Откажи")
     order(ref, {lines, note?})    "Нова поръчка" → "Към кухнята": lines[{id, q, mods?, note?, grams? (steak "за 100 гр."), guest? ("Гост 1":
                                   separate bills, one order per guest)}] -> TableDetail + orders (the numbers). A free table gets a sitting.
                                   409 closed | sold_out | breakfast_closed | lunch_table, 422 fields "lines.<i>.grams" | "lines.<i>.guest"
     serve(ref, keys?)             "Сервирах": the lines by key, or every ready line of the table -> TableDetail + served (409 not_ready)
     unserve(ref, keys)            "Отмени" after "Сервирах" (15 s)
     ready()                       "Готови": ReadyGroup[] by table (mine first, the oldest first)
     pay(ref, {how, keys?, bill?}) "Маркирай платено": how "cash" | "card"; keys = by dish, bill = "Гост 1", nothing = what is left.
                                   -> TableDetail + payment {sum, keys, …}; 409 paid (a line is never paid twice)
     close(ref, force?)            "Затвори масата": 409 unpaid | pending | unserved (the dishes are TableDetail.unserved: show
                                   them and ask "Затвори въпреки това", then force = true)
     search(q)                     the waiter's search: {tables, orders, reservations (phones masked; null without the right), soldOut}
     ratings()                     the ratings from the tables with the text: main admin, owner, manager
     on(fn)                        real time for the staff: fn(type, data) on floor.session, floor.call, floor.qr, order.new, order.line,
                                   order.status, shift.update; call hall() / table() again in fn

   ───────── shiftApi: the waiter's shift ─────────
     mine()                        {shift {since, tables} | null, tables[{id, n, zone, seats, owner, mine, busy}], colleagues}
     start(tables)                 "Започни смяната" (ids or numbers; 422 no table; 409 taken: a colleague's table)
     end(to?)                      "Предай N маси и излез": to = a colleague's username (gets my occupied tables) or nothing;
                                   SIGNS OUT (go to the sign-in screen after it) -> {ok, handed[], to}
     view()                        the manager's module: {waiters[{username, name, since, tables, waiting, late, avgSec, answered}],
                                   unassigned, settings}: main admin, owner, manager
     setTables(who, tables, to?)   the manager changes a waiter's tables (at least one stays; the taken ones go to `to`, default the
                                   first other waiter on shift) -> the view

   ───────── pinApi: the personal PIN, only on a known device ─────────
   A device becomes known after a sign-in with a username and a password on it (any staff member).
     people(module)                module "waiter" | "kitchen" | "driver" -> {known, pinOnly (kitchen), people[{id, name}]};
                                   known false: show only the password form
     login(module, pin, user?)     person + 4 digits (kitchen: the PIN alone) -> {user, home}: the normal staff session.
                                   403 unknown_device, 401 bad_pin (+ left for the last 3), 429 throttled (+ retryIn) */
import { api, http, pick, demoTok, setDemoTok, ApiError, DEMO } from "./api.ts";
import type { Core } from "./api-types.ts";
import type {
  StaffCtx, PublicStaff, CallKind, RejectReason, GuestView, GuestCartLine, GuestOrder, GuestOrderLine, GuestCall, FloorCartLine, FloorPayment, HallLive, HallTile, HallCall, HallQr,
  TableDetail, StaffBill, StaffOrder, StaffLine, PendingLine, ReadyGroup, StaffOrderInput, StaffSearch, TableRating, ShiftMine, WaiterShiftView, ShiftRow, PinModule, PinPeople, LineSt, TableStateKey,
} from "../core/index.ts";

export { ApiError };
export type {
  CallKind, RejectReason, GuestView, GuestCartLine, GuestOrder, GuestOrderLine, GuestCall, FloorCartLine, FloorPayment, HallLive, HallTile, HallCall, HallQr, TableDetail, StaffBill, StaffOrder,
  StaffLine, PendingLine, ReadyGroup, StaffOrderInput, StaffSearch, TableRating, ShiftMine, WaiterShiftView, ShiftRow, PinModule, PinPeople, LineSt, TableStateKey,
};
type Ref = string | number;
type SendResult = { view: GuestView; to: "waiter" | "kitchen"; no: string | null };
type RateResult = { view: GuestView; code: string; pct: number; google: string | null; googleMissing: boolean };
type Fn = (type: string, data: unknown) => void;
const e = encodeURIComponent;

/* ---------- the phone's token ---------- */
let memTok = "";
function newToken(): string { const a = new Uint8Array(16); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join(""); }
/** this phone at the tables: a random token, never a name. Server: one per browser. Demo: one per tab (two tabs = two phones). */
function token(): string {
  if (memTok) return memTok;
  let st: Storage | null = null;
  try { st = DEMO ? sessionStorage : localStorage; } catch { st = null; }
  let t = "";
  try { t = (st && st.getItem("sc-masa-g")) || ""; } catch { /* private mode */ }
  if (!/^[0-9a-f]{32}$/.test(t)) { t = newToken(); try { st && st.setItem("sc-masa-g", t); } catch { /* kept for this page only */ } }
  return (memTok = t);
}
/** follow the sitting of this view in real time (the server's stream by the code + token, the demo bus by the sitting's id) */
function follow<T extends GuestView | { view: GuestView }>(code: string, r: T): T {
  const v = ("view" in r ? r.view : r) as GuestView;
  if (v && v.session) api.watch({ table: { code, g: token(), session: v.session } });
  return r;
}
const gpost = <T extends GuestView | { view: GuestView }>(code: string, path: string, body: Record<string, unknown> = {}) => http<T>("POST", "floor/t/" + e(code) + "/" + path, { g: token(), ...body }).then((r) => follow(code, r));
const glocal = async <T extends GuestView | { view: GuestView }>(code: string, r: Promise<T>): Promise<T> => follow(code, await r);
const listen = (types: string[], fn: Fn): (() => void) => { const offs = types.map((t) => api.on(t, (d, type) => fn(type, d))); return () => offs.forEach((o) => o()); };

export const masaApi = {
  token,
  open: pick((c, code: string, fresh: boolean = false) => glocal(code, c.floor.open(code, token(), fresh)), (code: string, fresh: boolean = false) => gpost<GuestView>(code, "open", { fresh })),
  get: pick((c, code: string) => glocal(code, c.floor.view(code, token())), (code) => gpost<GuestView>(code, "view")),
  cartAdd: pick((c, code: string, id: string, o: { q?: number; mods?: string[] } = {}) => glocal(code, c.floor.cartAdd(code, token(), { id, q: o.q, mods: o.mods })),
    (code: string, id: string, o: { q?: number; mods?: string[] } = {}) => gpost<GuestView>(code, "cart/add", { id, q: o.q, mods: o.mods })),
  cartQty: pick((c, code: string, key: string, q: number | "+1" | "-1") => glocal(code, c.floor.cartQty(code, token(), key, q)), (code, key, q) => gpost<GuestView>(code, "cart/qty", { key, q })),
  cartRemove: pick((c, code: string, key: string) => glocal(code, c.floor.cartRemove(code, token(), key)), (code, key) => gpost<{ view: GuestView; gone: FloorCartLine | null }>(code, "cart/remove", { key })),
  cartRestore: pick((c, code: string, gone: Partial<FloorCartLine>) => glocal(code, c.floor.cartRestore(code, token(), gone)), (code, gone) => gpost<GuestView>(code, "cart/restore", { line: gone })),
  send: pick((c, code: string) => glocal<SendResult>(code, c.floor.send(code, token())), (code) => gpost<SendResult>(code, "send")),
  rejectedOk: pick((c, code: string) => glocal(code, c.floor.rejectedOk(code, token())), (code) => gpost<GuestView>(code, "rejected-ok")),
  call: pick((c, code: string, kind: CallKind, note?: string) => glocal(code, c.floor.call(code, token(), kind, note)), (code: string, kind: CallKind, note?: string) => gpost<GuestView>(code, "call", { kind, note })),
  callCancel: pick((c, code: string, kind: CallKind) => glocal(code, c.floor.callCancel(code, token(), kind)), (code, kind) => gpost<GuestView>(code, "call/cancel", { kind })),
  callRestore: pick((c, code: string, kind: CallKind) => glocal(code, c.floor.callRestore(code, token(), kind)), (code, kind) => gpost<GuestView>(code, "call/restore", { kind })),
  bill: pick((c, code: string, p: { pay: "cash" | "card"; split: "one" | "guests" | "dishes" }) => glocal(code, c.floor.bill(code, token(), p)), (code, p) => gpost<GuestView>(code, "bill", p)),
  pick: pick((c, code: string, keys: string | string[], on: boolean) => glocal(code, c.floor.pick(code, token(), keys, on)), (code, keys, on) => gpost<GuestView>(code, "pick", { keys: Array.isArray(keys) ? keys : [keys], on })),
  rate: pick((c, code: string, p: { happy: boolean; text?: string }) => glocal<RateResult>(code, c.floor.rate(code, token(), p)), (code, p) => gpost<RateResult>(code, "rate", p)),
  /** real time for the guests of the sitting (after open / get): floor.session, order.line, order.status */
  on: (fn: Fn) => listen(["floor.session", "order.line", "order.status"], fn),
};

/* ---------- the staff ---------- */
/** the demo: the staff session of this browser (401 without it); the right is checked by the core function */
const g = (c: Core): Promise<StaffCtx> => c.staff.guard(demoTok("staff"));
const t = (ref: Ref) => "floor/table/" + e(String(ref));

export const floorApi = {
  hall: pick(async (c) => c.floor.hall(await g(c)), () => http<HallLive>("GET", "floor/hall")),
  table: pick(async (c, ref: Ref) => c.floor.table(await g(c), ref), (ref) => http<TableDetail>("GET", t(ref))),
  seat: pick(async (c, ref: Ref) => c.floor.seat(await g(c), ref), (ref) => http<TableDetail>("POST", t(ref) + "/seat")),
  callTake: pick(async (c, id: string) => c.floor.callTake(await g(c), id), (id) => http<HallLive>("POST", "floor/call/" + e(id) + "/take")),
  callDone: pick(async (c, id: string) => c.floor.callDone(await g(c), id), (id) => http<HallLive>("POST", "floor/call/" + e(id) + "/done")),
  callUndo: pick(async (c, id: string) => c.floor.callUndo(await g(c), id), (id) => http<HallLive>("POST", "floor/call/" + e(id) + "/undo")),
  qrConfirm: pick(async (c, ref: Ref, grams: Record<string, number> = {}) => c.floor.qrConfirm(await g(c), ref, grams), (ref: Ref, grams: Record<string, number> = {}) => http<TableDetail & { no: string }>("POST", t(ref) + "/qr/confirm", { grams })),
  qrReject: pick(async (c, ref: Ref, reason: RejectReason) => c.floor.qrReject(await g(c), ref, reason), (ref, reason) => http<TableDetail>("POST", t(ref) + "/qr/reject", { reason })),
  qrDrop: pick(async (c, ref: Ref, key: string) => c.floor.qrDrop(await g(c), ref, key), (ref, key) => http<TableDetail>("POST", t(ref) + "/qr/drop", { key })),
  qrRejectUndo: pick(async (c, ref: Ref) => c.floor.qrRejectUndo(await g(c), ref), (ref) => http<TableDetail>("POST", t(ref) + "/qr/undo")),
  order: pick(async (c, ref: Ref, o: StaffOrderInput) => c.floor.order(await g(c), ref, o), (ref, o) => http<TableDetail & { orders: string[] }>("POST", t(ref) + "/order", o)),
  serve: pick(async (c, ref: Ref, keys?: string[]) => c.floor.serve(await g(c), ref, keys), (ref: Ref, keys?: string[]) => http<TableDetail & { served: string[] }>("POST", t(ref) + "/serve", keys ? { keys } : {})),
  unserve: pick(async (c, ref: Ref, keys: string[]) => c.floor.unserve(await g(c), ref, keys), (ref, keys) => http<TableDetail>("POST", t(ref) + "/unserve", { keys })),
  ready: pick(async (c) => c.floor.ready(await g(c)), () => http<ReadyGroup[]>("GET", "floor/ready")),
  pay: pick(async (c, ref: Ref, p: { how: "cash" | "card"; keys?: string[]; bill?: string }) => c.floor.pay(await g(c), ref, p), (ref, p) => http<TableDetail & { payment: FloorPayment }>("POST", t(ref) + "/pay", p)),
  close: pick(async (c, ref: Ref, force: boolean = false) => c.floor.close(await g(c), ref, force), (ref: Ref, force: boolean = false) => http<TableDetail>("POST", t(ref) + "/close", { force })),
  search: pick(async (c, q: string) => c.floor.search(await g(c), q), (q) => http<StaffSearch>("GET", "staff/search?q=" + e(q))),
  ratings: pick(async (c) => c.floor.ratings(await g(c)), () => http<TableRating[]>("GET", "floor/ratings")),
  /** real time for the staff: everything that changes the hall */
  on: (fn: Fn) => listen(["floor.session", "floor.call", "floor.qr", "order.new", "order.line", "order.status", "shift.update"], fn),
};

export const shiftApi = {
  mine: pick(async (c) => c.floor.shiftMine(await g(c)), () => http<ShiftMine>("GET", "floor/shift")),
  start: pick(async (c, tables: Ref[]) => c.floor.shiftStart(await g(c), tables), (tables) => http<ShiftMine>("POST", "floor/shift/start", { tables })),
  /** hands the tables over and SIGNS OUT (the demo: the staff session of this browser) */
  end: pick(async (c, to?: string | null) => { const r = await c.floor.shiftEnd(await g(c), to || null); if (r.closed) { const tok = demoTok("staff"); if (tok) await c.staff.logout(tok); setDemoTok("staff", null); } return r; },
    (to?: string | null) => http<{ ok: true; handed: number[]; to: string | null }>("POST", "floor/shift/end", { to: to || null })),
  view: pick(async (c) => c.floor.shiftView(await g(c)), () => http<WaiterShiftView>("GET", "floor/shift/view")),
  setTables: pick(async (c, who: string, tables: Ref[], to?: string | null) => c.floor.shiftSetTables(await g(c), who, tables, to || null), (who: string, tables: Ref[], to?: string | null) => http<WaiterShiftView>("POST", "floor/shift/tables", { who, tables, to: to || null })),
};

/* ---------- the PIN on a known device ---------- */
export const pinApi = {
  /** the demo: the browser's own store is the device (known after a password sign-in in this browser) */
  people: pick((c, module: PinModule) => c.pin.people(null, module), (module) => http<PinPeople>("GET", "auth/pin/people?module=" + e(module))),
  login: pick(async (c, module: PinModule, pin: string, user?: string) => { const r = await c.pin.login(null, { module, user, pin }); setDemoTok("staff", r.token); return { user: r.user, home: r.home }; },
    (module: PinModule, pin: string, user?: string) => http<{ user: PublicStaff; home: string }>("POST", "auth/pin", { module, pin, user })),
};
