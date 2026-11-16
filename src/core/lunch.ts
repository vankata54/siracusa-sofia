/* The lunch menu in the admin (design/pages-admin/lunch.html, REVIEW-2 "За кода" 5): a weekly schedule (day -> dishes of the
   lunch catalog), the rule "the same menu never two days in a row" (it stops publishing), favourite combinations, publishing
   by day, and the PIN for the staff.

   Safest choices (described in the report and DECISIONS):
   - "the same menu" = the same list of dishes (order does not matter) as the calendar day before or after, as in the prototype;
   - only today's PUBLISHED day reaches the site and the orders (core/menu-edit.ts effectiveMenu); a draft never does;
     a day before today cannot be published;
   - the PIN (4 digits) is hashed with ctx.hasher (scrypt on the server), never returned or shown after it is saved: the
     screen that sets it shows it once ("Смени ПИН"; without a PIN in the request the core makes a random one and returns it
     once). Only the owner, the manager and the main admin set it (and work without it). Any other staff member with the
     section "Обедно меню" opens the schedule with the PIN for 15 minutes on that device (each change extends it);
     a new PIN closes every open schedule;
   - wrong PINs: 5 in 15 minutes per person and device, 10 per person on all devices -> 429 with retryIn (minutes 15);
     every attempt is in the log (lunch.unlock, lunch.pin_fail; lunch.pin without the value);
   - "Изчерпано днес" for a lunch dish stays in core/menu.ts. */
import { COL, iso, nowDate, emit, randomDigits, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import { audit } from "./audit.ts";
import type { StaffCtx } from "./staff.ts";
import { MENU, type Menu, type LunchRaw } from "../data/menu.ts";
import { sofiaYmd, addDaysYmd, sofiaEpoch } from "../lib/time.ts";
import { DAYS, MONTHS } from "../lib/format.ts";
import { newSlug } from "../lib/slug.ts";
import { refreshLive } from "./menu-edit.ts";

/** the lunch catalog in the data (before any setMenu in this process) */
const BUILT_LUNCH: LunchRaw[] = JSON.parse(JSON.stringify(MENU.lunch.items));

export const LUNCH_GROUPS = ["Супи", "Салати", "Скара на дървени въглища", "Основни", "Десерти"];
export const LUNCH_BOSS = ["admin", "owner", "manager"];
export const PIN_FAILS_DEVICE = 5, PIN_FAILS_PERSON = 10, PIN_LOCK_MIN = 15, LUNCH_OPEN_MIN = 15;
/** a day's limit per person (review admin-menu flows, minor 7): 10 per 15 minutes would still allow ~960 tries a day;
    after 30 wrong ones in a day (Sofia) the PIN is closed for that person until midnight */
export const PIN_FAILS_DAY = 30;

export const LUNCH_MSG = {
  pinRequired: "Графикът е заключен. Въведете ПИН.",
  pinUnset: "ПИН още не е зададен. Помолете управителя да го зададе.",
  badPin: "Грешен ПИН. Опитайте пак.",
  locked: "Твърде много грешни опити. Опитайте след 15 минути.",
  lockedDay: "Твърде много грешни опити днес. Опитайте утре или помолете управителя.",
  pinBoss: "Само собственикът, управителят и главният админ сменят ПИН.",
  pinFormat: "ПИН-ът е от 4 цифри.",
  pinWeak: "Изберете по-труден ПИН (не четири еднакви цифри и не поред).",
  same: "Едно и също меню не може два поредни дни. Сменете поне едно ястие, за да го публикувате.",
  empty: "Добавете поне едно ястие, за да публикувате деня.",
  past: "Този ден вече мина.",
};

export interface LunchItem { id: string; n: string; group: string; p: number }
export interface LunchFav { id: string; n: string; ids: string[] }
export interface LunchDoc {
  id: "lunch"; days: Record<string, string[]>; pub: Record<string, { at: string; who: string; ids: string[] }>;
  favs: LunchFav[]; extra: LunchItem[]; updatedAt?: string;
}
interface PinDoc { id: "lunch-pin"; salt: string; hash: string; algo: "scrypt" | "pbkdf2"; v: number; at: string; by: string }
interface OpenDoc { id: string; until: number; v: number }
interface Fails { id: string; n: number; first: number; until: number }
export interface LunchView {
  today: string; groups: string[]; catalog: LunchItem[]; days: Record<string, string[]>; pub: LunchDoc["pub"]; favs: LunchFav[];
  pinSet: boolean; boss: boolean; openUntil: number | null;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown) => (typeof v === "string" ? v : "").replace(/\s+/g, " ").trim();
const isBoss = (s: StaffCtx) => LUNCH_BOSS.includes(s.user.role);
const today = (ctx: Ctx) => sofiaYmd(nowDate(ctx));
const dev = (d: unknown) => String(d || "local").replace(/[^\w:.-]/g, "").slice(0, 64) || "local";
/** "понеделник, 16 ноември" (Sofia calendar date, no time zone shift) */
export function dayLong(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number), dt = new Date(Date.UTC(y, m - 1, d));
  return DAYS[dt.getUTCDay()] + ", " + d + " " + MONTHS[m - 1];
}
const sameList = (a: string[], b: string[]) => a.length > 0 && a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

