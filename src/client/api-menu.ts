/* The menu editor and the lunch menu for the admin screens (src/admin/*): the same calls on the server (fetch, the rights
   and the PIN are checked there) and in the demo (the core in the browser, through the same check core.staff.guard with
   the demo session). Only the admin pages import this file.
   Demo: the draft, "Публикувай" and "Върни" work in the core in the browser, but the static site is NOT rebuilt
   (publishState().mode === "demo"); a photo stays in the draft as a data: URL (up to 1 MB). */
import { http, pick, demoTok, ApiError } from "./api.ts";
import type { Core } from "./api-types.ts";
import type { Menu } from "../data/menu.ts";
import type { DraftView, MenuChanges, PublishState, LunchView, StaffCtx } from "../core/index.ts";

export { ApiError };
export type { DraftView, MenuChanges, PublishState, LunchView, Menu };
/** the rebuild of the site on the server (server/publish.ts); in the demo always "idle" */
export interface BuildState { state: "idle" | "queued" | "building" | "done" | "error"; at: string | null; error?: string; how?: "build" | "swap"; ms?: number; waiting: boolean }
export type MenuState = PublishState & { build: BuildState };
export interface Media { url: string; type: string; bytes: number }

const IDLE: BuildState = { state: "idle", at: null, waiting: false };
const g = (c: Core, need: string): Promise<StaffCtx> => c.staff.guard(demoTok("staff"), need);
/** the lunch PIN is per person and device; the demo is one device */
const DEV = "demo";
export const MEDIA_MAX = 5 * 1024 * 1024;
/** the demo keeps the photo in localStorage (about 5 MB for everything) */
export const DEMO_MEDIA_MAX = 1_000_000;

/** png / jpg / webp by the first bytes (the server checks the same) */
export function sniffImage(b: Uint8Array): "png" | "jpg" | "webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}
const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

