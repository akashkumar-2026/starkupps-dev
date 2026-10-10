import { Suspense, lazy, useMemo, useState } from "react";
import { motion } from "motion/react";
import { Plus } from "lucide-react";
import { FetchErrorState } from "@/components/shared/FetchErrorState";
import { Pressable } from "@/components/shared/Pressable";
import { useSiteSettings } from "@/features/content/useSiteContent";
import { inr, slugify } from "@/utils/format";
import { springs } from "@/utils/motion";
import { cn } from "@/utils/cn";
import { usePublicMenu } from "@/features/menu/usePublicMenu";
import type { DisplayCategory, DisplayMenuItem } from "@/types/menu";
import { CategoryImage } from "@/features/menu/category-images";

/**
 * ItemSheet (add-to-cart flow) loads on first item tap, not with the menu.
 * It is the heaviest interaction on this page and nobody needs it before
 * tapping — gating on `active` keeps it (and its cart/form deps) out of the
 * initial bundle without changing the flow.
 */
const ItemSheet = lazy(() =>
  import("@/features/cart/components/ItemSheet").then((m) => ({ default: m.ItemSheet })),
);

export function MenuSection({
  category,
  onCategoryChange,
}: {
  category: string;
  onCategoryChange: (c: string) => void;
}) {
  const { data, error, refetch, isRefetching } = usePublicMenu();
  const { data: site } = useSiteSettings();
  const [active, setActive] = useState<DisplayMenuItem | null>(null);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);

  const categories: DisplayCategory[] = useMemo(() => {
    if (!data?.categories) return [];
    // Item counts per category slug — empty (non-teaser) categories are
    // hidden so customers never land on a blank list.
    const counts = new Map<string, number>();
    for (const it of data.items ?? []) {
      const s = slugify(it.categoryName);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    return data.categories
      .map((c) => {
        const slug = slugify(c.name);
        const comingSoon = Boolean(c.comingSoon);
        return {
          id: slug,
          label: c.name,
          imageUrl: c.imageUrl ?? null,
          dbId: c.id,
          comingSoon,
          description: c.description ?? null,
          count: counts.get(slug) ?? 0,
        };
      })
      .filter((c) => c.comingSoon || (c.count ?? 0) > 0);
  }, [data]);

  // Derive effective category without mutating parent during render — avoids
  // MutationObserver `observe(null)` race caused by syncing state inside an effect
  // while framer-motion is measuring layout.
  // Prefer the first category that actually has items (never an empty list);
  // fall back to the first visible category (e.g. a coming-soon teaser).
  const activeCategory = useMemo(() => {
    if (!categories.length) return category;
    if (categories.some((c) => c.id === category && (c.count ?? 0) > 0)) return category;
    const firstWithItems = categories.find((c) => (c.count ?? 0) > 0);
    return (firstWithItems ?? categories[0]!).id;
  }, [categories, category]);

  const items: DisplayMenuItem[] = useMemo(() => {
    if (!data?.items) return [];
    return (
      data.items
        .filter((it) => {
          if (!activeCategory) return true;
          const catSlug = slugify(it.categoryName);
          return catSlug === activeCategory;
        })
        // Keep comingSoon items visible (do not filter out) — they are blurred but searchable
        .map((it) => {
          const variants = (it.variants ?? []).map((v) => ({
            id: v.id,
            name: v.name,
            quantity: v.quantity,
            unit: v.unit,
            price: v.effectivePrice,
            effectivePrice: v.effectivePrice,
            available: v.available,
            isDefault: v.isDefault,
          }));
          // Sellable price is always from variant — default variant or first
          const defaultPrice =
            variants.find((v) => v.isDefault)?.effectivePrice ?? variants[0]?.effectivePrice ?? 0;
          const catComingSoon = Boolean(
            it.categoryComingSoon ?? categories.find((c) => c.dbId === it.categoryId)?.comingSoon,
          );
          const itemComingSoon = Boolean(it.comingSoon);
          const effectiveComingSoon =
            itemComingSoon || catComingSoon || Boolean(it.effectiveComingSoon);
          return {
            id: it.id,
            name: it.name,
            desc: it.description ?? "",
            price: defaultPrice,
            veg: it.veg,
            imageUrl: it.imageUrl ?? null,
            comingSoon: itemComingSoon,
            categoryComingSoon: catComingSoon,
            effectiveComingSoon,
            groups: (it.modifierGroups ?? []).map((g) => ({
              id: String(g.id),
              label: g.name,
              options: g.options.map((o) => ({
                id: String(o.id),
                label: o.name,
                delta: o.priceDelta,
                optionId: o.id,
                groupId: g.id,
              })),
            })),
            variants,
            defaultVariantId: it.defaultVariantId ?? null,
            allergens: undefined,
            _public: it,
          };
        })
    );
  }, [data, activeCategory, categories]);

  const openItem = (item: DisplayMenuItem, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    setActive(item);
  };

  return (
    <section id="menu" className="mx-auto w-full max-w-6xl scroll-mt-16 px-4 py-14">
      <p className="eyebrow text-primary">Order</p>
      {site?.menuHeading && <h2 className="display-lg mt-2">{site.menuHeading}</h2>}

      <div className="rubber-scroll -mx-4 mt-6 flex gap-2 px-4 pb-1">
        {categories.map((c) => (
          <Pressable
            key={c.id}
            onPointerDown={() => onCategoryChange(c.id)}
            aria-pressed={activeCategory === c.id}
            className={cn(
              "relative min-h-11 shrink-0 rounded-full border px-5 text-sm font-semibold",
              c.comingSoon && "opacity-70 ring-1 ring-primary/30",
              activeCategory === c.id
                ? "border-primary bg-primary text-primary-foreground shadow-chip"
                : "border-border bg-card text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {c.label}
              {c.comingSoon && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-primary">
                  Coming Soon
                </span>
              )}
            </span>
          </Pressable>
        ))}
        {!data && !error && (
          <>
            <div className="h-11 w-24 animate-pulse rounded-full bg-muted" />
            <div className="h-11 w-28 animate-pulse rounded-full bg-muted" />
            <div className="h-11 w-20 animate-pulse rounded-full bg-muted" />
          </>
        )}
      </div>

      {!data && !error ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-3xl bg-muted" />
          ))}
        </div>
      ) : null}

      {error ? (
        <FetchErrorState
          title="We couldn't load the menu"
          description="The menu service didn't respond. This is a real failure rather than a delay, so please try again."
          onRetry={() => refetch()}
          retrying={isRefetching}
        />
      ) : null}

      {data && !error && categories.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          {site?.menuEmptyMessage ||
            "The menu has not been published yet. Please check back shortly."}
        </p>
      ) : null}

      {data && !error && categories.length > 0 && items.length === 0
        ? (() => {
            const activeCat = categories.find((c) => c.id === activeCategory);
            const isCatComingSoon = Boolean(activeCat?.comingSoon);
            if (!activeCat)
              return (
                <p className="mt-8 text-center text-sm text-muted-foreground">
                  No items in this category. Check back soon.
                </p>
              );
            return (
              <div className="mt-6 mx-auto max-w-[420px]">
                <div
                  className={cn(
                    "overflow-hidden rounded-[22px] border bg-card shadow-card",
                    isCatComingSoon ? "border-primary/30" : "border-border",
                  )}
                >
                  <div className="relative h-48 w-full overflow-hidden bg-muted">
                    <CategoryImage
                      url={activeCat.imageUrl}
                      name={activeCat.label}
                      className={cn(
                        "h-full w-full object-cover",
                        isCatComingSoon && "blur-[7px] scale-105",
                      )}
                    />
                    {isCatComingSoon && (
                      <div className="absolute inset-0 grid place-items-center bg-background/45 backdrop-blur-[1px]">
                        <span className="rounded-full bg-foreground px-4 py-1.5 text-xs font-extrabold uppercase tracking-[0.14em] text-background shadow">
                          Coming Soon
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold">{activeCat.label}</h3>
                      {isCatComingSoon && (
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-primary-foreground">
                          Coming Soon
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{activeCat.description}</p>
                  </div>
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  {isCatComingSoon
                    ? "This category is launching soon — preview only, ordering blocked."
                    : "No items in this category. Check back soon."}
                </p>
              </div>
            );
          })()
        : null}

      {items.length > 0 && (
        <motion.ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const isComingSoon = Boolean(item.effectiveComingSoon);
            return (
              <motion.li
                key={String(item.id)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={springs.section}
                className={cn(
                  "relative flex gap-4 overflow-hidden rounded-3xl border bg-card p-3 shadow-card",
                  isComingSoon ? "border-primary/30" : "border-border",
                )}
              >
                <Pressable
                  onClick={(e) => {
                    if (isComingSoon) return;
                    openItem(item, e.currentTarget);
                  }}
                  disabled={isComingSoon}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-4 text-left",
                    isComingSoon && "cursor-not-allowed opacity-80",
                  )}
                >
                  <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-muted">
                    <CategoryImage
                      url={item.imageUrl}
                      name={item.name}
                      className={cn(
                        "size-24 shrink-0 rounded-2xl object-cover",
                        isComingSoon && "blur-[6px] scale-105",
                      )}
                    />
                    {isComingSoon && (
                      <div
                        aria-hidden="true"
                        className="absolute inset-0 z-10 grid place-items-center rounded-2xl bg-foreground/55 px-2 text-center text-background backdrop-blur-sm"
                      >
                        <span className="text-[11px] font-extrabold uppercase leading-tight tracking-[0.12em]">
                          Coming
                          <br />
                          Soon
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={cn(
                          "size-3 rounded-[3px] border",
                          item.veg ? "border-veg" : "border-nonveg",
                        )}
                      >
                        <span
                          className={cn(
                            "block size-full scale-50 rounded-full",
                            item.veg ? "bg-veg" : "bg-nonveg",
                          )}
                        />
                      </span>
                      <p className="truncate text-base font-semibold">{item.name}</p>
                      {isComingSoon && (
                        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-primary-foreground">
                          Coming Soon
                        </span>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.desc}
                      {item.variants?.length
                        ? ` · ${item.variants.map((v) => v.name).join(" / ")}`
                        : ""}
                    </p>
                    <p className="mt-2 text-sm font-semibold tabular-nums">
                      {item.variants.length === 1
                        ? inr(item.variants[0]!.price)
                        : `${inr(Math.min(...item.variants.map((v) => v.price)))} – ${inr(Math.max(...item.variants.map((v) => v.price)))}`}
                    </p>
                  </div>
                </Pressable>
                {isComingSoon ? (
                  <span
                    className="grid size-11 shrink-0 place-self-center place-items-center rounded-full bg-muted text-muted-foreground"
                    aria-label="Coming soon — cannot add"
                  >
                    <Plus className="size-5 place-self-center opacity-40" />
                  </span>
                ) : (
                  <Pressable
                    onClick={(e) => {
                      openItem(item, e.currentTarget);
                    }}
                    aria-label={`Add ${item.name}`}
                    className="grid size-11 shrink-0 place-self-center rounded-full bg-primary text-primary-foreground shadow-chip"
                  >
                    <Plus className="size-5 place-self-center" />
                  </Pressable>
                )}
              </motion.li>
            );
          })}
        </motion.ul>
      )}

      {active && (
        <Suspense fallback={null}>
          <ItemSheet item={active} origin={origin} onClose={() => setActive(null)} />
        </Suspense>
      )}
    </section>
  );
}
