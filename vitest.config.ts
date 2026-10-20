import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@115jon/kova-react": path.resolve(import.meta.dirname, "packages/kova-react/src/index.ts"),
      "@": path.resolve(import.meta.dirname, "src/web"),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "packages/kova-react/src/**/*.test.ts"],
  },
});
