/* Staff in the admin (section "Персонал"; design/pages-admin/staff.html, README-3, REVIEW-2 "За кода" 4 and 8):
   - users: create (username in Latin, unique; name; role; password of at least 10 characters), name and role, active
     (deactivating closes the person's sessions), the password (closes the other sessions); passwords and PINs never go
     into the log, only that they changed;
   - who manages whom: the main admin everyone; the others (with the section) only lower roles (owner > manager >
     marketing, waiter, kitchen, driver), never themselves (except their own password), never the last active main admin;
   - the PIN of the staff apps (waiter, kitchen, driver; OPEN-QUESTIONS: "ПИН кодове се задават в админа"):
     4 digits, never shown again (only a salted hash, ctx.hasher); without a PIN in the request the core makes a random
     one (crypto) and returns it ONCE. Uniqueness without giving away someone else's PIN: the core checks the new PIN
     against the hashes of the other active PIN holders and refuses a taken one with the same words as an easy one
     ("Изберете друг ПИН."), and refused choices are limited (5 in 15 minutes per person who sets them, then 429), so the
     check cannot be used to search for a colleague's PIN; the random PIN is always free. A PIN is set only by someone who
     already manages that person (who could set a new one anyway). Sign-in with a PIN (etap D) will be person + PIN with
     its own attempt limit per device. */
import { audit } from "./audit.ts";
import { COL, iso, nowDate, randomDigits, rid, type Ctx } from "./ctx.ts";
import { CoreError, type RoleId, type Session, type StaffUser } from "./types.ts";
import { ROLE_IDS, DEFAULT_ROLES, publicStaff, PASSWORD_MAX, type StaffCtx, type PublicStaff } from "./staff.ts";
import { need, invalid, serial } from "./rights.ts";

export const RANK: Record<RoleId, number> = { admin: 0, owner: 1, manager: 2, marketing: 3, waiter: 3, kitchen: 3, driver: 3 };
export const PIN_ROLES: RoleId[] = ["waiter", "kitchen", "driver"];
export const PIN_REFUSED_MAX = 5, PIN_REFUSED_MIN = 15;
export const STAFF_MSG = {
  notFound: "Няма такъв служител.",
  manage: "Не можете да управлявате този служител.",
  self: "Не можете да деактивирате себе си.",
  lastAdmin: "Трябва да остане поне един активен главен админ.",
  username: "Потребителят е от 3 до 32 малки латински букви, цифри, точка, тире или долна черта.",
  taken: "Този потребител вече съществува.",
  name: "Напишете име (до 80 знака).",
  role: "Изберете роля.",
  weak: "Паролата трябва да е поне 10 знака.",
  pinRole: "ПИН имат само сервитьор, кухня и шофьор.",
  pinFormat: "ПИН-ът е от 4 цифри.",
  pinOther: "Изберете друг ПИН.",
  pinTries: "Твърде много отказани ПИН-ове. Изберете „Случаен ПИН“ или опитайте след 15 минути.",
};

export interface StaffRow extends Omit<PublicStaff, "lastLoginAt"> { pin: "set" | "none" | "n/a"; lastLoginAt: string | null; canManage: boolean; self: boolean }
const rowOf = (u: StaffUser, s: StaffCtx): StaffRow => {
  return { ...publicStaff(u), pin: PIN_ROLES.includes(u.role) ? (u.pin ? "set" : "none") : "n/a", lastLoginAt: u.lastLoginAt || null, canManage: manages(s, u.role, u.id), self: u.id === s.user.id };
};
/** may s manage a person of this role (another person; for a new user: the role he gets) */
export function manages(s: StaffCtx, role: RoleId, id?: string): boolean {
  if (id && id === s.user.id) return false;
  if (s.user.role === "admin") return true;
  return RANK[role] > RANK[s.user.role];
}
function needManage(s: StaffCtx, role: RoleId, id?: string) {
  if (id && id === s.user.id) throw new CoreError("forbidden", STAFF_MSG.manage, 403);
  if (!manages(s, role, id)) throw new CoreError("forbidden", STAFF_MSG.manage, 403);
}
async function getU(ctx: Ctx, id: string): Promise<StaffUser> {
  const u = await ctx.repo.get<StaffUser>(COL.staff, String(id || ""));
  if (!u) throw new CoreError("not_found", STAFF_MSG.notFound, 404);
  return u;
}
async function closeSessions(ctx: Ctx, userId: string, keep?: string) {
  for (const x of await ctx.repo.list<Session>(COL.sessions, { userId })) if (x.kind === "staff" && x.id !== keep) await ctx.repo.del(COL.sessions, x.id);
}
const activeAdmins = async (ctx: Ctx) => (await ctx.repo.list<StaffUser>(COL.staff)).filter((u) => u.role === "admin" && u.active);

