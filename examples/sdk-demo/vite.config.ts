import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      // Proxy /api/auth/* to the Wrangler dev server so we avoid CORS issues
      // while testing locally. The auth server runs on :8787 by default.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