async function uploadDemo(c: Core, file: Blob): Promise<Media> {
  await g(c, "menu");
  if (file.size > MEDIA_MAX) throw new ApiError("too_large", "Снимката е до 5 MB.", 413);
  if (file.size > DEMO_MEDIA_MAX) throw new ApiError("too_large", "В демото снимката е до 1 MB (на сървъра до 5 MB).", 413);
  const b = new Uint8Array(await file.arrayBuffer()), ext = sniffImage(b);
  if (!ext) throw new ApiError("unsupported", "Качете снимка в WebP, JPEG или PNG.", 415);
  let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return { url: "data:" + MIME[ext] + ";base64," + btoa(bin), type: MIME[ext], bytes: b.length };
}
async function uploadServer(file: Blob): Promise<Media> {
  if (file.size > MEDIA_MAX) throw new ApiError("too_large", "Снимката е до 5 MB.", 413);
  let r: Response;
  try { r = await fetch("/api/admin/media", { method: "POST", credentials: "same-origin", headers: { "content-type": file.type || "application/octet-stream" }, body: file }); }
  catch { throw new ApiError("offline", "Няма връзка. Проверете интернета и опитайте пак.", 0); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new ApiError(j?.error || "server", j?.message || "Нещо се обърка. Опитайте пак.", r.status, j?.fields);
  return j as Media;
}

export const menuApi = {
  /** the shared draft {version, menu, changes}; without a draft the live menu and no changes (section "Меню") */
  draft: pick(async (c) => c.menuEdit.getDraft(await g(c, "menu")), () => http<DraftView>("GET", "admin/menu/draft")),
  /** saves the whole draft: 409 "conflict" (someone else saved first: load again), 422 with fields ("items.<id>.p" ...) */
  saveDraft: pick(async (c, menu: Menu, version: number) => c.menuEdit.saveDraft(await g(c, "menu"), menu, version),
    (menu, version) => http<DraftView>("PUT", "admin/menu/draft", { menu, version })),
  /** "Откажи" */
  /** "Откажи": version of the draft on the screen is required (422 without it, 409 "conflict" when someone saved since) */
  discardDraft: pick(async (c, version: number) => c.menuEdit.discardDraft(await g(c, "menu"), version),
    (version) => http<DraftView>("POST", "admin/menu/draft/discard", { version })),
  /** "Публикувай": 409 "conflict", 422 "nothing" / "invalid"; the server rebuilds the site (state.build) */
  publish: pick(async (c, version: number): Promise<MenuState & { changes: MenuChanges }> => ({ ...(await c.menuEdit.publish(await g(c, "menu"), version)), build: IDLE }),
    (version) => http<MenuState & { changes: MenuChanges }>("POST", "admin/menu/publish", { version })),
  /** "Върни предишната версия": version = the live one on the screen (409 "conflict"), 409 "no_prev" */
  rollback: pick(async (c, version: number): Promise<MenuState> => { const s = await g(c, "menu"); await c.menuEdit.rollback(s, version); return { ...(await c.menuEdit.publishState(s)), build: IDLE }; },
    (version) => http<MenuState>("POST", "admin/menu/rollback", { version })),
  /** the live version, who and when, one step back, the draft, the rebuild; mode "demo": the static site is not rebuilt */
  /** the site again with the live menu (after a failed rebuild); the demo has no rebuild */
  rebuild: pick(async (c): Promise<MenuState> => ({ ...(await c.menuEdit.publishState(await g(c, "menu"))), build: IDLE }), () => http<MenuState>("POST", "admin/menu/rebuild")),
  state: pick(async (c): Promise<MenuState> => ({ ...(await c.menuEdit.publishState(await g(c, "menu"))), build: IDLE }), () => http<MenuState>("GET", "admin/menu/publish")),
  /** a photo for a dish: {url} goes into dish.photo (server: /media/<sha256>.<ext>; demo: a data: URL) */
  uploadMedia: pick(async (c, file: Blob) => uploadDemo(c, file), (file) => uploadServer(file)),
};

type LunchFavIn = { n: string; ids: string[] };
type LunchDishIn = { n: string; group: string; p: number | string };
export const lunchApi = {
  /** the schedule; other staff without the PIN: ApiError 403 "pin_required" (or "pin_unset") */
  get: pick(async (c) => c.lunch.get(await g(c, "lunch"), DEV), () => http<LunchView>("GET", "admin/lunch")),
  /** one day (a draft until "Публикувай"); [] clears it */
  saveDay: pick(async (c, date: string, ids: string[]) => c.lunch.saveDay(await g(c, "lunch"), DEV, date, ids),
    (date, ids) => http<LunchView>("PUT", "admin/lunch/days/" + encodeURIComponent(date), { ids })),
  /** 422 "same_menu" (fields: {день: текст}), "invalid" (empty day, past day) */
  publish: pick(async (c, dates: string[]) => c.lunch.publish(await g(c, "lunch"), DEV, dates), (dates) => http<LunchView>("POST", "admin/lunch/publish", { dates })),
  saveFav: pick(async (c, f: LunchFavIn) => c.lunch.saveFav(await g(c, "lunch"), DEV, f), (f) => http<LunchView>("POST", "admin/lunch/favs", f)),
  removeFav: pick(async (c, id: string) => c.lunch.removeFav(await g(c, "lunch"), DEV, id), (id) => http<LunchView>("DELETE", "admin/lunch/favs/" + encodeURIComponent(id))),
  addDish: pick(async (c, x: LunchDishIn) => c.lunch.addDish(await g(c, "lunch"), DEV, x), (x) => http<LunchView & { id: string }>("POST", "admin/lunch/dishes", x)),
  /** {pinSet, boss, openUntil, at}: never the PIN */
  pinState: pick(async (c) => c.lunch.pinState(await g(c, "lunch"), DEV), () => http<{ pinSet: boolean; boss: boolean; openUntil: number | null; at: string | null }>("GET", "admin/lunch/pin")),
  /** "Смени ПИН" (owner, manager, main admin): returns the new PIN once; without a pin the core makes a random one */
  setPin: pick(async (c, pin?: string) => c.lunch.setPin(await g(c, "lunch"), pin), (pin) => http<{ pin: string; at: string }>("PUT", "admin/lunch/pin", pin ? { pin } : {})),
  /** opens the schedule for 15 minutes: 401 "bad_pin" (left on the last 3), 429 "throttled" (retryIn) */
  unlock: pick(async (c, pin: string) => c.lunch.unlock(await g(c, "lunch"), DEV, pin), (pin) => http<{ until: number | null }>("POST", "admin/lunch/unlock", { pin })),
  lock: pick(async (c) => c.lunch.lock(await g(c, "lunch"), DEV), () => http<{ ok: true }>("POST", "admin/lunch/lock")),
};
