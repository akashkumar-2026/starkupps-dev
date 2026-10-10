import { createFileRoute } from "@tanstack/react-router";

import { PageMeta } from "@/app/PageMeta";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Header } from "@/components/layout/Header";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { phoneDisplay, siteLinks } from "@/config/site";
import { useSiteSettings, useStoreStatus } from "@/features/content/useSiteContent";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "12:00" → "12:00 PM". Passes through anything it cannot parse. */
function displayTime(value: string | null | undefined): string {
  if (!value) return "";
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return value;
  const h24 = Number(m[1]);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

export const Route = createFileRoute("/contact")({
  component: Contact,
});

/**
 * Contact / location page: NAP, weekly hours table, phone/WhatsApp/directions
 * actions, and the map embed — all from live settings, omitted when unconfigured.
 * Question-style H2s mirror the queries AI assistants receive.
 */
function Contact() {
  const { data: site } = useSiteSettings();
  const status = useStoreStatus();
  const links = site ? siteLinks(site) : null;
  const phone = site ? phoneDisplay(site.phoneDigits) : "";
  const hours = site?.weeklyHours ?? [];
  const sunday = hours.find((h) => h.dayOfWeek === 0);

  return (
    <>
      <PageMeta
        title="Contact & location"
        description="Find StarKupps in Munger: address near Azad Chowk, opening hours, phone and WhatsApp, plus directions."
        ogDescription="Address, hours, phone and directions to StarKupps, Munger."
        path="/contact"
      />

      <Header />
      <main className="shell max-w-3xl py-10 sm:py-14">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Contact" }]} />
        <p className="eyebrow mt-4 text-primary">Visit</p>
        <h1 className="display-lg mt-3">Find us in Munger.</h1>

        <section aria-labelledby="where-heading" className="mt-8">
          <h2 id="where-heading" className="text-xl font-semibold">
            Where is StarKupps in Munger?
          </h2>
          {site?.address && (
            <address className="mt-3 text-base not-italic text-muted-foreground">
              {site.address}
              {site.addressDetail && site.addressDetail !== site.address && (
                <span className="mt-1 block text-sm">Landmark: {site.addressDetail}</span>
              )}
            </address>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {links?.directions && (
              <a
                href={links.directions}
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex min-h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
              >
                Get directions
              </a>
            )}
            {links?.tel && phone && (
              <a
                href={links.tel}
                className="pressable inline-flex min-h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-semibold"
              >
                Call {phone}
              </a>
            )}
            {links?.whatsapp && (
              <a
                href={links.whatsapp}
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex min-h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-semibold"
              >
                WhatsApp us
              </a>
            )}
          </div>
          {links?.mapEmbed && (
            <div className="mt-4 overflow-hidden rounded-3xl border border-border shadow-card">
              <iframe
                title="Map showing the StarKupps cafe in Munger"
                src={links.mapEmbed}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                className="h-64 w-full border-0 md:h-80"
              />
            </div>
          )}
        </section>

        <section aria-labelledby="hours-heading" className="mt-10">
          <h2 id="hours-heading" className="text-xl font-semibold">
            When is StarKupps open?
          </h2>
          {sunday && (
            <p className="mt-3 text-base text-muted-foreground">
              {sunday.isOpen
                ? `Yes — we are open on Sundays${sunday.openTime ? `, ${displayTime(sunday.openTime)} to ${displayTime(sunday.closeTime)}` : ""}.`
                : "We are closed on Sundays."}
              {site?.hoursNote ? ` ${site.hoursNote}.` : ""}
            </p>
          )}
          {hours.length > 0 ? (
            <table className="mt-4 w-full max-w-md text-sm">
              <caption className="sr-only">Opening hours by day</caption>
              <tbody>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                  const h = hours.find((row) => row.dayOfWeek === d);
                  return (
                    <tr key={d} className="border-b border-border last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-medium">
                        {DAY_NAMES[d]}
                      </th>
                      <td className="py-2 text-right text-muted-foreground">
                        {!h || !h.isOpen
                          ? "Closed"
                          : h.openTime && h.closeTime
                            ? `${displayTime(h.openTime)} – ${displayTime(h.closeTime)}`
                            : site?.hoursShort || "See hours note"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            site?.hoursSummary && (
              <p className="mt-3 text-base text-muted-foreground">{site.hoursSummary}</p>
            )
          )}
          {status.weekSummary && (
            <p className="mt-2 text-sm text-muted-foreground">{status.weekSummary}</p>
          )}
        </section>

        <section aria-labelledby="contact-heading" className="mt-10">
          <h2 id="contact-heading" className="text-xl font-semibold">
            How do I contact StarKupps?
          </h2>
          <p className="mt-3 text-base text-muted-foreground">
            {phone ? `Call or WhatsApp us on ${phone} ` : "Reach us on WhatsApp "}
            for orders, party bookings and feedback. For anything about the menu, see{" "}
            <a href="/menu" className="font-semibold text-primary hover:underline">
              the full menu
            </a>
            .
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
