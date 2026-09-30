/**
 * Browser-side HTTP plumbing shared by everything that talks to the gateway.
 *
 * The gateway authenticates with an httpOnly session cookie and requires a
 * double-submit CSRF token on every state-changing request. Both live in this
 * module so the tRPC link, the auth provider and the SSE bridge cannot drift
 * apart.
 */

/** Methods that cannot change server state, and so need no CSRF token. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cookie name of the double-submit token. Matches `server/auth/cookies.ts`. */
const CSRF_COOKIE = /(?:^|;\s*)(?:__Host-)?app_session_id_csrf=([^;]*)/;

/** Reads the double-submit CSRF token from the JS-readable cookie. */
export function readCsrfToken(): string | null {
  const match = document.cookie.match(CSRF_COOKIE);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Adds the CSRF header when the request can change state. A cross-site
 * attacker can make the browser send the cookie but cannot read it to set the
 * header, so the mismatch rejects the forged request.
 */
export function withCsrfHeader(
  method: string | undefined,
  existing?: HeadersInit
): HeadersInit | undefined {
  const verb = String(method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(verb)) return existing;
  const token = readCsrfToken();
  if (!token) return existing;
  const headers = new Headers(existing ?? {});
  headers.set("x-csrf-token", token);
  return headers;
}

/** Headers for a hand-rolled `fetch` that bypasses the tRPC link. */
export function csrfHeaders(): Record<string, string> {
  const token = readCsrfToken();
  return token ? { "x-csrf-token": token } : {};
}
