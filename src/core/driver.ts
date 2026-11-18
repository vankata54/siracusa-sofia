/* The driver (stage D, step 6; design/pages-shofyor/README.md with "Поправки след проверка 1", docs/MODULES-BRIEF.md 4):
   the shift (car, km, start change, legs when the car changes), the deliveries ("Взех" -> "Тръгвам" -> "Пристигнах" ->
   "Доставена · взех X €", each with "Отмени"), a problem and its two endings, the question "адрес извън зоните" to the
   manager with its three answers, the order of the addresses, fuel, the cash to hand over, the end of the shift, and what
   the manager and the owner see about the drivers.
   The same on the server and in the demo: every function takes the signed-in staff member and checks the rights itself.
   - section "driver": a driver sees ONLY his own deliveries and the ready ones nobody took; never the customer's phone or
     e-mail (the name only: calls go "през ресторанта", [ЛИПСВА: доставчик за маскирани обаждания]);
   - the main admin, the owner and the manager (by role) see all drivers (drivers, asks, list with {all: true});
   - the status of an order moves only through the existing rules (orders.ts: "Готова" -> "На път" -> "Доставена"),
     one order never changes another one silently; several may be "На път" at once;
   - every action writes a line in the log and tells the staff screens (driver.course, driver.ask) and the customer's
     tracking page (order.status).
   No GPS and no routing service in v1 (decisions of 17.11.2026): no kilometres, minutes or fuel for a route (null with
   the note [ЛИПСВА: километри и минути на маршрута]); the estimated arrival is the zone's minutes + 2 min per previous address. */
import { COL, emit, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, PAY_LABEL, type Iso, type Order, type OrderStatus, type PayMethod, type StaffUser } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import type { PushSub, PushPayload } from "./push.ts";
import type { ZoneRow } from "./site-data.ts";
import { audit } from "./audit.ts";
import { need, needBoss, may, isBoss, invalid, money, round2, serial, RIGHTS_MSG } from "./rights.ts";
import { setOrderStatus, orderDay } from "./orders.ts";
import { liveZones } from "./zones.ts";
import { sofiaEpoch, sofiaNow, sofiaYmd, addDaysYmd } from "../lib/time.ts";
import { hhmm, fmt } from "../lib/format.ts";

/* ---------- words (the screens show the same ones) ---------- */
export type DeliveryState = "wait" | "picked" | "road" | "done" | "prob" | "cancelled";
export const DELIVERY_LABEL: Record<DeliveryState, string> = { wait: "В ресторанта", picked: "Взета", road: "На път", done: "Доставена", prob: "Проблем", cancelled: "Отказана" };
export type ProblemKind = "nobody" | "address" | "refused";
export const PROBLEM_KINDS: ProblemKind[] = ["nobody", "address", "refused"];
export const PROBLEM_LABEL: Record<ProblemKind, string> = { nobody: "Няма никой", address: "Грешен адрес", refused: "Отказ" };
export type AskAnswer = "return" | "pickup" | "deliver";
/** decision 17.11.2026 (answer 30): the three answers, in the order of the manager's sheet */
export const ASK_ANSWERS: AskAnswer[] = ["return", "pickup", "deliver"];
export const ANSWER_LABEL: Record<AskAnswer, string> = { return: "Върни я в ресторанта", pickup: "Предложи вземане от място", deliver: "Да я достави" };
export type DriverStatus = "restaurant" | "road" | "back";
export const DRIVER_STATUS_LABEL: Record<DriverStatus, string> = { restaurant: "В ресторанта", road: "На път", back: "Връща се" };
export const NAV_APPS = { google: "Google Maps", waze: "Waze" } as const;
export type NavApp = keyof typeof NAV_APPS;
export type RoutePick = "A" | "B" | "own";

/** what is not known yet (docs/OPEN-QUESTIONS.md): the screens show these marks, the core never invents the fact */
export const DRIVER_MISSING = {
  cars: "[ЛИПСВА: коли: марка, рег. №]",
  float: "[ЛИПСВА: колко ресто се дава]",
  sms: "[ЛИПСВА: доставчик за SMS]",
  calls: "[ЛИПСВА: доставчик за маскирани обаждания]",
  wait: "[ЛИПСВА: колко чака шофьорът и какво става с храната]",
  handTo: "[ЛИПСВА: на кого се предават парите]",
  route: "[ЛИПСВА: километри и минути на маршрута]",
  terminal: "[ЛИПСВА: терминал]",
} as const;

/** "Отмени": the screen offers it this long after a step; the core accepts it a little longer (the network) */
export const DRIVER_UNDO_MS = 10_000;
const UNDO_GRACE_MS = 5_000;
export const KM_MAX = 2_000_000, KM_JUMP = 2000, LITRES_MAX = 120, TAKE_MAX = 30;
/** minutes added for every address before this one (pack 10.1) */
export const STOP_MIN = 2;
const MIN = 60_000;

/** "48 250" (the same text on the server and in the demo, whatever the locale data) */
export const kmText = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, " ");
const no = (n: string) => "№ " + n;

export const DRIVER_MSG = {
  check: "Провери полетата.",
  noShift: "Първо започни смяната.",
  shiftOpen: "Вече имаш започната смяна.",
  notFound: "Няма такава доставка.",
  car: "Избери кола.",
  carSame: "Вече караш тази кола.",
  carTaken: (who: string) => "Тази кола е в смяната на " + who + ".",
  carInUse: (n: string) => n + " е в смяна в момента и не може да се махне.",
  carName: "Името на колата е от 1 до 40 знака.",
  carPlate: "Рег. № е до 16 знака.",
  carList: "Списъкът е от 1 до 20 коли.",
  km: "Въведи километража от таблото.",
  kmLow: (last: number) => "По-малко е от последно записания (" + kmText(last) + " км). Провери таблото.",
  kmEnd: (last: number) => "Крайният км трябва да е поне " + kmText(last) + ".",
  kmStartOf: (n: string) => "Въведи началния км на " + n + ".",
  kmLowOf: (n: string, last: number) => "По-малко е от последно записания за " + n + " (" + kmText(last) + " км). Провери таблото.",
  kmHigh: "Над 2 000 км повече от последния запис. Провери числото.",
  float: "Въведи сума в евро, например 20,00.",
  nav: "Избери Google Maps или Waze.",
  nothingTake: "Избери поне една поръчка.",
  tooMany: "Най-много " + TAKE_MAX + " поръчки наведнъж.",
  taken: (n: string) => no(n) + " вече е взета от друг шофьор.",
  notReady: (n: string) => no(n) + " още не е готова.",
  cancelled: (n: string) => no(n) + " е отказана.",
  finished: (n: string) => no(n) + " вече е доставена.",
  askWait: (n: string) => no(n) + ": чакаш отговор от управителя за адреса.",
  askWaitOther: (n: string) => no(n) + ": чака се отговор от управителя за адреса.",
  askNeeded: (n: string) => no(n) + " е с адрес извън зоните. Питай управителя, преди да я вземеш.",
  askReturn: (n: string) => no(n) + ": управителят каза да остане в ресторанта.",
  askPickup: (n: string) => no(n) + ": управителят предлага вземане от място. Не я карай.",
  nothingGo: "Няма взети поръчки за тръгване.",
  notPicked: (n: string) => no(n) + " не е взета от теб.",
  notOnWay: (n: string) => "Първо натисни „Тръгвам“ за " + no(n) + ".",
  hasProblem: (n: string) => no(n) + " вече е с проблем. Натисни „Върнах я“ или „Доставих все пак“.",
  noProblem: (n: string) => no(n) + " няма отворен проблем.",
  problemKind: "Избери какво се случи: „Няма никой“, „Грешен адрес“ или „Отказ“.",
  problemState: (n: string) => "Проблем се отбелязва само за взета поръчка или поръчка на път (" + no(n) + ").",
  sum: "Въведи сумата, която взе, например 24,50.",
  sumRange: (total: number) => "Сумата е поне " + String(total.toFixed(2)).replace(".", ",") + "\u00a0€ (поръчката, таксата се добавя). Провери я.",
  undoGone: "Вече не може да се отмени.",
  undoLate: "Времето за „Отмени“ изтече.",
  undoChanged: (n: string) => "Някой друг вече промени " + no(n) + ". Не може да се отмени.",
  askState: (n: string) => "За " + no(n) + " вече не може да се пита.",
  askGone: "Няма такъв въпрос.",
  askAnswered: "На този въпрос вече е отговорено.",
  askAnswer: "Избери един от трите отговора.",
  locked: (n: string) => "Караш към " + no(n) + " сега: остава първа.",
  edge: "Този адрес не може да се премести натам.",
  pick: "Избери „Път А“, „Път Б“ или „Моят ред“.",
  litres: "Въведи литрите от бележката.",
  litresMax: "Провери литрите: повече от " + LITRES_MAX + " л.",
  fuelSum: "Въведи сумата в евро.",
  fuelCash: (have: number) => "Имаш " + fmt(have) + " в брой. Останалото плати с карта или питай управителя.",
  photo: "Снимката не се качи. Снимай бележката пак.",
  receiptEmpty: "Избери снимка.",
  receiptLarge: "Снимката е до 5 MB.",
  receiptDemo: "В демото снимката е до 1 MB (на сървъра до 5 MB).",
  receiptType: "Трябва снимка в JPEG, PNG или WebP.",
  receiptMany: "Качи много снимки за кратко време. Опитай след малко.",
  unfinished: (list: string[]) => "Имаш " + (list.length === 1 ? "недоставена поръчка" : "недоставени поръчки") + ": " + list.map(no).join(", ") + (list.length === 1 ? ". Достави я или я върни" : ". Достави ги или ги върни") + " в ресторанта, преди да приключиш.",
  handed: "Отбележи, че си предал парите.",
  range: "Изберете период от-до, до 92 дни.",
  atBad: "Часът на действието е невалиден.",
  atFuture: "Часовникът на телефона е напред. Провери го и опитай пак.",
  atOld: "Действието е отпреди началото на смяната и не се записва.",
  atLate: "Записът е по-стар от 30 минути и не се записва. Кажи на управителя какво е станало.",
  atBefore: (n: string) => "Записът за " + no(n) + " е отпреди предишната ѝ стъпка и не се записва.",
  kmCar: "Въведи километража на колата.",
  kmShift: (who: string, km: number) => "Смяната на " + who + " започна с " + kmText(km) + " км. Километражът не може да е по-малко, докато е отворена.",
  photoUsed: "Тази снимка вече е в друго зареждане. Снимай бележката на това.",
  fuelGone: "Няма такова зареждане.",
  fuelNotCash: "Това зареждане не е платено в брой.",
  fuelConfirmed: "Бележката вече е видяна.",
};

/* ---------- stored documents ---------- */
export interface DriverCar { id: string; n: string; plate: string | null }
/** COL.modState "driver": the cars (a setting) and the last recorded km of each */
interface DriverDoc { id: "driver"; cars: DriverCar[]; km: Record<string, number>; updatedAt?: Iso }
/** the two generic cars of the prototype, [ЛИПСВА: коли: марка, рег. №] */
export const DEFAULT_CARS: DriverCar[] = [{ id: "a1", n: "Автомобил 1", plate: null }, { id: "a2", n: "Автомобил 2", plate: null }];

export interface DriverLeg { car: string; kmStart: number; kmEnd: number; from: Iso; to: Iso }
type Snap = Record<string, unknown>;
interface StepOrder { no: string; mark: string; prev: Snap }
type StepKind = "take" | "go" | "arrive" | "deliver" | "problem" | "returned";
interface DriverStep { id: string; kind: StepKind; at: number; until: number; driving: string | null; orders: StepOrder[] }
/** COL.shifts, role "driver": one per driver while "open" */
export interface DriverShift {
  id: string; role: "driver"; user: string; name: string; status: "open" | "closed"; startedAt: Iso; endedAt?: Iso;
  /** the leg being driven now; finished legs (a car change in the shift) are in `legs` */
  car: string; kmStart: number; legFrom: Iso; legs: DriverLeg[];
  /** the change taken from the restaurant at the start (null = not entered) */
  float: number | null;
  nav: NavApp; parked: "" | "parked" | "passenger";
  route: { pick: RoutePick; own: string[] | null };
  /** the delivery the driver is driving to: first in every route */
  driving: string | null;
  /** the last step (for "Отмени") */
  last: DriverStep | null;
  kmEnd?: number; closing?: ShiftTotals;
  createdAt: Iso; updatedAt: Iso;
}
/** COL.asks: the driver's question to the manager */
export interface DriverAsk {
  id: string; type: "outzone"; order: string; driver: string; name: string; at: Iso; status: "open" | "answered";
  zone: string; addr: string; note?: string; answer?: AskAnswer; answeredAt?: Iso; answeredBy?: string;
  /** the order right after the answer (the manager's "Отмени" works only while the driver has not acted) */
  mark?: string;
}
/** COL.fuel */
export interface FuelEntry {
  id: string; user: string; name: string; shift: string; car: string; litres: number; sum: number; km: number; full: boolean; cash: boolean;
  photo: string | null; noPhoto: boolean; at: Iso; createdAt: Iso;
  /** fuel paid from the cash: "Видях бележката" of the manager, the owner or the main admin (decision 18.11.2026, round 4) */
  confirmed?: { by: string; at: Iso };
}

