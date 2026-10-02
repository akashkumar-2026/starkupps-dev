/**
 * Turns a rejected checkout into customer-facing copy.
 *
 * ## Why this exists
 *
 * The cart previously branched on regexes over the server's English message:
 *
 * ```ts
 * if (/COMING SOON/i.test(msg))            → "Coming soon"
 * else if (/not available/i.test(msg))     → "Some items are unavailable at this outlet."
 * else if (/coupon/i.test(msg))            → "Coupon error"
 * else if (/minimum order/i.test(msg))     → "Minimum order not met"
 * ```
 *
 * That made the UI blame the wrong thing. The server rejects a delivery order
 * with "Delivery not available at this outlet." — which also matches
 * `/not available/i`, so customers were told **"Some items are unavailable at
 * this outlet."** for what is really a delivery-configuration problem. The
 * genuine item-unavailable message, `"<name> is not available at this outlet."`,
 * collided with the same branch.
 *
 * Classification now runs on `error.data.domainCode`, a stable value from the
 * server, and the regexes survive only as a fallback for a gateway that predates
 * that field.
 */
import { OrderDomainCode } from "@/config/order-error-codes";
import { domainCodeOf } from "@/utils/trpc-error";
import { errorMessage } from "@/utils/errors";

export type OrderFailureKind =
  | "coming_soon"
  | "item_unavailable"
  | "variant_unavailable"
  | "invalid_selection"
  | "order_type_unavailable"
  | "outlet_unavailable"
  | "delivery_address_required"
  | "coupon_invalid"
  | "minimum_order_not_met"
  | "unknown";

export type OrderFailure = {
  kind: OrderFailureKind;
  /** Toast headline. */
  title: string;
  /** Optional follow-up line; the server's message is appended separately. */
  hint?: string;
  /** True when the cart should be flagged for review rather than just reported. */
  affectsCart: boolean;
};

/**
 * Message-level fallback for a server that sent no domain code.
 *
 * Ordered most-specific first, and the order-type messages are checked *before*
 * any generic `/not available/i` pattern — that ordering is the whole point:
 * the old code checked `/not available/i` before it ever looked at the wording,
 * so "Delivery not available at this outlet." was reported as "Some items are
 * unavailable at this outlet."
 *
 * Two orderings are deliberate and easy to break:
 *   * `minimum order` before `coupon` — the server says "Minimum order ₹X
 *     required for this coupon.", which contains both words, and the advice is
 *     to add items, not to change the coupon.
 *   * No bare "not found" pattern — it would swallow "Coupon not found." and
 *     "Menu item 5 not found." into one bucket. Each is scoped to its subject.
 */
function classifyByMessage(message: string): OrderFailure {
  const has = (pattern: RegExp) => pattern.test(message);

  if (has(/coming soon/i)) {
    return {
      kind: "coming_soon",
      title: "Coming soon — cannot be ordered yet.",
      affectsCart: true,
    };
  }
  if (has(/^(delivery|takeaway|dine-?in) not available at this outlet/i)) {
    return {
      kind: "order_type_unavailable",
      title: "That order type isn't offered here.",
      hint: "Try another option, or pick a different outlet.",
      affectsCart: false,
    };
  }
  if (
    has(/not accepting orders/i) ||
    has(/outlet is not currently active/i) ||
    has(/outlet not found/i)
  ) {
    return {
      kind: "outlet_unavailable",
      title: "This outlet isn't accepting orders right now.",
      affectsCart: false,
    };
  }
  if (has(/delivery address is required/i)) {
    return {
      kind: "delivery_address_required",
      title: "Add a delivery address.",
      affectsCart: false,
    };
  }
  if (has(/minimum order/i)) {
    return {
      kind: "minimum_order_not_met",
      title: "Minimum order not met",
      affectsCart: false,
    };
  }
  if (has(/coupon/i)) {
    return { kind: "coupon_invalid", title: "Coupon error", affectsCart: false };
  }
  if (has(/is not available at this outlet/i)) {
    return {
      kind: "item_unavailable",
      title: "Some items are unavailable at this outlet.",
      hint: "Remove them from your cart to continue.",
      affectsCart: true,
    };
  }
  if (has(/— .* is not available/i)) {
    return {
      kind: "variant_unavailable",
      title: "An item choice is no longer available.",
      hint: "Please review your cart.",
      affectsCart: true,
    };
  }
  if (
    has(/\bmenu item \d+ not found/i) ||
    has(/\bmodifier option \d+ not found/i) ||
    has(/^variant \d+ not found/i) ||
    has(/variant does not belong to/i) ||
    has(/please select a size for/i) ||
    has(/invalid modifier/i)
  ) {
    return {
      kind: "invalid_selection",
      title: "An item choice is no longer available.",
      hint: "Please review your cart.",
      affectsCart: true,
    };
  }
  return { kind: "unknown", title: "Order failed", affectsCart: false };
}

function classifyByCode(code: OrderDomainCode): OrderFailure {
  switch (code) {
    case OrderDomainCode.ITEM_COMING_SOON:
      return {
        kind: "coming_soon",
        title: "Coming soon — cannot be ordered yet.",
        affectsCart: true,
      };
    case OrderDomainCode.ITEM_UNAVAILABLE:
      return {
        kind: "item_unavailable",
        title: "Some items are unavailable at this outlet.",
        hint: "Remove them from your cart to continue.",
        affectsCart: true,
      };
    case OrderDomainCode.VARIANT_UNAVAILABLE:
    case OrderDomainCode.INVALID_SELECTION:
      return {
        kind: "variant_unavailable",
        title: "An item choice is no longer available.",
        hint: "Please review your cart.",
        affectsCart: true,
      };
    case OrderDomainCode.ORDER_TYPE_UNAVAILABLE:
      return {
        kind: "order_type_unavailable",
        title: "That order type isn't offered here.",
        hint: "Try another option, or pick a different outlet.",
        affectsCart: false,
      };
    case OrderDomainCode.OUTLET_UNAVAILABLE:
    case OrderDomainCode.OUTLET_NOT_FOUND:
      return {
        kind: "outlet_unavailable",
        title: "This outlet isn't accepting orders right now.",
        affectsCart: false,
      };
    case OrderDomainCode.DELIVERY_ADDRESS_REQUIRED:
      return {
        kind: "delivery_address_required",
        title: "Add a delivery address.",
        affectsCart: false,
      };
    case OrderDomainCode.COUPON_INVALID:
      return { kind: "coupon_invalid", title: "Coupon error", affectsCart: false };
    case OrderDomainCode.MINIMUM_ORDER_NOT_MET:
      return {
        kind: "minimum_order_not_met",
        title: "Minimum order not met",
        affectsCart: false,
      };
    default:
      return { kind: "unknown", title: "Order failed", affectsCart: false };
  }
}

/**
 * Classify a thrown checkout error.
 *
 * Prefers the server's `domainCode`; falls back to the message only when the
 * code is absent, so behaviour is unchanged against an older gateway but stops
 * being wrong as soon as the code is present.
 */
export function classifyOrderError(error: unknown): OrderFailure {
  const code = domainCodeOf(error);
  if (code) return classifyByCode(code);
  return classifyByMessage(errorMessage(error) ?? "");
}

/** Line 2 of the toast: the actionable part of the server's message. */
export function orderErrorDetail(error: unknown): string | undefined {
  const failure = classifyOrderError(error);
  if (failure.kind === "unknown") return undefined;
  const server = errorMessage(error);
  return server && server !== failure.title ? server : failure.hint;
}
