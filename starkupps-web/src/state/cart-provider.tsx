/**
 * Global cart state.
 *
 * The cart holds item *variants*, never base prices: every product is sold
 * through a size/variant row, and the gateway recomputes totals authoritatively
 * at order creation. Amounts here are paise.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { CartLine, CartProduct, SelectedVariant } from "@/types/cart";
import type { OrderType, SelectedModifier } from "@/types/orders";

export type { CartLine, SelectedVariant };

export type CartContextValue = {
  lines: CartLine[];
  count: number;
  /** Items total only — packing, delivery and tax are quoted live at checkout. */
  subtotal: number;
  orderType: OrderType;
  setOrderType: (orderType: OrderType) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  addLine: (args: {
    product: CartProduct;
    unitPrice: number;
    optionLabels: string[];
    quantity: number;
    modifiers: SelectedModifier[];
    variant: SelectedVariant;
  }) => void;
  setQty: (key: string, quantity: number) => void;
  clear: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

/** Two lines merge only when they share item, variant and chosen options. */
function lineKeyFor(itemId: number, variantId: number, optionLabels: string[]): string {
  return `${itemId}|variant:${variantId}|${optionLabels.join(",")}`;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("takeaway");
  const [open, setOpen] = useState(false);

  const addLine = useCallback<CartContextValue["addLine"]>(
    ({ product, unitPrice, optionLabels, quantity, modifiers, variant }) => {
      setLines((previous) => {
        const key = lineKeyFor(product.id, variant.id, optionLabels);
        const existing = previous.find((line) => line.key === key);

        if (existing) {
          return previous.map((line) =>
            line.key === key ? { ...line, qty: line.qty + quantity } : line,
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
          // The variant name always leads, so a line reads "Latte · 180 ml · Oat".
          optionLabels: [variant.name, ...optionLabels].filter(Boolean),
          modifierPayload: modifiers ?? [],
        };

        return [...previous, line];
      });
    },
    [],
  );

  const setQty = useCallback<CartContextValue["setQty"]>((key, quantity) => {
    setLines((previous) =>
      quantity <= 0
        ? previous.filter((line) => line.key !== key)
        : previous.map((line) => (line.key === key ? { ...line, qty: quantity } : line)),
    );
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
    const count = lines.reduce((sum, line) => sum + line.qty, 0);

    return {
      lines,
      count,
      subtotal,
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
