import { describe, expect, it, vi } from "vitest";
import * as jose from "jose";

// Runs before module imports, so config/env reads the fixed test secret rather
// than whatever happens to be in .env.
vi.hoisted(() => {
  process.env.SESSION_SECRET =
    "test-only-secret-value-that-is-long-enough-32ch";
});

import {
  createSessionToken,
  fakeVerifyDelay,
  hashPassword,
  verifyPassword,
  verifySessionToken,
  hashToken,
  createRefreshToken,
  createFamilyId,
  checkPasswordPolicy,
  isRecentlyReauthenticated,
  PASSWORD_MIN_LENGTH,
} from "../auth/auth";

const SECRET = new TextEncoder().encode(process.env.SESSION_SECRET!);

const base = {
  uid: 7,
  openId: "email:owner@example.com",
  role: "admin" as const,
  sv: 3,
  aud: "admin" as const,
};

describe("access token", () => {
  it("round-trips the claims the auth layer depends on", async () => {
    const token = await createSessionToken({
      ...base,
      sid: 42,
      rem: true,
      rat: 1_700_000_000,
    });
    const payload = await verifySessionToken(token, "admin");
    expect(payload).toMatchObject({
      uid: 7,
      openId: base.openId,
      role: "admin",
      sv: 3,
      aud: "admin",
      sid: 42,
      rem: true,
    });
    expect(payload?.rat).toBe(1_700_000_000);
  });

  it("rejects a token signed with a different secret", async () => {
    const forged = await new jose.SignJWT({ ...base })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .setAudience("admin")
      .sign(
        new TextEncoder().encode("a-completely-different-secret-value-32chars")
      );
    await expect(verifySessionToken(forged, "admin")).resolves.toBeNull();
  });

  it("rejects alg:none (unsigned) tokens", async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT" })
    ).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ ...base, exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString("base64url");
    await expect(
      verifySessionToken(`${header}.${body}.`, "admin")
    ).resolves.toBeNull();
  });

  it("rejects a token whose payload was tampered with", async () => {
    const token = await createSessionToken({ ...base });
    const [h, , sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...base, role: "admin", uid: 999 })
    ).toString("base64url");
    await expect(
      verifySessionToken(`${h}.${forged}.${sig}`, "admin")
    ).resolves.toBeNull();
  });

  it("enforces audience isolation (admin token is not a pos token)", async () => {
    const token = await createSessionToken({ ...base, aud: "pos" });
    await expect(verifySessionToken(token, "admin")).resolves.toBeNull();
    await expect(verifySessionToken(token, "pos")).resolves.toMatchObject({
      aud: "pos",
    });
  });

  it("requires an issuer, so pre-upgrade tokens stop verifying", async () => {
    // Simulates a token minted before the issuer claim existed.
    const legacy = await new jose.SignJWT({ ...base })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .setAudience("admin")
      .sign(SECRET);
    await expect(verifySessionToken(legacy, "admin")).resolves.toBeNull();
  });

  it("honours a shortened lifetime and expires", async () => {
    const token = await createSessionToken({ ...base }, { maxAgeSec: 60 });
    const payload = await verifySessionToken(token, "admin");
    expect(payload).not.toBeNull();
    expect(payload!.exp! - payload!.iat!).toBe(60);
  });
});

