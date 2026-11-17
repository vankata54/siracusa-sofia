/* The business core. One API for the server (SQLite) and the static demo (localStorage). */
import type { Ctx } from "./ctx.ts";
import * as orders from "./orders.ts";
import * as res from "./reservations.ts";
import * as cust from "./customers.ts";
import * as staff from "./staff.ts";
import * as notes from "./notes.ts";
import * as auditMod from "./audit.ts";
import * as office from "./office.ts";
import * as codes from "./codes.ts";
import * as settings from "./settings.ts";
import * as feedback from "./feedback.ts";
import * as menu from "./menu.ts";
import * as push from "./push.ts";
import * as adminMod from "./admin.ts";
import * as menuEdit from "./menu-edit.ts";
import * as lunchMod from "./lunch.ts";
import * as siteMod from "./site-data.ts";
import * as ordersAdm from "./orders-admin.ts";
import * as resAdm from "./reservations-admin.ts";
import * as hallMod from "./hall.ts";
import * as zonesMod from "./zones.ts";
import * as offersAdm from "./offers-admin.ts";
import * as eventsAdm from "./events-admin.ts";
import * as custAdm from "./customers-admin.ts";
import * as reportsMod from "./reports.ts";
import * as staffAdm from "./staff-admin.ts";

export * from "./types.ts";
export * from "./repo.ts";
export * from "./ctx.ts";
export { pushText, PUSH_MSG, PUSH_MAX_PER_ORDER, type PushSub, type PushPayload, type PushSender } from "./push.ts";
export { FLOW, STATUS_LABEL, FIRST_ORDER_NO, FINISHED, MSG, nextStatus, publicOrder, parseTrack, orderDay, CHANGE_BEFORE_MIN, CHANGE_MSG, type PublicOrder, type OrderChange } from "./orders.ts";
export { publicOffice, officeDue, officeDueAt, OFFICE_MSG, type PublicOffice } from "./office.ts";
export { normCode, CODE_MSG } from "./codes.ts";
export { DEFAULT_SETTINGS } from "./settings.ts";
export { outNow, type SoldOutToday, type SoldOutDoc } from "./menu.ts";
export { MENU_MSG, DEMO_PHOTO_MAX, menuPages, type DraftView, type MenuChanges, type FieldChange, type PublishState } from "./menu-edit.ts";
export { LUNCH_MSG, LUNCH_GROUPS, LUNCH_BOSS, PIN_FAILS_DEVICE, PIN_FAILS_PERSON, type LunchView, type LunchItem, type LunchFav } from "./lunch.ts";
export { removedMsg } from "./orders.ts";
export { FEEDBACK_MSG, type Feedback, type FeedbackInput } from "./feedback.ts";
export { SECTIONS, ALL_SECTIONS, DEFAULT_ROLES, ROLE_IDS, STAFF_APP, homeOf, LOGIN_MAX_FAILS, type StaffCtx, type PublicStaff } from "./staff.ts";
export { NOTE_MSG, scrubPersonal, isSiteUrl, type NoteInput, type NoteFilter } from "./notes.ts";
export { NO_SHOW_LIMIT } from "./reservations.ts";
export { normKey, maskPhone, type Summary, type SearchHit, type SearchAnswer } from "./admin.ts";
export { BLOCKED_DEMO_PHONE } from "./reservations.ts";
/* part 3 of the admin: the sections' types and texts (the screens import them through src/client/api-admin-3.ts) */
export { SITE_SECTIONS, type SiteBuild, type ZoneRow, type HallTable, type HallData, type EventRow, type OfferRow, type OfferRule, type OfferChannel, type PriceMode } from "./site-data.ts";
export { CHANNEL_LABEL, ORDERS_MSG, type OrderRow, type OrderDetail, type OrdersQuery, type PhoneOrderInput } from "./orders-admin.ts";
export { RES_STATUS_LABEL, RESA_MSG, type ResRow, type ResDay, type BlockRow } from "./reservations-admin.ts";
export { HALL_MSG, type HallView, type QrRow } from "./hall.ts";
export { ZONE_MSG, type ZonesView, type ZonePatch } from "./zones.ts";
export { OFFER_MSG, type OffersView, type OfferPatch, type Voucher, type CodeCheck } from "./offers-admin.ts";
export { EVENT_MSG, type EventView, type EventInput } from "./events-admin.ts";
export { UNDO_MS, CUST_MSG, type CustomerRow, type CustomerDetail, type FeedbackRow, type FeedbackStatus } from "./customers-admin.ts";
export { REPORT_MSG, REPORT_MAX_DAYS, type Report, type ReportView, type Period } from "./reports.ts";
export { STAFF_MSG, PIN_ROLES, RANK, type StaffRow } from "./staff-admin.ts";

