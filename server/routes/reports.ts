/* Reports (core/reports.ts): no personal data.
     GET /api/admin/reports?period=today|yesterday|7|30|month|custom&from=&to=&compare=0   the numbers   Отчети */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv } from "./deps.ts";
import type { Period } from "../../src/core/index.ts";

export function reportsRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff } = d;
  app.get("/api/admin/reports", async (c) => c.json(await core.reports.get(await staff(c), { period: qv(c, "period") as Period, from: qv(c, "from"), to: qv(c, "to"), compare: qv(c, "compare") !== "0" })));
}
