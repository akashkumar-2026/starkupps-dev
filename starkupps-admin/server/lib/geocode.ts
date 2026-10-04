/**
 * Reverse geocoding for the storefront's "use my current location" button.
 *
 * ## What this does
 *
 * `navigator.geolocation` yields coordinates and nothing else, so turning "where
 * am I" into a deliverable street address needs a geocoding dataset. This module
 * calls **Google's Geocoding API** and falls back to OpenStreetMap's Nominatim
 * when no Google key is configured or Google is unreachable.
 *
 * ## Why this stays on the server
 *
 * Google bills per request and its keys are easy to abuse, so the call must not
 * originate from the customer. Keeping it in the gateway means the
 * `GOOGLE_MAPS_API_KEY` never enters a browser bundle. The storefront only ever
 * sees the composed address string.
 *
 * The storefront *does* load the Maps JavaScript API to draw the map, and that
 * key is unavoidably visible to the customer — which is precisely why it is a
 * different key, restricted to the Maps JavaScript API, while this one is
 * restricted to the Geocoding API and to the gateway's IPs.
 *
 * ## Why there is a fallback
 *
 * A misconfigured key is the single most likely way for this feature to break in
 * production, and the failure mode it produces — a "use my location" button that
 * silently does nothing — is one that loses orders. Falling back to Nominatim
 * costs one upstream request and keeps the flow alive at slightly lower address
 * quality. Google failures are logged loudly rather than swallowed, because a
 * persistent fallback usually means a billing or restriction problem to fix.
 *
 * ## Caching
 *
 * Two things make the cache worth having:
 *
 * 1. **Cost and rate limits.** A hundred customers in the same locality cost one
 *    upstream call.
 * 2. **Privacy.** Exact coordinates are more personal data than the order itself
 *    needs. The key is *rounded* before hashing, so the cache holds a
 *    street-level area rather than anyone's precise home position. Four decimal
 *    places is roughly 11 m — precise enough that the suggested text is right,
 *    coarse enough that neighbours share an entry.
 *
 * ## Attribution
 *
 * Nominatim's data is © OpenStreetMap contributors and ODbL-licensed, which
 * requires attribution, so it is returned with every Nominatim result. Google's
 * terms require attribution for the *map*, which the storefront's map component
 * renders itself.
 */
import { createHash } from "node:crypto";

import { ENV } from "../config/env";

const GOOGLE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

/** Identifies this deployment to Nominatim, as their usage policy requires. */
const USER_AGENT =
  "StarKupps/1.0 (café ordering platform; reverse-geocode on customer request)";

/** Upstream politeness window; Nominatim asks for ≤1 req/s per caller. */
const MIN_UPSTREAM_INTERVAL_MS = 1_100;
const UPSTREAM_TIMEOUT_MS = 5_000;

export type ReverseGeocodeResult = {
  /**
   * A single-line address, composed for a human to check and correct.
   * Never empty on success.
   */
  address: string;
  /** Neighbourhood / suburb / village, when the provider returns one. */
  locality: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  attribution: string;
  /** True when this came from cache rather than an upstream call. */
  cached: boolean;
};

/**
 * A provider-neutral address, so one composer serves both upstreams.
 *
 * Normalising at the edge keeps `composeAddress` — where the rules that matter
 * live (never invent a value, de-duplicate, respect the schema's length limit) —
 * written once instead of once per provider.
 */
export type AddressParts = {
  houseNumber?: string | null;
  road?: string | null;
  area?: string | null;
  city?: string | null;
  state?: string | null;
  postcode?: string | null;
  country?: string | null;
};

/**
 * Coarse cache key.
 *
 * Rounded to 4 dp (~11 m) so nearby customers share an entry, then hashed so the
 * key is a fixed width and carries no readable coordinate. The provider is part
 * of the key so a Nominatim result is never served to a customer who is
 * entitled to the better Google one.
 */
function cacheKey(provider: string, lat: number, lon: number): string {
  const rounded = `${provider}:${lat.toFixed(4)}:${lon.toFixed(4)}`;
  return createHash("sha256").update(rounded).digest("hex").slice(0, 32);
}

type CacheEntry = { at: number; value: ReverseGeocodeResult };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 500;

