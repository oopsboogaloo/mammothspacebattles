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
- **Fixed (7 November 2026):** the rule now uses each body's (or welded assembly's) own reach from its
  centre of mass, so the fragment reads as its real surface speed, about 210 m/s. The spin itself is
  real: a 7 cm, 33 g fragment glancing off the rock at 298 m/s, its surface stopped by friction.
  Steps over 200 substeps in 480: 71 → 1. Gas over all 480 steps: 37.8 → 27.8 ms a step on average,
  worst 5% 169 → 49 ms; the first 240 steps run 1.6× faster. The rule had also slowed any small body
  the gas spins (a still 7 cm fragment in gas: 409 → 61 substeps a step). One step (155) still takes
  413 substeps, from the gas step's retries when a parcel's heat would go negative, not from spin.
- **Also fixed (7 November 2026):** step 155's retries came from how a pair's work was split. When
  a push turns heat into motion, each parcel paid by its share of the impulse, viscosity included,
  so a cold parcel (parcel 172, no heat left) paid for a hot neighbour's push. It went below zero
  at any substep length, so every substep halved 20 times to 10⁻¹⁰ s, until the step's 8,000-try
  budget ran out and the clamp made up 11 J. That heat now comes by each parcel's pressure term.
  Step 155: 413 → 38 substeps, 574 → 33 ms; no step of 300 now takes over 60. The battle's worst step is now step 0 (setup), and it
  needs no clamp in 300 steps. Ship speeds, LAND's and Gunship 2's climbs are within 0.1%, the
  rocks' push within 1%.

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

## 7. Spike 2: one work-group per cluster

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

### Spike 2 results (6 November 2026)

µs a substep, all clusters together, 5 clusters side by side (1 and 10 were within ~10% of 5 on
both devices). Raw runs: `gpu-spike-results.json` (`spike2`).

| Parcels a cluster | iPad Pro, 256 threads | RTX 40, 256 threads | RTX 40, 1,024 threads |
|---|---|---|---|
| 250 | 150 | 98 | 81 |
| 500 | 292 | 189 | 99 |
| 1,000 | 567 | 410 | 128 |
| 1,500 | 921 | 684 | 235 |
| 3,000 | – | 1,453 | 431 |

The reference battle, gas a step (budget 1.04 ms laptop or desktop, 2.08 ms phone):

| Detail | iPad Pro | RTX 40 | Spike 1, for comparison (iPad / RTX) |
|---|---|---|---|
| 1× | 14.9 ms | 6.6 ms | – |
| 2× | 40.9 ms | 11.6 ms | – |
| 4× | 121 ms | 30.1 ms | 37 / 23 ms |

**What we learned:**

1. **Clusters do run side by side.** 1, 5 and 10 clusters cost the same on both devices.
2. **But each cluster is slow: no-go, and worse than Spike 1 at 4×.** One parcel a thread still
   costs about 80 µs a substep on the RTX and about 146 µs on the iPad. Each thread fetches its
   neighbours from GPU main memory, one dependent load after another (about 80 in density and
   again in the pushes), and one work-group per cluster leaves too few threads to hide that wait.
3. **More threads help on the RTX:** 1,024 a work-group is about 3× faster than 256 for clusters
   of 1,000 or more parcels.
4. **The iPad refused the 1,024-thread kernel**, and the page timed the empty dispatches as 0–4 µs
   and showed GO. Fixed: a refused kernel, or a run whose clusters don't report every substep, is
   now shown as failed and left out of the estimate; 256-thread layouts run first.
5. **Next lever (Spike 2b): keep each cluster in work-group memory** (on-chip, tens of times
   faster to reach than main memory). It targets exactly the cost measured here. At 1× detail a
   cluster fits easily; at 4× (about 1,340 parcels) the full state does not fit Apple's 32 KB, so
   only what the neighbour search reads most (positions and cells) would live there.

## 8. Spike 2b: the neighbour search in work-group memory

The spike page now runs Spike 2b by default (`?mode=global` for Spike 2, `?mode=global,shared` for both).

- **Same loop as Spike 2**, one work-group per cluster, every substep in one dispatch.
- **In work-group memory** (on-chip): each cluster's sorted positions (8 bytes a parcel) and its
  neighbour table, counted then turned into starts in place (4 bytes a slot, slots ≥ parcels).
  Every candidate neighbour is tested from there; GPU main memory is read only for real neighbours
  (mass, smoothing length, velocity, density) and once a parcel a stage.
- **No cell check per candidate:** the 3 × 3 cells' slots are deduplicated, so each parcel is
  visited once and the distance test alone decides.
- **Size limit:** 8 × parcels + 4 × slots + 4 × threads bytes must fit the GPU's work-group memory
  (16 KB guaranteed; 32 KB on Apple, SwiftShader and most desktop GPUs). The battle's largest
  cluster at 4× detail (about 1,340 parcels) needs about 23 KB at 1,024 threads; 3,000 parcels does
  not fit, and that layout shows as failed with the reason.
