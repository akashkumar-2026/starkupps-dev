import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import type { MenuChange } from "@/api/realtime";
import type { PublicMenu } from "@/types/menu";
import { mergeMenuChange } from "./mergeMenuChange";

const KEY = ["public", "menu", null] as const;

function menu(): PublicMenu {
  return {
    categories: [{ id: 1, name: "Coffee", sortOrder: 1 }],
    items: [
      {
        id: 10,
        categoryId: 1,
        categoryName: "Coffee",
        name: "Cold Coffee",
        description: null,
        imageUrl: null,
        veg: true,
        available: true,
        globalAvailable: true,
        comingSoon: false,
        effectiveComingSoon: false,
        modifierGroups: [],
        variants: [
          {
            id: 100,
            menuItemId: 10,
            name: "Regular",
            quantity: null,
            unit: null,
            price: 150,
            effectivePrice: 150,
            sku: null,
            available: true,
            globalAvailable: true,
            isDefault: true,
            sortOrder: 0,
          },
        ],
        defaultVariantId: 100,
      },
      {
        id: 11,
        categoryId: 1,
        categoryName: "Coffee",
        name: "Mocha",
        description: null,
        imageUrl: null,
        veg: true,
        available: true,
        globalAvailable: true,
        comingSoon: false,
        effectiveComingSoon: false,
        modifierGroups: [],
        variants: [
          {
            id: 110,
            menuItemId: 11,
            name: "Regular",
            quantity: null,
            unit: null,
            price: 180,
            effectivePrice: 180,
            sku: null,
            available: true,
            globalAvailable: true,
            isDefault: true,
            sortOrder: 0,
          },
        ],
        defaultVariantId: 110,
      },
    ],
  } as unknown as PublicMenu;
}

function clientWith(payload: PublicMenu | undefined): QueryClient {
  const queryClient = new QueryClient();
  if (payload) queryClient.setQueryData(KEY, payload);
  return queryClient;
}

function change(partial: Partial<MenuChange>): MenuChange {
  return {
    table: "menu_items",
    eventType: "UPDATE",
    new: {},
    old: {},
    ...partial,
  } as MenuChange;
}

describe("mergeMenuChange", () => {
  it("marks an item sold out and hides it, without a refetch", () => {
    const queryClient = clientWith(menu());
    const merged = mergeMenuChange(queryClient, KEY, change({ new: { id: 10, available: false } }));

    expect(merged).toBe(true);
    const cached = queryClient.getQueryData<PublicMenu>(KEY)!;
    // Sold-out items are removed from the customer-facing list.
    expect(cached.items.map((i) => i.id)).toEqual([11]);
  });

  it("keeps a sold-out item that is still coming soon, flagged as unavailable", () => {
    const queryClient = clientWith(menu());
    const base = queryClient.getQueryData<PublicMenu>(KEY)!;
    queryClient.setQueryData<PublicMenu>(KEY, {
      ...base,
      items: [{ ...base.items[0]!, comingSoon: true, effectiveComingSoon: true }, base.items[1]!],
    });

    const merged = mergeMenuChange(queryClient, KEY, change({ new: { id: 10, available: false } }));

    expect(merged).toBe(true);
    const cached = queryClient.getQueryData<PublicMenu>(KEY)!;
    expect(cached.items.map((i) => i.id)).toEqual([10, 11]);
    expect(cached.items[0]!.available).toBe(false);
    expect(cached.items[0]!.variants[0]!.available).toBe(false);
  });

  it("restores an item that was still cached when it came back", () => {
    // An item that is coming soon is kept in the payload even when unavailable,
    // so a "back in stock" event for it can be merged directly.
    const queryClient = clientWith(menu());
    const base = queryClient.getQueryData<PublicMenu>(KEY)!;
    queryClient.setQueryData<PublicMenu>(KEY, {
      ...base,
      items: [
        {
          ...base.items[0]!,
          available: false,
          globalAvailable: false,
          comingSoon: true,
          effectiveComingSoon: true,
        },
        base.items[1]!,
      ],
    });

    const merged = mergeMenuChange(queryClient, KEY, change({ new: { id: 10, available: true } }));

    expect(merged).toBe(true);
    const restored = queryClient.getQueryData<PublicMenu>(KEY)!.items.find((i) => i.id === 10)!;
    expect(restored.available).toBe(true);
    expect(restored.globalAvailable).toBe(true);
    expect(restored.variants[0]!.available).toBe(true);
  });

  it("asks for a refetch when an item comes back that the payload no longer holds", () => {
    // After a sold-out merge the item is dropped, mirroring what the gateway
    // returns. Re-adding it needs a refetch — the row event carries no price or
    // variants, so merging would fabricate them.
    const queryClient = clientWith(menu());
    mergeMenuChange(queryClient, KEY, change({ new: { id: 10, available: false } }));
    expect(mergeMenuChange(queryClient, KEY, change({ new: { id: 10, available: true } }))).toBe(
      false,
    );
  });

  it("applies a variant price change to price and effectivePrice", () => {
    const queryClient = clientWith(menu());
    const merged = mergeMenuChange(
      queryClient,
      KEY,
      change({
        table: "menu_item_variants",
        new: { id: 110, price: "195.50" },
      }),
    );

    expect(merged).toBe(true);
    const cached = queryClient.getQueryData<PublicMenu>(KEY)!;
    const mocha = cached.items.find((i) => i.id === 11)!;
    expect(mocha.variants[0]!.price).toBe(195.5);
    expect(mocha.variants[0]!.effectivePrice).toBe(195.5);
    // Untouched item is left exactly as it was.
    expect(cached.items[0]!.variants[0]!.price).toBe(150);
  });

  it("refuses to merge a structural change and reports that a refetch is needed", () => {
    const queryClient = clientWith(menu());
    // A new item cannot be assembled from a single row event.
    expect(
      mergeMenuChange(queryClient, KEY, change({ eventType: "INSERT", new: { id: 12 } })),
    ).toBe(false);
    // Nor can a re-parented item.
    expect(mergeMenuChange(queryClient, KEY, change({ new: { id: 10, categoryId: 2 } }))).toBe(
      false,
    );
    // Nor a modifier group change.
    expect(
      mergeMenuChange(queryClient, KEY, change({ table: "modifier_groups", new: { id: 5 } })),
    ).toBe(false);
    // Nor an outlet-scoped override, which the payload resolves server-side.
    expect(
      mergeMenuChange(
        queryClient,
        KEY,
        change({ table: "outlet_variant_availability", new: { variantId: 100 } }),
      ),
    ).toBe(false);
  });

  it("treats an empty payload (a reconnect re-sync) as needing a refetch", () => {
    const queryClient = clientWith(menu());
    expect(mergeMenuChange(queryClient, KEY, change({ new: {} }))).toBe(false);
  });

  it("reports a refetch when nothing is cached yet", () => {
    const queryClient = clientWith(undefined);
    expect(mergeMenuChange(queryClient, KEY, change({ new: { id: 10, available: false } }))).toBe(
      false,
    );
  });
});
