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
  let have = fs.readFileSync(file, "utf8");
  const added = [];
  const add = (text) => { have += (have.endsWith("\n") ? "" : "\n") + text + "\n"; fs.writeFileSync(file, have, { mode: 0o600 }); };
  if (!/^VAPID_PRIVATE_KEY=/m.test(have)) { add("# Web Push (order status). Secret: never commit.\n" + vapid().join("\n")); added.push("the VAPID keys for Web Push"); }
  if (!/^MARKETING_PASSWORD=/m.test(have)) { add(`MARKETING_PASSWORD=${pw()}`); added.push("the marketing account"); }
  console.log(added.length ? ".env exists: added " + added.join(" and ") + " (the rest is left as is)" : ".env exists, left as is");
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
  `MARKETING_PASSWORD=${pw()}`,
  "# Web Push (order status). Secret: never commit.",
  ...vapid(),
  "",
].join("\n");
fs.writeFileSync(file, body, { mode: 0o600 });
console.log(".env created with random passwords and VAPID keys (see the file, do not commit it)");
