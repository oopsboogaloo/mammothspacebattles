# GPU gas, Phase 0: reference battle and WebGPU spike

Phase 0 of the GPU gas plan (`docs/gpu-gas-plan.md`). Measured 6 November 2026 on the development
container (CPU baseline) and three devices (the spike page): an iPad Pro, and a desktop's built-in
Intel graphics and NVIDIA RTX 40-series card.

**Verdict: no-go for the plan as written** (Phase 1 as designed), on all three devices. The GPU is
not short of throughput; the cost is the number of substeps, each with a fixed price. The direction
is kept (see §6): next is Spike 2, the same gas laid out for the GPU.

## 1. Reference battle (the baseline)

`scenarios/reference-battle.json` (REF in the picker) is built by `scripts/reference-battle.ts`:

- **Ships:** the Mammoth, Gunship 3, Gunship 2 and the FLY lander, 25–30 m apart. Each is copied from its own scenario at default parameters.
- **Engines:** all ten fire from step 0. Q and E fly the whole fleet.
- **Explosions:** two armed 0.5 kg shells (0.3 kg charge) burst on rubble asteroids at 0.45 s and 0.80 s.
- **Asteroids:** two more sit in the plumes behind the ships.

`node scripts/battle-baseline.ts --steps 480` measured it on today's CPU gas (Node 22, the development container, `sandbox` profile). The output is in `reference-battle-baseline.json`.

| Steady burn (steps 60–480, clamped steps left out) | |
|---|---|
| Parcels | 884 (peak 934) |
| Substeps a step | 30.4 |
| Gas, ms a step | **22.5** (p95 32.2) |
| Everything else, ms a step | **6.3** |
| Real-time factor | 0.14× |
| Gas µs per parcel-substep | 0.84 |

Where the gas time goes, ms a step:
- clusters: 6.1;
- wall contacts: 5.3;
- neighbours: 4.5;
- impulses: 1.4;
- setup: 1.2;
- density, move and finish: 1.1.

**Found on the way: a 4,000 rad/s fragment.**
- A shell fragment from the first blast leaves the rock spinning at about 4,000 rad/s.
- The substep rule counts body spin as |ω| × 50 m (`signalSpeed` in `gas.ts`). So when that fragment comes near gas, every parcel drops to the substep floor: 2,000 a step, 160–250 ms a step.
- This lasts 71 steps (111–249). It is left out of "steady" above. Over all 480 steps, gas averages 37.8 ms a step.
- It is a CPU bug, not a GPU question. The GPU gas would have it too if it copies the rule. It wants its own fix.

**The rest of the step is already over budget.**
- Real time at 240 steps/s is 4.2 ms a step. The non-gas part alone (forces, contacts, integration, ledger) is 6.3 ms here.
- So the reference battle can't run in real time on this machine even with free gas.

## 2. The WebGPU spike

`gpu-spike.html` (deployed at `/mammothspacebattles/gpu-spike.html`). Its code is `src/app/gpu/`.

- **Where it runs:** in the simulation worker (`simWorker.ts`, message `gpuSpike`). If the worker has no WebGPU, it runs on the page instead.
- **Passes per substep,** in one compute pass:
  1. clear;
  2. count into a hashed grid (the table is about twice the parcels, so cost follows the gas, not the ±500 m arena);
  3. two-level exclusive scan;
  4. scatter (the gas is kept in cell order);
  5. density;
  6. pressure, viscosity and heating, then the move, with a CFL max for the next substep.
- **Same formulas as the CPU gas:** the Wendland C2 kernel, the pair h as the mean, the ideal gas law, and Monaghan viscosity capped as in §9.4.
- **The cloud:** a 4×-detail cloud (radius 17.5 mm, 0.75 g) in a closed box, cold with a 3,000 K core. Each parcel has about 26–28 neighbours.
- **Timing:** wall clock round one submit of 240 substeps (4 steps × 60) and a 16-byte read-back, the median of 5. Full substep, sort alone, and density + force alone.
- **Correctness check:**
  - the sort keeps every parcel exactly once;
  - density matches a float64 CPU sum over every pair;
  - Σ m·v holds over 100 substeps of free expansion.
