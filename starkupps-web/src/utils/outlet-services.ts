/**
 * `outlets.services` — the per-outlet capability flags.
 *
 * ## Why the storefront needs its own copy
 *
 * The gateway used to return this `json` column as a raw JSON **string**, so
 * `outlet.services?.delivery` was `undefined` even when delivery was enabled.
 * The storefront therefore hardcoded all three order types, offered delivery to
 * customers, and let the server reject the order with "Delivery not available at
 * at this outlet." — which the cart then mislabelled as "Some items are
 * unavailable at this outlet." The column is now `jsonb` and the gateway
 * normalises it, so a fresh payload is already an object.
 *
 * This normaliser stays because the value also reaches the browser from
 * `localStorage`, from a service-worker/replay cache, and from a gateway
 * deployment that has not been redeployed yet. Treating a malformed value as
 * "everything available" keeps an old payload from hiding order types; treating
 * it as "nothing available" would break checkout for everyone at once.
 *
 * Mirrors `shared/outletServices.ts` in starkupps-admin — the two apps deploy
 * independently, so they cannot import each other's code.
 */

export type OutletServices = {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  pos: boolean;
  onlineOrdering: boolean;
  [key: string]: unknown;
};

/**
 * Deliberately permissive: an absent or unreadable row must not take the menu
 * offline. An operator disables a capability explicitly; they should never have
 * to switch it back on.
 */
export const DEFAULT_OUTLET_SERVICES: OutletServices = {
  dineIn: true,
  takeaway: true,
  delivery: true,
  pos: true,
  onlineOrdering: true,
};

/** Maps the customer-facing order type to its capability key. */
export const ORDER_TYPE_SERVICE_KEY = {
  "dine-in": "dineIn",
  takeaway: "takeaway",
  delivery: "delivery",
} as const;

export type OrderTypeId = keyof typeof ORDER_TYPE_SERVICE_KEY;

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Accepts an object, a JSON-encoded string (legacy payloads), or `null`. */
export function parseOutletServices(raw: unknown): OutletServices {
  let source: Record<string, unknown> | null = null;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          source = parsed as Record<string, unknown>;
        }
      } catch {
        source = null;
      }
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    source = raw as Record<string, unknown>;
  }

  if (!source) return { ...DEFAULT_OUTLET_SERVICES };

  return {
    ...DEFAULT_OUTLET_SERVICES,
    ...source,
    dineIn: toBoolean(source["dineIn"], DEFAULT_OUTLET_SERVICES.dineIn),
    takeaway: toBoolean(source["takeaway"], DEFAULT_OUTLET_SERVICES.takeaway),
    delivery: toBoolean(source["delivery"], DEFAULT_OUTLET_SERVICES.delivery),
    pos: toBoolean(source["pos"], DEFAULT_OUTLET_SERVICES.pos),
    onlineOrdering: toBoolean(source["onlineOrdering"], DEFAULT_OUTLET_SERVICES.onlineOrdering),
  };
}

/** True when the selected outlet offers this order type. */
export function outletSupportsOrderType(services: unknown, orderType: OrderTypeId): boolean {
  return parseOutletServices(services)[ORDER_TYPE_SERVICE_KEY[orderType]] !== false;
}
