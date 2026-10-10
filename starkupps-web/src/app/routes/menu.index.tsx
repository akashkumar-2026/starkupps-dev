import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { PageMeta } from "@/app/PageMeta";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Header } from "@/components/layout/Header";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { LazyCartUi } from "@/features/cart/components/LazyCartUi";
import { CategoryImage } from "@/features/menu/category-images";
import { MenuSection } from "@/features/menu/components/MenuSection";
import { summarizeCategory } from "@/features/menu/category-summary";
import { usePublicMenu } from "@/features/menu/usePublicMenu";
import { slugify } from "@/utils/format";

export const Route = createFileRoute("/menu/")({
  component: MenuPage,
});

/**
 * Full-menu hub: every category and item in HTML (never PDF-only), with a card
 * per category linking to its landing page. Category tabs inside MenuSection
 * keep working for ordering; the cards are the crawlable hub spokes.
 */
function MenuPage() {
  const [category, setCategory] = useState<string>("coffee");
  const menu = usePublicMenu();
  const items = menu.data?.items ?? [];
  const counts = new Map<string, number>();
  for (const it of items) {
    const s = slugify(it.categoryName);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const cards = (menu.data?.categories ?? [])
    .filter((c) => !c.comingSoon && (counts.get(slugify(c.name)) ?? 0) > 0)
    .map((c) => {
      const slug = slugify(c.name);
      const catItems = items.filter((it) => slugify(it.categoryName) === slug);
      return { category: c, slug, summary: summarizeCategory(catItems) };
    });
  const total = items.length;

  return (
    <>
      <PageMeta
        title="Menu"
        description="The full StarKupps menu in Munger: cold coffee, shakes, mocktails, pizza, sandwiches and burgers, with prices. All vegetarian."
        ogDescription="Every cold coffee, pizza, burger and mocktail we make — with prices."
        path="/menu"
      />

      <Header />
      <main className="shell max-w-6xl py-10 sm:py-14">
        <Breadcrumbs items={[{ label: "Home", to: "/" }, { label: "Menu" }]} />
        <p className="eyebrow mt-4 text-primary">Eat &amp; drink</p>
        <h1 className="display-lg mt-3">The StarKupps menu.</h1>
        <p className="mt-4 max-w-2xl text-base text-muted-foreground">
          {total > 0
            ? `Everything we make, in one place: ${total} items across ${cards.length} categories, all vegetarian. Order below for dine-in, takeaway or delivery in Munger.`
            : "Everything we make, in one place — pick a category to start your order for dine-in, takeaway or delivery in Munger."}
        </p>

        {cards.length > 0 && (
          <nav aria-label="Menu categories" className="mt-8 grid gap-3 sm:grid-cols-3">
            {cards.map(({ category: c, slug, summary }) => (
              <Link
                key={slug}
                to="/menu/$slug"
                params={{ slug }}
                className="pressable group relative block h-44 overflow-hidden rounded-3xl text-left shadow-card"
              >
                <CategoryImage
                  url={c.imageUrl ?? null}
                  name={c.name}
                  className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <span className="absolute inset-0 bg-espresso/45" />
                <span className="material absolute inset-x-3 bottom-3 rounded-2xl border border-border p-3">
                  <span className="block text-lg font-semibold">{c.name}</span>
                  <span className="mt-0.5 block text-sm opacity-80">
                    {summary.count} items
                    {summary.range ? ` · ${summary.range}` : ""}
                  </span>
                </span>
              </Link>
            ))}
          </nav>
        )}
      </main>

      <MenuSection category={category} onCategoryChange={setCategory} />

      <SiteFooter />
      <LazyCartUi />
    </>
  );
}
