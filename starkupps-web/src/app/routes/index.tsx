import { Suspense, lazy, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDown, RefreshCw, Star } from "lucide-react";

import { PageMeta } from "@/app/PageMeta";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pressable } from "@/components/shared/Pressable";
import { ResponsiveImage } from "@/components/shared/ResponsiveImage";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { LazyCartUi } from "@/features/cart/components/LazyCartUi";
import { LocationSection } from "@/features/content/components/LocationSection";
import { useSiteSettings, useStoreStatus } from "@/features/content/useSiteContent";
import { CategoryImage } from "@/features/menu/category-images";
import { usePublicMenu } from "@/features/menu/usePublicMenu";
import { Header } from "@/components/layout/Header";
import { slugify } from "@/utils/format";
import heroImg from "@/assets/hero-coffee.jpg";

/**
 * Below-the-fold sections load after first paint. Home's LCP element is the
 * hero image; everything below it (menu, trust, gallery, Instagram, FAQ)
 * defers via lazy + null fallbacks. Insertions happen below the viewport, so
 * no layout shift is visible (CLS unaffected). Menu/contact pages keep these
 * static — there the menu IS the LCP context.
 */
const MenuSection = lazy(() =>
  import("@/features/menu/components/MenuSection").then((m) => ({ default: m.MenuSection })),
);
const TrustSection = lazy(() =>
  import("@/features/content/components/TrustSection").then((m) => ({
    default: m.TrustSection,
  })),
);
const GallerySection = lazy(() =>
  import("@/features/content/components/GallerySection").then((m) => ({
    default: m.GallerySection,
  })),
);
const InstagramSection = lazy(() =>
  import("@/features/instagram/components/InstagramSection").then((m) => ({
    default: m.InstagramSection,
  })),
);
const FaqSection = lazy(() =>
  import("@/features/content/components/FaqSection").then((m) => ({ default: m.FaqSection })),
);

export const Route = createFileRoute("/")({
  component: Home,
});

