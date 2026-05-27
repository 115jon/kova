import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react()],
    server: {
      port: 5180,
      // The SDK demo makes API calls to VITE_AUTH_URL (https://auth.lvh.me in dev,
      // https://auth.115jon.site in prod). No proxy needed — the full auth URL is
      // passed explicitly. CORS is handled by the kova-auth server's corsMiddleware.
      //
      // If you need to test without Caddy, set VITE_AUTH_URL=http://localhost:5174
      // and un-comment the proxy block below.
      //
      // proxy: {
      //   "/api": {
      //     target: "http://localhost:5174",
      //     changeOrigin: true,
      //     secure: false,
      //   },
      // },
    },
    define: {
      // Make the auth URL available for any runtime checks
      __AUTH_URL__: JSON.stringify(env.VITE_AUTH_URL ?? ""),
    },
  };
});
