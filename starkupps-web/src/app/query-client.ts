import { QueryClient } from "@tanstack/react-query";

/**
 * Shared query client.
 *
 * Defaults are tuned for a storefront where the menu is transactional (never
 * serve stale prices) and mutations are user-initiated (never retry).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      networkMode: "online",
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
    mutations: {
      // Retrying an order or a payment would double-charge the customer.
      retry: 0,
    },
  },
});
