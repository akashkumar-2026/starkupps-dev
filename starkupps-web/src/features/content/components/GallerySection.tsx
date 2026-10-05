import { ResponsiveImage } from "@/components/shared/ResponsiveImage";
import { useSiteSettings } from "@/features/content/useSiteContent";
import counterImg from "@/assets/space.jpg";
import windowImg from "@/assets/space-window.jpg";
import cornerImg from "@/assets/space-corner.jpg";
import friendsImg from "@/assets/space-friends.jpg";
import interiorImg from "@/assets/space-interior.jpg";
import teamImg from "@/assets/bts-team.jpg";

/**
 * The photographs are bundled with the app and are not database rows — they are
 * the cafe's own photography, shipped with the build rather than uploaded. The
 * heading and body are editable in Admin > Settings > Storefront, and images
 * uploaded there are prepended (see `uploadedImages` below).
 *
 * `stem` is the identifier `scripts/generate-responsive-images.py` derives
 * downscaled renditions from. Without it a photo renders at full resolution,
 * which is exactly what owner-uploaded images do — those come from Supabase
 * Storage and are not processed by this build.
 */
const bundledShots = [
  {
    src: counterImg,
    stem: "space",
    alt: "The StarKupps counter with the espresso machine",
    span: "sm:col-span-2",
    width: 1408,
    height: 912,
  },
  {
    src: windowImg,
    stem: "space-window",
    alt: "Sunlit window seat with a coffee cup",
    span: "",
    width: 900,
    height: 1100,
  },
  {
    src: cornerImg,
    stem: "space-corner",
    alt: "The terracotta arch photo corner with hanging plants",
    span: "",
    width: 900,
    height: 1100,
  },
  {
    src: friendsImg,
    stem: "space-friends",
    alt: "Friends sharing pizza and cold coffee at a table",
    span: "sm:col-span-2",
    width: 900,
    height: 1100,
  },
  {
    src: interiorImg,
    stem: "space-interior",
    alt: "Warm minimal café interior in afternoon light",
    span: "",
    width: 900,
    height: 1100,
  },
  {
    src: teamImg,
    stem: "bts-team",
    alt: "The StarKupps team behind the counter",
    span: "",
    width: 900,
    height: 900,
  },
];

/**
 * How wide one tile is, per breakpoint, for the `sizes` attribute.
 *
 * Two columns on a phone (so ~half the gutter-less width), four from `sm` up
 * (so a quarter, or half for the `sm:col-span-2` shots). Getting this wrong is
 * worse than omitting `srcset`: the browser would fetch desktop-sized files on a
 * phone, which is the problem the component exists to solve.
 */
const SIZES = "(min-width: 640px) (min-width: 1024px) 50vw, (min-width: 640px) 25vw, 50vw";
const SIZES_SPAN = "(min-width: 640px) (min-width: 1024px) 50vw, (min-width: 640px) 50vw, 50vw";

export function GallerySection() {
  const { data: site } = useSiteSettings();

  // Owner-uploaded images win; bundled photography is the fallback so the
  // section is never blank just because Storage has no uploads yet.
  const uploaded = (site?.galleryImages ?? []).filter((image) => image.url);
  const shots = [
    ...uploaded.map((image) => ({
      // Uploaded photos have no derivatives — `stem` is omitted on purpose, so
      // they render with a plain `src` at whatever Storage serves.
      src: image.url,
      stem: undefined as string | undefined,
      alt: image.alt,
      span: image.span,
      width: 900,
      height: 1100,
    })),
    ...bundledShots,
  ];

  return (
    <section className="bg-espresso text-espresso-foreground">
      <div className="shell section-y">
        <p className="eyebrow text-primary">The space</p>
        <h2 className="display-lg mt-2 max-w-2xl">{site?.galleryHeading || "The space"}</h2>
        {site?.galleryBody && (
          <p className="mt-4 max-w-md text-base opacity-90">{site.galleryBody}</p>
        )}

        {/*
          Tiles keep one aspect ratio across breakpoints via `aspect-square` on
          the base and `sm:aspect-[3/2]`. Previously a fixed `h-40` → `sm:h-52`
          inverted the crop between a phone (0.88:1 portrait) and a desktop
          (1.31:1 landscape), so the same photograph read as two different shots
          depending on the device.
        */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {shots.map((shot, i) => (
            <ResponsiveImage
              key={`${shot.src}-${i}`}
              src={shot.src}
              stem={shot.stem}
              alt={shot.alt}
              width={shot.width}
              height={shot.height}
              sizes={shot.span ? SIZES_SPAN : SIZES}
              loading="lazy"
              decoding="async"
              animate
              className={`aspect-square w-full rounded-3xl object-cover sm:aspect-[3/2] ${shot.span}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