type Tail<F> = F extends (ctx: Ctx, ...a: infer A) => infer R ? (...a: A) => R : never;
type Bound<M> = { [K in keyof M]: M[K] extends (ctx: Ctx, ...a: never[]) => unknown ? Tail<M[K]> : never };

function bind<M extends Record<string, unknown>>(ctx: Ctx, m: M): Bound<Pick<M, { [K in keyof M]: M[K] extends (...a: never[]) => unknown ? K : never }[keyof M]>> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m)) { const f = m[k]; if (typeof f === "function") out[k] = (...a: unknown[]) => (f as (...x: unknown[]) => unknown)(ctx, ...a); }
  return out as never;
}

export function createCore(ctx: Ctx) {
  return {
    ctx,
    orders: bind(ctx, { create: orders.createOrder, get: orders.getOrder, track: orders.trackOrder, find: orders.findTracked, list: orders.listOrders, setStatus: orders.setOrderStatus, change: orders.changeOrder }),
    push: bind(ctx, { subscribe: push.pushSubscribe, unsubscribe: push.pushUnsubscribe, status: push.pushStatus }),
    reservations: bind(ctx, { create: res.createReservation, list: res.listReservations, taken: res.takenForGuest, setStatus: res.setReservationStatus, get: res.getReservation, cancel: res.cancelReservation }),
    celebrations: bind(ctx, { create: res.createCelebration }),
    office: bind(ctx, { create: office.createOffice, get: office.viewOffice, raw: office.getOffice, join: office.joinOffice, update: office.updateOffice, submit: office.submitOffice, sendDue: office.sendDueOffices }),
    codes: bind(ctx, { check: codes.checkCode }),
    /* view: + the hours (read only) for "Настройки" (reservations-admin.ts) */
    settings: bind(ctx, { get: settings.getSettings, update: settings.updateSettings, view: resAdm.settingsView }),
    menu: bind(ctx, { soldOutToday: menu.soldOutToday, setSoldOut: menu.setSoldOut }),
    /* the menu editor: the live menu, one shared draft with a version, publish / rollback (core/menu-edit.ts) */
    menuEdit: bind(ctx, {
      boot: menuEdit.boot, live: menuEdit.getLive, effective: menuEdit.effectiveMenu, site: menuEdit.siteMenu, refresh: menuEdit.refreshLive,
      getDraft: menuEdit.getDraft, saveDraft: menuEdit.saveDraft, discardDraft: menuEdit.discardDraft, publish: menuEdit.publish,
      rollback: menuEdit.rollback, publishState: menuEdit.publishState,
    }),
    /* the lunch menu: weekly schedule, publishing by day, favourites, the PIN (core/lunch.ts) */
    lunch: bind(ctx, {
      get: lunchMod.getLunch, saveDay: lunchMod.saveDay, publish: lunchMod.publishDays, saveFav: lunchMod.saveFav, removeFav: lunchMod.removeFav,
      addDish: lunchMod.addDish, setPin: lunchMod.setPin, unlock: lunchMod.unlock, lock: lunchMod.lock, pinState: lunchMod.pinState,
    }),
    feedback: bind(ctx, { create: feedback.createFeedback, list: feedback.listFeedback }),
    subscriptions: bind(ctx, { subscribe: res.subscribe }),
    customers: bind(ctx, {
      requestCode: cust.requestSmsCode, verifyCode: cust.verifySmsCode, bySession: cust.customerBySession, view: cust.customerView, logout: cust.logout,
      update: cust.updateCustomer, toggleFav: cust.toggleFavourite, addAddress: cust.addAddress, removeAddress: cust.removeAddress,
      orders: cust.customerOrders, codes: cust.customerCodes, export: cust.exportCustomer, remove: cust.deleteCustomer,
    }),
    ratings: bind(ctx, { submit: codes.submitRating }),
    staff: bind(ctx, {
      login: staff.staffLogin, bySession: staff.staffBySession, logout: staff.staffLogout, list: staff.listStaff, upsert: staff.upsertStaff,
      roles: staff.roles, can: staff.can, setRole: staff.setRoleSections, guard: staff.guard,
    }),
    notes: bind(ctx, {
      create: notes.createNote, suggest: notes.suggestNote, list: notes.listNotes, mine: notes.myNotes, approved: notes.approvedNotes,
      setStatus: notes.setNoteStatus, remove: notes.deleteNote, restore: notes.restoreNote, waiting: notes.notesWaiting, seen: notes.markNotesSeen,
    }),
    admin: bind(ctx, { summary: adminMod.summary, search: adminMod.search }),
    /* ---------- part 3 of the admin: every function takes the staff member (StaffCtx) and checks the rights itself ---------- */
    /* the site data (zones, hall, events, offers): the live documents and the file of the rebuild (core/site-data.ts) */
    site: bind(ctx, { boot: siteMod.bootSite, build: siteMod.siteBuild, version: siteMod.siteVersion, sections: siteMod.allSections, state: siteMod.siteState }),
    ordersAdmin: bind(ctx, { list: ordersAdm.ordersList, get: ordersAdm.orderDetail, phone: ordersAdm.orderPhone, cancel: ordersAdm.orderCancel, step: ordersAdm.orderStep, phoneOrder: ordersAdm.phoneOrder }),
    resAdmin: bind(ctx, {
      day: resAdm.resDay, month: resAdm.resMonth, phone: resAdm.resPhone, setStatus: resAdm.resSetStatus, setTable: resAdm.resSetTable, free: resAdm.resFreeTables, create: resAdm.resCreate,
      blocks: resAdm.blockList, decide: resAdm.blockDecide, addBlock: resAdm.blockAdd,
    }),
    hall: bind(ctx, { get: hallMod.getHall, save: hallMod.saveHall, qr: hallMod.qrList, qrRenew: hallMod.qrRenew, byQr: hallMod.tableByQr, live: hallMod.liveHall }),
    zones: bind(ctx, { list: zonesMod.listZones, save: zonesMod.saveZone, public: zonesMod.publicZones, live: zonesMod.liveZones }),
    offersAdmin: bind(ctx, {
      list: offersAdm.offersList, toggle: offersAdm.offerToggle, save: offersAdm.offerSave, create: offersAdm.offerCreate, remove: offersAdm.offerRemove, restore: offersAdm.offerRestore,
      checkCode: offersAdm.codeCheck, vouchers: offersAdm.vouchers, createVouchers: offersAdm.voucherCreate, useVoucher: offersAdm.voucherUse, public: offersAdm.publicOffers,
    }),
    eventsAdmin: bind(ctx, { list: eventsAdm.eventsList, create: eventsAdm.eventCreate, update: eventsAdm.eventUpdate, publish: eventsAdm.eventPublish, remove: eventsAdm.eventRemove, restore: eventsAdm.eventRestore, public: eventsAdm.publicEvents }),
    customersAdmin: bind(ctx, {
      list: custAdm.customersList, get: custAdm.customerDetail, contact: custAdm.customerContact, export: custAdm.customerExport, remove: custAdm.customerRemove, restore: custAdm.customerRestore,
      purge: custAdm.customersPurge, feedback: custAdm.feedbackList, feedbackStatus: custAdm.feedbackSetStatus, feedbackContact: custAdm.feedbackContact,
    }),
    reports: bind(ctx, { get: reportsMod.report }),
    staffAdmin: bind(ctx, { list: staffAdm.staffList, create: staffAdm.staffCreate, update: staffAdm.staffUpdate, setActive: staffAdm.staffSetActive, setPassword: staffAdm.staffSetPassword, setPin: staffAdm.staffSetPin, removePin: staffAdm.staffRemovePin }),
    audit: bind(ctx, { log: auditMod.audit, list: auditMod.listAudit }),
  };
}
export type Core = ReturnType<typeof createCore>;
