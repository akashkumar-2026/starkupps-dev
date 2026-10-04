/**
 * Loads the Google Maps JavaScript API on demand.
 *
 * ## Why a loader rather than a <script> tag in index.html
 *
 * The API is ~150 KB of JavaScript that most customers never need — anyone who
 * types their address or orders takeaway should not pay for it. Loading it only
 * when the location map is actually shown keeps the ordinary checkout fast.
 *
 * ## Why this module is so defensive
 *
 * The map is a *convenience*. A customer who cannot get a pin on the map must
 * still be able to type their address and complete the order, so this never
 * throws and never rejects — it resolves to a status the caller renders. That
 * matters because the realistic failures are all silent ones: an ad-blocker
 * stripping `maps.googleapis.com`, a restricted key refusing the script, a
 * captive-portal wifi that hangs the request, or simply no key configured.
 *
 * A rejected promise here would surface as an unhandled rejection and, worse,
 * tempt the caller into treating a missing map as a failed checkout.
 */

import { ENV } from "@/config/env";

export type MapsStatus =
  /** `google.maps` is available. */
  | "ready"
  /** No API key configured, or no browser. The map cannot be shown. */
  | "unconfigured"
  /** The script was blocked, refused, or timed out. */
  | "failed";

/**
 * How long to wait for the script before giving up.
 *
 * Generous, because the first load is a real network round trip plus script
 * evaluation, but bounded — otherwise a blocked or throttled request leaves the
 * map area spinning forever, which reads as a broken checkout.
 */
const LOAD_TIMEOUT_MS = 10_000;

type MapsWindow = Window & {
  google?: typeof google;
  __starkuppsMapsPromise?: Promise<boolean>;
};

/** `true` when a key is present, so a map is even possible. */
export function mapsConfigured(): boolean {
  return Boolean(ENV.googleMapsApiKey);
}

/**
 * Builds the loader URL.
 *
 * Split out and pure so the parts that matter — the key, the weekly version
 * pin, and the optional Cloud map id — can be asserted in a test without a DOM.
 *
 * `v=weekly` is Google's recommended channel: it delivers fixes continuously, so
 * pinning to a version number means eventually shipping a known-broken release.
 * `loading=async` splits the download from execution, which measurably improves
 * the main thread. Only the Maps JavaScript API is requested — geocoding is done
 * server-side, and asking for it here would widen what a leaked browser key can
 * do.
 */
export function mapsScriptUrl(apiKey: string, mapId?: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/js");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("v", "weekly");
  url.searchParams.set("loading", "async");
  url.searchParams.set("libraries", "marker");
  if (mapId) url.searchParams.set("map_ids", mapId);
  return url.toString();
}

function mapsReady(): boolean {
  return typeof window !== "undefined" && Boolean((window as MapsWindow).google?.maps);
}

/**
 * Resolves the Maps API to a boolean, loading it at most once per page.
 *
 * Concurrent callers share a single in-flight promise, so a customer who
 * re-opens the cart mid-load does not inject a second script tag.
 */
export function loadGoogleMaps(): Promise<boolean> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(false);
  }
  if (!mapsConfigured()) return Promise.resolve(false);

  const scope = window as MapsWindow;
  if (mapsReady()) return Promise.resolve(true);
  if (scope.__starkuppsMapsPromise) return scope.__starkuppsMapsPromise;

  const apiKey = ENV.googleMapsApiKey!;
  const attempt = new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);

    const script = document.createElement("script");
    script.src = mapsScriptUrl(apiKey, ENV.googleMapsMapId);
    script.async = true;
    // Google's script is served with CORS headers; without this a strict CSP or
    // a proxy that strips them produces an opaque error we cannot diagnose.
    script.crossOrigin = "anonymous";
    script.onload = () => finish(mapsReady());
    script.onerror = () => finish(false);
    script.addEventListener("load", () => finish(mapsReady()));

    // Marks the tag so a second mount reuses it rather than adding another.
    script.dataset["starkuppsMaps"] = "true";
    document.head.appendChild(script);
  });

  // Cached on the window so every caller after the first awaits the same load,
  // and so a failed attempt is not retried on every re-render.
  scope.__starkuppsMapsPromise = attempt;
  return attempt;
}

/** Maps the loader's boolean onto the status the UI renders. */
export function mapsStatus(ok: boolean): MapsStatus {
  if (ok) return "ready";
  return mapsConfigured() ? "failed" : "unconfigured";
}
/**
 * How long to wait after a pin move before reverse-geocoding it.
 *
 * Long enough that a customer nudging the pin into place produces one request,
 * short enough that the address still feels like it is following them.
 */
export const MAP_REVERSE_GEOCODE_DEBOUNCE_MS = 700;
