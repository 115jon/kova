import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const HOSTED_AUTH_ENTRY = "/src/web/hosted/hosted-auth-entry.ts";

function hostedAuthDevAsset(): Plugin {
  return {
    name: "kova-hosted-auth-dev-asset",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url
          ? new URL(request.url, "http://localhost").pathname
          : "";
        if (pathname !== "/assets/hosted-auth.js") {
          next();
          return;
        }

        try {
          const transformed = await server.transformRequest(HOSTED_AUTH_ENTRY);
          if (!transformed) {
            next();
            return;
          }

          response.statusCode = 200;
          response.setHeader("Content-Type", "application/javascript");
          response.setHeader("Cache-Control", "no-cache");
          response.end(transformed.code);
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [
    hostedAuthDevAsset(),
    tailwindcss(),
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tanstackStart({
      router: {
        routesDirectory: "web/routes",
        generatedRouteTree: "web/routeTree.gen.ts",
      },
    }),
    react(),
  ],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src/web") },
  },
  server: {
    port: 5174,
    // Pass preflight requests through to the Hono worker so its credentialed
    // per-origin CORS responses remain authoritative.
    cors: false,
    allowedHosts: [
      "auth.lvh.me",
      ".auth.lvh.me",
      "auth.localhost",
      ".auth.localhost",
      ".115jon.com",
    ],
  },
});
