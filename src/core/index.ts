/* The business core. One API for the server (SQLite) and the static demo (localStorage). */
import type { Ctx } from "./ctx.ts";
import * as orders from "./orders.ts";
import * as res from "./reservations.ts";
import * as cust from "./customers.ts";
import * as staff from "./staff.ts";
import * as notes from "./notes.ts";
import * as auditMod from "./audit.ts";

export * from "./types.ts";
export * from "./repo.ts";
export * from "./ctx.ts";
export { FLOW, STATUS_LABEL, FIRST_ORDER_NO, nextStatus } from "./orders.ts";
export { SECTIONS, DEFAULT_ROLES } from "./staff.ts";
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
    orders: bind(ctx, { create: orders.createOrder, get: orders.getOrder, list: orders.listOrders, setStatus: orders.setOrderStatus }),
    reservations: bind(ctx, { create: res.createReservation, list: res.listReservations, taken: res.takenTables, setStatus: res.setReservationStatus }),
    celebrations: bind(ctx, { create: res.createCelebration }),
    office: bind(ctx, { create: res.createOffice, get: res.getOffice, join: res.joinOffice, submit: res.submitOffice }),
    subscriptions: bind(ctx, { subscribe: res.subscribe }),
    customers: bind(ctx, {
      requestCode: cust.requestSmsCode, verifyCode: cust.verifySmsCode, bySession: cust.customerBySession, logout: cust.logout,
      update: cust.updateCustomer, toggleFav: cust.toggleFavourite, addAddress: cust.addAddress, removeAddress: cust.removeAddress,
      orders: cust.customerOrders, export: cust.exportCustomer, remove: cust.deleteCustomer,
    }),
    ratings: bind(ctx, { submit: cust.submitRating }),
    staff: bind(ctx, {
      login: staff.staffLogin, bySession: staff.staffBySession, logout: staff.staffLogout, list: staff.listStaff, upsert: staff.upsertStaff,
      roles: staff.roles, can: staff.can, setRole: staff.setRoleSections,
    }),
    notes: bind(ctx, { create: notes.createNote, list: notes.listNotes, setStatus: notes.setNoteStatus, remove: notes.deleteNote }),
    audit: bind(ctx, { log: auditMod.audit, list: auditMod.listAudit }),
  };
}
export type Core = ReturnType<typeof createCore>;
