// Creates .env with random strong passwords, only if .env does not exist. Never prints the passwords.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const file = path.resolve(process.cwd(), ".env");
if (fs.existsSync(file)) { console.log(".env exists, left as is"); process.exit(0); }
const pw = () => crypto.randomBytes(15).toString("base64url");
const body = [
  "# Local secrets. Never commit this file (.gitignore). Passwords are given to Poli in the chat.",
  "PORT=8787",
  "SITE_URL=https://siracusa-sofia.com",
  "DB_FILE=data/siracusa.db",
  "ADMIN_USER=admin",
  `ADMIN_PASSWORD=${pw()}`,
  `OWNER_PASSWORD=${pw()}`,
  `MANAGER_PASSWORD=${pw()}`,
  `WAITER_PASSWORD=${pw()}`,
  `KITCHEN_PASSWORD=${pw()}`,
  `DRIVER_PASSWORD=${pw()}`,
  "",
].join("\n");
fs.writeFileSync(file, body, { mode: 0o600 });
console.log(".env created with random passwords (see the file, do not commit it)");
