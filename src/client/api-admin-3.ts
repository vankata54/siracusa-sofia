/* The admin's part 3 for the screens (src/admin/*): orders, reservations and the hall, zones, offers and vouchers, events,
   QR, customers, reports, staff, the site data. Only the admin pages import this file.
   Server: fetch("/api/admin/..."). Demo: the same core in the browser with the demo session. In both, the RIGHTS ARE IN
   THE CORE: every core function of a section checks the section itself (src/core/rights.ts), so a screen gets the same
   401 "auth" / 403 "forbidden" / 409 / 422 (ApiError: code, message for people, fields) on the server and in the demo.
   Phones and e-mails come masked in every list; the whole number only from the "…Phone" / "contact" calls, which go into
   the log. In the demo the static site is not rebuilt after a change of the site data (siteApi.state().mode === "demo"). */
import { http, pick, demoTok, ApiError } from "./api.ts";
import type { Core } from "./api-types.ts";
import type {
  StaffCtx, OrderStatus, ReservationStatus, OrderRow, OrderDetail, OrdersQuery, PhoneOrderInput, ResRow, ResDay, BlockRow, HallView, HallData, QrRow,
  ZonesView, ZonePatch, OffersView, OfferPatch, OfferRow, Voucher, CodeCheck, EventView, EventInput, EventRow, CustomerRow, CustomerDetail, FeedbackRow,
  FeedbackStatus, Report, ReportView, Period, StaffRow, RoleId, SiteBuild, Zone,
} from "./api-types-3.ts";
import type { ReservationInput } from "../core/reservations.ts";

export { ApiError };
export type {
  OrderRow, OrderDetail, OrdersQuery, PhoneOrderInput, ResRow, ResDay, BlockRow, HallView, HallData, QrRow, ZonesView, ZonePatch, OffersView, OfferPatch, OfferRow,
  Voucher, CodeCheck, EventView, EventInput, EventRow, CustomerRow, CustomerDetail, FeedbackRow, FeedbackStatus, Report, ReportView, Period, StaffRow, SiteBuild,
};

/** the demo: the staff session of this browser (401 without it); the section is checked by the core function */
const g = (c: Core): Promise<StaffCtx> => c.staff.guard(demoTok("staff"));
const q = (o: Record<string, string | number | boolean | undefined | null>) => { const u = new URLSearchParams(); for (const k of Object.keys(o)) { const v = o[k]; if (v != null && v !== "") u.set(k, String(v)); } const s = u.toString(); return s ? "?" + s : ""; };
const e = encodeURIComponent;

/* ---------- Поръчки ---------- */
export const ordersAdminApi = {
  /** the list with filters (status or "work" / "done", channel, day "YYYY-MM-DD" or "all", text) + counts per status */
  list: pick(async (c, f: OrdersQuery = {}) => c.ordersAdmin.list(await g(c), f), (f = {}) => http<{ day: string; rows: OrderRow[]; counts: Record<string, number> }>("GET", "admin/orders/list" + q(f as Record<string, string>))),
  get: pick(async (c, no: string) => c.ordersAdmin.get(await g(c), no), (no) => http<OrderDetail>("GET", "admin/orders/" + e(no) + "/detail")),
  /** "Покажи телефона" (into the log) */
  phone: pick(async (c, no: string) => c.ordersAdmin.phone(await g(c), no), (no) => http<{ phone: string; email: string | null }>("POST", "admin/orders/" + e(no) + "/phone")),
  /** one step (forward / back; 409 bad_step); "Отказана" only through cancel */
  step: pick(async (c, no: string, status: OrderStatus) => c.ordersAdmin.step(await g(c), no, status), (no, status) => http<OrderDetail | { no: string; status: OrderStatus }>("POST", "admin/orders/" + e(no) + "/step", { status })),
  /** "Откажи": the reason is required (422 fields.reason), the customer sees it */
  cancel: pick(async (c, no: string, reason: string) => c.ordersAdmin.cancel(await g(c), no, reason), (no, reason) => http<OrderDetail>("POST", "admin/orders/" + e(no) + "/cancel", { reason })),
  /** "Нова поръчка по телефон" (main admin, owner, manager): the core's rules and price; 422 fields, 409 closed / delivery_closed */
  phoneOrder: pick(async (c, o: PhoneOrderInput) => c.ordersAdmin.phoneOrder(await g(c), o), (o) => http<OrderDetail>("POST", "admin/orders/phone", o)),
};

