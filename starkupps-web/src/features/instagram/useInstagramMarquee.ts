import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MarqueeMetrics } from "@/types/instagram";

/** How long the row stays in manual (swipe) mode after the last interaction. */
const RESUME_DELAY_MS = 2000;

/** Mobile swipe must be short and fast to read as "pause", not "wait". */
const TAP_SLOP_PX = 8;

/** First rendered card — used for slot width and arrow step size. */
function firstCard(track: HTMLElement | null): HTMLElement | null {
  return track?.querySelector<HTMLElement>("li") ?? null;
}

export type MarqueeOptions = {
  /**
   * The scroll surface and the animated track.
   *
   * These are *elements*, not refs: the section renders nothing at all until it
   * knows whether it is enabled, so on first paint these nodes do not exist.
   * Holding them in state means the effects below re-run when they attach
   * instead of latching onto a permanently-null ref.
   */
  viewportEl: HTMLDivElement | null;
  trackEl: HTMLUListElement | null;
  /** Feed length before repetition. */
  itemCount: number;
  /** Server-computed seconds for one lap at repeats = 1. */
  baseDurationSeconds: number;
  /** `true` disables auto-scroll entirely (reduced motion). */
  disabled: boolean;
  /** `true` while the section is visible and the tab is foregrounded. */
  active: boolean;
};

export type MarqueeHandle = {
  metrics: MarqueeMetrics;
  /** Seconds for one full −50% lap at the current repeat count. */
  durationSeconds: number;
  /** `true` while the visitor is swiping / nudging the row by hand. */
  manual: boolean;
  /**
   * `true` when the feed is long enough to scroll seamlessly. `false` means the
   * row is a static, swipeable strip showing every post exactly once.
   */
  looping: boolean;
  /** Scroll the row by one card, entering manual mode. */
  nudge: (direction: 1 | -1) => void;
  /** Open a permalink unless the preceding gesture was a swipe. */
  openPost: (url: string) => void;
  /** Styles spread onto the shell element. */
  shellStyle: React.CSSProperties;
  /** Gesture handlers spread onto the scroll surface. */
  gestureProps: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  };
};

/**
 * Horizontal marquee for the Instagram feed.
 *
 * Motion lives entirely in CSS (a `translateX(0 → -50%)` keyframe on a track
 * that contains the feed twice). This hook owns only the *state around* that
 * animation:
 *
 *   - repeating the feed enough times to cover the viewport, so a 2-post feed
 *     still fills a 1536px screen and the loop stays seamless;
 *   - scaling lap time by the repeat count so perceived speed never changes;
 *   - pausing for hover / focus / off-screen / hidden tab / touch;
 *   - swapping between the animated track and a native scroll container on
 *     touch, because there is no hover to pause with.
 *
 * Pausing uses `animation-play-state` (and a negative `animation-delay` when
 * re-syncing), never a reset — restarting a CSS animation snaps it back to the
 * start, which reads as a visible glitch.
 */