function remember(key: string, value: ReverseGeocodeResult) {
  if (cache.size >= CACHE_MAX) {
    // Cheap eviction: drop the oldest insertion. A Map preserves insertion
    // order, so the first key is the least recently added.
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

/** Serialises Nominatim calls so we never exceed its 1 req/s budget. */
let lastUpstreamAt = 0;
let upstreamChain: Promise<unknown> = Promise.resolve();

function withUpstreamSlot<T>(fn: () => Promise<T>): Promise<T> {
  const run = upstreamChain.then(async () => {
    const wait = MIN_UPSTREAM_INTERVAL_MS - (Date.now() - lastUpstreamAt);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastUpstreamAt = Date.now();
    }
  });
  // Keep the chain alive even when a call rejects, or one failure would wedge
  // every later geocode.
  upstreamChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Turns a provider-neutral address into one readable line.
 *
 * A single `formatted_address` alone is unusable in a form field — it repeats the
 * city and country and can run past 300 characters, which the address schema
 * rejects. Components are preferred instead, joined in the order an Indian
 * address is read: house, road, area, city, state, PIN. PIN last because it reads
 * as a postcode, not as a place.
 *
 * Returns `""` when nothing usable came back, so the caller can treat it as a
 * miss rather than filling the field with "Unknown".
 */
export function composeAddress(parts: AddressParts | null | undefined): string {
  if (!parts || typeof parts !== "object") return "";
  const order: Array<keyof AddressParts> = [
    "houseNumber",
    "road",
    "area",
    "city",
    "state",
    "postcode",
  ];
  const values = order.map(key => clean(parts[key]));
  const unique = values.filter(
    (value, i): value is string => Boolean(value) && values.indexOf(value) === i
  );
  const line = unique.join(", ");
  return line.length > 300 ? line.slice(0, 300) : line;
}

/** One entry from Google's `address_components` array. */
type GoogleComponent = {
  long_name?: unknown;
  short_name?: unknown;
  types?: unknown;
};

/**
 * Flattens Google's `address_components` into {@link AddressParts}.
 *
 * Google returns a flat array where each entry lists every type that applies to
 * it, so a single entry can be both `locality` and `political`. Types are probed
 * longest-preference-first to match how an address is read.
 *
 * `short_name` is preferred over `long_name` for the state, because Google's
 * long form for Indian states is the same word as the city in some cases
 * ("Munger, Munger"); `short_name` gives the standard abbreviation.
 */
export function googleAddressParts(components: unknown): AddressParts | null {
  if (!Array.isArray(components)) return null;

  const byType = (...types: string[]): string | null => {
    for (const entry of components as GoogleComponent[]) {
      if (!entry || !Array.isArray(entry.types)) continue;
      if (entry.types.some(t => types.includes(t as string))) {
        return clean(entry.long_name) ?? clean(entry.short_name);
      }
    }
    return null;
  };

  const parts: AddressParts = {
    houseNumber: byType("street_number"),
    road: byType("route"),
    // A neighbourhood/sublocality is the useful "area"; level 2 is the more
    // specific of the two.
    area: byType("sublocality_level_2", "sublocality_level_1", "sublocality"),
    // Google may label a town as `locality`, `postal_town` or
    // `administrative_area_level_3` depending on the region.
    city: byType("locality", "postal_town", "administrative_area_level_3"),
    state: byType("administrative_area_level_1"),
    postcode: byType("postal_code"),
    country: byType("country"),
  };

  // Every field null means Google had nothing usable, which is a miss rather
  // than an address of "Unknown".
  const hasAny = Object.values(parts).some(value => clean(value) !== null);
  return hasAny ? parts : null;
}

/** Flattens a Nominatim `address` object into {@link AddressParts}. */
export function nominatimAddressParts(
  address: Record<string, unknown> | null | undefined
): AddressParts | null {
  if (!address || typeof address !== "object") return null;
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = clean(address[key]);
      if (value) return value;
    }
    return null;
  };
  const parts: AddressParts = {
    houseNumber: pick("house_number"),
    road: pick("road", "pedestrian", "footway", "path"),
    area: pick("neighbourhood", "suburb", "city_district", "quarter"),
    city: pick("city", "town", "village", "municipality"),
    state: pick("state"),
    postcode: pick("postcode"),
    country: pick("country"),
  };
  const hasAny = Object.values(parts).some(value => clean(value) !== null);
  return hasAny ? parts : null;
}

