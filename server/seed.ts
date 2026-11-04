/* Seeds staff accounts from .env (passwords hashed with scrypt; never stored in git) and the menu.
   Run: npm run db:seed   (the server also runs it on start, so new .env passwords apply after a restart). */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Core, RoleId } from "../src/core/index.ts";

export async function seedStaff(core: Core): Promise<number> {
  const { staffFromEnv } = await import(pathToFileURL(path.resolve("scripts/env.mjs")).href);
  const list = staffFromEnv(process.env) as { username: string; name: string; role: RoleId; password: string }[];
  for (const s of list) await core.staff.upsert(s);
  return list.length;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const { createApp } = await import("./app.ts");
  const { core, sqlite } = createApp({ dbFile: process.env.DB_FILE || "data/siracusa.db", distDir: "dist" });
  const n = await seedStaff(core);
  console.log(`seeded: menu + ${n} staff accounts (usernames: ${(await core.staff.list()).map((u) => u.username).join(", ")})`);
  sqlite.close();
}