- **The estimate it shows:**
  - 4× parcels and 2× substeps. Quarter-mass parcels have half the radius, so half the CFL substep.
  - Multiplied by 2.47 for what the spike leaves out (walls and ghosts, chemistry, far field, spawning, push sums). That is the ratio on the CPU, clusters aside.
  - Compared with ½ (phone) and ¼ (laptop) of a 1/240 s step.

**In CI** (headless Chromium, `--enable-unsafe-webgpu`, SwiftShader in the worker), `e2e/gpu.spec.ts` checks the shaders. Results: density within 4×10⁻⁷, momentum drift 4×10⁻⁹. Software timings (7–21 ms a substep) mean nothing.

## 3. Device results

Raw runs: `gpu-spike-results.json`. Each row: µs a substep (all 7 passes), wall clock round a
240-substep submit and a 16-byte read-back, median of 5. Every device ran it in the simulation
worker, and every run matched the CPU (density within 3–4×10⁻⁷, momentum drift 1–5×10⁻⁹).

| Parcels | iPad Pro (Apple GPU) | Desktop, Intel UHD 770 (built-in) | Desktop, NVIDIA RTX 40 |
|---|---|---|---|
| 1,000 | 183 | 387 | 268* |
| 4,000 | 250 | 685 | **140** |
| 10,000 | 483 | 1,535 | 176 |
| 25,000 | 1,000 | 3,852 | 192 |
| 50,000 | 1,679 | 6,568 | 223 |
| 100,000 | 3,667 | 11,317 | 310 |

\* Measured first, likely before the card left its idle clocks; the 4,000 row is its floor.

Split at 4,000 parcels (sort alone / density + force alone, µs): iPad 33 / 175, Intel 36 / 377,
RTX 17 / 86.

**The reference battle at 4× detail** (3,536 parcels, peak 3,736; 61 substeps a step; full gas
2.47 × these passes), gas a step:

| Device | Gas a step | Budget | Over by |
|---|---|---|---|
| iPad Pro | 37 ms | 1.04 ms (counted as laptop-class) – 2.08 ms | 18–35× |
| Desktop, Intel built-in | 99 ms | 1.04 ms | 95× |
| Desktop, RTX 40 | 23 ms | 1.04 ms | 22× |

For scale, today's CPU gas takes 22.5 ms a step at 1× detail; at 4× it would be about 8× that
(4× the parcels, 2× the substeps).

Note: Chrome on Windows chose the built-in Intel graphics until Windows' graphics setting for
Chrome was set to High performance; the page's `powerPreference: "high-performance"` was ignored.
The game will need to show which adapter it got.

## 4. What we learned

1. **Correctness is not the problem.** The same formulas in float32 on four GPUs (with CI's
   SwiftShader) match the CPU's float64 to 4×10⁻⁷, with momentum conserved to 10⁻⁹. CI can test the
   shaders in headless Chromium (`--enable-unsafe-webgpu`, SwiftShader in the worker), not time them.
2. **Throughput is not the problem either, on a big card.** On the RTX, 25× the parcels (4,000 →
   100,000) cost 2.2× the time: about 3 ns a parcel a substep, against 840 ns on the CPU. The iPad
   and Intel scale with parcels more (37 and 113 ns a parcel at 100,000).
3. **The cost is the number of substeps, each with a fixed price.** One substep is 7 dispatches
   that must run in order, each draining the GPU before the next starts. At low parcel counts the
   density and force passes are also slow per thread (each thread walks ~30 neighbours in 9 cells,
   one after another, on a GPU mostly idle). The floor: about 140 µs a substep on the RTX, 183–250 µs
   on the iPad, 390–690 µs on Intel.
4. **The budget leaves about 7 µs a substep.** A quarter of a 1/240 s step is 1.04 ms; over 61
   substeps that is 17 µs for all the gas, 7 µs for these passes. The gas takes 61 × 240 = 14,600
   substeps a game second; at 140 µs each that is 2 s of GPU time a second.
