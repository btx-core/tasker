import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    // Uji integrasi butuh Postgres; dilewati bila DATABASE_URL tidak ada.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
