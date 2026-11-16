/* Delivery zones (core/zones.ts). The public list is GET /api/zones in server/app.ts.
     GET   /api/admin/zones                        the zones + summary + version                         Зони
     PATCH /api/admin/zones/:slug  {on?, free?, fee?, min?, etaMin?, from?, to?, version?}   422 fields   Зони */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { ver } from "./deps.ts";

export function zonesRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/zones", async (c) => c.json(await core.zones.list(await staff(c))));
  app.patch("/api/admin/zones/:slug", async (c) => { const s = await staff(c), b = await body(c); const { version: _v, ...p } = b; return c.json(await core.zones.save(s, c.req.param("slug"), p, ver(b))); });
}