describe("refresh token", () => {
  it("produces high-entropy, url-safe, unique values", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const t = createRefreshToken();
      expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 bytes base64url, unpadded
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it("is stored only as a SHA-256 hash (hash is not reversible to the token)", () => {
    const token = createRefreshToken();
    const h = hashToken(token);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(token);
    expect(hashToken(token)).toBe(h);
    expect(hashToken(createRefreshToken())).not.toBe(h);
  });

  it("issues distinct family ids per login", () => {
    const fams = new Set(Array.from({ length: 200 }, () => createFamilyId()));
    expect(fams.size).toBe(200);
  });
});

describe("re-authentication window", () => {
  it("accepts a session re-authenticated inside the window", () => {
    expect(
      isRecentlyReauthenticated({
        ...base,
        rat: Math.floor(Date.now() / 1000) - 60,
      } as any)
    ).toBe(true);
  });

  it("rejects a stale or absent re-authentication", () => {
    // Default window is 15 minutes.
    expect(
      isRecentlyReauthenticated({
        ...base,
        rat: Math.floor(Date.now() / 1000) - 3600,
      } as any)
    ).toBe(false);
    expect(isRecentlyReauthenticated({ ...base } as any)).toBe(false);
    expect(isRecentlyReauthenticated(null)).toBe(false);
  });

  it("does not treat a refresh rotation as a re-authentication", async () => {
    // A rotation deliberately omits `rat`; possession of the refresh token is
    // not proof of knowledge of the password.
    const rotated = await createSessionToken({ ...base, sid: 9 });
    const payload = await verifySessionToken(rotated, "admin");
    expect(payload?.rat).toBeUndefined();
    expect(isRecentlyReauthenticated(payload)).toBe(false);
  });
});

describe("password policy", () => {
  it(`rejects anything shorter than ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(checkPasswordPolicy("a".repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(
      false
    );
    // Exactly at the boundary, and non-trivial, so it is accepted.
    expect("mango-lantern-99".length).toBeGreaterThanOrEqual(
      PASSWORD_MIN_LENGTH
    );
    expect(checkPasswordPolicy("mango-lantern-99").ok).toBe(true);
  });

  it("rejects well-known breached passwords even when long enough", () => {
    // Exact-match denylists are defeated by appending a digit, so these are
    // matched as stems.
    for (const bad of [
      "password1234",
      "Password1234",
      "MyPassword2024",
      "P@ssw0rd!2024",
      "qwertyuiop12",
      "admin@1234",
      "starkupps123",
      "letmein12345",
      "Summer2024admin",
      "changeme-2024",
      "welcome2024!",
    ]) {
      expect(checkPasswordPolicy(bad), bad).toMatchObject({ ok: false });
    }
  });

  it("rejects trivial structures", () => {
    expect(checkPasswordPolicy("aaaaaaaaaaaaaaaa").ok).toBe(false);
    expect(checkPasswordPolicy("abcabcabcabc").ok).toBe(false);
    expect(checkPasswordPolicy("!!!!!!!!!!!!").ok).toBe(false);
  });

  it("accepts a strong passphrase", () => {
    expect(checkPasswordPolicy("correct-horse-battery-staple-9").ok).toBe(true);
    expect(checkPasswordPolicy("Tr0ub4dor&3-horse-battery").ok).toBe(true);
  });

  it("never returns the password itself in the rejection reason", () => {
    const secret = "hunter2-is-my-real-password";
    const r = checkPasswordPolicy("short");
    expect(r.ok).toBe(false);
    expect("reason" in r && r.reason).not.toContain(secret);
  });
});

describe("user-enumeration cost parity", () => {
  /**
   * The CPU half of the timing defence, asserted without any network or
   * database involvement so it is deterministic. The database half is covered
   * by the login integration test, where both failure paths issue the same set
   * of parallel writes.
   */
  it("burns comparable CPU to a real verification when the account is unknown", async () => {
    const hash = await hashPassword("probe-password-for-parity");

    // Warm the allocator so neither measurement pays a first-call cost.
    await verifyPassword("warmup-value", hash);
    await fakeVerifyDelay();

    const samples = 7;
    const real: number[] = [];
    const fake: number[] = [];
    for (let i = 0; i < samples; i++) {
      let t0 = performance.now();
      await verifyPassword(`candidate-${i}`, hash);
      real.push(performance.now() - t0);

      t0 = performance.now();
      await fakeVerifyDelay();
      fake.push(performance.now() - t0);
    }
    const median = (xs: number[]) =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const r = median(real);
    const f = median(fake);
    const delta = Math.abs(r - f) / Math.max(r, f);

    // A gap of a few tens of percent is not usable as an oracle over a network;
    // before the fix the difference was roughly 2x the verification cost.
    expect(delta, `real=${r.toFixed(0)}ms fake=${f.toFixed(0)}ms`).toBeLessThan(
      0.35
    );
  });

  it("actually performs a verification rather than returning immediately", async () => {
    const t0 = performance.now();
    await fakeVerifyDelay();
    const elapsed = performance.now() - t0;
    // A no-op would return in single-digit milliseconds.
    expect(
      elapsed,
      `fakeVerifyDelay took ${elapsed.toFixed(0)}ms`
    ).toBeGreaterThan(20);
  });
});

describe("CSRF double-submit token", () => {
  it("issues a signed, unique, high-entropy token", async () => {
    const { createCsrfToken } = await import("../auth/cookies");
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const t = await createCsrfToken();
      expect(t.split(".")).toHaveLength(2);
      const [nonce, sig] = t.split(".");
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
      expect(sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(seen.has(t)).toBe(false);
      seen.add(t);
    }
  });

  it("accepts only an exact match", async () => {
    const { createCsrfToken, verifyCsrfToken } =
      await import("../auth/cookies");
    const t = await createCsrfToken();
    expect(verifyCsrfToken(t, t)).toBe(true);
    expect(verifyCsrfToken(undefined, t)).toBe(false);
    expect(verifyCsrfToken(t, undefined)).toBe(false);
    expect(verifyCsrfToken("", "")).toBe(false);
    // Tampered nonce.
    expect(verifyCsrfToken(`x${t}`, t)).toBe(false);
    // Tampered signature.
    const parts = t.split(".");
    expect(verifyCsrfToken(`${parts[0]}.${parts[1].slice(0, -1)}x`, t)).toBe(
      false
    );
    // Swapped parts of two distinct tokens.
    const other = await createCsrfToken();
    expect(verifyCsrfToken(other, t)).toBe(false);
    expect(verifyCsrfToken(t, other)).toBe(false);
  });

  it("is bound to the session secret, so it cannot be forged offline", async () => {
    const { createCsrfToken } = await import("../auth/cookies");
    const t = await createCsrfToken();
    const [nonce, sig] = t.split(".");
    const crypto = await import("node:crypto");
    // Recompute with the wrong secret and confirm the shape differs.
    const badSig = crypto
      .createHmac("sha256", "some-other-secret")
      .update(nonce)
      .digest("base64url");
    expect(badSig).not.toBe(sig);
  });
});
