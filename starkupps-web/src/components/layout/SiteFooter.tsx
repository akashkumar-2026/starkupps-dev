import { SITE } from "@/config/site";

/** Site footer. Shared by every full page so the legal and contact copy matches. */
export function SiteFooter() {
  return (
    <footer className="bg-espresso px-4 py-12 pb-24 text-espresso-foreground md:pb-12">
      <div className="mx-auto w-full max-w-6xl">
        <p className="font-display text-2xl font-semibold">{SITE.name}</p>
        <p className="mt-2 text-sm opacity-80">
          {SITE.address} · {SITE.hoursShort} · FSSAI {SITE.fssai}
        </p>
      </div>
    </footer>
  );
}
