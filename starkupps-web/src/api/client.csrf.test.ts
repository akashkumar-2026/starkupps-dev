import { afterEach, describe, expect, it } from "vitest";

import { readCsrfToken, withCsrfHeader } from "./client";

/**
 * The bug this guards against.
 *
 * The gateway's CSRF guard triggers on the *presence* of an `app_session_id`
 * cookie, not on whether the request is authenticated:
 *
 * ```ts
 * const hasSession = req.headers.cookie && /app_session_id|pos_session_id/.test(...)
 * if (!hasSession) return next();          // guest traffic is exempt
 * ```
 *
 * That cookie is set by the Admin panel login, and **cookies ignore ports**. So a
 * browser with the Admin signed in on `localhost:5175` also carried
 * `app_session_id` when loading the storefront on `localhost:5174`, putting every
 * guest checkout into the CSRF branch. The order was rejected with
 * `403 CSRF check failed` and the customer saw "Order failed / CSRF check failed".
 *
 * Reproduced against the live gateway before the fix:
 *   POST with `app_session_id` only          → 403 CSRF check failed
 *   POST with `app_session_id` + header      → 400 (reached the order logic)
 */
/**
 * The project runs vitest with `environment: "node"` and has no jsdom, so
 * `document` does not exist. A minimal cookie holder is defined here instead —
 * the production code only ever touches `document.cookie`, and stubbing that
 * single property is enough to exercise it.
 */
function setCookie(jar: string) {
  Object.defineProperty(globalThis, "document", {
    value: { cookie: jar },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("readCsrfToken", () => {
  it("reads the token the gateway set", () => {
    setCookie("app_session_id=abc; app_session_id_csrf=tok123");
    expect(readCsrfToken()).toBe("tok123");
  });

  it("reads the __Host- prefixed name used when SECURE_COOKIES is on", () => {
    // Production sets `__Host-app_session_id_csrf`. Matching only the bare name
    // would fix local dev and leave production broken.
    setCookie("__Host-app_session_id=abc; __Host-app_session_id_csrf=tok456");
    expect(readCsrfToken()).toBe("tok456");
  });

  it("does not mistake the session cookie for the CSRF cookie", () => {
    // `app_session_id` is a prefix of `app_session_id_csrf`; a sloppy match would
    // echo the *session token* as the header and fail verification.
    setCookie("app_session_id=SESSION_TOKEN_VALUE");
    expect(readCsrfToken()).toBeNull();
  });

  it("returns null when the browser has no CSRF cookie", () => {
    // The guest-only case, which must keep working with no header at all.
    setCookie("");
    expect(readCsrfToken()).toBeNull();
    setCookie("some_other_cookie=1");
    expect(readCsrfToken()).toBeNull();
  });

  it("treats an empty value as absent rather than sending a blank header", () => {
    setCookie("app_session_id_csrf=");
    expect(readCsrfToken()).toBeNull();
  });

  it("decodes percent-encoding from the cookie jar", () => {
    // Cookies are stored encoded; the token is base64url and can carry `%`.
    setCookie("app_session_id_csrf=a%2Bb%2Bc");
    expect(readCsrfToken()).toBe("a+b+c");
  });
});

describe("withCsrfHeader", () => {
  it("adds the header to a state-changing request", () => {
    setCookie("app_session_id_csrf=tok789");
    expect(withCsrfHeader("POST", { "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
      "x-csrf-token": "tok789",
    });
  });

  it("leaves safe methods untouched", () => {
    setCookie("app_session_id_csrf=tok789");
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(withCsrfHeader(method, {})).toEqual({});
    }
  });

  it("is case-insensitive about the method", () => {
    setCookie("app_session_id_csrf=tok789");
    expect(withCsrfHeader("post", {})).toMatchObject({ "x-csrf-token": "tok789" });
  });

  it("omits the header when there is no token, leaving the origin check to work", () => {
    // The gateway's fallback for a session with no CSRF cookie is the origin
    // check, which is correct. Sending a fabricated blank header would only turn
    // a passing request into a 403.
    setCookie("");
    expect(withCsrfHeader("POST", { "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("never mutates the caller's header object", () => {
    setCookie("app_session_id_csrf=tok789");
    const original = { "Content-Type": "application/json" };
    withCsrfHeader("POST", original);
    expect(original).toEqual({ "Content-Type": "application/json" });
  });

  it("preserves existing headers", () => {
    setCookie("app_session_id_csrf=tok789");
    const result = withCsrfHeader("POST", {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
    });
    expect(result).toMatchObject({
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-csrf-token": "tok789",
    });
  });
});