function CategoryGrid({ onSelect }: { onSelect: (id: string) => void }) {
  const menu = usePublicMenu();

  // No data yet — keep the grid's footprint so the page does not jump.
  if (!menu.data && !menu.error) {
    return (
      <div className="grid gap-3 sm:grid-cols-3" aria-hidden>
        {[0, 1, 2].map((slot) => (
          <div key={slot} className="h-56 animate-pulse rounded-3xl bg-muted" />
        ))}
      </div>
    );
  }

  if (menu.error) {
    return (
      <div
        role="alert"
        className="rounded-3xl border border-border bg-card px-6 py-10 text-center shadow-card"
      >
        <h3 className="mt-4 text-base font-semibold">We couldn&apos;t load the menu</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          The menu service didn&apos;t respond. This is a real failure, not a delay — please try
          again.
        </p>
        <Pressable
          onClick={() => void menu.refetch()}
          disabled={menu.isFetching}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-chip disabled:opacity-50"
        >
          <RefreshCw className={menu.isFetching ? "size-4 animate-spin" : "size-4"} />
          {menu.isFetching ? "Retrying" : "Try again"}
        </Pressable>
      </div>
    );
  }

  const itemsByCategory = new Map<string, number>();
  for (const item of menu.data?.items ?? []) {
    const slug = slugify(item.categoryName);
    itemsByCategory.set(slug, (itemsByCategory.get(slug) ?? 0) + 1);
  }

  // Hide categories with nothing in them so every tile leads somewhere.
  const categories = (menu.data?.categories ?? [])
    .filter(
      (category) => category.comingSoon || (itemsByCategory.get(slugify(category.name)) ?? 0) > 0,
    )
    .map((category) => {
      const slug = slugify(category.name);
      return {
        id: slug,
        label: category.name,
        imageUrl: category.imageUrl ?? null,
      };
    });

  if (categories.length === 0) {
    return (
      <EmptyState
        title="No categories yet"
        hint="The menu has not been published. Please check back shortly."
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {categories.map((category) => (
        <Pressable
          key={category.id}
          onClick={() => onSelect(category.id)}
          className="group relative h-56 overflow-hidden rounded-3xl text-left shadow-card"
        >
          <CategoryImage
            url={category.imageUrl}
            name={category.label}
            className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
          <span className="absolute inset-0 bg-espresso/45" />
          <span className="material absolute inset-x-3 bottom-3 rounded-2xl border border-border p-3">
            <span className="block text-lg font-semibold">{category.label}</span>
          </span>
        </Pressable>
      ))}
    </div>
  );
}

function StatsStrip() {
  const { data: site } = useSiteSettings();
  type StatFact = { icon?: React.ReactNode; label: string };
  const facts: StatFact[] = [
    {
      icon: <Star className="size-4 fill-primary text-primary" />,
      label: site?.statRatingLabel ?? "",
    },
    { label: site?.statOrdersLabel ?? "" },
    { label: site?.statPickupLabel ?? "" },
  ].filter((fact) => Boolean(fact.label));
  if (facts.length === 0) return null;
  return (
    <section className="border-b border-border bg-card">
      <div className="rubber-scroll shell flex gap-6 py-5 text-sm">
        {facts.map((fact) => (
          <span
            key={fact.label}
            className={
              fact.icon
                ? "flex shrink-0 items-center gap-2 font-semibold"
                : "shrink-0 text-muted-foreground"
            }
          >
            {fact.icon}
            {fact.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function Home() {
  const [category, setCategory] = useState<string>("coffee");
  // matchMedia instead of motion's hook: this route no longer imports motion.
  const reducedMotion =
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const { data: site } = useSiteSettings();
  const status = useStoreStatus();

  const scrollToMenu = (nextCategory?: string) => {
    if (nextCategory) setCategory(nextCategory);
    document.getElementById("menu")?.scrollIntoView({
      behavior: reducedMotion ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <>
      <PageMeta
        title={site?.metaTitle || "StarKupps"}
        description={site?.metaDescription || "Cold coffee, pizza and burgers in Munger, Bihar."}
        ogDescription={
          site?.metaOgDescription || "Fresh dough, smashed patties, serious cold coffee."
        }
        path="/"
      />

      <Header />
      <main>
        <section className="relative overflow-hidden">
          {/*
            `sizes` is what stops a phone downloading the 1600px original: the
            hero is full-bleed at every width, capped by `max-w-6xl` only for
            the text column, not the image.
          */}
          <ResponsiveImage
            src={heroImg}
            stem="hero-coffee"
            alt="A latte with steam rising in a terracotta cup at StarKupps"
            width={1600}
            height={1200}
            sizes="100vw"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className="hero-drift absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-espresso/60" />
          <div className="relative mx-auto flex min-h-[86svh] w-full max-w-6xl flex-col justify-end px-4 pb-10 pt-24 text-espresso-foreground">
            {(site?.heroBadge || status.isOpen !== null) && (
              <div
                className={`material mb-6 inline-flex w-fit items-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold text-foreground transition-colors ${
                  status.isOpen ? "border-veg/40 bg-accent/70" : "border-border"
                }`}
              >
                {site?.heroBadge}
                {site?.heroBadge && status.isOpen !== null && (
                  <span aria-hidden="true" className="text-border">
                    ·
                  </span>
                )}
                {status.isOpen !== null && (
                  <span className="inline-flex items-center gap-2">
                    {/* Two expanding rings while trading: the blinking dot is the
                        only signal a visitor can read from the street. */}
                    <span aria-hidden="true" className="relative grid size-2.5 place-items-center">
                      {status.isOpen ? (
                        <>
                          <span className="absolute size-2.5 animate-ping rounded-full bg-veg/60" />
                          <span className="absolute size-2 animate-pulse rounded-full bg-veg/80" />
                          <span className="size-2 rounded-full bg-veg" />
                        </>
                      ) : (
                        <span className="size-2 rounded-full bg-muted-foreground" />
                      )}
                    </span>
                    <span className={status.isOpen ? "text-veg" : "text-muted-foreground"}>
                      {status.isOpen ? status.detail || "Open now" : "Closed"}
                    </span>
                  </span>
                )}
              </div>
            )}
            {site?.heroHeading && <h1 className="display-xl max-w-3xl">{site.heroHeading}</h1>}
            {site?.heroSubheading && (
              <p className="mt-5 max-w-md text-base opacity-90">{site.heroSubheading}</p>
            )}
            <div className="mt-8">
              <Pressable
                onClick={() => scrollToMenu()}
                className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-primary px-7 text-base font-semibold text-primary-foreground shadow-raised"
              >
                {site?.heroCtaLabel || "Order now"}
                <ArrowDown className="size-5" />
              </Pressable>
            </div>
          </div>
        </section>

        <StatsStrip />

        <section className="shell pt-14">
          <CategoryGrid onSelect={scrollToMenu} />
        </section>

        <Suspense fallback={null}>
          <MenuSection category={category} onCategoryChange={setCategory} />
          <TrustSection />
          <GallerySection />
          <InstagramSection />
          <FaqSection />
        </Suspense>
        <LocationSection />

        <SiteFooter />
      </main>

      <LazyCartUi />
    </>
  );
}
