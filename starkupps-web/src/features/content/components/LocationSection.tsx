import { Clock, MapPin, Phone } from "lucide-react";

import { phoneDisplay, siteLinks } from "@/config/site";
import { useSiteSettings, useStoreStatus } from "@/features/content/useSiteContent";

/**
 * "Visit" section.
 *
 * Address, hours, phone and WhatsApp all come from `public.site_settings`. Each
 * was a separate hardcoded string here before (including a duplicated address
 * literal and a literal phone number in two `href`s), and the address differed
 * from the copy in `config/site.ts` that the footer used.
 *
 * Hours are read from the store's structured weekly schedule (Admin > Outlets >
 * Operating Hours) so the page reflects a real change of opening time. The
 * owner-written `hoursSummary` is only used when no schedule exists.
 *
 * Links whose number is not configured are omitted rather than rendered as a
 * dead `tel:+` or `wa.me` target.
 */
export function LocationSection() {
  const { data: site } = useSiteSettings();
  const status = useStoreStatus();
  if (!site) return null;

  const links = siteLinks(site);
  const phone = phoneDisplay(site.phoneDigits);
  // "Azad Chowk, Munger — open till 11 PM." from the first two address segments
  // plus today's live status.
  const area = site.address
    .split(",")
    .slice(0, 2)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
  const statusSuffix =
    status.isOpen === null
      ? site.openBadge.toLowerCase()
      : `${status.isOpen ? "open" : "closed"}${status.detail ? ` · ${status.detail.toLowerCase()}` : ""}`;
  const heading = [area, statusSuffix].filter(Boolean).join(" — ");
  const hoursLine = status.todayLabel || site.hoursSummary;
  const hoursNote = status.weekSummary || site.hoursNote;

  return (
    <section id="visit" className="shell section-y scroll-mt-16">
      <p className="eyebrow text-primary">Visit</p>
      <h2 className="display-lg mt-2 max-w-2xl">{heading}</h2>

      <div className="mt-8 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        {links.mapEmbed && (
          <div className="overflow-hidden rounded-3xl border border-border shadow-card md:col-span-2 lg:col-span-3">
            <iframe
              title="Map showing the cafe"
              src={links.mapEmbed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-64 w-full border-0 md:h-full md:min-h-[22rem] lg:min-h-[22rem]"
            />
          </div>
        )}

        <div className="rounded-3xl border border-border bg-card p-5 shadow-card md:col-span-2 lg:col-span-2">
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
          {hoursLine && (
            <div className="mt-4 flex gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-primary" />
              <p className="text-base">
                Today: {hoursLine}
                {hoursNote && <span className="text-muted-foreground"> · {hoursNote}</span>}
              </p>
            </div>
          )}

          {links.directions && (
            <div className="mt-6 grid gap-2">
              <a
                href={links.directions}
                target="_blank"
                rel="noreferrer"
                className="pressable flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-espresso px-5 text-base font-semibold text-espresso-foreground shadow-raised"
              >
                <MapPin className="size-5 shrink-0" />
                Get directions
              </a>
              <div className="grid grid-cols-1 gap-2 min-[26rem]:grid-cols-2">
                {links.whatsapp ? (
                  <a
                    href={links.whatsapp}
                    target="_blank"
                    rel="noreferrer"
                    className="pressable flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-base font-semibold"
                  >
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="size-5 shrink-0 text-[#25D366]"
                    >
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.198-.347.223-.644.075-.297-.149-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.52.149-.174.198-.298.297-.496.1-.198.05-.372-.025-.521-.074-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.875 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.262.489 1.693.626.711.226 1.358.194 1.87.118.57-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.511-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64.001 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.884 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c-.001 2.096.547 4.142 1.588 5.946L.057 24l6.304-1.654a11.882 11.882 0 005.684 1.447h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.479-8.412Z" />
                    </svg>
                    WhatsApp
                  </a>
                ) : null}
                {links.tel ? (
                  <a
                    href={links.tel}
                    className="pressable flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background px-4 text-base font-semibold"
                  >
                    <Phone className="size-5 shrink-0 text-primary" />
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
