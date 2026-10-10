import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/menu")({
  component: MenuLayout,
});

/**
 * Parent layout for the menu hub (`/menu`) and category pages
 * (`/menu/$slug`). Renders nothing itself — children must render, which is
 * why this Outlet exists (a parent without one silently swallows its child
 * routes and shows the hub for every category URL).
 */
function MenuLayout() {
  return <Outlet />;
}
