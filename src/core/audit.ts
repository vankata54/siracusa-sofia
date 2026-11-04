import { COL, iso, rid, type Ctx } from "./ctx.ts";
import type { AuditEntry } from "./types.ts";

export async function audit(ctx: Ctx, actor: string, action: string, target?: string, data?: unknown): Promise<AuditEntry> {
  const e: AuditEntry = { id: rid(8), at: iso(ctx), actor, action, target, data };
  await ctx.repo.put(COL.audit, e);
  return e;
}
export async function listAudit(ctx: Ctx, limit = 200): Promise<AuditEntry[]> {
  const all = await ctx.repo.list<AuditEntry>(COL.audit);
  return all.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
