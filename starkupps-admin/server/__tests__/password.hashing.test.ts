import { describe, expect, it } from "vitest";
import { hashPassword, isHashedPassword, verifyPassword } from "../auth/auth";

describe("password hashing", () => {
  it("verifies a password against a freshly generated Argon2id hash", async () => {
    const hash = await hashPassword("CorrectHorseBattery9");
    expect(isHashedPassword(hash)).toBe(true);
    await expect(verifyPassword("CorrectHorseBattery9", hash)).resolves.toBe(
      true
    );
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("still verifies legacy scrypt hashes", async () => {
    const { scryptSync, randomBytes } = await import("node:crypto");
    const salt = randomBytes(16).toString("hex");
    const legacy = `scrypt:${salt}:${scryptSync("LegacyPass1", salt, 64).toString("hex")}`;
    await expect(verifyPassword("LegacyPass1", legacy)).resolves.toBe(true);
    await expect(verifyPassword("nope", legacy)).resolves.toBe(false);
  });
});
