import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { mockApiPlugin } from "./dev/mock-api";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));
const sharedDir = fileURLToPath(new URL("./shared", import.meta.url));

export default defineConfig(({ mode }) => {
  /**
   * Target for the dev-server proxy. Read from the shell, not from the
   * browser bundle: it is a localhost address, not an app setting.
   */
  const apiTarget =
    process.env["VITE_DEV_API_PROXY"] ?? "http://localhost:3000";

  return {
    // Vite's only HTML document lives at the repository root, next to this file.
    root: fileURLToPath(new URL(".", import.meta.url)),
    publicDir: fileURLToPath(new URL("./public", import.meta.url)),
    envDir: fileURLToPath(new URL(".", import.meta.url)),

    plugins: [react(), tailwindcss(), mockApiPlugin()],

    resolve: {
      alias: {
        "@": srcDir,
        "@shared": sharedDir,
      },
      dedupe: [
        "react",
        "react-dom",
        "@tanstack/react-query",
        "@tanstack/query-core",
      ],
    },

    server: {
      host: true,
      // Vite auto-increments if the port is taken; force it in CI.
      port: Number(process.env["VITE_PORT"] ?? 5173),
      strictPort: Boolean(process.env["VITE_PORT"]),
      // Same-origin /api in dev keeps the session cookie first-party.
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
      },
    },

    preview: {
      host: true,
      port: Number(process.env["VITE_PREVIEW_PORT"] ?? 4173),
      strictPort: false,
    },

    build: {
      target: "es2022",
      sourcemap: mode !== "production",
      // The Express gateway serves this directory as static assets.
      outDir: "dist/public",
      emptyOutDir: true,
      // Vite already warns past 500 kB; the app's heaviest chunk is a chart
      // library, so raise the ceiling rather than have it reported every build.
      chunkSizeWarningLimit: 900,
      assetsDir: "assets",
      rollupOptions: {
        output: {
          // Split the heaviest, most stable dependencies so a content-only
          // change does not invalidate the whole vendor payload.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (
              /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)
            ) {
              return "react";
            }
            if (id.includes("@tanstack") || id.includes("@trpc"))
              return "tanstack";
            if (
              /[\\/]node_modules[\\/](recharts|d3-.*|victory-vendor|internmap|delaunator|robust-predicates)[\\/]/.test(
                id
              )
            ) {
              return "charts";
            }
            if (id.includes("lucide-react")) return "icons";
            return undefined;
          },
        },
      },
    },
  };
});
