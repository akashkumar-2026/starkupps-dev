import { redirectToLoginIfVerified } from "@/api/session";
import { AUTH_REQUIRED_MSG, AUTH_UNAVAILABLE_MSG } from "@shared/const";
import { QueryClient } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";

/**
 * Cache defaults tuned for an operations console: data is treated as fresh for
 * 30s so switching views does not refetch on every mount, while the realtime
 * SSE relay and explicit invalidation still deliver timely updates.
 *
 * Retries are deliberately narrow. A revoked session must never be retried, an
 * unreachable database is worth two attempts, and anything else gets a single
 * retry. Retrying an auth failure only delays the redirect to the login page.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error: unknown) => {
        const message = (error as { message?: string } | null)?.message ?? "";
        const code =
          (error as { data?: { code?: string } } | null)?.data?.code ??
          (error as { code?: string } | null)?.code;
        if (message === AUTH_REQUIRED_MSG || code === "UNAUTHORIZED")
          return false;
        if (message === AUTH_UNAVAILABLE_MSG) return failureCount < 2;
        return failureCount < 1;
      },
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 3000),
    },
  },
});

/**
 * Routes query and mutation failures through one auth check, so a single
 * redirect decision is made per burst no matter how many panels failed. Infra
 * errors are ignored here: the retry policy already handles them.
 */
export function installAuthErrorRedirects(): void {
  queryClient.getQueryCache().subscribe(event => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    const error = event.query.state.error;
    void redirectToLoginIfVerified(error, error instanceof TRPCClientError);
  });

  queryClient.getMutationCache().subscribe(event => {
    if (event.type !== "updated" || event.action.type !== "error") return;
    const error = event.mutation.state.error;
    void redirectToLoginIfVerified(error, error instanceof TRPCClientError);
  });
}
