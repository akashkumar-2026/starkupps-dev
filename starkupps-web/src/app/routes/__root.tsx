import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";

import { AppProviders } from "@/app/providers";
import { NotFound, RouteError } from "@/app/route-errors";
import type { RouterContext } from "@/router";

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

/**
 * Application shell. Every route renders inside the shared providers, so
 * navigation keeps the session, the selected outlet and the cart intact.
 */
function RootLayout() {
  return (
    <AppProviders>
      <Outlet />
    </AppProviders>
  );
}