/* ---------- views ---------- */
export interface CarView extends DriverCar {
  /** [ЛИПСВА: коли: марка, рег. №] while the car has no plate */
  missing: string | null; lastKm: number | null; uses: number; mostUsed: boolean;
  /** the name of another driver who has it in an open shift */
  busyBy: string | null;
}
export interface ShiftView {
  id: string; user: string; name: string; since: Iso; sinceAt: string; car: { id: string; n: string; plate: string | null; missing: string | null };
  kmStart: number; lastKm: number; legs: (DriverLeg & { n: string; km: number })[]; float: number | null; nav: NavApp; navLabel: string;
  parked: "" | "parked" | "passenger"; route: RoutePick; driving: string | null;
  /** the step "Отмени" may still take back */
  undo: { id: string; kind: StepKind; until: number; orders: string[] } | null;
}
export interface DriverState {
  user: { username: string; name: string; role: string }; shift: ShiftView | null; cars: CarView[]; undoMs: number;
  missing: typeof DRIVER_MISSING; navApps: typeof NAV_APPS;
}
export interface AskView {
  id: string; type: "outzone"; order: string; driver: string; driverName: string; mine: boolean; at: Iso; atClock: string; waitMin: number;
  status: "open" | "answered"; zone: string; addr: string; note: string | null;
  answer: AskAnswer | null; answerLabel: string | null; answeredAt: Iso | null; answeredBy: string | null;
  /** only right after answer(): until when answerUndo() works */
  undoUntil?: number;
}
export interface Delivery {
  no: string; st: DeliveryState; stLabel: string; status: OrderStatus;
  mine: boolean; driver: string | null; driverName: string | null; course: string | null;
  /** the address for the driver; the customer by name only (never the phone or the e-mail) */
  zone: string; addr: string; name: string; note: string | null;
  pay: PayMethod; payLabel: string;
  lines: { id: string; name: string; q: number; mods: string[]; unit: number | null; sum: number | null }[]; count: number;
  sub: number; disc: number; fee: number | null; feeKnown: boolean; total: number;
  /** cash to take at the door (a cash order; without the fee while the fee of a paid zone is unknown), else null */
  cashDue: number | null;
  placedAt: string; ts: number; sched: string;
  /** the promised time (epoch ms and "HH:MM" in Sofia): the order's time + its minutes, or the chosen hour */
  due: number | null; dueAt: string | null;
  /** minutes after the promised time (now, or when it was delivered); 0 = on time */
  late: number;
  /** "около": the zone's minutes + 2 min per previous address; null when it cannot be honest */
  eta: number | null; etaAt: string | null; etaLate: number;
  /** the place in the driver's current route (1..), 0 = not in it; locked = he is driving to it now */
  n: number; locked: boolean;
  pickedAt: Iso | null; onWayAt: Iso | null; arrivedAt: Iso | null; deliveredAt: Iso | null;
  problem: { kind: ProblemKind; label: string; at: Iso; note: string | null; solved: "" | "returned" | "delivered"; solvedAt: Iso | null } | null;
  collected: { pay: PayMethod; payLabel: string; sum: number; at: Iso; feeMissing: boolean } | null;
  /** the address is not in a zone we deliver to; ask: the latest question about this order and its answer */
  outzone: boolean; ask: AskView | null;
  /** why it was cancelled (the restaurant) */
  reason: string | null;
}
export interface DriverList {
  shift: ShiftView | null;
  /** "В ресторанта": ready, nobody took (the earliest promised time first) */
  waiting: Delivery[];
  /** taken and on the way in the order of the current route, then the ones with an open problem */
  active: Delivery[];
  /** of this shift: delivered, returned, cancelled (the newest first) */
  done: Delivery[];
  /** "Следваща": the one he drives to, else the first on the way, else the first of the route, else an open problem */
  next: string | null;
  sum: { active: number; cash: number; cashFeeMissing: boolean; done: number };
  route: { pick: RoutePick; locked: string | null };
}
export interface RouteOption {
  key: RoutePick; title: string; sub: string; order: string[]; zones: string[];
  /** no routing service yet: never an invented distance, time or fuel */
  km: null; minutes: null; fuel: null; note: string;
}
export interface RouteView {
  pick: RoutePick; options: RouteOption[]; same: boolean; stops: Delivery[]; locked: string | null; note: string; etaNote: string;
  /** a new course: the ready orders nobody took yet, in the proposed order (no "Моят ред" and no moves before "Взех") */
  preview?: boolean;
}
export interface StepResult { deliveries: Delivery[]; undo: { id: string; until: number } }
export interface FuelView {
  id: string; car: string; carName: string; litres: number; sum: number; perLitre: number; km: number; full: boolean; cash: boolean;
  photo: string | null; noPhoto: boolean; at: Iso; atClock: string; user: string; name: string; day: string;
  /** paid from the cash: confirmed by a boss ("Видях бележката") = taken off "За предаване"; pending until then */
  confirmed: { by: string; at: Iso; atClock: string } | null; pending: boolean;
}
export interface FuelPage { car: ShiftView["car"]; lastKm: number; cashOnHand: number; entries: FuelView[]; lastPerLitre: number | null }
export interface FuelInput { litres: number | string; sum: number | string; km: number | string; full?: boolean; cash?: boolean; photo?: string | null; noPhoto?: boolean; /** when it was entered on the phone (kept with no connection) */ at?: string | number }
export interface FuelReport {
  from: string; to: string; total: { n: number; litres: number; sum: number };
  byDay: { date: string; n: number; litres: number; sum: number }[];
  byDriver: { user: string; name: string; n: number; litres: number; sum: number }[];
  /** per100: litres per 100 km between two "догоре" entries of the car (null without two of them) */
  byCar: { car: string; n: string; entries: number; litres: number; sum: number; km: number | null; per100: number | null }[];
  rows: FuelView[];
}
export interface ShiftTotals {
  delivered: number; problems: number; fuel: number;
  cash: { rows: { no: string; zone: string; sum: number; feeMissing: boolean }[]; sum: number; feeMissing: boolean };
  float: number | null; fuelCash: number;
  /** fuel paid in cash without a photo of the receipt: not taken off yet, the manager checks the paper receipt */
  fuelCashPending: number;
  /** cash from the delivered orders + the start change - fuel paid in cash; owe: the restaurant owes the driver */
  handover: number; owe: boolean;
  cards: { n: number; sum: number }; vouchers: { n: number; sum: number };
  km: { legs: { car: string; n: string; kmStart: number; kmEnd: number | null; km: number | null }[]; total: number | null };
}
export interface ShiftSummary extends ShiftTotals {
  shift: ShiftView | null; closed: boolean; endedAt: Iso | null;
  /** what blocks "Приключи смяната": taken and not delivered, or a problem without an ending */
  unfinished: Delivery[];
  /** "Предадох ... на [ЛИПСВА]" (OPEN-QUESTIONS 25) */
  handTo: string;
}
export interface DriverRow {
  user: string; name: string; since: Iso; sinceAt: string; car: ShiftView["car"];
  status: DriverStatus; statusLabel: string;
  /** the current course in order (the finished stops first); next: the stop he drives to */
  course: { id: string | null; stops: { no: string; n: number; zone: string; addr: string; st: DeliveryState; stLabel: string; late: number; lateLabel: string | null; next: boolean; arrivedAt: Iso | null }[] };
  deliveredToday: number; problems: number;
  /** cash to hand over at the end of the shift (a sum per driver is not turnover: the manager may see it) */
  cash: number; cashTo: string;
  /** what the cash is made of (as the driver's end of shift): the cash orders + the start float - the fuel paid in cash */
  cashParts: { orders: number; float: number | null; fuel: number; fuelPending: number };
  /** fuel paid from the cash that waits for "Видях бележката" (the newest first) */
  fuelPending: { id: string; litres: number; sum: number; perLitre: number; km: number; car: string; carName: string; at: Iso; atClock: string; photo: string | null; noPhoto: boolean }[];
  /** no GPS in v1 (decision 17.11.2026) */
  position: null;
}
export interface DriversView {
  drivers: DriverRow[];
  /** ready deliveries nobody took */
  waiting: number;
  asks: AskView[];
  problems: { no: string; driver: string; driverName: string; kind: ProblemKind; label: string; note: string | null; at: Iso; zone: string; addr: string; solved: "" | "returned"; missing: string }[];
}

/* ---------- small helpers ---------- */
const lock = <T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> => serial(ctx.repo, "driver", fn);
/** an existing order is written only under serial(repo, "order:<№>") (the kitchen does the same), so two writers never
    overwrite each other; several orders: always in the order of their numbers (no deadlock) */
function orderLock<T>(ctx: Ctx, nos: string[], fn: () => Promise<T>): Promise<T> {
  const l = [...new Set(nos.map(String))].sort((a, b) => +a - +b || a.localeCompare(b));
  const run = (i: number): Promise<T> => (i >= l.length ? fn() : serial(ctx.repo, "order:" + l[i], () => run(i + 1)));
  return run(0);
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const clock = (ms: number): string => hhmm(sofiaNow(new Date(ms)));
const msOf = (i?: string | null): number | null => { const t = i ? Date.parse(i) : NaN; return isNaN(t) ? null : t; };
const nowMs = (ctx: Ctx): number => nowDate(ctx).getTime();
/** a whole number from the screen ("48 250", 48250); anything else NaN */
function whole(v: unknown): number {
  if (typeof v === "number") return Number.isInteger(v) ? v : NaN;
  const s = String(v ?? "").replace(/[\s ]/g, "");
  return /^\d{1,9}$/.test(s) ? +s : NaN;
}
/** litres from the screen: "42,5" / 42.5 */
function dec(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[\s ]/g, "").replace(",", ".");
  return /^\d{1,4}(\.\d{1,3})?$/.test(s) ? +s : NaN;
}
function bad(fields: Record<string, string>): never { return invalid(fields, DRIVER_MSG.check); }
function fail(code: string, message: string, status = 409, fields?: Record<string, string>): never { throw Object.assign(new CoreError(code, message, status), fields ? { fields } : {}); }

/** a step kept on the phone with no connection may be sent later with the moment it was made (`at`, ISO or epoch ms),
    as the kitchen's actions (decision 18.11.2026): at most 30 minutes back, never in the future (a minute for the phone's
    clock), never before the shift and never before the previous step of the orders it touches (a minute for the clocks;
    a little earlier is moved to that step). The window of "Отмени" counts from that moment. The log keeps both: `at` and
    the moment the server received it (`receivedAt`, `offline: true`). */
export const DRIVER_AT_SKEW_MS = 60_000, DRIVER_AT_BACK_MS = 30 * 60_000;
/** the moment of the last step of an order (a status, taken, arrived, a problem and its end) */
function lastStepMs(o: Order): number {
  const t = [...Object.values(o.times || {}), o.pickedAt, o.arrivedAt, o.problem && o.problem.at, o.problem && o.problem.solvedAt].map((x) => msOf(x as string | null | undefined) ?? 0);
  return Math.max(0, ...t);
}
type StepCtx = Ctx & { sent?: { receivedAt: Iso; offline: true } };
function stepAt(ctx: Ctx, sh: DriverShift, at: unknown, orders: Order[] = []): StepCtx {
  if (at == null || at === "") return ctx;
  const now = nowMs(ctx), t = typeof at === "number" ? at : Date.parse(String(at));
  const bad = (m: string) => Object.assign(new CoreError("bad_at", m, 422), { fields: { at: m } });
  if (!Number.isFinite(t)) throw bad(DRIVER_MSG.atBad);
  if (t > now + DRIVER_AT_SKEW_MS) throw bad(DRIVER_MSG.atFuture);
  const from = msOf(sh.startedAt) ?? 0;
  if (t < from) throw bad(DRIVER_MSG.atOld);
  if (t < now - DRIVER_AT_BACK_MS) throw bad(DRIVER_MSG.atLate);
  for (const o of orders) if (t < lastStepMs(o) - DRIVER_AT_SKEW_MS) throw bad(DRIVER_MSG.atBefore(o.no));
  const ms = Math.min(Math.max(t, from, ...orders.map(lastStepMs)), now);
  return { ...ctx, now: () => new Date(ms), sent: { receivedAt: new Date(now).toISOString(), offline: true } };
}
/** a line of the log of a step: with the moment it was received when it was made on the phone earlier */
const logStep = (cx: StepCtx, who: string, action: string, target: string, data: Record<string, unknown> = {}) => audit(cx, who, action, target, cx.sent ? { ...data, ...cx.sent } : data);
/** the promised time of an order (epoch ms): its time + the promised minutes, or the chosen hour of a pre-order */
export function dueOf(o: Pick<Order, "ts" | "eta" | "at" | "sched" | "createdAt">): number | null {
  if (o.eta != null && o.ts) return o.ts + o.eta * MIN;
  const m = /^(\d{2}):(\d{2})$/.exec(o.at || "");
  return m ? sofiaEpoch(orderDay(o), +m[1] * 60 + +m[2]) : null;
}
export function stateOf(o: Pick<Order, "status" | "driver" | "problem">): DeliveryState {
  if (o.status === "cancelled") return "cancelled";
  if (o.status === "delivered") return "done";
  if (o.problem && o.problem.solved !== "delivered") return "prob";
  if (o.status === "on_way") return "road";
  return o.driver ? "picked" : "wait";
}
const openProblem = (o: Order): boolean => stateOf(o) === "prob" && !o.problem!.solved;
/** taken and not finished: blocks the end of the shift */
const unfinishedState = (o: Order): boolean => { const st = stateOf(o); return st === "picked" || st === "road" || openProblem(o); };
const inRoute = (o: Order): boolean => { const st = stateOf(o); return st === "picked" || st === "road"; };
/** what "Отмени" puts back, and what tells that somebody else acted meanwhile */
const SNAP_KEYS = ["status", "times", "driver", "course", "pickedAt", "arrivedAt", "problem", "collected", "prevStatus"] as const;
const snap = (o: Order): Snap => clone(Object.fromEntries(SNAP_KEYS.map((k) => [k, o[k] ?? null])));
const mark = (o: Order): string => JSON.stringify([o.status, o.driver || "", o.course || "", o.pickedAt || "", o.arrivedAt || "", o.problem || null, o.collected || null, o.updatedAt, o.reason || ""]);
function restore(o: Order, prev: Snap): void {
  const t = o as unknown as Record<string, unknown>;
  for (const k of SNAP_KEYS) { if (prev[k] == null) delete t[k]; else t[k] = clone(prev[k]); }
}

