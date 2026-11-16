/* Orders in the admin (core/orders-admin.ts; the status PATCH /api/admin/orders/:no stays in server/app.ts).
     GET   /api/admin/orders/list?status=&channel=&day=&q=   the list (phones masked) + counts        Поръчки
     GET   /api/admin/orders/:no/detail                      the detail (phone, e-mail masked)          Поръчки
     POST  /api/admin/orders/:no/phone                       the whole phone + e-mail, into the log     Поръчки
     POST  /api/admin/orders/:no/cancel   {reason}           "Откажи" with the reason (422 reason)      Поръчки
     POST  /api/admin/orders/:no/step     {status}           one step (not "cancelled": use cancel)     Поръчки, Кухня, Шофьор (their steps)
     POST  /api/admin/orders/phone        {phone, name, mode, addr, zone, slot, lines, note, pay}
                                                             "Нова поръчка по телефон" (201)            главен админ, собственик, управител */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv } from "./deps.ts";
import type { OrderStatus, OrdersQuery, PhoneOrderInput } from "../../src/core/index.ts";

export function ordersAdminRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/orders/list", async (c) => c.json(await core.ordersAdmin.list(await staff(c), { status: qv(c, "status") as OrdersQuery["status"], channel: qv(c, "channel") as OrdersQuery["channel"], day: qv(c, "day"), q: qv(c, "q") })));
  app.post("/api/admin/orders/phone", async (c) => { const s = await staff(c); return c.json(await core.ordersAdmin.phoneOrder(s, (await body(c)) as PhoneOrderInput), 201); });
  app.get("/api/admin/orders/:no/detail", async (c) => c.json(await core.ordersAdmin.get(await staff(c), c.req.param("no"))));
  app.post("/api/admin/orders/:no/phone", async (c) => c.json(await core.ordersAdmin.phone(await staff(c), c.req.param("no"))));
  app.post("/api/admin/orders/:no/cancel", async (c) => { const s = await staff(c); return c.json(await core.ordersAdmin.cancel(s, c.req.param("no"), String((await body(c)).reason || ""))); });
  app.post("/api/admin/orders/:no/step", async (c) => { const s = await staff(c); return c.json(await core.ordersAdmin.step(s, c.req.param("no"), (await body(c)).status as OrderStatus)); });
}
