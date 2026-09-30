import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../shared/supabase.types";
import { ENV } from "../config/env";
import WS from "ws";

// Polyfill WebSocket for Node 20 (Supabase Realtime requires it)
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = WS;
}

let adminClient: SupabaseClient<Database> | null = null;

export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  const url = ENV.supabaseUrl;
  const key = ENV.supabaseServiceRoleKey;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  adminClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

// Raw postgres (for transactions / complex joins) — uses same pooled URL as before
let sqlInstance: any = null;
export async function getSql() {
  if (sqlInstance) return sqlInstance;
  const url = ENV.databaseUrl;
  if (!url) throw new Error("DATABASE_URL missing");
  const postgres = (await import("postgres")).default;
  sqlInstance = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: ENV.isProduction ? "require" : undefined,
    prepare: false,
  });
  return sqlInstance;
}

/**
 * Open the pooler connection at boot rather than on the first request.
 *
 * Measured from a cold start: the first pooled statement took ~7s and the first
 * PostgREST call took ~49s (DNS + TLS + PostgREST schema-cache warm-up). Paying
 * that on the login path — or, worse, on the per-request user lookup, which has
 * no timeout at all — makes the panel unusable for the first minute after every
 * deploy. Warming here moves the cost into startup, where it is invisible.
 */
export async function warmDatabase(): Promise<void> {
  try {
    const sql = await getSql();
    await sql.unsafe("SELECT 1");
    // Touch PostgREST too, so its schema cache is hot before the first user.
    const supabase = getSupabaseAdmin();
    await Promise.race([
      supabase.from("users").select("id").limit(1),
      new Promise(r => setTimeout(r, 8000)),
    ]).catch(() => {});
    console.log("[db] connection pool warmed");
  } catch (e: any) {
    // Non-fatal: the app still starts and each request falls back as needed.
    console.warn("[db] warm-up skipped:", e?.message ?? e);
  }
}