function need(s: StaffCtx) {
  if (!s || !s.user) throw new CoreError("auth", "Влезте отново.", 401);
  if (s.user.role !== "admin" && !s.sections.includes("lunch")) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
}
function invalid(fields: Record<string, string>, msg = "Проверете полетата."): never {
  throw Object.assign(new CoreError("invalid", msg, 422), { fields });
}

async function doc(ctx: Ctx): Promise<LunchDoc> {
  const d = await ctx.repo.get<LunchDoc>(COL.settings, "lunch");
  if (d) return d;
  /* the menu of the data counts as published for its day (it was taken from the site), and is the first favourite */
  const ids = BUILT_LUNCH.filter((x) => x.p).map((x) => x.id), date = MENU.lunch.date;
  return { id: "lunch", days: { [date]: ids }, pub: { [date]: { at: date + "T07:30:00.000Z", who: "Сайтът", ids } }, favs: [{ id: "f-site", n: "Менюто от " + dayLong(date), ids }], extra: [] };
}
const save = (ctx: Ctx, d: LunchDoc) => ctx.repo.put(COL.settings, { ...d, updatedAt: iso(ctx) });

/** the catalog: the lunch dishes of the data (with a price) and the ones added in the admin */
export function catalogOf(d: Pick<LunchDoc, "extra">): LunchItem[] {
  return [...BUILT_LUNCH.filter((x) => x.p).map((x) => ({ id: x.id, n: x.n, group: x.group, p: x.p as number })), ...(d.extra || [])];
}

/** Today's published lunch menu in the menu's shape (core/menu-edit.ts uses it), or null (then the data's lunch stays). */
export async function lunchToday(ctx: Ctx): Promise<Menu["lunch"] | null> {
  const d = await ctx.repo.get<LunchDoc>(COL.settings, "lunch");
  if (!d) return null;
  const t = today(ctx), p = d.pub[t];
  if (!p || !p.ids.length) return null;
  const cat = new Map(catalogOf(d).map((x) => [x.id, x]));
  const items = p.ids.map((id) => cat.get(id)).filter((x): x is LunchItem => !!x).map((x) => ({ id: x.id, group: x.group, n: x.n, p: x.p }));
  const dn = dayLong(t).split(",")[0];
  return items.length ? { date: t, dayName: dn.charAt(0).toUpperCase() + dn.slice(1), items } : null;
}

/* ---------- the PIN ---------- */
async function pinDoc(ctx: Ctx) { return ctx.repo.get<PinDoc>(COL.settings, "lunch-pin"); }
async function isOpen(ctx: Ctx, s: StaffCtx, device: string): Promise<number | null> {
  if (isBoss(s)) return null;
  const p = await pinDoc(ctx), o = await ctx.repo.get<OpenDoc>(COL.settings, "lunch-open:" + s.user.id + ":" + dev(device));
  return p && o && o.v === p.v && o.until > nowDate(ctx).getTime() ? o.until : null;
}
/** the owner, the manager and the main admin always; anyone else with the section only with the PIN (each change extends it) */
async function gate(ctx: Ctx, s: StaffCtx, device: string): Promise<void> {
  need(s);
  if (isBoss(s)) return;
  const until = await isOpen(ctx, s, device);
  if (!until) {
    const p = await pinDoc(ctx);
    throw Object.assign(new CoreError(p ? "pin_required" : "pin_unset", p ? LUNCH_MSG.pinRequired : LUNCH_MSG.pinUnset, 403), { pinSet: !!p });
  }
  const p = (await pinDoc(ctx))!;
  await ctx.repo.put<OpenDoc>(COL.settings, { id: "lunch-open:" + s.user.id + ":" + dev(device), until: nowDate(ctx).getTime() + LUNCH_OPEN_MIN * 60_000, v: p.v });
}
const who = (s: StaffCtx) => s.user.name || s.user.username;
const viaPin = (s: StaffCtx) => (isBoss(s) ? {} : { pin: true });

