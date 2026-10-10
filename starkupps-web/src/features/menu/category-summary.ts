import type { PublicMenuItem } from "@/types/menu";

/**
 * Data-derived summary for a menu category page intro. Everything is computed
 * from the live menu payload — no invented copy — so the React page and the
 * prerendered HTML (which reimplements this in `scripts/prerender.mjs`) agree.
 */
export type CategorySummary = {
  count: number;
  /** e.g. "₹45–₹55", "₹55", or "" when no priced variant exists. */
  range: string;
  allVeg: boolean;
};

export function summarizeCategory(items: PublicMenuItem[]): CategorySummary {
  const prices = items
    .flatMap((i) => i.variants ?? [])
    .filter((v) => v.available !== false)
    .map((v) => v.effectivePrice ?? v.price)
    .filter((p): p is number => typeof p === "number");
  const lo = prices.length ? Math.min(...prices) : null;
  const hi = prices.length ? Math.max(...prices) : null;
  return {
    count: items.length,
    range: lo === null || hi === null ? "" : lo === hi ? `₹${lo}` : `₹${lo}–₹${hi}`,
    allVeg: items.length > 0 && items.every((i) => i.veg === true),
  };
}
