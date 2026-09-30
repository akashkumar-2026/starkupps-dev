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
} as const;

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
