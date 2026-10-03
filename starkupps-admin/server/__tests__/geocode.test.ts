import { describe, expect, it } from "vitest";

import { composeAddress } from "../lib/geocode";

/**
 * Turns a Nominatim `address` object into one line a customer can read and edit.
 *
 * This is what lands in a **required** delivery field, so two things matter
 * equally: it must never be a useless string like "Unknown", and it must fit the
 * checkout schema (≤300 chars, at least two words). `display_name` — the obvious
 * thing to use — fails both: it repeats the city and country and routinely runs
 * past 300 characters.
 */
describe("composeAddress", () => {
  it("reads an Indian address in the order a person would say it", () => {
    const line = composeAddress({
      house_number: "12",
      road: "Station Road",
      suburb: "Azad Chowk",
      city: "Munger",
      state: "Bihar",
      postcode: "813211",
      country: "India",
    });
    // House, road, area, city, state, PIN — and *not* the country.
    expect(line).toBe("12, Station Road, Azad Chowk, Munger, Bihar, 813211");
    expect(line).not.toMatch(/India/);
  });

  it("falls back through alternative keys when the preferred one is absent", () => {
    // Nominatim returns different key sets by settlement type; a village may
    // have `village` and no `city`, a hamlet neither.
    expect(composeAddress({ village: "Bandar", state: "Bihar" })).toBe(
      "Bandar, Bihar",
    );
    expect(composeAddress({ town: "Kadamkuan", state: "Bihar" })).toBe(
      "Kadamkuan, Bihar",
    );
  });

  it("keeps the road when there is no house number", () => {
    // Common on rural addresses, and better than dropping the street entirely.
    expect(composeAddress({ road: "NH-107", village: "Islampur" })).toBe(
      "NH-107, Islampur",
    );
  });

  it("does not repeat a component that appears in several keys", () => {
    // Nominatim often fills `city`, `town` and `municipality` with the same
    // string; without de-duplication the field reads "Munger, Munger, Munger".
    expect(
      composeAddress({ city: "Munger", town: "Munger", municipality: "Munger" }),
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
      composeAddress({ house_number: "  ", road: "Station Road", city: "" }),
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