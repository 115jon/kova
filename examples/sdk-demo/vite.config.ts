import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      // Proxy /api/* to the combined auth+dashboard worker (Vite + Miniflare).
      // The combined dev server runs on :5174; standalone wrangler dev is no longer used.
      "/api": {
        target: "http://localhost:5174",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
