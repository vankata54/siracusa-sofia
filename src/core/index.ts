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
import * as kitchenMod from "./kitchen.ts";
import * as driverMod from "./driver.ts";
/* stage D: the hall live (the QR table, the waiter, the shift) and the PIN sign-in on a known device */
import * as floorB from "./floor.ts";
import * as floorG from "./floor-guest.ts";
import * as floorS from "./floor-staff.ts";
import * as floorSh from "./floor-shift.ts";
import * as pinMod from "./staff-pin.ts";
/* stage D, step 6: the manager's module (core/shift.ts) and the owner's (core/owner.ts, with THE history core/history.ts) */
import * as shiftMod from "./shift.ts";
import * as ownerMod from "./owner.ts";

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
/* stage D, the kitchen (core/kitchen.ts; the screens import the types through src/client/api-kitchen.ts) */
export { K_ALL, K_MSG, K_MISSING, KS_TEXT, DEFAULT_KITCHEN, TABLET_ALIVE_SEC, KITCHEN_BEAT_SEC, KITCHEN_UNDO_SEC, BUSY_REMIND_MIN, type KitchenConfig, type KSectionDef, type KState, type KTimer, type KKind,
  type KSrc, type KLineView, type KSecState, type KOther, type KTicket, type KLater, type KBusy, type KConfigView, type KConfigPatch, type KQueue, type KAct, type KDoneRow, type KDone, type KTablet,
  type KSummary, type KOutItem, type KOutRow, type KSoldOut, type KOutResult, type KBusyView, type KFound, type KSearch, type KOpt } from "./kitchen.ts";
/* the driver (core/driver.ts): the screens import the types and the words through src/client/api-driver.ts */
export {
  DRIVER_MSG, DRIVER_MISSING, DRIVER_UNDO_MS, DELIVERY_LABEL, PROBLEM_LABEL, PROBLEM_KINDS, ANSWER_LABEL, ASK_ANSWERS, DRIVER_STATUS_LABEL, NAV_APPS, DEFAULT_CARS, ARRIVED_TEXT, RECEIPT_MAX, RECEIPT_PER_HOUR, RECEIPT_URL, imageDims,
  type DeliveryState, type ProblemKind, type AskAnswer, type DriverStatus, type NavApp, type RoutePick, type DriverCar, type CarView, type ShiftView, type DriverState, type ShiftStart,
  type Delivery, type DriverList, type AskView, type RouteView, type RouteOption, type StepResult, type ArriveResult, type FuelView, type FuelPage, type FuelInput, type FuelReport,
  type ShiftTotals, type ShiftSummary, type DriverRow, type DriversView, type DriverShift, type DriverAsk, type FuelEntry,
} from "./driver.ts";
export { FLOOR_MSG, CALL_KINDS, CALL_LABEL, CALL_STAFF, REJECT_REASONS, LINE_LABEL, MAX_PHONES, CALL_WARN_MIN, FLOOR_UNDO_MS, BILL_ALL,
  type CallKind, type RejectReason, type LineSt, type TableSession, type FloorCartLine, type FloorPayment, type GuestView, type GuestCartLine, type GuestOrder, type GuestOrderLine, type GuestCall } from "./floor.ts";
export { TABLE_STATE_LABEL, type TableStateKey, type HallLive, type HallTile, type HallCall, type HallQr, type TableDetail, type StaffBill, type StaffOrder, type StaffLine, type PendingLine,
  type ReadyGroup, type StaffOrderInput, type StaffSearch, type TableRating } from "./floor-staff.ts";