export function useInstagramMarquee({
  viewportEl,
  trackEl,
  itemCount,
  baseDurationSeconds,
  disabled,
  active,
}: MarqueeOptions): MarqueeHandle {
  const [manual, setManual] = useState(false);
  // Whether the feed can drive a seamless loop. Stateful because it depends on
  // the measured viewport, which changes on resize and on breakpoint.
  const [looping, setLooping] = useState(false);

  // Imperative timer, not state: nothing renders from it.
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pointerOrigin, setPointerOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  // Set while a gesture turns out to be a swipe, so the overlay button does not
  // navigate on the click that browsers synthesise at the end of a drag.
  const [suppressClick, setSuppressClick] = useState(false);

  const clearResume = useCallback(() => {
    if (resumeTimer.current) {
      clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
  }, []);

  // ── Repeat count + duration ────────────────────────────────────────────
  const recomputeMetrics = useCallback(() => {
    if (!viewportEl || !trackEl || itemCount <= 0) return;
    const card = firstCard(trackEl);
    if (!card) return;

    const gap = Number.parseFloat(getComputedStyle(viewportEl).getPropertyValue("--ig-gap")) || 12;
    const slot = card.offsetWidth + gap;
    if (slot <= 0) return;

    const listWidth = slot * itemCount;
    // A seamless -50% loop only works when the feed already covers the
    // viewport; otherwise the translate would expose the end of the list
    // before the loop restarted.
    //
    // When the feed is too short we deliberately do NOT repeat posts to fill the
    // gap. One post rendered five times reads as a rendering bug, and an
    // operator should see on the site exactly what they set up in Admin. The row
    // degrades to a static, swipeable strip with each post shown once.
    const fits = listWidth >= viewportEl.clientWidth;

    setLooping((prev) => (prev === fits ? prev : fits));
  }, [itemCount, trackEl, viewportEl]);

  // Each post appears once per lap; the loop duplicates the whole list, never an
  // individual post.
  const cardsPerLap = itemCount;
  const metrics = useMemo<MarqueeMetrics>(() => ({ repeats: 1, cardsPerLap }), [cardsPerLap]);

  useEffect(() => {
    if (!viewportEl || !trackEl) return;
    recomputeMetrics();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(recomputeMetrics);
    observer.observe(viewportEl);
    const card = firstCard(trackEl);
    if (card) observer.observe(card);
    return () => observer.disconnect();
  }, [recomputeMetrics, trackEl, viewportEl]);

  // Duration scales with the rendered card count so speed stays constant: more
  // posts means a longer lap, never a faster one.
  const durationSeconds = useMemo(() => {
    const perCard = itemCount > 0 ? baseDurationSeconds / itemCount : 0;
    return Math.max(6, Math.round(perCard * cardsPerLap));
  }, [baseDurationSeconds, cardsPerLap, itemCount]);

  // ── Off-screen / hidden-tab pause ──────────────────────────────────────
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    if (!viewportEl || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => setOnScreen(entries[0]?.isIntersecting ?? false),
      // Stop the compositor work a little before the row leaves the screen.
      { rootMargin: "120px 0px" },
    );
    observer.observe(viewportEl);
    return () => observer.disconnect();
  }, [viewportEl]);

  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const sync = () => setTabVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => clearResume, [clearResume]);

  // ── Manual (touch) mode ────────────────────────────────────────────────
  const leaveManual = useCallback(() => {
    if (!viewportEl || !trackEl) return;

    // A short or reduced-motion feed is a native scroll strip, not an animated
    // marquee. Preserve the visitor's scroll position when the pause expires.
    if (!looping || disabled) {
      setManual(false);
      return;
    }

    const travelled = viewportEl.scrollLeft;
    viewportEl.scrollLeft = 0;

    const half = trackEl.scrollWidth / 2;
    if (half > 0 && durationSeconds > 0) {
      // Re-align the CSS animation to wherever the visitor left the row. A
      // negative delay starts the keyframes part-way in, so motion continues
      // seamlessly from the scrolled position instead of snapping back to 0.
      const laps = travelled / half;
      const offset = ((laps % 1) + 1) % 1;
      trackEl.style.animationDelay = `${-(offset * durationSeconds).toFixed(3)}s`;
      // Force the style change to apply before play-state flips back to
      // running, otherwise the browser resumes on the previous tick.
      void trackEl.offsetWidth;
    }

    setManual(false);
  }, [disabled, durationSeconds, looping, trackEl, viewportEl]);

  const scheduleResume = useCallback(() => {
    clearResume();
    resumeTimer.current = setTimeout(() => {
      resumeTimer.current = null;
      leaveManual();
    }, RESUME_DELAY_MS);
  }, [clearResume, leaveManual]);

  const enterManual = useCallback(() => {
    setManual(true);
  }, []);

  // ── Motion state written to CSS ─────────────────────────────────────────
  const playing = !disabled && active && onScreen && tabVisible && !manual && cardsPerLap > 0;

  const shellStyle = useMemo(
    () =>
      ({
        "--ig-duration": `${durationSeconds}s`,
        "--ig-play-state": playing ? "running" : "paused",
      }) as React.CSSProperties,
    [durationSeconds, playing],
  );

  const nudge = useCallback(
    (direction: 1 | -1) => {
      if (!viewportEl || !trackEl) return;
      const card = firstCard(trackEl);
      if (!card) return;
      const gap =
        Number.parseFloat(getComputedStyle(viewportEl).getPropertyValue("--ig-gap")) || 12;
      const step = card.offsetWidth + gap;

      if (!manual) {
        // Freeze the track where it is, then hand scrolling to the viewport.
        // `scrollLeft` is seeded from the frozen offset so the row does not jump
        // as control changes hands.
        const matrix = getComputedStyle(trackEl).transform;
        // m41 is the track's own translateX in px (negative once it has moved
        // left).
        const frozen = matrix && matrix !== "none" ? new DOMMatrixReadOnly(matrix).m41 : 0;
        viewportEl.scrollLeft = Math.max(0, -frozen);
      }
      setManual(true);
      viewportEl.scrollBy({ left: step * direction, behavior: "smooth" });
      scheduleResume();
    },
    [manual, scheduleResume, trackEl, viewportEl],
  );

  // ── Touch gestures ─────────────────────────────────────────────────────
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // Mouse and pen already have hover; only touch needs the manual switch.
      if (event.pointerType === "mouse") return;
      setPointerOrigin({ x: event.clientX, y: event.clientY });
      setSuppressClick(false);
      clearResume();
    },
    [clearResume],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!pointerOrigin) return;
      const dx = Math.abs(event.clientX - pointerOrigin.x);
      const dy = Math.abs(event.clientY - pointerOrigin.y);
      // A dominant horizontal drag means "swipe the row", not "tap the card".
      if (dx > TAP_SLOP_PX && dx > dy) {
        setSuppressClick(true);
        enterManual();
        scheduleResume();
      }
    },
    [enterManual, pointerOrigin, scheduleResume],
  );

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      setPointerOrigin(null);
      if (event.pointerType === "mouse") return;
      if (suppressClick) scheduleResume();
    },
    [scheduleResume, suppressClick],
  );

  /** Guard so a swipe never also opens the post in a new tab. */
  const openPost = useCallback(
    (url: string) => {
      if (suppressClick) {
        setSuppressClick(false);
        return;
      }
      window.open(url, "_blank", "noopener,noreferrer");
    },
    [suppressClick],
  );

  return {
    metrics,
    durationSeconds,
    manual,
    looping,
    nudge,
    openPost,
    shellStyle,
    gestureProps: { onPointerDown, onPointerMove, onPointerUp },
  };
}
