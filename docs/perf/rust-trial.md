# The Rust trial: the constraint solve, then the gas loop, in WebAssembly (10 November 2026)

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
  module (38 kB; 82 kB with the gas loop) as base64 in `src/core/wasm/solver.wasm.ts`, which is
  committed. Rebuild it after any change to the Rust. Needs Rust with the `wasm32-unknown-unknown`
  target.

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

## The iPad test (as planned; its results are below)

The trial doubles as the test of whether garbage drives the freezes, since Orbital's garbage drops by
a third with the switch:

1. On the iPad, open the sandbox's game with `?game=lander&diag=1&wasm=0` (TypeScript) and play
   Orbital for about 3 minutes; copy the log.
2. The same with `?game=lander&diag=1` (WebAssembly, the default).
3. Compare the freezes over 100 ms a minute. The log's `solver:` line says which ran.

If freezes fall roughly with the garbage, collection is the cause and the rest of the step's
garbage is the target: the gas (the largest part on Emergency) first, in Rust or as typed arrays.
If they don't, the freezes come from elsewhere and moving more code to WebAssembly won't help them.

## The iPad test: results (10 November 2026)

Orbital, ship 3, on the iPad (iPadOS 26.6, Chrome), played with thrust:

| | TypeScript solver (177 s) | WebAssembly solver (143.5 s) | Change |
|---|---|---|---|
| Worker steps over 100 ms | 15 (5.1 a minute) | 9 (3.8 a minute) | −26% |
| Frame gaps over 100 ms | 12 (4.1 a minute) | 9 (3.8 a minute) | −8% |
| Moments with a freeze | 17 (5.8 a minute) | 12 (5.0 a minute) | −13% |
| Mean frozen step | 515 ms | 560 ms | no shorter |
| Play time lost to frozen steps | 4.4% | 3.5% | |
| Frozen steps by part | gas 8, contacts 4, forces 2, integrate 1 | gas 9 | |

- **The rate** fell about as the garbage did (−26% against −32%), but with 15 and 9 events a gap
  this size turns up by chance about one time in three.
- **Where they land** is the stronger sign. With the solve in WebAssembly no freeze landed in
  `contacts` (4 of 15 before) and all 9 landed in the gas part, which is about 57% of a step: under
  1% by chance. A collection starts where memory is asked for, and WebAssembly asks for none.
- **Not explained:** the page's frames freeze at the same moment as the worker (6 of 9, and 10 of
  12 before), though the page has its own heap; and 400–700 ms is long for a 736 kB world.
- **The log's "gas" part is more than the gas loop.** It is everything between the position
  integrator and the ledger: the gas step, and also the wisps and the bookkeeping round them (see
  "What is left" below).

So garbage collection is the likely cause, not proven. The frozen steps cost exactly the worker's
shortfall (114.7 steps a second against the 120 needed).

## The gas loop in WebAssembly (10 November 2026)

**What was ported:** the gas step's substep loop, all of it: wall contacts, mirror ghosts, the
neighbour search, density, impulses and energy with their retries, the elastic bounce and the drift
(`gasCoreTs` in gas.ts, about 900 lines; about 1,300 of Rust in
[`wasm/solver/src/gas.rs`](../../wasm/solver/src/gas.rs), in the same module as the solver).
Clustering, building the walls, the step's finish (gas leaving the world, write-back, joint loads),
free flight, ignition and the wisps stay in TypeScript.

**How it works**

- `stepGas` packs the parcels straight into the module's memory, writes in the walls and rigid
  units `buildWalls` made, calls the module, and finishes from the same memory
  ([`gasWasm.ts`](../../src/core/gasWasm.ts)). The working arrays live in the module and are kept
  between steps, so the loop makes no typed arrays: it made about 65 a cluster, every step.
- One switch for both: `?wasm=0` (or `setWasmSolver(false)`) uses the TypeScript solver and the
  TypeScript gas loop. A cluster job carries the choice to helper threads.
- A timed step still reports the loop's parts (`gas.contacts`, `gas.neighbours`, …): the module
  reads the caller's clock.
- Bounds checks are kept. Dropping them gained 5–10% on dense gas; with them a mistake stops the
  step instead of corrupting it.

**Identical results**

- All 46 scenarios give the same world hash every step for 600 steps, TypeScript against WebAssembly
  (`node scripts/wasm-compare.ts scenarios/*.json`); 14 of them have gas, up to 1,024 parcels.
- With engines pulsing (`--thrust`: every control channel on, one off, all off, a third of a second
  each), the nine lander levels, both twin-engine ships, the five gunships, the mammoth and the base
  give the same hash every step for 1,440 steps.
- Six of them, and one cluster job stepped both ways, are in the test suite
  (`tests/core/solverWasm.test.ts`).
- As a check that the comparison can fail: one constant changed in its eighth digit made the rocket
  differ at step 0 and Orbital within two steps of its engines firing.

**Speed, ms a step** (best of 3, 1,200 steps after 240, engines pulsing; Node on this Linux
machine; "before" is the WebAssembly solver with the TypeScript gas loop):

