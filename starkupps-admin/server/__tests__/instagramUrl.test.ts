import { describe, expect, it } from "vitest";
import {
  instagramEmbedUrl,
  isInstagramProfileUrl,
  marqueeDurationSeconds,
  parseInstagramUrl,
  resolveProfileUrl,
  sanitizeProfileHandle,
  sanitizeText,
} from "@shared/instagram";

describe("parseInstagramUrl — accepted shapes", () => {
  it("parses a /p/ permalink as a post and normalises to www", () => {
    const result = parseInstagramUrl("https://www.instagram.com/p/ABC123xyz/");
    expect(result).toEqual({
      ok: true,
      shortcode: "ABC123xyz",
      type: "post",
      url: "https://www.instagram.com/p/ABC123xyz/",
    });
  });

  it("parses a /reel/ permalink as a reel", () => {
    const result = parseInstagramUrl(
      "https://www.instagram.com/reel/C1ffee99/"
    );
    expect(result).toMatchObject({
      ok: true,
      shortcode: "C1ffee99",
      type: "reel",
    });
  });

  it("treats /reels/ as a reel and collapses it to /reel/", () => {
    const result = parseInstagramUrl(
      "https://www.instagram.com/reels/R33l_abc/"
    );
    expect(result).toEqual({
      ok: true,
      shortcode: "R33l_abc",
      type: "reel",
      url: "https://www.instagram.com/reel/R33l_abc/",
    });
  });

  it("treats /tv/ as a reel and collapses it to /reel/", () => {
    const result = parseInstagramUrl("https://www.instagram.com/tv/IGTVabc_1/");
    expect(result).toEqual({
      ok: true,
      shortcode: "IGTVabc_1",
      type: "reel",
      url: "https://www.instagram.com/reel/IGTVabc_1/",
    });
  });

  it("accepts a link without the www host", () => {
    expect(
      parseInstagramUrl("https://instagram.com/p/NoWwW123/")
    ).toMatchObject({
      ok: true,
      shortcode: "NoWwW123",
      url: "https://www.instagram.com/p/NoWwW123/",
    });
  });

  it("accepts http as well as https", () => {
    expect(parseInstagramUrl("http://instagram.com/p/Plain123/")).toMatchObject(
      {
        ok: true,
        shortcode: "Plain123",
      }
    );
  });

  it("accepts a scheme-less paste", () => {
    expect(parseInstagramUrl("instagram.com/p/Schemeless1/")).toMatchObject({
      ok: true,
      shortcode: "Schemeless1",
    });
  });

  it("ignores a query string", () => {
    expect(
      parseInstagramUrl(
        "https://www.instagram.com/p/Queried1/?utm_source=ig_web_copy_link&hl=en"
      )
    ).toMatchObject({
      ok: true,
      shortcode: "Queried1",
      url: "https://www.instagram.com/p/Queried1/",
    });
  });

  it("ignores a hash fragment", () => {
    expect(
      parseInstagramUrl("https://www.instagram.com/reel/Hashed01/#comments")
    ).toMatchObject({ ok: true, shortcode: "Hashed01" });
  });

  it("ignores extra trailing path segments from share links", () => {
    expect(
      parseInstagramUrl("https://www.instagram.com/p/DeepLink1/comments/")
    ).toMatchObject({ ok: true, shortcode: "DeepLink1", type: "post" });
  });

  it("tolerates a missing trailing slash", () => {
    expect(
      parseInstagramUrl("https://www.instagram.com/p/NoSlash01")
    ).toMatchObject({ ok: true, shortcode: "NoSlash01" });
  });

  it("is case-insensitive on the host and the path keyword", () => {
    expect(
      parseInstagramUrl("https://WWW.Instagram.COM/P/Upper01/")
    ).toMatchObject({ ok: true, shortcode: "Upper01", type: "post" });
  });

  it("trims surrounding whitespace", () => {
    expect(
      parseInstagramUrl("   https://www.instagram.com/p/Spaces01/   ")
    ).toMatchObject({ ok: true, shortcode: "Spaces01" });
  });

  it("accepts shortcodes containing underscores and hyphens", () => {
    expect(
      parseInstagramUrl("https://www.instagram.com/p/a_b-c-123/")
    ).toMatchObject({ ok: true, shortcode: "a_b-c-123" });
  });
});