/* ---------- Резервации, блокиране ---------- */
export const reservationsAdminApi = {
  day: pick(async (c, f: { date?: string; status?: ReservationStatus | "all"; q?: string } = {}) => c.resAdmin.day(await g(c), f), (f = {}) => http<ResDay>("GET", "admin/reservations/day" + q(f))),
  month: pick(async (c, month: string) => c.resAdmin.month(await g(c), month), (month) => http<{ month: string; days: Record<string, { bookings: number; toConfirm: number }> }>("GET", "admin/reservations/month" + q({ month }))),
  free: pick(async (c, date: string, time: string, people: number = 1, except?: string) => c.resAdmin.free(await g(c), date, time, people, except),
    (date: string, time: string, people: number = 1, except?: string) => http<{ id: string; n: number; zone: "salon" | "garden"; seats: number }[]>("GET", "admin/reservations/free" + q({ date, time, people, except }))),
  /** "Нова резервация" ("Потвърдена"; waitlist: true = "Чака маса"); 422 fields, 409 taken, 403 blocked */
  create: pick(async (c, r: ReservationInput) => c.resAdmin.create(await g(c), r), (r) => http<ResRow>("POST", "admin/reservations/new", r)),
  /** 409 too_early ("Дошли" / "Неявили се" more than 30 min before); back to prevStatus = "Отмени" */
  setStatus: pick(async (c, id: string, status: ReservationStatus) => c.resAdmin.setStatus(await g(c), id, status), (id, status) => http<ResRow>("POST", "admin/reservations/" + e(id) + "/status", { status })),
  setTable: pick(async (c, id: string, table: string | null) => c.resAdmin.setTable(await g(c), id, table), (id, table) => http<ResRow>("POST", "admin/reservations/" + e(id) + "/table", { table })),
  phone: pick(async (c, id: string) => c.resAdmin.phone(await g(c), id), (id) => http<{ phone: string }>("POST", "admin/reservations/" + e(id) + "/phone")),
  blocks: pick(async (c) => c.resAdmin.blocks(await g(c)), () => http<{ rows: BlockRow[]; canDecide: boolean; limit: number }>("GET", "admin/blocks")),
  /** "Блокирай" (block) / "Не блокирай", "Отблокирай" (clear): main admin, owner, manager */
  decide: pick(async (c, ref: string, action: "block" | "clear") => c.resAdmin.decide(await g(c), ref, action), (ref, action) => http<BlockRow>("POST", "admin/blocks/" + e(ref), { action })),
  addBlock: pick(async (c, phone: string, name?: string) => c.resAdmin.addBlock(await g(c), { phone, name }), (phone, name) => http<BlockRow>("POST", "admin/blocks", { phone, name })),
};

/* ---------- Залата, QR ---------- */
export const hallApi = {
  get: pick(async (c) => c.hall.get(await g(c)), () => http<HallView>("GET", "admin/hall")),
  /** "Запази плана": the whole plan; 409 conflict (version), 422 fields "tables.<i>.<поле>" / "merges" */
  save: pick(async (c, h: Partial<HallData>, version?: number) => c.hall.save(await g(c), h, version), (h, version) => http<HallView>("PUT", "admin/hall", { ...h, version })),
  qr: pick(async (c) => c.hall.qr(await g(c)), () => http<QrRow[]>("GET", "admin/qr")),
  /** "Нов код": the old label stops working */
  qrRenew: pick(async (c, table: string) => c.hall.qrRenew(await g(c), table), (table) => http<QrRow>("POST", "admin/qr/" + e(table))),
  /** public (the QR table, etap D): 404 "Този код вече не работи" */
  table: pick(async (c, code: string) => c.hall.byQr(code), (code) => http<{ id: string; n: number; zone: "salon" | "garden"; seats: number }>("GET", "table/" + e(code))),
};

/* ---------- Зони ---------- */
export const zonesApi = {
  list: pick(async (c) => c.zones.list(await g(c)), () => http<ZonesView>("GET", "admin/zones")),
  /** one quarter (only the fields sent); 422 fields fee / min / etaMin / from / to; 409 conflict with version */
  save: pick(async (c, slug: string, p: ZonePatch, version?: number) => c.zones.save(await g(c), slug, p, version), (slug, p, version) => http<ZonesView>("PATCH", "admin/zones/" + e(slug), { ...p, version })),
  /** public: the live zones (+ on, min, from, to) */
  live: pick(async (c) => c.zones.public(), () => http<Zone[]>("GET", "zones")),
};