5. **The pre-measurement guess was right in verdict, wrong in cause.** Published WebGPU dispatch
   costs of 24–71 µs ([arXiv 2604.02344](https://arxiv.org/abs/2604.02344)) overstated it here: the
   sort's 5 dispatches took 17–36 µs in all, 3–7 µs each. The floor is mostly the dependent density
   and force passes.
6. **The sort is cheap** (17–36 µs at 4,000 parcels). Re-sorting less often would save little.
7. **The CPU's step outside the gas is over budget on its own:** 6.3 ms against 4.2 ms a step for
   real time (forces, contacts, integration, ledger). That needs its own work whatever the gas does.
8. **Games that ship particle fluids** (Cryostasis's SPH water on PhysX, NVIDIA FleX, Google's
   LiquidFun) use them for liquids and effects, at one solver update a frame. Position-based fluids
   (FleX) and MLS-MPM (webgpu-ocean) were adopted because they stay stable at large time steps. We
   found no shipped game where gas pressure on walls makes a craft's thrust, which is what makes
   this game unusual, and why its gas takes tiny steps.

## 5. Options

| Option | Keeps today's gas model | What it attacks | Risk |
|---|---|---|---|
| **Spike 2: one work-group per gas cluster, all substeps in one dispatch** | Yes | The fixed price of a substep (no GPU-wide waits; clusters run side by side; each its own substeps) | One work-group has ≤ 256–1,024 threads, so a 4,000-parcel cluster runs ~15 parcels a thread in turn |
| A gas method with large time steps (position-based or MLS-MPM, adapted to hot compressible gas on walls) | No | The number of substeps (~20× fewer would fit the RTX budget) | Thrust re-measured and every ship retuned; tried on the CPU first |
| GPU for looks only (smoke and plume once a frame) over today's CPU gas | Yes | Nothing in the physics | Physics gas stays as costly as now |
| Shelve GPU gas; speed up the CPU step | Yes | The 6.3 ms outside the gas, the spinning-fragment bug | No new detail |

## 6. Decision and next step

6 November 2026: the GPU direction stays, because real gas making real thrust is what makes the
game unique, and the aim is to make that gas affordable without faking it. Next is **Spike 2**
(first row above), timed on the same devices. If it brings a substep near 10–20 µs, Phase 1 goes
ahead in that form; if not, the large-time-step gas is tried on the CPU against today's.

## 7. Spike 2: one work-group per cluster (built, awaiting device runs)

The spike page now runs Spike 2 by default (`src/app/gpu/fused.ts`; Spike 1 with `?spike=1`).

- **One work-group per cluster.** Each cluster's parcels are a range of the state buffers with
  their own hashed table. Its threads loop through every substep of a batch, waiting only for
  each other (barriers) between the stages: clear, count, running total, scatter, density,
  pushes and move, then the next substep length from the cluster's fastest gas.
- **One dispatch per batch.** No GPU-wide waits; clusters run side by side on different compute units.
- **What it times:** clusters of 250, 500, 1,000, 1,500 and 3,000 parcels; 1, 5 and 10 at once;
  256 threads a work-group, and 1,024 where the device allows. Per substep, all clusters together.
- **The battle's clusters** (`reference-battle-baseline.json`, `steady.clusters`): 5, of about 335,
  292, 115, 103 and 48 parcels. At 4× detail the largest is about 1,340.
- **The estimate it shows:** the battle at 1×, 2× and 4× detail, timed by its largest cluster at
  √detail × 30.4 substeps, × 2.47 for walls and the rest, against ½ and ¼ of a 1/240 s step.
- **Checked against the CPU** as Spike 1 is (three clusters of different sizes): density within
  3×10⁻⁷ and momentum drift 2×10⁻⁹ on SwiftShader in CI.
- **Pass mark:** a substep near 10–20 µs at the largest cluster's size (docs/gpu-gas-plan.md, Phase 0b).

## How to send numbers

On each device, open https://oopsboogaloo.github.io/mammothspacebattles/gpu-spike.html in Chrome
(Android, Windows, macOS) or Safari or Chrome (iPadOS and iOS 26+). Keep the tab in front for about a
minute, press **Copy results** and paste the text back. On Windows, check the adapter line names the
graphics card; if not, set Chrome to High performance in Settings → System → Display → Graphics.
