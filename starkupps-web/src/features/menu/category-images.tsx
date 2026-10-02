/**
 * Category imagery.
 *
 * Categories carry an optional `imageUrl`, uploaded from Admin > Menu and stored
 * in Supabase Storage. This module deliberately does NOT substitute a bundled
 * photograph for a category that has none.
 *
 * Previously `categoryImage(slug)` mapped slugs onto three bundled cafe photos
 * and returned the coffee one for anything it did not recognise — so a category
 * called "Mocktails" rendered a photo of a coffee cup, captioned "Mocktails".
 * That is invented content presented as real, and it shipped into the bundle as
 * an unconditional fallback.
 *
 * Now an absent image is absent. Callers render `CategoryImage`, which shows a
 * neutral labelled tile instead of an unrelated picture.
 */
export type CategoryImageProps = {
  url: string | null | undefined;
  /** Category name, used for the alt text and the neutral tile's label. */
  name: string;
  className?: string;
};

export function CategoryImage({ url, name, className }: CategoryImageProps) {
  if (url) {
    return <img src={url} alt={name} loading="lazy" className={className} />;
  }
  return (
    <div
      role="img"
      aria-label={`${name} — no image`}
      className={`grid place-items-center bg-muted ${className ?? ""}`}
    >
      <span className="px-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {name}
      </span>
    </div>
  );
}