async function getDoc(ctx: Ctx): Promise<DriverDoc> {
  const d = await ctx.repo.get<DriverDoc>(COL.modState, "driver");
  return { id: "driver", cars: d && Array.isArray(d.cars) && d.cars.length ? d.cars : clone(DEFAULT_CARS), km: (d && d.km) || {}, ...(d && d.updatedAt ? { updatedAt: d.updatedAt } : {}) };
}
async function putDoc(ctx: Ctx, d: DriverDoc): Promise<void> { d.updatedAt = iso(ctx); await ctx.repo.put(COL.modState, d); }
const setKm = (d: DriverDoc, car: string, km: number) => { d.km[car] = Math.max(d.km[car] || 0, km); };
const allShifts = (ctx: Ctx) => ctx.repo.list<DriverShift>(COL.shifts, { role: "driver" } as Partial<DriverShift>);
async function openShift(ctx: Ctx, user: string): Promise<DriverShift | null> {
  return (await ctx.repo.list<DriverShift>(COL.shifts, { user, role: "driver", status: "open" } as Partial<DriverShift>))[0] || null;
}
async function mustShift(ctx: Ctx, s: StaffCtx): Promise<DriverShift> {
  const sh = await openShift(ctx, s.user.username);
  if (!sh) throw new CoreError("no_shift", DRIVER_MSG.noShift, 409);
  return sh;
}
async function putShift(ctx: Ctx, sh: DriverShift): Promise<void> { sh.updatedAt = iso(ctx); await ctx.repo.put(COL.shifts, sh); }
const deliveryOrders = (ctx: Ctx) => ctx.repo.list<Order>(COL.orders, { mode: "delivery" } as Partial<Order>);
const carName = (cars: DriverCar[], id: string) => (cars.find((c) => c.id === id) || { n: id }).n;
const carLite = (cars: DriverCar[], id: string): ShiftView["car"] => { const c = cars.find((x) => x.id === id); return { id, n: c ? c.n : id, plate: c ? c.plate : null, missing: c && c.plate ? null : DRIVER_MISSING.cars }; };
/** the orders of a shift: taken by this driver from its start (to its end) */
const ofShift = (orders: Order[], sh: DriverShift): Order[] => orders.filter((o) => o.driver === sh.user && !!o.pickedAt && o.pickedAt >= sh.startedAt && (!sh.endedAt || o.pickedAt <= sh.endedAt));

/* ---------- the route ---------- */
interface Plan { A: string[]; B: string[]; own: string[] | null; pick: RoutePick; order: string[]; locked: string | null; eta: Map<string, number> }
function makePlan(stops: Order[], sh: DriverShift | null, zones: Map<string, ZoneRow>, now: number): Plan {
  const by = new Map(stops.map((o) => [o.no, o]));
  const due = (o: Order) => dueOf(o) ?? Number.MAX_SAFE_INTEGER, zm = (o: Order) => zones.get(o.zone)?.etaMin ?? Number.MAX_SAFE_INTEGER;
  /* A: the earliest promised time first. B: the nearest quarter first (the zone's delivery minutes as the distance),
     the addresses of one quarter together. No routing service: the order only, never kilometres */
  const A = [...stops].sort((a, b) => due(a) - due(b) || +a.no - +b.no).map((o) => o.no);
  const B = [...stops].sort((a, b) => zm(a) - zm(b) || a.zone.localeCompare(b.zone, "bg") || due(a) - due(b) || +a.no - +b.no).map((o) => o.no);
  let own: string[] | null = null;
  if (sh && sh.route.own) { own = sh.route.own.filter((n) => by.has(n)); for (const n of A) if (!own.includes(n)) own.push(n); if (!own.length) own = null; }
  const pick: RoutePick = sh && sh.route.pick === "own" ? (own ? "own" : "A") : sh && sh.route.pick === "B" ? "B" : "A";
  const base = pick === "own" ? own! : pick === "B" ? B : A;
  /* the delivery he drives to stays first in every variant; without one: the first "На път" of the chosen order */
  const road = (n: string) => by.get(n)!.status === "on_way";
  const locked = sh && sh.driving && by.has(sh.driving) && road(sh.driving) ? sh.driving : base.find(road) || null;
  const first = (l: string[]) => (locked ? [locked, ...l.filter((n) => n !== locked)] : l);
  const order = first(base), eta = new Map<string, number>();
  order.forEach((n, i) => {
    const o = by.get(n)!, z = zones.get(o.zone);
    if (!z) return;
    const from = o.status === "on_way" ? msOf(o.times && o.times.on_way) ?? now : now, t = from + (z.etaMin + STOP_MIN * i) * MIN;
    if (t >= now) eta.set(n, t); /* past the estimate: nothing honest to say */
  });
  return { A: first(A), B: first(B), own: own ? first(own) : null, pick, order, locked, eta };
}

/* ---------- what a call needs ---------- */
interface Scope { now: number; me: string; boss: boolean; orders: Order[]; zones: Map<string, ZoneRow>; asks: Map<string, DriverAsk>; names: Map<string, string>; shift: DriverShift | null; cars: DriverCar[]; plan: Plan }
async function scope(ctx: Ctx, s: StaffCtx): Promise<Scope> {
  const me = s.user.username;
  const [orders, zl, al, shift, staff, doc] = await Promise.all([deliveryOrders(ctx), liveZones(ctx), ctx.repo.list<DriverAsk>(COL.asks), openShift(ctx, me), ctx.repo.list<StaffUser>(COL.staff), getDoc(ctx)]);
  const zones = new Map(zl.map((z) => [z.n, z])), asks = new Map<string, DriverAsk>(), now = nowMs(ctx);
  for (const a of al.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0))) asks.set(a.order, a); /* the latest per order */
  const names = new Map(staff.map((u) => [u.username, u.name]));
  return { now, me, boss: isBoss(s), orders, zones, asks, names, shift, cars: doc.cars, plan: makePlan(orders.filter((o) => o.driver === me && inRoute(o)), shift, zones, now) };
}
function askView(a: DriverAsk, sc: Pick<Scope, "me" | "names" | "now">): AskView {
  const at = msOf(a.at) ?? sc.now;
  return {
    id: a.id, type: a.type, order: a.order, driver: a.driver, driverName: sc.names.get(a.driver) || a.name || a.driver, mine: a.driver === sc.me, at: a.at, atClock: clock(at),
    waitMin: a.status === "open" ? Math.max(0, Math.floor((sc.now - at) / MIN)) : 0, status: a.status, zone: a.zone, addr: a.addr, note: a.note || null,
    answer: a.answer || null, answerLabel: a.answer ? ANSWER_LABEL[a.answer] : null, answeredAt: a.answeredAt || null, answeredBy: a.answeredBy ? sc.names.get(a.answeredBy) || a.answeredBy : null,
  };
}
const isOutzone = (o: Order, zones: Map<string, ZoneRow>): boolean => !o.zone || !zones.has(o.zone);
/** why this order may not be taken / started now because of the address question (null = it may) */
function askBlock(o: Order, zones: Map<string, ZoneRow>, asks: Map<string, DriverAsk>, me = ""): string | null {
  const a = asks.get(o.no);
  if (a && a.status === "open") return a.driver === me ? DRIVER_MSG.askWait(o.no) : DRIVER_MSG.askWaitOther(o.no);
  if (a && a.answer === "return") return DRIVER_MSG.askReturn(o.no);
  if (a && a.answer === "pickup") return DRIVER_MSG.askPickup(o.no);
  if (!a && isOutzone(o, zones)) return DRIVER_MSG.askNeeded(o.no);
  return null;
}
/** never the phone, the e-mail, the tracking key, the profile */
function view(o: Order, sc: Scope): Delivery {
  const st = stateOf(o), mine = o.driver === sc.me, due = dueOf(o), delivered = st === "done" ? msOf(o.times && o.times.delivered) ?? msOf(o.updatedAt) : null;
  const ref = st === "done" ? delivered : st === "cancelled" || (st === "prob" && !!o.problem!.solved) ? null : sc.now;
  const late = due != null && ref != null && ref > due ? Math.max(1, Math.round((ref - due) / MIN)) : 0;
  const i = mine ? sc.plan.order.indexOf(o.no) : -1, eta = i > -1 ? sc.plan.eta.get(o.no) ?? null : null, a = sc.asks.get(o.no);
  const col = o.collected || (st === "done" ? { pay: o.pay, sum: o.total, at: o.times?.delivered || o.updatedAt, by: "", feeMissing: false } : null);
  return {
    no: o.no, st, stLabel: DELIVERY_LABEL[st], status: o.status, mine, driver: o.driver || null, driverName: o.driver ? sc.names.get(o.driver) || o.driver : null, course: o.course || null,
    zone: o.zone, addr: o.addr, name: o.name, note: o.note || null, pay: o.pay, payLabel: PAY_LABEL[o.pay] || o.payLabel,
    lines: o.lines.map((l) => ({ id: l.id, name: l.name || l.id, q: l.q, mods: l.mods || [], unit: l.unit ?? null, sum: l.unit != null ? round2(l.unit * l.q) : null })),
    count: o.lines.reduce((n, l) => n + l.q, 0), sub: o.sub, disc: o.disc, fee: o.fee, feeKnown: o.fee !== null, total: o.total, cashDue: o.pay === "cash" ? o.total : null,
    placedAt: o.placedAt, ts: o.ts, sched: o.sched, due, dueAt: due != null ? clock(due) : null, late,
    eta, etaAt: eta != null ? clock(eta) : null, etaLate: eta != null && due != null && eta > due ? Math.max(1, Math.round((eta - due) / MIN)) : 0,
    n: i + 1, locked: i > -1 && sc.plan.locked === o.no,
    pickedAt: o.pickedAt || null, onWayAt: (o.times && o.times.on_way) || null, arrivedAt: o.arrivedAt || null, deliveredAt: (o.times && o.times.delivered) || null,
    problem: o.problem ? { kind: o.problem.kind, label: PROBLEM_LABEL[o.problem.kind], at: o.problem.at, note: o.problem.note || null, solved: o.problem.solved || "", solvedAt: o.problem.solvedAt || null } : null,
    collected: col ? { pay: col.pay, payLabel: PAY_LABEL[col.pay], sum: col.sum, at: col.at, feeMissing: !!col.feeMissing } : null,
    outzone: isOutzone(o, sc.zones), ask: a ? askView(a, sc) : null, reason: st === "cancelled" ? o.reason || null : null,
  };
}
function shiftView(sh: DriverShift, cars: DriverCar[], lastKm: number, now: number): ShiftView {
  const st = sh.last;
  return {
    id: sh.id, user: sh.user, name: sh.name, since: sh.startedAt, sinceAt: clock(msOf(sh.startedAt) ?? now), car: carLite(cars, sh.car), kmStart: sh.kmStart, lastKm,
    legs: sh.legs.map((l) => ({ ...l, n: carName(cars, l.car), km: l.kmEnd - l.kmStart })), float: sh.float, nav: sh.nav, navLabel: NAV_APPS[sh.nav], parked: sh.parked,
    route: sh.route.pick, driving: sh.driving,
    undo: st && sh.status === "open" && st.until >= now ? { id: st.id, kind: st.kind, until: st.until, orders: st.orders.map((x) => x.no) } : null,
  };
}
const lastKmOf = (d: DriverDoc, sh: DriverShift): number => Math.max(d.km[sh.car] || 0, sh.kmStart);
async function myShiftView(ctx: Ctx, sh: DriverShift | null): Promise<ShiftView | null> {
  if (!sh) return null;
  const d = await getDoc(ctx);
  return shiftView(sh, d.cars, lastKmOf(d, sh), nowMs(ctx));
}
const course = (ctx: Ctx, driver: string, kind: string, orders: string[] = [], extra: Record<string, unknown> = {}) => emit(ctx, "driver.course", { driver, kind, orders, ...extra });

/* ---------- 1. the shift ---------- */
async function carViews(ctx: Ctx, d: DriverDoc, user: string): Promise<CarView[]> {
  const shifts = await allShifts(ctx), uses = new Map<string, number>();
  for (const sh of shifts) if (sh.user === user) for (const c of [...sh.legs.map((l) => l.car), sh.car]) uses.set(c, (uses.get(c) || 0) + 1);
  const open = shifts.filter((x) => x.status === "open" && x.user !== user);
  const list = d.cars.map((c, i) => ({ c, i, u: uses.get(c.id) || 0 })).sort((a, b) => b.u - a.u || a.i - b.i);
  return list.map(({ c, u }, k) => ({ id: c.id, n: c.n, plate: c.plate, missing: c.plate ? null : DRIVER_MISSING.cars, lastKm: d.km[c.id] ?? null, uses: u, mostUsed: k === 0 && u > 0, busyBy: open.find((x) => x.car === c.id)?.name || null }));
}
/** who is signed in, his open shift (or null) and the cars (the most used one first): the screen after the sign-in */
export async function state(ctx: Ctx, s: StaffCtx): Promise<DriverState> {
  need(s, "driver");
  const d = await getDoc(ctx), sh = await openShift(ctx, s.user.username);
  return {
    user: { username: s.user.username, name: s.user.name, role: s.user.role }, shift: sh ? shiftView(sh, d.cars, lastKmOf(d, sh), nowMs(ctx)) : null,
    cars: await carViews(ctx, d, s.user.username), undoMs: DRIVER_UNDO_MS, missing: DRIVER_MISSING, navApps: NAV_APPS,
  };
}
export interface ShiftStart { car: string; km: number | string; float?: number | string | null; nav?: NavApp }
/** "Започни смяната": the car, the km from the dashboard (not below the car's last one), the change taken (may be empty).
    422 fields car / km / float; 409 shift_open. Log: driver.shift_start. */
