/* The demo build only (DEMO=1): the business core in the browser on localStorage. api.ts imports this file dynamically
   behind the build flag, so the server build never ships it. Real-time events: this tab + BroadcastChannel to the others,
   with the same audience rules as the server stream. */
import { createCore, KVRepo, CoreError, type Core, type Hasher, type StaffUser, type RoleId } from "../core/index.ts";
import { MENU } from "../data/menu.ts";
import { state, status, eta, getKitchen } from "../lib/status.ts";
import { offers } from "../lib/offers.ts";
import { eventsJson } from "../lib/events-json.ts";
import { ApiError, busFire, demoChannel } from "./api.ts";
import { publicSettings } from "../core/settings.ts";

export { MENU, offers, eventsJson };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");
async function pbkdf2(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 120000 }, key, 256));
}
export const webHasher: Hasher = {
  async hash(p) { const a = new Uint8Array(16); crypto.getRandomValues(a); const salt = hex(a.buffer); return { salt, hash: await pbkdf2(p, salt), algo: "pbkdf2" }; },
  async verify(p, salt, hash) { return (await pbkdf2(p, salt)) === hash; },
};

let demoCore: Core | null = null;
async function core(): Promise<Core> {
  if (demoCore) return demoCore;
  demoCore = createCore({
    /* preview: the demo shows the lunch menu as today's (the clock comes from ?t= / sc-prefs.time) */
    repo: new KVRepo(localStorage), hasher: webHasher, demo: true, preview: true, requireTrackKey: true,
    emit: (type, data, to) => { busFire(type, data, to); demoChannel()?.postMessage({ type, data, to }); },
  });
  await demoCore.settings.get();
  /* staff accounts: PBKDF2 hashes built from .env at `npm run build:demo` (never the passwords) */
  const list = typeof __DEMO_STAFF__ !== "undefined" ? __DEMO_STAFF__ : [];
  for (const s of list) {
    const have = (await demoCore.ctx.repo.list<StaffUser>("staff_users", { username: s.username }))[0];
    if (!have || have.hash !== s.hash) await demoCore.ctx.repo.put<StaffUser>("staff_users", { id: have ? have.id : "u-" + s.username, username: s.username, name: s.name, role: s.role as RoleId, salt: s.salt, hash: s.hash, algo: "pbkdf2", active: true, createdAt: new Date().toISOString() });
  }
  return demoCore;
}

/** Runs a core call; core errors become ApiError with the same code, text and fields as the server's JSON. */
export async function local<T>(fn: (c: Core) => Promise<T>): Promise<T> {
  try {
    const c = await core();
    /* the demo has no server timer: an office order whose deadline came is sent on the next call */
    await c.office.sendDue().catch(() => undefined);
    return await fn(c);
  } catch (e) {
    if (e instanceof CoreError) { const x = e as CoreError & { fields?: Record<string, string>; retryIn?: number }; throw new ApiError(e.code, e.message, e.status, x.fields, x.retryIn); }
    throw e;
  }
}

export async function statusInfo() {
  const c = await core();
  return { state: state(), status: status(), eta: eta(), ...publicSettings(await c.settings.get()), kitchen: getKitchen() };
}
