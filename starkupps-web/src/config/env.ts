/**
 * Typed access to Vite's client-exposed environment.
 *
 * Vite only injects `import.meta.env` values for *static* member access, so the
 * keys are read individually here rather than through a dynamic lookup. This
 * module is the single place that touches `import.meta.env`; everything else
 * imports the typed helpers below.
 *
 * Only `VITE_`-prefixed variables reach the browser bundle. Never prefix a
 * secret with `VITE_` — anything so prefixed is inlined into the client build
 * and is therefore public.
 */

export const ENV = {
  /** Base URL of the StarKupps Admin REST/tRPC gateway. Empty ⇒ same-origin. */
  apiUrl: readEnv("VITE_API_URL") ?? readEnv("VITE_ADMIN_URL") ?? "",
  /** Supabase project URL, used for auth + realtime menu sync. */
  supabaseUrl: readEnv("VITE_SUPABASE_URL") ?? "",
  /** Public anon/publishable key. Never the service-role key. */
  supabaseAnonKey:
    readEnv("VITE_SUPABASE_ANON_KEY") ?? readEnv("VITE_SUPABASE_PUBLISHABLE_KEY") ?? "",
  /**
   * Google Maps JavaScript API key, used only to *draw* the map so the customer
   * can correct the pin.
   *
   * ## This one cannot be kept secret
   *
   * The Maps JavaScript API is fetched by the browser from Google's servers, so
   * the key is readable by anyone who opens the page. Restricting it is the
   * only control that exists — and it is a good one:
   *
   * * **API restriction** — enable *Maps JavaScript API* and nothing else. The
   *   Geocoding API must stay off, so this key cannot be used to bill
   *   server-side lookups.
   * * **HTTP referrer restriction** — the storefront's own origins
   *   (`https://starkupps.in`, `https://starkupps.com`, and `www.`/preview
   *   hosts). Requests from anywhere else are refused by Google.
   *
   * Which is why reverse-geocoding does **not** run here: that goes through the
   * gateway with the server-side `GOOGLE_MAPS_API_KEY`, so no key capable of
   * geocoding ever reaches a customer.
   *
   * Absent ⇒ the address field and "use my current location" still work; only
   * the map and its draggable pin are hidden.
   */
  googleMapsApiKey: readEnv("VITE_GOOGLE_MAPS_API_KEY"),
  /** Optional Cloud-based map styling id. */
  googleMapsMapId: readEnv("VITE_GOOGLE_MAPS_MAP_ID"),
} as const;

/** `true` when a map can be drawn. The delivery flow never depends on this. */
export const isMapsEnabled = Boolean(ENV.googleMapsApiKey);

/** `true` when both Supabase values are present, i.e. auth/realtime can run. */
export const isSupabaseConfigured = Boolean(ENV.supabaseUrl && ENV.supabaseAnonKey);

/** Base URL with any trailing slash removed. Empty string means "same origin". */
export const apiBaseUrl = ENV.apiUrl.replace(/\/+$/, "");

/** REST base for the public, customer-facing gateway endpoints. */
export const publicApiBase = `${apiBaseUrl}/api/public`;

/** tRPC base, used only as a fallback when a REST route is unavailable. */
export const trpcApiBase = `${apiBaseUrl}/api/trpc`;

function readEnv(key: string): string | undefined {
  // `import.meta.env` must stay a direct member access — Vite's define
  // replacement only matches this exact shape at build time.
  const value = import.meta.env[key as keyof ImportMetaEnv];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