export async function start(ctx: Ctx, s: StaffCtx, input: ShiftStart): Promise<DriverState> {
  need(s, "driver");
  await lock(ctx, async () => {
    const me = s.user.username, i = (input && typeof input === "object" ? input : {}) as Partial<ShiftStart>;
    if (await openShift(ctx, me)) throw new CoreError("shift_open", DRIVER_MSG.shiftOpen, 409);
    const d = await getDoc(ctx), f: Record<string, string> = {};
    const car = d.cars.find((c) => c.id === String(i.car || ""));
    const other = car ? (await allShifts(ctx)).find((x) => x.status === "open" && x.car === car.id) : undefined;
    if (!car) f.car = DRIVER_MSG.car; else if (other) f.car = DRIVER_MSG.carTaken(other.name);
    const km = whole(i.km);
    if (!(km > 0) || km > KM_MAX) f.km = DRIVER_MSG.km; else if (car && km < (d.km[car.id] || 0)) f.km = DRIVER_MSG.kmLow(d.km[car.id]);
    else if (car && d.km[car.id] && km > d.km[car.id] + KM_JUMP) f.km = DRIVER_MSG.kmHigh;
    const fl = money(i.float);
    if (fl !== null && !(fl >= 0)) f.float = DRIVER_MSG.float;
    if (i.nav != null && !NAV_APPS[i.nav]) f.nav = DRIVER_MSG.nav;
    if (Object.keys(f).length) bad(f);
    const now = iso(ctx);
    const sh: DriverShift = {
      id: rid(8), role: "driver", user: me, name: s.user.name, status: "open", startedAt: now, car: car!.id, kmStart: km, legFrom: now, legs: [], float: fl === null ? null : round2(fl),
      nav: i.nav || "google", parked: "", route: { pick: "A", own: null }, driving: null, last: null, createdAt: now, updatedAt: now,
    };
    await ctx.repo.put(COL.shifts, sh);
    setKm(d, sh.car, km); await putDoc(ctx, d);
    await audit(ctx, me, "driver.shift_start", sh.id, { car: sh.car, km, float: sh.float });
    course(ctx, me, "shift_start");
  });
  return state(ctx, s);
}
/** the navigation app and "Аз съм пътник" / "Паркирах" ("" = neither), remembered for the shift. Log: driver.prefs. */
export async function prefs(ctx: Ctx, s: StaffCtx, patch: { nav?: NavApp; parked?: "" | "parked" | "passenger" }): Promise<DriverState> {
  need(s, "driver");
  await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), p = patch && typeof patch === "object" ? patch : {}, f: Record<string, string> = {};
    if (p.nav !== undefined && !NAV_APPS[p.nav]) f.nav = DRIVER_MSG.nav;
    if (p.parked !== undefined && !["", "parked", "passenger"].includes(p.parked)) f.parked = DRIVER_MSG.check;
    if (Object.keys(f).length) bad(f);
    const before = { nav: sh.nav, parked: sh.parked };
    if (p.nav !== undefined) sh.nav = p.nav;
    if (p.parked !== undefined) sh.parked = p.parked;
    if (before.nav === sh.nav && before.parked === sh.parked) return;
    await putShift(ctx, sh);
    await audit(ctx, sh.user, "driver.prefs", sh.id, { nav: sh.nav, parked: sh.parked });
  });
  return state(ctx, s);
}
/** "Смених колата": the end of this car (end km) + the start of the other one (start km) in the same shift.
    422 fields car / kmEnd / kmStart. Log: driver.car. */
export async function changeCar(ctx: Ctx, s: StaffCtx, input: { car: string; kmEnd: number | string; kmStart: number | string }): Promise<DriverState> {
  need(s, "driver");
  await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), d = await getDoc(ctx), i = (input && typeof input === "object" ? input : {}) as Partial<typeof input>, f: Record<string, string> = {};
    const car = d.cars.find((c) => c.id === String(i.car || ""));
    const other = car ? (await allShifts(ctx)).find((x) => x.status === "open" && x.car === car.id && x.user !== sh.user) : undefined;
    if (!car) f.car = DRIVER_MSG.car; else if (car.id === sh.car) f.car = DRIVER_MSG.carSame; else if (other) f.car = DRIVER_MSG.carTaken(other.name);
    const last = lastKmOf(d, sh), kmEnd = whole(i.kmEnd), kmStart = whole(i.kmStart);
    if (!(kmEnd > 0) || kmEnd > KM_MAX || kmEnd < last) f.kmEnd = DRIVER_MSG.kmEnd(last);
    if (car && !f.car) {
      const l2 = d.km[car.id] || 0;
      if (!(kmStart > 0) || kmStart > KM_MAX) f.kmStart = DRIVER_MSG.kmStartOf(car.n);
      else if (kmStart < l2) f.kmStart = DRIVER_MSG.kmLowOf(car.n, l2);
      else if (l2 && kmStart > l2 + KM_JUMP) f.kmStart = DRIVER_MSG.kmHigh;
    }
    if (Object.keys(f).length) bad(f);
    const now = iso(ctx), from = sh.car;
    sh.legs.push({ car: sh.car, kmStart: sh.kmStart, kmEnd, from: sh.legFrom, to: now });
    setKm(d, sh.car, kmEnd); setKm(d, car!.id, kmStart);
    sh.car = car!.id; sh.kmStart = kmStart; sh.legFrom = now;
    await putShift(ctx, sh); await putDoc(ctx, d);
    await audit(ctx, sh.user, "driver.car", sh.id, { from, kmEnd, to: sh.car, kmStart });
    course(ctx, sh.user, "car");
  });
  return state(ctx, s);
}
/** a wrong last km of a car (a typo in fuel or at the end of a shift): the main admin, the owner, the manager set it.
    422 fields km; 404 car. Log: driver.car_km with the old and the new km. */
export async function setCarKm(ctx: Ctx, s: StaffCtx, car: string, km: number | string): Promise<CarView[]> {
  needBoss(s, ["driver", "settings"]);
  return lock(ctx, async () => {
    const d = await getDoc(ctx), c = d.cars.find((x) => x.id === String(car || ""));
    if (!c) throw new CoreError("not_found", DRIVER_MSG.car, 404);
    const v = whole(km);
    if (!(v > 0) || v > KM_MAX) bad({ km: DRIVER_MSG.kmCar });
    const was = d.km[c.id] ?? null;
    /* an open shift with this car keeps its start km: the record is never put below it */
    const open = (await allShifts(ctx)).find((x) => x.status === "open" && x.car === c.id);
    if (open && v < open.kmStart) bad({ km: DRIVER_MSG.kmShift(open.name, open.kmStart) });
    d.km[c.id] = v;
    await putDoc(ctx, d);
    await audit(ctx, s.user.username, "driver.car_km", c.id, { from: was, to: v });
    return carViews(ctx, d, s.user.username);
  });
}
/** the cars (a setting; the main admin, the owner, the manager): [{id?, n, plate?}], 1-20. Log: driver.cars. */
export async function saveCars(ctx: Ctx, s: StaffCtx, list: { id?: string; n: string; plate?: string | null }[]): Promise<CarView[]> {
  needBoss(s, ["driver", "settings"]);
  return lock(ctx, async () => {
    const d = await getDoc(ctx), f: Record<string, string> = {}, l = Array.isArray(list) ? list : [];
    if (l.length < 1 || l.length > 20) bad({ cars: DRIVER_MSG.carList });
    const next: DriverCar[] = l.map((c, i) => {
      const n = String((c && c.n) || "").replace(/\s+/g, " ").trim(), plate = String((c && c.plate) || "").replace(/\s+/g, " ").trim().toUpperCase();
      if (!n || n.length > 40) f["cars." + i + ".n"] = DRIVER_MSG.carName;
      if (plate.length > 16) f["cars." + i + ".plate"] = DRIVER_MSG.carPlate;
      const id = c && typeof c.id === "string" && d.cars.some((x) => x.id === c.id) ? c.id : "c" + rid(4);
      return { id, n, plate: plate || null };
    });
    if (new Set(next.map((c) => c.id)).size !== next.length) f.cars = DRIVER_MSG.carList;
    const open = (await allShifts(ctx)).filter((x) => x.status === "open");
    for (const c of d.cars) if (!next.some((x) => x.id === c.id) && open.some((x) => x.car === c.id)) f.cars = DRIVER_MSG.carInUse(c.n);
    if (Object.keys(f).length) bad(f);
    d.cars = next;
    await putDoc(ctx, d);
    await audit(ctx, s.user.username, "driver.cars", "driver", { cars: next });
    return carViews(ctx, d, s.user.username);
  });
}

/* ---------- 2. the deliveries ---------- */
const byDue = (a: Order, b: Order) => (dueOf(a) ?? Number.MAX_SAFE_INTEGER) - (dueOf(b) ?? Number.MAX_SAFE_INTEGER) || +a.no - +b.no;
const finishedAt = (o: Order): number => msOf(o.times && o.times.delivered) ?? msOf(o.problem && o.problem.solvedAt) ?? msOf(o.updatedAt) ?? 0;
function listOf(sc: Scope, all: boolean): DriverList {
  const waiting = sc.orders.filter((o) => o.status === "ready" && !o.driver).sort(byDue);
  const pos = (o: Order) => { const i = sc.plan.order.indexOf(o.no); return i < 0 ? 1e6 : i; };
  const whose = (o: Order) => (all ? !!o.driver : o.driver === sc.me);
  const active = sc.orders.filter((o) => whose(o) && unfinishedState(o))
    .sort((a, b) => +openProblem(a) - +openProblem(b) || +(a.driver !== sc.me) - +(b.driver !== sc.me) || pos(a) - pos(b) || (a.driver || "").localeCompare(b.driver || "") || byDue(a, b));
  const today = sofiaYmd(new Date(sc.now));
  const doneOf = all ? sc.orders.filter((o) => !!o.driver && !!o.pickedAt && sofiaYmd(new Date(o.pickedAt)) === today) : sc.shift ? ofShift(sc.orders, sc.shift) : [];
  const done = doneOf.filter((o) => !unfinishedState(o) && stateOf(o) !== "wait").sort((a, b) => finishedAt(b) - finishedAt(a));
  const mineActive = active.filter((o) => o.driver === sc.me), inR = mineActive.filter(inRoute);
  const next = sc.plan.locked || sc.plan.order[0] || (mineActive[0] && mineActive[0].no) || null;
  const cashL = mineActive.filter((o) => o.pay === "cash");
  return {
    shift: sc.shift ? shiftView(sc.shift, sc.cars, sc.shift.kmStart, sc.now) : null, waiting: waiting.map((o) => view(o, sc)), active: active.map((o) => view(o, sc)), done: done.map((o) => view(o, sc)), next,
    sum: { active: mineActive.length, cash: round2(cashL.reduce((a, o) => a + o.total, 0)), cashFeeMissing: cashL.some((o) => o.fee === null), done: done.filter((o) => stateOf(o) === "done").length },
    route: { pick: sc.plan.pick, locked: inR.length ? sc.plan.locked : null },
  };
}
/** "Моите доставки": the ready ones nobody took, mine in the order of the route, the finished ones of the shift.
    {all: true} (the main admin, the owner, the manager): every driver's deliveries of today. */
export async function list(ctx: Ctx, s: StaffCtx, opts: { all?: boolean } = {}): Promise<DriverList> {
  need(s, "driver");
  const all = !!(opts && opts.all);
  if (all && !isBoss(s)) throw new CoreError("forbidden", RIGHTS_MSG.boss, 403);
  const sc = await scope(ctx, s), l = listOf(sc, all);
  l.shift = await myShiftView(ctx, sc.shift);
  return l;
}
/** may this staff member see the delivery: his own, a ready one nobody took; the bosses any delivery */
const visible = (o: Order, sc: Pick<Scope, "me" | "boss">): boolean => o.mode === "delivery" && (sc.boss || o.driver === sc.me || (o.status === "ready" && !o.driver));
/** one delivery. 404 for another driver's delivery (it does not say whether the number exists). */
export async function get(ctx: Ctx, s: StaffCtx, n: string): Promise<Delivery> {
  need(s, "driver");
  const sc = await scope(ctx, s), o = sc.orders.find((x) => x.no === String(n || ""));
  if (!o || !visible(o, sc)) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
  return view(o, sc);
}
async function result(ctx: Ctx, s: StaffCtx, nos: string[], step: DriverStep): Promise<StepResult> {
  const sc = await scope(ctx, s);
  return { deliveries: nos.map((n) => sc.orders.find((o) => o.no === n)).filter((o): o is Order => !!o).map((o) => view(o, sc)), undo: { id: step.id, until: step.until } };
}
function newStep(ctx: Ctx, sh: DriverShift, kind: StepKind): DriverStep {
  const at = nowMs(ctx);
  return { id: rid(6), kind, at, until: at + DRIVER_UNDO_MS, driving: sh.driving, orders: [] };
}
/** after a step: the delivery he drives to stays while it is on the way; else the first "На път" of the current order */
function relock(sh: DriverShift, mine: Order[], zones: Map<string, ZoneRow>, now: number): void {
  const stops = mine.filter(inRoute);
  if (sh.driving && !stops.some((o) => o.no === sh.driving && o.status === "on_way")) sh.driving = null;
  sh.driving = makePlan(stops, sh, zones, now).locked;
}
const uniq = (l: unknown): string[] => [...new Set((Array.isArray(l) ? l : l == null ? [] : [l]).map((x) => String(x).trim()).filter(Boolean))];

/** "Взех N поръчки": the driver, the course and the time; all or none. 409 taken (another driver has it: fields
    {<№>: text}), not_ready, ask_required; 404 for a number that is not a delivery. Log: driver.take per order. */
export async function take(ctx: Ctx, s: StaffCtx, nos: string[], opt: { at?: string | number } = {}): Promise<StepResult> {
  need(s, "driver");
  const done = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user, l = uniq(nos);
    if (!l.length) fail("nothing", DRIVER_MSG.nothingTake, 422);
    if (l.length > TAKE_MAX) fail("too_many", DRIVER_MSG.tooMany, 422);
    return orderLock(ctx, l, async () => {
    const zones = new Map((await liveZones(ctx)).map((z) => [z.n, z])), asks = new Map<string, DriverAsk>();
    for (const a of (await ctx.repo.list<DriverAsk>(COL.asks)).sort((x, y) => (x.at < y.at ? -1 : 1))) asks.set(a.order, a);
    const f: Record<string, string> = {}, todo: Order[] = [];
    let code = "";
    for (const n of l) {
      const o = await ctx.repo.get<Order>(COL.orders, n);
      if (!o || o.mode !== "delivery") { f[n] = DRIVER_MSG.notFound; code = code || "not_found"; continue; }
      if (o.driver === me && o.status !== "cancelled") continue; /* already mine: nothing to do */
      if (o.driver) { f[n] = DRIVER_MSG.taken(n); code = "taken"; continue; }
      if (o.status !== "ready") { f[n] = o.status === "cancelled" ? DRIVER_MSG.cancelled(n) : o.status === "delivered" || o.status === "on_way" ? DRIVER_MSG.finished(n) : DRIVER_MSG.notReady(n); if (code !== "taken") code = "not_ready"; continue; }
      const why = askBlock(o, zones, asks, me);
      if (why) { f[n] = why; code = code || "ask_required"; continue; }
      todo.push(o);
    }
    const first = Object.keys(f)[0];
    if (first) fail(code, f[first], code === "not_found" ? 404 : 409, f);
    const cx = stepAt(ctx, sh, opt.at, todo);
    const mine = (await deliveryOrders(ctx)).filter((o) => o.driver === me);
    /* one trip: joins the course he has not finished yet, else a new one */
    const cur = mine.find(unfinishedState), courseId = (cur && cur.course) || rid(6), now = iso(cx), step = newStep(cx, sh, "take");
    for (const o of todo) {
      const prev = snap(o);
      o.driver = me; o.course = courseId; o.pickedAt = now; delete o.arrivedAt; delete o.problem; delete o.collected; o.updatedAt = now;
      await ctx.repo.put(COL.orders, o);
      step.orders.push({ no: o.no, mark: mark(o), prev });
      await logStep(cx, me, "driver.take", o.no, { course: courseId });
    }
    if (step.orders.length) { sh.last = step; await putShift(cx, sh); course(cx, me, "take", step.orders.map((x) => x.no), { course: courseId }); }
    return { step, nos: l };
    });
  });
  return result(ctx, s, done.nos, done.step);
}
/** "Тръгвам": without numbers ALL taken ones go "На път" (the list), with numbers only those (one delivery). The ones
    waiting for the manager's answer about the address stay (skipped). 409 nothing / bad_state / ask_required. */
