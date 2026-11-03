import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["dist/**", "coverage/**", "playwright-report/**", "test-results/**", "node_modules/**"] },
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  { files: ["src/app/**/*.ts", "src/app/**/*.tsx"], languageOptions: { globals: { ...globals.browser } } },
  {
    // ARC-001: the core must not touch the DOM, timers, wall-clock time or Node APIs.
    // ARC-004: all randomness comes from the world PRNG.
    files: ["src/core/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["window", "document", "navigator", "localStorage", "sessionStorage", "fetch", "performance", "process", "Date",
          "setTimeout", "setInterval", "requestAnimationFrame", "queueMicrotask"].map((name) => ({
          name,
          message: "The simulation core must stay headless and deterministic (ARC-001).",
        })),
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the world PRNG (ARC-004)." },
        ...["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "sinh", "cosh", "tanh", "cbrt", "hypot"].map(
          (property) => ({ object: "Math", property, message: "Engine-dependent result; use a pinned implementation in the stepping path (DET-003)." }),
        ),
      ],
      "no-restricted-imports": ["error", { patterns: ["node:*", "fs", "path", "os"] }],
    },
  },
  {
    // Assertion formulas run after a simulation, never inside a step.
    files: ["src/core/formula.ts"],
    rules: { "no-restricted-properties": ["error", { object: "Math", property: "random" }] },
  },
);
