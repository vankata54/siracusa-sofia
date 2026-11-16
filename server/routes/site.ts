/* The site data (zones, hall, events, offers) and the rebuild of the site (server/publish.ts: one queue with the menu).
     GET /api/admin/site/state     the versions (who, when) and the rebuild: {state, at, error?, waiting}   Зони, Залата, Събития или Оферти */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import type { Publisher } from "../publish.ts";

export function siteRoutes(app: Hono, d: AdminDeps & { publisher: () => Publisher | null }): void {
  const { core, staff } = d;
  app.get("/api/admin/site/state", async (c) => { const p = d.publisher(); return c.json({ ...(await core.site.state(await staff(c))), build: p ? p.state() : { state: "idle", at: null, waiting: false } }); });
}