export async function go(ctx: Ctx, s: StaffCtx, nos?: string[], opt: { at?: string | number } = {}): Promise<StepResult & { skipped: { no: string; why: string }[] }> {
  need(s, "driver");
  const done = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user, l = uniq(nos);
    const pre = l.length ? l : (await deliveryOrders(ctx)).filter((o) => o.driver === me && stateOf(o) === "picked").map((o) => o.no);
    return orderLock(ctx, pre, async () => {
    const sc = await scope(ctx, s);
    const mine = sc.orders.filter((o) => o.driver === me), skipped: { no: string; why: string }[] = [];
    let targets: Order[] = [];
    if (l.length) {
      const f: Record<string, string> = {};
      let code = "";
      for (const n of l) {
        const o = mine.find((x) => x.no === n), st = o ? stateOf(o) : null;
        if (!o) { f[n] = DRIVER_MSG.notFound; code = code || "not_found"; continue; }
        if (st === "road") continue;
        if (st !== "picked") { f[n] = st === "prob" ? DRIVER_MSG.hasProblem(n) : st === "cancelled" ? DRIVER_MSG.cancelled(n) : DRIVER_MSG.finished(n); code = code || "bad_state"; continue; }
        if (o.status !== "ready") { f[n] = DRIVER_MSG.notReady(n); code = code || "not_ready"; continue; }
        const why = askBlock(o, sc.zones, sc.asks, me);
        if (why) { f[n] = why; code = code || "ask_required"; continue; }
        targets.push(o);
      }
      const first = Object.keys(f)[0];
      if (first) fail(code, f[first], code === "not_found" ? 404 : 409, f);
    } else {
      for (const o of mine.filter((x) => stateOf(x) === "picked")) {
        const why = o.status !== "ready" ? DRIVER_MSG.notReady(o.no) : askBlock(o, sc.zones, sc.asks, me);
        if (why) skipped.push({ no: o.no, why }); else targets.push(o);
      }
      if (!targets.length) fail("nothing", skipped.length ? skipped[0].why : DRIVER_MSG.nothingGo, 409);
    }
    /* in the order of the route: the first one becomes the delivery he drives to */
    const pos = (o: Order) => { const i = sc.plan.order.indexOf(o.no); return i < 0 ? 1e6 : i; };
    targets = targets.sort((a, b) => pos(a) - pos(b));
    const cx = stepAt(ctx, sh, opt.at, targets);
    const step = newStep(cx, sh, "go");
    for (const o of targets) {
      const prev = snap(o), o2 = await setOrderStatus(cx, o.no, "on_way", me, s);
      step.orders.push({ no: o.no, mark: mark(o2), prev });
      Object.assign(o, o2);
    }
    if (step.orders.length) {
      relock(sh, mine, sc.zones, sc.now);
      sh.last = step; await putShift(cx, sh);
      if (cx.sent) for (const x of step.orders) await logStep(cx, me, "driver.go", x.no);
      course(cx, me, "go", step.orders.map((x) => x.no), { driving: sh.driving });
    }
    return { step, nos: l.length ? l : targets.map((o) => o.no), skipped };
    });
  });
  return { ...(await result(ctx, s, done.nos, done.step)), skipped: done.skipped };
}
/** the customer's browsers that asked for notifications: "Шофьорът е пред входа" (in the background, as the status) */
async function pushArrived(ctx: Ctx, o: Order): Promise<number> {
  if (!ctx.push) return 0;
  const subs = await ctx.repo.list<PushSub>(COL.push, { orderNo: o.no } as Partial<PushSub>);
  if (!subs.length) return 0;
  const payload: PushPayload = { title: "Поръчка № " + o.no + " · Siracusa", body: ARRIVED_TEXT + ".", url: "/porachka/" + o.no + (o.key ? "-" + o.key : "") + "/", tag: "sc-order-" + o.no };
  const send = ctx.push;
  void (async () => {
    let gone: string[] = [];
    try { gone = await send(subs, payload); } catch { /* a push service that is down never breaks the step */ }
    for (const x of subs) if (gone.includes(x.endpoint)) await ctx.repo.del(COL.push, x.id);
  })();
  return subs.length;
}
export const ARRIVED_TEXT = "Шофьорът е пред входа";
export interface ArriveResult extends StepResult { notified: { page: true; push: number; sms: null; smsMissing: string } }
/** "Пристигнах": the time, and the customer is told "Шофьорът е пред входа" (the tracking page through the order's event,
    Web Push; SMS is [ЛИПСВА: доставчик за SMS]). The order becomes the one he drives to. Log: driver.arrive. */
export async function arrive(ctx: Ctx, s: StaffCtx, n: string, opt: { at?: string | number } = {}): Promise<ArriveResult> {
  need(s, "driver");
  const done = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user;
    return orderLock(ctx, [String(n || "")], async () => {
    const o = await ctx.repo.get<Order>(COL.orders, String(n || ""));
    if (!o || o.mode !== "delivery" || o.driver !== me) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
    const st = stateOf(o);
    if (st !== "road") fail("bad_state", st === "picked" ? DRIVER_MSG.notOnWay(o.no) : st === "prob" ? DRIVER_MSG.hasProblem(o.no) : st === "cancelled" ? DRIVER_MSG.cancelled(o.no) : DRIVER_MSG.finished(o.no));
    const cx = stepAt(ctx, sh, opt.at, [o]);
    const step = newStep(cx, sh, "arrive");
    let push = 0;
    if (!o.arrivedAt) {
      const prev = snap(o), now = iso(cx);
      o.arrivedAt = now; o.updatedAt = now;
      await ctx.repo.put(COL.orders, o);
      step.orders.push({ no: o.no, mark: mark(o), prev });
      sh.driving = o.no; sh.last = step; await putShift(cx, sh);
      await logStep(cx, me, "driver.arrive", o.no);
      emit(cx, "order.status", { no: o.no, status: o.status, at: now, arrivedAt: now }, { order: o.no });
      course(cx, me, "arrive", [o.no]);
      push = await pushArrived(ctx, o);
    }
    return { step, push, no: o.no };
    });
  });
  return { ...(await result(ctx, s, [done.no], done.step)), notified: { page: true, push: done.push, sms: null, smsMissing: DRIVER_MISSING.sms } };
}
/** "Доставена · взех X €": "Доставена" through the existing rules, and what was taken at the door: for a cash order the
    sum (default: the order's total), a card / voucher as such. With an open problem: "Доставих все пак".
    409 bad_state ("Тръгвам" first); 422 fields.sum. Log: order.status + driver.deliver. */
export async function deliver(ctx: Ctx, s: StaffCtx, n: string, input: { sum?: number | string | null; at?: string | number } = {}): Promise<StepResult> {
  need(s, "driver");
  const done = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user;
    return orderLock(ctx, [String(n || "")], async () => {
    const o = await ctx.repo.get<Order>(COL.orders, String(n || ""));
    if (!o || o.mode !== "delivery" || o.driver !== me) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
    const st = stateOf(o), anyway = openProblem(o);
    if (st === "picked") fail("bad_state", DRIVER_MSG.notOnWay(o.no));
    if (!(st === "road" || anyway)) fail("bad_state", st === "cancelled" ? DRIVER_MSG.cancelled(o.no) : st === "prob" ? DRIVER_MSG.noProblem(o.no) : DRIVER_MSG.finished(o.no));
    if (o.status !== "on_way" && o.status !== "ready") fail("not_ready", DRIVER_MSG.notReady(o.no));
    /* the collected sum is asked only when it is not clear (cash and the fee of a paid zone unknown): then it is at least the
       order's total and at most twice it (a safety bound, not a price); a clear order always records its own total
       (shofyor.review-2, round 2: one request could make "За предаване" smaller) */
    const outzone = o.pay === "cash" && isOutzone(o, new Map((await liveZones(ctx)).map((z) => [z.n, z])));
    const asked = o.pay === "cash" && (o.fee === null || outzone);
    const raw = input && typeof input === "object" ? input.sum : null, given = asked ? money(raw) : null;
    if (asked && raw != null && raw !== "" && (given === null || !Number.isFinite(given))) bad({ sum: DRIVER_MSG.sum });
    if (given !== null && !(given >= o.total && given <= round2(o.total * 10))) bad({ sum: DRIVER_MSG.sumRange(o.total) });
    const cx = stepAt(ctx, sh, input && typeof input === "object" ? input.at : undefined, [o]);
    const sum = o.pay === "cash" && given !== null ? round2(given) : o.total, prev = snap(o), step = newStep(cx, sh, "deliver");
    if (o.status === "ready") await setOrderStatus(cx, o.no, "on_way", me, s); /* "Доставих все пак" of a taken order */
    const o2 = await setOrderStatus(cx, o.no, "delivered", me, s), now = o2.times?.delivered || iso(cx);
    o2.collected = { pay: o2.pay, sum, at: now, by: me, ...(asked && given === null ? { feeMissing: true } : {}) };
    if (o2.problem) o2.problem = { ...o2.problem, solved: "delivered", solvedAt: now };
    await ctx.repo.put(COL.orders, o2);
    step.orders.push({ no: o2.no, mark: mark(o2), prev });
    const mine = (await deliveryOrders(ctx)).filter((x) => x.driver === me), zones = new Map((await liveZones(ctx)).map((z) => [z.n, z]));
    relock(sh, mine, zones, nowMs(cx));
    sh.last = step; await putShift(cx, sh);
    await logStep(cx, me, "driver.deliver", o2.no, { pay: o2.pay, sum, ...(anyway ? { afterProblem: o2.problem!.kind } : {}), ...(o2.collected.feeMissing ? { feeMissing: true } : {}) });
    course(cx, me, "deliver", [o2.no], { driving: sh.driving });
    return { step, no: o2.no };
    });
  });
  return result(ctx, s, [done.no], done.step);
}

/* ---------- 3. a problem ---------- */
/** "Няма никой" | "Грешен адрес" | "Отказ" (+ a note), only for a taken order or one on the way. The restaurant hears
    it (driver.course kind "problem"), the manager sees it (drivers().problems); the customer's page gets a neutral state.
    How long to wait and what happens with the food: [ЛИПСВА] (OPEN-QUESTIONS 23). Log: driver.problem. */
export async function problem(ctx: Ctx, s: StaffCtx, n: string, kind: ProblemKind, note?: string, opt: { at?: string | number } = {}): Promise<StepResult> {
  need(s, "driver");
  const done = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user;
    return orderLock(ctx, [String(n || "")], async () => {
    const o = await ctx.repo.get<Order>(COL.orders, String(n || ""));
    if (!o || o.mode !== "delivery" || o.driver !== me) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
    if (!PROBLEM_KINDS.includes(kind)) bad({ kind: DRIVER_MSG.problemKind });
    const st = stateOf(o);
    if (st === "prob") fail("has_problem", o.problem!.solved ? DRIVER_MSG.noProblem(o.no) : DRIVER_MSG.hasProblem(o.no));
    if (st !== "picked" && st !== "road") fail("bad_state", DRIVER_MSG.problemState(o.no));
    const cx = stepAt(ctx, sh, opt.at, [o]);
    const prev = snap(o), now = iso(cx), text = String(note || "").replace(/\s+/g, " ").trim().slice(0, 300), step = newStep(cx, sh, "problem");
    o.problem = { kind, at: now, ...(text ? { note: text } : {}), solved: "" }; o.updatedAt = now;
    await ctx.repo.put(COL.orders, o);
    step.orders.push({ no: o.no, mark: mark(o), prev });
    const mine = (await deliveryOrders(ctx)).filter((x) => x.driver === me), zones = new Map((await liveZones(ctx)).map((z) => [z.n, z]));
    relock(sh, mine, zones, nowMs(cx));
    sh.last = step; await putShift(cx, sh);
    await logStep(cx, me, "driver.problem", o.no, { kind, ...(text ? { note: text } : {}) });
    emit(cx, "order.status", { no: o.no, status: o.status, at: now, hold: true }, { order: o.no });
    course(cx, me, "problem", [o.no], { problem: kind, driving: sh.driving });
    return { step, no: o.no };
    });
  });
  return result(ctx, s, [done.no], done.step);
}
/** "Върнах я": the order is back in the restaurant (after a problem, or after the manager's answer "Върни я в ресторанта"
    / "Предложи вземане от място"). The status stays: what happens with it is the restaurant's decision
    ([ЛИПСВА], OPEN-QUESTIONS 23; "Откажи" with a reason in the admin). Log: driver.problem_end. */
