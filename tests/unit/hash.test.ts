import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { webHasher } from "../../src/client/api.ts";
import { scryptHasher } from "../../server/hasher.ts";

describe("password hashing", () => {
  it("demo: PBKDF2 hashes made at build (node crypto) verify in the browser (WebCrypto)", async () => {
    const salt = "abc123", hash = crypto.pbkdf2Sync("secret-pass-123", salt, 120000, 32, "sha256").toString("hex");
    expect(await webHasher.verify("secret-pass-123", salt, hash, "pbkdf2")).toBe(true);
    expect(await webHasher.verify("wrong", salt, hash, "pbkdf2")).toBe(false);
  });
  it("server: scrypt with salt", async () => {
    const h = await scryptHasher.hash("secret-pass-123");
    expect(h.algo).toBe("scrypt");
    expect(h.hash).not.toContain("secret");
    expect(await scryptHasher.verify("secret-pass-123", h.salt, h.hash, "scrypt")).toBe(true);
    expect(await scryptHasher.verify("nope", h.salt, h.hash, "scrypt")).toBe(false);
  });
});
