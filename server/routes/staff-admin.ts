/* Staff (core/staff-admin.ts): who manages whom is in the core. The old GET /api/admin/staff stays in app.ts.
     GET   /api/admin/staff/list                     users (pin: set/none/n/a), roles (manageable), numbers    Персонал
     POST  /api/admin/staff  {username, name, role, password, pin?}   "Нов потребител" (201; pin_once)        Персонал
     PATCH /api/admin/staff/:id  {name?, role?}      "Име и роля" (409 last_admin)                             Персонал
     POST  /api/admin/staff/:id/active  {active}     on / off (not oneself, not the last main admin)           Персонал
     POST  /api/admin/staff/:id/password  {password} ≥ 10 characters (oneself: without the section)            Персонал / себе си
     POST  /api/admin/staff/:id/pin  {pin?}          {pin} once; 422 "Изберете друг ПИН."; 429 after 5 refused  Персонал
     DELETE /api/admin/staff/:id/pin                 "Махни ПИН"                                               Персонал */
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { AdminDeps } from "./deps.ts";
import type { RoleId } from "../../src/core/index.ts";

export function staffAdminRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/staff/list", async (c) => c.json(await core.staffAdmin.list(await staff(c))));
  app.post("/api/admin/staff", async (c) => { const s = await staff(c); return c.json(await core.staffAdmin.create(s, (await body(c)) as { username: string; name: string; role: RoleId; password: string; pin?: string }), 201); });
  app.patch("/api/admin/staff/:id", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.staffAdmin.update(s, c.req.param("id"), { name: b.name, role: b.role })); });
  app.post("/api/admin/staff/:id/active", async (c) => { const s = await staff(c); return c.json(await core.staffAdmin.setActive(s, c.req.param("id"), (await body(c)).active === true)); });
  app.post("/api/admin/staff/:id/password", async (c) => { const s = await staff(c); return c.json(await core.staffAdmin.setPassword(s, c.req.param("id"), String((await body(c)).password || ""), getCookie(c, "sc_staff"))); });
  app.post("/api/admin/staff/:id/pin", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.staffAdmin.setPin(s, c.req.param("id"), b.pin == null ? undefined : String(b.pin))); });
  app.delete("/api/admin/staff/:id/pin", async (c) => c.json(await core.staffAdmin.removePin(await staff(c), c.req.param("id"))));
}
