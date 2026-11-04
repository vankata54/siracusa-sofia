/* Start: npm run serve (after npm run build). Reads .env; port 8787 by default. */
import fs from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { seedStaff } from "./seed.ts";

if (fs.existsSync(".env")) process.loadEnvFile(".env");
const port = +(process.env.PORT || 8787);
const { app, core } = createApp({ dbFile: process.env.DB_FILE || "data/siracusa.db", distDir: process.env.DIST_DIR || "dist", secure: process.env.COOKIE_SECURE === "1" });
const n = await seedStaff(core);
serve({ fetch: app.fetch, port }, (i) => console.log(`Siracusa: http://localhost:${i.port}  (staff accounts from .env: ${n})`));