export async function returned(ctx: Ctx, s: StaffCtx, n: string, opt: { at?: string | number } = {}): Promise<StepResult> {
  need(s, "driver");
  const done = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user;
    return orderLock(ctx, [String(n || "")], async () => {
    const o = await ctx.repo.get<Order>(COL.orders, String(n || ""));
    if (!o || o.mode !== "delivery" || o.driver !== me) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
    const a = (await ctx.repo.list<DriverAsk>(COL.asks)).filter((x) => x.order === o.no).sort((x, y) => (x.at < y.at ? 1 : -1))[0];
    const told = !!a && a.status === "answered" && (a.answer === "return" || a.answer === "pickup") && inRoute(o);
    if (!openProblem(o) && !told) fail("no_problem", DRIVER_MSG.noProblem(o.no));
    const cx = stepAt(ctx, sh, opt.at, [o]);
    const prev = snap(o), now = iso(cx), step = newStep(cx, sh, "returned");
    o.problem = { ...(o.problem || { kind: "address" as const, at: a!.at, note: "Адрес извън зоните: " + ANSWER_LABEL[a!.answer!] }), solved: "returned", solvedAt: now };
    o.updatedAt = now;
    await ctx.repo.put(COL.orders, o);
    step.orders.push({ no: o.no, mark: mark(o), prev });
    const mine = (await deliveryOrders(ctx)).filter((x) => x.driver === me), zones = new Map((await liveZones(ctx)).map((z) => [z.n, z]));
    relock(sh, mine, zones, nowMs(cx));
    sh.last = step; await putShift(cx, sh);
    await logStep(cx, me, "driver.problem_end", o.no, { kind: o.problem.kind, solved: "returned" });
    emit(cx, "order.status", { no: o.no, status: o.status, at: now, hold: true }, { order: o.no });
    course(cx, me, "returned", [o.no], { driving: sh.driving });
    return { step, no: o.no };
    });
  });
  return result(ctx, s, [done.no], done.step);
}
/** "Отмени": the last step, one step back, inside the window and only while nobody else touched the orders.
    409 undo_gone / undo_late / undo_changed. Log: driver.undo per order. */
export async function undo(ctx: Ctx, s: StaffCtx, id: string): Promise<{ deliveries: Delivery[] }> {
  need(s, "driver");
  const nos = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), st = sh.last, me = sh.user;
    if (!st || st.id !== String(id || "")) throw new CoreError("undo_gone", DRIVER_MSG.undoGone, 409);
    if (nowMs(ctx) > st.until + UNDO_GRACE_MS) throw new CoreError("undo_late", DRIVER_MSG.undoLate, 409);
    return orderLock(ctx, st.orders.map((x) => x.no), async () => {
    const orders: Order[] = [];
    for (const x of st.orders) {
      const o = await ctx.repo.get<Order>(COL.orders, x.no);
      if (!o || mark(o) !== x.mark) throw new CoreError("undo_changed", DRIVER_MSG.undoChanged(x.no), 409);
      orders.push(o);
    }
    const now = iso(ctx);
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i], was = { status: o.status, arrivedAt: o.arrivedAt || null, hold: !!o.problem };
      restore(o, st.orders[i].prev); o.updatedAt = now;
      await ctx.repo.put(COL.orders, o);
      await audit(ctx, me, "driver.undo", o.no, { step: st.kind, status: o.status });
      if (was.status !== o.status || was.arrivedAt !== (o.arrivedAt || null) || was.hold !== !!o.problem)
        emit(ctx, "order.status", { no: o.no, status: o.status, at: now, arrivedAt: o.arrivedAt || null, hold: !!o.problem && o.problem.solved !== "delivered" }, { order: o.no });
    }
    sh.driving = st.driving; sh.last = null;
    await putShift(ctx, sh);
    course(ctx, me, "undo", orders.map((o) => o.no), { step: st.kind, driving: sh.driving });
    return orders.map((o) => o.no);
    });
  });
  const sc = await scope(ctx, s);
  return { deliveries: nos.map((n) => sc.orders.find((o) => o.no === n)).filter((o): o is Order => !!o && visible(o, sc)).map((o) => view(o, sc)) };
}

/* ---------- 4. "Адрес извън зоните": the question to the manager ---------- */
/** the driver asks about an order he may see (a ready one, or his own before it is delivered). One open question per
    order (asking again returns it). Log: driver.ask. Event: driver.ask. */
export async function ask(ctx: Ctx, s: StaffCtx, n: string, note?: string): Promise<AskView> {
  need(s, "driver");
  return lock(ctx, async () => {
    const sh = await mustShift(ctx, s), me = sh.user, o = await ctx.repo.get<Order>(COL.orders, String(n || ""));
    if (!o || o.mode !== "delivery" || !(o.driver === me || (o.status === "ready" && !o.driver))) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
    const st = stateOf(o);
    if (!(st === "wait" || st === "picked" || st === "road")) fail("bad_state", DRIVER_MSG.askState(o.no));
    const names = new Map([[me, sh.name]]), sc = { me, names, now: nowMs(ctx) };
    const open = (await ctx.repo.list<DriverAsk>(COL.asks, { status: "open" } as Partial<DriverAsk>)).find((a) => a.order === o.no);
    if (open) return askView(open, sc);
    const text = String(note || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const a: DriverAsk = { id: rid(6), type: "outzone", order: o.no, driver: me, name: sh.name, at: iso(ctx), status: "open", zone: o.zone, addr: o.addr, ...(text ? { note: text } : {}) };
    await ctx.repo.put(COL.asks, a);
    await audit(ctx, me, "driver.ask", o.no, { type: a.type, ask: a.id });
    emit(ctx, "driver.ask", { id: a.id, type: a.type, order: a.order, driver: me, status: a.status, answer: null });
    return askView(a, sc);
  });
}
const staffNames = async (ctx: Ctx) => new Map((await ctx.repo.list<StaffUser>(COL.staff)).map((u) => [u.username, u.name]));
/** the manager's list: the open questions (the oldest first); {all: true} adds the ones answered today */
export async function asks(ctx: Ctx, s: StaffCtx, opts: { all?: boolean } = {}): Promise<AskView[]> {
  needBoss(s, ["driver", "staff"]);
  const sc = { me: s.user.username, names: await staffNames(ctx), now: nowMs(ctx) }, today = sofiaYmd(new Date(sc.now));
  return (await ctx.repo.list<DriverAsk>(COL.asks))
    .filter((a) => a.status === "open" || (!!(opts && opts.all) && !!a.answeredAt && sofiaYmd(new Date(a.answeredAt)) === today))
    .sort((a, b) => +(a.status !== "open") - +(b.status !== "open") || (a.at < b.at ? -1 : 1)).map((a) => askView(a, sc));
}
const noteOf = (a: DriverAsk) => "Адрес извън зоните: " + ANSWER_LABEL[a.answer!] + ".";
/** the manager answers one of the three (decision 17.11.2026): "return" | "pickup" | "deliver". The driver sees it at once
    (driver.ask); "Взех" of such an order needs "deliver". A note goes into the order. Log: driver.answer. */
export async function answer(ctx: Ctx, s: StaffCtx, id: string, a: AskAnswer): Promise<AskView> {
  needBoss(s, ["driver", "staff"]);
  return lock(ctx, async () => {
    const q = await ctx.repo.get<DriverAsk>(COL.asks, String(id || ""));
    if (!q) throw new CoreError("not_found", DRIVER_MSG.askGone, 404);
    if (!ASK_ANSWERS.includes(a)) bad({ answer: DRIVER_MSG.askAnswer });
    if (q.status !== "open") throw new CoreError("answered", DRIVER_MSG.askAnswered, 409);
    return orderLock(ctx, [q.order], async () => {
    const now = iso(ctx), me = s.user.username;
    q.status = "answered"; q.answer = a; q.answeredAt = now; q.answeredBy = me;
    const o = await ctx.repo.get<Order>(COL.orders, q.order);
    if (o) {
      o.staffNotes = [...(o.staffNotes || []), { at: now, by: me, text: noteOf(q) }]; o.updatedAt = now;
      await ctx.repo.put(COL.orders, o);
      q.mark = mark(o);
    }
    await ctx.repo.put(COL.asks, q);
    await audit(ctx, me, "driver.answer", q.order, { ask: q.id, answer: a, driver: q.driver });
    emit(ctx, "driver.ask", { id: q.id, type: q.type, order: q.order, driver: q.driver, status: q.status, answer: a });
    const v = askView(q, { me, names: await staffNames(ctx), now: nowMs(ctx) });
    return { ...v, undoUntil: nowMs(ctx) + DRIVER_UNDO_MS };
    });
  });
}
/** the manager's "Отмени" of an answer: the question is open again, inside the window and while the driver has not
    acted on it. 409 undo_late / undo_changed. Log: driver.answer_undo. */
export async function answerUndo(ctx: Ctx, s: StaffCtx, id: string): Promise<AskView> {
  needBoss(s, ["driver", "staff"]);
  return lock(ctx, async () => {
    const q = await ctx.repo.get<DriverAsk>(COL.asks, String(id || ""));
    if (!q) throw new CoreError("not_found", DRIVER_MSG.askGone, 404);
    if (q.status !== "answered" || !q.answeredAt) throw new CoreError("undo_gone", DRIVER_MSG.undoGone, 409);
    /* only who answered takes it back (upravitel.review-2, round 2: the owner could undo the manager's answer) */
    if (q.answeredBy && q.answeredBy !== s.user.username) throw new CoreError("undo_gone", DRIVER_MSG.undoGone, 409);
    if (nowMs(ctx) > (msOf(q.answeredAt) || 0) + DRIVER_UNDO_MS + UNDO_GRACE_MS) throw new CoreError("undo_late", DRIVER_MSG.undoLate, 409);
    return orderLock(ctx, [q.order], async () => {
    const o = await ctx.repo.get<Order>(COL.orders, q.order), me = s.user.username, was = q.answer;
    if (o && q.mark && mark(o) !== q.mark) throw new CoreError("undo_changed", DRIVER_MSG.undoChanged(q.order), 409);
    if (o) {
      const text = noteOf(q), i = (o.staffNotes || []).map((x) => x.text + "|" + x.at).lastIndexOf(text + "|" + q.answeredAt);
      if (i > -1) { o.staffNotes!.splice(i, 1); o.updatedAt = iso(ctx); await ctx.repo.put(COL.orders, o); }
    }
    q.status = "open"; delete q.answer; delete q.answeredAt; delete q.answeredBy; delete q.mark;
    await ctx.repo.put(COL.asks, q);
    await audit(ctx, me, "driver.answer_undo", q.order, { ask: q.id, answer: was });
    emit(ctx, "driver.ask", { id: q.id, type: q.type, order: q.order, driver: q.driver, status: q.status, answer: null });
    return askView(q, { me, names: await staffNames(ctx), now: nowMs(ctx) });
    });
  });
}

/* ---------- 5. the route ---------- */
function routeOf(sc: Scope): RouteView {
  const P = sc.plan, by = new Map(sc.orders.map((o) => [o.no, o]));
  const opt = (key: RoutePick, title: string, sub: string, order: string[]): RouteOption => ({ key, title, sub, order, zones: order.map((n) => by.get(n)!.zone || "извън зоните"), km: null, minutes: null, fuel: null, note: DRIVER_MISSING.route });
  const options = [opt("A", "Път А · по срока", "Първо поръчките, които трябва да стигнат по-рано", P.A), opt("B", "Път Б · по-кратък", "Първо близките квартали, адресите в един квартал заедно", P.B)];
  if (P.own) options.push(opt("own", "Моят ред", "Ти подреди адресите", P.own));
  return {
    pick: P.pick, options, same: P.A.join() === P.B.join(), stops: P.order.map((n) => view(by.get(n)!, sc)), locked: P.order.length ? P.locked : null, note: DRIVER_MISSING.route,
    etaNote: "Пристигането е около: времето за квартала + " + STOP_MIN + " мин за всеки предишен адрес.",
  };
}
/** "Маршрут": Път А (by the promised time), Път Б (the near quarters first), "Моят ред"; the stops in the chosen order.
    No kilometres, minutes or fuel: [ЛИПСВА: километри и минути на маршрута]. */
export async function route(ctx: Ctx, s: StaffCtx): Promise<RouteView> {
  need(s, "driver");
  const sc = await scope(ctx, s);
  if (sc.plan.order.length) return routeOf(sc);
  /* a new course (the prototype's "Нов курс"): Път А and Път Б for the ready orders in the zones nobody took yet */
  const wait = sc.orders.filter((o) => o.status === "ready" && !o.driver && !isOutzone(o, sc.zones));
  if (!wait.length) return routeOf(sc);
  const sh = sc.shift ? { ...sc.shift, route: { pick: (sc.shift.route.pick === "B" ? "B" : "A") as RoutePick, own: null }, driving: null } : null;
  return { ...routeOf({ ...sc, plan: makePlan(wait, sh, sc.zones, sc.now) }), preview: true };
}
/** the driver chooses: "A" | "B" | "own" ("own" starts from the order on the screen). Log: driver.route. */
export async function routePick(ctx: Ctx, s: StaffCtx, pick: RoutePick): Promise<RouteView> {
  need(s, "driver");
  await lock(ctx, async () => {
    const sh = await mustShift(ctx, s);
    if (!["A", "B", "own"].includes(pick)) bad({ pick: DRIVER_MSG.pick });
    const sc = await scope(ctx, s);
    if (pick === "own" && !sc.plan.own) sh.route.own = [...sc.plan.order];
    sh.route.pick = pick;
    await putShift(ctx, sh);
    await audit(ctx, sh.user, "driver.route", sh.id, { pick });
    course(ctx, sh.user, "route", [], { pick });
  });
  return route(ctx, s);
}
/** "По-рано" / "По-късно" on an address: the driver's own order ("Моят ред"), kept in the shift. The delivery he drives
    to stays first (409 locked); 409 edge at the ends. Log: driver.route. */
export async function routeMove(ctx: Ctx, s: StaffCtx, n: string, dir: "up" | "down"): Promise<RouteView> {
  need(s, "driver");
  await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), sc = await scope(ctx, s), order = [...sc.plan.order], i = order.indexOf(String(n || ""));
    if (i < 0) throw new CoreError("not_found", DRIVER_MSG.notFound, 404);
    if (dir !== "up" && dir !== "down") bad({ dir: DRIVER_MSG.edge });
    if (order[i] === sc.plan.locked) throw new CoreError("locked", DRIVER_MSG.locked(order[i]), 409);
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= order.length || order[j] === sc.plan.locked) throw new CoreError("edge", DRIVER_MSG.edge, 409);
    [order[i], order[j]] = [order[j], order[i]];
    sh.route = { pick: "own", own: order };
    await putShift(ctx, sh);
    await audit(ctx, sh.user, "driver.route", sh.id, { pick: "own", order });
    course(ctx, sh.user, "route", order, { pick: "own" });
  });
  return route(ctx, s);
}

