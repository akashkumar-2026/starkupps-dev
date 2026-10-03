/**
 * `outlets.services` — the per-outlet capability flags (delivery / takeaway /
 * dine-in / POS / online ordering) and optional charge overrides.
 *
 * ## Why this module exists
 *
 * `outlets.services` is a Postgres `json` column, and **`postgres`/PostgREST
 * hand `json` back to the client unparsed** (unlike `jsonb`). It only ever
 * reached the app as an object because one write path double-encoded it:
 *
 * ```ts
 * // outlets.create — wrong
 * JSON.stringify(payload.services)   // bound to a `json` column
 * ```
 *
 * `postgres.js` already JSON-encodes values destined for a `json` column, so
 * the explicit `JSON.stringify` wrapped the object *inside* a JSON string.
 * Stored shape became `jsonb_typeof = 'string'`, and every reader doing
 * `services.delivery` silently got `undefined`.
 *
 * The blast radius was severe because the flags gate checkout:
 * `if (services && !services.delivery)` is true when `services` is a
 * non-empty string, so **every order type was rejected with "Delivery not
 * available at this outlet."** Per-outlet charge overrides were dead too,
 * and the Admin Services panel rendered `Object.entries()` of a string.
 *
 * ## The contract
 *
 * Read every `services` value through `parseOutletServices` and write it as a
 * plain object. The parser accepts all three shapes — legacy double-encoded
 * string, object, or `null` — so a row written before the repair still reads
 * correctly and no reader needs to know which era it came from.
 */

/** Canonical flag set. Every key is required so callers never branch on
 *  `undefined`; unknown keys in the source row are preserved by spread. */
export type OutletServices = {
  dineIn: boolean;
  takeaway: boolean;
  delivery: boolean;
  pos: boolean;
  onlineOrdering: boolean;
  /** Optional per-outlet charge overrides consumed by `resolveChargeConfig`. */
  packingCharge?: number;
  deliveryFee?: number;
  freeDeliveryAbove?: number;
  [key: string]: unknown;
};

/**
 * Conservative defaults.
 *
 * Every flag is `true` rather than `false` so a malformed or missing row
 * degrades to "show the customer everything" instead of silently hiding order
 * types and breaking checkout again. An operator has to switch a capability
 * off deliberately; they should never have to switch it back on.
 */
export const DEFAULT_OUTLET_SERVICES: OutletServices = {
  dineIn: true,
  takeaway: true,
  delivery: true,
  pos: true,
  onlineOrdering: true,
};

/** The order-type keys a customer can pick, in the order the UI shows them. */
export const OUTLET_ORDER_TYPE_KEYS = [
  "dineIn",
  "takeaway",
  "delivery",
] as const;

export type OutletOrderTypeKey = (typeof OUTLET_ORDER_TYPE_KEYS)[number];

/**
 * The wire vocabulary for order types (`orders.type` in the database), mapped to
 * the `services` flag that governs each one.
 *
 * This is the single mapping between the two vocabularies. It lives here rather
 * than in a router so that the public order guard, the charge quote, the Admin
 * fulfillment panel and the storefront selector cannot drift apart — a drifted
 * mapping is exactly how a disabled method stays orderable.
 */
export const API_ORDER_TYPES = ["dine_in", "takeaway", "delivery"] as const;

export type ApiOrderType = (typeof API_ORDER_TYPES)[number];

export const ORDER_TYPE_SERVICE_KEY: Record<ApiOrderType, OutletOrderTypeKey> =
  {
    dine_in: "dineIn",
    takeaway: "takeaway",
    delivery: "delivery",
  };

export const ORDER_TYPE_LABEL: Record<ApiOrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
};

/** The flags an operator may toggle, and the copy shown beside each switch. */
export const FULFILLMENT_SERVICE_COPY: Record<
  OutletOrderTypeKey,
  { title: string; description: string }
