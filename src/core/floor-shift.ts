/* The waiter's shift (COL.shifts, role "waiter"; the kitchen and the driver keep their own shifts in the same collection).
   - start: "Моите маси днес": the waiter chooses his tables (decision 15.11.2026); a table a colleague on shift already
     has is refused: moving tables between people is the manager's job;
   - end: the occupied tables go to the chosen colleague on shift (or stay without a waiter: everybody sees their calls,
     the manager gives them to someone), the free ones stay without a waiter; the screen signs out after it;
   - the manager (the main admin, the owner, the manager) changes a waiter's tables: at least one stays, a table given
     to him leaves its old waiter, a table taken from him goes to the colleague (`to`, else the first other waiter on
     shift, as in the manager's prototype);
   - the view for the manager's module: who is on shift, their tables, the calls that wait per waiter, the average answer
     time today from the real times of the calls (null without data).
   A shift never continues on the next day (Sofia): an open one from an earlier day is closed at the next look.
   Log: shift.start, shift.end, shift.tables. Real time: shift.update (staff). */
import { COL, emit, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Iso } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { audit } from "./audit.ts";
import { isBoss, invalid, serial, RIGHTS_MSG } from "./rights.ts";
import { liveHall } from "./hall.ts";
import type { HallTable } from "./site-data.ts";
import { getSettings } from "./settings.ts";
import { sofiaYmd } from "../lib/time.ts";
import { needFloor, openSessions, callLate, type TableSession } from "./floor.ts";

export interface WaiterShift {
  id: string; /** the staff user's id */ user: string; username: string; name: string; role: "waiter"; status: "open" | "closed";
  startedAt: Iso; endedAt?: Iso; /** the hall's table ids */ tables: string[];
  /** at the end: who got the occupied tables (username, or null: nobody) and which */
  handed?: { to: string | null; tables: string[] };
  createdAt: Iso; updatedAt: Iso;
}
export const SHIFT_MSG = {
  none: "Не си на смяна. Започни смяната от „Вход и смяна“.",
  pick: "Избери поне една маса.",
  table: "Няма такава маса.",
  taken: (n: number, who: string) => "Маса " + n + " вече е при " + who + ". Управителят може да я премести.",
  waiter: "Този сервитьор не е на смяна.",
  one: (who: string) => who + " трябва да има поне една маса.",
  to: "Избери колега, който е на смяна.",
};
const LOCK = "floor-shift";

/** the open waiter shifts (the ones from an earlier day are closed first) */
export async function openShifts(ctx: Ctx): Promise<WaiterShift[]> {
  const all = (await ctx.repo.list<WaiterShift>(COL.shifts, { role: "waiter", status: "open" } as Partial<WaiterShift>)).filter((x) => x.role === "waiter" && x.status === "open");
  const today = sofiaYmd(nowDate(ctx)), out: WaiterShift[] = [];
  for (const sh of all) {
    if (sofiaYmd(new Date(sh.startedAt)) < today) { sh.status = "closed"; sh.endedAt = iso(ctx); sh.updatedAt = sh.endedAt; sh.handed = { to: null, tables: [] }; await ctx.repo.put(COL.shifts, sh); }
    else out.push(sh);
  }
  return out.sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : a.username < b.username ? -1 : 1));
}
export interface TableOwner { user: string; username: string; name: string }
/** table id -> its waiter on shift */
export async function tableOwners(ctx: Ctx, shifts?: WaiterShift[]): Promise<Map<string, TableOwner>> {
  const m = new Map<string, TableOwner>();
  for (const sh of shifts || (await openShifts(ctx))) for (const t of sh.tables) if (!m.has(t)) m.set(t, { user: sh.user, username: sh.username, name: sh.name });
  return m;
}
const say = (ctx: Ctx, sh: WaiterShift) => emit(ctx, "shift.update", { user: sh.user, username: sh.username, name: sh.name, status: sh.status, tables: sh.tables });
const nums = (h: HallTable[], ids: string[]) => ids.map((id) => h.find((t) => t.id === id)?.n).filter((n): n is number => n != null).sort((a, b) => a - b);
/** table ids from ids or numbers; unknown ones -> 422 */
function tableIds(h: HallTable[], list: unknown): string[] {
  const out: string[] = [];
  for (const raw of Array.isArray(list) ? list.slice(0, 300) : []) {
    const r = String(raw).trim(), t = h.find((x) => !x.off && x.id === r) || (/^\d{1,3}$/.test(r) ? h.find((x) => !x.off && x.n === +r) : undefined);
    if (!t) invalid({ tables: SHIFT_MSG.table }, SHIFT_MSG.table);
    if (!out.includes(t!.id)) out.push(t!.id);
  }
  return out;
}

