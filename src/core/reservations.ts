/* Reservations, celebration inquiries, office group orders, event subscriptions. */
import { COL, emit, iso, rid, randomDigits, type Ctx } from "./ctx.ts";
import { CoreError, type Celebration, type OfficeOrder, type OfficeParticipant, type Reservation, type ReservationStatus, type Subscription } from "./types.ts";
import { audit } from "./audit.ts";
import { normPhone } from "../lib/format.ts";
import { zoneOfAddress } from "../lib/zones.ts";
import { createOrder, type OrderInput } from "./orders.ts";
import { TABLES } from "../lib/consts.ts";
import type { Mode } from "../lib/cart.ts";

/* The prototype's polite refusal is demonstrated with this number (reservation.html, login.html). */
export const BLOCKED_DEMO_PHONE = "0888000000";
export const BLOCKED_MSG = "За съжаление не можем да приемем резервация онлайн за този номер. Обадете ни се на 0894 36 55 77 и ще намерим решение.";

function need(cond: unknown, fields: Record<string, string>, k: string, msg: string) { if (!cond) fields[k] = msg; }
function invalid(fields: Record<string, string>) {
  if (Object.keys(fields).length) throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields });
}
const emailOk = (e?: string) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

async function isBlocked(ctx: Ctx, phone: string): Promise<boolean> {
  if (phone === BLOCKED_DEMO_PHONE) return true;
  const c = (await ctx.repo.list<{ id: string; phone: string; blocked?: boolean }>(COL.customers, { phone }))[0];
  return !!(c && c.blocked);
}

export interface ReservationInput { date: string; time: string; people: number; table?: string | null; name: string; phone: string; email?: string; occasion?: string; note?: string; marketing?: boolean; waitlist?: boolean }

export async function createReservation(ctx: Ctx, r: ReservationInput): Promise<Reservation> {
  const f: Record<string, string> = {};
  need(/^\d{4}-\d{2}-\d{2}$/.test(r.date), f, "date", "Изберете дата.");
  need(/^\d{2}:\d{2}$/.test(r.time), f, "time", "Изберете час.");
  need(r.people >= 1 && r.people <= 60, f, "people", "Изберете брой хора.");
  need(String(r.name || "").trim(), f, "name", "Напишете името си.");
  const phone = normPhone(r.phone);
  need(phone, f, "phone", "Телефонът трябва да е 10 цифри, например 0888 12 34 56.");
  need(emailOk(r.email), f, "email", "Проверете имейла, например ime@primer.bg.");
  const t = r.table ? TABLES.find((x) => x.id === r.table) : null;
  if (r.table && !t) f.table = "Няма такава маса.";
  invalid(f);
  if (await isBlocked(ctx, phone!)) throw new CoreError("blocked", BLOCKED_MSG, 403);
  if (t) {
    const same = await ctx.repo.list<Reservation>(COL.reservations, { date: r.date, time: r.time, table: t.id });
    if (same.some((x) => x.status !== "cancelled")) throw new CoreError("taken", "Тази маса току-що беше заета. Изберете друга.", 409);
  }
  const now = iso(ctx);
  const res: Reservation = {
    id: rid(8), date: r.date, time: r.time, people: Math.floor(r.people), table: t ? t.id : null, zone: t ? t.zone : null,
    name: String(r.name).trim(), phone: phone!, email: r.email || undefined, occasion: r.occasion || undefined, note: r.note || undefined,
    marketing: r.marketing === true, status: r.waitlist ? "waitlist" : "new", createdAt: now, updatedAt: now,
  };
  await ctx.repo.put(COL.reservations, res);
  emit(ctx, "reservation.created", { id: res.id, date: res.date, time: res.time, people: res.people, table: res.table });
  return res;
}

