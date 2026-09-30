import { motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { InstagramCard, InstagramGlyph } from "./InstagramCard";
import { Pressable } from "@/components/shared/Pressable";
import { usePublicInstagram } from "@/features/instagram/usePublicInstagram";
import { useInstagramMarquee } from "@/features/instagram/useInstagramMarquee";
import { springs } from "@/utils/motion";

/** Mount iframes only once the section is within this distance of the viewport. */
const EMBED_PRELOAD_MARGIN_PX = 300;

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

  // One gate for the whole section: nothing inside reaches for Instagram until
  // the row is close to the viewport.
  // Nodes are held in state, not refs: the section renders nothing until the
  // feed resolves, so on first paint these elements do not exist yet and an
  // effect keyed on a ref would latch onto a permanently-null node.
  const [sectionEl, setSectionEl] = useState<HTMLElement | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [trackEl, setTrackEl] = useState<HTMLUListElement | null>(null);

  const [embedsAllowed, setEmbedsAllowed] = useState(false);
  const [sectionOnScreen, setSectionOnScreen] = useState(false);

  useEffect(() => {
    if (!sectionEl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        setSectionOnScreen(entry.isIntersecting);
        // Latch: once close enough, keep embeds mounted so scrolling does not
        // remount them.
        if (entry.isIntersecting) setEmbedsAllowed(true);
      },
      { rootMargin: `${EMBED_PRELOAD_MARGIN_PX}px 0px` },
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

  const heading = settings?.heading?.trim() || "Follow the froth";
  const eyebrow = settings?.eyebrow?.trim() || "Follow along";
  const handle = settings?.profileHandle || "starkupps";
  const profileUrl = settings?.profileUrl || `https://www.instagram.com/${handle}/`;
  const followLabel = settings?.followButtonLabel?.trim() || "Follow";

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
            <p className="eyebrow text-primary">{eyebrow}</p>
            <h2 id="instagram-heading" className="display-lg mt-2 max-w-2xl">
              {heading}
            </h2>
            {settings?.subheading ? (
              <p className="mt-4 max-w-md text-base text-muted-foreground">{settings.subheading}</p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {looping && !reduced ? (
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

            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-chip transition-opacity hover:opacity-90"
            >
              <InstagramGlyph className="size-4" />
              {followLabel} @{handle}
            </a>
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ ...springs.section, delay: 0.05 }}
        className="relative mt-8"
      >
        {/* Fade on both edges. The mask lives on the outer wrapper, never on
            the track, so the gradient stays put while cards move under it. */}
        <div
          ref={setViewportEl}
          className="instagram-viewport [mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]"
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
                post={item.post}
                duplicate={item.duplicate}
                embedsAllowed={embedsAllowed}
                onOpen={marquee.openPost}
              />
            ))}
          </ul>
        </div>
      </motion.div>
    </section>
  );
}
