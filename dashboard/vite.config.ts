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
 *
 * `appType: "spa"` below handles the same thing via Vite's built-in middleware;
 * this plugin is a belt-and-suspenders fallback in case plugin ordering matters.
 */
function spaFallback(): Plugin {
  return {
    name: "spa-fallback",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "/";
        // Only rewrite GET browser-navigation requests:
        //  • not an API call (/api/*)
        //  • not a Vite internal request (@vite, @fs, __vite*)
        //  • not a static asset (has a file extension)
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
  // Mirrors `not_found_handling = "single-page-application"` in wrangler.toml.
  appType: "spa",
  plugins: [
    spaFallback(),
    cloudflare(),
    tanstackRouter({ routesDirectory: "./src/routes", generatedRouteTree: "./src/routeTree.gen.ts", target: "react" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy all auth API calls through Vite in dev — eliminates CORS and
      // cross-origin redirect issues entirely. The browser sees one origin.
      // Use 127.0.0.1 explicitly — wrangler binds there, and on
      // Windows 'localhost' may resolve to ::1 (IPv6) instead.
      // ⚠️  Use "/api/" (with trailing slash) — NOT "/api" — otherwise Vite
      //    prefix-matches "/api-keys" and proxies the dashboard route to the
      //    auth server, causing a 404 on direct navigation.
      "/api/": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});

