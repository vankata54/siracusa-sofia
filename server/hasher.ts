/* Password hashing on the server: scrypt (built into Node, no native module), random 16-byte salt. */
import crypto from "node:crypto";
import { promisify } from "node:util";
import type { Hasher } from "../src/core/ctx.ts";

const scrypt = promisify(crypto.scrypt) as (p: string, s: string, n: number, o: crypto.ScryptOptions) => Promise<Buffer>;
const OPTS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const scryptHasher: Hasher = {
  async hash(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const key = await scrypt(password, salt, 64, OPTS);
    return { salt, hash: key.toString("hex"), algo: "scrypt" };
  },
  async verify(password, salt, hash, algo) {
    if (algo === "pbkdf2") {
      const key = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256");
      return crypto.timingSafeEqual(key, Buffer.from(hash, "hex"));
    }
    const key = await scrypt(password, salt, 64, OPTS);
    const ref = Buffer.from(hash, "hex");
    return ref.length === key.length && crypto.timingSafeEqual(key, ref);
  },
};
