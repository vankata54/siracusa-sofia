/* Settings the kitchen and the admin change: "Натоварено" + minutes (one source for the site, the kitchen and the admin,
   decision 04.11.2026), how long a reservation holds the table. Reading also updates this process's clock helpers
   (lib/status.ts setKitchen), so prices and estimates computed here use the same minutes. */
import { COL, emit, iso, type Ctx } from "./ctx.ts";
import { CoreError, type Settings } from "./types.ts";
import { audit } from "./audit.ts";
import { KITCHEN_DEFAULT, setKitchen } from "../lib/status.ts";

export const RES_MINUTES_DEFAULT = 120;
export const DEFAULT_SETTINGS: Settings = { id: "main", kitchen: { ...KITCHEN_DEFAULT }, resMinutes: RES_MINUTES_DEFAULT };

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const s = await ctx.repo.get<Settings>(COL.settings, "main");
  const out: Settings = { ...DEFAULT_SETTINGS, ...(s || {}), kitchen: { ...DEFAULT_SETTINGS.kitchen, ...(s?.kitchen || {}) } };
  setKitchen(out.kitchen);
  return out;
}

export type SettingsPatch = { kitchen?: Partial<Settings["kitchen"]>; resMinutes?: number };

export async function updateSettings(ctx: Ctx, patch: SettingsPatch, actor = "system"): Promise<Settings> {
  const cur = await getSettings(ctx);
  const k = { ...cur.kitchen, ...(patch.kitchen || {}) };
  const f: Record<string, string> = {};
  const okMin = (v: unknown) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 240;
  if (!okMin(k.etaMin)) f.etaMin = "Минутите са цяло число от 5 до 240.";
  if (!okMin(k.etaBusyMin) || k.etaBusyMin < k.etaMin) f.etaBusyMin = "Минутите при натоварване са поне колкото обичайните.";
  const resMinutes = patch.resMinutes == null ? cur.resMinutes : patch.resMinutes;
  if (!Number.isInteger(resMinutes) || resMinutes < 30 || resMinutes > 360 || resMinutes % 30) f.resMinutes = "Продължителността е от 30 до 360 минути, през 30.";
  if (Object.keys(f).length) throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields: f });
  const next: Settings = { id: "main", kitchen: { busy: !!k.busy, etaMin: k.etaMin, etaBusyMin: k.etaBusyMin }, resMinutes, updatedAt: iso(ctx) };
  await ctx.repo.put(COL.settings, next);
  setKitchen(next.kitchen);
  await audit(ctx, actor, "settings.update", "main", patch);
  emit(ctx, "settings", { kitchen: next.kitchen }, { public: true });
  return next;
}