export async function staffList(ctx: Ctx, s: StaffCtx): Promise<{ rows: StaffRow[]; roles: { id: RoleId; n: string; desc: string; manageable: boolean }[]; stats: { active: number; inactive: number; apps: number; noPin: number } }> {
  need(s, "staff");
  const all = (await ctx.repo.list<StaffUser>(COL.staff)).sort((a, b) => RANK[a.role] - RANK[b.role] || a.name.localeCompare(b.name, "bg"));
  return {
    rows: all.map((u) => rowOf(u, s)),
    roles: DEFAULT_ROLES.map((r) => ({ id: r.id, n: r.n, desc: r.desc, manageable: manages(s, r.id) })),
    stats: { active: all.filter((u) => u.active).length, inactive: all.filter((u) => !u.active).length, apps: all.filter((u) => u.active && PIN_ROLES.includes(u.role)).length, noPin: all.filter((u) => u.active && PIN_ROLES.includes(u.role) && !u.pin).length },
  };
}

/** "Нов потребител". pin: optional for the staff apps ("" = a random one). Log: staff.create (no password, no PIN). */
export async function staffCreate(ctx: Ctx, s: StaffCtx, p: { username: string; name: string; role: RoleId; password: string; pin?: string | null }): Promise<StaffRow & { pin_once?: string }> {
  need(s, "staff");
  if (!ctx.hasher) throw new Error("hasher missing");
  const q = p && typeof p === "object" ? p : ({} as typeof p);
  const f: Record<string, string> = {};
  const username = String(q.username || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) f.username = STAFF_MSG.username;
  const name = String(q.name || "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) f.name = STAFF_MSG.name;
  if (!ROLE_IDS.includes(q.role)) f.role = STAFF_MSG.role;
  const pw = String(q.password || "");
  if (pw.length < 10 || pw.length > PASSWORD_MAX) f.password = STAFF_MSG.weak;
  if (Object.keys(f).length) invalid(f);
  needManage(s, q.role);
  return serial(ctx.repo, "staff", async () => {
    if ((await ctx.repo.list<StaffUser>(COL.staff)).some((u) => u.username.toLowerCase() === username)) invalid({ username: STAFF_MSG.taken });
    const u: StaffUser = { id: rid(8), username, name, role: q.role, ...(await ctx.hasher!.hash(pw)), active: true, createdAt: iso(ctx) };
    await ctx.repo.put(COL.staff, u);
    await audit(ctx, s.user.username, "staff.create", u.username, { role: u.role, name: u.name });
    let once: string | undefined;
    if (q.pin != null && PIN_ROLES.includes(u.role)) once = (await setPinFor(ctx, s, u, q.pin === "" ? undefined : String(q.pin))).pin;
    return { ...rowOf((await ctx.repo.get<StaffUser>(COL.staff, u.id))!, s), ...(once ? { pin_once: once } : {}) };
  });
}

/** "Име и роля". Both the old and the new role must be manageable. Log: staff.update. */
export async function staffUpdate(ctx: Ctx, s: StaffCtx, id: string, p: { name?: string; role?: RoleId }): Promise<StaffRow> {
  need(s, "staff");
  const u = await getU(ctx, id);
  needManage(s, u.role, u.id);
  const q = p && typeof p === "object" ? p : {};
  const f: Record<string, string> = {};
  const name = q.name === undefined ? u.name : String(q.name).replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) f.name = STAFF_MSG.name;
  const role = q.role === undefined ? u.role : q.role;
  if (!ROLE_IDS.includes(role)) f.role = STAFF_MSG.role;
  if (Object.keys(f).length) invalid(f);
  needManage(s, role);
  if (u.role === "admin" && role !== "admin" && u.active && (await activeAdmins(ctx)).length <= 1) throw new CoreError("last_admin", STAFF_MSG.lastAdmin, 409);
  const changes = { ...(name !== u.name ? { name: [u.name, name] } : {}), ...(role !== u.role ? { role: [u.role, role] } : {}) };
  u.name = name; u.role = role; u.updatedAt = iso(ctx);
  if (!PIN_ROLES.includes(role)) u.pin = null; /* a PIN only for the staff apps */
  await ctx.repo.put(COL.staff, u);
  if (changes.role) await closeSessions(ctx, u.id); /* the new rights from the next sign-in */
  if (Object.keys(changes).length) await audit(ctx, s.user.username, "staff.update", u.username, changes);
  return rowOf(u, s);
}

/** "Активен" on / off: never oneself, never the last active main admin; off closes the sessions. Log: staff.active. */
export async function staffSetActive(ctx: Ctx, s: StaffCtx, id: string, active: boolean): Promise<StaffRow> {
  need(s, "staff");
  const u = await getU(ctx, id);
  if (u.id === s.user.id) throw new CoreError("forbidden", STAFF_MSG.self, 403);
  needManage(s, u.role, u.id);
  if (!active && u.role === "admin" && u.active && (await activeAdmins(ctx)).length <= 1) throw new CoreError("last_admin", STAFF_MSG.lastAdmin, 409);
  if (u.active !== (active === true)) {
    u.active = active === true; u.updatedAt = iso(ctx);
    await ctx.repo.put(COL.staff, u);
    if (!u.active) await closeSessions(ctx, u.id);
    await audit(ctx, s.user.username, "staff.active", u.username, { active: u.active });
  }
  return rowOf(u, s);
}

