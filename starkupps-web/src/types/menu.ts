/** Menu domain types served by the StarKupps Admin public API. */

export type PublicVariant = {
  id: number;
  menuItemId: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  price: number;
  effectivePrice: number;
  sku: string | null;
  available: boolean;
  globalAvailable: boolean;
  isDefault: boolean;
  sortOrder: number;
};

export type PublicCategory = {
  id: number;
  name: string;
  sortOrder: number;
  description?: string | null;
  imageUrl?: string | null;
  comingSoon?: boolean;
};

export type PublicModifierOption = {
  id: number;
  name: string;
  priceDelta: number;
};

export type PublicModifierGroup = {
  id: number;
  name: string;
  type: string;
  required: boolean;
  options: PublicModifierOption[];
};

export type PublicMenuItem = {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryComingSoon?: boolean;
  name: string;
  description: string | null;
  imageUrl: string | null;
  veg: boolean;
  available: boolean;
  globalAvailable: boolean;
  comingSoon?: boolean;
  effectiveComingSoon?: boolean;
  modifierGroups: PublicModifierGroup[];
  variants: PublicVariant[];
  defaultVariantId: number | null;
};

export type PublicMenu = {
  categories: PublicCategory[];
  items: PublicMenuItem[];
};

/**
 * A menu item flattened for presentation.
 *
 * Modifier groups and variants are keyed by string and lose the vendor fields
 * the UI never reads, so the item sheet can render an item without importing
 * anything from the menu feature.
 */
export type DisplayMenuItem = {
  id: number | string;
  name: string;
  desc: string;
  price: number;
  veg: boolean;
  /** Uploaded image URL, or null when the owner has not set one. */
  imageUrl: string | null;
  comingSoon?: boolean;
  categoryComingSoon?: boolean;
  effectiveComingSoon?: boolean;
  defaultVariantId?: number | null;
  allergens?: string | undefined;
  groups: Array<{
    id: string;
    label: string;
    options: Array<{
      id: string;
      label: string;
      delta: number;
      optionId?: number;
      groupId?: number;
    }>;
  }>;
  variants: Array<{
    id: number;
    name: string;
    quantity: number | null;
    unit: string | null;
    price: number;
    effectivePrice: number;
    available: boolean;
    isDefault: boolean;
  }>;
};

/** A category enriched with its live item count. */
export type DisplayCategory = {
  id: string;
  label: string;
  /** Uploaded image URL, or null when the owner has not set one. */
  imageUrl: string | null;
  dbId: number;
  comingSoon: boolean;
  description: string | null;
  count: number;
};