- **Timed:** clusters of 250–3,000 parcels, 5 at once, 256 and 1,024 threads. Checked against the
  CPU like the others (density within 3×10⁻⁷, momentum drift 6×10⁻⁹ on SwiftShader).

### Spike 2b results (6–7 November 2026)

µs a substep, 5 clusters side by side. Raw runs: `gpu-spike-results.json` (`spike2b`).

| Parcels a cluster | RTX 40, Spike 2 (1,024 threads) | RTX 40, **2b** (1,024) | iPad Pro, Spike 2 (256) | iPad Pro, **2b** (256) |
|---|---|---|---|---|
| 250 | 81 | **58** | 150 | **146** |
| 500 | 99 | **77** | 292 | **283** |
| 1,000 | 128 | **100** | 567 | **546** |
| 1,500 | 235 | **177** | 921 | **875** |
| 3,000 | 431 | failed: 40–43 KB needed, 32 KB allowed | – | failed: same |

The iPad refused the 1,024-thread kernel again; the page now shows it as failed ("ran 0 of 10
substeps") and leaves it out of the estimate.

The reference battle, gas a step:

| Detail | RTX 40, 2b | iPad Pro, 2b |
|---|---|---|
| 1× | 4.8 ms | 14.5 ms |
| 2× | 9.0 ms | 39.6 ms |
| 4× | 22.9 ms | 116 ms |
| Budget | 1.04 ms | 2.08 ms |

**What we learned:**

1. **Work-group memory helps a little on the RTX (about 25%) and not at all on the iPad.**
2. **The RTX still takes 58 µs a substep with most of its 1,024 threads idle** (250 parcels): the
   cost of one substep's chain of stages (about 28 barriers, and a few dependent reads per
   neighbour) inside one compute unit. The budget allows about 7 µs a substep at 4× detail and
   about 14 µs at 1×.
3. **On the iPad the cost is the work in each thread:** it doubles with every doubling of parcels a
   thread, about 140 µs per parcel's share of a substep, wherever its data sits.

## 9. Conclusion after three spikes (7 November 2026)

| The battle at 4×, gas a step | iPad Pro | RTX 40 |
|---|---|---|
| Spike 1 (7 dispatches a substep) | 37 ms | 23 ms |
| Spike 2 (one work-group per cluster) | 121 ms | 30 ms |
| Spike 2b (the same, in work-group memory) | 116 ms | 23 ms |
| Budget | 2.08 ms | 1.04 ms |

- **Three different GPU layouts meet the same wall**, about 20× over budget even on a high-end
  desktop card. The gas takes about 14,600 substeps a game second at 4× detail (61 a step, 240
  steps a second), each a chain of stages that must finish before the next starts. GPUs are built to
  do much work at once, not to finish small dependent steps quickly: no layout we tried gets a
  substep under about 50–150 µs.
- **Correctness was never the problem:** every kernel matched the CPU, on every device.
- **The lever left is the number of substeps:** a gas method that takes far fewer, larger time
  steps. Every GPU figure above shrinks in proportion, and the CPU gas would gain the same.
- **Recommendation:** stop the GPU spikes here. Weigh gas methods with larger time steps and test the
  chosen one on the CPU first, against today's gas (thrust, exhaust speed,
  plume spread, splashes), before returning to the GPU.

## 10. Extra check: approximations and substep rules (7 November 2026)

**What others do** (web search, 7 November 2026):

