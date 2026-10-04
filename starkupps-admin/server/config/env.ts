import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Load this package's .env, then the workspace root's, so a shared Supabase
 * access token can live one level up. `quiet` suppresses dotenv's startup
 * banner — a server should not print marketing tips into production logs.
 *
 * Candidates are resolved from `process.cwd()` as well as from this file's own
 * directory, because `npm run build` bundles this module into `dist/index.js`:
 * `import.meta.url` then points at `dist/`, so the two `../../` paths that are
 * correct when running from `server/config/` resolve to the workspace root and
 * one level above it instead. The package's own `.env` was therefore never read
 * by a production build, and startup failed with "SESSION_SECRET is required"
 * even though a perfectly good `.env` sat next to `dist/`.
 *
 * Order matters: the package's own file wins over the workspace root, and an
 * already-set process variable always wins over both (dotenv does not
 * overwrite), so real environment variables in production are untouched.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const candidates = [
  path.resolve(cwd, ".env"),
  path.resolve(here, "../../.env"),
  path.resolve(here, "../../../.env"),
];
for (const file of new Set(candidates)) {
  dotenv.config({ path: file, quiet: true });
}

/**
 * Runtime configuration for the gateway: database, Supabase, sessions and
 * throttling. Every value is validated here, once, rather than at each use
 * site, and startup fails fast in production when something is missing.
 */

function getEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

