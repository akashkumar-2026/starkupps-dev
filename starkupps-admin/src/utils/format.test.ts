import { describe, expect, it } from "vitest";

import { cn } from "@/utils/cn";
import { apiError } from "@/utils/errors";
import { dateText, inr, timeLabel } from "@/utils/format";
import { modifierNames } from "@/features/orders/order-ui";

describe("inr", () => {
  it("formats rupees without decimals", () => {
    expect(inr(1234)).toContain("1,234");
    expect(inr(1234)).not.toContain(".");
  });

  it("treats null and undefined as zero rather than NaN", () => {
    expect(inr(null)).toBe(inr(0));
    expect(inr(undefined)).toBe(inr(0));
  });
});

describe("timeLabel", () => {
  it("returns an em dash for a missing value", () => {
    expect(timeLabel(null)).toBe("—");
    expect(timeLabel(undefined)).toBe("—");
  });

  it("returns an em dash for an unparseable value", () => {
    expect(timeLabel("not-a-date")).toBe("—");
  });

  it("formats a valid date", () => {
    expect(timeLabel(new Date("2026-01-02T15:04:00Z"))).toMatch(/\d/);
  });
});

describe("dateText", () => {
  it("returns an em dash for a missing value", () => {
    expect(dateText(null)).toBe("—");
  });

  it("includes the year for a valid date", () => {
    expect(dateText("2026-03-04")).toContain("2026");
  });
});

describe("apiError", () => {
  it("prefers the error message", () => {
    expect(apiError(new Error("Outlet not found"))).toBe("Outlet not found");
  });

  it("accepts a plain object with a message", () => {
    expect(apiError({ message: "rate limited" })).toBe("rate limited");
  });

  it("falls back when there is no usable message", () => {
    expect(apiError(new Error(""))).toMatch(/could not complete/i);
    expect(apiError(null)).toMatch(/could not complete/i);
    expect(apiError(undefined, "custom")).toBe("custom");
  });
});

describe("cn", () => {
  it("merges conflicting tailwind classes so the last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("keeps classes that do not conflict", () => {
    expect(cn("text-sm", "font-bold")).toBe("text-sm font-bold");
  });
});

describe("modifierNames", () => {
  // selectedModifiers is a free-form JSON column, so legacy rows can hold the
  // string "[]" rather than an array. Neither shape should crash the dialog.
  it("reads an array of modifiers", () => {
    expect(
      modifierNames({ selectedModifiers: [{ name: "Oat" }, { name: "" }] })
    ).toEqual(["Oat"]);
  });

  it("parses a JSON string", () => {
    expect(modifierNames({ selectedModifiers: '[{"name":"Oat"}]' })).toEqual([
      "Oat",
    ]);
  });

  it("returns an empty list for a malformed string", () => {
    expect(modifierNames({ selectedModifiers: "[not json" })).toEqual([]);
  });

  it("returns an empty list when the column is absent or null", () => {
    expect(modifierNames({})).toEqual([]);
    expect(modifierNames({ selectedModifiers: null })).toEqual([]);
    expect(modifierNames(null)).toEqual([]);
  });
});
