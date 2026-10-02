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
