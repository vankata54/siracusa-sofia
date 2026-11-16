/* Customers, feedback and inquiries (core/customers-admin.ts).
     GET    /api/admin/customers?q=&filter=offers|birthday|blocked|new   the list (phones masked)        Клиенти
     GET    /api/admin/customers/:id                       the profile (masked), orders, no-shows        Клиенти
     POST   /api/admin/customers/:id/contact               the whole phone + e-mail, into the log        Клиенти
     GET    /api/admin/customers/:id/export                "Изтегли данните" (GDPR, a JSON file)         Клиенти
     DELETE /api/admin/customers/:id                       "Изтрий": {until} (deleted after 10 s)        Клиенти
     POST   /api/admin/customers/:id/restore               "Отмени" in the window (410 gone after)       Клиенти
     GET    /api/admin/messages?kind=feedback|inquiries    messages / voucher and birthday inquiries     Клиенти (inquiries: или Оферти)
     POST   /api/admin/messages/:id/status  {status: new|called|done}                                    same
     POST   /api/admin/messages/:id/contact                the whole contact, into the log               same */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv } from "./deps.ts";
import type { FeedbackStatus } from "../../src/core/index.ts";

export function customersRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/customers", async (c) => c.json(await core.customersAdmin.list(await staff(c), { q: qv(c, "q"), filter: qv(c, "filter") as "offers" })));
  app.get("/api/admin/customers/:id", async (c) => c.json(await core.customersAdmin.get(await staff(c), c.req.param("id"))));
  app.post("/api/admin/customers/:id/contact", async (c) => c.json(await core.customersAdmin.contact(await staff(c), c.req.param("id"))));
  app.get("/api/admin/customers/:id/export", async (c) => { const data = await core.customersAdmin.export(await staff(c), c.req.param("id")); c.header("Content-Disposition", 'attachment; filename="siracusa-klient.json"'); return c.json(data); });
  app.delete("/api/admin/customers/:id", async (c) => c.json(await core.customersAdmin.remove(await staff(c), c.req.param("id"))));
  app.post("/api/admin/customers/:id/restore", async (c) => c.json(await core.customersAdmin.restore(await staff(c), c.req.param("id"))));
  app.get("/api/admin/messages", async (c) => c.json(await core.customersAdmin.feedback(await staff(c), qv(c, "kind") === "inquiries" ? "inquiries" : "feedback")));
  app.post("/api/admin/messages/:id/status", async (c) => { const s = await staff(c); return c.json(await core.customersAdmin.feedbackStatus(s, c.req.param("id"), (await body(c)).status as FeedbackStatus)); });
  app.post("/api/admin/messages/:id/contact", async (c) => c.json(await core.customersAdmin.feedbackContact(await staff(c), c.req.param("id"))));
}
