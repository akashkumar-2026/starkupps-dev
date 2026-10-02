import { describe, expect, it } from "vitest";
import {
  availableOutletOrderTypes,
  DEFAULT_OUTLET_SERVICES,
  OUTLET_ORDER_TYPE_KEYS,
  outletSupportsOrderType,
  parseOutletServices,
} from "@shared/outletServices";

/**
 * Regression cover for the checkout outage.
 *
 * `outlets.create` bound `JSON.stringify(services)` to a `json` column, and
 * postgres.js encodes those itself — so the flags were stored as a JSON *string*
 * (`jsonb_typeof = 'string'`). PostgREST returns `json` unparsed, every reader
 * saw a string, and `services.delivery` was `undefined`. The guard
 * `if (services && !services.delivery)` is then true for any non-empty string,
 * so **every order type was rejected** while the flags all read `true`.
 */
describe("parseOutletServices", () => {
  it("reads a plain object", () => {
    const services = parseOutletServices({
      dineIn: true,
      takeaway: false,
      delivery: true,
      pos: true,
      onlineOrdering: true,
    });
    expect(services.delivery).toBe(true);
    expect(services.takeaway).toBe(false);
  });

  it("reads the double-encoded string that caused the outage", () => {
    // Exactly the stored shape: `services::text` is an escaped JSON string.
    const stored =
      '"{\\"dineIn\\":true,\\"takeaway\\":true,\\"delivery\\":true,\\"pos\\":true,\\"onlineOrdering\\":true}"';
    expect(parseOutletServices(stored).delivery).toBe(true);
    expect(parseOutletServices(stored).takeaway).toBe(true);
  });

  it("honours a disabled capability delivered as a string", () => {
    expect(parseOutletServices('{"delivery":false}').delivery).toBe(false);
  });

  it("defaults to everything available when the value is missing or broken", () => {
    // Failing closed here would hide order types and, on the write path, reject
    // every checkout. An operator disables a capability deliberately.
    for (const raw of [null, undefined, "", "   ", "{not json", 42, [], true]) {
      expect(parseOutletServices(raw)).toEqual(DEFAULT_OUTLET_SERVICES);
    }
  });

  it("accepts stringified booleans from a json column", () => {
    const services = parseOutletServices({
      delivery: "false",
      takeaway: "true",
    });
    expect(services.delivery).toBe(false);
    expect(services.takeaway).toBe(true);
  });

  it("falls back to the default for a flag that is neither boolean nor text", () => {
    expect(parseOutletServices({ delivery: 1 }).delivery).toBe(true);
    expect(parseOutletServices({ delivery: null }).delivery).toBe(true);
    expect(parseOutletServices({ delivery: "yes" }).delivery).toBe(true);
  });

  it("keeps charge overrides and drops non-numeric ones", () => {
    const services = parseOutletServices({
      delivery: true,
      packingCharge: 20,
      deliveryFee: "30",
      freeDeliveryAbove: "not-a-number",
    });
    expect(services.packingCharge).toBe(20);
    expect(services.deliveryFee).toBe(30);
    expect("freeDeliveryAbove" in services).toBe(false);
  });

  it("preserves unknown keys", () => {
    expect(parseOutletServices({ delivery: true, kfc: false }).kfc).toBe(false);
  });

  it("does not mutate the shared defaults between calls", () => {
    parseOutletServices({ delivery: false });
    expect(DEFAULT_OUTLET_SERVICES.delivery).toBe(true);
  });
});

describe("outletSupportsOrderType", () => {
  it("reflects a disabled capability", () => {
    const services = { dineIn: true, takeaway: true, delivery: false };
    expect(outletSupportsOrderType(services, "delivery")).toBe(false);
    expect(outletSupportsOrderType(services, "takeaway")).toBe(true);
    expect(outletSupportsOrderType(services, "dineIn")).toBe(true);
  });

  it("allows every order type when the column is missing", () => {
    for (const key of OUTLET_ORDER_TYPE_KEYS) {
      expect(outletSupportsOrderType(null, key)).toBe(true);
    }
  });
});

describe("availableOutletOrderTypes", () => {
  it("lists every type in canonical order by default", () => {
    expect(availableOutletOrderTypes(null)).toEqual([
      "dineIn",
      "takeaway",
      "delivery",
    ]);
  });

  it("omits only the disabled types", () => {
    expect(availableOutletOrderTypes({ delivery: false })).toEqual([
      "dineIn",
      "takeaway",
    ]);
    expect(
      availableOutletOrderTypes({ dineIn: false, takeaway: false })
    ).toEqual(["delivery"]);
  });

  it("returns an empty list when every capability is off, rather than inventing one", () => {
    // Truthful reporting: an outlet with all three switched off genuinely accepts
    // nothing. A caller must handle the empty list rather than be handed a type
    // the server would reject.
    const off = { dineIn: false, takeaway: false, delivery: false };
    expect(availableOutletOrderTypes(off)).toEqual([]);
    expect(parseOutletServices(off).dineIn).toBe(false);
  });
});
