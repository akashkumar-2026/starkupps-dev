import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { COOKIE_NAME } from "@shared/const";
import { ENV } from "../config/env";
import { getAbsoluteLifetimeSec } from "./auth";

// ── Session cookie hardening ────────────────────────────────────────────────
// Cookie policy is derived from SERVER configuration only. It is deliberately
// NOT derived from the request: a previous implementation read
// `X-Forwarded-Proto`, which any client can set, so a plain-HTTP attacker could
// force the session cookie to `SameSite=None; Secure` — i.e. choose the policy
// that removes the browser's cross-site protection. Verified live before the
// fix: one spoofed header flipped the cookie flags.
//
// `SameSite=Lax` is now unconditional. The admin panel is same-origin with
// this API, and the storefront is public (no cookie-authenticated calls), so
// `None` is never required. Lax still permits top-level GET navigation, which
// is all the SPA needs.

const SECURE_COOKIES = ENV.isProduction;

/**
 * `__Host-` prefix is the strongest available cookie hardening: the browser
 * rejects the cookie unless it is Secure, has no `Domain`, and has `Path=/`.
 * It only works over HTTPS, so it is enabled in production only. The server
 * accepts both names when reading (see getSessionCookieNames) so an existing
 * non-prefixed cookie is not orphaned across a deploy.
 */
export const HOST_PREFIX = "__Host-";

export function getSessionCookieName(secure: boolean = SECURE_COOKIES): string {
  return secure ? `${HOST_PREFIX}${COOKIE_NAME}` : COOKIE_NAME;
}

/** Every cookie name that may hold a valid admin session, most-preferred first. */
export function getSessionCookieNames(): string[] {
  return [getSessionCookieName(), COOKIE_NAME];
}

export type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/" | "/api";
  maxAge?: number;
  priority?: "high";
};

/**
 * Cookie attributes for the admin session.
 *
 * `remember === false` → NO `maxAge`, producing a browser session cookie that
 * is discarded when the browser closes.
 * `remember === true`  → `maxAge` of the remember window (default 30 days), so
 *                        the session survives a browser restart.
 *
 * The value is in seconds; `expires` is set alongside it by the caller.
 */
export function getSessionCookieOptions(opts?: {
  remember?: boolean;
  maxAgeSec?: number;
}): SessionCookieOptions {
  const remember = opts?.remember === true;
  const maxAgeSec = opts?.maxAgeSec ?? getAbsoluteLifetimeSec(remember);
  const base: SessionCookieOptions = {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    // Sliding expiry: refresh the persistent cookie's lifetime on each rotation
    // so an actively used "remembered" device does not expire mid-shift.
    maxAge: remember ? maxAgeSec : undefined,
    priority: "high",
  };
  if (!remember) {
    // A session cookie must not carry an expiry at all.
    delete base.maxAge;
  }
  return base;
}

/** Options that must be repeated on clearCookie for the browser to match. */
export function getSessionClearCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
  };
}

export function getCookieName(): string {
  return getSessionCookieName();
}

// ── Refresh token cookie ────────────────────────────────────────────────────
// A second, httpOnly cookie holding the opaque refresh token. Only its SHA-256
// is stored server-side. It is scoped to `/api` so it is not attached to every
// request, and it mirrors the access cookie's persistence: a "remembered"
// device keeps it across browser restarts, a session-only device does not.
//
// The token is never readable by JavaScript and never sent anywhere but this
// origin, so an XSS cannot exfiltrate it directly (it can still ride along on
// same-origin requests, which is why the CSP stays tight).

export const REFRESH_COOKIE_NAME = `${COOKIE_NAME}_refresh`;

export function getRefreshCookieName(): string {
  return SECURE_COOKIES
    ? `${HOST_PREFIX}${REFRESH_COOKIE_NAME}`
    : REFRESH_COOKIE_NAME;
}

export function getRefreshCookieNames(): string[] {
  return [getRefreshCookieName(), REFRESH_COOKIE_NAME];
}

export function getRefreshCookieOptions(opts?: {
  remember?: boolean;
  maxAgeSec?: number;
}) {
  const remember = opts?.remember === true;
  const maxAgeSec = opts?.maxAgeSec ?? getAbsoluteLifetimeSec(remember);
  const base: SessionCookieOptions = {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/api",
    priority: "high",
  };
  if (remember) base.maxAge = maxAgeSec;
  return base;
}

// ── CSRF double-submit token ───────────────────────────────────────────────
// The session cookie alone cannot protect against cross-site state changes, and
// relying only on SameSite + Origin means a browser that omits Origin (or a
// future SameSite relaxation) reopens the hole. A per-session token issued in a
// JS-readable cookie and echoed in a header is the standard defence: a
// cross-site attacker can make the browser send the cookie but cannot read it to
// populate the header.
//
// Deliberately NOT stored server-side: the database already carries a
// `csrf_tokens` table, but a stateless double-submit token validated against the
// session cookie's signature needs no lookup on the hot path and no cleanup job.

export const CSRF_COOKIE_NAME = `${COOKIE_NAME}_csrf`;
export const CSRF_HEADER_NAME = "x-csrf-token";

/** Signed so a token cannot be forged without the session secret. */
export async function createCsrfToken(): Promise<string> {
  const nonce = randomBytes(24).toString("base64url");
  const secret = ENV.sessionSecret;
  if (!secret) return nonce;
  const sig = createHmac("sha256", secret).update(nonce).digest("base64url");
  return `${nonce}.${sig}`;
}

/** Constant-time comparison of a presented token against the expected one. */
export function verifyCsrfToken(
  presented: string | undefined,
  expected: string | undefined
): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function getCsrfCookieName(): string {
  return SECURE_COOKIES
    ? `${HOST_PREFIX}${CSRF_COOKIE_NAME}`
    : CSRF_COOKIE_NAME;
}

/**
 * Readable by JavaScript on purpose — the client must echo it back in a header.
 * `SameSite=Lax` still keeps it off cross-site subrequests.
 */
export function getCsrfCookieOptions(): {
  httpOnly: false;
  secure: boolean;
  sameSite: "lax";
  path: "/";
} {
  return {
    httpOnly: false,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
  };
}

export function getCsrfClearCookieOptions() {
  return getCsrfCookieOptions();
}

export function getRefreshClearCookieOptions() {
  return {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax" as const,
    path: "/api",
  };
}

export function parseCookies(
  cookieHeader: string | undefined
): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

/** Is this request arriving over TLS, as far as we can legitimately tell? */
export function isSecureRequest(req: {
  protocol?: string;
  socket?: { encrypted?: boolean };
  headers?: Record<string, unknown>;
}): boolean {
  if (SECURE_COOKIES) return true;
  if (req.socket?.encrypted) return true;
  // Only believe the proxy header when a proxy is explicitly trusted.
  if (ENV.trustProxy && req.headers?.["x-forwarded-proto"] === "https")
    return true;
  return req.protocol === "https";
}
