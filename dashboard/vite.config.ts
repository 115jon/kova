import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

/**
 * SPA history-API fallback for dev.
 *
 * The Cloudflare Vite plugin serves Workers Assets but doesn't honour
 * wrangler.toml `not_found_handling = "single-page-application"` in dev mode.
 * This plugin intercepts GET navigation requests (no file extension, not /api)
 * and rewrites them to /index.html so TanStack Router can take over.
 */
function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "/";
        const isNavigation =
          !url.startsWith("/api/") &&
          !url.startsWith("/@") &&
          !url.startsWith("/__") &&
          !url.includes(".");
        if (isNavigation) {
          req.url = "/index.html";
        }
        next();
      });
    },
  };
}

export default defineConfig({
  // Tell Vite this is an SPA — enables its own history-API fallback middleware.
  appType: "spa",
  plugins: [
    spaFallback(),
    // Point the Cloudflare plugin at the server workspace wrangler.toml.
    // In dev mode this runs the Hono worker inside Vite's dev server via
    // Miniflare — all /api/* hits go directly to the worker, no proxy needed.
    // In production `vite build` emits the SPA to dist/client/ which wrangler
    // picks up via [assets] directory = "../dashboard/dist/client".
    cloudflare({ configPath: "../server/wrangler.toml" }),
    tanstackRouter({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
      target: "react",
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 5174,
    // No proxy needed — @cloudflare/vite-plugin runs the worker in-process.
    // API calls from the browser hit the same dev server origin (:5174).
  },
});
