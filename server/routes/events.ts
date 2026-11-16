/* Events (core/events-admin.ts). The public list is GET /api/events in server/app.ts.
     GET    /api/admin/events?tab=upcoming|past|all&cat=   the events (+ next date, phase, [ЛИПСВА] note)   Събития
     POST   /api/admin/events  {n, cat, date, time, text, prog, menu, priceMode, price, seats, publish?}  (201)  Събития
     PATCH  /api/admin/events/:id  {…, version?}       "Промени" (the address stays; 409 conflict)       Събития
     POST   /api/admin/events/:id/publish  {on}         "Публикувай" / back to draft                      Събития
     DELETE /api/admin/events/:id                       "Изтрий": returns {removed} for "Отмени"          Събития
     POST   /api/admin/events/restore  {row}            "Отмени"                                          Събития */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv, ver } from "./deps.ts";
import type { EventRow } from "../../src/core/index.ts";

export function eventsRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/events", async (c) => c.json(await core.eventsAdmin.list(await staff(c), { tab: qv(c, "tab") as "upcoming" | "past" | "all", cat: qv(c, "cat") })));
  app.post("/api/admin/events/restore", async (c) => { const s = await staff(c); return c.json(await core.eventsAdmin.restore(s, (await body(c)).row as EventRow)); });
  app.post("/api/admin/events", async (c) => { const s = await staff(c); return c.json(await core.eventsAdmin.create(s, await body(c)), 201); });
  app.patch("/api/admin/events/:id", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.eventsAdmin.update(s, c.req.param("id"), b, ver(b))); });
  app.post("/api/admin/events/:id/publish", async (c) => { const s = await staff(c); return c.json(await core.eventsAdmin.publish(s, c.req.param("id"), (await body(c)).on !== false)); });
  app.delete("/api/admin/events/:id", async (c) => c.json(await core.eventsAdmin.remove(await staff(c), c.req.param("id"))));
}
