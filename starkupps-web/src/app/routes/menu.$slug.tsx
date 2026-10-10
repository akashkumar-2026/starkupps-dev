import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { PageMeta } from "@/app/PageMeta";
import { NotFound } from "@/app/route-errors";
import { Breadcrumbs } from "@/components/shared/Breadcrumbs";
import { Header } from "@/components/layout/Header";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CartSheet } from "@/features/cart/components/CartSheet";
import { StickyCartBar } from "@/features/cart/components/StickyCartBar";
import { summarizeCategory } from "@/features/menu/category-summary";
import { MenuSection } from "@/features/menu/components/MenuSection";
import { usePublicMenu } from "@/features/menu/usePublicMenu";
import { slugify } from "@/utils/format";

export const Route = createFileRoute("/menu/$slug")({
  component: CategoryPage,
});

/**
 * One landing page per menu category. The slug is validated against live menu
 * data — an unknown slug renders the 404 screen, never an empty list.
 * Category tabs navigate between sibling pages, so every page is one tap
 * from the rest of the hub.
 */
function CategoryPage() {
  const { slug } = Route.useParams();
  const navigate = useNavigate();
  const menu = usePublicMenu();

  const categories = (menu.data?.categories ?? []).filter((c) => !c.comingSoon);
  const category = categories.find((c) => slugify(c.name) === slug);

  if (menu.data && !category)
    return (
      <>
        <PageMeta title="Page not found" noIndex />
        <NotFound />
      </>
    );

  const items = (menu.data?.items ?? []).filter((it) => slugify(it.categoryName) === slug);
  const summary = summarizeCategory(items);
  const siblings = categories.filter((c) => slugify(c.name) !== slug);

  return (
    <>
      <PageMeta
        title={category ? `${category.name} in Munger` : "Menu"}
        description={
          category
            ? `${category.name} at StarKupps, Munger${category.description ? ` — ${category.description}` : ""}${summary.range ? ` From ${summary.range}.` : ""} All vegetarian.`
            : "StarKupps menu in Munger."
        }
        path={`/menu/${slug}`}
      />

      <Header />
      <main className="shell max-w-6xl py-10 sm:py-14">
        <Breadcrumbs
          items={[
            { label: "Home", to: "/" },
            { label: "Menu", to: "/menu" },
            { label: category?.name ?? "…" },
          ]}
        />
        <p className="eyebrow mt-4 text-primary">Menu · Munger</p>
        <h1 className="display-lg mt-3">
          {category ? `${category.name} at StarKupps.` : "Loading the menu…"}
        </h1>
        {category && (
          <p className="mt-4 max-w-2xl text-base text-muted-foreground">
            {category.description ? `${category.description} ` : ""}
            {summary.count > 0 &&
              `${summary.count} option${summary.count === 1 ? "" : "s"}${
                summary.range ? ` from ${summary.range}` : ""
              }, made to order at our Munger café. `}
            {summary.allVeg && "Everything here is vegetarian. "}
            <Link to="/menu" className="font-semibold text-primary hover:underline">
              See the full menu
            </Link>{" "}
            or{" "}
            <Link to="/contact" className="font-semibold text-primary hover:underline">
              find us
            </Link>
            .
          </p>
        )}
      </main>

      <MenuSection
        category={slug}
        onCategoryChange={(next) => void navigate({ to: "/menu/$slug", params: { slug: next } })}
      />

      {siblings.length > 0 && (
        <nav aria-label="More menu categories" className="shell max-w-6xl pb-14">
          <h2 className="text-lg font-semibold">More from the menu</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {siblings.map((s) => (
              <li key={s.id}>
                <Link
                  to="/menu/$slug"
                  params={{ slug: slugify(s.name) }}
                  className="pressable inline-flex min-h-11 items-center rounded-full border border-border bg-card px-5 text-sm font-semibold"
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <SiteFooter />
      <StickyCartBar />
      <CartSheet />
    </>
  );
}