| Approach | Evidence | Fit here |
|---|---|---|
| One long-running GPU program (persistent kernel / megakernel) | Standard fix for launch overhead ([Mirage](https://arxiv.org/html/2512.22219v1)) | Tried: Spikes 2 and 2b. The launch was not our floor |
| Parallel in time (Parareal, PFASST) | 4–6× over space-only parallelism in particle-in-Fourier plasma codes, sometimes none ([arXiv 2407.00485](https://arxiv.org/abs/2407.00485)); N-body ([space-time N-body](https://www.researchgate.net/publication/256791837_A_massively_space-time_parallel_N-body_solver)) | None found for SPH; needs many cores and correction sweeps |
| Local / regional time steps | About 2× for weakly compressible SPH, CPU only ([Asynchronous Liquids](https://arxiv.org/abs/2009.14514)); block steps in astrophysics codes ([SEREN](https://arxiv.org/pdf/1102.0721), [GANDALF](https://arxiv.org/pdf/1709.04488)) | Cuts the work per substep, **not** the chain: the fastest parcels still need every substep, so no help on the GPU |
| Implicit or semi-implicit pressure | DFSPH at 4 ms steps ([Bender & Koschier](https://animation.rwth-aachen.de/media/papers/2015-SCA-DFSPH.pdf)); a semi-implicit SPH for compressible and incompressible fluids ([He et al. 2025](https://diglib.eg.org/items/6aa00c2d-db8e-48fb-b72d-fb96af19834b)), a graphics method that corrects density by moving particles (full text not reached) | Removes the sound term only; each step then needs solver iterations, each another link in the chain |
| Methods built for large steps (position-based fluids, MLS-MPM) | 1–2 steps a frame in WebGPU demos ([Splash](https://github.com/matsuoka-601/Splash), [WebGPU-Ocean](https://github.com/matsuoka-601/WebGPU-Ocean)) | Liquids; compressible-gas MPM is still CFL-limited ([GPU MPM](https://www.researchgate.net/publication/329272471_GPU_optimization_of_material_point_methods)) |

**Measured** (`node scripts/substep-levers.ts`): the substeps the reference battle's gas would need
under each rule, worked out per cluster from the same states (steps 60–480, the fragment-spin steps
left out). Recomputing today's rule gives 30.1 against the gas's own 30.2. GPU time: the largest over
clusters of substeps × Spike 2b's measured time a substep at that cluster's size, × 2.47.

| Substep rule | Substeps a step | RTX 40, 1× / 4× | iPad Pro, 1× / 4× |
|---|---|---|---|
| Today: sound + parcel speed; bodies' speed + spin × 50 m | 30.1 | 4.7 / 21.9 ms | 14.0 / 110 ms |
| Bodies' spin × their own size | 29.9 | 4.7 / 21.9 ms | 14.0 / 110 ms |
| Sound + speed relative to neighbours and nearby bodies | 28.7 | 4.5 / 21.0 ms | 13.4 / 106 ms |
| No sound term (implicit pressure), parcel speed | 22.0 | 3.5 / 16.1 ms | 10.3 / 81 ms |
| No sound term, relative speed only | 20.8 | 3.3 / 15.2 ms | 9.7 / 77 ms |
| **Budget** | | **1.04 ms** | **2.08 ms** |

**What it shows:**

1. **The exhaust's own speed sets the substep, not sound.** Leaving the engines at up to about
   280 m/s relative to the nozzles and the gas around it, across a 0.21 m smoothing length, a parcel
   needs about 22 substeps a step whatever the pressure solver. Seen from the gas (relative speeds)
   saves only 5%: the jet really is fast relative to its neighbours and the nozzle walls.
2. **The best rule (no sound term, relative speeds) saves about 31%**, and an implicit solver would
   spend some of that on its iterations. On the RTX at 1× that is 3.3 ms of gas a step against
   1.04 ms; at 4×, 15 ms.
3. **Per-parcel time steps don't shorten the chain**, so they don't help the GPU at all.
4. **Left untried:** a larger CFL number (0.25 now; many SPH codes use 0.3–0.4, worth up to 1.6×,
   needing an accuracy check), and coarser parcels near the nozzle. Even together with the best
   rule, these would leave the RTX at about 2 ms at 1× detail, and the iPad far off.

**Conclusion:** no parallel approximation or substep rule we found closes the gap. What to do next
with the GPU gas is open.

## 11. Larger time steps, and the free-flight prototype (7 November 2026)

### What limits the step, and the methods that lift it

The battle's exhaust is supersonic: up to about 278 m/s against a sound speed of about 161 m/s. Its
own speed sets about 22 of today's 30 substeps a step (§10), so methods that only remove the sound
term gain little here.

| Method | What it changes | Fit here |
|---|---|---|
| Implicit sound only ([Kwatra et al. 2009](https://portal.mardi4nfdi.de/wiki/Publication:1025167)) | The step limited by flow speed, not flow speed + sound | About 1.4× (30 → 22 substeps), less the solver's iterations |
| Gas on a grid with conservative semi-Lagrangian advection ([Lentine et al.](https://physbam.stanford.edu/papers/stanford2010-01.pdf), [Kwatra thesis](https://purl.stanford.edu/hn238xx1131)) | Gas may cross several cells a step (about 3 in their compressible tests) | The one true large-step route: about 4 substeps a step instead of 30 at 0.1 m cells. Suits GPUs. A rewrite: cut-cell walls for thrust, moving grid patches, more smearing |
| Hybrid: gas near bodies, free flight elsewhere (as rocket plumes in vacuum are modelled: continuum near the nozzle, free-molecular beyond; [UT Austin](https://cfpl.ae.utexas.edu/lunar-lander-plume-impingement), [hybrid continuum/DSMC](http://cfpl.ae.utexas.edu/wp-content/uploads/2009/05/AIAA_Orlando_Benedicte_152360.pdf), [UGKWP](https://arxiv.org/pdf/2303.13108)) | Same step; far less gas to step | Cuts the work, not the substeps: a CPU win. Prototyped below |
| A larger CFL number (0.25 → 0.3–0.4) | Longer substeps of the same method | Up to 1.6×; needs an accuracy check. Not yet tried |

### The free-flight prototype

`profile.gasFreeFlight` (off by default): each step, a parcel that can't come within that many
smoothing lengths of any body (its bounding circle), however both move in the step, is left out of
the gas step and drifts on its own (`freeFlightMask`, `flyFree` in `gas.ts`). It keeps its mass,
momentum and heat; it leaves by the gas step's own rules (bounds, far field, out of the plane), on
the ledger's books; and it rejoins the gas step as soon as it could come near a body, so splashes on
rocks and ground stay gas. Measured with `node scripts/free-flight.ts` (development container, Node, steady burn from step
60, one run):

| Free flight | Gas, ms a step | Whole step, ms | Parcels flying free | Substeps |
|---|---|---|---|---|
| Off | 23.6 | 30.1 | 0% | 30.4 |
| 2 smoothing lengths | **13.5** | **20.4** | 74% | 30.5 |
| 3 smoothing lengths | 14.0 | 20.5 | 72% | 50 (see note 5) |

What the gas does, free flight at 2 smoothing lengths against off:

| | Off | Free flight | Change |
|---|---|---|---|
| Mammoth's speed after 2 s (reference battle) | 12.57 m/s | 12.46 m/s | −0.9% |
| Gunship 3 / Gunship 2 / FLY | 24.84 / 14.23 / 6.97 m/s | 24.86 / 14.28 / 6.99 m/s | +0.1 / +0.3 / +0.3% |
| Push on the rocks in the plumes | 490 N·s | 458 N·s | −6.5% |
| LAND, both engines, climb after 1 s | 4.445 m/s | 4.491 m/s | +1.0% |
| Gunship 2, both engines, climb after 3 s | 21.20 m/s | 21.23 m/s | +0.1% |
| Ledger violations (all runs) | 0 | 0 | |

**What it shows:**

1. **The gas costs about 43% less** (23.6 → 13.5 ms a step): about three quarters of the parcels
   fly free, but the quarter left is the costly part (near walls and nozzles, with most of the wall
   contacts), and about 2.8 ms of the gas phase is overhead either way.
2. **Thrust is unchanged** (within 1%): the nozzles and chambers stay gas.
3. **Splashes are a little weaker** (−6.5% on the rocks): free gas doesn't spread from its own
   pressure, so the plume reaching a rock is narrower. Turning some of a free parcel's heat into
   spreading would fix most of it.
4. **The substeps are unchanged**: the fastest gas is at the nozzles, which stay gas. So this helps
   the CPU, not the GPU.
5. Note: at 3 smoothing lengths the substep average reads 50 in `scripts/free-flight.ts`, from
   some steps well above 30 (under the 200 the averages cut off at). Not yet investigated; the
   spinning-fragment bug is a likely cause.

Free gas uses the gas step's own far-field circles (`farFieldCirclesFor`), grown by the largest
smoothing length of all the gas, so the far field doesn't depend on which gas flies free (found in
review, PR #55).

**Next, if kept:** speed up the free parcels' move (about 0.5 ms for 650 parcels) and the fixed
overhead; let free gas spread with its heat; test the bodies' true outlines instead of their circles
(more gas could fly free); try a larger CFL number on the gas left.

## 12. Phase A: CPU speed-ups (7 November 2026)

Bit-identical unless stated. Reference battle with free flight unless stated.

| PR | Change | Result |
|---|---|---|
| #57 | Ledger: polygon moments and composition heat cached per object | `computeTotals` 0.176 → 0.068 ms a call; about 24.1 → 22.0 ms a step |
| #58 | Chamber shapes and weld topology checked by reference, not key strings | about 0.35 ms a step |
| #59 | Heat turned into motion drawn by pressure, not impulse share (physics fix, see §1) | step 155: 574 → 33 ms; no clamp; ship speeds and climbs within 0.1% |
| #60 | Engine grid, feed id map, weld loads summed up a spanning tree | 16 Mammoths 19.9 → 14.7 ms; 640-part ship's weld stage 21.8 → 3.2 ms; both now linear |
| #61 | **Closed, not merged.** Fewer short-lived objects (weld solver in plain numbers, ledger without objects), cluster search by reach | allocation 16.5 → 13.7 MB a step, but speed −1% (noise); cluster finding −14% |

**Lesson from #61:**
- Garbage collection is about 9% of the step, but cutting allocation by 17% didn't move the time measurably on desktop Node.
- The changes made the code harder to keep right. The weld solver became hand-expanded arithmetic, and the ledger got copies of the store-energy and inertia formulas, which would report false energy if the originals changed alone.
- Rule since: an optimisation must show a measured gain to be worth extra complexity.
- Worth revisiting only if phone tests show collection pauses causing stutter.
- Cluster finding is limited by plume density (each parcel has hundreds of parcels within reach), not by the search.

**Found along the way:**
- Each engine's first chamber-shape build costs about 10 ms: a start-up stutter with many ships.
- Step 0 (setup) is the battle's slowest step, at about 200 ms.

## 13. Phase B: the substep safety factor and free flight (7 November 2026)

The substep is CFL × h ÷ (sound speed + speed), CFL = 0.25. Measured with the factor set from outside for the experiment only (no code change kept): reference battle, 300 steps, steady from step 60; LAND (both engines 1 s) and Gunship 2 (both engines 3 s) climb speeds.

| CFL | substeps | tries a substep | gas ms (free flight on) | LAND m/s | GS2 m/s |
|---|---|---|---|---|---|
| 0.10 | | | | 4.15 | 16.4 |
| 0.15 | | | | 4.24 | 18.4 |
| 0.20 | 29.9 | 1.21 | 20.4 | 4.33 | 18.5 |
| **0.25** | 23.8 | 1.00 | **16.4** | 4.44 | 21.2 |
| 0.30 | 20.3 | 1.31 | 18.1 | 4.56 | 21.4 |
| 0.35 | 17.6 | 1.36 | 17.4 | 4.66 | 21.6 |
| 0.40 | 15.6 | 1.41 | 17.2 | 4.76 | 21.8 |

(Substeps are per cluster per step; tries count the halving retries when a parcel's heat would go below zero.)

**A larger factor doesn't pay.**
- From 0.25 to 0.4, substeps fall 35%, but retries rise from 1.00 to 1.41 a substep and take the saving back: gas costs more, not less.
- 0.25 happens to be the fastest setting measured. Why 0.20 retries more than 0.25 is not yet understood.

**The results depend on the substep.**
- LAND's climb rises about linearly with the factor: about +2 m/s per unit of CFL, or roughly +5% per 0.05.
- Extrapolated to a zero substep, it would be about 3.95 m/s, so at 0.25 the thrust reads about 12% high.
- Gunship 2 jumps more (16.4 → 21.2 m/s from 0.10 to 0.25), partly within its jet noise.
- So the gas model is not converged in time at the current setting. That is a physics-accuracy question to look into before any compromises are weighed (Phase C).
- Ledger violations stay 0 throughout, so energy and momentum are kept exactly; the bias is in how they're shared, not in what is conserved.

**Cause and fix: drift-kick-drift (7 November 2026).**
- **Where the extra thrust came from:** splitting the gas's push on LAND's hull by mechanism showed it was all in the pressure on the walls. Hard-wall bounces contributed nothing. That push grew linearly with the substep: 45.6, 53.6 and 62.0 N·s at CFL 0.10, 0.25 and 0.40.
- **Why:** each substep took its impulses at the positions at its start, then drifted. That is first order in the substep.
- **Fix:** each substep now drifts half, takes every impulse there, then drifts the rest with the new velocities (leapfrog). That is second order, at the same cost.
- **Retries:** when a retry shortens a substep, the rest of the drift still starts where the impulses acted, so momentum and angular momentum stay exact. An earlier version restarted the drift from the substep's start and broke the ledger in five tests.

| CFL | LAND old → new, m/s | Gunship 2 old → new, m/s |
|---|---|---|
| 0.05 | 4.071 → 4.014 | 16.06 → 15.74 |
| 0.10 | 4.152 → 4.027 | 16.42 → 15.81 |
| 0.25 | 4.444 → 4.071 | 21.20 → 15.91 |
| 0.30 | 4.559 → 4.072 | 21.42 → 16.07 |
| 0.40 | 4.755 → 4.111 | 21.77 → 16.83 |

(Free flight off, hull's climb speed; LAND after 1 s, Gunship 2 after 3 s.)

**What the numbers show:**
- Both integrators head for the same answer as the substep shrinks: LAND about 4.0 m/s, Gunship 2 about 15.7 m/s. So the fix removes time-step error and doesn't change the physics.
- At CFL 0.25 the new one is within 2% of that answer for both ships. The old one read 11% (LAND) and 35% (Gunship 2) high.
- At 0.3 the new one is within 3%, and at 0.4 Gunship 2 reads 7% high. In a quick check, the ledger also reported one violation in Gunship 2 at 0.35 and at 0.5. So CFL stays 0.25; 0.3 is an option to weigh later.

**Effect in the reference battle (480 steps, free flight on):**
- Step 25.9 → 22.8 ms; gas 18.6 → 16.1 ms; gas worst 5% 38.1 → 28.6 ms, from fewer retries.
- Ship speeds are lower because the thrust is now right: Mammoth −8%, Gunship 3 −4%, Gunship 2 −4%; the rocks' push −11%.

**Tests and tuning:**
- PRP-005's thrust band was lowered from > 0.80 to > 0.75 of the ideal choked-throat value. LAND now makes 79% of the ideal, down from 84%; the gap is the sparse parcels resolving the throat.
- Ships' engine rates or masses may want retuning for feel. That is a game decision.

**Free flight (margin 2 h):**
- About −45% of the step: 33.6 → 18.4 ms.
- Ship speeds within 1%, the rocks' push 5% lower, LAND +1%, Gunship 2 +0.1%.
- **Decision (7 November 2026): on in the sandbox profile** (`gasFreeFlight: 2`), so the game and the sandbox scenarios use it. The test profile keeps the full gas model as the reference.

## 14. Phase C first looks: helper threads, slower gas, less detail (7 November 2026)

**Helper threads (measured, not built).**
- Per reference-battle step (24 ms), the 5 cluster jobs take 11.1 ms in total, and the biggest alone takes 4.4 ms. The other 13 ms can't be split as things stand: preparing the gas and finding clusters, free flight, and the rigid-body step.
- Even with perfect threads the step would only fall to about 17 ms (−28%).
- Copying the jobs to helper threads and back with `structuredClone` costs 5.5 ms a step, which takes back almost all of that.
- Getting the 28% would need jobs packed as typed arrays (shapes sent once), a gas step that can wait for helpers (a split step, or shared memory, which GitHub Pages needs a service-worker workaround to allow), and a worker pool.
- **Parked:** too much machinery for the gain at this size. The gain grows with more ships, and so does the part that can't be split.

**Slower gas.**
- Test: gasScale 400 instead of 100 (exhaust and sound half as fast). Each engine's flow and parcel mass were doubled and its economy set ×2, so thrust, parcel count and fuel time stay as now.
- Ship speeds held (within 2%) and substeps halved (30.6 → 14.8).
- But gas fell only about 11% (18.2 → 16.2 ms; the noise between runs is a few ms).
- **Why:** at the same mass flow, slower exhaust packs the plume twice as densely, and 25% more parcels linger. Each substep then has about twice the neighbour pairs: contacts −36% and neighbours −16%, but pushes unchanged.
- **Not worth it on its own.** It also weakens explosions, since chemical energy is divided by the scale.

**Less detail** (parcels 4× heavier and 2× wider, about the same neighbours each, a quarter of the parcels):
- Gas 18 → 9.7 ms, step about 26 → 16 ms.
- **But** FLY can't fly (0.3 m/s): its small engine's chamber and nozzle can't hold parcels that size. The rocks' push is −33%.
- Adding slower gas on top gains nothing more (9.5 ms).
- Wider parcels alone, without fewer of them, were slower: same count, more neighbours each.
- So detail has to follow each engine's size: parcels sized to the nozzle, not one global setting.

## 15. Why fewer parcels make less thrust (7 November 2026)

**Setup:**
- LAND's two engines in open space (no gravity, no ground, as in PRP-005), firing to a steady state, then 0.5 s measured.
- The push on the hull is split into three parts:
  - the recoil as the chamber releases each parcel (`release` in `vessel.ts`);
  - the gas on the throat plug;
  - the gas on the nozzle walls.
- The ideal is the choked-throat thrust ṁ·c*·(1 + 1/γ) = ṁc* (jet) + ṁc*/γ (throat pressure, P*·A*).

| parcel mass | radius | parcels | thrust / ideal | recoil (ideal ṁc* ≈ 108 N) | plug (ideal P*A* ≈ 81 N) | nozzle walls |
|---|---|---|---|---|---|---|
| ×4 | ×1 | 18 | 0.78 | 111 N | 35 N | 6 N |
| ×2 | ×1 | 36 | 0.77 | 110 N | 34 N | 6 N |
| **×1 (today)** | ×1 | 69 | **0.79** | 111 N | 34 N | 10 N |
| ×0.5 | ×1 | 123 | 0.90 | 110 N | 34 N | 35 N |
| ×0.25 | ×1 | 238 | 0.94 | 110 N | 34 N | 45 N |
| ×0.125 | ×1 | 429 | 1.04 | 110 N | 45 N | 56 N |
| ×0.0625 | ×1 | 825 | 1.09 | 110 N | 49 N | 64 N |
| ×1 | ×1.5 | 63 | 0.87 | 111 N | 32 N | 29 N |
| ×1 | ×2 | 60 | 0.92 | 111 N | 29 N | 42 N |
| ×4 | ×2 | 17 | 0.86 | 111 N | 29 N | 27 N |
| ×0.25 | ×0.5 | 261 | 0.84 | 108 N | 35 N | 26 N |
| ×0.0625 | ×0.25 | 1,019 | 0.91 | 110 N | 49 N | 22 N |

**Findings:**
- **The recoil is right at every detail** (110 N against an ideal 108 N), because the chamber model sets the jet's mass flow and speed.
- **The throat plug gets about 42% of P*·A*** (34 of 81 N), and only starts to rise at much finer detail (49 N at ×0.0625). Fresh parcels leave the throat at the speed of sound, so they are within reach of the plug only briefly.
- **The nozzle walls are badly under-resolved:** 10 N today, 64 N at 16× the parcels and still rising.
  - At today's detail the exhaust of both engines is about 69 parcels, about two a step per engine: a string of beads, not a gas filling the nozzle.
  - A parcel's reach is fixed by its radius, whatever the spacing, so sparse parcels coast through the nozzle without pushing its walls.
  - Wider parcels recover some of the push even at the same count, so it is reach against the nozzle's size, not only parcel count.
- **Thrust has not settled even at 16× the parcels** (still +5% per halving of parcel mass). The settled value is probably about 1.1–1.2 of the throat-only ideal (a nozzle adds expansion thrust), so today's thrust reads roughly 25–35% low.
- This is the reverse of the old time-step error (§13), which read high and, for Gunship 2, more than made up for it.

**What it means:** thrust from SPH inside a nozzle needs many parcels per nozzle width; the game can't afford that for every engine. A better split would compute what is known exactly in the chamber model and leave SPH the plume:
- Push the throat pressure term P*·A* on the engine directly from the chamber's state, as the recoil already is, and stop the plug's SPH push (no double count).
- Possibly extend the chamber model through the nozzle (one-dimensional nozzle flow from the nozzle's area ratio), releasing parcels at the exit at the exit speed and pressure.

Thrust would then be right at any detail, the nozzle would need no SPH, and parcels could be sized to the plume instead of the nozzle: the per-engine detail of §14 without its thrust loss. To discuss.

**Done: the throat term from the chamber model (7 November 2026).**
- The jet now leaves the throat at c*·(1 + 1/γ), so the recoil is the ideal choked-throat thrust. Each kilogram still carries the throat's stagnation enthalpy (γu* + c*²/2), as heat plus motion.
- LAND in open space: 1.09, 1.05 and 1.11 of the ideal at ×4, ×1 and ×0.25 parcel mass (was 0.78, 0.79 and 0.94). The plug adds about 15 N and the nozzle walls 2–14 N.
- Reference battle with a cap of 500 parcels a second per engine: the step falls 24.2 → 18.1 ms. Gunship 3 and Gunship 2 lose 5% of their speed, against 18% without the fix; the Mammoth is unchanged.
- FLY's engines have no chamber, so the fix doesn't reach them; they still need their parcels.
- Every chamber engine is about 35% stronger than on main: open-space acceleration is LAND 5.86 → 7.97 m/s² and the Mammoth 5.87 → 8.23. The Mammoth test's bands and the spec's figures follow.

**Parcel cap in the sandbox (`profile.gasParcelRate`, 7 November 2026).**
- A chamber engine that would release more than the cap uses heavier parcels (rate ÷ cap): the same mass, momentum and energy in fewer parcels. Injectors without a chamber (FLY's engines, a gun's breech) keep their own parcels: their thrust or launch still depends on parcel size. Capping the breech failed a gun test (spin with and without drift 1.5×10⁻⁴ rad/s apart, limit 10⁻⁴).
- **Reference battle:** the step falls about 24.5 → 18.6 ms (−24%); the Mammoth is unchanged, the gunships are 3% slower, the ledger exact.
- **The cap is 1,000, not 500:** 500 saves no more in the battle. Its lumpier thrust (about two parcels a step at full command, fewer below it) spoiled the autopilot's hover (0.31 against the test's 0.15) and its stopping. A blast test also failed, through Gunship 2's gun breech.
- The test profile is uncapped.

## 16. Stutters: smooth drawing, and what is left (7 November 2026)

Measured in the stress test (Mammoth, two rocks, gunships added by the button).

- **Smooth drawing (PR #70): kept.** The worker hands over results in bunches about every 30 ms, so
  56% of frames (3 ships) and 66% (6 ships) showed no motion. The page now draws the latest world
  moved on by velocity to a steady clock (`src/app/smooth.ts`). No frames without motion; per-frame
  jerk p95 26 → 8 ms (3 ships) and 19 → 4 ms (6 ships) of game time. Drawing only: hashes unchanged.
- **Debris contacts: not the cause.** Over 40 s the world never had more than 50 contacts. The
  contact phase's 14–44 ms spikes came at 0–3 contacts and on different steps in two identical runs,
  so they are collection pauses or machine noise, not work. No change.
- **Only two spikes repeat run to run:** the first step, and a ship blowing up (t = 7.87 s, about
  20–40 ms). The blast step rebuilds the damaged ship's two engine chambers, about 8 ms each, on
  geometry that really is new.
- **Rebuilding only the hit ship's engines: no gain, dropped.** Checking whether the unhit ships'
  engines needed rebuilding after a weld broke elsewhere changed nothing (hashes identical). They
  already skipped it: the shape cache hit.
- **Left as is:** a faster chamber rebuild (fewer allocations in `computeShape`) could cut the blast
  step by about 10 ms. With smooth drawing the screen carries on through a step of that size, so it
  isn't worth the extra code unless play still shows it.

## 17. What wreckage costs (8 November 2026)

A stress test where 12 gunships fight for 60 s ends with 454 bodies: 424 of them wreckage, 12 rock, 18
still-flying ship parts. Timing the same 4 s from that moment (Node, best of 3):

| World | ms a step |
|---|---|
| As it is | 10.7 |
| Without wreckage that still does something (53 pieces) | 3.5 |
| Without any wreckage or dust | 0.6 |

- **Dust: about 0.4 ms.** It touches nothing and fades in 20–30 s. Keep it.
- **Inert wreckage (371 plates and parts): about 3 ms**, roughly 8 µs a piece.
- **Wreckage that still does something: about 7 ms.** That is 35 unexploded shells, 12 tanks still
  holding gas, 10 engines and 8 breaches. With only 9 gas parcels in the world, the gas machinery's
  work over every body each step was the cost.

Two fixes, both with identical results (world hashes unchanged in the reference scenarios and the
battle snapshot):

- **Leaks:** the check that nothing blocks a leak built walls for every body in the world each
  step. It now builds them only for bodies within reach of the leak point.
- **Gas walls:** the gas step's view of each body was an object literal with eight getters and
  setters, made fresh for every body every step: slow to create, and most of the collector's work.
  It is now a small class.

Battle snapshot: 8.4–9.3 → 6.4–7.2 ms a step (about 22% faster); collection pauses 2.4 → 0.55 ms a
step. Reference battle: unchanged within noise.

Left: the ledger's totals over every body (about 1.2 ms, called several times a step), and the gas
step's other passes over every body when there is little gas (far field, free-flight mask,
clusters: about 1.3 ms).

**Follow-up (8 November 2026), battle snapshot, interleaved runs: 6.8 → 6.0 ms a step.**

- **Ledger totals: kept.** `computeTotals` runs 17 times a step over every body. It now asks for
  inertia and store energy as plain numbers instead of making an object for each, with the same
  sums: 82 → 60 µs a call.
- **Gas phase takes only bodies near gas: kept.** It takes whole assemblies within reach of some
  gas: the far field, two smoothing lengths and twice the step's travel, with 5 m to spare. Engines
  holding chamber gas are always taken, and one moving body if none is near, so far gas still
  leaves. Gas phase 3.0 → 1.6 ms a step. Hashes unchanged in every test scenario and the battle; the
  margin is the only approximation.
- **Inert pieces, small clean-ups: dropped.** Per-body setup without a throwaway object, and
  grouping assemblies by appending instead of copying. Identical results but no measurable gain, so
  not worth the code.

## 18. The dynamic gas budget: tried, dropped (8 November 2026)

The idea (docs/gpu-gas-plan.md): cap the parcels the gas model simulates. Over the cap, the gas
farthest from any body leaves the model as drawn-only wisps. Built as profile `gasSimCap`:
- **Trim:** when over the cap, trim to 90% of it.
- **Rank:** by distance to the nearest body in 2 m grid cells, the oldest parcel first at equal
  distance.
- **Never trimmed:** gas in a cell a body touches.
- **Ledger:** what leaves is booked at the boundary. No ledger violations in any run.

| Scene (sandbox profile) | Most parcels | Gas, ms a step |
|---|---|---|
| Reference battle, no cap | 680 | 9.1 |
| Reference battle, cap 600 / 400 / 250 / 150 | 593 / 399 / 250 / 201 | 7.8 / 8.5 / 7.7 / 8.2 |
| Mammoth on full burn, 10 s | 71 | cap never triggers |
| Stress test, 6 gunships, 30 s | 287 | about 1.5 (no cap) |

- **Small gain.** Gas far from bodies was already cheap: free flight steps it with little work.
  The cost is the dense gas at the engines and the substeps (about 22 a step on full burn) that
  fast, hot exhaust forces. Trimming that would spoil thrust.
- **Different results.** The reference battle played out differently: one ship ended 15–40 m from
  where it ends with no cap.
- **Normal play never reaches a useful cap.** The parcel-rate limit, free flight and the far field
  already keep counts low.

Dropped under the simplicity rule. The patch is kept outside the repository in case very gas-heavy
scenes turn up. The lever for gas cost is the substep count, not the parcel count.

## How to send numbers

On each device, open https://oopsboogaloo.github.io/mammothspacebattles/gpu-spike.html in Chrome
(Android, Windows, macOS) or Safari or Chrome (iPadOS and iOS 26+). Keep the tab in front for about a
minute, press **Copy results** and paste the text back. On Windows, check the adapter line names the
graphics card; if not, set Chrome to High performance in Settings → System → Display → Graphics.
