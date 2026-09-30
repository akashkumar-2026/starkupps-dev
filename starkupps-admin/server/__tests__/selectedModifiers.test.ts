import { describe, expect, it } from "vitest";
import { normalizeSelectedModifiers } from "../db/index";

/**
 * Regression coverage for the Admin order-dialog crash:
 * "item.selectedModifiers.map is not a function".
 *
 * `order_items.selectedModifiers` is a `json` column. Rows written through the
 * public checkout stored the *string* "[]" instead of an array, because a
 * pre-stringified JS string was passed to a jsonb parameter and JSON-encoded a
 * second time by the driver. One malformed row took down OrderDetailDialog.
 */
describe("normalizeSelectedModifiers", () => {
  it("passes a real array through", () => {
    expect(
      normalizeSelectedModifiers([
        { name: "Extra cheese", priceDelta: 60 },
        { name: "No onion", priceDelta: 0 },
      ])
    ).toEqual([
      { name: "Extra cheese", priceDelta: 60 },
      { name: "No onion", priceDelta: 0 },
    ]);
  });

  it("unwraps the doubly-encoded string form", () => {
    expect(normalizeSelectedModifiers("[]")).toEqual([]);
    expect(
      normalizeSelectedModifiers('[{"name":"Olio","priceDelta":15}]')
    ).toEqual([{ name: "Olio", priceDelta: 15 }]);
  });

  it("returns an empty list for null, undefined and blanks", () => {
    expect(normalizeSelectedModifiers(null)).toEqual([]);
    expect(normalizeSelectedModifiers(undefined)).toEqual([]);
    expect(normalizeSelectedModifiers("")).toEqual([]);
    expect(normalizeSelectedModifiers("   ")).toEqual([]);
  });

  it("returns an empty list for unparseable text instead of throwing", () => {
    expect(normalizeSelectedModifiers("not json")).toEqual([]);
    expect(normalizeSelectedModifiers("{oops")).toEqual([]);
  });

  it("never returns a non-array, whatever it is handed", () => {
    for (const input of [
      null,
      undefined,
      "",
      "[]",
      "null",
      42,
      true,
      {},
      { name: "Bare", priceDelta: 5 },
      [null, 1, "x", { name: "Ok", priceDelta: 1 }],
    ]) {
      expect(Array.isArray(normalizeSelectedModifiers(input))).toBe(true);
    }
  });

  it("lifts a bare object into a single modifier", () => {
    expect(normalizeSelectedModifiers({ name: "Bare", priceDelta: 5 })).toEqual(
      [{ name: "Bare", priceDelta: 5 }]
    );
  });

  it("coerces partial modifier records to a safe shape", () => {
    expect(normalizeSelectedModifiers([{ name: "Only name" }, {}])).toEqual([
      { name: "Only name", priceDelta: 0 },
      { name: "", priceDelta: 0 },
    ]);
  });
});
