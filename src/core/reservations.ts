/* Reservations, celebration inquiries, event subscriptions. (The office group order is in office.ts.)
   Reservations: the date from today up to 92 days ahead, the time 11:00-21:30 every 30 min (OPEN-QUESTIONS 18; today not
   in the past), people not more than the table's seats; the table is held for `resMinutes` (setting, default 120, owner to
   confirm), so two bookings of one table must not overlap. create returns a secret `key` for get / cancel (link from SMS). */
import { COL, emit, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Celebration, type Reservation, type ReservationStatus, type Subscription } from "./types.ts";
import { audit } from "./audit.ts";
import { normPhone, hhmm } from "../lib/format.ts";
import { TABLES, EVENT_CATS } from "../lib/consts.ts";
import { minutes, sofiaYmd, addDaysYmd, validYmd } from "../lib/time.ts";
import { getSettings } from "./settings.ts";
export { createOffice, getOffice, viewOffice, joinOffice, submitOffice, sendDueOffices } from "./office.ts";

export const RES_FIRST = 660, RES_LAST = 1290, RES_STEP = 30, RES_DAYS_AHEAD = 92;
const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
/** Bookings that hold a table (cancelled, no-show and the waiting list do not). */
const holds = (r: Reservation) => !!r.table && r.status !== "cancelled" && r.status !== "no_show" && r.status !== "waitlist";

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

export interface ReservationInput { date: string; time: string; people: number; table?: string | null; name: string; phone: string; email?: string; occasion?: string; note?: string; marketing?: boolean; waitlist?: boolean;
  /** change of a booking: the old one (id + key from create / the SMS link) is cancelled in the same transaction and its table is free for the new one */
  replaces?: { id: string; key: string } | null }

/* Online change / cancel: until 2 hours before a booking from 17:00, until 1 hour before during the day
   (design/pages/reservation.html: "До 2 часа преди резервация след 17:00 и до 1 час преди през деня"). */
export const RES_LATE_MSG = "Онлайн промяна и отказ има до 2 часа преди резервация след 17:00 и до 1 час преди през деня. Обадете ни се на 0894 36 55 77.";
export function changeLimit(time: string): number { return toMin(time) >= 1020 ? 120 : 60; }
/** minutes from now (Sofia, ctx clock) to the start of the booking */
export function minutesUntil(ctx: Ctx, date: string, time: string): number {
  const today = sofiaYmd(nowDate(ctx));
  let days = 0;
  for (let d = today; d < date && days < 400; d = addDaysYmd(d, 1)) days++;
  if (date < today) days = -1;
  return days * 1440 + toMin(time) - minutes(ctx.clock);
}
function checkLate(ctx: Ctx, r: Reservation) {
  if (r.status === "seated" || r.status === "no_show") throw new CoreError("too_late", "Тази резервация вече не може да се промени онлайн. Обадете ни се на 0894 36 55 77.", 409);
  if (minutesUntil(ctx, r.date, r.time) < changeLimit(r.time)) throw new CoreError("too_late", RES_LATE_MSG, 409);
}

