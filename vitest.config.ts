import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Phase 0 (refactor an toàn): chỉ chạy unit test cho domain logic thuần.
// Alias "@" khớp tsconfig (@/* -> ./src/*) để test import giống code app.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
