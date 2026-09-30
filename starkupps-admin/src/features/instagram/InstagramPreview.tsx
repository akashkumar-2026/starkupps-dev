/**
 * Compact visual preview of a single Instagram post row in the Admin panel.
 *
 * Why a static tile by default: the Admin gateway serves a strict CSP
 * (`default-src 'self'`, see `server/index.ts`) so a page full of live embeds
 * would cost ~10 third-party iframes on every list render. Instead the row
 * shows a lightweight tile and the operator opens one embed on demand.
 *
 * `thumbnailUrl` is already in the schema for the future Instagram Graph API
 * sync ("Option B"). When it is populated this component renders a real
 * `<img>` with no code change on the storefront side.
 */
import type { InstagramPost } from "@shared/instagram";
import { Play, Square } from "lucide-react";
import { useState } from "react";

/** Instagram brand glyph — `lucide-react` intentionally ships no brand icons. */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TypeBadge({ type }: { type: InstagramPost["type"] }) {
  const isReel = type === "reel";
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] " +
        (isReel
          ? "border-[#E8B9AC] bg-[#FCE8E1] text-[#9A3627]"
          : "border-[#E6DDD2] bg-[#F5F0E8] text-[#75695E]")
      }
    >
      {isReel ? (
        <Play className="h-2.5 w-2.5" />
      ) : (
        <Square className="h-2.5 w-2.5" />
      )}
      {isReel ? "Reel" : "Post"}
    </span>
  );
}

/**
 * Row thumbnail. Prefers the URL resolved by `instagram.thumbnails` (Instagram
 * redirects `/p/{code}/media/?size=l` to a CDN poster frame — reels resolve to
 * their cover frame too), then any persisted `thumbnailUrl`. Falls back to the
 * brand glyph if neither loads, so a row is never blank.
 */
export function PostThumb({
  post,
  src,
  className = "",
}: {
  post: InstagramPost;
  src?: string | null;
  className?: string;
}) {
  const resolved = src ?? post.thumbnailUrl;
  const [failed, setFailed] = useState(false);

  if (resolved && !failed) {
    return (
      <img
        src={resolved}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={
          "h-[60px] w-[48px] shrink-0 rounded-lg border border-[#E6DDD2] object-cover " +
          className
        }
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={
        "grid h-[60px] w-[48px] shrink-0 place-items-center rounded-lg border border-[#E6DDD2] bg-[#F1EAE1] text-[#A99C8E] " +
        className
      }
    >
      <InstagramGlyph className="h-4 w-4" />
    </span>
  );
}
