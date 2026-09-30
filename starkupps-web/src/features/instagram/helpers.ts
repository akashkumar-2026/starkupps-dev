/**
 * Instagram embed helpers for the storefront section.
 *
 * URL helpers mirror `starkupps-admin/shared/instagram.ts`. The two apps are
 * fully decoupled (separate packages, no shared build, no cross-imports), so
 * the small duplication is deliberate rather than accidental. Anything the
 * *server* enforces lives in the admin module — this file only derives URLs the
 * client needs to render.
 */
import type { InstagramPostType, InstagramScrollSpeed } from "@/types/instagram";

export const INSTAGRAM_ORIGIN = "https://www.instagram.com";

/**
 * Official Instagram embed endpoint.
 *
 * Iframes only — `embed.js` is never loaded. That script is ~100 kB of
 * third-party JavaScript in the critical path and would also rewrite the DOM
 * around our cards, which breaks the fixed 4:5 card geometry.
 *
 * `/captioned/` is deliberately not used: it injects a caption and username
 * block that overflows a portrait card and shifts layout after load.
 */
export function instagramEmbedUrl(shortcode: string, type: InstagramPostType): string {
  const segment = type === "reel" ? "reel" : "p";
  return `${INSTAGRAM_ORIGIN}/${segment}/${encodeURIComponent(shortcode)}/embed/`;
}

/** Seconds one card should occupy in the track. */
export const SCROLL_SECONDS_PER_ITEM: Record<InstagramScrollSpeed, number> = {
  slow: 9,
  normal: 6.5,
  fast: 4,
};

export function marqueeDurationSeconds(speed: InstagramScrollSpeed, itemCount: number): number {
  const perItem = SCROLL_SECONDS_PER_ITEM[speed] ?? SCROLL_SECONDS_PER_ITEM.normal;
  const count = Number.isFinite(itemCount) ? Math.max(1, Math.floor(itemCount)) : 1;
  return Math.max(6, Math.round(count * perItem));
}
