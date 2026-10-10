import { resolveResponsive, toSrcset } from "@/lib/responsive-images";

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
}: ResponsiveImageProps) {
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

  // No entrance animation, by design: it delayed LCP for no benefit, and the
  // `motion` import it required kept a 130 KB library on the critical path.
  // Boxes are reserved via width/height, so images never shift layout (CLS).
  if (resolved && resolved.avifVariants.length > 0 && sizes) {
    return (
      // `contents`: the wrapper must not participate in layout — the img
      // keeps its own classes and behaves as the direct child.
      <picture className="contents">
        <source type="image/avif" srcSet={toSrcset(resolved.avifVariants)} sizes={sizes} />
        <img {...shared} />
      </picture>
    );
  }
  return <img {...shared} />;
}