| Scenario | Step before | Step now | | Gas part before | Gas part now | |
|---|---|---|---|---|---|---|
| Easy | 0.93 | 0.89 | 1.04× | 0.54 | 0.41 | 1.32× |
| Emergency | 2.30 | 2.32 | 1.0× | 1.74 | 1.58 | 1.10× |
| Orbital | 2.08 | 1.89 | 1.10× | 1.27 | 1.19 | 1.07× |
| Heavy Orbital | 2.63 | 2.37 | 1.11× | 1.59 | 1.37 | 1.16× |
| Gunship 2 | 2.30 | 1.81 | 1.27× | 1.56 | 1.13 | 1.38× |
| Reference battle | 7.81 | 6.33 | 1.23× | 5.79 | 4.25 | 1.36× |

The loop itself, TypeScript against WebAssembly (ms a step, summed over its parts):

| Scenario | TypeScript | WebAssembly | |
|---|---|---|---|
| Orbital (51 parcels) | 0.35 | 0.07 | 5× |
| Reference battle (619 parcels) | 4.8 | 2.5 | 1.9× |
| Gas in a box (484 parcels, dense) | 23.0 | 14.0 | 1.6× |

**Garbage** (the same runs; typed arrays counted as they are made, the heap from V8's GC trace):

| Scenario | Typed arrays a step | kB of them a step | Heap, MB a game second |
|---|---|---|---|
| Easy | 153 → 87 | 51.7 → 7.1 | 85 → 72 |
| Emergency | 176 → 102 | 71.1 → 11.7 | 119 → 107 |
| Orbital | 153 → 87 | 51.0 → 6.4 | 132 → 114 |
| Gunship 2 | 230 → 144 | 92.4 → 9.7 | 207 → 149 |
| Reference battle | 585 → 412 | 249.5 → 25.5 | 511 → 411 |

Typed arrays' storage is outside the heap V8's `allocated=` counts, which is why pooling them
showed no gain in the perf notes' §23: that measure could not see them.

**What is left** (CPU profile, engines pulsing, after the port):

- **The wisps are now the largest single cost on the lander levels:** `stepWisps` and its `touch`
  are 25% of the whole step on Orbital and 33% on Emergency. The log's "gas" part includes them.
- The module's gas loop is 4% of the step on Orbital and 7% on Emergency.
- The rest of the gas part is clustering (`gasClusters`, about 30% of the gas part in the dense box),
  `buildWalls`, free flight and the ledger's totals either side.

So on the lander levels the port removes most of the gas loop's time and nearly all of its typed
arrays, but the step is only 4–11% faster, because the loop was a third of the gas part there. With
more gas (gunships, battles) the step is 1.2–1.3× faster.

## The iPad again, with the gas loop in WebAssembly (10 November 2026)

The same iPad, Orbital, ship 3, played with thrust, on the build with the gas loop in the module:

| Run | Played | Worker steps over 100 ms | Frame gaps over 100 ms | Worst step | Steps a second |
|---|---|---|---|---|---|
| TypeScript (`wasm=0`) | 239.5 s | 5 (1.3 a minute): gas 3, contacts 2 | 4 | 715 ms | 119.0 |
| WebAssembly | 171.7 s | 0 | 0 | 44 ms | 120.0 |
| WebAssembly | 583.2 s | 0 | 2, both round 76 s with no frames drawn | 18 ms | 120 while played |

- **No frozen step in 11.3 minutes of WebAssembly play** (about 680 s; 12.5 minutes with the 76 s
  when no frames were drawn). At the TypeScript run's rate there would have been about 14, and at the rate
  of the earlier WebAssembly run, with the gas loop still in TypeScript (3.8 a minute, all in the
  gas part), about 40.
- **The long run's two frame gaps are not freezes:** one of 76 s and one of 113 ms straight after,
  with no slow step, and no results from the worker in between. The player did not leave the game
  and saw no freeze, so the frame loop was most likely not running (it stops when the flying view
  is not on screen, as on a menu); not traced further. The log's frame and step rates are low only
  because those 76 s are counted.
- **The TypeScript run froze far less than the first one** (1.3 a minute against 5.1) on the same
  code, with a quarter less gas time a step. Runs played by hand differ that much, so the first
  pair's 5.1 against 3.8 said little; what holds is where the freezes land and that they stop.
- **Speed on the iPad:** the step is about 1.1× faster (2.3 ms against 2.6 without the frozen steps),
  as on the desktop for Orbital.

So on Orbital the freezes are gone with the gas loop's typed arrays, which points at them (their
storage is outside the heap, where §23's measure could not see) as what drove the collections.
Not yet checked on the iPad: Emergency, which froze most, and the other levels.

## Next

1. **Emergency on the iPad** (`?game=lander&diag=1`), 5 minutes: the same check where it froze most.
2. ~~The wisps~~ Done the same day, in TypeScript, with no port needed: big bodies on a grid, the
   step 1.4–1.6× faster on Orbital, Heavy Orbital and Emergency (perf notes §26).
3. **Clustering and `buildWalls`** into the module, which would also end the gas part's last typed
   arrays.

## Decision (10 November 2026)

Adopted: 2× on the busiest weld and contact scenes is worth it. The WebAssembly solver is the default.
Next candidates, by what they would gain: the gas step (the largest share of time and of Emergency's
garbage), then the rest of the step's per-body work. The TypeScript solver goes once the iPad test is
done and nothing needs comparing against it.

After the iPad test the same day: the gas loop moved too (above), for speed as much as for the
freezes: every part that runs 1.5–2× faster leaves room to put more into the game. The TypeScript
solver and gas loop stay for now as the reference for the next ports. What comes next is under
"Next" above, not the candidates listed here.
