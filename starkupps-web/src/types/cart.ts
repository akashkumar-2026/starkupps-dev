import type { SelectedModifier } from "./orders";

/** Cart state types. Owned by `state/cart-provider`. */

/** The size/variant a product was added as — every item is sold via a variant. */
export type SelectedVariant = {
  id: number;
  name: string;
  quantity: number | null;
  unit: string | null;
  price: number;
  sku?: string | null;
};

export type CartLine = {
  /** Deterministic identity: item + variant + chosen option labels. */
  key: string;
  menuItemId: number;
  variantId: number;
  variantName: string;
  variantQuantity: number | null;
  variantUnit: string | null;
  name: string;
  /** Uploaded image URL, or null when the owner has not set one. */
  image: string | null;
  unitPrice: number;
  qty: number;
  optionLabels: string[];
  modifierPayload: SelectedModifier[];
};

/** Minimal shape the cart needs to render a line. */
export type CartProduct = {
  id: number;
  name: string;
  /** Uploaded image URL, or null when the owner has not set one. */
  image: string | null;
};
