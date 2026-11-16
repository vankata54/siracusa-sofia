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

export * from "./types.ts";
export * from "./repo.ts";
export * from "./ctx.ts";
export { pushText, PUSH_MSG, PUSH_MAX_PER_ORDER, type PushSub, type PushPayload, type PushSender } from "./push.ts";
export { FLOW, STATUS_LABEL, FIRST_ORDER_NO, FINISHED, MSG, nextStatus, publicOrder, parseTrack, orderDay, CHANGE_BEFORE_MIN, CHANGE_MSG, type PublicOrder, type OrderChange } from "./orders.ts";
export { publicOffice, officeDue, officeDueAt, OFFICE_MSG, type PublicOffice } from "./office.ts";
export { normCode, CODE_MSG } from "./codes.ts";
export { DEFAULT_SETTINGS } from "./settings.ts";
export { outNow, type SoldOutToday, type SoldOutDoc } from "./menu.ts";
export { FEEDBACK_MSG, type Feedback, type FeedbackInput } from "./feedback.ts";
export { SECTIONS, ALL_SECTIONS, DEFAULT_ROLES, ROLE_IDS, STAFF_APP, homeOf, LOGIN_MAX_FAILS, type StaffCtx, type PublicStaff } from "./staff.ts";
export { NOTE_MSG, scrubPersonal, isSiteUrl, type NoteInput, type NoteFilter } from "./notes.ts";
export { NO_SHOW_LIMIT } from "./reservations.ts";
export { normKey, maskPhone, type Summary, type SearchHit, type SearchAnswer } from "./admin.ts";
export { BLOCKED_DEMO_PHONE } from "./reservations.ts";

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
    settings: bind(ctx, { get: settings.getSettings, update: settings.updateSettings }),
    menu: bind(ctx, { soldOutToday: menu.soldOutToday, setSoldOut: menu.setSoldOut }),
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
    audit: bind(ctx, { log: auditMod.audit, list: auditMod.listAudit }),
  };
}
export type Core = ReturnType<typeof createCore>;
