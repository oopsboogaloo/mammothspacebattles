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

**Free flight (margin 2 h):**
- About −45% of the step: 33.6 → 18.4 ms.
- Ship speeds within 1%, the rocks' push 5% lower, LAND +1%, Gunship 2 +0.1%.
- **Decision (7 November 2026): on in the sandbox profile** (`gasFreeFlight: 2`), so the game and the sandbox scenarios use it. The test profile keeps the full gas model as the reference.

## How to send numbers

On each device, open https://oopsboogaloo.github.io/mammothspacebattles/gpu-spike.html in Chrome
(Android, Windows, macOS) or Safari or Chrome (iPadOS and iOS 26+). Keep the tab in front for about a
minute, press **Copy results** and paste the text back. On Windows, check the adapter line names the
graphics card; if not, set Chrome to High performance in Settings → System → Display → Graphics.