/* ---------- Оферти и ваучери ---------- */
export const offersApi = {
  list: pick(async (c) => c.offersAdmin.list(await g(c)), () => http<OffersView>("GET", "admin/offers")),
  /** "В сайта": 409 locked (-30%), 409 missing (early days / loyalty rule) */
  toggle: pick(async (c, id: string, on: boolean, version?: number) => c.offersAdmin.toggle(await g(c), id, on, version), (id, on, version) => http<OffersView>("POST", "admin/offers/" + e(id) + "/toggle", { on, version })),
  /** "Правила" and the texts: 422 fields r.days / r.from / r.ch / r.dish / title (a Google review is refused) */
  save: pick(async (c, id: string, p: OfferPatch, version?: number) => c.offersAdmin.save(await g(c), id, p, version), (id, p, version) => http<OffersView>("PATCH", "admin/offers/" + e(id), { ...p, version })),
  create: pick(async (c, p: OfferPatch & { title: string }) => c.offersAdmin.create(await g(c), p), (p) => http<OffersView & { id: string }>("POST", "admin/offers", p)),
  remove: pick(async (c, id: string) => c.offersAdmin.remove(await g(c), id), (id) => http<OffersView & { removed: OfferRow }>("DELETE", "admin/offers/" + e(id))),
  restore: pick(async (c, row: OfferRow) => c.offersAdmin.restore(await g(c), row), (row) => http<OffersView>("POST", "admin/offers/restore", { row })),
  /** SC10- / SCV-: valid / used / unknown with the core's text (into the log) */
  checkCode: pick(async (c, code: string) => c.offersAdmin.checkCode(await g(c), code), (code) => http<CodeCheck>("POST", "admin/codes/check", { code })),
  vouchers: pick(async (c) => c.offersAdmin.vouchers(await g(c)), () => http<Voucher[]>("GET", "admin/vouchers")),
  /** "Нови кодове": kind "sum" (€) or "pct", 1-50 at a time */
  createVouchers: pick(async (c, p: { kind: "sum" | "pct"; value: number | string; n: number; note?: string }) => c.offersAdmin.createVouchers(await g(c), p), (p) => http<Voucher[]>("POST", "admin/vouchers", p)),
  useVoucher: pick(async (c, code: string, note?: string) => c.offersAdmin.useVoucher(await g(c), code, note), (code, note) => http<Voucher>("POST", "admin/vouchers/use", { code, note })),
};

/* ---------- Събития ---------- */
export const eventsAdminApi = {
  list: pick(async (c, f: { tab?: "upcoming" | "past" | "all"; cat?: string } = {}) => c.eventsAdmin.list(await g(c), f), (f = {}) => http<{ version: number; rows: EventView[]; cats: readonly string[]; counts: { upcoming: number; past: number } }>("GET", "admin/events" + q(f))),
  /** "Запази чернова" / "Публикувай" (publish: true): 422 fields n / cat / date / time / price / seats */
  create: pick(async (c, p: EventInput & { publish?: boolean }) => c.eventsAdmin.create(await g(c), p), (p) => http<EventView & { version: number }>("POST", "admin/events", p)),
  update: pick(async (c, id: string, p: EventInput, version?: number) => c.eventsAdmin.update(await g(c), id, p, version), (id, p, version) => http<EventView & { version: number }>("PATCH", "admin/events/" + e(id), { ...p, version })),
  publish: pick(async (c, id: string, on: boolean = true) => c.eventsAdmin.publish(await g(c), id, on), (id: string, on: boolean = true) => http<EventView & { version: number }>("POST", "admin/events/" + e(id) + "/publish", { on })),
  remove: pick(async (c, id: string) => c.eventsAdmin.remove(await g(c), id), (id) => http<{ ok: true; removed: EventRow; version: number }>("DELETE", "admin/events/" + e(id))),
  restore: pick(async (c, row: EventRow) => c.eventsAdmin.restore(await g(c), row), (row) => http<EventView & { version: number }>("POST", "admin/events/restore", { row })),
};

