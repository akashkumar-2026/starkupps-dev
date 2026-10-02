/**
 * Public customer-facing gateway endpoints.
 *
 * REST (`/api/public/*`) is the primary contract; the tRPC router
 * (`public.*`) is a fallback for deployments that have not exposed a given REST
 * route yet. Both paths return the same shapes.
 */
import superjson from "superjson";

import { apiGet, apiGetCached, apiPost, ApiError } from "./client";
import { publicApiBase, trpcApiBase } from "@/config/env";
import type {
  CouponValidation,
  CouponValidationInput,
  CreateOrderInput,
  CreatedOrder,
  OrderTrackToken,
  PublicInstagramFeed,
  PublicMenu,
  PublicOutlet,
  PublicReview,
  PublicSiteSettings,
} from "@/types";
import type { ChargeQuote, ApiOrderType } from "@/types/orders";

// ── tRPC fallback ────────────────────────────────────────────────────────────

/**
 * Run the REST call, falling back to tRPC only when the route does not exist.
 *
 * A network failure or a 5xx must propagate — silently retrying a mutation over
 * a different transport risks a duplicate order. Only a 404 is treated as
 * "this gateway has no such route".
 */
async function withFallback<T>(rest: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await rest();
  } catch (error) {
    if (error instanceof ApiError && error.isNotFound) return fallback();
    throw error;
  }
}

/** REST GET with a tRPC GET fallback. */
function queryWithFallback<T>(
  path: string,
  procedure: string,
  input: unknown,
  signal?: AbortSignal,
) {
  return withFallback(
    () => apiGet<T>(`${publicApiBase}${path}`, { noCache: true, signal }),
    () => trpcQuery<T>(procedure, input),
  );
}

function trpcUrl(procedure: string, input?: unknown): string {
  if (input === undefined) return `${trpcApiBase}/${procedure}`;
  return `${trpcApiBase}/${procedure}?input=${encodeURIComponent(superjson.stringify(input))}`;
}

async function trpcQuery<T>(procedure: string, input?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(trpcUrl(procedure, input), {
    credentials: "include",
    signal: signal ?? null,
  });
  if (!response.ok) {
    throw new ApiError(`tRPC ${procedure} failed: ${response.status}`, response.status, procedure);
  }
  return unwrapTrpc<T>(await response.json(), procedure);
}

/** tRPC mutation. Keeps the payload in the body so PII stays out of the URL. */
async function trpcPost<T>(procedure: string, input: unknown): Promise<T> {
  const response = await fetch(`${trpcApiBase}/${procedure}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(superjson.serialize(input)),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(
      text || `tRPC ${procedure} failed: ${response.status}`,
      response.status,
      procedure,
    );
  }
  return unwrapTrpc<T>(await response.json(), procedure);
}

async function unwrapTrpc<T>(payload: unknown, procedure: string): Promise<T> {
  const result = (payload as { result?: { data?: unknown } } | null)?.result;
  const data = result?.data;
  if (data === undefined) throw new ApiError(`tRPC ${procedure} returned no data`, 502, procedure);
  return superjson.deserialize(data as Parameters<typeof superjson.deserialize>[0]) as T;
}

// ── Endpoints ───────────────────────────────────────────────────────────────

export function fetchOutlets(signal?: AbortSignal): Promise<PublicOutlet[]> {
  return queryWithFallback<PublicOutlet[]>("/outlets", "public.outlets.list", {}, signal);
}

export function fetchMenu(outletId?: number | null, signal?: AbortSignal): Promise<PublicMenu> {
  const query = outletId ? `?outletId=${outletId}` : "";
  return queryWithFallback<PublicMenu>(
    `/menu${query}`,
    "public.menu.list",
    { outletId: outletId ?? undefined },
    signal,
  );
}

/**
 * Storefront business facts: contact details, hours, FSSAI licence, hero copy,
 * the stats strip, the trust claims and gallery images.
 *
 * Served from `public.site_settings` by the gateway, which is what makes them
 * editable from the admin panel instead of being compiled into this bundle.
 */
export function fetchSiteSettings(signal?: AbortSignal): Promise<PublicSiteSettings> {
  return queryWithFallback<PublicSiteSettings>("/site", "public.site", {}, signal);
}

/** Customer reviews, from `public.testimonials` (Admin > Content > Testimonials). */
export function fetchReviews(signal?: AbortSignal): Promise<PublicReview[]> {
  return queryWithFallback<PublicReview[]>("/reviews", "public.reviews", {}, signal);
}

export function fetchInstagram(signal?: AbortSignal): Promise<PublicInstagramFeed> {
  // Not transactional: honour the endpoint's own caching to protect its budget.
  return withFallback(
    () => apiGetCached<PublicInstagramFeed>(`${publicApiBase}/instagram`, { signal }),
    () => trpcQuery<PublicInstagramFeed>("public.instagram", {}),
  );
}

export function fetchInstagramThumbnails(
  shortcodes: string[],
  signal?: AbortSignal,
): Promise<Record<string, string | null>> {
  return trpcQuery("public.instagramThumbnails", { shortcodes }, signal);
}

export function validateCoupon(input: CouponValidationInput): Promise<CouponValidation> {
  return withFallback(
    () => apiPost<CouponValidation>(`${publicApiBase}/coupons/validate`, input),
    () => trpcPost<CouponValidation>("public.coupons.validate", input),
  );
}

export function createPublicOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  return withFallback(
    () => apiPost<CreatedOrder>(`${publicApiBase}/orders`, input),
    () => trpcPost<CreatedOrder>("public.orders.create", input),
  );
}

export function fetchOrderStatus<T>(id: number, phone?: string): Promise<T> {
  return trpcQuery<T>("public.orders.byId", { id, phone });
}

export function fetchCharges(
  outletId: number,
  type: ApiOrderType,
  taxable: number,
): Promise<ChargeQuote> {
  const query = `?outletId=${outletId}&type=${type}&taxable=${taxable}`;
  return queryWithFallback<ChargeQuote>(`/charges${query}`, "public.settings.charges", {
    outletId,
    type,
    taxable,
  });
}

/** Exchange an order id + phone for a short-lived SSE tracking token. */
export function requestTrackToken(id: number, phone: string): Promise<OrderTrackToken> {
  // POST, never a query string — the phone number must stay out of access logs.
  return withFallback(
    () => apiPost<OrderTrackToken>(`${publicApiBase}/orders/track-token`, { id, phone }),
    () => trpcPost<OrderTrackToken>("public.orders.trackToken", { id, phone }),
  );
}

/** Server-sent-events endpoint for live order tracking. */
export function orderStreamUrl(token: string): string {
  return `${publicApiBase}/orders/stream?token=${encodeURIComponent(token)}`;
}
