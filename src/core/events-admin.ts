/* Events in the admin (section "Събития"; design/pages-admin/events.html, README-2): the events live in the core
   (site-data.ts "site:events") instead of the static list of src/lib/events.ts; the site gets the published ones at the
   next rebuild (the pages, EVENT_SLUGS, JSON-LD) and at once through /api/events.
   - an event: name, category (EVENT_CATS), date (today .. a year ahead, never in the past) or the monthly "last
     Saturday" of the Greek night, time, description, program, menu, price / "Вход свободен" / "Още не е ясно", seats;
   - "Запази чернова" (draft: not on the site) and "Публикувай"; "Изтрий" returns the row for "Отмени" (eventRestore);
   - the address (/sabitia/<id>/) is made from the name once and never changes; a deleted or unpublished event that was
     on the site gets 301 to /sabitia/ at the next rebuild;
   - upcoming / past by the date in Sofia; what is missing is [ЛИПСВА: …] (eventNote). */
import { audit } from "./audit.ts";
import { iso, nowDate, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, invalid, money, HHMM } from "./rights.ts";
import { getSection, writeSection, eventNote, type EventRow, type EventsData, type PriceMode } from "./site-data.ts";
import { validYmd } from "./reservations.ts";
import { EVENT_CATS } from "../lib/event-cats.ts";
import { lastSaturday } from "../lib/status.ts";
import { slugify } from "../lib/slug.ts";
import { sofiaYmd, addDaysYmd } from "../lib/time.ts";

export const EVENT_MSG = {
  unknown: "Няма такова събитие.",
  n: "Напишете име (от 2 до 80 знака).",
  cat: "Изберете категория.",
  date: "Изберете дата от днес до година напред.",
  time: "Изберете час.",
  text: "Описанието е до 600 знака.",
  long: "Текстът е до 2000 знака.",
  price: "Напишете цена като 25,00 (до 500 €).",
  seats: "Местата са цяло число от 1 до 999 (или празно).",
  recur: "Повтарящата се вечер остава в последната събота на месеца.",
  recurStays: "Месечната вечер е част от сайта (календарът на резервацията, офертите): променя се, но не се изтрива и не се скрива.",
  recurName: "Името на месечната вечер е до " + 24 + " знака (общият код на сайта има граница на размера).",
  recurText: "Описанието на месечната вечер е до " + 90 + " знака (общият код на сайта има граница на размера).",
};
/* the monthly evening goes into the shared runtime of every page (SC.events(), lib/events.ts): its name and description
   stay short, so the rebuild never goes over the 30 000 B budget (scripts/build-checks.mjs) */
export const RECUR_NAME_MAX = 24, RECUR_TEXT_MAX = 90;

