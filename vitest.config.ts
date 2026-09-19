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
    // `scripts/` nằm trong danh sách vì logic của script backfill (băm địa chỉ,
    // tính tâm ZIP) quyết định toạ độ ghi vào database — để nó ngoài tầm test
    // là để phần dễ ghi sai dữ liệu nhất không ai kiểm.
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    globals: false,
  },
});
