/**
 * Minimal typed fetch wrapper for the StarKupps Admin gateway.
 *
 * Responsibilities kept here so no call site repeats them: request timeouts,
 * JSON parsing, error normalisation and cache-header policy.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  /**
   * Server-supplied machine-readable reason, when the response carried one.
   *
   * Lives on the base error rather than only on the tRPC subclass because REST
   * is the primary transport for every public endpoint, and it forwards
   * `domainCode` too (see `sendTrpcError` in the admin gateway). Keeping it here
   * means `domainCodeOf` reads one field regardless of transport.
   */
  readonly domainCode: string | undefined;

  constructor(message: string, status: number, path: string, domainCode?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.domainCode = domainCode;
  }

  /** `true` when the endpoint does not exist, so a caller may try a fallback. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  /**
   * `true` sends `Cache-Control: no-cache`, forcing revalidation.
   * Leave unset to let the browser honour the endpoint's own caching.
   */
  noCache?: boolean;
  timeoutMs?: number | undefined;
  signal?: AbortSignal | undefined;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const POST_TIMEOUT_MS = 12_000;

/** Methods that cannot change server state, and so need no CSRF token. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Cookie name of the gateway's double-submit CSRF token.
 *
 * Mirrors `server/auth/cookies.ts` and the Admin panel's `src/api/client.ts`.
 * The optional `__Host-` prefix is included because that is the name used
 * whenever `SECURE_COOKIES` is on, i.e. in production.
 */
const CSRF_COOKIE = /(?:^|;\s*)(?:__Host-)?app_session_id_csrf=([^;]*)/;

/**
 * Reads the double-submit CSRF token from the JS-readable cookie.
 *
 * ## Why the storefront needs this at all
 *
 * The gateway's CSRF guard triggers on the *presence* of an `app_session_id`
 * cookie, not on whether the request is an authenticated one:
 *
 * ```ts
 * const hasSession = req.headers.cookie && /app_session_id|pos_session_id/.test(...)
 * if (!hasSession) return next();          // public/guest traffic is exempt
 * ```
 *
 * Those cookies are set by the Admin panel login, and cookies ignore ports. So
 * a browser with the Admin panel signed in on `localhost:5175` also carries
 * `app_session_id` when it loads the storefront on `localhost:5174` — which put
 * every guest checkout into the CSRF branch and rejected it with
 * `403 CSRF check failed`, even though no admin session was involved. The token
 * is not readable cross-origin in production (the storefront is on Vercel, the
 * gateway on Cloud Run), so this only bites in local development.
 *
 * Echoing the token is what makes the guard pass, and it is safe by
 * construction: the cookie is deliberately not `httpOnly` so this client can
 * read it, and a cross-site attacker can make a browser *send* the cookie but
 * cannot read it to set the header — so a forged request still has no header and
 * is still rejected.
 */
export function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(CSRF_COOKIE);
  // An empty capture still counts as "no token": a blank header would fail the
  // gateway's comparison just as surely as a missing one.
  const value = match?.[1];
  return value ? decodeURIComponent(value) : null;
}

/**
 * Adds the CSRF header when the request can change state.
 *
 * Exported because `src/api/public.ts` has a tRPC fallback path that calls
 * `fetch` directly and would otherwise bypass this.
 */
export function withCsrfHeader(
  method: string | undefined,
  existing: Record<string, string>,
): Record<string, string> {
  const verb = String(method ?? "GET").toUpperCase();
  if (SAFE_METHODS.has(verb)) return existing;
  const token = readCsrfToken();
  if (!token) return existing;
  return { ...existing, "x-csrf-token": token };
}

/** Message and machine-readable code extracted from a gateway JSON body. */
type ErrorBody = { message: string; domainCode?: string | undefined };

/**
 * Reads `error`/`message` and `domainCode` out of a failure body.
 *
 * The gateway forwards `domainCode` on its REST routes (`sendTrpcError` in the
 * admin server) as well as on tRPC. Carrying it here matters because REST is the
 * *primary* transport for every public endpoint: without it, `classifyOrderError`
 * had no code to work with on the normal path and fell back to regex-matching
 * English prose, which is what misreported a rejected delivery address as
 * "Some items are unavailable at this outlet."
 *
 * Only `domainCode` is passed through when it is a string; an unexpected shape
 * yields `undefined` so callers take their documented fallback rather than
 * trusting a value the server never promised.
 */
async function extractError(response: Response, fallback: string): Promise<ErrorBody> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate = record["error"] ?? record["message"];
    const code = record["domainCode"];
    return {
      message: typeof candidate === "string" && candidate.length > 0 ? candidate : fallback,
      domainCode: typeof code === "string" && code ? code : undefined,
    };
  }
  return { message: fallback };
}

export async function apiRequest<T>(
  url: string,
  { method = "GET", body, noCache = false, timeoutMs, signal }: RequestOptions = {},
): Promise<T> {
  const timeout = timeoutMs ?? (method === "GET" ? DEFAULT_TIMEOUT_MS : POST_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // Caller-supplied cancellation composes with the timeout.
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);

  try {
    let headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (noCache) headers["Cache-Control"] = "no-cache";
    // Applied last so it can never be dropped by an earlier assignment, and
    // before the fetch so every state-changing call carries it.
    headers = withCsrfHeader(method, headers);

    const response = await fetch(url, {
      method,
      headers,
      // Cookies let the gateway vary the response by signed-in customer.
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const { message, domainCode } = await extractError(
        response,
        `${method} ${url} failed: ${response.status}`,
      );
      throw new ApiError(message, response.status, url, domainCode);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(`Request to ${url} timed out after ${timeout}ms`, 408, url);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/** GET that forces revalidation — use for transactional data such as the menu. */
export function apiGet<T>(url: string, options: Omit<RequestOptions, "method" | "body"> = {}) {
  return apiRequest<T>(url, { ...options, method: "GET" });
}

/**
 * GET that lets the browser honour the endpoint's own `Cache-Control`.
 *
 * Use for rate-limited editorial feeds: sending `no-cache` on every page load
 * burns the endpoint's request budget and, behind carrier-grade NAT where many
 * visitors share one IP, silently empties the section for everyone.
 */
export function apiGetCached<T>(
  url: string,
  options: Omit<RequestOptions, "method" | "body"> = {},
) {
  return apiGet<T>(url, options);
}

export function apiPost<T>(
  url: string,
  body: unknown,
  options: Omit<RequestOptions, "method" | "body"> = {},
) {
  return apiRequest<T>(url, { ...options, method: "POST", body });
}
