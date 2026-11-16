/* Reservations and blocking no-shows in the admin (core/reservations-admin.ts; the old list / PATCH stay in app.ts).
     GET   /api/admin/reservations/day?date=&status=&q=     the day: rows (phones masked), numbers, people by hour   Резервации
     GET   /api/admin/reservations/month?month=YYYY-MM      bookings per day (the calendar)                         Резервации
     GET   /api/admin/reservations/free?date=&time=&people=&except=   free tables at that time                     Резервации
     POST  /api/admin/reservations/new     {date, time, people, table?, name, phone, occasion?, note?, waitlist?}
                                                           "Нова резервация" (201, "Потвърдена")                    Резервации
     POST  /api/admin/reservations/:id/status {status}     409 too_early (Дошли / Неявили се > 30 мин преди)       Резервации
     POST  /api/admin/reservations/:id/table  {table|null} "Смени маса" / "Дай маса" (409 taken)                    Резервации
     POST  /api/admin/reservations/:id/phone               the whole phone, into the log                            Резервации
     GET   /api/admin/blocks                               the no-show list (phones masked, ref)                    Резервации или Клиенти
     POST  /api/admin/blocks/:ref  {action: block|clear}   "Блокирай" / "Не блокирай" / "Отблокирай"               главен админ, собственик, управител
     POST  /api/admin/blocks       {phone, name?}          "Добави номер ръчно" (201)                               главен админ, собственик, управител */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv } from "./deps.ts";
import type { ReservationStatus } from "../../src/core/index.ts";
import type { ReservationInput } from "../../src/core/reservations.ts";

export function reservationsAdminRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/reservations/day", async (c) => c.json(await core.resAdmin.day(await staff(c), { date: qv(c, "date"), status: qv(c, "status") as ReservationStatus | "all", q: qv(c, "q") })));
  app.get("/api/admin/reservations/month", async (c) => c.json(await core.resAdmin.month(await staff(c), qv(c, "month") || "")));
  app.get("/api/admin/reservations/free", async (c) => c.json(await core.resAdmin.free(await staff(c), qv(c, "date") || "", qv(c, "time") || "", +(qv(c, "people") || 1) || 1, qv(c, "except"))));
  app.post("/api/admin/reservations/new", async (c) => { const s = await staff(c); return c.json(await core.resAdmin.create(s, (await body(c)) as ReservationInput), 201); });
  app.post("/api/admin/reservations/:id/status", async (c) => { const s = await staff(c); return c.json(await core.resAdmin.setStatus(s, c.req.param("id"), (await body(c)).status as ReservationStatus)); });
  app.post("/api/admin/reservations/:id/table", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.resAdmin.setTable(s, c.req.param("id"), b.table == null || b.table === "" ? null : String(b.table))); });
  app.post("/api/admin/reservations/:id/phone", async (c) => c.json(await core.resAdmin.phone(await staff(c), c.req.param("id"))));
  app.get("/api/admin/blocks", async (c) => c.json(await core.resAdmin.blocks(await staff(c))));
  app.post("/api/admin/blocks", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.resAdmin.addBlock(s, { phone: String(b.phone || ""), name: b.name }), 201); });
  app.post("/api/admin/blocks/:ref", async (c) => { const s = await staff(c); return c.json(await core.resAdmin.decide(s, c.req.param("ref"), (await body(c)).action)); });
}
