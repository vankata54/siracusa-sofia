/* Who may change which setting (server and demo, no other import: the admin bundle loads it without the core). */
import { CoreError } from "./types.ts";
import type { SettingsPatch } from "./settings.ts";

/** Who may change what (server and demo): "Настройки" everything; without it the kitchen its "Натоварено" and minutes,
    "Резервации" the table hold, "Оферти и ваучери" the celebration price and the early days. 403 otherwise. */
export function settingsAllowed(s: { user: { role: string }; sections: string[] }, p: SettingsPatch): void {
  const has = (x: string) => s.user.role === "admin" || s.sections.includes("settings") || s.sections.includes(x);
  const any = p.kitchen != null || p.resMinutes != null || p.celebrationPrice != null || p.earlyDays !== undefined;
  if (!any && !has("settings")) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
  if ((p.kitchen != null && !has("kitchen")) || (p.resMinutes != null && !has("reservations")) || ((p.celebrationPrice != null || p.earlyDays !== undefined) && !has("offers")))
    throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
}