export { SHIFT_MSG, type WaiterShift, type ShiftMine, type WaiterShiftView, type ShiftRow } from "./floor-shift.ts";
export { PIN_MSG, PIN_MODULES, PIN_LOGIN_DEVICE, PIN_LOGIN_PERSON, type PinModule, type PinPeople } from "./staff-pin.ts";
export { TABLE_MSG, GRAMS_MIN, GRAMS_MAX, LUNCH_TABLE_MISSING, type TableOrderInput, type TableLine } from "./orders.ts";
/* the manager and the owner (the screens import the types through src/client/api-boss.ts) */
export { MGR_MSG, MGR_UNDO_MS, MANAGER_ROLES, MGR_TILE_LABEL, RES_AHEAD_MIN, type MgrNow, type Problem, type ProblemRef, type WaitOrder, type WaitRes, type MgrKitchen, type MgrHall, type MgrTile, type MgrTileState,
  type MgrTable, type TonightRes, type MgrTeam, type MgrSearch } from "./shift.ts";
export { OWNER_MSG, OWNER_MISSING, OWNER_ROLES, OWNER_QUESTIONS, OWNER_GROUPS, FACT_QUESTIONS, ALERT_PCT, ALERT_MIN_ORDERS, ANSWER_UNDO_MS, type OwnerToday, type OwnerWaits, type OwnerTrends, type TrendQuery,
  type OwnerFinance, type PayBlock, type OwnerQuestion, type QuestionView, type OwnerDecisions, type AnswerInput, type AnswerResult, type MailSettings } from "./owner.ts";
