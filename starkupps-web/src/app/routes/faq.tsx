import { createFileRoute, Link } from "@tanstack/react-router";

import { PageMeta } from "@/app/PageMeta";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Header } from "@/components/layout/Header";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { FaqSection } from "@/features/content/components/FaqSection";
import { usePublicFaqs } from "@/features/content/useSiteContent";

export const Route = createFileRoute("/faq")({
  component: FaqPage,
});

/**
 * Standalone FAQ page: the same live Q&A as the home section, with its own
 * canonical URL and FAQPage schema. The section's "get in touch" link points
 * at /contact here instead of the home-page anchor.
 */
function FaqPage() {
  const { data: faqs } = usePublicFaqs();

  return (
    <>
      <PageMeta
        title="FAQ"
        description={`StarKupps Munger FAQs: menu, ordering, hours and location${faqs?.length ? ` — ${faqs.length} answers` : ""}.`}
        ogDescription="Answers about the StarKupps menu, ordering, hours and location."
        path="/faq"
      />

      <Header />
      <main className="shell max-w-3xl py-10 sm:py-14">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "FAQ" }]} />
        <p className="eyebrow mt-4 text-primary">Help &amp; info</p>
        <h1 className="display-lg mt-3">Questions, answered.</h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          Everything about ordering from StarKupps in Munger. Still stuck?{" "}
          <Link to="/contact" className="font-semibold text-primary hover:underline">
            Contact us
          </Link>
          .
        </p>
      </main>

      <div className="mx-auto w-full max-w-3xl px-4 pb-14">
        <FaqSection contactHref="/contact" />
      </div>

      <SiteFooter />
    </>
  );
}
