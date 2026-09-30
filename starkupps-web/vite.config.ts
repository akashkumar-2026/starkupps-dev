import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  plugins: [
    // Must run before the React plugin so the generated route tree is present.
    tanstackRouter({
      target: "react",
      // Regenerate `src/routeTree.gen.ts` and keep routes lazy-loadable.
      autoCodeSplitting: true,
      routesDirectory: "./src/app/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    tailwindcss(),
    viteReact(),
  ],
  resolve: {
    alias: { "@": srcDir },
    dedupe: ["react", "react-dom", "@tanstack/react-query", "@tanstack/query-core"],
  },
  css: {
    transformer: "lightningcss",
  },
  server: {
    host: true,
    port: Number(process.env["VITE_PORT"] ?? process.env["PORT"] ?? 5173),
    strictPort: false,
    // Lets the app call `/api/public/*` same-origin in dev, avoiding CORS
    // and keeping cookie-based sessions working.
    proxy: {
      "/api": {
        target: process.env["VITE_DEV_API_PROXY"] ?? "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: Number(process.env["PREVIEW_PORT"] ?? process.env["VITE_PREVIEW_PORT"] ?? 4173),
  },
  build: {
    target: "es2022",
    sourcemap: false,
    // Long-lived hashed filenames; index.html must never be cached by a CDN.
    assetsDir: "assets",
    rollupOptions: {
      output: {
        // Split the three heaviest, most stable dependencies so a content-only
        // change does not invalidate the whole vendor payload.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react";
          if (id.includes("@tanstack")) return "tanstack";
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) {
            return "motion";
          }
          return undefined;
        },
      },
    },
  },
});