export { YEAR_DAYS, USUAL_WEEKS, HISTORY_MAX_DAYS, CH5_LABEL, CH_LABEL as REPORT_CH_LABEL, type Compare, type Ch5, type ChKey, type Peak, type Pair, type Times } from "./history.ts";

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
    /* stage D, the kitchen: every function takes the staff member and checks the rights itself (core/kitchen.ts) */
    kitchen: bind(ctx, {
      config: kitchenMod.kitchenConfigView, setConfig: kitchenMod.kitchenSetConfig, queue: kitchenMod.kitchenQueue, start: kitchenMod.kitchenStart, line: kitchenMod.kitchenLine,
      done: kitchenMod.kitchenDone, back: kitchenMod.kitchenBack, seen: kitchenMod.kitchenSeen, doneToday: kitchenMod.kitchenDoneToday, summary: kitchenMod.kitchenSummary,
      soldOut: kitchenMod.kitchenSoldOut, setOut: kitchenMod.kitchenSetOut, busy: kitchenMod.kitchenBusy, setBusy: kitchenMod.kitchenSetBusy, beat: kitchenMod.kitchenBeat,
      tablets: kitchenMod.kitchenTablets, search: kitchenMod.kitchenSearch,
    }),
    /* the driver: the shift, the deliveries, a problem, the question to the manager, the route, fuel, the end of the shift,
       and what the manager and the owner see (core/driver.ts; the rights are inside every function) */
    driver: bind(ctx, {
      state: driverMod.state, start: driverMod.start, prefs: driverMod.prefs, changeCar: driverMod.changeCar, saveCars: driverMod.saveCars,
      list: driverMod.list, get: driverMod.get, take: driverMod.take, go: driverMod.go, arrive: driverMod.arrive, deliver: driverMod.deliver,
      problem: driverMod.problem, returned: driverMod.returned, undo: driverMod.undo, ask: driverMod.ask, asks: driverMod.asks, answer: driverMod.answer, answerUndo: driverMod.answerUndo,
      route: driverMod.route, routePick: driverMod.routePick, routeMove: driverMod.routeMove, fuel: driverMod.fuel, fuelAdd: driverMod.fuelAdd, fuelReport: driverMod.fuelReport, receiptCheck: driverMod.receiptCheck, receiptKeep: driverMod.receiptKeep, receiptAccess: driverMod.receiptAccess, setCarKm: driverMod.setCarKm, confirmFuel: driverMod.confirmFuel, confirmFuelUndo: driverMod.confirmFuelUndo,
      shift: driverMod.shift, end: driverMod.end, drivers: driverMod.drivers, search: driverMod.search,
    }),
    /* ---------- stage D: the hall live (core/floor*.ts). The guests' calls take the table code and the phone's token; the
       staff's take the staff member (StaffCtx) and check the right themselves ---------- */
    floor: bind(ctx, {
      open: floorG.guestOpen, view: floorG.guestView, stream: floorG.streamSession, cartAdd: floorG.guestCartAdd, cartQty: floorG.guestCartQty, cartRemove: floorG.guestCartRemove,
      cartRestore: floorG.guestCartRestore, send: floorG.guestSend, rejectedOk: floorG.guestRejectedOk, call: floorG.guestCall, callCancel: floorG.guestCallCancel,
      callRestore: floorG.guestCallRestore, bill: floorG.guestBill, pick: floorG.guestPick, rate: floorG.guestRate,
      hall: floorS.hallLive, table: floorS.tableDetail, seat: floorS.seat, callTake: floorS.callTake, callDone: floorS.callDone, callUndo: floorS.callUndo,
      qrConfirm: floorS.qrConfirm, qrReject: floorS.qrReject, qrRejectUndo: floorS.qrRejectUndo, qrDrop: floorS.qrDrop, order: floorS.staffOrder, serve: floorS.serve, unserve: floorS.unserve,
      ready: floorS.ready, pay: floorS.pay, close: floorS.closeTable, search: floorS.staffSearch, ratings: floorS.tableRatings,
      /* the kitchen changed a line of a table order: the guests of that sitting hear floor.session (server/app.ts) */
      touched: floorB.sessionTouched,
      shiftMine: floorSh.shiftMine, shiftStart: floorSh.shiftStart, shiftEnd: floorSh.shiftEnd, shiftView: floorSh.shiftView, shiftSetTables: floorSh.shiftSetTables,
    }),
    pin: bind(ctx, { people: pinMod.pinPeople, login: pinMod.pinLogin }),
    /* ---------- stage D, step 6: "Управител" (rights: main admin, owner, manager; "Залата" hall | reservations, "Екипът" staff)
       and "Собственик" (owner and main admin; only the owner answers the questions). Sums over several orders only with
       "Финанси и гориво". Every action writes a line in the log and tells the screens shift.update. ---------- */
    shift: bind(ctx, {
      now: shiftMod.managerNow, hall: shiftMod.managerHall, table: shiftMod.managerTable, team: shiftMod.managerTeam, search: shiftMod.managerSearch,
      accept: shiftMod.managerAccept, acceptUndo: shiftMod.managerAcceptUndo, callCustomer: shiftMod.managerCallCustomer, ack: shiftMod.managerAck, ackUndo: shiftMod.managerAckUndo,
      callGo: shiftMod.managerCallGo, callAssign: shiftMod.managerCallAssign, callUndo: shiftMod.managerCallUndo,
      qrConfirm: shiftMod.managerQrConfirm, qrAssign: shiftMod.managerQrAssign, qrAssignUndo: shiftMod.managerQrAssignUndo,
      answer: shiftMod.managerAnswer, answerUndo: shiftMod.managerAnswerUndo, resConfirm: shiftMod.managerResConfirm, block: shiftMod.managerBlock,
      busy: shiftMod.managerBusy, backIn: shiftMod.managerBackIn, setTables: shiftMod.managerSetTables, setTablesUndo: shiftMod.managerSetTablesUndo,
      setWaiter: shiftMod.managerSetWaiter, walkin: shiftMod.managerWalkin,
    }),
    owner: bind(ctx, {
      today: ownerMod.ownerToday, trends: ownerMod.ownerTrends, finance: ownerMod.ownerFinance, decisions: ownerMod.ownerDecisions,
      answer: ownerMod.ownerAnswer, answerUndo: ownerMod.ownerAnswerUndo, block: ownerMod.ownerBlock, setMail: ownerMod.ownerSetMail,
    }),
    audit: bind(ctx, { log: auditMod.audit, list: auditMod.listAudit }),
  };
}
export type Core = ReturnType<typeof createCore>;
