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
    cloudflare(),
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
    // cors: false — CRITICAL for cross-origin SDK consumers (e.g. sdk-demo at :5180).
    //
    // By default Vite intercepts OPTIONS preflight requests and responds with its
    // own CORS headers (Access-Control-Allow-Origin: *, no credentials support).
    // This causes cross-origin credentialed requests from the SDK to fail with:
    //   "Access-Control-Allow-Credentials: ''" must be "true"
    //
    // Setting cors: false passes OPTIONS through to the Hono worker, which has
    // its own corsMiddleware() that returns per-origin credentialed CORS headers
    // (including the response to preflight with Allow-Credentials: true).
    cors: false,
    allowedHosts: [
      "auth.lvh.me",
      ".auth.lvh.me",   // wildcard: any {slug}.auth.lvh.me
      "auth.localhost",
      ".auth.localhost", // wildcard: any {slug}.auth.localhost
    ],
  },
});
