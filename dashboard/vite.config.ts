import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackRouter({ routesDirectory: "./src/routes", generatedRouteTree: "./src/routeTree.gen.ts", target: "react" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    port: 5174,
    proxy: {
      // Proxy all auth API calls through Vite in dev — eliminates CORS and
      // cross-origin redirect issues entirely. The browser sees one origin.
      // Use 127.0.0.1 explicitly — wrangler binds there, and on
      // Windows 'localhost' may resolve to ::1 (IPv6) instead.
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
