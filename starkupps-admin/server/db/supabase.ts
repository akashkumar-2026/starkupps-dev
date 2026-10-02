import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../shared/supabase.types";
import { ENV } from "../config/env";
import { nodeFetch, ResilientWebSocket } from "./net";

// Polyfill WebSocket for Node 20 (Supabase Realtime requires it). The subclass
// resolves IPv4-first and reuses keep-alive sockets — see ./net.ts for why.
if (typeof (globalThis as any).WebSocket === "undefined") {
  (globalThis as any).WebSocket = ResilientWebSocket;
}

let adminClient: SupabaseClient<Database> | null = null;

/**
 * The single service-role Supabase client.
 *
 * A module-level singleton: auth state, realtime socket and connection pool are
 * all shared, so per-request work never re-resolves DNS or re-handshakes TLS.
 */
export function getSupabaseAdmin(): SupabaseClient<Database> {
  if (adminClient) return adminClient;
  const url = ENV.supabaseUrl;
  const key = ENV.supabaseServiceRoleKey;
  if (!url || !key)
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  adminClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Route PostgREST through the IPv4-first keep-alive transport.
    global: { fetch: nodeFetch },
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
 * Also pins the first PostgREST round-trip so its cost lands in startup rather
 * than on the login path. The 8 s race is generous now that the transport
 * resolves in milliseconds; it only exists so a dead database cannot block boot.
 */
export async function warmDatabase(): Promise<void> {
  try {
    const sql = await getSql();
    await sql.unsafe("SELECT 1");
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

/** Close pooled sockets. Used by tests and graceful shutdown. */
export async function closeDatabase(): Promise<void> {
  if (sqlInstance) {
    try {
      await sqlInstance.end({ timeout: 5 });
    } catch {
      /* already closed */
    }
    sqlInstance = null;
  }
  if (adminClient) {
    try {
      await adminClient.realtime.disconnect();
    } catch {
      /* never connected */
    }
    adminClient = null;
  }
}
