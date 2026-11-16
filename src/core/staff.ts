/* Staff accounts, roles (MASTER-PROMPT-v2 8.1) and the role x section matrix the main admin edits. */
import { COL, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Role, type RoleId, type Session, type StaffUser } from "./types.ts";
import { audit } from "./audit.ts";

export const STAFF_SESSION_TTL_MS = 12 * 3600_000;

/** Admin sections (tiles on the dashboard). "Скоро" sections exist so the matrix is complete from day one.
    "settings" (14.11.2026): "Натоварено" and the minutes, the table hold, the celebration price. */
export const SECTIONS: [string, string][] = [
  ["dashboard", "Табло"], ["notes", "Бележки (молив)"], ["menu", "Меню"], ["lunch", "Обедно меню"], ["zones", "Зони за доставка"],
  ["offers", "Оферти и ваучери"], ["events", "Събития"], ["reservations", "Резервации"], ["hall", "Залата и масите"], ["qr", "QR генератор"],
  ["orders", "Поръчки"], ["customers", "Клиенти"], ["reports", "Отчети"], ["finance", "Финанси и гориво"], ["staff", "Персонал"],
  ["roles", "Роли и права"], ["audit", "Дневник"], ["waiter", "Сервитьор"], ["kitchen", "Кухня"], ["driver", "Шофьор"], ["site", "Клиентски сайт"],
  ["settings", "Настройки"],
];
export const ALL_SECTIONS = SECTIONS.map((s) => s[0]);
const ALL = ALL_SECTIONS;

/* the approved admin prototype (design/pages-admin/_admin.js, version 4): "Бележки" for the main admin, the owner, the manager
   and marketing; every role writes recommendations with the pencil (decision 15.11.2026), with or without the section */
export const DEFAULT_ROLES: Role[] = [
  { id: "admin", n: "Главен админ", desc: "Всичко; прави директни промени по сайта. Агенцията, която държи и ролята Маркетинг.", sections: ALL },
  { id: "owner", n: "Собственик", desc: "Всичко, включително финанси, гориво и отчети.", sections: ALL.filter((s) => s !== "roles") },
  { id: "manager", n: "Управител", desc: "Почти всичко като собственика: меню, цени, промоции, събития, резервации, персонал, отчети.", sections: ALL.filter((s) => !["roles", "finance", "audit"].includes(s)) },
  { id: "waiter", n: "Сервитьор", desc: "Повиквания, статус на масите, въвеждане на поръчки, потвърждаване на QR поръчки, сметки.", sections: ["dashboard", "waiter", "orders", "reservations"] },
  { id: "kitchen", n: "Кухня", desc: "Кухненски екран на своята секция с опашката от поръчки.", sections: ["dashboard", "kitchen"] },
  { id: "driver", n: "Шофьор", desc: "Своите доставки, навигация, статуси, зареждане с гориво, избор на автомобил.", sections: ["dashboard", "driver"] },
  { id: "marketing", n: "Маркетинг", desc: "Събития, поводи, оферти, снимки, текстове, SEO полета.", sections: ["dashboard", "notes", "offers", "events", "site"] },
];
export const ROLE_IDS = DEFAULT_ROLES.map((r) => r.id);
/** staff apps: after sign-in these roles go straight to their own module (decision 15.11.2026), never to the dashboard */
export const STAFF_APP: Partial<Record<RoleId, string>> = { waiter: "waiter", kitchen: "kitchen", driver: "driver" };

export async function roles(ctx: Ctx): Promise<Role[]> {
  const stored = await ctx.repo.list<Role>(COL.roles);
  /* "Табло" is never taken from a role (the start page after sign-in) */
  return DEFAULT_ROLES.map((d) => { const s = d.id !== "admin" && stored.find((x) => x.id === d.id); return s ? { ...d, sections: [...new Set(["dashboard", ...s.sections.filter((x) => ALL.includes(x))])] } : { ...d, sections: [...d.sections] }; });
}

export async function can(ctx: Ctx, role: RoleId, section: string): Promise<boolean> {
  if (role === "admin") return true; // the main admin can never lock himself out
  const r = (await roles(ctx)).find((x) => x.id === role);
  return !!r && r.sections.includes(section);
}

