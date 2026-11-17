/* Known devices (decision of 17.11.2026, the safest variant): the personal PIN of the staff apps works only on a device
   where somebody has already signed in with a username and a password. A successful password sign-in marks the device:
   - the server keeps a long-lived httpOnly cookie with a random token (server/app.ts, "sc_kd"); the core stores only the
     SHA-256 of the token (COL.devices), never the token;
   - the demo has no server: its store IS the browser (localStorage), so the mark is one fixed document of that store.
   No rights here: the callers are the sign-in functions (staff.ts, staff-pin.ts). */
import { COL, iso, type Ctx } from "./ctx.ts";

export interface KnownDevice { id: string; createdAt: string; updatedAt: string; /** who signed in with a password here (usernames, the last 20) */ users: string[] }
export const DEMO_DEVICE = "demo-device";
const TOKEN = /^[0-9a-f]{32,64}$/;

/** the token of this request: the cookie's (server) or the fixed one of the demo store; "" when there is none */
export function deviceToken(ctx: Ctx, token: string | null | undefined): string {
  const t = String(token || "");
  return TOKEN.test(t) ? t : ctx.demo ? DEMO_DEVICE : "";
}
export async function deviceId(token: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("sc-device-v1:" + token));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** after a successful password sign-in: this device is known from now on */
export async function markDevice(ctx: Ctx, token: string | null | undefined, username: string): Promise<void> {
  const t = deviceToken(ctx, token);
  if (!t) return;
  const id = await deviceId(t), now = iso(ctx), have = await ctx.repo.get<KnownDevice>(COL.devices, id);
  await ctx.repo.put<KnownDevice>(COL.devices, { id, createdAt: have ? have.createdAt : now, updatedAt: now, users: [username, ...(have ? have.users.filter((u) => u !== username) : [])].slice(0, 20) });
}
/** the id of a known device, or null (unknown device, no token) */
export async function knownDevice(ctx: Ctx, token: string | null | undefined): Promise<string | null> {
  const t = deviceToken(ctx, token);
  if (!t) return null;
  const id = await deviceId(t);
  return (await ctx.repo.get<KnownDevice>(COL.devices, id)) ? id : null;
}
