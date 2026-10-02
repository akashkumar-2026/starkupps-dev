import { BadgeCheck, Star, Timer } from "lucide-react";

import { usePublicReviews, useSiteSettings } from "@/features/content/useSiteContent";
import { initialsOf } from "@/config/site";

/**
 * "Why trust us".
 *
 * All copy comes from `public.site_settings` (Admin > Settings > Storefront) and
 * the review marquee comes from `public.testimonials` (Admin > Content >
 * Testimonials). Previously the three reviews were a code constant that invented
 * author names and review text, the FSSAI licence was a second literal, and the
 * "9 min" pickup figure and "0 pre-made" claim were rendered unconditionally
 * next to live Gross/Net figures elsewhere in the app.
 *
 * Sections with nothing configured are omitted rather than filled with defaults.
 */
export function TrustSection() {
  const { data: site } = useSiteSettings();
  const { data: reviews, error: reviewsError } = usePublicReviews();

  const claims = [site?.trustClaim1, site?.trustClaim2, site?.trustClaim3].filter(
    (claim): claim is string => Boolean(claim),
  );
  const showHygiene = Boolean(site?.fssaiLicense) || claims.length > 0;
  const showStats = Boolean(site?.trustPickupStat) || Boolean(site?.trustPremadeStat);
  const showReviews = (reviews?.length ?? 0) > 0;

  if (!showHygiene && !showStats && !showReviews) return null;

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14">
      <p className="eyebrow text-primary">Why trust us</p>
      {site?.trustHeading && <h2 className="display-lg mt-2 max-w-2xl">{site.trustHeading}</h2>}

      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {showHygiene && (
          <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
            <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
              <BadgeCheck className="size-5" />
            </span>
            <h3 className="mt-4 text-xl">Hygiene & sourcing</h3>
            {site?.fssaiLicense && (
              <div className="mt-4 flex items-center gap-3 rounded-2xl border border-primary/30 bg-accent/60 p-3">
                <BadgeCheck className="size-5 shrink-0 text-primary" />
                <div>
                  <p className="eyebrow text-muted-foreground">FSSAI licence</p>
                  <p className="text-base font-semibold tabular-nums">{site.fssaiLicense}</p>
                </div>
              </div>
            )}
            {claims.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
                {claims.map((claim) => (
                  <li key={claim}>{claim}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {showReviews && (
          <div className="group flex flex-col overflow-hidden rounded-3xl border border-border bg-card p-5 shadow-card">
            <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
              <Star className="size-5 fill-primary" />
            </span>
            <h3 className="mt-4 text-xl">What customers say</h3>
            <div className="relative mt-4 h-[264px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_12px,black_calc(100%-12px),transparent)]">
              {/* Duplicated so the CSS marquee loops seamlessly. aria-hidden on the
                  copy keeps screen readers from hearing each review twice. */}
              <ul className="review-track flex flex-col gap-4" aria-live="off">
                {[...(reviews ?? []), ...(reviews ?? [])].map((review, idx) => (
                  <li
                    key={`${review.id}-${idx}`}
                    aria-hidden={idx >= (reviews?.length ?? 0) ? true : undefined}
                    className="flex gap-3"
                  >
                    <span
                      aria-hidden
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-espresso text-xs font-bold text-espresso-foreground"
                    >
                      {initialsOf(review.authorName) || "—"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">“{review.content}”</p>
                      <p className="mt-1 text-xs font-semibold">
                        {review.authorName}
                        {review.authorRole ? ` · ${review.authorRole}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            {reviewsError && (
              <p className="mt-2 text-xs text-muted-foreground">
                Reviews are unavailable right now.
              </p>
            )}
          </div>
        )}

        {showStats && (
          <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
            <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
              <Timer className="size-5" />
            </span>
            <h3 className="mt-4 text-xl">Fast & fresh</h3>
            <dl className="mt-4 space-y-3">
              {site?.trustPickupStat && (
                <div>
                  <dd className="font-display text-4xl font-semibold tabular-nums">
                    {site.trustPickupStat}
                  </dd>
                  {site.trustPickupCaption && (
                    <dt className="text-sm text-muted-foreground">{site.trustPickupCaption}</dt>
                  )}
                </div>
              )}
              {site?.trustPremadeStat && (
                <div>
                  <dd className="font-display text-4xl font-semibold tabular-nums">
                    {site.trustPremadeStat}
                  </dd>
                  {site.trustPremadeCaption && (
                    <dt className="text-sm text-muted-foreground">{site.trustPremadeCaption}</dt>
                  )}
                </div>
              )}
            </dl>
          </div>
        )}
      </div>
    </section>
  );
}
