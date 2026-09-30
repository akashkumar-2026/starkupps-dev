/**
 * Constants shared by the browser and the gateway.
 *
 * Anything here is part of a wire contract: cookie names appear in both a
 * `Set-Cookie` header and a `document.cookie` read, and the auth messages are
 * matched by string in the client's redirect logic. Change one and you change
 * both sides.
 */

export const COOKIE_NAME = "app_session_id";
export const POS_COOKIE_NAME = "pos_session_id";

// Session audience values, bound into the JWT `aud` claim for Admin/POS
// isolation. The backend is the authority: never trust a client-supplied role.
export const AUD_ADMIN = "admin" as const;
export const AUD_POS = "pos" as const;

// Auth failures, as surfaced to the user. AUTH_REQUIRED_MSG in particular is
// matched literally in src/api/session.ts to decide whether a tRPC error should
// trigger a redirect, so changing it silently breaks the sign-out flow.
export const AUTH_REQUIRED_MSG = "Please sign in to continue.";
export const SESSION_REVOKED_MSG =
  "Your session was revoked. Please sign in again.";
export const AUTH_UNAVAILABLE_MSG =
  "Auth temporarily unavailable. Please retry.";
export const SESSION_EXPIRED_MSG =
  "Your session has expired. Please sign in again.";
export const SUSPENDED_MSG =
  "Your account has been suspended. Contact an administrator.";
export const UNAUTHORIZED_MSG =
  "Your account is not authorized to access the StarKupps Operations Panel.";
export const GENERIC_AUTH_MSG = "Invalid email or password.";
export const RATE_LIMIT_MSG = "Too many attempts. Please try again later.";