describe("parseInstagramUrl — rejected shapes", () => {
  it("rejects an empty string", () => {
    expect(parseInstagramUrl("")).toMatchObject({ ok: false });
  });

  it("rejects a whitespace-only string", () => {
    expect(parseInstagramUrl("   ")).toMatchObject({ ok: false });
  });

  it("rejects a non-string input", () => {
    expect(parseInstagramUrl(null)).toMatchObject({ ok: false });
    expect(parseInstagramUrl(42)).toMatchObject({ ok: false });
    expect(parseInstagramUrl(undefined)).toMatchObject({ ok: false });
  });

  it("rejects a look-alike host that merely ends in instagram.com text", () => {
    const result = parseInstagramUrl(
      "https://instagram.com.evil.example/p/Evil0001/"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/instagram\.com/i);
  });

  it("rejects a subdomain other than www", () => {
    expect(parseInstagramUrl("https://m.instagram.com/p/Sub000001/").ok).toBe(
      false
    );
  });

  it("rejects a non-instagram host", () => {
    expect(parseInstagramUrl("https://example.com/p/Other0001/").ok).toBe(
      false
    );
    expect(parseInstagramUrl("https://facebook.com/p/Other0001/").ok).toBe(
      false
    );
  });

  it("rejects a bare profile link", () => {
    expect(parseInstagramUrl("https://www.instagram.com/starkupps/").ok).toBe(
      false
    );
  });

  it("rejects a stories link", () => {
    expect(
      parseInstagramUrl("https://www.instagram.com/stories/starkupps/123/").ok
    ).toBe(false);
  });

  it("rejects an explore link", () => {
    expect(
      parseInstagramUrl("https://www.instagram.com/explore/tags/coffee/").ok
    ).toBe(false);
  });

  it("rejects a link with no shortcode", () => {
    expect(parseInstagramUrl("https://www.instagram.com/p/").ok).toBe(false);
    expect(parseInstagramUrl("https://www.instagram.com/reel/").ok).toBe(false);
    expect(parseInstagramUrl("https://www.instagram.com/p").ok).toBe(false);
  });

  it("rejects a shortcode containing markup or path traversal", () => {
    expect(parseInstagramUrl("https://www.instagram.com/p/<script>/").ok).toBe(
      false
    );
    expect(parseInstagramUrl("https://www.instagram.com/p/../../etc/").ok).toBe(
      false
    );
    expect(parseInstagramUrl("https://www.instagram.com/p/a%20b/").ok).toBe(
      false
    );
  });

  it("rejects a non-http protocol", () => {
    expect(parseInstagramUrl("javascript:alert(1)").ok).toBe(false);
    expect(parseInstagramUrl("ftp://instagram.com/p/Ftp00001/").ok).toBe(false);
  });

  it("rejects unparseable input", () => {
    expect(parseInstagramUrl("not a url at all").ok).toBe(false);
    expect(parseInstagramUrl("https://").ok).toBe(false);
  });
});

describe("instagramEmbedUrl", () => {
  it("builds the official embed endpoint for a post", () => {
    expect(instagramEmbedUrl("ABC123", "post")).toBe(
      "https://www.instagram.com/p/ABC123/embed/"
    );
  });

  it("builds the reel embed endpoint for a reel", () => {
    expect(instagramEmbedUrl("DEF456", "reel")).toBe(
      "https://www.instagram.com/reel/DEF456/embed/"
    );
  });

  it("url-encodes the shortcode", () => {
    expect(instagramEmbedUrl("a/b", "post")).toBe(
      "https://www.instagram.com/p/a%2Fb/embed/"
    );
  });
});

