import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "../auth/auth";

/**
 * The post-login `returnTo` value is attacker-controlled: it arrives in a URL
 * on a page reached by a crafted link. If it is not constrained to a
 * same-origin path, login becomes an open redirect that lends the phishing page
 * the credibility of the real login form.
 */
describe("sanitizeReturnTo (open redirect defence)", () => {
  it("accepts ordinary in-app paths", () => {
    expect(sanitizeReturnTo("/orders")).toBe("/orders");
    expect(sanitizeReturnTo("/inventory/materials")).toBe(
      "/inventory/materials"
    );
    expect(sanitizeReturnTo("/orders/42?tab=history#top")).toBe(
      "/orders/42?tab=history#top"
    );
  });

  it("rejects absolute and protocol-relative URLs", () => {
    for (const bad of [
      "https://evil.com",
      "http://evil.com/path",
      "//evil.com",
      "//evil.com/path",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:a@b.com",
      "vbscript:msgbox(1)",
    ]) {
      expect(sanitizeReturnTo(bad), bad).toBeNull();
    }
  });

  it("rejects percent-encoded and double-encoded bypasses", () => {
    for (const bad of [
      "/%2F%2Fevil.com", // encoded protocol-relative
      "/%252F%252Fevil.com", // double encoded
      "/%09/evil.com",
      "/\\evil.com", // backslash treated as slash by some browsers
      "/%5C%5Cevil.com",
      "/%5cevil.com",
      "/%00/evil.com",
    ]) {
      expect(sanitizeReturnTo(bad), bad).toBeNull();
    }
  });

  it("rejects redirects back into the auth flow (no loops)", () => {
    for (const bad of [
      "/auth/login",
      "/auth/reset-password",
      "/auth/logout",
      "/auth/forgot-password",
    ]) {
      expect(sanitizeReturnTo(bad), bad).toBeNull();
    }
  });

  it("rejects empty, null and non-path input", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
    expect(sanitizeReturnTo(undefined)).toBeNull();
    expect(sanitizeReturnTo("")).toBeNull();
    expect(sanitizeReturnTo("orders")).toBeNull(); // relative, no leading slash
    expect(sanitizeReturnTo("   /orders")).toBeNull();
  });

  it("never returns a value that would leave the origin", () => {
    const samples = [
      "/orders",
      "//evil.com",
      "https://evil.com",
      "/%2F%2Fevil.com",
      "/\\evil.com",
      "/auth/login",
      "/a?next=//evil.com",
      "/a#//evil.com",
    ];
    for (const s of samples) {
      const out = sanitizeReturnTo(s);
      if (out === null) continue;
      // Anything returned must still be a same-origin relative reference.
      expect(out.startsWith("/"), `${s} -> ${out}`).toBe(true);
      expect(out.startsWith("//"), `${s} -> ${out}`).toBe(false);
      expect(out, `${s} -> ${out}`).not.toContain("://");
      expect(new URL(out, "https://app.example.com").origin).toBe(
        "https://app.example.com"
      );
    }
  });
});
