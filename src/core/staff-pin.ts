/* Sign-in of the staff apps with the personal PIN (waiter, kitchen, driver), ONLY on a known device (core/device.ts: a
   device where somebody has already signed in with a password; decision of the chief, 17.11.2026, the safest variant).
   - the list: the active people of a module who have a PIN, with the public names from "Персонал" (never usernames);
   - waiter and driver: the person + 4 digits; kitchen: the PIN alone among the kitchen staff (the kitchen screen chooses
     a section, not a person; the PINs of the active staff are unique, staff-admin.ts);
   - wrong PINs: 5 in 15 minutes per person and device, 10 per person on all devices (the kitchen without a person: per
     device and for the kitchen as a whole), 20 per device whoever they were for -> 429 "throttled" with retryIn; the
     last 3 tries say how many are left;
     every try is counted BEFORE the check (one at a time per store), a right PIN gives the device its tries back;
   - the result is the normal staff session (staff.ts: the same token, the same 12 hours, the same rights);
   - the log: staff.pin_login / staff.pin_failed (never the PIN).
   The PIN hashes are made in "Персонал" (staff-admin.ts). The texts speak to the staff ("ти"). */
import { COL, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type RoleId, type Session, type StaffUser } from "./types.ts";
import { audit } from "./audit.ts";
import { knownDevice } from "./device.ts";
import { homeOf, publicStaff, STAFF_SESSION_TTL_MS, type PublicStaff } from "./staff.ts";
import { serial } from "./rights.ts";

export type PinModule = "waiter" | "kitchen" | "driver";
export const PIN_MODULES: PinModule[] = ["waiter", "kitchen", "driver"];
export const PIN_LOGIN_DEVICE = 5, PIN_LOGIN_PERSON = 10, PIN_LOGIN_LOCK_MIN = 15;
/** all wrong PINs of one device in the window, whoever they were for (so a device cannot try a few PINs on everybody) */
export const PIN_LOGIN_DEVICE_ALL = 20;
export const PIN_MSG = {
  device: "На това устройство първо влез с потребител и парола. После ПИН-ът работи тук.",
  module: "Няма такъв модул.",
  person: "Избери кой влиза.",
  bad: "Грешен ПИН. Опитай пак.",
  locked: "Твърде много грешни опити. Опитай след 15 минути или влез с парола.",
};

export interface PinPeople {
  /** false: an unknown device (the screen shows only the password form) */
  known: boolean; module: PinModule;
  /** kitchen: the PIN alone, no person to choose */
  pinOnly: boolean;
  people: { id: string; name: string }[];
}
const holders = async (ctx: Ctx, module: PinModule): Promise<StaffUser[]> =>
  (await ctx.repo.list<StaffUser>(COL.staff)).filter((u) => u.active && u.role === (module as RoleId) && !!u.pin).sort((a, b) => a.name.localeCompare(b.name, "bg"));
const modOf = (m: unknown): PinModule => { if (!PIN_MODULES.includes(m as PinModule)) throw new CoreError("invalid", PIN_MSG.module, 422); return m as PinModule; };

/** Who may sign in with a PIN here. An unknown device gets {known: false} and no names. */
export async function pinPeople(ctx: Ctx, device: string | null | undefined, module: PinModule): Promise<PinPeople> {
  const mod = modOf(module), dev = await knownDevice(ctx, device);
  if (!dev) return { known: false, module: mod, pinOnly: mod === "kitchen", people: [] };
  return { known: true, module: mod, pinOnly: mod === "kitchen", people: mod === "kitchen" ? [] : (await holders(ctx, mod)).map((u) => ({ id: u.id, name: u.name })) };
}

type Fails = { id: string; n: number; first: number; until: number };
async function failsOf(ctx: Ctx, id: string): Promise<Fails> {
  const now = nowDate(ctx).getTime(), f = await ctx.repo.get<Fails>(COL.loginFails, id);
  return f && (f.until > now || f.first > now - PIN_LOGIN_LOCK_MIN * 60_000) ? f : { id, n: 0, first: now, until: 0 };
}

