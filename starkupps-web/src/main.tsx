/**
 * Vite entry point.
 *
 * Mounts the router into `index.html`. Static document metadata lives in
 * `index.html`; per-route metadata is declared by each route via `PageMeta`.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import { getRouter } from "./router";
import { reportError } from "./utils/errors";
import "./styles.css";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Mount point #root is missing from index.html");
}

// Surface anything that escapes React's error boundaries.
window.addEventListener("unhandledrejection", (event) => {
  reportError(event.reason, { source: "unhandledrejection" }, "error");
});

createRoot(container).render(
  <StrictMode>
    <RouterProvider router={getRouter()} />
  </StrictMode>,
);
