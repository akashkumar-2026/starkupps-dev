import { Suspense, lazy } from "react";

import { useCart } from "@/state";

const CartSheet = lazy(() =>
  import("@/features/cart/components/CartSheet").then((m) => ({ default: m.CartSheet })),
);
const StickyCartBar = lazy(() =>
  import("@/features/cart/components/StickyCartBar").then((m) => ({
    default: m.StickyCartBar,
  })),
);

/**
 * Cart UI loads on demand, not with the page.
 *
 * CartSheet + StickyCartBar are ~70 KB of interaction nobody needs before
 * engaging with the cart, so they stay out of the initial bundle: the sheet
 * mounts when opened (or when lines already exist, e.g. back-navigation), the
 * bar mounts only while the cart is non-empty. First open pays one async
 * chunk load instead of every visitor paying it upfront.
 */
export function LazyCartUi({ bar = true }: { bar?: boolean }) {
  const { count, open } = useCart();
  return (
    <>
      {(open || count > 0) && (
        <Suspense fallback={null}>
          <CartSheet />
        </Suspense>
      )}
      {bar && count > 0 && (
        <Suspense fallback={null}>
          <StickyCartBar />
        </Suspense>
      )}
    </>
  );
}