export interface EventView extends EventRow { dateNext: string; phase: "upcoming" | "today" | "past"; days: number; note: string; url: string }
const ymdLocal = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const daysBetween = (a: string, b: string) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5);
export function viewOf(e: EventRow, today: string): EventView {
  const t = new Date(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const d = e.recur ? ymdLocal(lastSaturday(t).d) : e.date || today, days = daysBetween(today, d);
  return { ...e, dateNext: d, phase: days > 0 ? "upcoming" : days === 0 ? "today" : "past", days, note: eventNote(e), url: "/sabitia/" + e.id + "/" };
}

/** the live events (no rights: /api/events and the demo); published only unless all */
export async function liveEvents(ctx: Ctx, all = false): Promise<EventRow[]> {
  return (await getSection(ctx, "events")).data.rows.filter((e) => all || e.status === "published");
}
/** /api/events (api.events() in the demo): the published events with the date as "YYYY-MM-DD" in the shape of
    lib/events.ts SiteEventJson (+ prog / menu), the next first, then the past ones */
export async function publicEvents(ctx: Ctx): Promise<{ id: string; n: string; cat: string; date: string; time: string; price: number | null; free: boolean; seatsLeft: number | null; text: string; note: string; prog: string; menu: string }[]> {
  const today = sofiaYmd(nowDate(ctx));
  const v = (await liveEvents(ctx)).map((e) => viewOf(e, today));
  const up = v.filter((e) => e.days >= 0).sort((a, b) => a.days - b.days), past = v.filter((e) => e.days < 0).sort((a, b) => b.days - a.days);
  return [...up, ...past].map((e) => ({ id: e.id, n: e.n, cat: e.cat, date: e.dateNext, time: e.time, price: e.priceMode === "price" ? e.price : null, free: e.priceMode === "free", seatsLeft: e.seats, text: e.text, note: e.note, prog: e.prog, menu: e.menu }));
}

export async function eventsList(ctx: Ctx, s: StaffCtx, q: { tab?: "upcoming" | "past" | "all"; cat?: string } = {}): Promise<{ version: number; rows: EventView[]; cats: readonly string[]; counts: { upcoming: number; past: number } }> {
  need(s, "events");
  const v = await getSection(ctx, "events"), today = sofiaYmd(nowDate(ctx));
  const rows = v.data.rows.map((e) => viewOf(e, today));
  const up = rows.filter((e) => e.phase !== "past").sort((a, b) => a.days - b.days), past = rows.filter((e) => e.phase === "past").sort((a, b) => b.days - a.days);
  const pick = q.tab === "past" ? past : q.tab === "all" ? [...up, ...past] : up;
  return { version: v.version, rows: pick.filter((e) => !q.cat || e.cat === q.cat), cats: EVENT_CATS, counts: { upcoming: up.length, past: past.length } };
}

export type EventInput = Partial<Pick<EventRow, "n" | "cat" | "date" | "time" | "text" | "prog" | "menu" | "priceMode" | "seats">> & { price?: number | string | null };
const str = (v: unknown) => String(v == null ? "" : v).trim();

function check(ctx: Ctx, cur: EventRow | null, p: EventInput): Omit<EventRow, "id" | "status" | "createdAt" | "updatedAt"> {
  const f: Record<string, string> = {}, today = sofiaYmd(nowDate(ctx));
  const n = p.n !== undefined ? str(p.n).replace(/\s+/g, " ") : cur?.n || "";
  if (n.length < 2 || n.length > 80) f.n = EVENT_MSG.n;
  const cat = p.cat !== undefined ? str(p.cat) : cur?.cat || "";
  if (!(EVENT_CATS as readonly string[]).includes(cat)) f.cat = EVENT_MSG.cat;
  const recur = cur?.recur || null;
  let date = cur?.date || null;
  if (recur) { if (p.date !== undefined && p.date !== null && p.date !== "") f.date = EVENT_MSG.recur; }
  else if (p.date !== undefined || !cur) {
    date = str(p.date);
    if (!validYmd(date) || date < today || date > addDaysYmd(today, 366)) f.date = EVENT_MSG.date;
  }
  const time = p.time !== undefined ? str(p.time) : cur?.time || "";
  if (!HHMM.test(time)) f.time = EVENT_MSG.time;
  const text = p.text !== undefined ? str(p.text) : cur?.text || "";
  if (text.length > 600) f.text = EVENT_MSG.text;
  const prog = p.prog !== undefined ? str(p.prog) : cur?.prog || "", menu = p.menu !== undefined ? str(p.menu) : cur?.menu || "";
  if (prog.length > 2000) f.prog = EVENT_MSG.long;
  if (menu.length > 2000) f.menu = EVENT_MSG.long;
  const priceMode: PriceMode = p.priceMode === "price" || p.priceMode === "free" || p.priceMode === "tbd" ? p.priceMode : cur?.priceMode || "tbd";
  let price: number | null = null;
  if (priceMode === "price") {
    const v = p.price !== undefined ? money(p.price) : cur?.price ?? null;
    if (v == null || !(v >= 0 && v <= 500)) f.price = EVENT_MSG.price; else price = v;
  }
  let seats = cur?.seats ?? null;
  if (p.seats !== undefined) { const v = p.seats === null || (p.seats as unknown) === "" ? null : Number(p.seats); if (v !== null && (!Number.isInteger(v) || v < 1 || v > 999)) f.seats = EVENT_MSG.seats; else seats = v; }
  if (recur && !f.n && n.length > RECUR_NAME_MAX) f.n = EVENT_MSG.recurName;
  if (recur && !f.text && text.length > RECUR_TEXT_MAX) f.text = EVENT_MSG.recurText;
  if (Object.keys(f).length) invalid(f);
  return { n, cat, date: recur ? null : date, recur, time, text, prog, menu, priceMode, price, seats };
}
/** the address from the name, once: unique among the events, at most 72 characters, whole words */
function newId(name: string, rows: EventRow[], ever: string[]): string {
  const base = slugify(name, 64) || "sabitie";
  let id = base, k = 1;
  while (rows.some((e) => e.id === id) || ever.includes(id)) id = base + "-" + ++k;
  return id;
}

/** "Ново събитие": draft, or published at once with publish: true. Log: event.create (+ event.publish). */
export async function eventCreate(ctx: Ctx, s: StaffCtx, p: EventInput & { publish?: boolean }): Promise<EventView & { version: number }> {
  need(s, "events");
  const r = await writeSection(ctx, "events", s.user.username, undefined, async (cur: EventsData) => {
    const v = check(ctx, null, p || {}), at = iso(ctx);
    const row: EventRow = { ...v, id: newId(v.n, cur.rows, cur.ever), status: p && p.publish ? "published" : "draft", createdAt: at, updatedAt: at, by: s.user.username };
    cur.rows.push(row);
    if (row.status === "published" && !cur.ever.includes(row.id)) cur.ever.push(row.id);
    await audit(ctx, s.user.username, "event.create", row.id, { n: row.n, date: row.date, status: row.status });
    return { data: cur, result: { row } };
  });
  return { ...viewOf(r.row, sofiaYmd(nowDate(ctx))), version: r.version };
}
/** "Промени" (the address stays). 409 "conflict" for an old version. Log: event.update with the changed fields. */
export async function eventUpdate(ctx: Ctx, s: StaffCtx, id: string, p: EventInput, version?: number): Promise<EventView & { version: number }> {
  need(s, "events");
  const r = await writeSection(ctx, "events", s.user.username, version, async (cur: EventsData) => {
    const i = cur.rows.findIndex((e) => e.id === id);
    if (i < 0) throw new CoreError("not_found", EVENT_MSG.unknown, 404);
    const old = cur.rows[i], v = check(ctx, old, p || {});
    const row: EventRow = { ...old, ...v, updatedAt: iso(ctx), by: s.user.username };
    const keys = (Object.keys(v) as (keyof typeof v)[]).filter((k) => JSON.stringify(v[k]) !== JSON.stringify(old[k]));
    cur.rows[i] = row;
    if (keys.length) await audit(ctx, s.user.username, "event.update", id, { n: row.n, fields: keys });
    return { data: cur, result: { row } };
  });
  return { ...viewOf(r.row, sofiaYmd(nowDate(ctx))), version: r.version };
}
/** "Публикувай" / back to draft. Log: event.publish / event.unpublish. */
export async function eventPublish(ctx: Ctx, s: StaffCtx, id: string, on = true): Promise<EventView & { version: number }> {
  need(s, "events");
  const r = await writeSection(ctx, "events", s.user.username, undefined, async (cur: EventsData) => {
    const e = cur.rows.find((x) => x.id === id);
    if (!e) throw new CoreError("not_found", EVENT_MSG.unknown, 404);
    const want = on ? "published" : "draft";
    if (!on && e.recur) throw new CoreError("forbidden", EVENT_MSG.recurStays, 409);
    if (e.status !== want) {
      e.status = want; e.updatedAt = iso(ctx);
      if (on && !cur.ever.includes(e.id)) cur.ever.push(e.id);
      await audit(ctx, s.user.username, on ? "event.publish" : "event.unpublish", id, { n: e.n });
    }
    return { data: cur, result: { row: e } };
  });
  return { ...viewOf(r.row, sofiaYmd(nowDate(ctx))), version: r.version };
}
/** "Изтрий": returns the row for "Отмени" (eventRestore). Log: event.delete. */
export async function eventRemove(ctx: Ctx, s: StaffCtx, id: string): Promise<{ ok: true; removed: EventRow; version: number }> {
  need(s, "events");
  return writeSection(ctx, "events", s.user.username, undefined, async (cur: EventsData) => {
    const i = cur.rows.findIndex((e) => e.id === id);
    if (i < 0) throw new CoreError("not_found", EVENT_MSG.unknown, 404);
    if (cur.rows[i].recur) throw new CoreError("forbidden", EVENT_MSG.recurStays, 409);
    const removed = cur.rows.splice(i, 1)[0];
    await audit(ctx, s.user.username, "event.delete", id, { n: removed.n });
    return { data: cur, result: { ok: true as const, removed } };
  });
}
/** "Отмени" after "Изтрий": the same row back (same address), checked again. Log: event.restore. */
export async function eventRestore(ctx: Ctx, s: StaffCtx, row: EventRow): Promise<EventView & { version: number }> {
  need(s, "events");
  const x = row && typeof row === "object" ? row : ({} as EventRow);
  const r = await writeSection(ctx, "events", s.user.username, undefined, async (cur: EventsData) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(x.id)) || cur.rows.some((e) => e.id === x.id)) throw new CoreError("not_found", EVENT_MSG.unknown, 404);
    /* the date of a past event stays (it is the same event); the other fields are checked like a change */
    const base: EventRow = { id: x.id, n: "", cat: "", date: x.recur ? null : x.date, recur: x.recur === "last-sat" ? "last-sat" : null, time: "", text: "", prog: "", menu: "", priceMode: "tbd", price: null, seats: null, status: "draft", createdAt: x.createdAt || iso(ctx), updatedAt: iso(ctx) };
    const v = check(ctx, base, { n: x.n, cat: x.cat, time: x.time, text: x.text, prog: x.prog, menu: x.menu, priceMode: x.priceMode, price: x.price, seats: x.seats });
    const back: EventRow = { ...base, ...v, status: x.status === "published" ? "published" : "draft", by: s.user.username };
    cur.rows.push(back);
    if (back.status === "published" && !cur.ever.includes(back.id)) cur.ever.push(back.id);
    await audit(ctx, s.user.username, "event.restore", back.id, { n: back.n });
    return { data: cur, result: { row: back } };
  });
  return { ...viewOf(r.row, sofiaYmd(nowDate(ctx))), version: r.version };
}
