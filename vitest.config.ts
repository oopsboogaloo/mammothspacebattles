import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/slow/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      reporter: ["text-summary", "lcov"],
      thresholds: { lines: 90 },
    },
  },
});
