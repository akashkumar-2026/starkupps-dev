import { describe, expect, it } from "vitest";

import { checkPassword, friendlyAuthError, isValidEmail } from "./validation";

describe("isValidEmail", () => {
  it.each(["a@b.co", "first.last@example.com", "user+tag@sub.domain.org"])(
    "accepts %s",
    (email) => {
      expect(isValidEmail(email)).toBe(true);
    },
  );

  it.each(["", "no-at-sign", "missing@tld", "@example.com", "spaces in@mail.com"])(
    "rejects %s",
    (email) => {
      expect(isValidEmail(email)).toBe(false);
    },
  );

  it("ignores surrounding whitespace", () => {
    expect(isValidEmail("  a@b.co  ")).toBe(true);
  });
});

describe("checkPassword", () => {
  it("requires at least 8 characters", () => {
    expect(checkPassword("Ab1")).toEqual({ ok: false, reason: "Use at least 8 characters" });
  });

  it("requires both letters and numbers", () => {
    expect(checkPassword("abcdefgh")).toEqual({
      ok: false,
      reason: "Include both letters and numbers",
    });
    expect(checkPassword("12345678")).toEqual({
      ok: false,
      reason: "Include both letters and numbers",
    });
  });

  it("accepts a compliant password", () => {
    expect(checkPassword("abcd1234")).toEqual({ ok: true });
    expect(checkPassword("StarKupps2026")).toEqual({ ok: true });
  });
});

describe("friendlyAuthError", () => {
  it("maps bad credentials to an actionable message", () => {
    expect(friendlyAuthError(new Error("Invalid login credentials"))).toMatch(/incorrect email/i);
  });

  it("maps an existing account to a sign-in suggestion", () => {
    expect(friendlyAuthError(new Error("User already registered"))).toMatch(/signing in/i);
  });

  it("maps an expired reset link", () => {
    expect(friendlyAuthError(new Error("Token has expired"))).toMatch(/expired/i);
  });

  it("maps network failures", () => {
    expect(friendlyAuthError(new Error("fetch failed"))).toMatch(/connection/i);
  });

  it("falls back to the raw message, then to a generic one", () => {
    expect(friendlyAuthError(new Error("Something unusual"))).toBe("Something unusual");
    expect(friendlyAuthError(undefined)).toBe("Something went wrong. Please try again.");
  });
});