describe("sanitizeText", () => {
  it("returns null for blank input", () => {
    expect(sanitizeText("", 50)).toBeNull();
    expect(sanitizeText("   ", 50)).toBeNull();
    expect(sanitizeText(null, 50)).toBeNull();
    expect(sanitizeText(undefined, 50)).toBeNull();
    expect(sanitizeText(7, 50)).toBeNull();
  });

  it("strips control characters", () => {
    const nul = String.fromCharCode(0);
    expect(sanitizeText(`he${nul}llo${nul}world`, 50)).toBe("he llo world");
    expect(sanitizeText("tab\there", 50)).toBe("tab here");
    expect(sanitizeText("new\nline", 50)).toBe("new line");
  });

  it("collapses whitespace runs and trims", () => {
    expect(sanitizeText("  a   b \n c  ", 50)).toBe("a b c");
  });

  it("truncates to the supplied maximum", () => {
    expect(sanitizeText("abcdef", 3)).toBe("abc");
  });
});

describe("sanitizeProfileHandle", () => {
  it("normalises @handle, case and surrounding punctuation", () => {
    expect(sanitizeProfileHandle("@StarKupps")).toBe("starkupps");
    expect(sanitizeProfileHandle("  StarKupps  ")).toBe("starkupps");
    expect(sanitizeProfileHandle("@@starkupps")).toBe("starkupps");
  });

  it("strips spaces and illegal characters", () => {
    expect(sanitizeProfileHandle("star kupps")).toBe("starkupps");
    expect(sanitizeProfileHandle("star/kupps")).toBe("starkupps");
  });

  it("returns empty string when nothing usable remains", () => {
    expect(sanitizeProfileHandle("")).toBe("");
    expect(sanitizeProfileHandle("///")).toBe("");
    expect(sanitizeProfileHandle(null)).toBe("");
  });
});

describe("isInstagramProfileUrl", () => {
  it("accepts instagram.com hosts", () => {
    expect(isInstagramProfileUrl("https://instagram.com/starkupps")).toBe(true);
    expect(isInstagramProfileUrl("https://www.instagram.com/starkupps/")).toBe(
      true
    );
  });

  it("rejects anything else", () => {
    expect(isInstagramProfileUrl("https://example.com/starkupps")).toBe(false);
    expect(isInstagramProfileUrl("https://instagram.com.evil.example/x")).toBe(
      false
    );
    expect(isInstagramProfileUrl("")).toBe(false);
    expect(isInstagramProfileUrl(null)).toBe(false);
  });
});

describe("resolveProfileUrl", () => {
  it("derives the URL from the handle when none is stored", () => {
    expect(resolveProfileUrl("", "starkupps")).toBe(
      "https://www.instagram.com/starkupps/"
    );
    expect(resolveProfileUrl(null, "@StarKupps")).toBe(
      "https://www.instagram.com/starkupps/"
    );
  });

  it("normalises a stored instagram.com URL", () => {
    expect(
      resolveProfileUrl("https://instagram.com/starkupps/?hl=en", "starkupps")
    ).toBe("https://www.instagram.com/starkupps/");
  });

  it("falls back to the handle for an off-site URL", () => {
    expect(
      resolveProfileUrl("https://example.com/starkupps", "starkupps")
    ).toBe("https://www.instagram.com/starkupps/");
  });

  it("falls back to the handle when the handle itself is unusable", () => {
    expect(resolveProfileUrl("", "")).toBe("https://www.instagram.com/");
  });
});

describe("marqueeDurationSeconds", () => {
  it("scales linearly with the item count so speed stays constant", () => {
    expect(marqueeDurationSeconds("normal", 2)).toBe(
      marqueeDurationSeconds("normal", 4) / 2
    );
  });

  it("orders slow > normal > fast", () => {
    const slow = marqueeDurationSeconds("slow", 10);
    const normal = marqueeDurationSeconds("normal", 10);
    const fast = marqueeDurationSeconds("fast", 10);
    expect(slow).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(fast);
  });

  it("never drops below the 6s floor", () => {
    expect(marqueeDurationSeconds("fast", 1)).toBe(6);
    expect(marqueeDurationSeconds("fast", 0)).toBe(6);
    expect(marqueeDurationSeconds("fast", Number.NaN)).toBe(6);
  });

  it("treats an unknown speed as normal", () => {
    expect(marqueeDurationSeconds("bogus" as never, 4)).toBe(
      marqueeDurationSeconds("normal", 4)
    );
  });
});
