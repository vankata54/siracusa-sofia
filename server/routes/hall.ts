/* The hall, the QR codes and the QR table (core/hall.ts).
     GET   /api/admin/hall                         the tables, joined groups, the garden, version      Залата, Резервации или QR
     PUT   /api/admin/hall  {tables, merges, gardenOpen, version}   "Запази плана" (409 conflict)       Залата
     GET   /api/admin/qr                           every table with its code and /masa/<код>/           QR или Залата
     POST  /api/admin/qr/:table                    "Нов код" (the old label stops working)              QR
     GET   /api/table/:code                        public: the table of a QR code (404 "Този код вече не работи") */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { ver } from "./deps.ts";

export function hallRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/hall", async (c) => c.json(await core.hall.get(await staff(c))));
  app.put("/api/admin/hall", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.hall.save(s, { tables: b.tables, merges: b.merges, gardenOpen: b.gardenOpen }, ver(b))); });
  app.get("/api/admin/qr", async (c) => c.json(await core.hall.qr(await staff(c))));
  app.post("/api/admin/qr/:table", async (c) => c.json(await core.hall.qrRenew(await staff(c), c.req.param("table"))));
  app.get("/api/table/:code", async (c) => c.json(await core.hall.byQr(c.req.param("code"))));
}
