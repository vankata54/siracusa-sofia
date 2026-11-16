/* Who may change which setting (server and demo, no other import: the admin bundle loads it without the core). */
import { CoreError } from "./types.ts";
import type { SettingsPatch } from "./settings.ts";

/** Who may change what (server and demo): "Настройки" everything; without it the kitchen its "Натоварено" and minutes,
    "Резервации" the table hold, "Оферти и ваучери" the celebration price and the early days. 403 otherwise. */
export function settingsAllowed(s: { user: { role: string }; sections: string[] }, p: SettingsPatch): void {
  const has = (x: string) => s.user.role === "admin" || s.sections.includes("settings") || s.sections.includes(x);
  const any = p.kitchen != null || p.resMinutes != null || p.celebrationPrice != null || p.earlyDays !== undefined || p.noShowLimit != null || p.callCooldown != null || p.callManager != null;
  if (!any && !has("settings")) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
  /* the no-show limit: the people who decide on blocking (main admin, owner, manager) with "Резервации"; the QR calls: "Настройки" */
  const boss = ["admin", "owner", "manager"].includes(s.user.role);
  if ((p.kitchen != null && !has("kitchen")) || (p.resMinutes != null && !has("reservations")) || ((p.celebrationPrice != null || p.earlyDays !== undefined) && !has("offers")) ||
    (p.noShowLimit != null && !(has("settings") || (boss && has("reservations")))) || ((p.callCooldown != null || p.callManager != null) && !(s.user.role === "admin" || s.sections.includes("settings"))))
    throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
}

