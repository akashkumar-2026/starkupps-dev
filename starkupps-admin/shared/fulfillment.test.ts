import { describe, expect, it } from "vitest";

import {
  evaluateFulfillment,
  type FulfillmentRejectionCode,
} from "./fulfillment";
import { API_ORDER_TYPES, ORDER_TYPE_SERVICE_KEY } from "./outletServices";

/**
 * The gate between a customer's request and a persisted order.
 *
 * Runs on both `public.settings.charges` (the pre-checkout quote) and
 * `public.orders.create` (the write), so a method disabled while the cart is
 * open fails where the storefront can react rather than after the whole form is
 * filled in.
 *
 * This is the enforcement that matters most for security: it must hold when a
 * customer bypasses the UI entirely, since a browser-side check is not a
 * control.
 */
const services = (over: Record<string, boolean> = {}) => ({
  dineIn: true,
  takeaway: true,
  delivery: true,
  pos: true,
  onlineOrdering: true,
  ...over,
});

const reject = (raw: unknown, type: (typeof API_ORDER_TYPES)[number]) => {
  const verdict = evaluateFulfillment(raw, type);
  if (verdict.allowed) throw new Error("expected a rejection");
  return verdict;
};

describe("evaluateFulfillment — happy path", () => {
  it("allows every method when all are enabled", () => {
    for (const type of API_ORDER_TYPES) {
      expect(evaluateFulfillment(services(), type)).toEqual({ allowed: true });
    }
  });

  it("allows every method when the configuration cannot be read", () => {
    // Fail-open: hiding every order type because one column failed to parse would
    // take checkout down for everyone at that outlet.
    for (const raw of [undefined, null, "", "not json", 42, []]) {
      expect(evaluateFulfillment(raw, "delivery")).toEqual({ allowed: true });
    }
  });

  it("reads a legacy double-encoded row rather than a string's characters", () => {
    // The original outage: `services` arrived as a JSON string, so
    // `services.delivery` was `undefined` and every order type was rejected.
    const legacy = JSON.stringify({ ...services(), delivery: false });
    expect(reject(legacy, "delivery").code).toBe("ORDER_TYPE_UNAVAILABLE");
    expect(evaluateFulfillment(legacy, "takeaway")).toEqual({ allowed: true });
  });
});

describe("evaluateFulfillment — each method independently", () => {
  it("rejects only the disabled method", () => {
    // Every combination the admin panel can produce. The enabled methods must
    // stay orderable — this is the independence the UI's three switches promise.
    const cases: Array<[Record<string, boolean>, FulfillmentRejectionCode]> = [
      // [dineIn, takeaway, delivery]
      [{ dineIn: false }, "ORDER_TYPE_UNAVAILABLE"],
      [{ takeaway: false }, "ORDER_TYPE_UNAVAILABLE"],
      [{ delivery: false }, "ORDER_TYPE_UNAVAILABLE"],
      [{ dineIn: false, takeaway: false }, "ORDER_TYPE_UNAVAILABLE"],
      [{ dineIn: false, delivery: false }, "ORDER_TYPE_UNAVAILABLE"],
      [{ takeaway: false, delivery: false }, "ORDER_TYPE_UNAVAILABLE"],
      [
        { dineIn: false, takeaway: false, delivery: false },
        "NO_ORDER_TYPES_AVAILABLE",
      ],
    ];
    for (const [over] of cases) {
      const raw = services(over);
      // Map through the shared mapping: the API vocabulary is `dine_in` while the
      // column keys are `dineIn`, so comparing them directly would silently treat
      // every method as disabled.
      const enabled = API_ORDER_TYPES.filter(
        t => raw[ORDER_TYPE_SERVICE_KEY[t]] !== false
      );
      for (const type of API_ORDER_TYPES) {
        const verdict = evaluateFulfillment(raw, type);
        if (enabled.includes(type)) {
          expect(verdict).toEqual({ allowed: true });
        } else {
          expect(verdict.allowed).toBe(false);
        }
      }
    }
  });

  it("names the specific method in the message", () => {
    expect(reject(services({ delivery: false }), "delivery").message).toMatch(
      /^Delivery is not available/
    );
    expect(reject(services({ dineIn: false }), "dine_in").message).toMatch(
      /^Dine-in is not available/
    );
    expect(reject(services({ takeaway: false }), "takeaway").message).toMatch(
      /^Takeaway is not available/
    );
  });
});

describe("evaluateFulfillment — all methods disabled", () => {
  it("reports a configuration problem, not a per-method one", () => {
    // Distinct code so the storefront says "ordering unavailable, choose another
    // outlet" instead of naming a method that is in fact perfectly configured.
    const off = services({ dineIn: false, takeaway: false, delivery: false });
    for (const type of API_ORDER_TYPES) {
      expect(reject(off, type).code).toBe("NO_ORDER_TYPES_AVAILABLE");
    }
    expect(reject(off, "delivery").message).toMatch(/choose another outlet/i);
    expect(reject(off, "delivery").message).not.toMatch(/Delivery is not/);
  });
});

describe("evaluateFulfillment — website-ordering kill switch", () => {
  it("rejects every method when onlineOrdering is off", () => {
    const paused = services({ onlineOrdering: false });
    for (const type of API_ORDER_TYPES) {
      const verdict = reject(paused, type);
      expect(verdict.code).toBe("OUTLET_NOT_ACCEPTING_ORDERS");
    }
  });

  it("takes precedence over a specific disabled method", () => {
    // Otherwise the customer is told "Delivery is not available" at an outlet
    // that has taken the whole website down, and retries a method that is equally
    // unavailable.
    expect(
      reject(services({ onlineOrdering: false, delivery: false }), "delivery")
        .code
    ).toBe("OUTLET_NOT_ACCEPTING_ORDERS");
  });

  it("takes precedence over all-methods-disabled", () => {
    expect(
      reject(
        services({
          onlineOrdering: false,
          dineIn: false,
          takeaway: false,
          delivery: false,
        }),
        "takeaway"
      ).code
    ).toBe("OUTLET_NOT_ACCEPTING_ORDERS");
  });

  it("points at ordering in person rather than another outlet", () => {
    // The outlet is still open for walk-ins and POS, so "choose another outlet"
    // would be wrong here.
    expect(
      reject(services({ onlineOrdering: false }), "delivery").message
    ).not.toMatch(/choose another outlet/i);
  });
});