export async function listReservations(ctx: Ctx, where: Partial<Reservation> = {}): Promise<Reservation[]> {
  return (await ctx.repo.list<Reservation>(COL.reservations, where)).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

/** Tables already taken at a date/time (for the floor plan). */
export async function takenTables(ctx: Ctx, date: string, time: string): Promise<string[]> {
  return (await ctx.repo.list<Reservation>(COL.reservations, { date, time })).filter((r) => r.table && r.status !== "cancelled").map((r) => r.table!);
}

export async function setReservationStatus(ctx: Ctx, id: string, status: ReservationStatus, actor = "system"): Promise<Reservation> {
  const r = await ctx.repo.get<Reservation>(COL.reservations, id);
  if (!r) throw new CoreError("not_found", "Няма такава резервация.", 404);
  r.status = status; r.updatedAt = iso(ctx);
  await ctx.repo.put(COL.reservations, r);
  await audit(ctx, actor, "reservation.status", id, { status });
  emit(ctx, "reservation.status", { id, status });
  return r;
}

/* ---------- celebration inquiries (калкулатор на празник) ---------- */
export type CelebrationInput = Omit<Celebration, "id" | "status" | "createdAt" | "marketing" | "early"> & { marketing?: boolean; early?: boolean };

export async function createCelebration(ctx: Ctx, c: CelebrationInput): Promise<Celebration> {
  const f: Record<string, string> = {};
  need(String(c.kind || "").trim(), f, "kind", "Изберете повод.");
  need(c.people >= 1, f, "people", "Изберете брой гости.");
  need(String(c.name || "").trim(), f, "name", "Напишете името си.");
  const phone = normPhone(c.phone);
  need(phone, f, "phone", "Телефонът трябва да е 10 цифри, например 0888 12 34 56.");
  need(emailOk(c.email), f, "email", "Проверете имейла, например ime@primer.bg.");
  invalid(f);
  const doc: Celebration = { ...c, id: rid(8), phone: phone!, marketing: c.marketing === true, early: c.early === true, status: "new", createdAt: iso(ctx) };
  await ctx.repo.put(COL.celebrations, doc);
  emit(ctx, "celebration.created", { id: doc.id, kind: doc.kind, people: doc.people });
  return doc;
}

/* ---------- office group order (Обща поръчка за офиса) ---------- */
export async function createOffice(ctx: Ctx, o: { office: string; addr: string; deadline?: string; payer?: "one" | "each"; mode?: Mode }): Promise<OfficeOrder> {
  const f: Record<string, string> = {};
  need(String(o.office || "").trim(), f, "office", "Напишете името на офиса.");
  const z = zoneOfAddress(o.addr || "");
  if ((o.mode || "delivery") === "delivery") need(z.type === "zone", f, "addr", "Напишете квартала, например Дружба 2.");
  invalid(f);
  const doc: OfficeOrder = {
    id: rid(8), code: randomDigits(6), office: o.office.trim(), addr: o.addr.trim(), zone: z.type === "zone" ? z.zone.n : "",
    deadline: o.deadline && /^\d{2}:\d{2}$/.test(o.deadline) ? o.deadline : "11:30", payer: o.payer === "each" ? "each" : "one",
    mode: o.mode === "pickup" ? "pickup" : "delivery", participants: [], status: "open", createdAt: iso(ctx),
  };
  await ctx.repo.put(COL.office, doc);
  return doc;
}
export async function getOffice(ctx: Ctx, code: string): Promise<OfficeOrder | null> {
  return (await ctx.repo.list<OfficeOrder>(COL.office, { code }))[0] || null;
}
export async function joinOffice(ctx: Ctx, code: string, p: OfficeParticipant): Promise<OfficeOrder> {
  const o = await getOffice(ctx, code);
  if (!o) throw new CoreError("not_found", "Тази обща поръчка не съществува.", 404);
  if (o.status !== "open") throw new CoreError("closed", "Поръчката вече е изпратена.", 409);
  if (!String(p.name || "").trim()) throw Object.assign(new CoreError("invalid", "Напишете името си.", 422), { fields: { name: "Напишете името си." } });
  const i = o.participants.findIndex((x) => x.name === p.name);
  if (i > -1) o.participants[i] = p; else o.participants.push(p);
  await ctx.repo.put(COL.office, o);
  emit(ctx, "office.updated", { code, participants: o.participants.length });
  return o;
}
export async function submitOffice(ctx: Ctx, code: string, contact: Pick<OrderInput, "name" | "phone" | "pay" | "email" | "note">) {
  const o = await getOffice(ctx, code);
  if (!o) throw new CoreError("not_found", "Тази обща поръчка не съществува.", 404);
  const lines = o.participants.flatMap((p) => p.lines);
  const order = await createOrder(ctx, { ...contact, cart: { mode: o.mode, lines: lines.map((l) => ({ key: l.id + (l.mods.length ? "|" + l.mods.join(",") : ""), ...l })) }, zone: o.zone, addr: o.addr, channel: "office" });
  o.status = "sent"; o.orderNo = order.no;
  await ctx.repo.put(COL.office, o);
  return { office: o, order };
}

/* ---------- "Уведоми ме за нови събития" ---------- */
export async function subscribe(ctx: Ctx, email: string, consent: boolean): Promise<Subscription> {
  if (!emailOk(email) || !email) throw Object.assign(new CoreError("invalid", "Проверете имейла, например ime@primer.bg.", 422), { fields: { email: "Проверете имейла, например ime@primer.bg." } });
  if (consent !== true) throw new CoreError("consent", "Отметнете съгласието, за да ви пишем.", 422);
  const existing = (await ctx.repo.list<Subscription>(COL.subscriptions, { email: email.toLowerCase() }))[0];
  if (existing) return existing;
  const s: Subscription = { id: rid(8), email: email.toLowerCase(), topic: "events", consent: true, createdAt: iso(ctx) };
  await ctx.repo.put(COL.subscriptions, s);
  return s;
}
