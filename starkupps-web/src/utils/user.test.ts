import { describe, expect, it } from "vitest";

import { displayName, initialsOf } from "./user";

describe("displayName", () => {
  it("prefers full_name from metadata", () => {
    expect(displayName({ user_metadata: { full_name: "Aman Kumar" }, email: "a@b.co" })).toBe(
      "Aman Kumar",
    );
  });

  it("falls back to name, then the email local-part", () => {
    expect(displayName({ user_metadata: { name: "Aman" }, email: "a@b.co" })).toBe("Aman");
    expect(displayName({ email: "aman@example.com" })).toBe("aman");
  });

  it("falls back to phone, then to a generic label", () => {
    expect(displayName({ phone: "9876543210" })).toBe("9876543210");
    expect(displayName({})).toBe("StarKupps fan");
  });

  it("ignores blank metadata strings", () => {
    expect(displayName({ user_metadata: { full_name: "   " }, email: "a@b.co" })).toBe("a");
  });
});

describe("initialsOf", () => {
  it("uses at most two initials, uppercased", () => {
    expect(initialsOf("Aman Kumar Sharma")).toBe("AK");
    expect(initialsOf("aman")).toBe("A");
    expect(initialsOf("a b c")).toBe("AB");
  });

  it("returns an empty string for an empty name", () => {
    expect(initialsOf("")).toBe("");
    expect(initialsOf("   ")).toBe("");
  });
});
