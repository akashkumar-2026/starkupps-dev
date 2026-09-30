/**
 * Supabase client factory.
 *
 * A single client instance is shared by authentication and realtime. Creating
 * two clients (one for auth, one for realtime) would open two WebSocket pools
 * and two independent auth-state channels for the same tab.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ENV, isSupabaseConfigured } from "@/config/env";

export const AUTH_STORAGE_KEY = "starkupps-web-auth";

let client: SupabaseClient | null | undefined;

/**
 * Returns the shared Supabase client, or `null` when the build has no Supabase
 * configuration. Callers treat `null` as "auth and live sync are unavailable"
 * and degrade to fetch-only behaviour rather than throwing.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  if (!isSupabaseConfigured) {
    console.warn(
      "[supabase] Skipping client — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local.",
    );
    client = null;
    return client;
  }

  try {
    client = createClient(ENV.supabaseUrl, ENV.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_STORAGE_KEY,
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  } catch (error) {
    console.warn("[supabase] Client creation failed — realtime and auth are disabled:", error);
    client = null;
  }

  return client;
}
