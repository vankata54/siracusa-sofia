/* What the route files of the admin's part 3 get from server/app.ts. The rights are in the core: a route only passes the
   signed-in staff member (staff(c) = core.staff.guard: 401 without a session) and the body; the core function of the
   section checks the section (403) and the rules, the same as the demo (src/client/api-admin-3.ts). */
import type { Context } from "hono";
import type { Core, StaffCtx } from "../../src/core/index.ts";

export interface AdminDeps {
  core: Core;
  /** the signed-in staff member (no section: the core checks it) */
  staff: (c: Context) => Promise<StaffCtx>;
  body: (c: Context) => Promise<Record<string, any>>;
  /** the core for this request: the preview clock of the page in the test mode (SC_PREVIEW_API=1), else `core` */
  coreFor?: (c: Context) => Core;
}
/** a query value or undefined */
export const qv = (c: Context, k: string): string | undefined => c.req.query(k) || undefined;
/** a version from the body ("version": a number), or undefined (no check) */
export const ver = (b: Record<string, unknown>): number | undefined => (typeof b.version === "number" ? b.version : typeof b.version === "string" && /^\d+$/.test(b.version) ? +b.version : undefined);
