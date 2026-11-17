/* "Къде продължаваш?" (decision 16.11.2026, step 5): after the sign-in the manager and the owner choose their module or the
   admin; the choice may be remembered ON THIS DEVICE (localStorage "sa-home" = {<username>: "app" | "admin"}, the key of
   the approved prototype; never on the server). A remembered choice follows where the person goes: "Към админа" in the
   module, "Отвори приложението" in the admin (switchHome). Without a remembered choice nothing is written.
   No DOM here except localStorage: used by the sign-in (src/admin/login.ts), the dashboard and the frame of the modules. */
import { aurl, BOSS_HOME, BOSS_ROLES, STAFF_APPS } from "../../admin/routes.ts";
import { murl } from "../routes.ts";

export type HomeChoice = "app" | "admin";
export type BossModule = "upravitel" | "sobstvenik";
const KEY = "sa-home";

function read(): Record<string, string> {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}
/** the remembered choice of this user on this device, or null ("ask every time") */
export function homeChoice(username: string): HomeChoice | null { const v = read()[username]; return v === "app" || v === "admin" ? v : null; }
/** remember (or forget, with null) the choice of this user on this device */
export function setHomeChoice(username: string, v: HomeChoice | null): void {
  if (!username) return;
  const h = read(); if (v) h[username] = v; else delete h[username];
  try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* private mode: asked every time */ }
}
/** "Към админа" / "Отвори приложението": a remembered choice follows the person; nothing is remembered by itself */
export function switchHome(username: string, v: HomeChoice): void { const c = homeChoice(username); if (c && c !== v) setHomeChoice(username, v); }

/** the own module of a role ("upravitel" for the manager, "sobstvenik" for the owner), or null */
export const bossModuleOf = (role: string): BossModule | null => BOSS_HOME[role] || null;
/** may the role open the module (the owner opens both, the main admin too) */
export const bossAllowed = (module: BossModule, role: string): boolean => BOSS_ROLES[module].includes(role);
/** the first screen of a module */
export const bossHref = (module: BossModule, hash?: string): string => (module === "upravitel" ? murl.upravitel("", hash) : murl.sobstvenik("", hash));

/** where a role belongs when it may not open a page: the staff in their app, the manager and the owner by their remembered
    choice (the module only when it is remembered, as in the prototype), everyone else in the dashboard */
export function homeHref(role: string, username: string): string {
  if (STAFF_APPS[role]) return aurl.app(role);
  const m = bossModuleOf(role);
  return m && homeChoice(username) === "app" ? bossHref(m) : aurl.home();
}
/** may the role be sent to this logical address after the sign-in (#next=)? `sections`: what the role sees */
export function mayOpen(logical: string, role: string, sections: string[]): boolean {
  if (!aurl.fromLogical(logical)) return false;
  const key = aurl.keyOf(logical);
  if (key === "upravitel" || key === "sobstvenik") return bossAllowed(key, role);
  /* a staff member works only in the own module (decision 15.11.2026) */
  if (STAFF_APPS[role]) return key === role;
  return role === "admin" || key === "dashboard" || key === "preview" || sections.includes(key);
}
