import { Instagram, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { instagramEmbedUrl } from "@/features/instagram/helpers";
import { cn } from "@/utils/cn";
import type { InstagramPostType, PublicInstagramPost } from "@/types/instagram";

/**
 * Instagram brand glyph. `lucide-react` intentionally ships no brand marks, so
 * the outline is drawn inline — it stays on-brand with the site's stroke
 * weight and recolours with the section's text token.
 */
export function InstagramGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.25" />
      <circle cx="17.4" cy="6.6" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function InstagramTypeBadge({
  type,
  className,
}: {
  type: InstagramPostType;
  className?: string;
}) {
  const isReel = type === "reel";
  return (
    <span
      className={cn(
        "material inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-foreground",
        className,
      )}
    >
      {isReel ? <Play className="size-3 fill-current" /> : <Square className="size-3" />}
      {isReel ? "Reel" : "Post"}
    </span>
  );
}

/** Neutral stand-in shown until the embed mounts (or if it never does). */
function Placeholder({ post }: { post: PublicInstagramPost }) {
  return (
    <div className="absolute inset-0 grid place-items-center gap-2 bg-muted text-muted-foreground">
      <InstagramGlyph className="size-8" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
        {post.type === "reel" ? "Reel" : "Post"}
      </span>
    </div>
  );
}

/**
 * Shown when Instagram refuses to render an embed (private account, deleted
 * post, placeholder shortcode from the seed, or an embed blocked by the
 * network). A card is never left blank or broken.
 */
function Fallback({ post, reason }: { post: PublicInstagramPost; reason: string }) {
  return (
    <div className="absolute inset-0 flex flex-col justify-between bg-card p-4 text-left">
      <span className="grid size-9 place-items-center rounded-full bg-accent text-primary">
        <Instagram className="size-4" />
      </span>
      <span>
        <span className="eyebrow block text-primary">{post.type === "reel" ? "Reel" : "Post"}</span>
        <span className="mt-1 block text-sm font-semibold">{reason}</span>
      </span>
    </div>
  );
}

export type InstagramCardProps = {
  post: PublicInstagramPost;
  /** Section is close enough to the viewport to start mounting embeds. */
  embedsAllowed: boolean;
  /**
   * Second copy of the feed, rendered purely for the seamless loop. It is
   * hidden from assistive tech and removed from the tab order so the same post
   * is never announced or focusable twice.
   */
  duplicate?: boolean;
  onOpen: (url: string) => void;
};

/**
 * One feed card.
 *
 * Deliberately isolated: this component owns *what a card looks like* and
 * nothing else. The marquee that wraps it only knows about track geometry, so
 * when a future Instagram Graph API sync fills `thumbnailUrl`, the swap to
 * native `<img>` cards happens here alone.
 */
export function InstagramCard({
  post,
  embedsAllowed,
  duplicate = false,
  onOpen,
}: InstagramCardProps) {
  // Per-card gate: only mount an embed once this card is near the viewport.
  // Without this, a 10-post feed rendered twice would create 20 iframes.
  const [nearViewport, setNearViewport] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const rootRef = useRef<HTMLLIElement | null>(null);

  // Watchdog rather than `onLoad`: Instagram answers with 200 + its own error
  // page for unavailable posts, so `onLoad` proves nothing. If no paint lands
  // within the window we fall back instead of showing an empty frame.
  useEffect(() => {
    if (!embedsAllowed || !nearViewport || blocked || post.thumbnailUrl) return;
    const timer = setTimeout(() => setBlocked(true), 9000);
    return () => clearTimeout(timer);
  }, [embedsAllowed, nearViewport, blocked, post.thumbnailUrl]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Hysteresis: mount early (260px), unmount only once well clear. Prevents
    // the flicker of mount/unmount every time a card crosses the boundary.
    let clearTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (clearTimer) {
              clearTimeout(clearTimer);
              clearTimer = null;
            }
            setNearViewport(true);
          } else if (!clearTimer) {
            clearTimer = setTimeout(() => setNearViewport(false), 1500);
          }
        }
      },
      { rootMargin: "260px 0px" },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (clearTimer) clearTimeout(clearTimer);
    };
  }, []);

  const mountEmbed = embedsAllowed && nearViewport && !blocked && !post.thumbnailUrl;
  const isReel = post.type === "reel";
  const isBlank = !post.thumbnailUrl && !mountEmbed;

  return (
    <li
      ref={rootRef}
      aria-hidden={duplicate ? true : undefined}
      className="group/ig relative shrink-0 snap-start"
      style={{ width: "var(--ig-card-w)" }}
    >
      <div
        className="relative overflow-hidden rounded-3xl border border-border bg-card shadow-card"
        style={{ height: "var(--ig-card-h)" }}
      >
        {post.thumbnailUrl ? (
          <img
            src={post.thumbnailUrl}
            alt={post.caption ?? `Instagram ${post.type} from StarKupps`}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
        ) : mountEmbed ? (
          <iframe
            title={
              post.caption
                ? `Instagram ${post.type}: ${post.caption}`
                : `Instagram ${post.type} from StarKupps`
            }
            src={instagramEmbedUrl(post.shortcode, post.type)}
            loading="lazy"
            tabIndex={duplicate ? -1 : 0}
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute left-0 w-full border-0"
            style={{
              top: "calc(-1 * var(--ig-embed-lift))",
              height: "calc(100% + var(--ig-embed-lift) + var(--ig-embed-tail))",
            }}
          />
        ) : blocked ? (
          <Fallback post={post} reason="Preview unavailable — open it on Instagram" />
        ) : (
          <Placeholder post={post} />
        )}

        {/* Overlay above the iframe: iframes swallow pointer events, so this is
            what actually receives hover (to pause the marquee) and the click. */}
        <button
          type="button"
          onClick={() => onOpen(post.url)}
          tabIndex={duplicate ? -1 : 0}
          aria-label={`View this ${isReel ? "reel" : "post"} on Instagram`}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary"
        >
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-espresso/0 transition-colors duration-300 group-hover/ig:bg-espresso/25 group-focus-within/ig:bg-espresso/25">
            <span className="material flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground opacity-0 shadow-chip transition-opacity duration-200 group-hover/ig:opacity-100 group-focus-within/ig:opacity-100">
              {isReel ? (
                <Play className="size-3.5 fill-primary text-primary" />
              ) : (
                <InstagramGlyph className="size-3.5 text-primary" />
              )}
              Watch on Instagram
            </span>
          </span>
        </button>

        {isBlank ? null : (
          <InstagramTypeBadge
            type={post.type}
            className="pointer-events-none absolute bottom-3 left-3 z-20 shadow-chip"
          />
        )}

        {/* Instagram's embed scrolls internally when its own layout is taller
            than our box. The scrollbar lives in a cross-origin document so it
            cannot be hidden with CSS; this strip in the card's own background
            sits above it. */}
        {mountEmbed ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-20 w-2.5 bg-card"
          />
        ) : null}

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-border/60"
        />
      </div>
    </li>
  );
}
