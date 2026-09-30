/**
 * Device- and user-scoped persistence for profile data.
 *
 * Addresses are scoped per user; recent orders are scoped per device so
 * checkout history survives even for orders placed before signing in. Storage
 * failures are non-fatal — the UI simply forgets.
 */
import { createId, readJson, writeJson } from "@/utils/storage";
import type { RecentOrder, SavedAddress } from "@/types/profile";

const ADDRESS_PREFIX = "starkupps:addresses:";
const ORDERS_KEY = "starkupps:recent-orders";
const MAX_ORDERS = 20;

/** Fired after a new order is recorded so open subscribers can refresh. */
export const ORDERS_CHANGED_EVENT = "starkupps:orders-changed";

// ── Recent orders (device-level) ────────────────────────────────────────────

export function getRecentOrders(): RecentOrder[] {
  return readJson<RecentOrder[]>(ORDERS_KEY, []);
}

/** Insert or replace an order, newest first, capped at `MAX_ORDERS`. */
export function recordOrder(order: Omit<RecentOrder, "placedAt">): void {
  const previous = getRecentOrders();
  const next = [
    { ...order, placedAt: Date.now() },
    ...previous.filter((o) => o.id !== order.id),
  ].slice(0, MAX_ORDERS);

  writeJson(ORDERS_KEY, next);
  window.dispatchEvent(new CustomEvent(ORDERS_CHANGED_EVENT));
}

// ── Addresses (per-user) ────────────────────────────────────────────────────

export function addressesKeyFor(userId: string | undefined): string | null {
  return userId ? `${ADDRESS_PREFIX}${userId}` : null;
}

export function getSavedAddresses(userId: string | undefined): SavedAddress[] {
  const key = addressesKeyFor(userId);
  return key ? readJson<SavedAddress[]>(key, []) : [];
}

export function persistAddresses(userId: string | undefined, addresses: SavedAddress[]): void {
  const key = addressesKeyFor(userId);
  if (key) writeJson(key, addresses);
}

export function createSavedAddress(
  input: Omit<SavedAddress, "id" | "createdAt" | "isDefault"> & { id?: string | undefined },
): SavedAddress {
  return { ...input, id: input.id ?? createId(), createdAt: Date.now(), isDefault: false };
}