/** Person + PIN (kitchen: the PIN alone). 403 "unknown_device", 401 "bad_pin" (+ left), 429 "throttled" (+ retryIn). */
export async function pinLogin(ctx: Ctx, device: string | null | undefined, p: { module: PinModule; user?: string; pin: string }): Promise<{ token: string; user: PublicStaff; expiresAt: number; home: string }> {
  if (!ctx.hasher) throw new Error("hasher missing");
  const q = p && typeof p === "object" ? p : ({} as { module: PinModule; user?: string; pin: string });
  const mod = modOf(q.module), dev = await knownDevice(ctx, device);
  if (!dev) throw new CoreError("unknown_device", PIN_MSG.device, 403);
  const pin = String(q.pin == null ? "" : q.pin), who = mod === "kitchen" ? "" : String(q.user || "");
  if (mod !== "kitchen" && !who) throw Object.assign(new CoreError("invalid", PIN_MSG.person, 422), { fields: { user: PIN_MSG.person } });
  const now = nowDate(ctx).getTime(), subject = mod === "kitchen" ? "kitchen" : who.slice(0, 64);
  const keys: [string, number][] = [["pin:" + subject + ":" + dev, PIN_LOGIN_DEVICE], ["pin:" + subject, PIN_LOGIN_PERSON], ["pin-dev:" + dev, PIN_LOGIN_DEVICE_ALL]];
  const fs = await serial(ctx.repo, "pin-login", async () => {
    const list = await Promise.all(keys.map(([k]) => failsOf(ctx, k)));
    const lock = list.find((f) => f.until > now);
    if (lock) throw Object.assign(new CoreError("throttled", PIN_MSG.locked, 429), { retryIn: Math.max(1, Math.ceil((lock.until - now) / 1000)) });
    for (let i = 0; i < list.length; i++) { const f = list[i]; f.n += 1; if (f.n >= keys[i][1]) f.until = now + PIN_LOGIN_LOCK_MIN * 60_000; await ctx.repo.put(COL.loginFails, f); }
    return list;
  });
  const cand = /^\d{4}$/.test(pin) ? (await holders(ctx, mod)).filter((u) => mod === "kitchen" || u.id === who) : [];
  let u: StaffUser | null = null;
  for (const x of cand) if (x.pin && (await ctx.hasher.verify(pin, x.pin.salt, x.pin.hash, x.pin.algo))) { u = x; break; }
  /* a similar time when there is nobody to check (an unknown person, a person without a PIN) */
  if (!cand.length) await ctx.hasher.hash(pin || "x");
  if (!u) {
    await audit(ctx, mod === "kitchen" ? "kitchen" : (cand[0] ? cand[0].username : "?"), "staff.pin_failed", mod);
    const left = Math.min(...fs.map((f, i) => keys[i][1] - f.n));
    if (left <= 0) throw Object.assign(new CoreError("throttled", PIN_MSG.locked, 429), { retryIn: PIN_LOGIN_LOCK_MIN * 60 });
    throw Object.assign(new CoreError("bad_pin", PIN_MSG.bad, 401), left <= 3 ? { left } : {});
  }
  /* the right PIN: this device starts again; the person keeps the wrong tries of the other devices but gets this one back */
  await ctx.repo.del(COL.loginFails, keys[0][0]);
  for (const i of [1, 2]) {
    const fp = await failsOf(ctx, keys[i][0]);
    if (fp.n > 0) { fp.n -= 1; if (fp.n < keys[i][1]) fp.until = 0; await ctx.repo.put(COL.loginFails, fp); }
  }
  const s: Session = { id: rid(24), kind: "staff", userId: u.id, role: u.role, expiresAt: now + STAFF_SESSION_TTL_MS, createdAt: iso(ctx) };
  await ctx.repo.put(COL.sessions, s);
  u.lastLoginAt = iso(ctx);
  await ctx.repo.put(COL.staff, u);
  await audit(ctx, u.username, "staff.pin_login", mod);
  return { token: s.id, user: publicStaff(u), expiresAt: s.expiresAt, home: homeOf(u.role) };
}
