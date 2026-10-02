/**
 * Global cart state.
 *
 * The cart holds item *variants*, never base prices: every product is sold
 * through a size/variant row, and the gateway recomputes totals authoritatively
 * at order creation. Amounts here are paise.
 *
 * The line-merge rules live in the pure helpers below rather than inside the
 * component, so they can be unit tested without a DOM.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { CartLine, CartProduct, SelectedVariant } from "@/types/cart";
import type { OrderType, SelectedModifier } from "@/types/orders";

export type { CartLine, SelectedVariant };

export type AddLineArgs = {
  product: CartProduct;
  unitPrice: number;
  optionLabels: string[];
  quantity: number;
  modifiers: SelectedModifier[];
  variant: SelectedVariant;
};

export type CartContextValue = {
  lines: CartLine[];
  count: number;
  /** Items total only — packing, delivery and tax are quoted live at checkout. */
  subtotal: number;
  orderType: OrderType;
  setOrderType: (orderType: OrderType) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  addLine: (args: AddLineArgs) => void;
  setQty: (key: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/**
 * Identity of a cart line: item + variant + chosen options.
 *
 * Labels are length-prefixed before joining so the encoding cannot collide —
 * a plain `join(",")` maps both `["a,b"]` and `["a","b"]` to `"a,b"`, which
 * would merge two genuinely different selections into one line. The labels are
 * sorted so the same selection always produces the same key regardless of the
 * order the caller happened to collect them in; display order is untouched.
 */
export function lineKeyFor(itemId: number, variantId: number, optionLabels: string[]): string {
  const encoded = [...optionLabels]
    .filter(Boolean)
    .sort()
    .map((label) => `${label.length}:${label}`)
    .join("|");
  return `${itemId}|variant:${variantId}|${encoded}`;
}

/**
 * Adds to the matching line when the selection is identical, otherwise appends
 * a new line. Two lines merge only when they share item, variant and options —
 * the same product in a different size or with different modifiers is a
 * separate line, which is what the menu sheet promises the user.
 */
export function addLineTo(previous: CartLine[], args: AddLineArgs): CartLine[] {
  const { product, unitPrice, optionLabels, quantity, modifiers, variant } = args;
  const key = lineKeyFor(product.id, variant.id, optionLabels);
  const existing = previous.find((line) => line.key === key);

  if (existing) {
    return previous.map((line) =>
      line.key === key
        ? {
            ...line,
            // Refresh the seller's data on merge: the menu is realtime, so a
            // line added before a price edit must not keep quoting the old one.
            name: product.name,
            image: product.image,
            variantName: variant.name,
            variantQuantity: variant.quantity,
            variantUnit: variant.unit,
            unitPrice,
            optionLabels: optionLabels.filter(Boolean),
            modifierPayload: modifiers ?? [],
            qty: line.qty + quantity,
          }
        : line,
    );
  }

  const line: CartLine = {
    key,
    menuItemId: product.id,
    variantId: variant.id,
    variantName: variant.name,
    variantQuantity: variant.quantity,
    variantUnit: variant.unit,
    name: product.name,
    image: product.image,
    unitPrice,
    qty: quantity,
    // Modifier labels only — the variant already has its own field, so folding
    // it in here made every line render it twice.
    optionLabels: optionLabels.filter(Boolean),
    modifierPayload: modifiers ?? [],
  };

  return [...previous, line];
}

export function setQtyIn(previous: CartLine[], key: string, quantity: number): CartLine[] {
  return quantity <= 0
    ? previous.filter((line) => line.key !== key)
    : previous.map((line) => (line.key === key ? { ...line, qty: quantity } : line));
}

/** Items total only — packing, delivery and tax are quoted live at checkout. */
export function subtotalOf(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
}

export function countOf(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [open, setOpen] = useState(false);

  const addLine = useCallback<CartContextValue["addLine"]>(
    (args) => setLines((previous) => addLineTo(previous, args)),
    [],
  );

  const setQty = useCallback<CartContextValue["setQty"]>(
    (key, quantity) => setLines((previous) => setQtyIn(previous, key, quantity)),
    [],
  );

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => {
    return {
      lines,
      count: countOf(lines),
      subtotal: subtotalOf(lines),
      orderType,
      setOrderType,
      open,
      setOpen,
      addLine,
      setQty,
      clear,
    };
  }, [lines, orderType, open, addLine, setQty, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error("useCart must be used within a CartProvider");
  return context;
}
