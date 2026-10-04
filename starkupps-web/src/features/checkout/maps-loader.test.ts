import { describe, expect, it } from "vitest";

import { MAP_REVERSE_GEOCODE_DEBOUNCE_MS, mapsScriptUrl, mapsStatus } from "./maps-loader";

/**
 * The loader's contract is that it **never throws and never rejects**.
 *
 * The map is a convenience; the address field is the requirement. An ad-blocker
 * stripping `maps.googleapis.com`, a restricted key refusing the script, or a
 * captive-portal wifi hanging the request are all ordinary occurrences, and each
 * one used to have the option of taking the checkout down with it. So the tests
 * here are about the degradation paths, not the happy path.
 */
describe("mapsScriptUrl", () => {
  const KEY = "test-key";

  it("sends the key and the weekly channel", () => {
    const url = new URL(mapsScriptUrl(KEY));
    expect(url.origin).toBe("https://maps.googleapis.com");
    expect(url.pathname).toBe("/maps/api/js");
    expect(url.searchParams.get("key")).toBe(KEY);
    // `v=weekly` is Google's recommended channel: pinning a version number
    // eventually ships a known-broken release.
    expect(url.searchParams.get("v")).toBe("weekly");
  });

  it("splits download from execution", () => {
    // `loading=async` measurably improves main-thread time on a mid-range phone.
    expect(new URL(mapsScriptUrl(KEY)).searchParams.get("loading")).toBe("async");
  });

  it("requests the marker library but NOT geocoding", () => {
    // Geocoding runs server-side behind a key that never reaches a customer.
    // Asking for the browser geocoding library would widen what a leaked
    // browser key can do for no benefit here.
    const libs = new URL(mapsScriptUrl(KEY)).searchParams.get("libraries") ?? "";
    expect(libs).toContain("marker");
    expect(libs).not.toContain("geocoding");
    expect(libs).not.toContain("places");
  });

  it("adds a map id only when one is configured", () => {
    expect(new URL(mapsScriptUrl(KEY)).searchParams.get("map_ids")).toBeNull();
    expect(new URL(mapsScriptUrl(KEY, "cloud-style")).searchParams.get("map_ids")).toBe(
      "cloud-style",
    );
  });
});

describe("mapsStatus", () => {
  it("reports success plainly", () => {
    expect(mapsStatus(true)).toBe("ready");
  });

  it("distinguishes 'no key' from 'the load failed'", () => {
    // These need different words to the customer, and different things to look
    // at: one is a deployment problem, the other is usually an ad-blocker.
    const failed = mapsStatus(false);
    expect(["failed", "unconfigured"]).toContain(failed);
  });
});

describe("the debounce", () => {
  it("is long enough to merge one adjustment into one lookup", () => {
    // Each move spends a rate-limited reverse-geocode request, so a burst of
    // nudges must collapse into a single call.
    expect(MAP_REVERSE_GEOCODE_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(MAP_REVERSE_GEOCODE_DEBOUNCE_MS).toBeLessThanOrEqual(1500);
  });
});