const WEAK = new Set(["0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "8765", "7654", "6543", "5432", "4321", "3210"]);
const weak = (p: string) => /^(\d)\1{3}$/.test(p) || WEAK.has(p);

/** "Смени ПИН": only the owner, the manager, the main admin. pin: 4 digits (typed twice on the screen), or none: a random one.
    Returns the new PIN ONCE (the screen shows it to the person who set it); only its hash is kept. */
export async function setPin(ctx: Ctx, s: StaffCtx, pin?: string): Promise<{ pin: string; at: string }> {
  need(s);
  if (!isBoss(s)) throw new CoreError("forbidden", LUNCH_MSG.pinBoss, 403);
  if (!ctx.hasher) throw new Error("hasher missing");
  let p = pin == null || pin === "" ? "" : String(pin);
  if (p && !/^\d{4}$/.test(p)) invalid({ pin: LUNCH_MSG.pinFormat }, LUNCH_MSG.pinFormat);
  if (p && weak(p)) invalid({ pin: LUNCH_MSG.pinWeak }, LUNCH_MSG.pinWeak);
  while (!p || weak(p)) p = randomDigits(4);
  const old = await pinDoc(ctx), h = await ctx.hasher.hash(p), at = iso(ctx);
  await ctx.repo.put<PinDoc>(COL.settings, { id: "lunch-pin", ...h, v: (old ? old.v : 0) + 1, at, by: s.user.username });
  await audit(ctx, s.user.username, "lunch.pin", "lunch-pin", { changed: !!old });
  return { pin: p, at };
}

/** windowMin: how long the wrong attempts count (15 min; the day's key carries the date in its id and counts all day) */
async function fails(ctx: Ctx, id: string, windowMin = PIN_LOCK_MIN): Promise<Fails> {
  const now = nowDate(ctx).getTime(), f = await ctx.repo.get<Fails>(COL.loginFails, id);
  return f && (f.until > now || f.first > now - windowMin * 60_000) ? f : { id, n: 0, first: now, until: 0 };
}
const pinLocks = new WeakMap<object, Promise<unknown>>();
async function serial<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  const prev = pinLocks.get(ctx.repo) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  pinLocks.set(ctx.repo, prev.then(() => mine));
  await prev.catch(() => undefined);
  try { return await fn(); } finally { release(); }
}

/** Opens the schedule with the PIN on this device for 15 minutes (the owner, the manager, the main admin need no PIN). */
export async function unlock(ctx: Ctx, s: StaffCtx, device: string, pin: string): Promise<{ until: number | null }> {
  need(s);
  if (isBoss(s)) return { until: null };
  if (!ctx.hasher) throw new Error("hasher missing");
  const p = await pinDoc(ctx);
  if (!p) throw Object.assign(new CoreError("pin_unset", LUNCH_MSG.pinUnset, 409), { pinSet: false });
  const now = nowDate(ctx).getTime(), d = dev(device);
  /* the day's key: the Sofia date in the id, locked until midnight */
  const day = sofiaYmd(nowDate(ctx)), midnight = sofiaEpoch(addDaysYmd(day, 1), 0);
  const keys: [string, number, number, number][] = [
    ["lunch-pin:" + s.user.id + ":" + d, PIN_FAILS_DEVICE, PIN_LOCK_MIN, now + PIN_LOCK_MIN * 60_000],
    ["lunch-pin:" + s.user.id, PIN_FAILS_PERSON, PIN_LOCK_MIN, now + PIN_LOCK_MIN * 60_000],
    ["lunch-pin-day:" + s.user.id + ":" + day, PIN_FAILS_DAY, 1440, midnight],
  ];
  const lockedMsg = (i: number) => (i === 2 ? LUNCH_MSG.lockedDay : LUNCH_MSG.locked);
  /* counted BEFORE the check, one at a time per store (parallel attempts cannot slip past the limit) */
  const fs = await serial(ctx, async () => {
    const list = await Promise.all(keys.map(([k, , w]) => fails(ctx, k, w)));
    const li = list.findIndex((f) => f.until > now);
    if (li > -1) throw Object.assign(new CoreError("throttled", lockedMsg(li), 429), { retryIn: Math.max(1, Math.ceil((list[li].until - now) / 1000)) });
    for (let i = 0; i < list.length; i++) { const f = list[i]; f.n += 1; if (f.n >= keys[i][1]) f.until = keys[i][3]; await ctx.repo.put(COL.loginFails, f); }
    return list;
  });
  const ok = /^\d{4}$/.test(String(pin || "")) && await ctx.hasher.verify(String(pin), p.salt, p.hash, p.algo);
  if (!ok) {
    await audit(ctx, s.user.username, "lunch.pin_fail", "lunch");
    const left = Math.min(...fs.map((f, i) => keys[i][1] - f.n));
    /* the limit that was reached with the longest lock says what to do */
    const hit = fs.map((_, i) => i).filter((i) => keys[i][1] - fs[i].n <= 0).sort((a, b) => fs[b].until - fs[a].until)[0];
    if (left <= 0) throw Object.assign(new CoreError("throttled", lockedMsg(hit), 429), { retryIn: Math.max(1, Math.ceil((fs[hit].until - now) / 1000)) });
    throw Object.assign(new CoreError("bad_pin", LUNCH_MSG.badPin, 401), left <= 3 ? { left } : {});
  }
  /* the right PIN: this device starts again; the person keeps the other devices' wrong attempts but gets this one back */
  await ctx.repo.del(COL.loginFails, keys[0][0]);
  const fp = await fails(ctx, keys[1][0]);
  if (fp.n > 0) { fp.n -= 1; if (fp.n < PIN_FAILS_PERSON) fp.until = 0; await ctx.repo.put(COL.loginFails, fp); }
  const until = now + LUNCH_OPEN_MIN * 60_000;
  await ctx.repo.put<OpenDoc>(COL.settings, { id: "lunch-open:" + s.user.id + ":" + d, until, v: p.v });
  await audit(ctx, s.user.username, "lunch.unlock", "lunch");
  return { until };
}
/** "Заключи": closes the schedule on this device */
export async function lock(ctx: Ctx, s: StaffCtx, device: string): Promise<{ ok: true }> {
  need(s);
  await ctx.repo.del(COL.settings, "lunch-open:" + s.user.id + ":" + dev(device));
  return { ok: true };
}

/* ---------- the schedule ---------- */
async function viewOf(ctx: Ctx, s: StaffCtx, device: string, d: LunchDoc): Promise<LunchView> {
  return { today: today(ctx), groups: LUNCH_GROUPS, catalog: catalogOf(d), days: d.days, pub: d.pub, favs: d.favs, pinSet: !!(await pinDoc(ctx)), boss: isBoss(s), openUntil: await isOpen(ctx, s, device) };
}

/** The schedule (catalog, days, published days, favourites). Without the PIN (other staff): 403 "pin_required" / "pin_unset". */
export async function getLunch(ctx: Ctx, s: StaffCtx, device: string): Promise<LunchView> {
  need(s);
  if (!isBoss(s) && !(await isOpen(ctx, s, device))) {
    const p = await pinDoc(ctx);
    throw Object.assign(new CoreError(p ? "pin_required" : "pin_unset", p ? LUNCH_MSG.pinRequired : LUNCH_MSG.pinUnset, 403), { pinSet: !!p });
  }
  return viewOf(ctx, s, device, await doc(ctx));
}

function checkIds(d: LunchDoc, ids: unknown): string[] {
  const cat = new Set(catalogOf(d).map((x) => x.id));
  const list = Array.isArray(ids) ? [...new Set(ids.map(String))] : null;
  if (!list) invalid({ ids: "Изберете ястията." });
  if (list.length > 40) invalid({ ids: "До 40 ястия в един ден." });
  const bad = list.find((id) => !cat.has(id));
  if (bad) invalid({ ids: "Едно от ястията го няма в обедното меню. Заредете пак." });
  return list;
}

/** Saves one day (a draft until "Публикувай"). An empty list clears the day. */
export async function saveDay(ctx: Ctx, s: StaffCtx, device: string, date: string, ids: unknown): Promise<LunchView> {
  await gate(ctx, s, device);
  if (!YMD.test(String(date))) invalid({ date: "Изберете ден." });
  const d = await doc(ctx), list = checkIds(d, ids);
  if (list.length) d.days[date] = list; else delete d.days[date];
  await save(ctx, d);
  await audit(ctx, s.user.username, "lunch.update", date, { n: list.length, ...viaPin(s) });
  return viewOf(ctx, s, device, d);
}

/** The day before or after with the same list (a draft or published), or null. */
export function clashOf(d: Pick<LunchDoc, "days">, date: string): string | null {
  const me = d.days[date] || [];
  for (const o of [addDaysYmd(date, -1), addDaysYmd(date, 1)]) if (sameList(me, d.days[o] || [])) return o;
  return null;
}

/** "Публикувай": the days go to the site (today's at once). Each must have dishes, must not be in the past, and must not
    repeat the menu of the day before or after (422 "same_menu" with the day in `fields`). */
export async function publishDays(ctx: Ctx, s: StaffCtx, device: string, dates: unknown): Promise<LunchView> {
  await gate(ctx, s, device);
  const list = Array.isArray(dates) ? [...new Set(dates.map(String))].slice(0, 14) : [];
  if (!list.length || list.some((x) => !YMD.test(x))) invalid({ dates: "Изберете дните за публикуване." });
  const d = await doc(ctx), t = today(ctx), fields: Record<string, string> = {};
  let code = "invalid", msg = "Проверете дните.";
  for (const day of list) {
    if (day < t) { fields[day] = LUNCH_MSG.past; continue; }
    if (!(d.days[day] || []).length) { fields[day] = LUNCH_MSG.empty; continue; }
    const c = clashOf(d, day);
    if (c) { const dl = dayLong(c); fields[day] = "Същото меню като " + (dl.startsWith("вторник") ? "във " : "в ") + dl + ". " + LUNCH_MSG.same; code = "same_menu"; msg = fields[day]; }
  }
  if (Object.keys(fields).length) throw Object.assign(new CoreError(code, code === "same_menu" ? msg : Object.values(fields)[0] || msg, 422), { fields });
  const at = iso(ctx);
  for (const day of list) d.pub[day] = { at, who: who(s), ids: [...d.days[day]] };
  await save(ctx, d);
  await audit(ctx, s.user.username, "lunch.publish", list.join(","), { days: list, ...viaPin(s) });
  emit(ctx, "lunch.published", { days: list }, { public: true });
  if (list.includes(t)) await refreshLive(ctx, "lunch");
  return viewOf(ctx, s, device, d);
}

/** "Запази като любима" / "Махни" */
export async function saveFav(ctx: Ctx, s: StaffCtx, device: string, fav: { n?: unknown; ids?: unknown }): Promise<LunchView> {
  await gate(ctx, s, device);
  const d = await doc(ctx), n = str(fav && fav.n), ids = checkIds(d, fav && fav.ids);
  if (!n || n.length > 60) invalid({ n: "Напишете име до 60 знака." });
  if (!ids.length) invalid({ ids: "Добавете ястия в деня." });
  if (d.favs.length >= 30) invalid({ n: "До 30 любими комбинации." });
  d.favs.push({ id: "f-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), n, ids });
  await save(ctx, d);
  await audit(ctx, s.user.username, "lunch.fav", n, viaPin(s));
  return viewOf(ctx, s, device, d);
}
export async function removeFav(ctx: Ctx, s: StaffCtx, device: string, id: string): Promise<LunchView> {
  await gate(ctx, s, device);
  const d = await doc(ctx);
  d.favs = d.favs.filter((f) => f.id !== id);
  await save(ctx, d);
  await audit(ctx, s.user.username, "lunch.fav_remove", id, viaPin(s));
  return viewOf(ctx, s, device, d);
}

/** "Ново ястие" in the lunch catalog: name, group, price (the id gets the "l-" prefix: src/lib/lunch-id.ts) */
export async function addDish(ctx: Ctx, s: StaffCtx, device: string, x: { n?: unknown; group?: unknown; p?: unknown }): Promise<LunchView & { id: string }> {
  await gate(ctx, s, device);
  const d = await doc(ctx), n = str(x && x.n), group = str(x && x.group), fields: Record<string, string> = {};
  const pv = typeof (x && x.p) === "string" ? Number(String(x.p).replace(",", ".")) : x && x.p;
  if (!n || n.length > 120) fields.n = "Напишете името (до 120 знака).";
  if (!LUNCH_GROUPS.includes(group)) fields.group = "Изберете група.";
  if (typeof pv !== "number" || !Number.isFinite(pv) || pv <= 0 || pv > 999 || Math.abs(pv * 100 - Math.round(pv * 100)) > 1e-6) fields.p = "Напишете цена като 5,90.";
  if (Object.keys(fields).length) invalid(fields);
  const taken = new Set(catalogOf(d).map((z) => z.id));
  const id = newSlug("l " + n, taken);
  const item: LunchItem = { id, n, group, p: Math.round((pv as number) * 100) / 100 };
  d.extra = [...(d.extra || []), item];
  await save(ctx, d);
  await audit(ctx, s.user.username, "lunch.dish", id, { n, p: item.p, ...viaPin(s) });
  return { ...(await viewOf(ctx, s, device, d)), id };
}

/** the state of the PIN for the screen (never the PIN) */
export async function pinState(ctx: Ctx, s: StaffCtx, device: string): Promise<{ pinSet: boolean; boss: boolean; openUntil: number | null; at: string | null }> {
  need(s);
  const p = await pinDoc(ctx);
  return { pinSet: !!p, boss: isBoss(s), openUntil: await isOpen(ctx, s, device), at: p ? p.at : null };
}

