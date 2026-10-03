import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const sharedDir = fileURLToPath(new URL("./shared", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": srcDir,
      "@shared": sharedDir,
    },
  },
  test: {
    environment: "node",
    // `shared/` is included because it is not just constants: it holds the
    // services-merge and order-status logic that the fulfillment panel and the
    // status endpoint both depend on, and untested that is how a regression in
    // either would reach production.
    include: [
      "server/**/*.test.ts",
      "shared/**/*.test.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
    // DB-backed integration tests open a pooled connection, which can take a
    // few seconds on a cold start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
