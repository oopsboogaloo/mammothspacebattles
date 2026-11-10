# The Rust trial: the constraint solve in WebAssembly (10 November 2026)

**Question:** would moving the simulation core from TypeScript to Rust compiled to WebAssembly pay?
The earlier test (spec §10, "What was tried") ported only the gas neighbour search to C and found
1.25–1.45×, too little for a second copy of the gas. Since then the main problem has become the
iPad's freezes, which look like garbage collection (perf notes §21–23). WebAssembly keeps its data in
its own memory and makes no garbage for the JavaScript collector, so it might help there even where
it isn't much faster.

**What was ported:** one self-contained piece with a lot of garbage and branching: the constraint
solve. The welds and contacts are solved together in one loop that shares body velocities, so the
unit is the whole of it:

- `prepareJoints`, `solveJoints`, `finishJoints`' limit test and `correctJoints` (joints.ts);
- the velocity solve in `solveContacts`: warm start, iterations, restitution, and the redo without
  warm starts (physics.ts);
- `correctPositions`, with the same fdlibm `sinCos` as math.ts.

About 600 lines of Rust in [`wasm/solver/src/lib.rs`](../../wasm/solver/src/lib.rs). Finding
contacts, building them, breaking welds and everything else stay in TypeScript.

## How it works

- **The world stays in JavaScript objects.** Each step [`solverWasm.ts`](../../src/core/solverWasm.ts)
  writes the solve's inputs (bodies, welds, contacts and their points) into the module's memory through
  typed-array views kept between steps, calls the module, and writes the results back. Body vectors are
  replaced only when they changed.
- **Same bits.** Every operation is the TypeScript's, in the same order. WebAssembly's f64 arithmetic
  is IEEE 754 like JavaScript's, with no fused multiply-add, and Rust never reorders float operations.
  `Math.max`, `Math.min` and `Math.round` are copied exactly, NaN and the sign of zero included.
- **On by default** (decided 10 November 2026, after these results), on the page, in the worker and
  in Node. `?wasm=0` in the app, or `setWasmSolver(false)`, uses the TypeScript solver, which stays as
  the reference the tests compare against and as the fallback where WebAssembly can't load. The
  diagnostics log names the solver.
- **No Rust needed to build the app.** `node scripts/build-wasm.ts` compiles the crate and embeds the
  38 kB module as base64 in `src/core/wasm/solver.wasm.ts`, which is committed. Rebuild it after any
  change to the Rust. Needs Rust with the `wasm32-unknown-unknown` target.

## Results

**Identical results.**
- 23 scenarios give the same world hash every step, TypeScript against WebAssembly
  (`node scripts/wasm-compare.ts`, 300–600 steps each). They include the reference battle, the stress
  test, explosive shells, the duel, tractors, the base and every lander level.
- The whole test suite (456 tests) passes with the WebAssembly solver forced on.
- A test keeps four of the scenarios and 5,000 `sinCos` values in step (`tests/core/solverWasm.test.ts`).
- As a check that the comparison can fail: perturbing two constants in the Rust made the lander and
  the spinning assembly differ at steps 0 and 1.

**Speed, whole step, ms** (best of 3, 600 steps after 120; this Windows desktop):

| Scenario | Node TS | Node WASM | Chromium | WebKit |
|---|---|---|---|---|
| Easy | 0.163 | 0.155 | 0.96× | 1.13× |
| Emergency | 0.635 | 0.621 | 1.02× | 1.03× |
| Orbital (130-part welded rock) | 0.532 | 0.373 | 1.48× | 1.28× |
| Heavy Orbital | 0.648 | 0.470 | 1.54× | 1.19× |
| Gunship and rubble | 0.523 | 0.305 | 1.95× | 1.58× |

The browser columns are whole-step speed-ups, WebAssembly over TypeScript, timed in the page
(Playwright's Chromium and WebKit against the dev server). Where the solve is the work, the step runs 1.2–2× faster; on Easy and
Emergency it is a small part of the step and nothing changes.

**Garbage, MB thrown away a game second** (V8 GC trace, `allocated=`, 10 game seconds after 1):

| Scenario | TypeScript | WebAssembly | Change |
|---|---|---|---|
| Easy | 93 | 87 | −6% |
| Emergency | 336 | 331 | −1.5% |
| Orbital | 227 | 154 | −32% |
| Heavy Orbital | 269 | 181 | −33% |
| Gunship and rubble | 299 | 122 | −59% |

**What is left on Emergency** (sampling heap profiler with the WebAssembly solver on): spread thin.
Map and Set iteration and updates 17%, the engine chamber's body index (`bodyIndex`, vessel.ts) 6%,
the gas step, ignition and wall filing 14%, injectors 4%, the ledger 3%, wisps 3%, landing telemetry
2%, the solver's own glue 4%. So the scenes that freeze on the iPad (Easy, Emergency) make their
garbage mostly outside the solver.

## What it shows

1. **The approach works.** A port by mirroring the TypeScript line for line gives the same bits, so
   the replay hashes and the test suite carry over unchanged. The boundary costs little when the
   data crosses in typed arrays once a step.
2. **WebAssembly is faster where the code is branchy arithmetic over objects**: 1.5–2× in V8,
   1.2–1.6× in WebKit, against 1.25–1.45× for the gas neighbour search earlier.
3. **The solver alone won't fix the iPad's freezes.** Its garbage is a third or more of the total
   where there are many welds or contacts, but Easy and Emergency churn elsewhere.
4. **Two copies of the same code are a cost.** If a module moves to Rust for good, its TypeScript
   copy should go, and the Node tests would then run the WebAssembly.

## Next: the iPad test

The trial doubles as the test of whether garbage drives the freezes, since Orbital's garbage drops by
a third with the switch:

1. On the iPad, open the sandbox's game with `?game=lander&diag=1&wasm=0` (TypeScript) and play
   Orbital for about 3 minutes; copy the log.
2. The same with `?game=lander&diag=1` (WebAssembly, the default).
3. Compare the freezes over 100 ms a minute. The log's `solver:` line says which ran.

If freezes fall roughly with the garbage, collection is the cause and the rest of the step's
garbage is the target: the gas (the largest part on Emergency) first, in Rust or as typed arrays.
If they don't, the freezes come from elsewhere and moving more code to WebAssembly won't help them.

## Decision (10 November 2026)

Adopted: 2× on the busiest weld and contact scenes is worth it. The WebAssembly solver is the default.
Next candidates, by what they would gain: the gas step (the largest share of time and of Emergency's
garbage), then the rest of the step's per-body work. The TypeScript solver goes once the iPad test is
done and nothing needs comparing against it.