> = {
  dineIn: {
    title: "Dine-in",
    description:
      "Customers can order for a table in the café. No packaging or delivery charge is applied.",
  },
  takeaway: {
    title: "Takeaway",
    description:
      "Customers can order to collect from the counter. A packaging charge may apply.",
  },
  delivery: {
    title: "Delivery",
    description:
      "Customers can order to an address. Requires a delivery address and adds a delivery fee.",
  },
};

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  // Postgres `json` can legitimately hold `"true"`/`"false"` as text.
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Coerces one raw column value into a well-formed `OutletServices`.
 *
 * Accepts, in order of preference: an object, a JSON-encoded string (legacy
 * double-encoded rows), or `null`. Never throws — a row that cannot be parsed
 * falls back to `DEFAULT_OUTLET_SERVICES` rather than taking checkout down.
 */
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

  const services: OutletServices = {
    ...DEFAULT_OUTLET_SERVICES,
    ...source,
  };

  for (const key of OUTLET_ORDER_TYPE_KEYS) {
    services[key] = toBoolean(source[key], DEFAULT_OUTLET_SERVICES[key]);
  }
  services.pos = toBoolean(source.pos, DEFAULT_OUTLET_SERVICES.pos);
  services.onlineOrdering = toBoolean(
    source.onlineOrdering,
    DEFAULT_OUTLET_SERVICES.onlineOrdering
  );

  // Charge overrides are optional; drop anything non-numeric rather than let
  // `NaN` reach the pricing path.
  for (const key of ["packingCharge", "deliveryFee", "freeDeliveryAbove"]) {
    const n = toFiniteNumber(source[key]);
    if (n === undefined) delete services[key];
    else services[key] = n;
  }

  return services;
}

/**
 * True when the outlet accepts orders of this type.
 *
 * Takes `unknown` rather than `OutletServices` because the argument is a raw
 * column value straight out of the database — a partial object, a legacy
 * JSON string, or `null`. Typing it as the normalised shape would push an
 * unsound cast onto every caller.
 */
export function outletSupportsOrderType(
  services: unknown,
  key: OutletOrderTypeKey
): boolean {
  return parseOutletServices(services)[key] !== false;
}

/**
 * Order types the outlet actually offers, in canonical display order.
 *
 * Can legitimately be empty when an operator has switched every capability off.
 * Callers rendering tabs must handle that (fall back to the full list, or show
 * "orders unavailable") rather than assume a non-empty result — an empty list
 * still describes reality, and quietly substituting one would offer an order
 * type the server will reject.
 */
export function availableOutletOrderTypes(
  services: unknown
): OutletOrderTypeKey[] {
  const parsed = parseOutletServices(services);
  return OUTLET_ORDER_TYPE_KEYS.filter(key => parsed[key] !== false);
}

/**
 * True when at least one customer-facing order type is switchable on.
 *
 * Distinct from `availableOutletOrderTypes(...).length > 0`: that also requires
 * online ordering to be on, because a method the outlet accepts is still
 * unreachable while `onlineOrdering` is off. Used for the "no ordering
 * available" branch in checkout and the matching safeguard on the server.
 */
export function hasReachableOrderType(services: unknown): boolean {
  return (
    parseOutletServices(services).onlineOrdering !== false &&
    availableOutletOrderTypes(services).length > 0
  );
}

/**
 * Merges a partial `services` patch into the row's existing value.
 *
 * Two things this protects, both of which bit before:
 *
 * 1. **Unknown keys survive.** `outletsRouter.update` validated `services` with
 *    `z.object({…})`, which strips anything not declared. That silently deleted
 *    the per-outlet charge overrides (`packingCharge`, `deliveryFee`,
 *    `freeDeliveryAbove`) on *every* unrelated outlet edit — an admin changing a
 *    phone number would quietly change what customers are charged.
 * 2. **A partial patch is a patch.** The fulfillment panel sends one flag at a
 *    time; spreading the existing value first means an absent key means
 *    "unchanged" rather than "reset to the default".
 *
 * `patch` is merged *last* so an explicit `false` is honoured rather than
 * dropped by the defaults spread.
 */
export function mergeOutletServices(
  existing: unknown,
  patch: Partial<
    Record<OutletOrderTypeKey | "pos" | "onlineOrdering", boolean>
  > & {
    packingCharge?: number | null;
    deliveryFee?: number | null;
    freeDeliveryAbove?: number | null;
  }
): OutletServices {
  const merged = parseOutletServices(existing) as Record<string, unknown>;

  for (const key of [
    ...OUTLET_ORDER_TYPE_KEYS,
    "pos",
    "onlineOrdering",
  ] as const) {
    const value = patch[key];
    if (typeof value === "boolean") merged[key] = value;
  }

  // `null` clears an override back to the store-level setting; `undefined`
  // leaves it alone. A patch that omits the key must not delete it.
  for (const key of [
    "packingCharge",
    "deliveryFee",
    "freeDeliveryAbove",
  ] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === null || value === undefined) delete merged[key];
    else if (Number.isFinite(value)) merged[key] = value;
  }

  return parseOutletServices(merged);
}
