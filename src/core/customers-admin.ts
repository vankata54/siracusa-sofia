/* Customers in the admin (section "Клиенти"; design/pages-admin/customers.html, README-3) and the feedback / inquiries:
   - the list (search, filters: with offers, birthday, blocked, new in 30 days), the phone partly hidden; orders, the last
     one, the sum (the real prices, without the cancelled), the consents (only the customer gives them), blocked / pending;
   - the profile: phone and e-mail masked, the last orders with the dishes, the reservations and no-shows, the -10% with a
     profile, the stamps [ЛИПСВА], the consents (read only);
   - "Покажи" phone and e-mail: on purpose, into the log (customer.phone_view);
   - "Изтегли данните" (GDPR, the JSON of exportCustomer; log customer.export);
   - "Изтрий" (GDPR) with a window for "Отмени": the profile is marked and deleted for good only after UNDO_MS (10 s) by
     the sweep (customersPurge: every call here, and the server's timer); "Отмени" in the window brings it back
     (customer.restore). The deletion: the profile and its sessions, and the name, phone, e-mail and address in its orders
     and reservations are replaced (the orders stay for the fiscal record without personal data). Only the hash of the
     phone for the one-time bonus stays (decision 12.11.2026);
   - the feedback ("Пишете ни", the answers after a rating) and the inquiries (topic "voucher" / "birthday", decision
     12.11.2026): new / called / done, the contact masked, "Покажи" into the log. Inquiries: also the section "Оферти". */
import { audit } from "./audit.ts";
import { COL, iso, nowDate, type Ctx } from "./ctx.ts";
import { CoreError, type Customer, type Order, type Reservation, type Session } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, maskPhone, maskEmail } from "./rights.ts";
import { exportCustomer } from "./customers.ts";
import { blockOf } from "./reservations-admin.ts";
import { FEEDBACK_TOPICS, type Feedback } from "./feedback.ts";
import { PROFILE_COUPON } from "./orders.ts";

export const UNDO_MS = 10_000;
export const CUST_MSG = { notFound: "Няма такъв профил.", fbNotFound: "Няма такова съобщение.", status: "Невалиден статус.", gone: "Профилът вече е изтрит." };

export interface CustomerRow {
  id: string; name: string; phone: string; since: string; orders: number; last: string | null; sum: number;
  consent: { marketing: boolean; birthday: boolean }; block: "blocked" | "pending" | null; isNew: boolean; deleting: { until: number } | null;
}
const sum2 = (l: Order[]) => Math.round(l.filter((o) => o.status !== "cancelled").reduce((a, o) => a + (o.total || 0), 0) * 100) / 100;

/** deletes for good every profile whose window for "Отмени" has passed (the sweep) */
export async function customersPurge(ctx: Ctx): Promise<number> {
  const now = nowDate(ctx).getTime();
  let n = 0;
  for (const c of await ctx.repo.list<Customer>(COL.customers)) {
    if (!c.deleting || c.deleting.until > now) continue;
    for (const s of await ctx.repo.list<Session>(COL.sessions, { userId: c.id })) await ctx.repo.del(COL.sessions, s.id);
    for (const o of await ctx.repo.list<Order>(COL.orders, { phone: c.phone })) {
      Object.assign(o, { name: "Изтрит клиент", phone: "", email: undefined, addr: o.addr ? o.zone || "" : "", note: undefined, userId: null, updatedAt: iso(ctx) });
      await ctx.repo.put(COL.orders, o);
    }
    for (const r of await ctx.repo.list<Reservation>(COL.reservations, { phone: c.phone })) {
      Object.assign(r, { name: "Изтрит клиент", phone: "", email: undefined, note: undefined, updatedAt: iso(ctx) });
      await ctx.repo.put(COL.reservations, r);
    }
    await ctx.repo.del(COL.customers, c.id);
    await audit(ctx, c.deleting.by, "customer.delete", c.id);
    n++;
  }
  return n;
}

