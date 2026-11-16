/* Offers, codes and vouchers (core/offers-admin.ts). The public banner list is GET /api/offers in server/app.ts;
   the inquiries are in server/routes/customers.ts (kind=inquiries).
     GET    /api/admin/offers                       the offers (+ blocked reason) and the celebration settings   Оферти
     POST   /api/admin/offers/:id/toggle {on, version?}   409 locked / missing                                  Оферти
     PATCH  /api/admin/offers/:id  {title?, sub?, text?, pct?, r?, version?}   422 (Google review refused)       Оферти
     POST   /api/admin/offers   {title, sub?, text?, pct, r}   "Нова оферта" (201, off)                          Оферти
     DELETE /api/admin/offers/:id                   a new offer only; returns {removed} for "Отмени"             Оферти
     POST   /api/admin/offers/restore  {row}        "Отмени"                                                     Оферти
     POST   /api/admin/codes/check  {code}          SC10- / SCV-: valid / used / unknown (into the log)          Оферти
     GET    /api/admin/vouchers                     the vouchers                                                 Оферти
     POST   /api/admin/vouchers  {kind, value, n, note?}   "Нови кодове" (201)                                   Оферти
     POST   /api/admin/vouchers/use  {code, note?}  "Използван" (409 used)                                       Оферти или Поръчки */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { ver } from "./deps.ts";
import type { OfferRow } from "../../src/core/index.ts";

export function offersRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  app.get("/api/admin/offers", async (c) => c.json(await core.offersAdmin.list(await staff(c))));
  app.post("/api/admin/offers/restore", async (c) => { const s = await staff(c); return c.json(await core.offersAdmin.restore(s, (await body(c)).row as OfferRow)); });
  app.post("/api/admin/offers", async (c) => { const s = await staff(c); return c.json(await core.offersAdmin.create(s, (await body(c)) as { title: string }), 201); });
  app.post("/api/admin/offers/:id/toggle", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.offersAdmin.toggle(s, c.req.param("id"), b.on === true, ver(b))); });
  app.patch("/api/admin/offers/:id", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.offersAdmin.save(s, c.req.param("id"), b, ver(b))); });
  app.delete("/api/admin/offers/:id", async (c) => c.json(await core.offersAdmin.remove(await staff(c), c.req.param("id"))));
  app.post("/api/admin/codes/check", async (c) => { const s = await staff(c); return c.json(await core.offersAdmin.checkCode(s, String((await body(c)).code || ""))); });
  app.get("/api/admin/vouchers", async (c) => c.json(await core.offersAdmin.vouchers(await staff(c))));
  app.post("/api/admin/vouchers/use", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.offersAdmin.useVoucher(s, String(b.code || ""), b.note)); });
  app.post("/api/admin/vouchers", async (c) => { const s = await staff(c); return c.json(await core.offersAdmin.createVouchers(s, (await body(c)) as { kind: "sum" | "pct"; value: number; n: number; note?: string }), 201); });
}
