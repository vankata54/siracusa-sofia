// Tiny .env reader shared by the build scripts (no dependency). Never prints values.
import fs from "node:fs";
import path from "node:path";
export function readEnv(file = path.resolve(process.cwd(), ".env")) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}
/* staff accounts: username, display name, role, env key of the password */
export const STAFF = [
  ["ADMIN_USER", "Главен админ", "admin", "ADMIN_PASSWORD"],
  ["owner", "Собственик", "owner", "OWNER_PASSWORD"],
  ["manager", "Управител", "manager", "MANAGER_PASSWORD"],
  ["waiter", "Сервитьор", "waiter", "WAITER_PASSWORD"],
  ["kitchen", "Кухня", "kitchen", "KITCHEN_PASSWORD"],
  ["driver", "Шофьор", "driver", "DRIVER_PASSWORD"],
];
export function staffFromEnv(env) {
  return STAFF.map(([u, name, role, key]) => ({ username: u === "ADMIN_USER" ? env.ADMIN_USER || "admin" : u, name, role, password: env[key] }))
    .filter((s) => s.password);
}
