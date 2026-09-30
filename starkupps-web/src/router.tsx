import { createRouter } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";

import { queryClient } from "./app/query-client";
import { NotFound, RouteError } from "./app/route-errors";
import { routeTree } from "./routeTree.gen";

export type RouterContext = { queryClient: QueryClient };

export function getRouter() {
  return createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    defaultNotFoundComponent: NotFound,
    defaultErrorComponent: RouteError,
    // Prefetch on hover/focus so navigation feels instant.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
