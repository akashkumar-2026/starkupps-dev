import { describe, expect, it } from "vitest";

import {
  availableOutletOrderTypes,
  DEFAULT_OUTLET_SERVICES,
  hasReachableOrderType,
  mergeOutletServices,
  OUTLET_ORDER_TYPE_KEYS,
  parseOutletServices,
} from "./outletServices";

/**
 * `mergeOutletServices` exists because `outletsRouter.update` used to write
 * `input.services` straight through, and Zod's `z.object({...})` had already
 * stripped every key it did not declare. Any per-outlet charge override was
 * therefore destroyed by *any* unrelated outlet edit — changing a phone number
 * silently changed what customers were charged there.
 */
describe("mergeOutletServices", () => {
  it("preserves charge overrides that the patch does not mention", () => {
    const existing = {
      dineIn: true,
      takeaway: true,
      delivery: true,
      pos: true,
      onlineOrdering: true,
      packingCharge: 20,
      deliveryFee: 35,
      freeDeliveryAbove: 500,
    };
    const merged = mergeOutletServices(existing, { takeaway: false });
    expect(merged.takeaway).toBe(false);
    expect(merged.packingCharge).toBe(20);
    expect(merged.deliveryFee).toBe(35);
    expect(merged.freeDeliveryAbove).toBe(500);
  });

  it("treats an absent flag as unchanged rather than a reset", () => {
    const merged = mergeOutletServices(
      { dineIn: false, takeaway: false, delivery: true },
      { delivery: false }
    );
    expect(merged).toMatchObject({
      dineIn: false,
      takeaway: false,
      delivery: false,
    });
  });

  it("honours an explicit false, which a defaults-first spread would drop", () => {
    const merged = mergeOutletServices(null, { delivery: false });
    expect(merged.delivery).toBe(false);
    expect(merged.dineIn).toBe(true);
  });

  it("clears an override when null is sent explicitly", () => {
    const merged = mergeOutletServices(
      { deliveryFee: 40 },
      { deliveryFee: null }
    );
    expect("deliveryFee" in merged).toBe(false);
  });

  it("leaves an override alone when the key is absent", () => {
    const merged = mergeOutletServices({ deliveryFee: 40 }, { takeaway: true });
    expect(merged.deliveryFee).toBe(40);
  });

  it("keeps unknown keys added by a later migration", () => {
    const merged = mergeOutletServices(
      { someFutureFlag: "keep-me" },
      { dineIn: false }
    );
    expect(merged["someFutureFlag"]).toBe("keep-me");
  });

  it("recovers a legacy double-encoded row rather than reading its characters", () => {
    // The shape that once rejected every order type: a JSON *string* holding the
    // object. Reading `.dineIn` off the string yields `undefined`, so the merge
    // has to parse before it can preserve anything.
    const legacy = JSON.stringify({
      dineIn: false,
      takeaway: false,
      delivery: true,
      packingCharge: 12,
    });
    const merged = mergeOutletServices(legacy, { delivery: false });
    expect(merged).toMatchObject({
      dineIn: false,
      takeaway: false,
      delivery: false,
    });
    expect(merged.packingCharge).toBe(12);
  });

  it("does not mutate the shared defaults", () => {
    mergeOutletServices(null, { dineIn: false });
    expect(DEFAULT_OUTLET_SERVICES.dineIn).toBe(true);
    expect(parseOutletServices(null)).toEqual(DEFAULT_OUTLET_SERVICES);
  });
});

describe("availableOutletOrderTypes", () => {
  it("returns the enabled methods in canonical display order", () => {
    const types = availableOutletOrderTypes({
      delivery: true,
      dineIn: false,
      takeaway: true,
    });
    expect(types).toEqual(["takeaway", "delivery"]);
  });

  it("returns an empty list when every method is off", () => {
    // Must stay empty: the storefront renders "ordering unavailable" from this,
    // and substituting a default would offer a method the server will reject.
    expect(
      availableOutletOrderTypes({
        dineIn: false,
        takeaway: false,
        delivery: false,
      })
    ).toEqual([]);
  });

  it("covers every method in the canonical order", () => {
    expect(availableOutletOrderTypes(null)).toEqual([
      ...OUTLET_ORDER_TYPE_KEYS,
    ]);
  });
});

describe("hasReachableOrderType", () => {
  it("is false when online ordering is switched off wholesale", () => {
    // Every method is configured, but none is reachable — a distinct state from
    // "all methods disabled", and the storefront word it differently.
    expect(hasReachableOrderType({ onlineOrdering: false })).toBe(false);
  });

  it("is false when both online ordering and every method are off", () => {
    expect(
      hasReachableOrderType({
        onlineOrdering: false,
        dineIn: false,
        takeaway: false,
        delivery: false,
      })
    ).toBe(false);
  });

  it("is true with at least one method and online ordering on", () => {
    expect(hasReachableOrderType({ dineIn: false, takeaway: false })).toBe(
      true
    );
  });

  it("is true for an unreadable row, so a bad payload cannot hide all ordering", () => {
    expect(hasReachableOrderType(undefined)).toBe(true);
    expect(hasReachableOrderType("not json")).toBe(true);
  });
});