/* ---------- 6. fuel ---------- */
/** the receipts are kept apart from the menu's photos and never public: /api/driver/receipts/<sha256>.<ext> */
export const RECEIPT_URL = "/api/driver/receipts/";
const MEDIA = /^\/api\/driver\/receipts\/[a-f0-9]{64}\.(webp|jpg|png)$/, DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
/** the photo of a receipt: the same checks as a photo of the menu (png / jpeg / webp by content, up to 5 MB; the server
    keeps it in /media/<sha256>.<ext>); the demo keeps it as a data URL (up to 1 MB, as the photos of the menu there) */
export const RECEIPT_MAX = 5 * 1024 * 1024, RECEIPT_DEMO_BYTES = 1_000_000, RECEIPT_DEMO_MAX = 1_400_000, RECEIPT_PER_HOUR = 30;
/** before a receipt photo is stored (the server's route and the demo): a driver in a shift, the size, the type the
    content says (ext from the first bytes, never from the name). 413 too_large, 415 unsupported, 422 empty. */
/** width and height from the header of a png / jpeg / webp (null: not a picture of that type) */
export function imageDims(b: Uint8Array, ext: string | null): { w: number; h: number } | null {
  const u16 = (i: number) => (b[i] << 8) | b[i + 1], u32 = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  const str = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  let w = 0, h = 0;
  if (ext === "png") { if (b.length < 24 || str(12, 4) !== "IHDR") return null; w = u32(16); h = u32(20); }
  else if (ext === "jpg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = u16(i + 5); w = u16(i + 7); break; }
      if (m === 0xd9 || m === 0xda) return null;
      i += 2 + u16(i + 2);
    }
  } else if (ext === "webp") {
    if (b.length < 30 || str(0, 4) !== "RIFF" || str(8, 4) !== "WEBP") return null;
    const c = str(12, 4);
    if (c === "VP8 ") { w = (b[26] | (b[27] << 8)) & 0x3fff; h = (b[28] | (b[29] << 8)) & 0x3fff; }
    else if (c === "VP8L") { w = 1 + (((b[22] & 0x3f) << 8) | b[21]); h = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)); }
    else if (c === "VP8X") { w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16)); h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16)); }
    else return null;
  } else return null;
  return w >= 16 && h >= 16 && w <= 20000 && h <= 20000 ? { w, h } : null;
}
export async function receiptCheck(ctx: Ctx, s: StaffCtx, f: { bytes: number; ext: string | null; data?: Uint8Array }): Promise<{ ok: true }> {
  need(s, "driver");
  await mustShift(ctx, s);
  const bytes = f && typeof f.bytes === "number" ? f.bytes : 0;
  if (!(bytes > 0)) throw new CoreError("empty", DRIVER_MSG.receiptEmpty, 422);
  if (bytes > RECEIPT_MAX) throw new CoreError("too_large", DRIVER_MSG.receiptLarge, 413);
  if (ctx.demo && bytes > RECEIPT_DEMO_BYTES) throw new CoreError("too_large", DRIVER_MSG.receiptDemo, 413);
  if (!f.ext || !["png", "jpg", "webp"].includes(f.ext)) throw new CoreError("unsupported", DRIVER_MSG.receiptType, 415);
  if (f.data && !imageDims(f.data, f.ext)) throw new CoreError("unsupported", DRIVER_MSG.receiptType, 415);
  return { ok: true };
}
/** who may open the photo of a receipt (it is never public): a driver, the main admin, the owner, the manager */
export async function receiptAccess(ctx: Ctx, s: StaffCtx, name: string): Promise<void> {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (isBoss(s)) return;
  const r = (await receiptsDoc(ctx)).by[String(name || "")];
  if (!(may(s, "driver") && r && r.user === s.user.username)) throw new CoreError("forbidden", RIGHTS_MSG.forbidden, 403);
}
/** COL.modState "driver-receipts": who uploaded each photo and the fuel entry that uses it (one entry per photo) */
interface ReceiptsDoc { id: "driver-receipts"; by: Record<string, { user: string; at: Iso; used?: string }> }
async function receiptsDoc(ctx: Ctx): Promise<ReceiptsDoc> {
  const d = await ctx.repo.get<ReceiptsDoc>(COL.modState, "driver-receipts");
  return { id: "driver-receipts", by: (d && d.by) || {} };
}
/** the server stored a photo for this driver (the name is its sha256 + type): only he may use it, once */
export async function receiptKeep(ctx: Ctx, s: StaffCtx, name: string): Promise<void> {
  need(s, "driver");
  await lock(ctx, async () => {
    const d = await receiptsDoc(ctx);
    if (!d.by[name]) { d.by[name] = { user: s.user.username, at: iso(ctx) }; await ctx.repo.put(COL.modState, d); }
  });
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
function fuelView(e: FuelEntry, cars: DriverCar[], names: Map<string, string>): FuelView {
  const at = msOf(e.at) || 0;
  return { id: e.id, car: e.car, carName: carName(cars, e.car), litres: e.litres, sum: e.sum, perLitre: round3(e.sum / e.litres), km: e.km, full: e.full, cash: e.cash, photo: e.photo, noPhoto: e.noPhoto,
    at: e.at, atClock: clock(at), user: e.user, name: names.get(e.user) || e.name, day: sofiaYmd(new Date(at)),
    confirmed: e.confirmed ? { by: names.get(e.confirmed.by) || e.confirmed.by, at: e.confirmed.at, atClock: clock(msOf(e.confirmed.at) || 0) } : null, pending: e.cash && !e.confirmed };
}
const shiftFuel = async (ctx: Ctx, sh: DriverShift) => (await ctx.repo.list<FuelEntry>(COL.fuel, { user: sh.user } as Partial<FuelEntry>)).filter((e) => e.shift === sh.id).sort((a, b) => (a.at < b.at ? 1 : -1));
/** what the delivered order brought in: the driver's record, else (moved by the admin) the order's own payment */
const paidOf = (o: Order) => o.collected || { pay: o.pay, sum: o.total, feeMissing: o.pay === "cash" && o.fee === null };
function totals(sh: DriverShift, orders: Order[], fuel: FuelEntry[], cars: DriverCar[]): ShiftTotals {
  const mine = ofShift(orders, sh), del = mine.filter((o) => o.status === "delivered"), paid = del.map((o) => ({ o, p: paidOf(o) }));
  const of = (m: PayMethod) => paid.filter((x) => x.p.pay === m), sum = (l: { p: { sum: number } }[]) => round2(l.reduce((a, x) => a + x.p.sum, 0));
  const cash = of("cash"),
    /* fuel paid from the cash comes off "За предаване" only after a boss saw the receipt ("Видях бележката" in "Екипът";
       decision 18.11.2026, round 4: any picture could pass for a receipt); until then it waits */
    fuelCash = round2(fuel.filter((e) => e.cash && !!e.confirmed).reduce((a, e) => a + e.sum, 0)),
    fuelCashPending = round2(fuel.filter((e) => e.cash && !e.confirmed).reduce((a, e) => a + e.sum, 0)), handover = round2(sum(cash) + (sh.float || 0) - fuelCash);
  const legs = sh.legs.map((l) => ({ car: l.car, n: carName(cars, l.car), kmStart: l.kmStart, kmEnd: l.kmEnd as number | null, km: (l.kmEnd - l.kmStart) as number | null }));
  if (sh.status === "open") legs.push({ car: sh.car, n: carName(cars, sh.car), kmStart: sh.kmStart, kmEnd: null, km: null });
  return {
    delivered: del.length, problems: mine.filter((o) => !!o.problem && o.problem.solved !== "delivered").length, fuel: fuel.length,
    cash: { rows: cash.map((x) => ({ no: x.o.no, zone: x.o.zone, sum: x.p.sum, feeMissing: !!x.p.feeMissing })), sum: sum(cash), feeMissing: cash.some((x) => !!x.p.feeMissing) },
    float: sh.float, fuelCash, fuelCashPending, handover, owe: handover < -0.004, cards: { n: of("card").length, sum: sum(of("card")) }, vouchers: { n: of("voucher").length, sum: sum(of("voucher")) },
    km: { legs, total: sh.status === "open" ? null : legs.reduce((a, l) => a + (l.km || 0), 0) },
  };
}
/** "Гориво": the car, its last recorded km, the cash on hand and the entries of this shift (the newest first) */
export async function fuel(ctx: Ctx, s: StaffCtx): Promise<FuelPage> {
  need(s, "driver");
  const sh = await mustShift(ctx, s), d = await getDoc(ctx), entries = await shiftFuel(ctx, sh), names = new Map([[sh.user, sh.name]]);
  const t = totals(sh, await deliveryOrders(ctx), entries, d.cars);
  return { car: carLite(d.cars, sh.car), lastKm: lastKmOf(d, sh), cashOnHand: Math.max(0, round2(t.handover - t.fuelCashPending)), entries: entries.map((e) => fuelView(e, d.cars, names)), lastPerLitre: entries[0] ? round3(entries[0].sum / entries[0].litres) : null };
}
/** "Запиши зареждането" for the car of the shift: litres, the sum in €, the km (not below the car's last one),
    "Напълних резервоара догоре", "Платих в брой от събраните пари" (taken out of the cash to hand over; not more than
    the cash on hand), the photo of the receipt (optional; noPhoto: the receipt goes to the manager by hand).
    422 fields litres / sum / km / photo. Log: fuel.add. */
export async function fuelAdd(ctx: Ctx, s: StaffCtx, input: FuelInput): Promise<FuelPage & { entry: FuelView }> {
  need(s, "driver");
  const id = await lock(ctx, async () => {
    const sh = await mustShift(ctx, s), d = await getDoc(ctx), i = (input && typeof input === "object" ? input : {}) as Partial<FuelInput>, f: Record<string, string> = {};
    const litres = dec(i.litres), sum = money(i.sum), km = whole(i.km), last = lastKmOf(d, sh), cash = i.cash === true;
    if (!(litres > 0)) f.litres = DRIVER_MSG.litres; else if (litres > LITRES_MAX) f.litres = DRIVER_MSG.litresMax;
    if (sum === null || !(sum > 0)) f.sum = DRIVER_MSG.fuelSum;
    else if (cash) {
      const t0 = totals(sh, await deliveryOrders(ctx), await shiftFuel(ctx, sh), d.cars), have = Math.max(0, round2(t0.handover - t0.fuelCashPending));
      if (sum > have + 0.004) f.sum = DRIVER_MSG.fuelCash(have);
    }
    if (!(km > 0) || km > KM_MAX) f.km = DRIVER_MSG.km; else if (km < last) f.km = DRIVER_MSG.kmLow(last); else if (km > last + KM_JUMP) f.km = DRIVER_MSG.kmHigh;
    let photo: string | null = null;
    if (i.photo != null && i.photo !== "") {
      const p = String(i.photo);
      const ok = ctx.demo ? DATA.test(p) && p.length <= RECEIPT_DEMO_MAX : MEDIA.test(p) && (!ctx.mediaExists || ctx.mediaExists(p));
      /* his own photo, not in another entry yet (a photo of a receipt counts once) */
      const reg = !ctx.demo && ok ? (await receiptsDoc(ctx)).by[p.slice(RECEIPT_URL.length)] : undefined;
      if (!ok || (!ctx.demo && (!reg || reg.user !== sh.user))) f.photo = DRIVER_MSG.photo;
      else if (reg && reg.used) f.photo = DRIVER_MSG.photoUsed;
      else photo = p;
    }
    if (Object.keys(f).length) bad(f);
    const cx = stepAt(ctx, sh, i.at);
    const now = iso(cx);
    const e: FuelEntry = { id: rid(8), user: sh.user, name: sh.name, shift: sh.id, car: sh.car, litres: round3(litres), sum: round2(sum!), km, full: i.full === true, cash, photo, noPhoto: !photo && i.noPhoto === true, at: now, createdAt: now };
    await ctx.repo.put(COL.fuel, e);
    if (photo && !ctx.demo) { const r = await receiptsDoc(ctx), k = photo.slice(RECEIPT_URL.length); if (r.by[k]) { r.by[k].used = e.id; await ctx.repo.put(COL.modState, r); } }
    setKm(d, sh.car, km); await putDoc(ctx, d);
    await logStep(cx, sh.user, "fuel.add", e.id, { car: e.car, litres: e.litres, sum: e.sum, km, full: e.full, cash, photo: !!photo });
    course(cx, sh.user, "fuel");
    return e.id;
  });
  const page = await fuel(ctx, s);
  return { ...page, entry: page.entries.find((e) => e.id === id)! };
}
/** "Видях бележката": a boss saw the paper receipt of fuel paid from the cash; only then it comes off "За предаване"
    (decision 18.11.2026, round 4). The main admin, the owner, the manager. 404 / 409 not_cash, confirmed. Log: fuel.confirm.
    The driver's screen and the manager's hear it (driver.course "fuel"). */
export async function confirmFuel(ctx: Ctx, s: StaffCtx, id: string): Promise<FuelView & { undoUntil: number }> {
  needBoss(s, ["driver", "staff"]);
  return lock(ctx, async () => {
    const e = await ctx.repo.get<FuelEntry>(COL.fuel, String(id || ""));
    if (!e) throw new CoreError("not_found", DRIVER_MSG.fuelGone, 404);
    if (!e.cash) throw new CoreError("not_cash", DRIVER_MSG.fuelNotCash, 409);
    if (e.confirmed) throw new CoreError("confirmed", DRIVER_MSG.fuelConfirmed, 409);
    e.confirmed = { by: s.user.username, at: iso(ctx) };
    await ctx.repo.put(COL.fuel, e);
    await audit(ctx, s.user.username, "fuel.confirm", e.id, { driver: e.user, sum: e.sum, litres: e.litres });
    course(ctx, e.user, "fuel", [], { confirmed: e.id });
    const d = await getDoc(ctx);
    return { ...fuelView(e, d.cars, await staffNames(ctx)), undoUntil: nowMs(ctx) + DRIVER_UNDO_MS };
  });
}
/** "Отмени" of "Видях бележката": inside the window (the boss's own confirmation). 409 undo_gone / undo_late. Log: fuel.confirm_undo. */
export async function confirmFuelUndo(ctx: Ctx, s: StaffCtx, id: string): Promise<FuelView> {
  needBoss(s, ["driver", "staff"]);
  return lock(ctx, async () => {
    const e = await ctx.repo.get<FuelEntry>(COL.fuel, String(id || ""));
    if (!e) throw new CoreError("not_found", DRIVER_MSG.fuelGone, 404);
    if (!e.confirmed || (e.confirmed.by !== s.user.username && s.user.role !== "admin")) throw new CoreError("undo_gone", DRIVER_MSG.undoGone, 409);
    if (nowMs(ctx) > (msOf(e.confirmed.at) || 0) + DRIVER_UNDO_MS + UNDO_GRACE_MS) throw new CoreError("undo_late", DRIVER_MSG.undoLate, 409);
    delete e.confirmed;
    await ctx.repo.put(COL.fuel, e);
    await audit(ctx, s.user.username, "fuel.confirm_undo", e.id, { driver: e.user, sum: e.sum });
    course(ctx, e.user, "fuel", [], { confirmed: null });
    const d = await getDoc(ctx);
    return fuelView(e, d.cars, await staffNames(ctx));
  });
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** the owner's module: fuel per day, driver and car for a period (default the last 30 days, up to 92), and the real
    consumption (l/100 km) of a car between two "догоре" entries. Rights: the owner, or the section "Финанси и гориво"
    (the main admin always). */
export async function fuelReport(ctx: Ctx, s: StaffCtx, f: { from?: string; to?: string } = {}): Promise<FuelReport> {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (!(s.user.role === "owner" || may(s, "finance"))) throw new CoreError("forbidden", RIGHTS_MSG.forbidden, 403);
  const today = sofiaYmd(nowDate(ctx)), to = f && f.to && YMD.test(f.to) ? f.to : today, from = f && f.from && YMD.test(f.from) ? f.from : addDaysYmd(to, -29);
  if (from > to || addDaysYmd(from, 92) < to) throw Object.assign(new CoreError("invalid", DRIVER_MSG.range, 422), { fields: { from: DRIVER_MSG.range } });
  const d = await getDoc(ctx), names = await staffNames(ctx);
  const every = (await ctx.repo.list<FuelEntry>(COL.fuel)).map((e) => fuelView(e, d.cars, names)).sort((a, b) => a.km - b.km || (a.at < b.at ? -1 : 1));
  const rows = every.filter((e) => e.day >= from && e.day <= to);
  type Acc = { n: number; litres: number; sum: number };
  const add = <K extends string>(m: Map<K, Acc>, k: K, e: FuelView) => { const a = m.get(k) || { n: 0, litres: 0, sum: 0 }; a.n++; a.litres = round3(a.litres + e.litres); a.sum = round2(a.sum + e.sum); m.set(k, a); };
  const days = new Map<string, Acc>(), drivers = new Map<string, Acc>(), carsM = new Map<string, Acc>(), all = new Map<string, Acc>();
  for (const e of rows) { add(days, e.day, e); add(drivers, e.user, e); add(carsM, e.car, e); add(all, "all", e); }
  /* the real consumption: from one full tank to the next, the litres filled after the first one; segments that end in the period */
  const per = (car: string): { km: number | null; per100: number | null } => {
    const l = every.filter((e) => e.car === car);
    let km = 0, litres = 0, lastFull = -1;
    l.forEach((e, i) => {
      if (!e.full) return;
      if (lastFull > -1 && e.day >= from && e.day <= to && e.km > l[lastFull].km) { km += e.km - l[lastFull].km; litres += l.slice(lastFull + 1, i + 1).reduce((a, x) => a + x.litres, 0); }
      lastFull = i;
    });
    return km > 0 ? { km, per100: Math.round((litres / km) * 1000) / 10 } : { km: null, per100: null };
  };
  return {
    from, to, total: all.get("all") || { n: 0, litres: 0, sum: 0 },
    byDay: [...days].map(([date, a]) => ({ date, ...a })).sort((a, b) => (a.date < b.date ? -1 : 1)),
    byDriver: [...drivers].map(([user, a]) => ({ user, name: names.get(user) || user, ...a })).sort((a, b) => b.sum - a.sum),
    byCar: [...carsM].map(([car, a]) => ({ car, n: carName(d.cars, car), entries: a.n, litres: a.litres, sum: a.sum, ...per(car) })),
    rows: [...rows].sort((a, b) => (a.at < b.at ? 1 : -1)),
  };
}

/* ---------- 7. the end of the shift ---------- */
/** "Край на смяната": delivered, with a problem, fuel; the cash to hand over with the breakdown by order; cards and
    vouchers; the km per car; what still blocks the end */
export async function shift(ctx: Ctx, s: StaffCtx): Promise<ShiftSummary> {
  need(s, "driver");
  const sc = await scope(ctx, s), sh = await mustShift(ctx, s);
  const t = totals(sh, sc.orders, await shiftFuel(ctx, sh), sc.cars);
  return { ...t, shift: await myShiftView(ctx, sh), closed: false, endedAt: null, unfinished: sc.orders.filter((o) => o.driver === sh.user && unfinishedState(o)).map((o) => view(o, sc)), handTo: DRIVER_MISSING.handTo };
}
/** "Приключи смяната": the km from the dashboard (not below the car's last one) and "Предадох ... на [ЛИПСВА]" (handed).
    409 unfinished while a taken order is not delivered or returned (the message lists them; fields {<№>: state});
    422 fields km / handed. The shift is closed; the sign-out is the screen's. Log: driver.shift_end. */
export async function end(ctx: Ctx, s: StaffCtx, input: { km: number | string; handed: boolean }): Promise<ShiftSummary> {
  need(s, "driver");
  return lock(ctx, async () => {
    const sh = await mustShift(ctx, s), sc = await scope(ctx, s), d = await getDoc(ctx), i = (input && typeof input === "object" ? input : {}) as Partial<typeof input>;
    const open = sc.orders.filter((o) => o.driver === sh.user && unfinishedState(o)).sort((a, b) => +a.no - +b.no);
    if (open.length) fail("unfinished", DRIVER_MSG.unfinished(open.map((o) => o.no)), 409, Object.fromEntries(open.map((o) => [o.no, openProblem(o) ? DELIVERY_LABEL.prob + ": " + PROBLEM_LABEL[o.problem!.kind] : DELIVERY_LABEL[stateOf(o)]])));
    const f: Record<string, string> = {}, km = whole(i.km), last = lastKmOf(d, sh);
    if (!(km > 0) || km > KM_MAX) f.km = DRIVER_MSG.km; else if (km < last) f.km = DRIVER_MSG.kmLow(last); else if (km > last + KM_JUMP) f.km = DRIVER_MSG.kmHigh;
    if (i.handed !== true) f.handed = DRIVER_MSG.handed;
    if (Object.keys(f).length) bad(f);
    const now = iso(ctx);
    sh.legs.push({ car: sh.car, kmStart: sh.kmStart, kmEnd: km, from: sh.legFrom, to: now });
    sh.status = "closed"; sh.endedAt = now; sh.kmEnd = km; sh.driving = null; sh.last = null;
    const t = totals(sh, sc.orders, await shiftFuel(ctx, sh), d.cars);
    sh.closing = t;
    await putShift(ctx, sh);
    setKm(d, sh.car, km); await putDoc(ctx, d);
    await audit(ctx, sh.user, "driver.shift_end", sh.id, { km: t.km.total, delivered: t.delivered, problems: t.problems, cash: t.cash.sum, float: t.float, fuelCash: t.fuelCash, handover: t.handover, cards: t.cards.sum, vouchers: t.vouchers.sum, handed: true });
    course(ctx, sh.user, "shift_end");
    return { ...t, shift: shiftView(sh, d.cars, km, nowMs(ctx)), closed: true, endedAt: now, unfinished: [], handTo: DRIVER_MISSING.handTo };
  });
}

/* ---------- 8. for the manager and the owner ---------- */
/** the drivers on shift: since when, the car, "В ресторанта" / "На път" / "Връща се" (the course is delivered and no new
    one is taken yet), the current course in order with "+22 мин" / "навреме", delivered today, the cash to hand over;
    the open questions and the problems. No position (no GPS in v1). Rights: the main admin, the owner, the manager. */
export async function drivers(ctx: Ctx, s: StaffCtx): Promise<DriversView> {
  needBoss(s, ["driver", "staff"]);
  const sc = await scope(ctx, s), shifts = (await allShifts(ctx)).filter((x) => x.status === "open").sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1));
  const fuelAll = await ctx.repo.list<FuelEntry>(COL.fuel), today = sofiaYmd(new Date(sc.now));
  const rows: DriverRow[] = shifts.map((sh) => {
    const all = sc.orders.filter((o) => o.driver === sh.user), mine = ofShift(sc.orders, sh), act = all.filter(unfinishedState);
    const plan = makePlan(all.filter(inRoute), sh, sc.zones, sc.now);
    const out = act.some((o) => stateOf(o) === "road" || openProblem(o)), finished = mine.filter((o) => !unfinishedState(o));
    const status: DriverStatus = out ? "road" : act.length || !finished.length ? "restaurant" : "back";
    /* the course: the one he has in the car; after it, the last one he finished */
    const lastDone = [...finished].sort((a, b) => finishedAt(b) - finishedAt(a))[0];
    const id = (act[0] && act[0].course) || (status === "back" && lastDone ? lastDone.course || null : null);
    const stops = (id ? mine.filter((o) => o.course === id) : act).map((o) => {
      const v = view(o, { ...sc, me: sh.user, plan });
      return { o, v, key: unfinishedState(o) ? (v.n ? v.n : 500) + 1000 : finishedAt(o) / 1e13 };
    }).sort((a, b) => a.key - b.key);
    const t = totals(sh, sc.orders, fuelAll.filter((e) => e.shift === sh.id), sc.cars);
    return {
      user: sh.user, name: sc.names.get(sh.user) || sh.name, since: sh.startedAt, sinceAt: clock(msOf(sh.startedAt) ?? sc.now), car: carLite(sc.cars, sh.car), status, statusLabel: DRIVER_STATUS_LABEL[status],
      course: { id, stops: stops.map(({ v }, k) => ({ no: v.no, n: k + 1, zone: v.zone, addr: v.addr, st: v.st, stLabel: v.stLabel, late: v.late, lateLabel: v.due == null ? null : v.late ? "+" + v.late + " мин" : "навреме", next: plan.locked === v.no, arrivedAt: v.arrivedAt })) },
      deliveredToday: all.filter((o) => o.status === "delivered" && sofiaYmd(new Date(finishedAt(o))) === today).length, problems: t.problems, cash: t.handover, cashParts: { orders: t.cash.sum, float: t.float, fuel: t.fuelCash, fuelPending: t.fuelCashPending },
      fuelPending: fuelAll.filter((e) => e.shift === sh.id && e.cash && !e.confirmed).sort((a, b) => (a.at < b.at ? 1 : -1)).map((e) => {
        const v = fuelView(e, sc.cars, sc.names); return { id: v.id, litres: v.litres, sum: v.sum, perLitre: v.perLitre, km: v.km, car: v.car, carName: v.carName, at: v.at, atClock: v.atClock, photo: v.photo, noPhoto: v.noPhoto };
      }), cashTo: DRIVER_MISSING.handTo, position: null,
    };
  });
  const probs = sc.orders.filter((o) => !!o.driver && !!o.problem && o.problem.solved !== "delivered" && o.status !== "cancelled" && o.status !== "delivered")
    .sort((a, b) => +!!a.problem!.solved - +!!b.problem!.solved || (a.problem!.at < b.problem!.at ? -1 : 1));
  return {
    drivers: rows, waiting: sc.orders.filter((o) => o.status === "ready" && !o.driver).length,
    asks: [...sc.asks.values()].filter((a) => a.status === "open").sort((a, b) => (a.at < b.at ? -1 : 1)).map((a) => askView(a, sc)),
    problems: probs.map((o) => ({ no: o.no, driver: o.driver!, driverName: sc.names.get(o.driver!) || o.driver!, kind: o.problem!.kind, label: PROBLEM_LABEL[o.problem!.kind], note: o.problem!.note || null, at: o.problem!.at,
      zone: o.zone, addr: o.addr, solved: (o.problem!.solved || "") as "" | "returned", missing: DRIVER_MISSING.wait })),
  };
}

