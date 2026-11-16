import { COL, iso, rid, type Ctx } from "./ctx.ts";
import type { AuditEntry } from "./types.ts";

export async function audit(ctx: Ctx, actor: string, action: string, target?: string, data?: unknown): Promise<AuditEntry> {
  const e: AuditEntry = { id: rid(8), at: iso(ctx), actor, action, target, data };
  await ctx.repo.put(COL.audit, e);
  return e;
}
export type AuditFilter = { limit?: number; before?: string; from?: string; to?: string; who?: string; action?: string; q?: string };
/** newest first; `before` (an ISO time) pages back; from / to are Sofia dates "YYYY-MM-DD" compared on the ISO day (UTC is
    close enough for a log; the screen shows the Sofia time); `role` is added from the staff accounts */
export async function listAudit(ctx: Ctx, f: AuditFilter | number = {}): Promise<(AuditEntry & { role?: string })[]> {
  const o: AuditFilter = typeof f === "number" ? { limit: f } : f;
  const limit = Math.min(1000, Math.max(1, Math.floor(+(o.limit || 200)) || 200));
  const q = String(o.q || "").toLowerCase().slice(0, 80);
  const staff = await ctx.repo.list<{ id: string; username: string; role: string }>(COL.staff);
  const roleOf = new Map(staff.map((u) => [u.username, u.role]));
  const all = (await ctx.repo.list<AuditEntry>(COL.audit)).filter((e) =>
    (!o.before || e.at < o.before) && (!o.from || e.at.slice(0, 10) >= o.from) && (!o.to || e.at.slice(0, 10) <= o.to) &&
    (!o.who || e.actor === o.who) && (!o.action || e.action.startsWith(o.action)) &&
    (!q || (e.actor + " " + e.action + " " + (e.target || "") + " " + JSON.stringify(e.data ?? "")).toLowerCase().includes(q)));
  return all.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit).map((e) => ({ ...e, role: roleOf.get(e.actor) }));
}