export const ENV = {
  // Database — Supabase Postgres only (pooler via DATABASE_URL, direct via DIRECT_URL).
  // No local / MySQL / Drizzle fallback. Migrations live in supabase/migrations
  // and are applied with `supabase db push --linked`.
  databaseUrl: getEnv("DATABASE_URL"),
  dbDialect: "postgresql" as const,
  get isPostgres() {
    return true as const;
  },
  get isProduction() {
    return getEnv("NODE_ENV") === "production";
  },

  // Supabase — when using Supabase Postgres
  supabaseUrl: getEnv("SUPABASE_URL"),
  supabaseAnonKey: getEnv("SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: getEnv("SUPABASE_SERVICE_ROLE_KEY"),

  /**
   * Google Geocoding API key — **server-side only, never a `VITE_` variable**.
   *
   * This is the key that stays secret. It is read here and used by
   * `server/lib/geocode.ts` to turn the coordinates from `navigator.geolocation`
   * into a delivery address, so it never reaches the browser bundle and cannot
   * be lifted from the page.
   *
   * It is deliberately a *different* key from the storefront's
   * `VITE_GOOGLE_MAPS_API_KEY`. A browser key is readable by anyone who loads the
   * page, so keeping the two separate means a leaked map key cannot be used to
   * burn the geocoding quota. In Google Cloud Console each should be restricted to
   * its own API (this one: Geocoding API) and this one should also be IP-restricted
   * to the gateway.
   *
   * Absent ⇒ the storefront falls back to Nominatim. See `lib/geocode.ts`.
   */
  googleMapsServerKey: getEnv("GOOGLE_MAPS_API_KEY"),

  // Owner — the initial admin user (by openId/email). Used to grant admin role on first login.
  ownerOpenId: getEnv(
    "OWNER_OPEN_ID",
    getEnv("ADMIN_EMAIL", "admin@starkupps.local")
  )!,
  ownerEmail: getEnv(
    "OWNER_EMAIL",
    getEnv("OWNER_OPEN_ID", "admin@starkupps.local")
  )!,

  // Session — NEVER fallback to dev secret in production
  sessionSecret: (() => {
    const v = getEnv("SESSION_SECRET", getEnv("JWT_SECRET", undefined));
    if (!v || v.trim().length === 0) {
      if (getEnv("NODE_ENV") === "production") {
        throw new Error(
          "SESSION_SECRET is required in production. Generate with: openssl rand -base64 48"
        );
      }
      // Dev-only deterministic fallback — isolated from production
      return "dev-only-session-secret-not-for-production-32-chars-min";
    }
    const trimmed = v.trim();
    // Reject placeholder values
    const weak = [
      "change-me",
      "dev-session-secret",
      "replace-me",
      "your-secret",
      "secret",
    ];
    if (weak.some(w => trimmed.toLowerCase().includes(w))) {
      if (getEnv("NODE_ENV") === "production") {
        throw new Error(
          "SESSION_SECRET contains placeholder value. Generate a strong random secret."
        );
      }
      console.warn(
        "[env] SESSION_SECRET looks like a placeholder — using dev fallback. Set a strong value for production."
      );
      return "dev-only-session-secret-not-for-production-32-chars-min";
    }
    if (trimmed.length < 32) {
      if (getEnv("NODE_ENV") === "production") {
        throw new Error(
          "SESSION_SECRET must be at least 32 characters. Use: openssl rand -base64 48"
        );
      }
      console.warn(
        "[env] SESSION_SECRET too short (<32 chars). Use a stronger secret for production."
      );
    }
    return trimmed;
  })(),
  cookieName: getEnv("COOKIE_NAME", "app_session_id"),

  // App URL
  // Default is the deployed Cloud Run origin. Override with APP_URL for a
  // different deployment or for local development; the https check below
  // depends on this being the public origin, because cookies are Secure.
  appUrl: getEnv(
    "APP_URL",
    getEnv(
      "VITE_APP_URL",
      "https://starkupps-admin-261175458017.asia-northeast2.run.app"
    )
  ),

  // ── Reverse proxy / TLS termination ──────────────────────────────────────
  // Whether the app sits behind a trusted reverse proxy or CDN. Governs which
  // headers may be believed for the client IP and the request scheme.
  //   false (default) — direct connection; X-Forwarded-* headers are IGNORED
  //                      and the socket address is the client.
  //   true             — one trusted hop; X-Forwarded-For/Proto are read.
  // Never enable this unless the proxy overwrites (not appends to) those
  // headers, otherwise clients can spoof their own IP and scheme.
  trustProxy: (() => {
    const v = (getEnv("TRUST_PROXY", "") ?? "").trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") return true;
    if (v === "0" || v === "false" || v === "no" || v === "") return false;
    // A hop count (e.g. TRUST_PROXY=2) enables trust; Express uses the value.
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) return n as unknown as boolean;
    throw new Error(
      `TRUST_PROXY must be a boolean or a positive hop count, got "${v}"`
    );
  })(),
  // Number of proxy hops to trust. Only meaningful when trustProxy is set.
  trustProxyHops: (() => {
    const v = (getEnv("TRUST_PROXY_HOPS", "") ?? "").trim();
    if (!v) return 1;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      throw new Error(`TRUST_PROXY_HOPS must be an integer 1-10, got "${v}"`);
    }
    return n;
  })(),

  // ── Session lifetimes ───────────────────────────────────────────────────
  // Access token (JWT) lifetime. Deliberately short: the access token is the
  // only thing in the cookie, so a short life bounds the damage of a stolen
  // cookie. Long-lived access is provided by the refresh token behind
  // "Remember on this device", never by a long-lived JWT.
  accessTokenSec: (() => {
    const v = Number(getEnv("AUTH_ACCESS_TOKEN_SEC", "") ?? "") || 60 * 60; // 1h
    if (!Number.isFinite(v) || v < 300 || v > 60 * 60 * 24) {
      throw new Error(
        `AUTH_ACCESS_TOKEN_SEC must be between 300 and 86400 seconds, got "${v}"`
      );
    }
    return v;
  })(),
  // Lifetime of a "Remember on this device" session (cookie + refresh token).
  rememberDays: (() => {
    const v = Number(getEnv("AUTH_REMEMBER_DAYS", "") ?? "") || 30;
    if (!Number.isFinite(v) || v < 1 || v > 365) {
      throw new Error(
        `AUTH_REMEMBER_DAYS must be between 1 and 365 days, got "${v}"`
      );
    }
    return v;
  })(),
  // Absolute lifetime of a session-only (non-remembered) device session. The
  // cookie has no Max-Age so the browser drops it on close, but the server-side
  // record still needs a hard ceiling.
  sessionHours: (() => {
    const v = Number(getEnv("AUTH_SESSION_HOURS", "") ?? "") || 12;
    if (!Number.isFinite(v) || v < 1 || v > 24 * 30) {
      throw new Error(
        `AUTH_SESSION_HOURS must be between 1 and 720 hours, got "${v}"`
      );
    }
    return v;
  })(),
  // Idle window: a session that has not been used for this long is dead even if
  // its absolute expiry has not passed.
  idleTimeoutMin: (() => {
    const v = Number(getEnv("AUTH_IDLE_TIMEOUT_MIN", "") ?? "") || 120;
    if (!Number.isFinite(v) || v < 5 || v > 60 * 24 * 30) {
      throw new Error(
        `AUTH_IDLE_TIMEOUT_MIN must be between 5 and 43200 minutes, got "${v}"`
      );
    }
    return v;
  })(),
  // Sensitive actions (password change, role change) require a session
  // re-authenticated within this window, even on a remembered device.
  reauthWindowMin: (() => {
    const v = Number(getEnv("AUTH_REAUTH_WINDOW_MIN", "") ?? "") || 15;
    if (!Number.isFinite(v) || v < 1 || v > 1440) {
      throw new Error(
        `AUTH_REAUTH_WINDOW_MIN must be between 1 and 1440 minutes, got "${v}"`
      );
    }
    return v;
  })(),
  // How often (ms) the in-process janitor prunes expired sessions/tokens.
  cleanupIntervalMs: (() => {
    const v =
      Number(getEnv("AUTH_CLEANUP_INTERVAL_MS", "") ?? "") || 60 * 60 * 1000;
    if (!Number.isFinite(v) || v < 60_000) {
      throw new Error(`AUTH_CLEANUP_INTERVAL_MS must be >= 60000, got "${v}"`);
    }
    return v;
  })(),

  // ── Login throttling ────────────────────────────────────────────────────
  // Attempts are cheap and counted generously; only FAILURES are counted
  // strictly. Counting successes (as the previous implementation did) let a
  // single caller exhaust the limit for every admin behind one IP.
  loginAttemptMax: (() => {
    const v = Number(getEnv("AUTH_LOGIN_ATTEMPT_MAX", "") ?? "") || 30;
    if (!Number.isInteger(v) || v < 5 || v > 1000) {
      throw new Error(
        `AUTH_LOGIN_ATTEMPT_MAX must be an integer 5-1000, got "${v}"`
      );
    }
    return v;
  })(),
  loginFailureMax: (() => {
    const v = Number(getEnv("AUTH_LOGIN_FAILURE_MAX", "") ?? "") || 10;
    if (!Number.isInteger(v) || v < 3 || v > 100) {
      throw new Error(
        `AUTH_LOGIN_FAILURE_MAX must be an integer 3-100, got "${v}"`
      );
    }
    return v;
  })(),
  loginWindowMs: (() => {
    const v = Number(getEnv("AUTH_LOGIN_WINDOW_MIN", "") ?? "") || 15;
    if (!Number.isFinite(v) || v < 1 || v > 1440) {
      throw new Error(
        `AUTH_LOGIN_WINDOW_MIN must be between 1 and 1440 minutes, got "${v}"`
      );
    }
    return v * 60 * 1000;
  })(),

  // Optional S3 for storage
  s3Bucket: getEnv("S3_BUCKET"),
  awsRegion: getEnv("AWS_REGION", "us-east-1"),
} as const;

// ── Startup validation (fail fast in production) ────────────────────────────
if (ENV.isProduction) {
  const missing: string[] = [];
  if (!ENV.databaseUrl) missing.push("DATABASE_URL");
  if (!ENV.supabaseUrl) missing.push("SUPABASE_URL");
  if (!ENV.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  // A weak SESSION_SECRET already throws above; this catches the case where a
  // strong-looking placeholder survived.
  if (ENV.sessionSecret.includes("dev-only-session-secret"))
    missing.push("SESSION_SECRET (dev fallback in use)");
  // Cookies are marked Secure in production; without TLS termination that
  // would silently log everyone out.
  if (ENV.appUrl && !ENV.appUrl.startsWith("https://")) {
    throw new Error(
      "APP_URL must use https:// in production (cookies are issued with the Secure flag)."
    );
  }
  if (missing.length) {
    throw new Error(
      `Invalid production configuration — missing or unsafe: ${missing.join(", ")}`
    );
  }
}