/* ---------- 9. the search ---------- */
const LAT: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya" };
const lat = (v: unknown): string => String(v || "").toLowerCase().replace(/[а-я]/g, (c) => LAT[c] ?? c).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const WORDS: Record<DeliveryState, string[]> = { wait: ["ресторант"], picked: ["взети"], road: [], done: ["доставени"], prob: ["проблем"], cancelled: ["отказани"] };
/** one field, only the driver's own deliveries of the shift (checked here, not on the screen): the number, the address,
    the quarter, the note, the payment, the state ("на път", "доставени") */
export async function search(ctx: Ctx, s: StaffCtx, q: string): Promise<{ q: string; act: Delivery[]; done: Delivery[] }> {
  need(s, "driver");
  const raw = String(q || "").slice(0, 80), words = lat(raw).split(" ").filter(Boolean);
  if (!words.length) return { q: raw, act: [], done: [] };
  const sc = await scope(ctx, s);
  const mine = sc.orders.filter((o) => o.driver === sc.me && (unfinishedState(o) || (!!sc.shift && ofShift([o], sc.shift).length > 0)));
  const hits = mine.map((o) => view(o, sc)).filter((v) => {
    const hay = lat([v.no, v.zone || "извън зоните", v.addr, v.note, v.payLabel, v.stLabel, v.problem ? v.problem.label : "", ...WORDS[v.st]].join(" ")).split(" ");
    return words.every((w) => hay.some((h) => h.startsWith(w) || (w.length >= 3 && /^\d+$/.test(w) && h.includes(w))));
  }).sort((a, b) => (a.n || 1e6) - (b.n || 1e6) || +b.no - +a.no);
  const fin = (v: Delivery) => v.st === "done" || v.st === "cancelled" || (v.st === "prob" && !!v.problem!.solved);
  return { q: raw, act: hits.filter((v) => !fin(v)), done: hits.filter(fin) };
}
