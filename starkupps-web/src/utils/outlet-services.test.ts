import { describe, expect, it } from "vitest";

import {
  DEFAULT_OUTLET_SERVICES,
  ORDER_TYPE_SERVICE_KEY,
  outletSupportsOrderType,
  parseOutletServices,
} from "./outlet-services";

/**
 * Regression cover for the bug that produced "Some items are unavailable at this
 * outlet." / "Delivery not available at this outlet.":
 *
 * `outlets.services` reached the browser as a JSON *string*, so
 * `outlet.services?.delivery` was `undefined`. Anything that branched on it saw
 * `undefined` rather than the operator's configured value.
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

  it("reads the legacy double-encoded string", () => {
    const services = parseOutletServices(
      '{"dineIn":true,"takeaway":false,"delivery":true,"pos":true,"onlineOrdering":true}',
    );
    expect(services.delivery).toBe(true);
    expect(services.takeaway).toBe(false);
  });

  it("never loses delivery to a string payload — the reported bug", () => {
    // Exactly what the gateway used to send.
    const raw = '{"dineIn":true,"takeaway":true,"delivery":true,"pos":true,"onlineOrdering":true}';
    expect(typeof raw).toBe("string");
    expect(parseOutletServices(raw).delivery).toBe(true);
  });

  it("defaults to everything available when the value is missing", () => {
    for (const raw of [null, undefined, "", "   ", "not json", 42, []]) {
      expect(parseOutletServices(raw)).toEqual(DEFAULT_OUTLET_SERVICES);
    }
  });

  it("accepts stringified booleans from json columns", () => {
    const services = parseOutletServices('{"delivery":"false","takeaway":"true"}');
    expect(services.delivery).toBe(false);
    expect(services.takeaway).toBe(true);
  });

  it("falls back to the default for a flag that is neither boolean nor text", () => {
    expect(parseOutletServices({ delivery: 1 }).delivery).toBe(true);
    expect(parseOutletServices({ delivery: null }).delivery).toBe(true);
  });

  it("preserves unknown keys such as charge overrides", () => {
    const services = parseOutletServices({ delivery: true, packingCharge: 20 });
    expect(services["packingCharge"]).toBe(20);
  });

  it("does not mutate the defaults between calls", () => {
    parseOutletServices({ delivery: false });
    expect(DEFAULT_OUTLET_SERVICES.delivery).toBe(true);
  });
});

describe("outletSupportsOrderType", () => {
  it("maps each customer-facing order type to its capability", () => {
    expect(ORDER_TYPE_SERVICE_KEY).toEqual({
      "dine-in": "dineIn",
      takeaway: "takeaway",
      delivery: "delivery",
    });
  });

  it("honours a disabled capability", () => {
    const services = { dineIn: true, takeaway: true, delivery: false };
    expect(outletSupportsOrderType(services, "delivery")).toBe(false);
    expect(outletSupportsOrderType(services, "takeaway")).toBe(true);
    expect(outletSupportsOrderType(services, "dine-in")).toBe(true);
  });

  it("honours a disabled capability delivered as a legacy string", () => {
    expect(outletSupportsOrderType('{"delivery":false}', "delivery")).toBe(false);
    expect(outletSupportsOrderType('{"delivery":false}', "takeaway")).toBe(true);
  });

  it("allows everything when the outlet is unknown", () => {
    expect(outletSupportsOrderType(null, "delivery")).toBe(true);
    expect(outletSupportsOrderType(undefined, "delivery")).toBe(true);
  });
});
