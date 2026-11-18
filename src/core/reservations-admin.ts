/* Reservations in the admin (section "Резервации"; design/pages-admin/reservations.html, README-3):
   - the day: the list by time with the phone hidden (masked), the numbers (bookings, people, to confirm, no-shows),
     people in the hall by hour, the waiting list;
   - "Покажи" the phone: only on purpose, and it goes into the log (reservation.phone_view);
   - the status: Потвърдена, Дошли, Неявили се, Отказана (and back to Нова / Чака маса); "Дошли" / "Неявили се" from
     30 minutes before the time; "Отмени" goes back to the status before (a no-show taken back is not counted);
   - "Смени маса" / "Дай маса" (the waiting list): only a table free at that time;
   - "Нова резервация" from the staff: the core's rules (reservations.ts), "Потвърдена", no marketing, no limits for guests;
   - blocking no-shows (noshow_blocks): after the setting noShowLimit (2) the number waits for a decision; "Блокирай" /
     "Не блокирай" / "Отблокирай" / "Добави номер ръчно" only for the main admin, the owner and the manager; the others
     with the section see the list (the phones masked). A blocked number does not book online (reservations.ts isBlocked).
   The blocks are addressed by `ref` (a hash of the phone), never by the phone. */
import { docRange } from "./order-index.ts";
import { audit } from "./audit.ts";
import { COL, iso, nowDate, phoneHash, type Ctx } from "./ctx.ts";
import { CoreError, type NoShowBlock, type Reservation, type ReservationStatus } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, needBoss, invalid, maskPhone, isBoss, toMin } from "./rights.ts";
import { createReservation, setReservationStatus, takenTables, minutesUntil, validYmd, RES_FIRST, RES_LAST, RES_STEP, RES_DAYS_AHEAD, type ReservationInput } from "./reservations.ts";
import { RESTAURANT } from "../lib/consts.ts";
import { liveHall, seatsOf } from "./hall.ts";
import { getSettings } from "./settings.ts";
import { normPhone, hhmm } from "../lib/format.ts";
import { sofiaYmd, minutes } from "../lib/time.ts";

export const RES_STATUS_LABEL: Record<ReservationStatus, string> = { new: "Нова", confirmed: "Потвърдена", seated: "Дошли", no_show: "Неявили се", cancelled: "Отказана", waitlist: "Чака маса" };
export const RESA_MSG = {
  notFound: "Няма такава резервация.",
  early: "„Дошли“ и „Неявили се“ се отбелязват от 30 минути преди часа.",
  status: "Невалиден статус.",
  table: "Тази маса не е свободна в този час. Изберете друга.",
  seats: (n: number) => "Масата е за " + n + " души. Изберете по-голяма маса или обединени маси.",
  noTable: "Няма свободна маса за този час.",
  block: "Няма такъв номер в списъка.",
  phone: "Телефонът трябва да е 10 цифри, например 0888 12 34 56.",
};

export interface ResRow {
  id: string; date: string; time: string; until: string; people: number; table: string | null; tableN: number | null; zone: Reservation["zone"];
  name: string; phone: string; occasion?: string; note?: string; status: ReservationStatus; statusLabel: string;
  /** "Закъснява 20 мин": a booking not seated 15+ minutes after its time (today) */
  lateMin: number | null; prevStatus: ReservationStatus | null; by: string | null; createdAt: string;
  /** "Дошли" / "Неявили се" can be marked (from 30 minutes before the time) */
  canArrive: boolean;
}
export interface ResDay {
  date: string; rows: ResRow[];
  stats: { bookings: number; people: number; toConfirm: number; noShows: number; waitlist: number; cancelled: number };
  /** people in the hall per half hour 11:00-21:30 (by the length of each booking); capacity [ЛИПСВА] */
  byHour: { time: string; people: number }[];
}

const isBlockedRef = async (phone: string) => (await phoneHash("sc-block:" + phone)).slice(0, 16);

async function rowOf(ctx: Ctx, r: Reservation, tn: Map<string, number>, dur: number, today: string, now: number): Promise<ResRow> {
  const until = hhmm(toMin(r.time) + (r.dur || dur));
  const late = r.date === today && (r.status === "new" || r.status === "confirmed") ? now - toMin(r.time) : -1;
  return {
    id: r.id, date: r.date, time: r.time, until, people: r.people, table: r.table, tableN: r.table ? tn.get(r.table) ?? null : null, zone: r.zone,
    name: r.name, phone: maskPhone(r.phone), occasion: r.occasion, note: r.note, status: r.status, statusLabel: RES_STATUS_LABEL[r.status],
    lateMin: late >= 15 ? late : null, prevStatus: r.prevStatus || null, by: r.by || null, createdAt: r.createdAt,
    canArrive: minutesUntil(ctx, r.date, r.time) <= 30,
  };
}

