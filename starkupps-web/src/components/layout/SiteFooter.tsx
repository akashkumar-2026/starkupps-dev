import { phoneDisplay } from "@/config/site";
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
 */
export function SiteFooter() {
  const { data: site } = useSiteSettings();
  const status = useStoreStatus();

  const phone = site ? phoneDisplay(site.phoneDigits) : "";
  const facts = [
    site?.address,
    status.weekSummary || site?.hoursShort,
    site?.fssaiLicense ? `FSSAI ${site.fssaiLicense}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <footer className="bg-espresso px-4 py-12 pb-24 text-espresso-foreground md:pb-12">
      <div className="mx-auto w-full max-w-6xl">
        <p className="font-display text-2xl font-semibold">{site?.brandName || "StarKupps"}</p>
        {facts.length > 0 && <p className="mt-2 text-sm opacity-80">{facts.join(" · ")}</p>}
        {phone && <p className="mt-2 text-sm opacity-80">{phone}</p>}
      </div>
    </footer>
  );
}
