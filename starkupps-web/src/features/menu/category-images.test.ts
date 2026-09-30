import { describe, expect, it } from "vitest";

import { categoryImage, CATEGORY_FALLBACK_IMAGES } from "./category-images";

describe("categoryImage", () => {
  it("resolves an exact slug", () => {
    expect(categoryImage("coffee")).toBe(CATEGORY_FALLBACK_IMAGES["coffee"]);
    expect(categoryImage("pizza")).toBe(CATEGORY_FALLBACK_IMAGES["pizza"]);
    expect(categoryImage("burgers")).toBe(CATEGORY_FALLBACK_IMAGES["burgers"]);
  });

  it("falls back to the first segment for longer slugs", () => {
    expect(categoryImage("cold-coffee")).toBe(CATEGORY_FALLBACK_IMAGES["coffee"]);
    expect(categoryImage("burgers-and-more")).toBe(CATEGORY_FALLBACK_IMAGES["burgers"]);
  });

  it("always returns an image, even for an unknown slug", () => {
    expect(categoryImage("mystery")).toBe(CATEGORY_FALLBACK_IMAGES["coffee"]);
  });
});
