/**
 * Responsive image resolution for the storefront's bundled photography.
 *
 * ## Why
 *
 * The bundled photos (hero, gallery, about) were shipped at full resolution to
 * every device. Measured against the box they actually render into, the gallery
 * was serving a 1408x912 JPEG into a 166x160 slot on a phone — 8.5x oversized,
 * and 5.4x for the other five. On a phone that is several hundred kilobytes of
 * JPEG for thumbnails, which is exactly the kind of thing that makes a public
 * food site feel slow to a first-time visitor.
 *
 * ## How
 *
 * `scripts/generate-responsive-images.py` writes downscaled variants to
 * `src/assets/responsive/<stem>-<width>.jpg`. This module discovers them with
 * `import.meta.glob` and groups them by stem, so there is no generated manifest
 * to fall out of sync with the filesystem and no build-time image dependency.
 *
 * A photo with no derivatives is not an error: `resolveResponsive` returns no
 * `variants`, and `<ResponsiveImage>` then emits a plain `src` and behaves
 * exactly as before.
 */

/** One downscaled rendition of a bundled photo. */
export type ResponsiveVariant = {
  /** Width in CSS pixels. */
  w: number;
  /** Vite-resolved, content-hashed URL. */
  src: string;
};

export type ResponsiveSource = {
  /** Downscaled renditions, ascending by width. Empty when none were generated. */
  variants: ResponsiveVariant[];
};

const modules = import.meta.glob("../assets/responsive/*.jpg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** `-960` suffix on a stem-derived filename. */
const WIDTH_SUFFIX = /-(\d{2,4})\.jpg$/;

const byStem = new Map<string, ResponsiveVariant[]>();

for (const [path, src] of Object.entries(modules)) {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const match = WIDTH_SUFFIX.exec(file);
  if (!match) continue;
  const stem = file.slice(0, match.index);
  const w = Number(match[1]);
  const list = byStem.get(stem) ?? [];
  list.push({ w, src });
  byStem.set(stem, list);
}

for (const list of byStem.values()) list.sort((a, b) => a.w - b.w);

/**
 * Look up the variants generated for a bundled photo.
 *
 * @param stem The source filename without its extension, e.g. `"space-window"`.
 *   That is the identifier the generator script slugs filenames with.
 */
export function resolveResponsive(stem: string): ResponsiveSource | undefined {
  const variants = byStem.get(stem);
  return variants && variants.length > 0 ? { variants } : undefined;
}

/**
 * Builds a `srcset` value.
 *
 * `sizes` is the browser's only input for choosing a candidate, so it has to
 * describe the layout honestly at each breakpoint — a wrong `sizes` is worse
 * than no `srcset` at all, because it makes the browser pick the wrong file.
 */
export function toSrcset(variants: ResponsiveVariant[]): string {
  return variants.map((v) => `${v.src} ${v.w}w`).join(", ");
}
