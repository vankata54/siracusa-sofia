/* Staff accounts, roles (MASTER-PROMPT-v2 8.1) and the role x section matrix the main admin edits. */
import { COL, iso, nowDate, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Role, type RoleId, type Session, type StaffUser } from "./types.ts";
import { audit } from "./audit.ts";

export const STAFF_SESSION_TTL_MS = 12 * 3600_000;

/** Admin sections (tiles on the dashboard). "Скоро" sections exist so the matrix is complete from day one. */
export const SECTIONS: [string, string][] = [
  ["dashboard", "Табло"], ["notes", "Бележки (молив)"], ["menu", "Меню"], ["lunch", "Обедно меню"], ["zones", "Зони за доставка"],
  ["offers", "Оферти и ваучери"], ["events", "Събития"], ["reservations", "Резервации"], ["hall", "Залата и масите"], ["qr", "QR генератор"],
  ["orders", "Поръчки"], ["customers", "Клиенти"], ["reports", "Отчети"], ["finance", "Финанси и гориво"], ["staff", "Персонал"],
  ["roles", "Роли и права"], ["audit", "Дневник"], ["waiter", "Сервитьор"], ["kitchen", "Кухня"], ["driver", "Шофьор"], ["site", "Клиентски сайт"],
];
const ALL = SECTIONS.map((s) => s[0]);

export const DEFAULT_ROLES: Role[] = [
  { id: "admin", n: "Главен админ", desc: "Всичко; прави директни промени по сайта. Агенцията, която държи и ролята Маркетинг.", sections: ALL },
  { id: "owner", n: "Собственик", desc: "Всичко, включително финанси, гориво и отчети.", sections: ALL.filter((s) => s !== "roles") },
  { id: "manager", n: "Управител", desc: "Почти всичко като собственика: меню, цени, промоции, събития, резервации, персонал, отчети.", sections: ALL.filter((s) => !["roles", "finance", "audit"].includes(s)) },
  { id: "waiter", n: "Сервитьор", desc: "Повиквания, статус на масите, въвеждане на поръчки, потвърждаване на QR поръчки, сметки.", sections: ["dashboard", "waiter", "orders", "reservations", "site"] },
  { id: "kitchen", n: "Кухня", desc: "Кухненски екран на своята секция с опашката от поръчки.", sections: ["dashboard", "kitchen"] },
  { id: "driver", n: "Шофьор", desc: "Своите доставки, навигация, статуси, зареждане с гориво, избор на автомобил.", sections: ["dashboard", "driver"] },
  { id: "marketing", n: "Маркетинг", desc: "Събития, поводи, оферти, снимки, текстове, SEO полета.", sections: ["dashboard", "notes", "offers", "events", "site"] },
];

export async function roles(ctx: Ctx): Promise<Role[]> {
  const stored = await ctx.repo.list<Role>(COL.roles);
  return DEFAULT_ROLES.map((d) => stored.find((s) => s.id === d.id) || d);
}

export async function can(ctx: Ctx, role: RoleId, section: string): Promise<boolean> {
  if (role === "admin") return true; // the main admin can never lock himself out
  const r = (await roles(ctx)).find((x) => x.id === role);
  return !!r && r.sections.includes(section);
}

export async function setRoleSections(ctx: Ctx, id: RoleId, sections: string[], actor: string): Promise<Role> {
  const base = (await roles(ctx)).find((r) => r.id === id);
  if (!base) throw new CoreError("not_found", "Няма такава роля.", 404);
  if (id === "admin") throw new CoreError("forbidden", "Правата на главния админ не се променят.", 403);
  const r: Role = { ...base, sections: sections.filter((s) => ALL.includes(s)) };
  await ctx.repo.put(COL.roles, r);
  await audit(ctx, actor, "role.update", id, { sections: r.sections });
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

export async function staffLogin(ctx: Ctx, username: string, password: string): Promise<{ token: string; user: PublicStaff; expiresAt: number }> {
  if (!ctx.hasher) throw new Error("hasher missing");
  const u = (await ctx.repo.list<StaffUser>(COL.staff, { username: String(username || "").trim() }))[0];
  /* same message and similar time for "no such user" and "wrong password" */
  const ok = u && u.active ? await ctx.hasher.verify(String(password || ""), u.salt, u.hash, u.algo) : (await ctx.hasher.hash(String(password || "x")), false);
  if (!u || !ok) {
    await audit(ctx, String(username || "?"), "staff.login_failed");
    throw new CoreError("bad_login", "Грешен потребител или парола.", 401);
  }
  const s: Session = { id: rid(24), kind: "staff", userId: u.id, role: u.role, expiresAt: nowDate(ctx).getTime() + STAFF_SESSION_TTL_MS, createdAt: iso(ctx) };
  await ctx.repo.put(COL.sessions, s);
  await audit(ctx, u.username, "staff.login");
  return { token: s.id, user: publicStaff(u), expiresAt: s.expiresAt };
}

export async function staffBySession(ctx: Ctx, token: string | null | undefined): Promise<{ user: PublicStaff; sections: string[] } | null> {
  if (!token) return null;
  const s = await ctx.repo.get<Session>(COL.sessions, token);
  if (!s || s.kind !== "staff" || s.expiresAt < nowDate(ctx).getTime()) return null;
  const u = await ctx.repo.get<StaffUser>(COL.staff, s.userId);
  if (!u || !u.active) return null;
  const r = (await roles(ctx)).find((x) => x.id === u.role);
  return { user: publicStaff(u), sections: u.role === "admin" ? ALL : r ? r.sections : [] };
}

export async function staffLogout(ctx: Ctx, token: string): Promise<void> { await ctx.repo.del(COL.sessions, token); }

export async function listStaff(ctx: Ctx): Promise<PublicStaff[]> {
  return (await ctx.repo.list<StaffUser>(COL.staff)).map(publicStaff);
}
