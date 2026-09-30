import { withCsrfHeader } from "@/api/client";
import { trpc } from "@/api/trpc";
import { installAuthErrorRedirects, queryClient } from "@/app/query-client";
import { AuthProvider } from "@/state/auth-provider";
import { QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";

import App from "./app/App";
import "./styles.css";

/**
 * The tRPC link is the only place that talks to the gateway for data, so the
 * session cookie, the CSRF token and the superjson transformer are configured
 * exactly once.
 */
const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
          headers: withCsrfHeader(init?.method, init?.headers),
        });
      },
    }),
  ],
});

installAuthErrorRedirects();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element — check index.html");
}

createRoot(container).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
