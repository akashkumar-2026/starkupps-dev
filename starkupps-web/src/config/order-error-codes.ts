/**
 * Vocabulary of machine-readable reasons a checkout can be rejected.
 *
 * Mirrors `shared/orderErrorCodes.ts` in starkupps-admin. Both sides must agree
 * on these string values — they cross the wire as `error.data.domainCode` — so
 * treat a rename as a breaking API change.
 *
 * ## Why a code instead of matching the message
 *
 * The cart used to branch on regexes over the server's English text. That is
 * what turned "Delivery not available at this outlet." into the customer-facing
 * "Some items are unavailable at this outlet.": the first string also matches
 * `/not available/i`, so an order-type rejection was reported as a menu
 * problem. Wording edits and copy changes silently broke classification, and
 * there was no way to test the mapping.
 */
export const OrderDomainCode = {
  OUTLET_NOT_FOUND: "OUTLET_NOT_FOUND",
  OUTLET_UNAVAILABLE: "OUTLET_UNAVAILABLE",
  /**
   * The outlet has switched off website ordering as a whole
   * (`outlets.services.onlineOrdering`).
   *
   * Distinct from `OUTLET_UNAVAILABLE`: the outlet is open for walk-ins and POS,
   * it has just stopped taking web orders, so switching order type will not help.
   */
  OUTLET_NOT_ACCEPTING_ORDERS: "OUTLET_NOT_ACCEPTING_ORDERS",
  /**
   * Dine-in, takeaway and delivery are *all* switched off at this outlet.
   *
   * Distinct from `ORDER_TYPE_UNAVAILABLE`: no individual method is
   * misconfigured, and telling the customer their chosen method is unavailable
   * would invite them to retry a different one that is equally unavailable.
   */
  NO_ORDER_TYPES_AVAILABLE: "NO_ORDER_TYPES_AVAILABLE",
  ORDER_TYPE_UNAVAILABLE: "ORDER_TYPE_UNAVAILABLE",
  DELIVERY_ADDRESS_REQUIRED: "DELIVERY_ADDRESS_REQUIRED",
  ITEM_COMING_SOON: "ITEM_COMING_SOON",
  ITEM_UNAVAILABLE: "ITEM_UNAVAILABLE",
  VARIANT_UNAVAILABLE: "VARIANT_UNAVAILABLE",
  INVALID_SELECTION: "INVALID_SELECTION",
  COUPON_INVALID: "COUPON_INVALID",
  MINIMUM_ORDER_NOT_MET: "MINIMUM_ORDER_NOT_MET",
} as const;

export type OrderDomainCode = (typeof OrderDomainCode)[keyof typeof OrderDomainCode];
