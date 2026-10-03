/**
 * Reverse geocoding for the storefront's "use my location" button.
 *
 * ## Why this lives on the server
 *
 * `navigator.geolocation` yields coordinates and nothing else, so turning "where
 * am I" into a deliverable street address needs a geocoding dataset. Three
 * reasons that call goes through the gateway rather than the browser:
 *
 * 1. **No key in the customer bundle.** A browser-restricted key would ship to
 *    every visitor and be scrapeable from the page. Here the provider is an
 *    implementation detail.
 * 2. **Cache and rate-limit control.** Nominatim's usage policy caps it at one
 *    request per second and requires callers to identify themselves. A shared
 *    cache keyed on *rounded* coordinates means a hundred customers in the same
 *    locality cost one upstream call, and the cache never holds anyone's exact
 *    home address — only the street-level area they are in.
 * 3. **One place to swap providers.** Nothing in the storefront names Nominatim.
 *
 * ## Why the cache key is rounded
 *
 * Storing exact coordinates for a delivery address is more personal data than the
 * order itself needs, and re-geocoding two houses on the same street to the metre
 * is wasted work. Four decimal places is roughly 11 m — precise enough that the
 * filled-in text is right, coarse enough that neighbours share a cache entry.
 *
 * ## Attribution
 *
 * Nominatim's data is © OpenStreetMap contributors and ODbL-licensed, which
 * requires attribution. `attribution` is returned with every result so the caller
 * can render it.
 */
import { createHash } from "node:crypto";

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
 * Coarse cache key.
 *
 * Rounded to 4 dp (~11 m) so nearby customers share an entry. Hashed as well so
 * the key is a fixed width and carries no readable coordinate.
 */
function cacheKey(lat: number, lon: number): string {
  const rounded = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
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

/** Serialises upstream calls so we never exceed the provider's 1 req/s budget. */
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

/**
 * Turns a Nominatim address object into one readable line.
 *
 * `display_name` alone is unusable in a form field — it repeats the city and
 * country and can run past 300 characters, which the address schema rejects.
 * The components are preferred, then common-and-useful optional parts
 * (house_number, road, suburb, neighbourhood) are appended.
 *
 * Returns `""` when nothing usable came back, so the caller can treat it as a
 * miss rather than filling the field with "Unknown".
 */
export function composeAddress(
  address: Record<string, unknown> | null | undefined
): string {
  if (!address || typeof address !== "object") return "";
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = address[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return null;
  };

  // Order mirrors how an Indian address is read: house, road, area, city, state,
  // PIN. PIN last because it reads as a postcode, not as a place.
  const parts = [
    pick("house_number"),
    pick("road", "pedestrian", "footway", "path"),
    pick("neighbourhood", "suburb", "city_district", "quarter"),
    pick("village", "town", "city", "municipality"),
    pick("state"),
    pick("postcode"),
  ].filter((part): part is string => Boolean(part));

  const unique = parts.filter((part, i) => parts.indexOf(part) === i);
  const line = unique.join(", ");
  return line.length > 300 ? line.slice(0, 300) : line;
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
  const key = cacheKey(lat, lon);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.value, cached: true };
  }

  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lon.toFixed(6));
  url.searchParams.set("format", "jsonv2");
  // `addressdetails=1` is what fills the `address` object `composeAddress` reads.
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", "en");

  const payload = await withUpstreamSlot(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`nominatim responded ${response.status}`);
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timer);
    }
  });

  const address = composeAddress(payload?.address as Record<string, unknown>);
  if (!address) {
    // A coordinate in the middle of nowhere, or a sea. Not an error worth
    // retrying upstream — the customer can still type their address.
    throw new Error("no address at those coordinates");
  }

  const details = (payload?.address ?? {}) as Record<string, unknown>;
  const str = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : null;

  const result: ReverseGeocodeResult = {
    address,
    locality: str(details.neighbourhood) ?? str(details.suburb),
    city: str(details.city) ?? str(details.town) ?? str(details.village),
    state: str(details.state),
    postcode: str(details.postcode),
    country: str(details.country),
    attribution: "© OpenStreetMap contributors",
    cached: false,
  };
  remember(key, result);
  return result;
}