export async function createReservation(ctx: Ctx, r: ReservationInput): Promise<Reservation> {
  const f: Record<string, string> = {};
  const today = sofiaYmd(nowDate(ctx)), m = minutes(ctx.clock);
  const date = String(r.date || ""), time = String(r.time || "");
  if (!validYmd(date)) f.date = "Изберете дата.";
  else if (date < today || date > addDaysYmd(today, RES_DAYS_AHEAD)) f.date = "Изберете дата от днес до 3 месеца напред.";
  const tm = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? toMin(time) : -1;
  if (tm < RES_FIRST || tm > RES_LAST || (tm - RES_FIRST) % RES_STEP) f.time = "Изберете час между 11:00 и 21:30.";
  else if (date === today && tm <= m) f.time = "Този час вече мина. Изберете по-късен.";
  const people = +r.people;
  need(Number.isInteger(people) && people >= 1 && people <= 60, f, "people", "Изберете брой хора.");
  need(String(r.name || "").trim(), f, "name", "Напишете името си.");
  const phone = normPhone(r.phone);
  need(phone, f, "phone", "Телефонът трябва да е 10 цифри, например 0888 12 34 56.");
  need(emailOk(r.email), f, "email", "Проверете имейла, например ime@primer.bg.");
  const t = r.table ? TABLES.find((x) => x.id === r.table) : null;
  if (r.table && !t) f.table = "Няма такава маса.";
  if (t && !f.people && people > t.seats) f.people = "Масата е за " + t.seats + " души. Изберете по-голяма маса или съединени маси.";
  invalid(f);
  if (await isBlocked(ctx, phone!)) throw new CoreError("blocked", BLOCKED_MSG, 403);
  const dur = (await getSettings(ctx)).resMinutes;
  /* a change: the old booking must be the caller's (key) and still changeable */
  const old = r.replaces && r.replaces.id ? await getReservation(ctx, String(r.replaces.id), String(r.replaces.key || "")) : null;
  if (old && old.status !== "cancelled") checkLate(ctx, old);
  const make = async (): Promise<Reservation> => {
    if (t && !r.waitlist && (await takenTables(ctx, date, time, old ? old.id : undefined)).includes(t.id)) throw new CoreError("taken", "Тази маса току-що беше заета. Изберете друга.", 409);
    if (old && old.status !== "cancelled") { old.status = "cancelled"; old.updatedAt = iso(ctx); await ctx.repo.put(COL.reservations, old); }
    const now = iso(ctx);
    const res: Reservation = {
      id: rid(8), date, time, people, table: t ? t.id : null, zone: t ? t.zone : null,
      name: String(r.name).trim().slice(0, 80), phone: phone!, email: r.email || undefined, occasion: r.occasion ? String(r.occasion).slice(0, 80) : undefined,
      note: r.note ? String(r.note).slice(0, 1000) : undefined, marketing: r.marketing === true, status: r.waitlist ? "waitlist" : "new", createdAt: now, updatedAt: now,
      dur, key: rid(12),
    };
    await ctx.repo.put(COL.reservations, res);
    return res;
  };
  const res = ctx.repo.transaction ? await ctx.repo.transaction(make) : await make();
  emit(ctx, "reservation.created", { date: res.date, time: res.time, until: hhmm(toMin(res.time) + dur), table: res.table, people: res.people }, { public: true });
  if (old && old.status === "cancelled") emit(ctx, "reservation.status", { date: old.date, time: old.time, table: old.table, status: "cancelled" }, { public: true });
  return res;
}

