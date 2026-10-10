import { Phone } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { SOCIAL_LINKS, phoneDisplay, siteLinks } from "@/config/site";
import { useSiteSettings, useStoreStatus } from "@/features/content/useSiteContent";

/**
 * Site footer.
 *
 * Contact details come from `public.site_settings`. When a field is unconfigured
 * the corresponding fragment is omitted rather than replaced with a placeholder
 * value, so the footer never displays a fact the cafe has not entered.
 *
 * Hours come from the live weekly schedule, so changing the opening time in
 * Admin > Outlets > Operating Hours changes the footer too.
 *
 * ## Why the phone number is a link
 *
 * It was inert `text-sm opacity-80` copy. On a desktop that is merely passive;
 * on a phone it is the most useful fact in the footer and it could not be
 * tapped. `siteLinks()` already builds the `tel:` URL that LocationSection uses,
 * so this reuses it instead of hand-rolling a second one.
 *
 * ## Why the facts are no longer one joined string
 *
 * `facts.join(" · ")` wrapped to four or five lines at 320px, after which the
 * separator was frequently the last thing on its line and the three facts read
 * as one paragraph. They are separate lines instead: it wraps predictably and
 * each fact stays identifiable.
 */
export function SiteFooter() {
  const { data: site } = useSiteSettings();
  const status = useStoreStatus();

  const links = site ? siteLinks(site) : null;
  const phone = site ? phoneDisplay(site.phoneDigits) : "";
  const facts = [
    site?.address,
    status.weekSummary || site?.hoursShort,
    site?.fssaiLicense ? `FSSAI ${site.fssaiLicense}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    // `pb-24` reserves room for `StickyCartBar`, which is mobile-only (`md:hidden`).
    // The home page renders both; `/account` renders this footer without the bar,
    // which is why the reserve drops away at `md` rather than being unconditional.
    <footer className="bg-espresso pb-24 text-espresso-foreground md:pb-12">
      <div className="shell py-10 sm:py-12">
        <p className="font-display text-2xl font-semibold">{site?.brandName || "StarKupps"}</p>

        {facts.length > 0 && (
          <dl className="mt-3 space-y-1.5 text-sm opacity-80">
            {site?.address && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="sr-only">Address</dt>
                <dd>{site.address}</dd>
              </div>
            )}
            {(status.weekSummary || site?.hoursShort) && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="sr-only">Opening hours</dt>
                <dd>{status.weekSummary || site?.hoursShort}</dd>
              </div>
            )}
            {site?.fssaiLicense && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="sr-only">FSSAI licence</dt>
                <dd className="tabular-nums">FSSAI {site.fssaiLicense}</dd>
              </div>
            )}
          </dl>
        )}

        {phone && links?.tel && (
          <a
            href={links.tel}
            className="pressable mt-4 inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 text-base font-semibold"
          >
            <Phone className="size-5 shrink-0" />
            Call {phone}
          </a>
        )}

        <nav aria-label="Footer" className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/" className="opacity-80 hover:opacity-100 hover:underline">
            Home
          </Link>
          <Link to="/menu" className="opacity-80 hover:opacity-100 hover:underline">
            Menu
          </Link>
          <Link to="/about" className="opacity-80 hover:opacity-100 hover:underline">
            About
          </Link>
          <Link to="/contact" className="opacity-80 hover:opacity-100 hover:underline">
            Contact
          </Link>
          <Link to="/faq" className="opacity-80 hover:opacity-100 hover:underline">
            FAQ
          </Link>
        </nav>

        <nav aria-label="Social" className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {SOCIAL_LINKS.map((s) => (
            <a
              key={s.href}
              href={s.href}
              target="_blank"
              rel="noopener"
              className="opacity-80 hover:opacity-100 hover:underline"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {site?.updatedAt?.slice(0, 10) && (
          <p className="mt-4 text-xs opacity-60">
            Last updated:{" "}
            <time dateTime={site.updatedAt.slice(0, 10)}>{site.updatedAt.slice(0, 10)}</time>
          </p>
        )}
      </div>
    </footer>
  );
}
