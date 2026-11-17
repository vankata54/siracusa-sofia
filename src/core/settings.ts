/* Settings the kitchen and the admin change: "Натоварено" + minutes (one source for the site, the kitchen and the admin,
   decision 04.11.2026), how long a reservation holds the table. Reading also updates this process's clock helpers
   (lib/status.ts setKitchen), so prices and estimates computed here use the same minutes. */
import { COL, emit, iso, type Ctx } from "./ctx.ts";
import { CoreError, type Settings } from "./types.ts";
import { audit } from "./audit.ts";
import { KITCHEN_DEFAULT, setKitchen } from "../lib/status.ts";
import { busyLogged } from "./kitchen-base.ts";
import { DEFAULT_ROLES } from "./staff.ts";

export const RES_MINUTES_DEFAULT = 120;
/* noShowLimit, callCooldown, callManager: the open questions that are settings (OPEN-QUESTIONS 8 and modules 1), with the defaults */
export const DEFAULT_SETTINGS: Settings = { id: "main", kitchen: { ...KITCHEN_DEFAULT }, resMinutes: RES_MINUTES_DEFAULT, celebrationPrice: "offer", earlyDays: null, noShowLimit: 2, callCooldown: 3, callManager: 5, qrManager: 3 };
/** what any page may read (GET /api/status): no internal settings */
export function publicSettings(s: Settings) { return { kitchen: { busy: s.kitchen.busy, etaMin: s.kitchen.etaMin, etaBusyMin: s.kitchen.etaBusyMin }, celebrationPrice: s.celebrationPrice, earlyDays: s.earlyDays }; }

export async function getSettings(ctx: Ctx): Promise<Settings> {
  const s = await ctx.repo.get<Settings>(COL.settings, "main");
  const out: Settings = { ...DEFAULT_SETTINGS, ...(s || {}), kitchen: { ...DEFAULT_SETTINGS.kitchen, ...(s?.kitchen || {}) } };
  setKitchen(out.kitchen);
  return out;
}

export type SettingsPatch = { kitchen?: Partial<Settings["kitchen"]>; resMinutes?: number; celebrationPrice?: Settings["celebrationPrice"]; earlyDays?: number | null;
  noShowLimit?: number; callCooldown?: number; callManager?: number; qrManager?: number };

export { settingsAllowed } from "./settings-guard.ts";

/** `by`: the name shown for who switched "Натоварено" ("Кухня · Скара", "Главен готвач": core/kitchen.ts); without it the
    role of the account ("Управител", "Собственик", "Главен админ") */
export async function updateSettings(ctx: Ctx, patch: SettingsPatch, actor = "system", by?: string): Promise<Settings> {
  const cur = await getSettings(ctx);
  const k = { ...cur.kitchen, ...(patch.kitchen || {}) };
  const f: Record<string, string> = {};
  const okMin = (v: unknown) => Number.isInteger(v) && (v as number) >= 5 && (v as number) <= 240;
  if (!okMin(k.etaMin)) f.etaMin = "Минутите са цяло число от 5 до 240.";
  if (!okMin(k.etaBusyMin) || k.etaBusyMin < k.etaMin) f.etaBusyMin = "Минутите при натоварване са поне колкото обичайните.";
  const resMinutes = patch.resMinutes == null ? cur.resMinutes : patch.resMinutes;
  if (!Number.isInteger(resMinutes) || resMinutes < 30 || resMinutes > 360 || resMinutes % 30) f.resMinutes = "Продължителността е от 30 до 360 минути, през 30.";
  const celebrationPrice = patch.celebrationPrice == null ? cur.celebrationPrice : patch.celebrationPrice;
  if (celebrationPrice !== "estimate" && celebrationPrice !== "offer") f.celebrationPrice = "Изберете „ориентировъчна цена“ или „само оферта“.";
  const earlyDays = patch.earlyDays === undefined ? cur.earlyDays : patch.earlyDays;
  if (earlyDays !== null && (!Number.isInteger(earlyDays) || earlyDays < 1 || earlyDays > 365)) f.earlyDays = "Дните са цяло число от 1 до 365 (или празно).";
  const int = (k: "noShowLimit" | "callCooldown" | "callManager" | "qrManager", lo: number, hi: number, msg: string) => {
    const v = patch[k] == null ? cur[k] : patch[k];
    if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) f[k] = msg;
    return v as number;
  };
  const noShowLimit = int("noShowLimit", 1, 5, "Неявяванията са цяло число от 1 до 5.");
  const callCooldown = int("callCooldown", 1, 15, "Минутите са цяло число от 1 до 15.");
  const callManager = int("callManager", 1, 30, "Минутите са цяло число от 1 до 30.");
  /* a QR order nobody confirmed goes to the manager after this many minutes (decision 17.11.2026, answer 29: 3) */
  const qrManager = int("qrManager", 1, 30, "Минутите са цяло число от 1 до 30.");
  if (Object.keys(f).length) throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields: f });
  /* when "Натоварено" was turned on (the kitchen's reminder after 60 min, OPEN-QUESTIONS 15) */
  const busyAt = k.busy ? (cur.kitchen.busy ? cur.kitchen.busyAt || iso(ctx) : iso(ctx)) : null;
  /* who switched it (the kitchen, the admin's "Настройки", the manager's module): the name on the screens, the day's log,
     the event `kitchen.busy` (public: no names) */
  const flip = !!k.busy !== !!cur.kitchen.busy;
  let who = "";
  if (flip) { const u = (await ctx.repo.list<{ id: string; username: string; role: string }>(COL.staff, { username: actor } as never))[0]; who = by || DEFAULT_ROLES.find((r) => r.id === (u && u.role))?.n || actor; }
  const busyBy = k.busy ? (flip ? who : cur.kitchen.busyBy ?? null) : null;
  const next: Settings = { id: "main", kitchen: { busy: !!k.busy, etaMin: k.etaMin, etaBusyMin: k.etaBusyMin, busyAt, busyBy }, resMinutes, celebrationPrice, earlyDays, noShowLimit, callCooldown, callManager, qrManager, updatedAt: iso(ctx) };
  await ctx.repo.put(COL.settings, next);
  setKitchen(next.kitchen);
  await audit(ctx, actor, "settings.update", "main", patch);
  emit(ctx, "settings", publicSettings(next), { public: true });
  if (flip) {
    await busyLogged(ctx, next.kitchen.busy, iso(ctx), who, actor);
    await audit(ctx, actor, next.kitchen.busy ? "kitchen.busy_on" : "kitchen.busy_off", "main", { by: who });
    emit(ctx, "kitchen.busy", { busy: next.kitchen.busy, at: busyAt, etaMin: next.kitchen.etaMin, etaBusyMin: next.kitchen.etaBusyMin, extra: Math.max(0, next.kitchen.etaBusyMin - next.kitchen.etaMin) }, { public: true });
  }
  return next;
}
