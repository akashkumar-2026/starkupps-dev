import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import { ArrowDown, Coffee, RefreshCw, Star } from "lucide-react";

import { PageMeta } from "@/app/PageMeta";
import { Pressable } from "@/components/shared/Pressable";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { CartSheet } from "@/features/cart/components/CartSheet";
import { StickyCartBar } from "@/features/cart/components/StickyCartBar";
import { GallerySection } from "@/features/content/components/GallerySection";
import { LocationSection } from "@/features/content/components/LocationSection";
import { TrustSection } from "@/features/content/components/TrustSection";
import { InstagramSection } from "@/features/instagram/components/InstagramSection";
import { categoryImage } from "@/features/menu/category-images";
import { usePublicMenu } from "@/features/menu/usePublicMenu";
import { MenuSection } from "@/features/menu/components/MenuSection";
import { Header } from "@/components/layout/Header";
import { slugify } from "@/utils/format";
import { springs } from "@/utils/motion";
import heroImg from "@/assets/hero-coffee.jpg";

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
      <div className="rounded-3xl border border-border bg-card px-6 py-10 text-center shadow-card">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
          <Coffee className="size-6" />
        </div>
        <h3 className="mt-4 text-base font-semibold">Fresh menu on its way</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          We&apos;re syncing the latest dishes from the kitchen. This usually takes a few seconds.
        </p>
        <Pressable
          onClick={() => void menu.refetch()}
          disabled={menu.isFetching}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground shadow-chip disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${menu.isFetching ? "animate-spin" : ""}`} />
          Try again
        </Pressable>
        <p className="mt-3 text-xs text-muted-foreground">
          If this persists, give us a call — we&apos;ll sort it out.
        </p>
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
      return { id: slug, label: category.name, image: categoryImage(slug) };
    });

  if (categories.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Categories are being set up.</p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {categories.map((category) => (
        <Pressable
          key={category.id}
          onClick={() => onSelect(category.id)}
          transition={springs.section}
          className="group relative h-56 overflow-hidden rounded-3xl text-left shadow-card"
        >
          <img
            src={category.image}
            alt={category.label}
            loading="lazy"
            width={912}
            height={1104}
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

function Home() {
  const [category, setCategory] = useState<string>("coffee");
  const reducedMotion = useReducedMotion();

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
        title="Coffee, Pizza & Burgers in Munger"
        description="Order cold coffee, hand-stretched pizza and smash burgers from StarKupps, Munger. Dine-in, takeaway or delivery — UPI checkout in under a minute."
        ogDescription="Fresh dough, smashed patties, serious cold coffee. Order in under a minute."
      />

      <Header />
      <main>
        <section className="relative overflow-hidden">
          <motion.img
            src={heroImg}
            alt="A latte with steam rising in a terracotta cup at StarKupps"
            width={1600}
            height={1200}
            fetchPriority="high"
            className="absolute inset-0 size-full object-cover"
            initial={reducedMotion ? {} : { scale: 1.12 }}
            animate={reducedMotion ? {} : { scale: 1 }}
            transition={{ duration: 14, ease: "linear" }}
          />
          <div className="absolute inset-0 bg-espresso/60" />
          <div className="relative mx-auto flex min-h-[86svh] w-full max-w-6xl flex-col justify-end px-4 pb-10 pt-24 text-espresso-foreground">
            <div className="material mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground">
              <span className="relative grid size-2 place-items-center">
                <span className="absolute size-2 animate-ping rounded-full bg-veg/70" />
                <span className="size-2 rounded-full bg-veg" />
              </span>
              Open now · Closes 11 PM
            </div>
            <h1 className="display-xl max-w-3xl">Cold coffee that ruins other cold coffee.</h1>
            <p className="mt-5 max-w-md text-base opacity-90">
              Munger&apos;s café for slow-churned coffee, hand-stretched pizza and smash burgers.
              Order in a minute, eat in ten.
            </p>
            <div className="mt-8">
              <Pressable
                onClick={() => scrollToMenu()}
                className="inline-flex min-h-14 items-center gap-2 rounded-2xl bg-primary px-7 text-base font-semibold text-primary-foreground shadow-raised"
              >
                Order now
                <ArrowDown className="size-5" />
              </Pressable>
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-card">
          <div className="rubber-scroll mx-auto flex w-full max-w-6xl gap-6 px-4 py-5 text-sm">
            <span className="flex shrink-0 items-center gap-2 font-semibold">
              <Star className="size-4 fill-primary text-primary" />
              4.8 on Google · 1,240 reviews
            </span>
            <span className="shrink-0 text-muted-foreground">312 orders this week</span>
            <span className="shrink-0 text-muted-foreground">Avg. pickup time 9 min</span>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pt-14">
          <CategoryGrid onSelect={scrollToMenu} />
        </section>

        <MenuSection category={category} onCategoryChange={setCategory} />

        <TrustSection />
        <GallerySection />
        <InstagramSection />
        <LocationSection />

        <SiteFooter />
      </main>

      <StickyCartBar />
      <CartSheet />
    </>
  );
}
