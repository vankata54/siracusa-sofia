/* The driver for the screens (src/modules/shofyor/*, and the manager's / owner's modules for their views).
   Server: fetch("/api/driver/..."). Demo: the same core in the browser with the demo session. The RIGHTS ARE IN THE CORE
   (src/core/driver.ts): the same 401 "auth" / 403 "forbidden" / 404 / 409 / 422 (ApiError: code, message for people on
   "ти", fields) on the server and in the demo. A driver gets only his own deliveries and the ready ones nobody took,
   and never a customer's phone or e-mail (the name only).

   THE CONTRACT (driverApi.*; every call returns a Promise; D = Delivery, the view of one delivery):
   state()                      who is signed in, shift (ShiftView | null), cars (the most used first, lastKm, busyBy,
                                missing "[ЛИПСВА: коли: марка, рег. №]"), undoMs (10 000), missing (the [ЛИПСВА] marks)
   start({car, km, float?, nav?})  "Започни смяната" -> DriverState. 422 fields car / km / float; 409 shift_open
   prefs({nav?, parked?})       "google" | "waze"; parked "" | "parked" | "passenger" (for the shift) -> DriverState
   changeCar({car, kmEnd, kmStart})  "Смених колата": a new leg of the same shift -> DriverState. 422 fields
   list({all?})                 DriverList {shift, waiting[] ("В ресторанта"), active[] (mine, in the route's order, then
                                open problems), done[] (of the shift), next (№ | null), sum {active, cash, cashFeeMissing,
                                done}, route {pick, locked}}; all: true = every driver's (the bosses, else 403)
   get(no)                      D. 404 for another driver's delivery
   take(nos[])                  "Взех N поръчки" (all or none) -> {deliveries, undo {id, until}}. 409 taken (another
                                driver: fields {<№>: text}) / not_ready / ask_required; 404; 409 no_shift
   go(nos?)                     "Тръгвам": no nos = ALL taken ones, nos = only those -> {deliveries, undo, skipped[]}
   arrive(no)                   "Пристигнах" -> {deliveries, undo, notified {page, push, sms: null, smsMissing}}
   deliver(no, {sum?})          "Доставена · взех X €" (cash: sum, default the total; card / voucher as such); with an
                                open problem = "Доставих все пак" -> {deliveries, undo}. 409 bad_state before "Тръгвам"
   problem(no, kind, note?)     "nobody" | "address" | "refused", only for a taken order or one on the way -> {deliveries, undo}
   returned(no)                 "Върнах я" (after a problem, or after the answer "return" / "pickup") -> {deliveries, undo}
   undo(id)                     "Отмени" of the last step (id from its result), about 10 s -> {deliveries}.
                                409 undo_gone / undo_late / undo_changed (somebody else acted)
   ask(no, note?)               "Адрес извън зоните": the question to the manager -> AskView (D.ask shows the answer;
                                event "driver.ask"). take / go of that order wait for "deliver"
   route()                      RouteView {pick, options[] (A "Път А · по срока", B "Път Б · по-кратък", own "Моят ред";
                                km, minutes, fuel are ALWAYS null + note "[ЛИПСВА: маршрути от OSRM]"), same, stops[] (D in
                                the chosen order; D.locked = he drives to it, always first), locked, etaNote}
   routePick("A" | "B" | "own") -> RouteView
   routeMove(no, "up" | "down") "По-рано" / "По-късно" (makes "Моят ред") -> RouteView. 409 locked / edge
   fuel()                       FuelPage {car, lastKm, cashOnHand, entries[] (this shift), lastPerLitre}
   fuelAdd({litres, sum, km, full?, cash?, photo?, noPhoto?})  -> FuelPage + entry. 422 fields litres / sum / km / photo
   receipt(file)                the photo of the receipt (png / jpeg / webp by content, 5 MB; demo 1 MB) -> {url} for fuelAdd
   shift()                      ShiftSummary: delivered, problems, fuel, cash {rows[], sum}, float, fuelCash, handover
                                (= cash + float - fuelCash), owe, cards, vouchers, km {legs[], total}, unfinished[], handTo
   end({km, handed})            "Приключи смяната" -> ShiftSummary (closed: true). 409 unfinished (message lists the №,
                                fields {<№>: state}); 422 fields km / handed. The sign-out is the screen's (api.staff.logout)
   search(q)                    {q, act[], done[]}: only his deliveries of the shift (№, address, quarter, state)
   -- the main admin, the owner, the manager (others 403) --
   drivers()                    DriversView {drivers[] (name, sinceAt, car, status "restaurant" | "road" | "back",
                                statusLabel, course {id, stops[] (no, zone, addr, st, late, lateLabel "+22 мин" | "навреме",
                                next)}, deliveredToday, cash, cashTo, position: null), waiting, asks[], problems[]}
   asks({all?})                 the open questions (all: + answered today) -> AskView[]
   answer(id, "return" | "pickup" | "deliver")  -> AskView (+ undoUntil). 409 answered
   answerUndo(id)               the manager's "Отмени" of an answer -> AskView. 409 undo_late / undo_changed
   saveCars([{id?, n, plate?}]) the cars (a setting) -> CarView[]
   -- the owner, or the section "Финанси и гориво" (others 403) --
   fuelReport({from?, to?})     FuelReport {total, byDay[], byDriver[], byCar[] (per100: l/100 km), rows[]}
   -- real time --
   on(type, fn)                 "driver.course" {driver, kind, orders[]} (kind: shift_start, take, go, arrive, deliver,
                                problem, returned, undo, route, car, fuel, shift_end), "driver.ask" {id, order, driver,
                                status, answer}, "order.status" {no, status, at, arrivedAt?, hold?}; "stream.lost" / "stream.back"
   D (Delivery): no, st ("wait" | "picked" | "road" | "done" | "prob" | "cancelled"), stLabel, mine, zone, addr, name, note,
   pay, payLabel, lines[], count, sub, disc, fee (null = unknown), feeKnown, total, cashDue, placedAt, due / dueAt, late (min),
   eta / etaAt ("около"; null when it cannot be honest), etaLate, n (place in the route), locked, pickedAt, onWayAt,
   arrivedAt, deliveredAt, problem {kind, label, note, solved, solvedAt}, collected {pay, sum}, outzone, ask, reason. */
