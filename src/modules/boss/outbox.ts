/* What the manager's and the owner's modules keep on the phone without a connection (decision 18.11.2026, the waiter's
   rule, src/modules/servitor/bits.ts): every kept action belongs to ONE person and ONE shift day (Sofia, from 04:00,
   src/lib/shift-day.ts) and goes by itself only for that person, on that day and within 2 hours. Anything older stays
   for the person to look at (never sent by itself); another person's actions are never sent and never shown; "Изход"
   asks and removes the person's own. One key per module ("up-outbox", "own-outbox"). */
import { shiftDay as dayOf } from "../../lib/shift-day.ts";

export const STALE_MS = 2 * 3600_000;
export const BOXES = ["up-outbox", "own-outbox"];
export interface Kept { op: string; args: unknown[]; label: string; at: number; user: string; day: string }
const shiftDay = (t = Date.now()) => dayOf(new Date(t));
const read = (key: string): Kept[] => { try { const v = JSON.parse(localStorage.getItem(key) || "[]"); return Array.isArray(v) ? v.filter((x) => x && typeof x.op === "string") : []; } catch { return []; } };
const write = (key: string, l: Kept[]) => { try { if (l.length) localStorage.setItem(key, JSON.stringify(l)); else localStorage.removeItem(key); } catch { /* private mode */ } };
/** may it still go by itself: the same shift day, within 2 hours */
export const fresh = (k: Pick<Kept, "at">) => shiftDay(k.at) === shiftDay() && Date.now() - k.at <= STALE_MS;

export function outbox(key: string, user: () => string) {
  return {
    /** keep an action of this person */
    keep(op: string, args: unknown[], label: string) { const at = Date.now(); write(key, [...read(key), { op, args, label, at, user: user(), day: shiftDay(at) }]); },
    /** this person's actions that may still go (taken out of the box; give back the ones that did not go) */
    take(): Kept[] { const all = read(key), me = user(), go = all.filter((k) => k.user === me && fresh(k)); write(key, all.filter((k) => !go.includes(k))); return go; },
    back(k: Kept) { write(key, [...read(key), k]); },
    /** this person's actions that will never go by themselves (another day, over 2 hours) */
    stale(): Kept[] { const me = user(); return read(key).filter((k) => k.user === me && !fresh(k)); },
    /** is this action of this person waiting (the row says "Записано на телефона") */
    has(op: string, first: string): boolean { const me = user(); return read(key).some((k) => k.user === me && fresh(k) && k.op === op && String(k.args[0]) === first); },
    /** remove this person's actions (all of them, or only the old ones) */
    drop(onlyStale = false) { const me = user(); write(key, read(key).filter((k) => k.user !== me || (onlyStale && fresh(k)))); },
  };
}
/** how many actions of this person wait in any box of the two modules ("Изход" asks) */
export const keptCount = (user: string): number => BOXES.reduce((n, k) => n + read(k).filter((x) => x.user === user).length, 0);
export const dropAll = (user: string) => { for (const k of BOXES) write(k, read(k).filter((x) => x.user !== user)); };
