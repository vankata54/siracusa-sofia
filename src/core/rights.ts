/* The rights of the admin sections of part 3 (decision 16.11.2026: the rights are in the core): every core function of a
   section takes the signed-in staff member (StaffCtx from staff.guard) and checks here, so the server routes and the demo
   (api-admin-3.ts) allow exactly the same. The main admin always passes (he can never lock himself out). */
import { CoreError } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
/** "0888 •• •• 56": the phone in every list of the admin (the whole number only on purpose, into the log) */
export function maskPhone(p: string): string {
  let d = String(p || "").replace(/\D/g, "");
  if (d.startsWith("359")) d = "0" + d.slice(3);
  return d.length === 10 ? d.slice(0, 4) + " •• •• " + d.slice(8) : d ? "•• " + d.slice(-2) : "";
}

export const RIGHTS_MSG = {
  auth: "Влезте отново.",
  forbidden: "Нямате права за този раздел.",
  boss: "Само главният админ, собственикът и управителят могат това.",
};

/** any of the sections is enough */
export function may(s: StaffCtx | null | undefined, sec: string | string[]): boolean {
  if (!s || !s.user) return false;
  if (s.user.role === "admin") return true;
  return (Array.isArray(sec) ? sec : [sec]).some((x) => s.sections.includes(x));
}
/** 401 without a session, 403 without one of the sections */
export function need(s: StaffCtx | null | undefined, sec: string | string[]): StaffCtx {
  if (!s || !s.user) throw new CoreError("auth", RIGHTS_MSG.auth, 401);
  if (!may(s, sec)) throw new CoreError("forbidden", RIGHTS_MSG.forbidden, 403);
  return s;
}
/** the main admin, the owner and the manager (by role, with the section): phone orders, blocking no-shows */
export const BOSS_ROLES = ["admin", "owner", "manager"];
export function isBoss(s: StaffCtx): boolean { return BOSS_ROLES.includes(s.user.role); }
export function needBoss(s: StaffCtx | null | undefined, sec: string | string[]): StaffCtx {
  need(s, sec);
  if (!isBoss(s!)) throw new CoreError("forbidden", RIGHTS_MSG.boss, 403);
  return s!;
}

/** "i•••@abv.bg" */
export function maskEmail(e?: string | null): string {
  const m = /^([^@]{0,1})[^@]*(@.+)$/.exec(String(e || ""));
  return m ? m[1] + "•••" + m[2] : "";
}

/** messages from the site with the contact masked (a phone or an e-mail) */
export function maskFeedback<T extends { contact: string; mode: "phone" | "email" }>(l: T[]): T[] {
  return l.map((f) => ({ ...f, contact: f.mode === "email" ? maskEmail(f.contact) : maskPhone(f.contact) }));
}

/** orders / reservations for a raw list: the phone and e-mail masked, never the secret key */
export function maskList<T extends { phone: string; email?: string; key?: string }>(l: T[]): T[] {
  return l.map((x) => { const { key: _k, ...r } = x; return { ...r, phone: maskPhone(x.phone), ...(x.email ? { email: maskEmail(x.email) } : {}) } as T; });
}

export function invalid(fields: Record<string, string>, message = "Проверете полетата."): never {
  throw Object.assign(new CoreError("invalid", message, 422), { fields });
}

/* one write at a time per store and section (the demo and the tests run calls in parallel in one event loop) */
const locks = new WeakMap<object, Map<string, Promise<unknown>>>();
export async function serial<T>(repo: object, key: string, fn: () => Promise<T>): Promise<T> {
  let m = locks.get(repo);
  if (!m) { m = new Map(); locks.set(repo, m); }
  const prev = m.get(key) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  m.set(key, prev.then(() => mine));
  await prev.catch(() => undefined);
  try { return await fn(); } finally { release(); }
}

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const toMin = (t: string): number => +t.slice(0, 2) * 60 + +t.slice(3);
export const round2 = (n: number): number => Math.round(n * 100) / 100;
/** a number from the screen: 10,22 / "10.22" / 10.22 -> 10.22; "" / null -> null; anything else NaN */
export function money(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  return /^\d{1,4}(\.\d{1,2})?$/.test(s) ? +s : NaN;
}