import { api, http, pick, demoTok, ApiError } from "./api.ts";
import { sniffImage } from "./api-menu.ts";
import type { Core } from "./api-types.ts";
import type {
  StaffCtx, DeliveryState, ProblemKind, AskAnswer, DriverStatus, NavApp, RoutePick, DriverCar, CarView, ShiftView, DriverState, ShiftStart, Delivery, DriverList, AskView,
  RouteView, RouteOption, StepResult, ArriveResult, FuelView, FuelPage, FuelInput, FuelReport, ShiftTotals, ShiftSummary, DriverRow, DriversView,
} from "./api-types-driver.ts";

export { ApiError };
export type {
  DeliveryState, ProblemKind, AskAnswer, DriverStatus, NavApp, RoutePick, DriverCar, CarView, ShiftView, DriverState, ShiftStart, Delivery, DriverList, AskView,
  RouteView, RouteOption, StepResult, ArriveResult, FuelView, FuelPage, FuelInput, FuelReport, ShiftTotals, ShiftSummary, DriverRow, DriversView,
};
export interface Receipt { url: string; type: string; bytes: number }

/** the demo: the staff session of this browser (401 without it); the rights are checked by the core function */
const g = (c: Core): Promise<StaffCtx> => c.staff.guard(demoTok("staff"));
const e = encodeURIComponent;
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

