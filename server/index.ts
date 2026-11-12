/* Start: npm run serve (after npm run build). Reads .env; port 8787 by default.
   PORT, DIST_DIR, DB_FILE, COOKIE_SECURE=1; TRACK_KEY_REQUIRED=0 turns off the key check (default: tracking only with /porachka/<no>-<key>/);
   SC_PREVIEW_API=1 only for tests (the API follows the preview clock of the page). */
import fs from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { seedStaff } from "./seed.ts";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const port = +(process.env.PORT || 8787);
const { app, core } = createApp({
  dbFile: process.env.DB_FILE || "data/siracusa.db", distDir: process.env.DIST_DIR || "dist", secure: process.env.COOKIE_SECURE === "1",
  previewApi: process.env.SC_PREVIEW_API === "1", requireTrackKey: process.env.TRACK_KEY_REQUIRED !== "0",
});
const n = await seedStaff(core);
serve({ fetch: app.fetch, port }, () => console.log(`Siracusa: http://localhost:${port}  (dist: ${process.env.DIST_DIR || "dist"}, staff accounts from .env: ${n})` + (process.env.SC_PREVIEW_API === "1" ? "  [SC_PREVIEW_API: test mode]" : "")));
