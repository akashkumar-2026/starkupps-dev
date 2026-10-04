import { describe, expect, it } from "vitest";

import {
  composeAddress,
  googleAddressParts,
  isRetryableGoogleStatus,
  nominatimAddressParts,
} from "../lib/geocode";

/**
 * The composed line lands in a **required** delivery field, so two things matter
 * equally: it must never be a useless string like "Unknown", and it must fit the
 * checkout schema (≤300 chars, at least two words). A provider's
 * `formatted_address` — the obvious thing to use — fails both: it repeats the
 * city and country and routinely runs past 300 characters.
 */
describe("composeAddress", () => {
  it("reads an Indian address in the order a person would say it", () => {
    const line = composeAddress({
      houseNumber: "12",
      road: "Station Road",
      area: "Azad Chowk",
      city: "Munger",
      state: "Bihar",
      postcode: "813211",
      country: "India",
    });
    // House, road, area, city, state, PIN — and *not* the country.
    expect(line).toBe("12, Station Road, Azad Chowk, Munger, Bihar, 813211");
    expect(line).not.toMatch(/India/);
  });

  it("skips absent components rather than leaving gaps", () => {
    expect(composeAddress({ road: "Station Road", city: "Munger" })).toBe(
      "Station Road, Munger"
    );
  });

  it("keeps the road when there is no house number", () => {
    // Common on rural addresses, and better than dropping the street entirely.
    expect(composeAddress({ road: "NH-107", city: "Islampur" })).toBe(
      "NH-107, Islampur"
    );
  });

  it("does not repeat a component that appears in several fields", () => {
    // A village and a district can share a name; without de-duplication the field
    // reads "Munger, Munger".
    expect(
      composeAddress({ city: "Munger", area: "Munger", state: "Munger" })
    ).toBe("Munger");
  });

  it("returns an empty string rather than inventing a placeholder", () => {
    // The caller treats "" as a miss and tells the customer to type their
    // address. "Unknown" would sail through the schema and reach a driver.
    expect(composeAddress({})).toBe("");
    expect(composeAddress(null)).toBe("");
    expect(composeAddress(undefined)).toBe("");
    expect(composeAddress("nope" as never)).toBe("");
  });

  it("skips blank and whitespace-only components", () => {
    expect(
      composeAddress({ houseNumber: "  ", road: "Station Road", city: "" })
    ).toBe("Station Road");
  });

  it("truncates to the schema's 300-character limit", () => {
    // Over-long input would fail `addressSchema` and the customer would be stuck
    // looking at a field that auto-filled itself into an error.
    const long = composeAddress({ road: "x".repeat(400), city: "Munger" });
    expect(long.length).toBeLessThanOrEqual(300);
  });

  it("always produces at least two words when a road is present", () => {
    // The schema requires two words; a single-word suggestion is rejected.
    const line = composeAddress({ road: "Station Road", city: "Munger" });
    expect(line.split(/\s+/).filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });
});

/** Builds one Google `address_components` entry. */
const component = (long: string, types: string[]) => ({
  long_name: long,
  short_name: long,
  types,
});

describe("googleAddressParts", () => {
  it("flattens Google's components into a readable address", () => {
    const parts = googleAddressParts([
      component("12", ["street_number"]),
      component("Station Road", ["route"]),
      component("Azad Chowk", ["sublocality_level_2", "sublocality"]),
      component("Munger", ["locality", "political"]),
      component("Bihar", ["administrative_area_level_1", "political"]),
      component("813211", ["postal_code"]),
      component("India", ["country", "political"]),
    ]);
    expect(composeAddress(parts)).toBe(
      "12, Station Road, Azad Chowk, Munger, Bihar, 813211"
    );
  });

  it("prefers the most specific sublocality level", () => {
    // Level 2 is the locality proper; level 1 is the wider neighbourhood.
    const parts = googleAddressParts([
      component("Kadamkuan", ["sublocality_level_1"]),
      component("Kadamkuan", ["sublocality_level_2"]),
    ]);
    expect(parts?.area).toBe("Kadamkuan");
  });

  it("accepts a town labelled postal_town instead of locality", () => {
    // Which label Google uses varies by region; a village must not come back
    // empty just because it used a different type.
    expect(
      googleAddressParts([component("Islampur", ["postal_town"])])?.city
    ).toBe("Islampur");
    expect(
      googleAddressParts([component("Bandar", ["administrative_area_level_3"])])
        ?.city
    ).toBe("Bandar");
  });

  it("falls back to short_name when long_name is absent", () => {
    const parts = googleAddressParts([
      { short_name: "BR", types: ["administrative_area_level_1"] },
    ]);
    expect(parts?.state).toBe("BR");
  });

  it("ignores entries with no usable types", () => {
    const parts = googleAddressParts([
      { long_name: "Nowhere", types: "not-an-array" },
      component("Station Road", ["route"]),
    ]);
    expect(parts?.road).toBe("Station Road");
    expect(composeAddress(parts)).toBe("Station Road");
  });

  it("returns null when Google had nothing usable", () => {
    // null means "miss", and the caller reports it rather than filling the
    // required field with a confident wrong answer.
    expect(googleAddressParts([])).toBeNull();
    expect(googleAddressParts([component("", ["route"])])).toBeNull();
    expect(googleAddressParts(null)).toBeNull();
    expect(googleAddressParts("nope")).toBeNull();
  });
});

describe("nominatimAddressParts", () => {
  it("falls back through alternative keys by settlement type", () => {
    // Nominatim returns different key sets depending on whether a place is a
    // village, a town or a municipality.
    expect(
      composeAddress(
        nominatimAddressParts({ village: "Bandar", state: "Bihar" })
      )
    ).toBe("Bandar, Bihar");
    expect(
      composeAddress(
        nominatimAddressParts({ town: "Kadamkuan", state: "Bihar" })
      )
    ).toBe("Kadamkuan, Bihar");
  });

  it("returns null for an empty address object", () => {
    expect(nominatimAddressParts({})).toBeNull();
    expect(nominatimAddressParts(null)).toBeNull();
  });
});

describe("isRetryableGoogleStatus", () => {
  it("treats ZERO_RESULTS as a real answer, not a failure", () => {
    // "Nobody is at those coordinates" is worth reporting; retrying changes
    // nothing and only delays telling the customer to type their address.
    expect(isRetryableGoogleStatus("ZERO_RESULTS")).toBe(false);
    expect(isRetryableGoogleStatus("OK")).toBe(false);
  });

  it("treats key, quota and transport problems as worth falling back on", () => {
    // These mean the feature is broken, so the Nominatim path should take over
    // rather than the customer getting a dead button.
    for (const status of [
      "REQUEST_DENIED",
      "OVER_QUERY_LIMIT",
      "OVER_DAILY_LIMIT",
      "INVALID_REQUEST",
      "UNKNOWN_ERROR",
      undefined,
    ]) {
      expect(isRetryableGoogleStatus(status)).toBe(true);
    }
  });
});