/** The reservations of one day (Sofia, default today): rows by time, the numbers, people by hour. */
export async function resDay(ctx: Ctx, s: StaffCtx, q: { date?: string; status?: ReservationStatus | "all"; q?: string } = {}): Promise<ResDay> {
  need(s, "reservations");
  const today = sofiaYmd(nowDate(ctx)), date = q.date && validYmd(q.date) ? q.date : today;
  const st = await getSettings(ctx), dur = st.resMinutes, hall = await liveHall(ctx);
  const tn = new Map(hall.tables.map((t) => [t.id, t.n]));
  const all = (await ctx.repo.list<Reservation>(COL.reservations, { date })).sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.createdAt < b.createdAt ? -1 : 1));
  const nowM = minutes(ctx.clock);
  const live = all.filter((r) => r.status !== "cancelled" && r.status !== "waitlist");
  const byHour: ResDay["byHour"] = [];
  for (let t = RES_FIRST; t <= RES_LAST; t += RES_STEP) byHour.push({ time: hhmm(t), people: live.filter((r) => r.status !== "no_show" && toMin(r.time) <= t && t < toMin(r.time) + (r.dur || dur)).reduce((a, r) => a + r.people, 0) });
  const text = String(q.q || "").trim().toLowerCase(), digits = text.replace(/\D/g, "");
  const shown = all.filter((r) => (!q.status || q.status === "all" ? r.status !== "cancelled" : r.status === q.status) &&
    (!text || r.name.toLowerCase().includes(text) || (digits.length >= 3 && r.phone.replace(/\D/g, "").endsWith(digits))));
  return {
    date, rows: await Promise.all(shown.map((r) => rowOf(ctx, r, tn, dur, today, nowM))),
    stats: {
      bookings: live.length, people: live.reduce((a, r) => a + r.people, 0), toConfirm: all.filter((r) => r.status === "new").length,
      noShows: all.filter((r) => r.status === "no_show").length, waitlist: all.filter((r) => r.status === "waitlist").length, cancelled: all.filter((r) => r.status === "cancelled").length,
    },
    byHour,
  };
}

/** a month at a glance (the calendar): bookings per day without the cancelled and the waiting list */
export async function resMonth(ctx: Ctx, s: StaffCtx, month: string): Promise<{ month: string; days: Record<string, { bookings: number; toConfirm: number }> }> {
  need(s, "reservations");
  const mo = /^\d{4}-\d{2}$/.test(String(month)) ? month : sofiaYmd(nowDate(ctx)).slice(0, 7);
  const days: Record<string, { bookings: number; toConfirm: number }> = {};
  for (const r of await docRange<Reservation>(ctx, COL.reservations, "date", mo + "-01", mo + "-31", (x) => x.date)) {
    if (!r.date.startsWith(mo) || r.status === "cancelled" || r.status === "waitlist") continue;
    const d = (days[r.date] ||= { bookings: 0, toConfirm: 0 });
    d.bookings++; if (r.status === "new") d.toConfirm++;
  }
  return { month: mo, days };
}

async function getRes(ctx: Ctx, id: string): Promise<Reservation> {
  const r = await ctx.repo.get<Reservation>(COL.reservations, String(id || ""));
  if (!r) throw new CoreError("not_found", RESA_MSG.notFound, 404);
  return r;
}

/** "Покажи" the phone: the whole number, and a line in the log */
export async function resPhone(ctx: Ctx, s: StaffCtx, id: string): Promise<{ phone: string }> {
  need(s, "reservations");
  const r = await getRes(ctx, id);
  await audit(ctx, s.user.username, "reservation.phone_view", r.id);
  return { phone: r.phone };
}

const STATUSES: ReservationStatus[] = ["new", "confirmed", "seated", "no_show", "cancelled", "waitlist"];
/** The status from the admin. "Дошли" / "Неявили се" from 30 minutes before the time; "Отмени" (back to prevStatus)
    always. Log: reservation.status (who, from, to). */
