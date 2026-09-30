import { describe, expect, it } from "vitest";

import { inr, slugify } from "@/utils/format";

describe("inr", () => {
  it("renders whole paise as rupees", () => {
    expect(inr(0)).toBe("₹0");
    expect(inr(14000)).toBe("₹14,000");
  });

  it("groups thousands the Indian way", () => {
    expect(inr(140000)).toBe("₹1,40,000");
    expect(inr(12345678)).toBe("₹1,23,45,678");
  });

  it("never shows decimals — money is paise end to end", () => {
    expect(inr(1450.4)).toBe("₹1,450");
    expect(inr(1450.6)).toBe("₹1,451");
  });
});

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Cold Coffee")).toBe("cold-coffee");
    expect(slugify("BURGERS")).toBe("burgers");
  });

  it("collapses runs of whitespace", () => {
    expect(slugify("Pizza   &   More")).toBe("pizza-&-more");
  });

  it("is idempotent for an already-slugged value", () => {
    expect(slugify("hand-stretched pizza")).toBe("hand-stretched-pizza");
    expect(slugify(slugify("Hand Stretched Pizza"))).toBe("hand-stretched-pizza");
  });
});