/** "Смени паролата": one's own (the section is enough, the other sessions close) or a managed person's (all his
    sessions close). Log: staff.password (never the password). */
export async function staffSetPassword(ctx: Ctx, s: StaffCtx, id: string, password: string, keepSession?: string): Promise<{ ok: true }> {
  if (!ctx.hasher) throw new Error("hasher missing");
  const self = id === s.user.id;
  if (!self) need(s, "staff");
  else if (!s || !s.user) throw new CoreError("auth", "Влезте отново.", 401);
  const u = await getU(ctx, id);
  if (!self) needManage(s, u.role, u.id);
  const pw = String(password || "");
  if (pw.length < 10 || pw.length > PASSWORD_MAX) invalid({ password: STAFF_MSG.weak });
  Object.assign(u, await ctx.hasher.hash(pw), { updatedAt: iso(ctx) });
  await ctx.repo.put(COL.staff, u);
  await closeSessions(ctx, u.id, self ? keepSession : undefined);
  await audit(ctx, s.user.username, "staff.password", u.username, { self });
  return { ok: true };
}

/* ---------- the PIN ---------- */
const EASY = (p: string) => /^(\d)\1{3}$/.test(p) || "0123456789".includes(p) || "9876543210".includes(p) || ["1212", "1122", "2580", "0852", "1004", "2000", "2020", "2026", "6969"].includes(p);
async function taken(ctx: Ctx, pin: string, except: string): Promise<boolean> {
  for (const u of await ctx.repo.list<StaffUser>(COL.staff)) if (u.id !== except && u.active && u.pin && (await ctx.hasher!.verify(pin, u.pin.salt, u.pin.hash, u.pin.algo))) return true;
  return false;
}
type Refused = { id: string; n: number; first: number; until: number };
async function setPinFor(ctx: Ctx, s: StaffCtx, u: StaffUser, pin?: string): Promise<{ pin: string; at: string }> {
  if (!PIN_ROLES.includes(u.role)) invalid({ pin: STAFF_MSG.pinRole }, STAFF_MSG.pinRole);
  let p = pin == null ? "" : String(pin);
  if (p) {
    if (!/^\d{4}$/.test(p)) invalid({ pin: STAFF_MSG.pinFormat }, STAFF_MSG.pinFormat);
    const key = "pin-set:" + s.user.id, now = nowDate(ctx).getTime();
    const r0 = await ctx.repo.get<Refused>(COL.loginFails, key);
    const r = r0 && (r0.until > now || r0.first > now - PIN_REFUSED_MIN * 60_000) ? r0 : { id: key, n: 0, first: now, until: 0 };
    if (r.until > now) throw Object.assign(new CoreError("throttled", STAFF_MSG.pinTries, 429), { retryIn: Math.ceil((r.until - now) / 1000) });
    if (EASY(p) || (await taken(ctx, p, u.id))) {
      r.n += 1; if (r.n >= PIN_REFUSED_MAX) r.until = now + PIN_REFUSED_MIN * 60_000;
      await ctx.repo.put(COL.loginFails, r);
      invalid({ pin: STAFF_MSG.pinOther }, STAFF_MSG.pinOther);
    }
  } else {
    for (let i = 0; i < 200 && (!p || EASY(p) || (await taken(ctx, p, u.id))); i++) p = randomDigits(4);
  }
  const at = iso(ctx);
  u.pin = { ...(await ctx.hasher!.hash(p)), at }; u.updatedAt = at;
  await ctx.repo.put(COL.staff, u);
  await audit(ctx, s.user.username, "staff.pin", u.username, { random: !pin });
  return { pin: p, at };
}
/** "ПИН": a chosen one (4 digits, not easy, not taken: "Изберете друг ПИН.") or a random one; returns it ONCE. */
export async function staffSetPin(ctx: Ctx, s: StaffCtx, id: string, pin?: string | null): Promise<{ pin: string; at: string }> {
  need(s, "staff");
  if (!ctx.hasher) throw new Error("hasher missing");
  const u = await getU(ctx, id);
  needManage(s, u.role, u.id);
  return serial(ctx.repo, "staff-pin", () => setPinFor(ctx, s, u, pin == null || pin === "" ? undefined : String(pin)));
}
/** "Махни ПИН". Log: staff.pin_remove. */
export async function staffRemovePin(ctx: Ctx, s: StaffCtx, id: string): Promise<StaffRow> {
  need(s, "staff");
  const u = await getU(ctx, id);
  needManage(s, u.role, u.id);
  if (u.pin) { u.pin = null; u.updatedAt = iso(ctx); await ctx.repo.put(COL.staff, u); await audit(ctx, s.user.username, "staff.pin_remove", u.username); }
  return rowOf(u, s);
}
