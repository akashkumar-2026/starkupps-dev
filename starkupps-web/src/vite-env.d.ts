/// <reference types="vite/client" />

/**
 * Client-exposed environment variables.
 *
 * Only variables prefixed with `VITE_` are available to application code, and
 * every one of them is inlined into the public bundle. Never place a secret
 * here.
 */
interface ImportMetaEnv {
  /** Base URL of the StarKupps Admin gateway (REST + tRPC). Empty ⇒ same-origin. */
  readonly VITE_API_URL?: string;
  /** Legacy alias for `VITE_API_URL`. */
  readonly VITE_ADMIN_URL?: string;
  /** Supabase project URL powering auth and realtime menu sync. */
  readonly VITE_SUPABASE_URL?: string;
  /** Supabase public anon key. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Supabase publishable key — an accepted alias for the anon key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Dev server port override. */
  readonly VITE_PORT?: string;
  /** `vite preview` port override. */
  readonly VITE_PREVIEW_PORT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