export type StaffCtx = { user: PublicStaff; sections: string[] };
/** The one permission check (server routes and the demo): a valid staff session, and one of `need` (any is enough).
    Without a session: 401 "auth"; without the section: 403 "forbidden". `adminOnly`: only the role admin (not given with roles). */
export async function guard(ctx: Ctx, token: string | null | undefined, need?: string | string[], adminOnly = false): Promise<StaffCtx> {
  const s = await staffBySession(ctx, token);
  if (!s) throw new CoreError("auth", "Влезте отново.", 401);
  const list = need ? (Array.isArray(need) ? need : [need]) : [];
  if (adminOnly && s.user.role !== "admin") throw new CoreError("forbidden", "Само главният админ може това.", 403);
  if (list.length && !(s.user.role === "admin" || list.some((x) => s.sections.includes(x)))) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
  return s;
}

/** where a role lands after sign-in: its staff app, or the dashboard */
export function homeOf(role: RoleId): string { return STAFF_APP[role] ? "app:" + STAFF_APP[role] : "dashboard"; }

export async function setRoleSections(ctx: Ctx, id: RoleId, sections: string[], actor: string): Promise<Role> {
  const base = (await roles(ctx)).find((r) => r.id === id);
  if (!base) throw new CoreError("not_found", "Няма такава роля.", 404);
  if (id === "admin") throw new CoreError("forbidden", "Правата на главния админ не се променят.", 403);
  const next = [...new Set(["dashboard", ...(Array.isArray(sections) ? sections : []).filter((s) => ALL.includes(s))])];
  const r: Role = { ...base, sections: ALL.filter((s) => next.includes(s)) };
  const added = r.sections.filter((s) => !base.sections.includes(s)), removed = base.sections.filter((s) => !r.sections.includes(s));
  await ctx.repo.put(COL.roles, r);
  if (added.length || removed.length) await audit(ctx, actor, "role.update", id, { added, removed, sections: r.sections });
  return r;
}

export async function upsertStaff(ctx: Ctx, u: { username: string; name: string; role: RoleId; password: string }): Promise<StaffUser> {
  if (!ctx.hasher) throw new Error("hasher missing");
  if (!u.password || u.password.length < 10) throw new CoreError("weak", "Паролата трябва да е поне 10 знака.");
  const existing = (await ctx.repo.list<StaffUser>(COL.staff, { username: u.username }))[0];
  const h = await ctx.hasher.hash(u.password);
  const doc: StaffUser = { id: existing ? existing.id : rid(8), username: u.username, name: u.name, role: u.role, ...h, active: true, createdAt: existing ? existing.createdAt : iso(ctx) };
  await ctx.repo.put(COL.staff, doc);
  return doc;
}

export type PublicStaff = Omit<StaffUser, "salt" | "hash" | "algo">;
export function publicStaff(u: StaffUser): PublicStaff { const { salt: _s, hash: _h, algo: _a, ...rest } = u; return rest; }

/* sign-in lockout (decision 15.11.2026): 10 wrong attempts per username in 15 minutes lock that username for 15 minutes;
   the address has a higher second limit (50: in the restaurant everyone signs in from one address, REVIEW-2 "За кода" 3).
   In the core, so the demo locks too. Every attempt is counted BEFORE the password check (no await on real I/O between
   reading and writing the counter), so parallel attempts cannot slip past the limit; a right password gives it back. */
export const LOGIN_MAX_FAILS = 10, LOGIN_MAX_FAILS_ADDR = 50, LOGIN_LOCK_MIN = 15, PASSWORD_MAX = 256;
type Fails = { id: string; n: number; first: number; until: number };
const LOCKED_MSG = "Твърде много опити. Опитайте след 15 минути.";
const queues = new WeakMap<object, Promise<unknown>>();
/** run fn after the previous fn on the same store finished (a tiny mutex) */
async function serial<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(ctx.repo) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  queues.set(ctx.repo, prev.then(() => mine));
  await prev.catch(() => undefined);
  try { return await fn(); } finally { release(); }
}
async function failsOf(ctx: Ctx, id: string): Promise<Fails> {
  const now = nowDate(ctx).getTime(), f = await ctx.repo.get<Fails>(COL.loginFails, id);
  return f && (f.until > now || f.first > now - LOGIN_LOCK_MIN * 60_000) ? f : { id, n: 0, first: now, until: 0 };
}

