import { type QueryClient } from "@tanstack/react-query";

import type { MenuChange } from "@/api/realtime";
import type { PublicMenu } from "@/types/menu";

/**
 * Merge a realtime menu change into the cached payload.
 *
 * Returns `true` when the cache now reflects the change and no refetch is
 * needed, `false` when the caller must invalidate.
 *
 * Only two cases are safe to merge locally:
 *
 *  - `menu_items.available` — the "sold out" toggle. The gateway derives
 *    `available` and `globalAvailable` on the item plus `available` on each of
 *    its variants from this one column, so it is fully determined by the event.
 *  - `menu_item_variants.price` — the price of an existing variant. Availability
 *    is left alone.
 *
 * Everything else (a new or removed item, a re-parented category, a modifier
 * group change, an outlet-scoped override) reshapes the assembled payload across
 * eight tables, and no single event describes that. Those invalidate instead of
 * being guessed at — a wrong cache entry here means a customer is offered a dish
 * that cannot be ordered.
 */
export function mergeMenuChange(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  change: MenuChange,
): boolean {
  // A reconnect re-sync arrives with no row: always invalidate.
  if (!change.new || Object.keys(change.new).length === 0) return false;

  if (change.table === "menu_items" && typeof change.new["available"] === "boolean") {
    const available = change.new["available"];
    const itemId = Number(change.new["id"]);
    // The gateway omits unavailable items from the payload, so a "back in stock"
    // event for an item we no longer hold cannot be applied from the row alone —
    // its variants, modifiers and price are not in the event. Refetch instead of
    // inventing them.
    if (available) {
      const cached = queryClient.getQueryData<PublicMenu>(queryKey);
      if (!cached) return false;
      if (!cached.items.some((item) => item.id === itemId)) return false;
    }
    return patchCachedMenu(queryClient, queryKey, (menu) => ({
      ...menu,
      items: menu.items
        .map((item) =>
          item.id === itemId
            ? {
                ...item,
                available,
                globalAvailable: available,
                variants: item.variants.map((variant) => ({
                  ...variant,
                  available: variant.available && available,
                })),
              }
            : item,
        )
        .filter((item) => item.available || item.effectiveComingSoon),
    }));
  }

  if (
    change.table === "menu_item_variants" &&
    (typeof change.new["price"] === "number" || typeof change.new["price"] === "string")
  ) {
    const price = Number(change.new["price"]);
    const variantId = Number(change.new["id"]);
    if (!Number.isFinite(price)) return false;
    return patchCachedMenu(queryClient, queryKey, (menu) => ({
      ...menu,
      items: menu.items.map((item) =>
        item.variants.some((variant) => variant.id === variantId)
          ? {
              ...item,
              variants: item.variants.map((variant) =>
                variant.id === variantId ? { ...variant, price, effectivePrice: price } : variant,
              ),
            }
          : item,
      ),
    }));
  }

  return false;
}

/** Apply a pure transform to the cached menu, if it is present. */
function patchCachedMenu(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  transform: (menu: PublicMenu) => PublicMenu,
): boolean {
  const data = queryClient.getQueryData<PublicMenu>(queryKey);
  if (!data) return false;
  queryClient.setQueryData<PublicMenu>(queryKey, transform(data));
  return true;
}