/**
 * Google's status codes, mapped to whether retrying could ever help.
 *
 * Exported for tests: the distinction that matters is `ZERO_RESULTS` (a real
 * answer — nobody is at those coordinates) versus the rest (an infrastructure
 * problem worth logging loudly).
 */
export function isRetryableGoogleStatus(status: unknown): boolean {
  return status !== "OK" && status !== "ZERO_RESULTS";
}

async function fetchJson(
  url: URL,
  headers: Record<string, string>
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`upstream responded ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timer);
  }
}

async function reverseGeocodeGoogle(
  lat: number,
  lon: number,
  key: string
): Promise<ReverseGeocodeResult> {
  const url = new URL(GOOGLE_URL);
  url.searchParams.set("latlng", `${lat.toFixed(6)},${lon.toFixed(6)}`);
  url.searchParams.set("key", key);
  url.searchParams.set("language", "en");
  // Bias towards India without hard-restricting: a coordinate outside India
  // still resolves rather than returning nothing.
  url.searchParams.set("region", "in");

  const payload = await fetchJson(url, { Accept: "application/json" });
  const status = payload?.status;

  if (status !== "OK") {
    // Deliberately includes the status but never the URL, so the key cannot leak
    // into a log line via the query string.
    throw new Error(`google geocoding status ${String(status)}`);
  }

  const results = Array.isArray(payload?.results) ? payload.results : [];
  const first = results[0] as { address_components?: unknown } | undefined;
  const parts = googleAddressParts(first?.address_components);
  const address = composeAddress(parts);
  if (!address) {
    // A coordinate in the middle of nowhere, or a sea. Not worth retrying — the
    // customer can still type their address.
    throw new Error("no address at those coordinates");
  }

  return {
    address,
    locality: clean(parts?.area),
    city: clean(parts?.city),
    state: clean(parts?.state),
    postcode: clean(parts?.postcode),
    country: clean(parts?.country),
    attribution: "Google",
    cached: false,
  };
}

async function reverseGeocodeNominatim(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lon.toFixed(6));
  url.searchParams.set("format", "jsonv2");
  // `addressdetails=1` is what fills the `address` object the parser reads.
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "en");

  const payload = await withUpstreamSlot(() =>
    fetchJson(url, { "User-Agent": USER_AGENT, Accept: "application/json" })
  );

  const details = (payload?.address ?? {}) as Record<string, unknown>;
  const parts = nominatimAddressParts(details);
  const address = composeAddress(parts);
  if (!address) {
    throw new Error("no address at those coordinates");
  }

  return {
    address,
    locality: clean(parts?.area),
    city: clean(parts?.city),
    state: clean(parts?.state),
    postcode: clean(parts?.postcode),
    country: clean(parts?.country),
    attribution: "© OpenStreetMap contributors",
    cached: false,
  };
}

/**
 * Reverse-geocodes coordinates to an address.
 *
 * Throws on any upstream or network failure; callers translate that into a
 * customer-facing message. Never returns a partial or invented address.
 */
export async function reverseGeocode(
  lat: number,
  lon: number
): Promise<ReverseGeocodeResult> {
  const key = ENV.googleMapsServerKey?.trim();
  const providers: Array<{
    name: string;
    run: () => Promise<ReverseGeocodeResult>;
  }> = [];

  if (key) {
    providers.push({
      name: "google",
      run: () => reverseGeocodeGoogle(lat, lon, key),
    });
  }
  providers.push({
    name: "nominatim",
    run: () => reverseGeocodeNominatim(lat, lon),
  });

  let lastError: unknown;
  for (const provider of providers) {
    const cacheKeyValue = cacheKey(provider.name, lat, lon);
    const hit = cache.get(cacheKeyValue);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.value, cached: true };
    }

    try {
      const result = await provider.run();
      remember(cacheKeyValue, result);
      return result;
    } catch (error) {
      lastError = error;
      // Logged rather than swallowed: a fallback that engages every request
      // means the Google key is missing, mis-restricted or out of quota, and
      // that needs fixing before it becomes a bill.
      console.warn(
        `[geocode] ${provider.name} reverse-geocode failed; trying next provider`,
        error instanceof Error ? error.message : error
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("no geocoding provider available");
}