/* ---------- Клиенти, обратна връзка, запитвания ---------- */
export const customersAdminApi = {
  list: pick(async (c, f: { q?: string; filter?: "offers" | "birthday" | "blocked" | "new" | "" } = {}) => c.customersAdmin.list(await g(c), f), (f = {}) => http<{ rows: CustomerRow[]; total: number }>("GET", "admin/customers" + q(f))),
  get: pick(async (c, id: string) => c.customersAdmin.get(await g(c), id), (id) => http<CustomerDetail>("GET", "admin/customers/" + e(id))),
  /** "Покажи" phone and e-mail (into the log) */
  contact: pick(async (c, id: string) => c.customersAdmin.contact(await g(c), id), (id) => http<{ phone: string; email: string | null }>("POST", "admin/customers/" + e(id) + "/contact")),
  /** "Изтегли данните" (GDPR): the JSON (the screen saves it as a file) */
  export: pick(async (c, id: string) => c.customersAdmin.export(await g(c), id), (id) => http<unknown>("GET", "admin/customers/" + e(id) + "/export")),
  /** "Изтрий": {until} (epoch ms); deleted for good after the window unless restore() comes first */
  remove: pick(async (c, id: string) => c.customersAdmin.remove(await g(c), id), (id) => http<{ id: string; until: number }>("DELETE", "admin/customers/" + e(id))),
  /** "Отмени" in the window; 410 gone after it */
  restore: pick(async (c, id: string) => c.customersAdmin.restore(await g(c), id), (id) => http<{ id: string; ok: true }>("POST", "admin/customers/" + e(id) + "/restore")),
  /** kind "feedback" (Пишете ни, ratings) or "inquiries" (voucher, birthday; also the section "Оферти") */
  messages: pick(async (c, kind: "feedback" | "inquiries" = "feedback") => c.customersAdmin.feedback(await g(c), kind), (kind = "feedback") => http<{ rows: FeedbackRow[]; newN: number }>("GET", "admin/messages" + q({ kind }))),
  messageStatus: pick(async (c, id: string, status: FeedbackStatus) => c.customersAdmin.feedbackStatus(await g(c), id, status), (id, status) => http<FeedbackRow>("POST", "admin/messages/" + e(id) + "/status", { status })),
  messageContact: pick(async (c, id: string) => c.customersAdmin.feedbackContact(await g(c), id), (id) => http<{ contact: string; mode: "phone" | "email" }>("POST", "admin/messages/" + e(id) + "/contact")),
};

/* ---------- Отчети ---------- */
export const reportsApi = {
  /** period: today | yesterday | 7 | 30 | month | custom (from, to; up to 92 days: 422); compare: the period before */
  get: pick(async (c, f: { period?: Period; from?: string; to?: string; compare?: boolean } = {}) => c.reports.get(await g(c), f),
    (f = {}) => http<ReportView>("GET", "admin/reports" + q({ period: f.period, from: f.from, to: f.to, compare: f.compare === false ? 0 : undefined }))),
};

/* ---------- Персонал ---------- */
export const staffAdminApi = {
  list: pick(async (c) => c.staffAdmin.list(await g(c)), () => http<{ rows: StaffRow[]; roles: { id: RoleId; n: string; desc: string; manageable: boolean }[]; stats: { active: number; inactive: number; apps: number; noPin: number } }>("GET", "admin/staff/list")),
  /** pin: "" = a random one (pin_once in the answer, shown once) */
  create: pick(async (c, p: { username: string; name: string; role: RoleId; password: string; pin?: string | null }) => c.staffAdmin.create(await g(c), p), (p) => http<StaffRow & { pin_once?: string }>("POST", "admin/staff", p)),
  update: pick(async (c, id: string, p: { name?: string; role?: RoleId }) => c.staffAdmin.update(await g(c), id, p), (id, p) => http<StaffRow>("PATCH", "admin/staff/" + e(id), p)),
  setActive: pick(async (c, id: string, active: boolean) => c.staffAdmin.setActive(await g(c), id, active), (id, active) => http<StaffRow>("POST", "admin/staff/" + e(id) + "/active", { active })),
  setPassword: pick(async (c, id: string, password: string) => c.staffAdmin.setPassword(await g(c), id, password, demoTok("staff") || undefined), (id, password) => http<{ ok: true }>("POST", "admin/staff/" + e(id) + "/password", { password })),
  /** {pin} once; 422 "Изберете друг ПИН."; 429 after 5 refused in 15 min; no pin = a random one */
  setPin: pick(async (c, id: string, pin?: string) => c.staffAdmin.setPin(await g(c), id, pin), (id, pin) => http<{ pin: string; at: string }>("POST", "admin/staff/" + e(id) + "/pin", pin ? { pin } : {})),
  removePin: pick(async (c, id: string) => c.staffAdmin.removePin(await g(c), id), (id) => http<StaffRow>("DELETE", "admin/staff/" + e(id) + "/pin")),
};

/* ---------- данните на сайта: пресглобяването ---------- */
export interface SiteBuildState { state: "idle" | "queued" | "building" | "done" | "error"; at: string | null; error?: string; how?: "build" | "swap"; ms?: number; waiting: boolean }
const IDLE: SiteBuildState = { state: "idle", at: null, waiting: false };
type SiteState = { mode: "server" | "demo"; sections: Record<"zones" | "hall" | "events" | "offers", { version: number; at: string | null; by: string | null }>; build: SiteBuildState };
export const siteApi = {
  /** the versions of the zones, hall, events and offers (who, when) and the rebuild of the site; demo: mode "demo" */
  state: pick(async (c): Promise<SiteState> => ({ ...(await c.site.state(await g(c))), build: IDLE }), () => http<SiteState>("GET", "admin/site/state")),
};
