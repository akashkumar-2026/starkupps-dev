import { describe, expect, it } from "vitest";

import {
  availableOrderTypes,
  DEFAULT_OUTLET_SERVICES,
  hasReachableOrderType,
  outletSupportsOrderType,
  parseOutletServices,
} from "./outlet-services";

/**
 * What the customer is allowed to pick.
 *
 * The storefront used to hardcode all three tabs regardless of configuration, so
 * the only enforcement was a rejection after the customer had filled in the whole
 * form. These helpers are what replaced that, and the distinction between "no
 * configuration loaded" and "operator switched everything off" is the part that
 * is easy to get wrong.
 */
describe("availableOrderTypes", () => {
  it("returns only the enabled methods, in display order", () => {
    expect(availableOrderTypes({ dineIn: false, takeaway: true, delivery: true })).toEqual([
      "takeaway",
      "delivery",
    ]);
    expect(availableOrderTypes({ dineIn: true, takeaway: false, delivery: false })).toEqual([
      "dine-in",
    ]);
    expect(availableOrderTypes({ dineIn: false, takeaway: false, delivery: true })).toEqual([
      "delivery",
    ]);
  });

  it("returns every method when all are enabled", () => {
    expect(availableOrderTypes(null)).toEqual(["dine-in", "takeaway", "delivery"]);
  });

  it("returns an empty array when the operator has disabled all three", () => {
    // The case the old code got wrong: it treated an empty result as "config
    // unknown" and fell back to showing all three, so a deliberately closed
    // outlet still looked fully orderable.
    expect(availableOrderTypes({ dineIn: false, takeaway: false, delivery: false })).toEqual([]);
  });
});

describe("hasReachableOrderType", () => {
  it("is false when online ordering is switched off wholesale", () => {
    // Every method is configured and none is reachable — a different state from
    // all-disabled, and the storefront words it differently (visit in person
    // rather than choose another outlet).
    expect(hasReachableOrderType({ onlineOrdering: false })).toBe(false);
  });

  it("is false when online ordering and every method are off", () => {
    expect(
      hasReachableOrderType({
        onlineOrdering: false,
        dineIn: false,
        takeaway: false,
        delivery: false,
      }),
    ).toBe(false);
  });

  it("is true when at least one method is on and online ordering is on", () => {
    expect(hasReachableOrderType({ dineIn: false, takeaway: false, delivery: true })).toBe(true);
  });

  it("is true for an unreadable row, so a bad payload cannot hide all ordering", () => {
    // Failing open here is deliberate. An empty `enabledTypes` list makes the
    // storefront render "ordering unavailable", and hiding every order type
    // because one payload failed to parse is worse than offering too much and
    // letting the server reject it.
    for (const raw of [undefined, null, "", "   ", "not json", 42, []]) {
      expect(hasReachableOrderType(raw)).toBe(true);
      expect(availableOrderTypes(raw)).toHaveLength(3);
    }
  });
});

describe("outletSupportsOrderType", () => {
  it("maps each order type to its capability key", () => {
    expect(outletSupportsOrderType({ dineIn: false }, "dine-in")).toBe(false);
    expect(outletSupportsOrderType({ takeaway: false }, "takeaway")).toBe(false);
    expect(outletSupportsOrderType({ delivery: false }, "delivery")).toBe(false);
  });

  it("reads a legacy double-encoded row rather than a string's characters", () => {
    // The original outage: `services` arrived as a JSON *string*, so
    // `services.delivery` was `undefined` and every order type was rejected.
    const legacy = JSON.stringify({ dineIn: true, takeaway: true, delivery: false });
    expect(outletSupportsOrderType(legacy, "delivery")).toBe(false);
    expect(outletSupportsOrderType(legacy, "takeaway")).toBe(true);
  });

  it("keeps the defaults fail-open", () => {
    expect(DEFAULT_OUTLET_SERVICES).toEqual({
      dineIn: true,
      takeaway: true,
      delivery: true,
      pos: true,
      onlineOrdering: true,
    });
  });
});

describe("parseOutletServices", () => {
  it("coerces stringified booleans", () => {
    expect(parseOutletServices({ delivery: "false" }).delivery).toBe(false);
    expect(parseOutletServices({ delivery: "true" }).delivery).toBe(true);
  });

  it("does not mutate the shared defaults", () => {
    parseOutletServices({ dineIn: false });
    expect(DEFAULT_OUTLET_SERVICES.dineIn).toBe(true);
  });
});
