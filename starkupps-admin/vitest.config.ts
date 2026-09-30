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
    include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    // DB-backed integration tests open a pooled connection, which can take a
    // few seconds on a cold start.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