export async function resSetStatus(ctx: Ctx, s: StaffCtx, id: string, status: ReservationStatus): Promise<ResRow> {
  need(s, "reservations");
  if (!STATUSES.includes(status)) throw new CoreError("bad_status", RESA_MSG.status, 422);
  const r = await getRes(ctx, id);
  const undo = !!r.prevStatus && status === r.prevStatus;
  if (!undo && (status === "seated" || status === "no_show") && r.status !== status && minutesUntil(ctx, r.date, r.time) > 30) throw new CoreError("too_early", RESA_MSG.early, 409);
  if (status === "waitlist" && r.status !== "waitlist" && !undo) throw new CoreError("bad_status", RESA_MSG.status, 422);
  /* back to a status that holds the table (from "Отказана" / "Неявили се"): only if nobody got that table meanwhile */
  const holds = (x: ReservationStatus) => x === "new" || x === "confirmed" || x === "seated";
  if (r.table && holds(status) && !holds(r.status) && (await takenTables(ctx, r.date, r.time, r.id)).includes(r.table)) throw new CoreError("taken", RESA_MSG.table, 409);
  const out = await setReservationStatus(ctx, r.id, status, s.user.username);
  return rowFor(ctx, out);
}
async function rowFor(ctx: Ctx, r: Reservation): Promise<ResRow> {
  const hall = await liveHall(ctx), st = await getSettings(ctx);
  return rowOf(ctx, r, new Map(hall.tables.map((t) => [t.id, t.n])), st.resMinutes, sofiaYmd(nowDate(ctx)), minutes(ctx.clock));
}

/** "Смени маса" / "Дай маса" (a waiting booking gets a table and becomes "Потвърдена"): only a table free at that time
    with enough seats; null takes the table away. Log: reservation.table. */
export async function resSetTable(ctx: Ctx, s: StaffCtx, id: string, table: string | null): Promise<ResRow> {
  need(s, "reservations");
  const r = await getRes(ctx, id);
  const hall = await liveHall(ctx);
  if (table != null) {
    const t = hall.tables.find((x) => x.id === table && !x.off);
    if (!t) throw new CoreError("not_found", "Няма такава маса.", 404);
    if ((await takenTables(ctx, r.date, r.time, r.id)).includes(t.id)) throw new CoreError("taken", RESA_MSG.table, 409);
    const seats = seatsOf(hall, t.id);
    if (r.people > seats) invalid({ table: RESA_MSG.seats(seats) });
    r.table = t.id; r.zone = t.zone;
  } else { r.table = null; r.zone = null; }
  const was = r.status;
  if (r.status === "waitlist" && r.table) { r.prevStatus = "waitlist"; r.status = "confirmed"; }
  r.updatedAt = iso(ctx);
  await ctx.repo.put(COL.reservations, r);
  await audit(ctx, s.user.username, "reservation.table", r.id, { table: r.table, status: r.status !== was ? r.status : undefined });
  return rowFor(ctx, r);
}

/** the tables free at a date and time (for "Смени маса", "Дай маса" and "Нова резервация") */
export async function resFreeTables(ctx: Ctx, s: StaffCtx, date: string, time: string, people = 1, except?: string): Promise<{ id: string; n: number; zone: "salon" | "garden"; seats: number }[]> {
  need(s, "reservations");
  const hall = await liveHall(ctx), taken = new Set(await takenTables(ctx, date, time, except));
  return hall.tables.filter((t) => !t.off && !taken.has(t.id) && seatsOf(hall, t.id) >= people).sort((a, b) => a.n - b.n).map((t) => ({ id: t.id, n: t.n, zone: t.zone, seats: seatsOf(hall, t.id) }));
}

/** "Нова резервация" from the staff (also "Чака маса" with waitlist: true). Log: reservation.create. */
export async function resCreate(ctx: Ctx, s: StaffCtx, input: ReservationInput): Promise<ResRow> {
  need(s, "reservations");
  const i = input && typeof input === "object" ? input : ({} as ReservationInput);
  const r = await createReservation(ctx, { ...i, marketing: false, replaces: null }, { actor: s.user.username });
  return rowFor(ctx, r);
}

