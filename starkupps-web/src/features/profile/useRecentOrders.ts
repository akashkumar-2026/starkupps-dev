import { useEffect, useState } from "react";

import { getRecentOrders, ORDERS_CHANGED_EVENT } from "./storage";
import type { RecentOrder } from "@/types/profile";

/**
 * Recent orders for this device.
 *
 * Re-reads on the app's own change event and on cross-tab `storage` events, so
 * placing an order in the cart updates the account page immediately.
 */
export function useRecentOrders(): RecentOrder[] {
  const [orders, setOrders] = useState<RecentOrder[]>(getRecentOrders);

  useEffect(() => {
    const refresh = () => setOrders(getRecentOrders());
    window.addEventListener(ORDERS_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(ORDERS_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return orders;
}
