import { ArrowUpRight, Instagram, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
        "material inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground",
        className,
      )}
    >
      {isReel ? <Play className="size-3 fill-current" /> : <Square className="size-3" />}
      {isReel ? "Reel" : "Post"}
    </span>
  );
}

function ArtworkFallback({ post }: { post: PublicInstagramPost }) {
  const caption = post.caption?.trim();
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#efe5d8]">
      <span className="absolute -right-12 -top-10 size-48 rounded-full bg-[#d75a32]/15" />
      <span className="absolute -bottom-16 -left-10 size-52 rounded-full bg-[#6f4330]/10" />
      <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(ellipse_at_50%_42%,rgba(255,255,255,0.8),transparent_58%)]">
        <div className="grid size-16 place-items-center rounded-2xl border border-white/80 bg-white/75 text-primary shadow-[0_12px_32px_rgba(67,42,26,0.12)] backdrop-blur-sm">
          <Instagram className="size-7" strokeWidth={1.5} />
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#211914]/90 via-[#211914]/45 to-transparent px-5 pb-5 pt-24 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">
          From the StarKupps feed
        </p>
        {caption ? (
          <p className="mt-2 line-clamp-3 text-sm font-medium leading-5">{caption}</p>
        ) : (
          <p className="mt-2 text-sm font-medium">A little taste of the good stuff.</p>
        )}
      </div>
    </div>
  );
}

export type InstagramCardProps = {
  post: PublicInstagramPost;
  /**
   * Second copy of the feed, rendered purely for the seamless loop. It is
   * hidden from assistive tech and removed from the tab order so the same post
   * is never announced or focusable twice.
   */
  duplicate?: boolean;
  onOpen: (url: string) => void;
};

/**
 * One feed card. The public feed supplies a resolved Instagram cover image when
 * available; using a local image tile avoids fragile third-party iframe embeds.
 */
export function InstagramCard({ post, duplicate = false, onOpen }: InstagramCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [previewFinished, setPreviewFinished] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const cardRef = useRef<HTMLLIElement | null>(null);
  const isReel = post.type === "reel";
  const hasImage = Boolean(post.thumbnailUrl && !imageFailed);
  const showPreview = Boolean(
    isReel &&
    post.previewVideoUrl &&
    previewActive &&
    !previewFinished &&
    !previewFailed &&
    !duplicate,
  );

  useEffect(() => {
    if (!isReel || !post.previewVideoUrl || duplicate) return;
    const element = cardRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") {
      setPreviewActive(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPreviewActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: "48px", threshold: 0.25 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [duplicate, isReel, post.previewVideoUrl]);

  return (
    <li
      ref={cardRef}
      aria-hidden={duplicate ? true : undefined}
      data-duplicate={duplicate ? "true" : undefined}
      className="group/ig relative shrink-0 snap-start"
      style={{ width: "var(--ig-card-w)" }}
    >
      <div className="relative aspect-[4/5] overflow-hidden rounded-[1.4rem] border border-border bg-card shadow-card transition duration-300 group-hover/ig:-translate-y-1 group-hover/ig:shadow-[0_20px_48px_rgba(44,31,22,0.18)] group-focus-within/ig:-translate-y-1">
        {hasImage ? (
          <img
            src={post.thumbnailUrl ?? undefined}
            alt={post.caption ?? `Instagram ${post.type} from StarKupps`}
            loading="lazy"
            decoding="async"
            onError={() => setImageFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <ArtworkFallback post={post} />
        )}
        {showPreview ? (
          <video
            src={post.previewVideoUrl ?? undefined}
            poster={post.thumbnailUrl ?? undefined}
            muted
            playsInline
            autoPlay
            preload="metadata"
            aria-hidden="true"
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime >= 2.5) {
                event.currentTarget.pause();
                setPreviewFinished(true);
              }
            }}
            onEnded={() => setPreviewFinished(true)}
            onError={() => setPreviewFailed(true)}
            className="absolute inset-0 z-[1] size-full object-cover"
          />
        ) : null}

        <button
          type="button"
          onClick={() => onOpen(post.url)}
          tabIndex={duplicate ? -1 : 0}
          aria-label={`View this ${isReel ? "reel" : "post"}${
            post.caption ? `: ${post.caption}` : ""
          } on Instagram`}
          className="absolute inset-0 z-10 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-primary"
        >
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-espresso/0 transition-colors duration-300 group-hover/ig:bg-espresso/15 group-focus-within/ig:bg-espresso/15">
            <span className="grid size-12 translate-y-2 place-items-center rounded-full bg-white/95 text-foreground opacity-0 shadow-lg transition duration-200 group-hover/ig:translate-y-0 group-hover/ig:opacity-100 group-focus-within/ig:translate-y-0 group-focus-within/ig:opacity-100">
              <ArrowUpRight className="size-5" />
            </span>
          </span>
        </button>

        <span className="pointer-events-none absolute left-3 top-3 z-20 grid size-9 place-items-center rounded-full border border-white/60 bg-white/90 text-primary shadow-sm backdrop-blur">
          <InstagramGlyph className="size-4" />
        </span>
        <InstagramTypeBadge
          type={post.type}
          className="pointer-events-none absolute right-3 top-3 z-20 border-white/60 bg-white/90 shadow-sm backdrop-blur"
        />

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[1.4rem] ring-1 ring-inset ring-black/5"
        />
      </div>
    </li>
  );
}
