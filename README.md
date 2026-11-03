# Mammoth Space Battles

A 2D physics sandbox for spacecraft, gas-driven propulsion, weapons and damage. It will later become a game. The spec is [`docs/spec.md`](docs/spec.md).

## Layout

| Path | What |
|---|---|
| `src/core/` | Headless simulation core. Pure TypeScript, no DOM, deterministic. |
| `src/cli/sim.ts` | Command-line scenario runner. |
| `src/main.ts` | Browser UI (placeholder until M1). |
| `scenarios/` | Scenario files. Each is both a test and a sandbox starting point. |
| `tests/` | Unit, property, scenario and determinism tests (Vitest). |
| `e2e/` | Browser tests (Playwright). |
| `scripts/req-trace.ts` | Requirement-to-test traceability. |
| `docs/reviews/` | Records for requirements verified by review. |

## Commands

```sh
pnpm install
pnpm test            # headless suite
pnpm test:coverage   # with core coverage
pnpm test:e2e        # browser tests (E2E_BROWSERS=chromium,firefox,webkit)
pnpm lint
pnpm typecheck
pnpm req:report      # which requirements are traced to tests
pnpm check           # typecheck + lint + test + milestone gate
pnpm sim run scenarios/empty.json --out result.json --hashes
pnpm dev             # browser UI
```

Requires Node ≥ 22.18. The CLI and scripts run TypeScript directly with Node's built-in type stripping.

## Conventions

- Every test that verifies a requirement puts its ID in the test name, e.g. `it("DET-001 two runs give identical hashes", …)`.
- The core uses SI units, draws randomness only from the world PRNG, and keeps bodies sorted by id.
- Scenarios use schema v1 (`src/core/scenario.ts`). Run `pnpm sim validate <file>` to check one.
