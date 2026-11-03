import { defineConfig } from "vitest/config";

// Long-running tests (TST-003): `pnpm test:slow`. Not part of the fast PR suite.
export default defineConfig({
  test: { include: ["tests/slow/**/*.test.ts"], passWithNoTests: true },
});