async function receiptDemo(c: Core, file: Blob): Promise<Receipt> {
  const s = await g(c), b = new Uint8Array(await file.arrayBuffer()), ext = sniffImage(b);
  await c.driver.receiptCheck(s, { bytes: b.length, ext });
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { url: "data:" + MIME[ext!] + ";base64," + btoa(bin), type: MIME[ext!], bytes: b.length };
}
async function receiptServer(file: Blob): Promise<Receipt> {
  let r: Response;
  try { r = await fetch("/api/driver/receipt", { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream" }, body: file }); }
  catch { throw new ApiError("offline", "Няма връзка. Проверете интернета и опитайте пак.", 0); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(j?.error || "server", j?.message || "Нещо се обърка. Опитайте пак.", r.status, j?.fields, j?.retryIn);
  return j as Receipt;
}

export const driverApi = {
  /* ---------- the shift ---------- */
  state: pick(async (c) => c.driver.state(await g(c)), () => http<DriverState>("GET", "driver/state")),
  start: pick(async (c, i: ShiftStart) => c.driver.start(await g(c), i), (i) => http<DriverState>("POST", "driver/start", i)),
  prefs: pick(async (c, p: { nav?: NavApp; parked?: "" | "parked" | "passenger" }) => c.driver.prefs(await g(c), p), (p) => http<DriverState>("POST", "driver/prefs", p)),
  changeCar: pick(async (c, i: { car: string; kmEnd: number | string; kmStart: number | string }) => c.driver.changeCar(await g(c), i), (i) => http<DriverState>("POST", "driver/car", i)),
  /* ---------- the deliveries ---------- */
  list: pick(async (c, o: { all?: boolean } = {}) => c.driver.list(await g(c), o), (o = {}) => http<DriverList>("GET", "driver/list" + (o.all ? "?all=1" : ""))),
  get: pick(async (c, no: string) => c.driver.get(await g(c), no), (no) => http<Delivery>("GET", "driver/deliveries/" + e(no))),
  take: pick(async (c, nos: string[]) => c.driver.take(await g(c), nos), (nos) => http<StepResult>("POST", "driver/take", { nos })),
  go: pick(async (c, nos?: string[]) => c.driver.go(await g(c), nos), (nos?: string[]) => http<StepResult & { skipped: { no: string; why: string }[] }>("POST", "driver/go", nos ? { nos } : {})),
  arrive: pick(async (c, no: string) => c.driver.arrive(await g(c), no), (no) => http<ArriveResult>("POST", "driver/deliveries/" + e(no) + "/arrive")),
  deliver: pick(async (c, no: string, i: { sum?: number | string | null } = {}) => c.driver.deliver(await g(c), no, i), (no: string, i: { sum?: number | string | null } = {}) => http<StepResult>("POST", "driver/deliveries/" + e(no) + "/deliver", { sum: i.sum ?? null })),
  problem: pick(async (c, no: string, kind: ProblemKind, note?: string) => c.driver.problem(await g(c), no, kind, note), (no, kind, note) => http<StepResult>("POST", "driver/deliveries/" + e(no) + "/problem", { kind, note })),
  returned: pick(async (c, no: string) => c.driver.returned(await g(c), no), (no) => http<StepResult>("POST", "driver/deliveries/" + e(no) + "/returned")),
  undo: pick(async (c, id: string) => c.driver.undo(await g(c), id), (id) => http<{ deliveries: Delivery[] }>("POST", "driver/undo", { id })),
  ask: pick(async (c, no: string, note?: string) => c.driver.ask(await g(c), no, note), (no, note) => http<AskView>("POST", "driver/deliveries/" + e(no) + "/ask", { note })),
  /* ---------- the route ---------- */
  route: pick(async (c) => c.driver.route(await g(c)), () => http<RouteView>("GET", "driver/route")),
  routePick: pick(async (c, p: RoutePick) => c.driver.routePick(await g(c), p), (p) => http<RouteView>("POST", "driver/route", { pick: p })),
  routeMove: pick(async (c, no: string, dir: "up" | "down") => c.driver.routeMove(await g(c), no, dir), (no, dir) => http<RouteView>("POST", "driver/route/move", { no, dir })),
  /* ---------- fuel ---------- */
  fuel: pick(async (c) => c.driver.fuel(await g(c)), () => http<FuelPage>("GET", "driver/fuel")),
  fuelAdd: pick(async (c, i: FuelInput) => c.driver.fuelAdd(await g(c), i), (i) => http<FuelPage & { entry: FuelView }>("POST", "driver/fuel", i)),
  receipt: pick(receiptDemo, receiptServer),
  fuelReport: pick(async (c, f: { from?: string; to?: string } = {}) => c.driver.fuelReport(await g(c), f),
    (f: { from?: string; to?: string } = {}) => http<FuelReport>("GET", "driver/fuel/report" + (f.from || f.to ? "?" + new URLSearchParams(Object.entries(f).filter((x): x is [string, string] => !!x[1])).toString() : ""))),
  /* ---------- the end of the shift, the search ---------- */
  shift: pick(async (c) => c.driver.shift(await g(c)), () => http<ShiftSummary>("GET", "driver/shift")),
  end: pick(async (c, i: { km: number | string; handed: boolean }) => c.driver.end(await g(c), i), (i) => http<ShiftSummary>("POST", "driver/end", i)),
  search: pick(async (c, q: string) => c.driver.search(await g(c), q), (q) => http<{ q: string; act: Delivery[]; done: Delivery[] }>("GET", "driver/search?q=" + e(q))),
  /* ---------- the manager and the owner ---------- */
  drivers: pick(async (c) => c.driver.drivers(await g(c)), () => http<DriversView>("GET", "driver/drivers")),
  asks: pick(async (c, o: { all?: boolean } = {}) => c.driver.asks(await g(c), o), (o = {}) => http<AskView[]>("GET", "driver/asks" + (o.all ? "?all=1" : ""))),
  answer: pick(async (c, id: string, a: AskAnswer) => c.driver.answer(await g(c), id, a), (id, a) => http<AskView>("POST", "driver/asks/" + e(id) + "/answer", { answer: a })),
  answerUndo: pick(async (c, id: string) => c.driver.answerUndo(await g(c), id), (id) => http<AskView>("POST", "driver/asks/" + e(id) + "/undo")),
  saveCars: pick(async (c, cars: { id?: string; n: string; plate?: string | null }[]) => c.driver.saveCars(await g(c), cars), (cars) => http<CarView[]>("PUT", "driver/cars", { cars })),
  /** real time: "driver.course", "driver.ask", "order.status", "stream.lost", "stream.back" (returns the unsubscribe) */
  on: (type: string, fn: (data: unknown, type: string) => void): (() => void) => api.on(type, fn),
};
