import { motion, useReducedMotion } from "motion/react";

import { resolveResponsive, toSrcset } from "@/lib/responsive-images";
import { springs } from "@/utils/motion";

/**
 * An image that serves a downscaled rendition per device.
 *
 * ## Why this exists
 *
 * The bundled photography used to ship at full resolution to every device. The
 * gallery rendered a 1408x912 JPEG into a 166x160 slot on a phone — 8.5x
 * oversized. This component keeps the same markup and the same visual result
 * but lets the browser pick a file that roughly matches its box.
 *
 * ## Layout stability
 *
 * The caller must pass the *original's* intrinsic `width`/`height`. The browser
 * derives an aspect ratio from those before the CSS loads, which is what keeps
 * a below-the-fold gallery from shifting the page as images arrive (CLS). If a
 * responsive candidate has a different ratio — it cannot, since the generator
 * only ever downscales and the CSS box is fixed — pass `aspect` to override the
 * reserved box explicitly.
 *
 * `sizes` is mandatory in practice: without it the browser assumes 100vw and
 * picks desktop-sized files on a phone, which is the exact problem being fixed.
 * Every usage below supplies one that mirrors its own layout.
 */

type ResponsiveImageProps = {
  /** Vite-resolved original URL. Also the fallback `src`. */
  src: string;
  /** Alt text. Pass `""` for decorative images, which is not the same as omitting it. */
  alt: string;
  /**
   * Stem used by `scripts/generate-responsive-images.py`, e.g. `"space-window"`.
   * Omit (or pass a stem with no derivatives) and the component renders a plain
   * `<img>` — this is what owner-uploaded photos from Storage go through.
   */
  stem?: string | undefined;
  /** Intrinsic width of the original, in px. Reserves layout space. */
  width: number;
  /** Intrinsic height of the original, in px. Reserves layout space. */
  height: number;
  /**
   * The `sizes` attribute. Must describe the rendered width at each breakpoint,
   * including the grid fraction, or the browser will pick the wrong candidate.
   */
  sizes?: string | undefined;
  className?: string | undefined;
  /** Above-the-fold images must not be lazy. */
  loading?: "eager" | "lazy";
  /** Drives the LCP request priority for the hero. */
  fetchPriority?: "high" | "low" | "auto" | undefined;
  decoding?: "sync" | "async" | "auto" | undefined;
  /**
   * Fade/scale in on mount. Off for above-the-fold images, where an entrance
   * animation delays the LCP paint for no benefit.
   */
  animate?: boolean;
};

export function ResponsiveImage({
  src,
  alt,
  stem,
  width,
  height,
  sizes,
  className,
  loading = "lazy",
  fetchPriority,
  decoding,
  animate = false,
}: ResponsiveImageProps) {
  const reducedMotion = useReducedMotion();
  const resolved = stem ? resolveResponsive(stem) : undefined;

  const shared = {
    src,
    alt,
    width,
    height,
    loading,
    fetchPriority,
    decoding,
    className,
    ...(resolved && sizes ? { srcSet: toSrcset(resolved.variants), sizes } : {}),
  };

  if (!animate) return <img {...shared} />;

  return (
    <motion.img
      {...shared}
      initial={reducedMotion ? {} : { opacity: 0, scale: 0.97 }}
      animate={reducedMotion ? {} : { opacity: 1, scale: 1 }}
      transition={springs.section}
    />
  );
}
