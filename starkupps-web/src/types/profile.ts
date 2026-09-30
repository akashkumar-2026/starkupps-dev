import type { OrderType } from "./orders";

/**
 * Locally persisted profile data.
 *
 * Addresses are scoped per user; recent orders are scoped per device so
 * checkout history survives even for orders placed before signing in.
 */

export type AddressLabel = "Home" | "Work" | "Other";

export type SavedAddress = {
  id: string;
  label: AddressLabel;
  name: string;
  phone: string;
  address: string;
  landmark?: string | undefined;
  isDefault: boolean;
  createdAt: number;
};

export type RecentOrder = {
  id: number;
  orderNumber: number;
  total: number;
  itemCount: number;
  type: OrderType;
  outletName?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  placedAt: number;
};
