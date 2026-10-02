import { createFileRoute } from "@tanstack/react-router";
import { MapPin } from "lucide-react";

import { PageMeta } from "@/app/PageMeta";
import { Header } from "@/components/layout/Header";
import { CartSheet } from "@/features/cart/components/CartSheet";
import { siteLinks } from "@/config/site";
import { useSiteSettings, useStoreStatus } from "@/features/content/useSiteContent";
import spaceImg from "@/assets/space.jpg";
import coffeeImg from "@/assets/hero-coffee.jpg";

export const Route = createFileRoute("/about")({
  component: About,
});

function About() {
  const { data: site } = useSiteSettings();
  const status = useStoreStatus();
  const links = site ? siteLinks(site) : null;
  // Prefer the live weekly schedule over the owner-written summary so this page
  // cannot contradict the storefront badge.
  const aboutHours = status.weekSummary || site?.hoursSummary;

  return (
    <>
      <PageMeta
        title="About StarKupps — Munger's coffee, pizza & burger café"
        description="How StarKupps started in Munger, Bihar: our founder's note, our kitchen, FSSAI licensing, and where to find us."
        ogTitle="About StarKupps — Munger, Bihar"
        ogDescription="A founder's note, a look inside the kitchen, and directions to the café."
      />

      <Header />
      <main className="mx-auto w-full max-w-3xl px-4 py-14">
        <p className="eyebrow text-primary">Since 2021 · Munger, Bihar</p>
        <h1 className="display-lg mt-3">
          We started because nobody here made a decent cold coffee.
        </h1>

        <div className="mt-8 space-y-4 text-base text-muted-foreground">
          <p>
            StarKupps started with a simple observation: in Munger, finding a good, affordable cup
            of coffee wasn&apos;t easy. The same was true in nearby Jamalpur and the surrounding
            towns. There were plenty of places for chai and snacks, but very few options for clean,
            quality coffee at a price people could enjoy regularly.
          </p>
          <p>We wanted to change that.</p>
          <p>
            At StarKupps, we focus on serving fresh, quality coffee that is prepared with care and
            processed through hygienic methods. From the ingredients we use to the way we prepare
            and serve every cup, cleanliness and quality come first.
          </p>
          <p>
            Our goal is simple — to make good coffee affordable, accessible, and enjoyable for
            everyone in Munger and the nearby areas.
          </p>
          <p className="font-medium text-foreground">
            {site?.brandName ?? "StarKupps"} — quality coffee, made clean and served fresh.
          </p>
        </div>

        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <img
            src={spaceImg}
            alt="The StarKupps counter with the espresso machine and pastry case"
            loading="lazy"
            width={1408}
            height={912}
            className="h-56 w-full rounded-3xl object-cover shadow-card"
          />
          <img
            src={coffeeImg}
            alt="A freshly poured latte with steam rising"
            loading="lazy"
            width={1600}
            height={1200}
            className="h-56 w-full rounded-3xl object-cover shadow-card"
          />
        </div>

        <div className="mt-10 rounded-3xl border border-border bg-card p-5 shadow-card">
          <h2 className="text-xl">Licences &amp; hygiene</h2>
          <dl className="mt-4 space-y-2 text-sm">
            {site?.fssaiLicense && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">FSSAI licence</dt>
                <dd className="font-medium tabular-nums">{site.fssaiLicense}</dd>
              </div>
            )}
            {site?.trustClaim3 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Kitchen hygiene audit</dt>
                <dd className="font-medium">{site.trustClaim3}</dd>
              </div>
            )}
            {aboutHours && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Hours</dt>
                <dd className="font-medium">
                  {aboutHours}
                  {site?.hoursNote ? `, ${site.hoursNote.toLowerCase()}` : ""}
                </dd>
              </div>
            )}
          </dl>
        </div>

        {links?.directions && (
          <a
            href={links.directions}
            target="_blank"
            rel="noreferrer"
            className="mt-6 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-espresso px-5 text-base font-semibold text-espresso-foreground shadow-raised"
          >
            <MapPin className="size-5" />
            Get directions in Google Maps
          </a>
        )}
      </main>

      <CartSheet />
    </>
  );
}
