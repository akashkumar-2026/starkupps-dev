/**
 * Stable, machine-readable reasons for a rejected order.
 *
 * ## Why
 *
 * The storefront used to classify checkout failures by regex-matching the
 * server's English prose. That coupling is not safe: `"Delivery not available
 * at this outlet."` also matches `/not available/i`, so a rejected *order type*
 * was reported to customers as "Some items are unavailable at this outlet." —
 * blaming the menu for a delivery-configuration problem. When the wording
 * changed, the UI silently misclassified again.
 *
 * A domain code is part of the API contract, so copy can change freely without
 * breaking classification, and both sides can be tested without string matching.
 *
 * @see shared/orderErrorCodes.ts for the mirrored enum used by starkupps-web.
 */
export const OrderDomainCode = {
  /** The selected outlet does not exist. */
  OUTLET_NOT_FOUND: "OUTLET_NOT_FOUND",
  /** Outlet exists but is not accepting orders (inactive/maintenance). */
  OUTLET_UNAVAILABLE: "OUTLET_UNAVAILABLE",
  /**
   * The outlet has turned off web/online ordering as a whole
   * (`outlets.services.onlineOrdering`).
   *
   * Distinct from `OUTLET_UNAVAILABLE`: the outlet is open for walk-ins and POS,
   * it has simply stopped taking website orders. Retrying with a different
   * order type does not help, so the storefront must not suggest it.
   */
  OUTLET_NOT_ACCEPTING_ORDERS: "OUTLET_NOT_ACCEPTING_ORDERS",
  /**
   * Every customer-facing order type is switched off
   * (`dineIn`, `takeaway` and `delivery` all false).
   *
   * Also distinct from `ORDER_TYPE_UNAVAILABLE`: no individual method is
   * misconfigured — the outlet has deliberately closed online ordering by
   * leaving nothing enabled, and the customer needs to be told ordering is
   * unavailable here rather than that their chosen method happens to be off.
   */
  NO_ORDER_TYPES_AVAILABLE: "NO_ORDER_TYPES_AVAILABLE",
  /** Outlet does not offer the requested order type. */
  ORDER_TYPE_UNAVAILABLE: "ORDER_TYPE_UNAVAILABLE",
  /** Delivery was requested without an address. */
  DELIVERY_ADDRESS_REQUIRED: "DELIVERY_ADDRESS_REQUIRED",
  /** Item is flagged Coming Soon (or its category is). */
  ITEM_COMING_SOON: "ITEM_COMING_SOON",
  /** Item is not sellable at this outlet. */
  ITEM_UNAVAILABLE: "ITEM_UNAVAILABLE",
  /** The chosen variant is not sellable. */
  VARIANT_UNAVAILABLE: "VARIANT_UNAVAILABLE",
  /** Something about the item selection is malformed. */
  INVALID_SELECTION: "INVALID_SELECTION",
  /** Coupon rejected. */
  COUPON_INVALID: "COUPON_INVALID",
  /** Order below the outlet or coupon minimum. */
  MINIMUM_ORDER_NOT_MET: "MINIMUM_ORDER_NOT_MET",
} as const;

export type OrderDomainCode =
  (typeof OrderDomainCode)[keyof typeof OrderDomainCode];
