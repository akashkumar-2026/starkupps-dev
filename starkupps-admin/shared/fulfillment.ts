/**
 * The decision behind server-side fulfilment enforcement.
 *
 * ## Why the pure part is separated from the throw
 *
 * `assertOrderTypeOrderable` in `server/routers/publicRouter.ts` is the only
 * gate between a customer's request and a persisted order, and it has to run on
 * *two* routes: `settings.charges` (the pre-checkout quote) and `orders.create`
 * (the write). Splitting the "which problem is this?" decision out from the
 * `TRPCError` means it can be unit-tested directly.
 *
 * That matters more than usual here: importing `server/routers` pulls in the
 * `argon2` native binding, which segfaults on this Node build and takes the whole
 * vitest worker with it (the reason `server/__tests__/outlets.delete.test.ts`
 * deliberately does not import the routers). Pure logic in `shared/` is testable;
 * anything reachable only through a router import is not.
 *
 * ## Fail-open on unreadable configuration
 *
 * `parseOutletServices` returns all-true for a row it cannot read, so a malformed
 * value yields `allow`. Hiding every order type because one column failed to
 * parse would take checkout down for everyone at that outlet; offering too much
 * and letting the write reject it is the recoverable direction. An operator has
 * to disable a method *deliberately* to get a rejection here.
 */
import {
  hasReachableOrderType,
  ORDER_TYPE_LABEL,
  ORDER_TYPE_SERVICE_KEY,
  parseOutletServices,
  type ApiOrderType,
} from "./outletServices";

/** Mirrors `shared/orderErrorCodes.ts`; kept as a string union to avoid a cycle. */
export type FulfillmentRejectionCode =
  | "OUTLET_NOT_ACCEPTING_ORDERS"
  | "ORDER_TYPE_UNAVAILABLE"
  | "NO_ORDER_TYPES_AVAILABLE";

export type FulfillmentVerdict =
  | { allowed: true }
  | { allowed: false; code: FulfillmentRejectionCode; message: string };

/**
 * Decides whether `type` may be ordered at an outlet with these `services`.
 *
 * Check order is deliberate:
 *
 * 1. `onlineOrdering` — a whole-outlet kill switch, checked first so an outlet
 *    that has taken the website down reports that, rather than blaming an
 *    individual method and inviting a pointless retry.
 * 2. All-methods-off. This has to come *before* the per-method check: with
 *    everything disabled, "Dine-in is not available at this outlet" is literally
 *    true but useless, because the customer cannot pick a different method —
 *    there is no different method. Checking per-method first made this branch
 *    unreachable, and it would have reported one specific method as broken when
 *    the real situation was that nothing was enabled.
 * 3. The per-method flag.
 */
export function evaluateFulfillment(
  rawServices: unknown,
  type: ApiOrderType
): FulfillmentVerdict {
  const services = parseOutletServices(rawServices);

  if (services.onlineOrdering === false) {
    return {
      allowed: false,
      code: "OUTLET_NOT_ACCEPTING_ORDERS",
      message:
        "This outlet is not accepting online orders right now. Please try again later.",
    };
  }

  if (!hasReachableOrderType(services)) {
    return {
      allowed: false,
      code: "NO_ORDER_TYPES_AVAILABLE",
      message:
        "This outlet is not accepting orders online at the moment. Please choose another outlet.",
    };
  }

  if (services[ORDER_TYPE_SERVICE_KEY[type]] === false) {
    return {
      allowed: false,
      code: "ORDER_TYPE_UNAVAILABLE",
      message: `${ORDER_TYPE_LABEL[type]} is not available at this outlet.`,
    };
  }

  return { allowed: true };
}
