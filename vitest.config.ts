import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Physics sweeps and replays are heavy by design and run slower on CI under coverage.
    // The whole suite must still finish within 60 s (TST-003).
    testTimeout: 20_000,
    exclude: ["tests/slow/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      include: ["src/core/**/*.ts"],
      reporter: ["text-summary", "lcov"],
      thresholds: { lines: 90 },
    },
  },
});