export async function listReservations(ctx: Ctx, where: Partial<Reservation> = {}): Promise<Reservation[]> {
  return (await ctx.repo.list<Reservation>(COL.reservations, where)).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

/** Tables taken at a date/time: every booking whose interval [time, time + its length) overlaps [time, time + length). */
export async function takenTables(ctx: Ctx, date: string, time: string, exceptId?: string): Promise<string[]> {
  if (!validYmd(date) || !/^\d{2}:\d{2}$/.test(time)) return [];
  const dur = (await getSettings(ctx)).resMinutes, t = toMin(time);
  const out = new Set<string>();
  for (const r of await ctx.repo.list<Reservation>(COL.reservations, { date })) {
    if (!holds(r) || r.id === exceptId) continue;
    const a = toMin(r.time), d = r.dur || dur;
    if (a < t + dur && t < a + d) out.add(r.table!);
  }
  return [...out];
}

/** The guest's own view (link from the SMS): needs the key from create. */
export async function getReservation(ctx: Ctx, id: string, key: string): Promise<Reservation> {
  const r = await ctx.repo.get<Reservation>(COL.reservations, String(id || ""));
  if (!r || !r.key || r.key !== key) throw new CoreError("not_found", "Няма такава резервация.", 404);
  return r;
}

export async function cancelReservation(ctx: Ctx, id: string, key: string): Promise<Reservation> {
  const r = await getReservation(ctx, id, key);
  if (r.status === "cancelled") return r;
  checkLate(ctx, r);
  r.status = "cancelled"; r.updatedAt = iso(ctx);
  await ctx.repo.put(COL.reservations, r);
  await audit(ctx, "guest", "reservation.cancel", r.id);
  emit(ctx, "reservation.status", { date: r.date, time: r.time, table: r.table, status: r.status }, { public: true });
  return r;
}

export async function setReservationStatus(ctx: Ctx, id: string, status: ReservationStatus, actor = "system"): Promise<Reservation> {
  const r = await ctx.repo.get<Reservation>(COL.reservations, id);
  if (!r) throw new CoreError("not_found", "Няма такава резервация.", 404);
  r.status = status; r.updatedAt = iso(ctx);
  await ctx.repo.put(COL.reservations, r);
  await audit(ctx, actor, "reservation.status", id, { status });
  emit(ctx, "reservation.status", { date: r.date, time: r.time, table: r.table, status }, { public: true });
  return r;
}

/* ---------- celebration inquiries (калкулатор на празник) ---------- */
export type CelebrationInput = Omit<Celebration, "id" | "status" | "createdAt" | "marketing" | "early"> & { marketing?: boolean; early?: boolean };

export const CELEB_MAX_PEOPLE = 300; /* technical limit of the form, not the capacity */
export async function createCelebration(ctx: Ctx, c: CelebrationInput): Promise<Celebration> {
  const f: Record<string, string> = {};
  const today = sofiaYmd(nowDate(ctx)), date = String(c.date || "");
  need(String(c.kind || "").trim(), f, "kind", "Изберете повод.");
  need(Number.isInteger(c.people) && c.people >= 1 && c.people <= CELEB_MAX_PEOPLE, f, "people", "Изберете брой гости (от 1 до " + CELEB_MAX_PEOPLE + ").");
  if (!validYmd(date)) f.date = "Изберете дата.";
  else if (date <= today || date > addDaysYmd(today, 366)) f.date = "Изберете дата от утре до една година напред.";
  if (c.time != null && c.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(c.time))) f.time = "Изберете начален час.";
  need(String(c.name || "").trim(), f, "name", "Напишете името си.");
  const phone = normPhone(c.phone);
  need(phone, f, "phone", "Телефонът трябва да е 10 цифри, например 0888 12 34 56.");
  need(emailOk(c.email), f, "email", "Проверете имейла, например ime@primer.bg.");
  if (c.cakeNote && String(c.cakeNote).length > 300) f.cakeNote = "Пожеланията за тортата са до 300 знака.";
  if (c.wishes && String(c.wishes).length > 1000) f.wishes = "Пожеланията са до 1000 знака.";
  if (c.note && String(c.note).length > 2000) f.note = "Бележката е до 2000 знака.";
  invalid(f);
  /* "ранна резервация" -5%: only when the owner has set the days (null = [ЛИПСВА]); the core decides, not the page */
  const st = await getSettings(ctx);
  let days = 0; for (let d = today; d < date && days < 400; d = addDaysYmd(d, 1)) days++;
  const early = st.earlyDays != null && days >= st.earlyDays;
  const s = (v: unknown, n: number) => (v == null || v === "" ? undefined : String(v).trim().slice(0, n));
  const doc: Celebration = {
    id: rid(8), kind: String(c.kind).trim().slice(0, 60), people: c.people, date, pack: s(c.pack, 80), custom: c.custom === true,
    items: Array.isArray(c.items) ? c.items.map(String).slice(0, 60) : undefined, cake: c.cake === true, decor: c.decor === true,
    zone: c.zone === "salon" || c.zone === "garden" || c.zone === "all" ? c.zone : undefined,
    name: String(c.name).trim().slice(0, 80), phone: phone!, email: s(c.email, 120), note: s(c.note, 2000), marketing: c.marketing === true,
    early, status: "new", createdAt: iso(ctx), time: s(c.time, 5), cakeNote: s(c.cakeNote, 300), wishes: s(c.wishes, 1000),
  };
  await ctx.repo.put(COL.celebrations, doc);
  emit(ctx, "celebration.created", { id: doc.id, kind: doc.kind, people: doc.people });
  return doc;
}

/* ---------- "Уведоми ме за нови събития" ---------- */
/** topics: the event categories chosen on the page (EVENT_CATS); none = all events. Asking again adds the new topics. */
export async function subscribe(ctx: Ctx, email: string, consent: boolean, topics?: string[]): Promise<Subscription> {
  if (!emailOk(email) || !email) throw Object.assign(new CoreError("invalid", "Проверете имейла, например ime@primer.bg.", 422), { fields: { email: "Проверете имейла, например ime@primer.bg." } });
  if (consent !== true) throw new CoreError("consent", "Отметнете съгласието, за да ви пишем.", 422);
  const want = Array.isArray(topics) ? [...new Set(topics.map(String).filter((t) => (EVENT_CATS as readonly string[]).includes(t)))] : [];
  const mail = String(email).trim().toLowerCase();
  const existing = (await ctx.repo.list<Subscription>(COL.subscriptions, { email: mail }))[0];
  if (existing) {
    const all = !want.length || !(existing.topics || []).length ? [] : [...new Set([...(existing.topics || []), ...want])];
    const next = { ...existing, topics: all, updatedAt: iso(ctx) };
    await ctx.repo.put(COL.subscriptions, next);
    return next;
  }
  const s: Subscription = { id: rid(8), email: mail, topic: "events", topics: want, consent: true, createdAt: iso(ctx) };
  await ctx.repo.put(COL.subscriptions, s);
  return s;
}
