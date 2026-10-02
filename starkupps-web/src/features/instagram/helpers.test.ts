import { describe, expect, it } from "vitest";

import { instagramEmbedUrl, marqueeDurationSeconds, SCROLL_SECONDS_PER_ITEM } from "./helpers";

describe("instagramEmbedUrl", () => {
  it("uses the /p/ segment for posts", () => {
    expect(instagramEmbedUrl("ABC123", "post")).toBe("https://www.instagram.com/p/ABC123/embed/");
  });

  it("uses the /reel/ segment for reels", () => {
    expect(instagramEmbedUrl("ABC123", "reel")).toBe(
      "https://www.instagram.com/reel/ABC123/embed/",
    );
  });

  it("encodes shortcodes that need it", () => {
    expect(instagramEmbedUrl("a b/c", "post")).toContain("a%20b%2Fc");
  });
});

describe("marqueeDurationSeconds", () => {
  it("scales linearly with the number of cards", () => {
    const perItem = SCROLL_SECONDS_PER_ITEM.normal;
    expect(marqueeDurationSeconds("normal", 1)).toBe(Math.round(perItem));
    expect(marqueeDurationSeconds("normal", 4)).toBe(Math.round(perItem * 4));
    expect(marqueeDurationSeconds("normal", 8)).toBe(Math.round(perItem * 8));
  });

  it("honours the configured speed", () => {
    expect(marqueeDurationSeconds("slow", 2)).toBeGreaterThan(marqueeDurationSeconds("fast", 2));
  });

  it("never drops below the 6s floor", () => {
    expect(marqueeDurationSeconds("fast", 0)).toBeGreaterThanOrEqual(6);
    expect(marqueeDurationSeconds("fast", -5)).toBeGreaterThanOrEqual(6);
  });

  it("survives a non-finite count", () => {
    expect(marqueeDurationSeconds("normal", Number.NaN)).toBeGreaterThanOrEqual(6);
  });
});
