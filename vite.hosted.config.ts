import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Separate from the TanStack Start build. That plugin owns `dist/client`
 * and will not emit a second HTML-less entry named hosted-auth.js.
 * This config produces exactly one ES module for the hosted sign-in shell.
 */
export default defineConfig({
  build: {
    outDir: "dist/client/assets",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, "src/web/hosted/hosted-auth-entry.ts"),
      formats: ["es"],
      fileName: () => "hosted-auth.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
});