export async function staffLogin(ctx: Ctx, username: string, password: string, addr = "local"): Promise<{ token: string; user: PublicStaff; expiresAt: number; home: string }> {
  if (!ctx.hasher) throw new Error("hasher missing");
  const uname = String(username || "").trim().toLowerCase().slice(0, 64), now = nowDate(ctx).getTime();
  const pw = String(password || "").slice(0, PASSWORD_MAX);
  const keys: [string, number][] = [["u:" + uname, LOGIN_MAX_FAILS], ["a:" + String(addr || "local").slice(0, 80), LOGIN_MAX_FAILS_ADDR]];
  /* read, check and count in one step per store (the demo and the tests run attempts in parallel in one event loop) */
  const fails = await serial(ctx, async () => {
    const fs = await Promise.all(keys.map(([k]) => failsOf(ctx, k)));
    const lock = fs.find((f) => f.until > now);
    if (lock) throw Object.assign(new CoreError("throttled", LOCKED_MSG, 429), { retryIn: Math.max(1, Math.ceil((lock.until - now) / 1000)) });
    for (let i = 0; i < fs.length; i++) { const f = fs[i]; f.n += 1; if (f.n >= keys[i][1]) f.until = now + LOGIN_LOCK_MIN * 60_000; await ctx.repo.put(COL.loginFails, f); }
    return fs;
  });
  const u = (await ctx.repo.list<StaffUser>(COL.staff)).find((x) => x.username.toLowerCase() === uname);
  /* same message and similar time for "no such user" and "wrong password" */
  const ok = u && u.active ? await ctx.hasher.verify(pw, u.salt, u.hash, u.algo) : (await ctx.hasher.hash(pw || "x"), false);
  if (!u || !ok) {
    await audit(ctx, uname || "?", "staff.login_failed");
    const left = Math.min(...fails.map((f, i) => keys[i][1] - f.n));
    if (left <= 0) throw Object.assign(new CoreError("throttled", LOCKED_MSG, 429), { retryIn: LOGIN_LOCK_MIN * 60 });
    throw Object.assign(new CoreError("bad_login", "Грешен потребител или парола.", 401), left <= 3 ? { left } : {});
  }
  /* the right password: the username starts again, the address gets this attempt back */
  await ctx.repo.del(COL.loginFails, keys[0][0]);
  const fa = await failsOf(ctx, keys[1][0]);
  if (fa.n > 0) { fa.n -= 1; if (fa.n < LOGIN_MAX_FAILS_ADDR) fa.until = 0; await ctx.repo.put(COL.loginFails, fa); }
  const s: Session = { id: rid(24), kind: "staff", userId: u.id, role: u.role, expiresAt: now + STAFF_SESSION_TTL_MS, createdAt: iso(ctx) };
  await ctx.repo.put(COL.sessions, s);
  await audit(ctx, u.username, "staff.login");
  return { token: s.id, user: publicStaff(u), expiresAt: s.expiresAt, home: homeOf(u.role) };
}

export async function staffBySession(ctx: Ctx, token: string | null | undefined): Promise<{ user: PublicStaff; sections: string[] } | null> {
  if (!token) return null;
  const s = await ctx.repo.get<Session>(COL.sessions, token);
  if (!s || s.kind !== "staff" || s.expiresAt < nowDate(ctx).getTime()) return null;
  const u = await ctx.repo.get<StaffUser>(COL.staff, s.userId);
  if (!u || !u.active) return null;
  const r = (await roles(ctx)).find((x) => x.id === u.role);
  return { user: publicStaff(u), sections: u.role === "admin" ? [...ALL] : r ? r.sections : [] };
}

export async function staffLogout(ctx: Ctx, token: string): Promise<void> {
  const s = await staffBySession(ctx, token);
  await ctx.repo.del(COL.sessions, token);
  if (s) await audit(ctx, s.user.username, "staff.logout");
}

export async function listStaff(ctx: Ctx): Promise<PublicStaff[]> {
  return (await ctx.repo.list<StaffUser>(COL.staff)).map(publicStaff);
}