export async function customersList(ctx: Ctx, s: StaffCtx, q: { q?: string; filter?: "offers" | "birthday" | "blocked" | "new" | "" } = {}): Promise<{ rows: CustomerRow[]; total: number }> {
  need(s, "customers");
  await customersPurge(ctx);
  const all = await ctx.repo.list<Customer>(COL.customers), orders = await ctx.repo.list<Order>(COL.orders);
  const by = new Map<string, Order[]>();
  for (const o of orders) { if (!o.phone) continue; const l = by.get(o.phone) || []; l.push(o); by.set(o.phone, l); }
  const now = nowDate(ctx).getTime(), text = String(q.q || "").trim().toLowerCase(), dg = text.replace(/\D/g, "");
  const rows: CustomerRow[] = [];
  for (const c of all) {
    const l = by.get(c.phone) || [], block = c.blocked ? "blocked" : await blockOf(ctx, c.phone);
    const isNew = now - Date.parse(c.createdAt) < 30 * 864e5;
    if (text && !(c.name.toLowerCase().includes(text) || (dg.length >= 3 && c.phone.endsWith(dg)))) continue;
    if (q.filter === "offers" && !c.consent.marketing) continue;
    if (q.filter === "birthday" && !c.consent.birthday) continue;
    if (q.filter === "blocked" && !block) continue;
    if (q.filter === "new" && !isNew) continue;
    const last = l.sort((a, b) => b.ts - a.ts)[0];
    rows.push({ id: c.id, name: c.name || "Клиент", phone: maskPhone(c.phone), since: c.since, orders: l.length, last: last ? last.createdAt : null, sum: sum2(l),
      consent: { marketing: !!c.consent.marketing, birthday: !!c.consent.birthday }, block, isNew, deleting: c.deleting ? { until: c.deleting.until } : null });
  }
  rows.sort((a, b) => ((b.last || "") < (a.last || "") ? -1 : (b.last || "") > (a.last || "") ? 1 : a.name < b.name ? -1 : 1));
  return { rows, total: all.length };
}

async function getC(ctx: Ctx, id: string): Promise<Customer> {
  const c = await ctx.repo.get<Customer>(COL.customers, String(id || ""));
  if (!c) throw new CoreError("not_found", CUST_MSG.notFound, 404);
  return c;
}
export interface CustomerDetail extends CustomerRow {
  email: string; consent: { marketing: boolean; birthday: boolean; bday: string }; profileBonus: "unused" | "used" | "none";
  /** [ЛИПСВА: правило за печатите] */ stamps: null;
  reservations: number; noShows: number;
  lastOrders: { no: string; at: string; status: Order["status"]; total: number; lines: { name: string; q: number }[] }[];
}
export async function customerDetail(ctx: Ctx, s: StaffCtx, id: string): Promise<CustomerDetail> {
  need(s, "customers");
  await customersPurge(ctx);
  const c = await getC(ctx, id);
  const l = (await ctx.repo.list<Order>(COL.orders, { phone: c.phone })).sort((a, b) => b.ts - a.ts);
  const res = await ctx.repo.list<Reservation>(COL.reservations, { phone: c.phone });
  const block = c.blocked ? "blocked" : await blockOf(ctx, c.phone);
  const coupon = (c.coupons || []).find((x) => x.code === PROFILE_COUPON);
  return {
    id: c.id, name: c.name || "Клиент", phone: maskPhone(c.phone), since: c.since, orders: l.length, last: l[0] ? l[0].createdAt : null, sum: sum2(l),
    block, isNew: nowDate(ctx).getTime() - Date.parse(c.createdAt) < 30 * 864e5, deleting: c.deleting ? { until: c.deleting.until } : null,
    email: maskEmail(c.email), consent: { marketing: !!c.consent.marketing, birthday: !!c.consent.birthday, bday: c.consent.bday ? "••.••" : "" },
    profileBonus: coupon ? (coupon.used ? "used" : "unused") : "none", stamps: null,
    reservations: res.length, noShows: res.filter((r) => r.status === "no_show").length,
    lastOrders: l.slice(0, 4).map((o) => ({ no: o.no, at: o.createdAt, status: o.status, total: o.total, lines: o.lines.map((x) => ({ name: x.name || x.id, q: x.q })) })),
  };
}
/** "Покажи": the whole phone and e-mail, and a line in the log */
export async function customerContact(ctx: Ctx, s: StaffCtx, id: string): Promise<{ phone: string; email: string | null }> {
  need(s, "customers");
  const c = await getC(ctx, id);
  await audit(ctx, s.user.username, "customer.phone_view", c.id);
  return { phone: c.phone, email: c.email || null };
}
/** "Изтегли данните" (GDPR): everything about the customer. Log: customer.export. */
export async function customerExport(ctx: Ctx, s: StaffCtx, id: string) {
  need(s, "customers");
  const c = await getC(ctx, id);
  await audit(ctx, s.user.username, "customer.export", c.id);
  return exportCustomer(ctx, c);
}
/** "Изтрий" (GDPR): deleted for good after UNDO_MS unless "Отмени" (customerRestore). Log: customer.delete_request. */
export async function customerRemove(ctx: Ctx, s: StaffCtx, id: string): Promise<{ id: string; until: number }> {
  need(s, "customers");
  const c = await getC(ctx, id);
  if (!c.deleting) {
    c.deleting = { at: iso(ctx), by: s.user.username, until: nowDate(ctx).getTime() + UNDO_MS };
    await ctx.repo.put(COL.customers, c);
    await audit(ctx, s.user.username, "customer.delete_request", c.id);
  }
  return { id: c.id, until: c.deleting.until };
}
/** "Отмени" in the window: the profile stays. 410 "gone" after the window. Log: customer.restore. */
export async function customerRestore(ctx: Ctx, s: StaffCtx, id: string): Promise<{ id: string; ok: true }> {
  need(s, "customers");
  await customersPurge(ctx);
  const c = await ctx.repo.get<Customer>(COL.customers, String(id || ""));
  if (!c) throw new CoreError("gone", CUST_MSG.gone, 410);
  if (c.deleting) { c.deleting = null; await ctx.repo.put(COL.customers, c); await audit(ctx, s.user.username, "customer.restore", c.id); }
  return { id: c.id, ok: true };
}