export interface ShiftMine {
  /** my open shift, or null */
  shift: { since: Iso; tables: { id: string; n: number; zone: "salon" | "garden" }[] } | null;
  /** every table in use with its waiter on shift (for "Моите маси днес": a colleague's table cannot be chosen) */
  tables: { id: string; n: number; zone: "salon" | "garden"; seats: number; owner: { username: string; name: string } | null; mine: boolean; busy: boolean }[];
  /** the other waiters on shift (to hand the tables over at the end) */
  colleagues: { username: string; name: string; tables: number }[];
}
/** "Вход и смяна" / "Смяна": my shift, the tables to choose from, the colleagues on shift */
export async function shiftMine(ctx: Ctx, s: StaffCtx): Promise<ShiftMine> {
  needFloor(s);
  const h = (await liveHall(ctx)).tables.filter((t) => !t.off).sort((a, b) => a.n - b.n), shifts = await openShifts(ctx), owners = await tableOwners(ctx, shifts);
  const mine = shifts.find((x) => x.user === s.user.id) || null, busy = new Set((await openSessions(ctx)).map((x) => x.table));
  return {
    shift: mine ? { since: mine.startedAt, tables: h.filter((t) => mine.tables.includes(t.id)).map((t) => ({ id: t.id, n: t.n, zone: t.zone })) } : null,
    tables: h.map((t) => { const o = owners.get(t.id); return { id: t.id, n: t.n, zone: t.zone, seats: t.seats, owner: o ? { username: o.username, name: o.name } : null, mine: !!o && o.user === s.user.id, busy: busy.has(t.id) }; }),
    colleagues: shifts.filter((x) => x.user !== s.user.id).map((x) => ({ username: x.username, name: x.name, tables: x.tables.length })),
  };
}
/** "Започни смяната · N маси" (ids or numbers). On a shift already: the tables are replaced by the new choice. */
export async function shiftStart(ctx: Ctx, s: StaffCtx, tables: (string | number)[]): Promise<ShiftMine> {
  needFloor(s);
  await serial(ctx.repo, LOCK, async () => {
    const h = (await liveHall(ctx)).tables, ids = tableIds(h, tables);
    if (!ids.length) invalid({ tables: SHIFT_MSG.pick }, SHIFT_MSG.pick);
    const shifts = await openShifts(ctx), owners = await tableOwners(ctx, shifts.filter((x) => x.user !== s.user.id));
    const clash = ids.find((id) => owners.has(id));
    if (clash) { const msg = SHIFT_MSG.taken(h.find((t) => t.id === clash)!.n, owners.get(clash)!.name); throw Object.assign(new CoreError("taken", msg, 409), { fields: { tables: msg } }); }
    const now = iso(ctx), have = shifts.find((x) => x.user === s.user.id);
    const sh: WaiterShift = have ? { ...have, tables: ids, updatedAt: now } : { id: rid(8), user: s.user.id, username: s.user.username, name: s.user.name, role: "waiter", status: "open", startedAt: now, tables: ids, createdAt: now, updatedAt: now };
    await ctx.repo.put(COL.shifts, sh);
    await audit(ctx, s.user.username, have ? "shift.tables" : "shift.start", s.user.username, { tables: nums(h, ids) });
    say(ctx, sh);
  });
  return shiftMine(ctx, s);
}
/** "Предай N маси и излез": to = the username of a colleague on shift (he gets my occupied tables), or nothing. */
export async function shiftEnd(ctx: Ctx, s: StaffCtx, to?: string | null): Promise<{ ok: true; handed: number[]; to: string | null }> {
  needFloor(s);
  return serial(ctx.repo, LOCK, async () => {
    const shifts = await openShifts(ctx), mine = shifts.find((x) => x.user === s.user.id);
    if (!mine) return { ok: true as const, handed: [], to: null };
    const h = (await liveHall(ctx)).tables, busy = new Set((await openSessions(ctx)).map((x) => x.table)), open = mine.tables.filter((t) => busy.has(t));
    const who = to ? shifts.find((x) => x.user !== s.user.id && x.username === String(to)) : undefined;
    if (to && !who) invalid({ to: SHIFT_MSG.to }, SHIFT_MSG.to);
    const now = iso(ctx);
    if (who && open.length) { who.tables = [...new Set([...who.tables, ...open])]; who.updatedAt = now; await ctx.repo.put(COL.shifts, who); say(ctx, who); }
    mine.status = "closed"; mine.endedAt = now; mine.updatedAt = now; mine.handed = { to: who ? who.username : null, tables: open };
    await ctx.repo.put(COL.shifts, mine);
    await audit(ctx, s.user.username, "shift.end", s.user.username, { handed: nums(h, open), to: who ? who.username : null });
    say(ctx, { ...mine, tables: [] });
    return { ok: true as const, handed: nums(h, open), to: who ? who.username : null };
  });
}

