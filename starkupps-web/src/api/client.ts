/**
 * Minimal typed fetch wrapper for the StarKupps Admin gateway.
 *
 * Responsibilities kept here so no call site repeats them: request timeouts,
 * JSON parsing, error normalisation and cache-header policy.
 */

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
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

/** Error message extracted from a gateway JSON body, when it carries one. */
async function extractMessage(response: Response, fallback: string): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidate = record["error"] ?? record["message"];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return fallback;
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
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (noCache) headers["Cache-Control"] = "no-cache";

    const response = await fetch(url, {
      method,
      headers,
      // Cookies let the gateway vary the response by signed-in customer.
      credentials: "include",
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ApiError(
        await extractMessage(response, `${method} ${url} failed: ${response.status}`),
        response.status,
        url,
      );
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