/* ---------- blocking no-shows ---------- */
export interface BlockRow { ref: string; name: string; phone: string; count: number; status: NoShowBlock["status"]; at: string; by: string | null; manual: boolean }
export async function blockList(ctx: Ctx, s: StaffCtx): Promise<{ rows: BlockRow[]; canDecide: boolean; limit: number }> {
  need(s, ["reservations", "customers"]);
  const all = (await ctx.repo.list<NoShowBlock & { manual?: boolean }>(COL.blocks)).filter((b) => b.status !== "cleared" || b.count > 0)
    .sort((a, b) => (a.status === b.status ? (a.at < b.at ? 1 : -1) : a.status === "pending" ? -1 : b.status === "pending" ? 1 : a.status === "blocked" ? -1 : 1));
  return {
    rows: await Promise.all(all.map(async (b) => ({ ref: await isBlockedRef(b.id), name: b.name, phone: maskPhone(b.id), count: b.count, status: b.status, at: b.at, by: b.by || null, manual: !!b.manual }))),
    canDecide: isBoss(s), limit: (await getSettings(ctx)).noShowLimit,
  };
}
async function blockByRef(ctx: Ctx, ref: string): Promise<NoShowBlock & { manual?: boolean }> {
  for (const b of await ctx.repo.list<NoShowBlock & { manual?: boolean }>(COL.blocks)) if ((await isBlockedRef(b.id)) === String(ref)) return b;
  throw new CoreError("not_found", RESA_MSG.block, 404);
}
/** "Блокирай" / "Не блокирай" (pending -> cleared) / "Отблокирай" (blocked -> cleared): main admin, owner, manager.
    Log: block.decide (the masked phone). */
export async function blockDecide(ctx: Ctx, s: StaffCtx, ref: string, action: "block" | "clear"): Promise<BlockRow> {
  needBoss(s, ["reservations", "customers"]);
  if (action !== "block" && action !== "clear") throw new CoreError("bad_status", RESA_MSG.status, 422);
  const b = await blockByRef(ctx, ref);
  const was = b.status;
  b.status = action === "block" ? "blocked" : "cleared"; b.at = iso(ctx); b.by = s.user.username;
  if (action === "clear") b.count = 0;
  await ctx.repo.put(COL.blocks, b);
  await audit(ctx, s.user.username, "block." + (action === "block" ? "block" : was === "blocked" ? "unblock" : "clear"), maskPhone(b.id), { name: b.name });
  return { ref: await isBlockedRef(b.id), name: b.name, phone: maskPhone(b.id), count: b.count, status: b.status, at: b.at, by: b.by || null, manual: !!b.manual };
}
/** "Добави номер ръчно": blocked at once. Log: block.add. */
export async function blockAdd(ctx: Ctx, s: StaffCtx, input: { phone: string; name?: string }): Promise<BlockRow> {
  needBoss(s, ["reservations", "customers"]);
  const phone = normPhone(input && input.phone);
  if (!phone) invalid({ phone: RESA_MSG.phone });
  const cur = await ctx.repo.get<NoShowBlock & { manual?: boolean }>(COL.blocks, phone!);
  const b = { ...(cur || { count: 0 }), id: phone!, name: String((input && input.name) || cur?.name || "").trim().slice(0, 80), status: "blocked" as const, at: iso(ctx), by: s.user.username, manual: true, count: cur ? cur.count : 0 };
  await ctx.repo.put(COL.blocks, b);
  await audit(ctx, s.user.username, "block.add", maskPhone(phone!), { name: b.name });
  return { ref: await isBlockedRef(phone!), name: b.name, phone: maskPhone(phone!), count: b.count, status: b.status, at: b.at, by: b.by, manual: true };
}
/** the block state of a phone (customers): "blocked" | "pending" | null */
export async function blockOf(ctx: Ctx, phone: string): Promise<"blocked" | "pending" | null> {
  const b = await ctx.repo.get<NoShowBlock>(COL.blocks, phone);
  return b && (b.status === "blocked" || b.status === "pending") ? b.status : null;
}

/* ---------- "Настройки": the hours (read only: rules of the core, README-3 "Часовете в „Настройки“ са само за четене") ---------- */
export interface HoursInfo { open: string; close: string; kitchen: string; delivery: string; lunchUntil: string; reservations: { from: string; to: string; step: number; daysAhead: number } }
export function hoursInfo(): HoursInfo {
  return { open: RESTAURANT.open, close: RESTAURANT.close, kitchen: RESTAURANT.kitchen, delivery: RESTAURANT.delivery, lunchUntil: RESTAURANT.lunchUntil,
    reservations: { from: hhmm(RES_FIRST), to: hhmm(RES_LAST), step: RES_STEP, daysAhead: RES_DAYS_AHEAD } };
}
/** the settings for the screen "Настройки": the stored ones + the hours (read only) */
export async function settingsView(ctx: Ctx): Promise<Awaited<ReturnType<typeof getSettings>> & { hours: HoursInfo }> {
  return { ...(await getSettings(ctx)), hours: hoursInfo() };
}
