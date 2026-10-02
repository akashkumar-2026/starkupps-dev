import { motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InstagramCard, InstagramGlyph } from "./InstagramCard";
import { Pressable } from "@/components/shared/Pressable";
import {
  usePublicInstagram,
  usePublicInstagramThumbnails,
} from "@/features/instagram/usePublicInstagram";
import { useInstagramMarquee } from "@/features/instagram/useInstagramMarquee";
import { springs } from "@/utils/motion";

/**
 * Storefront Instagram section.
 *
 * Sits between "The space" (gallery) and "Visit", on the light
 * `bg-background` so it reads as the bridge out of the espresso gallery and
 * keeps Instagram's own white embeds from floating inside a dark box.
 *
 * Renders nothing while loading, when disabled, when there are no active posts,
 * or when the API is unreachable — see `usePublicInstagram` for why an editorial
 * section should disappear rather than show a retry card above the fold.
 */
export function InstagramSection() {
  const { data } = usePublicInstagram();
  const reduced = Boolean(useReducedMotion());

  const settings = data?.settings ?? null;
  const posts = useMemo(() => data?.posts ?? [], [data?.posts]);
  const shortcodes = useMemo(() => posts.map((post) => post.shortcode), [posts]);
  const { data: thumbnails } = usePublicInstagramThumbnails(shortcodes);

  // Nodes are held in state, not refs: the section renders nothing until the
  // feed resolves, so effects need to re-run when the elements attach.
  const [sectionEl, setSectionEl] = useState<HTMLElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [trackEl, setTrackEl] = useState<HTMLUListElement | null>(null);

  const [sectionOnScreen, setSectionOnScreen] = useState(false);

  useEffect(() => {
    if (!sectionEl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setSectionOnScreen(entry.isIntersecting);
      },
      { rootMargin: "160px 0px" },
    );
    observer.observe(sectionEl);
    return () => observer.disconnect();
  }, [sectionEl]);

  const marquee = useInstagramMarquee({
    viewportEl,
    trackEl,
    itemCount: posts.length,
    baseDurationSeconds: data?.durationSeconds ?? 0,
    disabled: reduced,
    active: sectionOnScreen,
  });

  const looping = marquee.looping && !reduced;

  const showRow = Boolean(settings?.enabled && posts.length > 0);
  if (!showRow) return null;

  // Copy comes from `public.instagram_settings` (Admin > Instagram). No client-side
  // substitutes: the previous code fell back to a hardcoded "starkupps" handle and
  // built a working profile link from it, so the section followed an account the
  // owner had never configured.
  const heading = settings?.heading?.trim() ?? "";
  const eyebrow = settings?.eyebrow?.trim() ?? "";
  const profileUrl = settings?.profileUrl ?? null;
  const followLabel = settings?.followButtonLabel?.trim() ?? "";

  // A marquee needs the list twice so the -50% translate never shows a seam.
  // A static strip (reduced motion, or a feed too short to fill the viewport)
  // shows each post exactly once — nobody should scroll past the same post
  // twice, and a short feed must never be padded out by repeating itself.
  const lap = posts.map((post) => ({ key: String(post.id), post, duplicate: false }));
  // The duplicated half is flagged so it stays out of the accessibility tree and
  // the tab order — otherwise every post would be announced and focusable twice.
  const cards =
    looping && !reduced
      ? [
          ...lap,
          ...lap.map((item) => ({
            ...item,
            key: `${item.key}-b`,
            duplicate: true,
          })),
        ]
      : lap;

  return (
    <section
      ref={setSectionEl}
      id="instagram"
      aria-labelledby="instagram-heading"
      className="instagram-shell group/ig-shell relative overflow-hidden bg-background py-14"
      style={marquee.shellStyle}
      data-manual={marquee.manual ? "true" : "false"}
      data-static={reduced || !looping ? "true" : "false"}
      data-hover-pause={settings?.pauseOnHover !== false ? "true" : "false"}
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={springs.section}
        className="mx-auto w-full max-w-6xl px-4"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            {eyebrow && <p className="eyebrow text-primary">{eyebrow}</p>}
            {heading && (
              <h2 id="instagram-heading" className="display-lg mt-2 max-w-2xl">
                {heading}
              </h2>
            )}
            {settings?.subheading ? (
              <p className="mt-4 max-w-md text-base text-muted-foreground">{settings.subheading}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {posts.length > 1 ? (
              <div className="hidden items-center gap-1.5 lg:flex">
                <Pressable
                  onClick={() => marquee.nudge(-1)}
                  aria-label="Scroll the feed left"
                  className="grid size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-chip transition-opacity duration-200 focus-visible:opacity-100 group-hover/ig-shell:opacity-100"
                >
                  <ChevronLeft className="size-5" />
                </Pressable>
                <Pressable
                  onClick={() => marquee.nudge(1)}
                  aria-label="Scroll the feed right"
                  className="grid size-10 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-chip transition-opacity duration-200 focus-visible:opacity-100 group-hover/ig-shell:opacity-100"
                >
                  <ChevronRight className="size-5" />
                </Pressable>
              </div>
            ) : null}

            {profileUrl ? (
              <a
                href={profileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-chip transition-opacity hover:opacity-90"
              >
                <InstagramGlyph className="size-4" />
                {followLabel}
                {settings?.profileHandle ? ` @${settings.profileHandle}` : ""}
              </a>
            ) : null}
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ ...springs.section, delay: 0.05 }}
        className="relative mx-auto mt-8 w-full max-w-6xl px-4"
      >
        {/* Fade on both edges. The mask lives on the outer wrapper, never on
            the track, so the gradient stays put while cards move under it. */}
        <div
          ref={setViewportEl}
          className="instagram-viewport [mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-12px),transparent)]"
          {...marquee.gestureProps}
        >
          <ul
            ref={setTrackEl}
            className="instagram-track flex w-max items-stretch"
            style={{ gap: "var(--ig-gap)" }}
          >
            {cards.map((item) => (
              <InstagramCard
                key={item.key}
                post={{
                  ...item.post,
                  thumbnailUrl: thumbnails?.[item.post.shortcode] ?? item.post.thumbnailUrl,
                }}
                duplicate={item.duplicate}
                onOpen={marquee.openPost}
              />
            ))}
          </ul>
        </div>
      </motion.div>
    </section>
  );
}
