import { Clock, MapPin, MessageCircle, Phone } from "lucide-react";

import { phoneDisplay, siteLinks } from "@/config/site";
import { useSiteSettings } from "@/features/content/useSiteContent";

/**
 * "Visit" section.
 *
 * Address, hours, phone and WhatsApp all come from `public.site_settings`. Each
 * was a separate hardcoded string here before (including a duplicated address
 * literal and a literal phone number in two `href`s), and the address differed
 * from the copy in `config/site.ts` that the footer used.
 *
 * Links whose number is not configured are omitted rather than rendered as a
 * dead `tel:+` or `wa.me` target.
 */
export function LocationSection() {
  const { data: site } = useSiteSettings();
  if (!site) return null;

  const links = siteLinks(site);
  const phone = phoneDisplay(site.phoneDigits);
  // "Azad Chowk, Munger — open till 11 PM." from the first two address segments
  // plus the owner-configured closing note.
  const area = site.address
    .split(",")
    .slice(0, 2)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const heading = [area, site.openBadge.toLowerCase()].filter(Boolean).join(" — ");

  return (
    <section id="visit" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-14">
      <p className="eyebrow text-primary">Visit</p>
      <h2 className="display-lg mt-2 max-w-2xl">{heading}</h2>

      <div className="mt-8 grid gap-3 md:grid-cols-5">
        {links.mapEmbed && (
          <div className="overflow-hidden rounded-3xl border border-border shadow-card md:col-span-3">
            <iframe
              title="Map showing the cafe"
              src={links.mapEmbed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-64 w-full border-0 md:h-full md:min-h-[22rem]"
            />
          </div>
        )}

        <div className="rounded-3xl border border-border bg-card p-5 shadow-card md:col-span-2">
          {site.addressDetail && (
            <div className="flex gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="text-base">
                {site.brandName}
                <br />
                <span className="text-muted-foreground">{site.addressDetail}</span>
              </p>
            </div>
          )}
          {site.hoursSummary && (
            <div className="mt-4 flex gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="text-base">
                {site.hoursSummary}
                <br />
                {site.hoursNote && <span className="text-muted-foreground">{site.hoursNote}</span>}
              </p>
            </div>
          )}

          {links.directions && (
            <div className="mt-6 grid gap-2">
              <a
                href={links.directions}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-espresso px-5 text-base font-semibold text-espresso-foreground shadow-raised"
              >
                <MapPin className="size-5" />
                Get directions
              </a>
              <div className="grid grid-cols-2 gap-2">
                {links.whatsapp ? (
                  <a
                    href={links.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-base font-semibold"
                  >
                    <MessageCircle className="size-5 text-veg" />
                    WhatsApp
                  </a>
                ) : null}
                {links.tel ? (
                  <a
                    href={links.tel}
                    className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-base font-semibold"
                  >
                    <Phone className="size-5 text-primary" />
                    {phone ? "Call" : "Call us"}
                  </a>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