export interface ShiftRow {
  user: string; username: string; name: string; since: Iso; tables: { id: string; n: number; zone: "salon" | "garden" }[];
  /** calls on his tables that nobody has taken yet; late: over the manager's minutes */
  waiting: number; late: number;
  /** the average time to "Отивам" (or to "Обслужено" without it) of the calls he answered today, in seconds; null: no data */
  avgSec: number | null; answered: number;
}
export interface WaiterShiftView { waiters: ShiftRow[]; /** tables in use that nobody on shift has */ unassigned: { id: string; n: number; zone: "salon" | "garden" }[]; settings: { callManager: number } }
/** The shift for the manager's module (the main admin, the owner, the manager). */
export async function shiftView(ctx: Ctx, s: StaffCtx): Promise<WaiterShiftView> {
  needFloor(s);
  if (!isBoss(s)) throw new CoreError("forbidden", RIGHTS_MSG.boss, 403);
  const h = (await liveHall(ctx)).tables.filter((t) => !t.off).sort((a, b) => a.n - b.n), shifts = await openShifts(ctx), st = await getSettings(ctx);
  const nowMs = nowDate(ctx).getTime(), today = sofiaYmd(nowDate(ctx));
  const all = await ctx.repo.list<TableSession>(COL.tableSessions);
  const taken = new Set(shifts.flatMap((x) => x.tables));
  return {
    waiters: shifts.map((sh) => {
      const mineOpen = all.filter((x) => x.status === "open" && sh.tables.includes(x.table)).flatMap((x) => x.calls.filter((c) => !c.done && !c.taken));
      /* answered today by this person: "Отивам", or "Обслужено" straight away */
      const times: number[] = [];
      for (const x of all) for (const c of x.calls) {
        if (sofiaYmd(new Date(c.at)) !== today) continue;
        const at = c.taken && c.taken.by === sh.username ? c.taken.at : !c.taken && c.done && c.done.how === "served" && !c.done.auto && c.done.by === sh.username ? c.done.at : null;
        if (at) times.push(Math.max(0, (Date.parse(at) - Date.parse(c.at)) / 1000));
      }
      return {
        user: sh.user, username: sh.username, name: sh.name, since: sh.startedAt, tables: h.filter((t) => sh.tables.includes(t.id)).map((t) => ({ id: t.id, n: t.n, zone: t.zone })),
        waiting: mineOpen.length, late: mineOpen.filter((c) => callLate(c, nowMs, st.callManager)).length,
        avgSec: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, answered: times.length,
      };
    }),
    unassigned: h.filter((t) => !taken.has(t.id)).map((t) => ({ id: t.id, n: t.n, zone: t.zone })),
    settings: { callManager: st.callManager },
  };
}
/** The manager changes a waiter's tables (ids or numbers). who: the waiter's username; to: the colleague who gets the
    tables taken from him (default: the first other waiter on shift; nobody on shift: they stay without a waiter). */
export async function shiftSetTables(ctx: Ctx, s: StaffCtx, who: string, tables: (string | number)[], to?: string | null): Promise<WaiterShiftView> {
  needFloor(s);
  if (!isBoss(s)) throw new CoreError("forbidden", RIGHTS_MSG.boss, 403);
  await serial(ctx.repo, LOCK, async () => {
    const h = (await liveHall(ctx)).tables, shifts = await openShifts(ctx), w = shifts.find((x) => x.username === String(who || "") || x.user === String(who || ""));
    if (!w) throw new CoreError("not_found", SHIFT_MSG.waiter, 404);
    const ids = tableIds(h, tables);
    if (!ids.length) { const msg = SHIFT_MSG.one(w.name); throw Object.assign(new CoreError("invalid", msg, 422), { fields: { tables: msg } }); }
    const others = shifts.filter((x) => x.user !== w.user);
    const other = to ? others.find((x) => x.username === String(to) || x.user === String(to)) : others[0];
    if (to && !other) invalid({ to: SHIFT_MSG.to }, SHIFT_MSG.to);
    const now = iso(ctx), dropped = w.tables.filter((t) => !ids.includes(t)), changedSh = new Set<WaiterShift>();
    for (const o of others) { const keep = o.tables.filter((t) => !ids.includes(t)); if (keep.length !== o.tables.length) { o.tables = keep; changedSh.add(o); } }
    if (other && dropped.length) { other.tables = [...new Set([...other.tables, ...dropped])]; changedSh.add(other); }
    w.tables = ids; changedSh.add(w);
    for (const x of changedSh) { x.updatedAt = now; await ctx.repo.put(COL.shifts, x); say(ctx, x); }
    await audit(ctx, s.user.username, "shift.tables", w.username, { tables: nums(h, ids), dropped: nums(h, dropped), to: other && dropped.length ? other.username : null });
  });
  return shiftView(ctx, s);
}