/* ---------- feedback and inquiries ---------- */
export type FeedbackStatus = "new" | "called" | "done";
export interface FeedbackRow { id: string; name: string; contact: string; mode: Feedback["mode"]; message: string; topic: string; status: FeedbackStatus; createdAt: string; updatedAt: string; inquiry: boolean }
const isInquiry = (f: Pick<Feedback, "topic">) => (FEEDBACK_TOPICS as readonly string[]).includes(String(f.topic || ""));
const maskContact = (f: Feedback) => (f.mode === "email" ? maskEmail(f.contact) : maskPhone(f.contact));
const sectionsFor = (f: Pick<Feedback, "topic">) => (isInquiry(f) ? ["customers", "offers"] : ["customers"]);

/** kind "feedback": the messages ("Пишете ни", ratings); "inquiries": voucher and birthday (section Клиенти or Оферти) */
export async function feedbackList(ctx: Ctx, s: StaffCtx, kind: "feedback" | "inquiries" = "feedback"): Promise<{ rows: FeedbackRow[]; newN: number }> {
  need(s, kind === "inquiries" ? ["customers", "offers"] : "customers");
  const all = (await ctx.repo.list<Feedback>(COL.feedback)).filter((f) => (kind === "inquiries") === isInquiry(f)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return {
    rows: all.map((f) => ({ id: f.id, name: f.name, contact: maskContact(f), mode: f.mode, message: f.message, topic: f.topic || "", status: (f.status || "new") as FeedbackStatus, createdAt: f.createdAt, updatedAt: f.updatedAt, inquiry: isInquiry(f) })),
    newN: all.filter((f) => (f.status || "new") === "new").length,
  };
}
async function getF(ctx: Ctx, s: StaffCtx, id: string): Promise<Feedback> {
  const f = await ctx.repo.get<Feedback>(COL.feedback, String(id || ""));
  if (!f) { need(s, ["customers", "offers"]); throw new CoreError("not_found", CUST_MSG.fbNotFound, 404); }
  need(s, sectionsFor(f));
  return f;
}
/** "Прегледано" / "Обадихме се" / "Готово" / "Върни в нови". Log: feedback.status. */
export async function feedbackSetStatus(ctx: Ctx, s: StaffCtx, id: string, status: FeedbackStatus): Promise<FeedbackRow> {
  const f = await getF(ctx, s, id);
  if (!["new", "called", "done"].includes(status)) throw new CoreError("bad_status", CUST_MSG.status, 422);
  f.status = status; f.updatedAt = iso(ctx);
  await ctx.repo.put(COL.feedback, f);
  await audit(ctx, s.user.username, "feedback.status", f.id, { status, topic: f.topic || "" });
  return { id: f.id, name: f.name, contact: maskContact(f), mode: f.mode, message: f.message, topic: f.topic || "", status, createdAt: f.createdAt, updatedAt: f.updatedAt, inquiry: isInquiry(f) };
}
/** "Покажи телефона" of a message / inquiry: into the log (customer.phone_view) */
export async function feedbackContact(ctx: Ctx, s: StaffCtx, id: string): Promise<{ contact: string; mode: Feedback["mode"] }> {
  const f = await getF(ctx, s, id);
  await audit(ctx, s.user.username, "customer.phone_view", "feedback:" + f.id);
  return { contact: f.contact, mode: f.mode };
}
