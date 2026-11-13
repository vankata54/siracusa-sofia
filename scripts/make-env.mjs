// Creates .env with random strong passwords, only if .env does not exist. Never prints the passwords or keys.
// An existing .env is left as it is; only keys added later (the VAPID keys for Web Push) are appended when missing.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
const file = path.resolve(process.cwd(), ".env");
const pw = () => crypto.randomBytes(15).toString("base64url");
/* VAPID (Web Push): a P-256 key pair; the public key goes to the browser, the private key never leaves the server */
function vapid() {
  const e = crypto.createECDH("prime256v1");
  e.generateKeys();
  return [`VAPID_PUBLIC_KEY=${e.getPublicKey().toString("base64url")}`, `VAPID_PRIVATE_KEY=${e.getPrivateKey().toString("base64url")}`];
}
if (fs.existsSync(file)) {
  const have = fs.readFileSync(file, "utf8");
  if (/^VAPID_PRIVATE_KEY=/m.test(have)) { console.log(".env exists, left as is"); process.exit(0); }
  fs.appendFileSync(file, (have.endsWith("\n") ? "" : "\n") + "# Web Push (order status). Secret: never commit.\n" + vapid().join("\n") + "\n");
  console.log(".env exists: added the VAPID keys for Web Push (the rest is left as is)");
  process.exit(0);
}
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
  "# Web Push (order status). Secret: never commit.",
  ...vapid(),
  "",
].join("\n");
fs.writeFileSync(file, body, { mode: 0o600 });
console.log(".env created with random passwords and VAPID keys (see the file, do not commit it)");
