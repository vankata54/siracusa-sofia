/* Context injected into every core service: storage, clock, event bus, password hasher. No DOM, no Node API. */
import type { Repo } from "./repo.ts";
import type { ClockInput } from "../lib/time.ts";

export interface Hasher {
  hash(password: string): Promise<{ salt: string; hash: string; algo: "scrypt" | "pbkdf2" }>;
  verify(password: string, salt: string, hash: string, algo: "scrypt" | "pbkdf2"): Promise<boolean>;
}

export interface Ctx {
  repo: Repo;
  /** wall clock (Date) for timestamps; default new Date() */
  now?: () => Date;
  /** shop clock override for the hour logic ("21:30"); default real Sofia time */
  clock?: ClockInput;
  /** real-time bus: SSE on the server, BroadcastChannel in the demo */
  emit?: (type: string, data: unknown) => void;
  hasher?: Hasher;
  /** demo build: SMS codes are returned to the screen (there is no SMS provider in v1 anyway) */
  demo?: boolean;
}

export const COL = {
  orders: "orders", reservations: "reservations", celebrations: "celebrations", office: "office_orders",
  subscriptions: "subscriptions", customers: "users", smsCodes: "sms_codes", sessions: "sessions", ratings: "ratings",
  notes: "feedback_notes", staff: "staff_users", roles: "roles", audit: "audit_log",
} as const;

export function nowDate(ctx: Ctx): Date { return ctx.now ? ctx.now() : new Date(); }
export function iso(ctx: Ctx): string { return nowDate(ctx).toISOString(); }

/** Random id / token from crypto.getRandomValues (works in Node 22 and every browser, also on file://). */
export function rid(bytes = 16): string {
  const a = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function randomDigits(n: number): string {
  const a = new Uint32Array(n);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (v) => String(v % 10)).join("");
}

export function emit(ctx: Ctx, type: string, data: unknown): void {
  try { ctx.emit && ctx.emit(type, data); } catch { /* the bus must never break a write */ }
}
