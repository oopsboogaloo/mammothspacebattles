# GPU gas, Phase 0: reference battle and WebGPU spike

Phase 0 of the GPU gas plan (`docs/gpu-gas-plan.md`, PR #48). Measured 6 November 2026.
The verdict waits on the phone and laptop runs of the spike page.

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

## 3. Estimate against the budget, before device numbers

The budget per substep is small:
- the reference battle at 4× detail is about 3,700 parcels at 61 substeps a step;
- the full gas is 2.47 × the spike's passes.

| | Gas budget a step | Spike budget a substep |
|---|---|---|
| Mid-range phone (½ step) | 2.08 ms | **14 µs** |
| Laptop (¼ step) | 1.04 ms | **6.9 µs** |

The spike runs 7 dispatches a substep. Measurements across four GPU vendors and three browsers put WebGPU's marginal cost per dispatch at 24–36 µs on Vulkan and 32–71 µs on Metal ([arXiv 2604.02344](https://arxiv.org/abs/2604.02344)). By those figures a substep costs 170–500 µs before any parcel is moved: 12–70× over budget, at any parcel count.

**Expected verdict: no-go for the plan as written.** The per-substep fixed cost, not parcel throughput, sets the cost. The spike's 1,000-parcel row measures that fixed cost on each device, and the page's verdict is the real answer.

Levers, if the devices confirm it:

| Lever | Effect on dispatches a step |
|---|---|
| Sort once a step (cells with a skin), not every substep | 7 → 2 a substep |
| Density folded into the force pass (density from the last substep) | 2 → 1 a substep |
| Fewer substeps: keep today's parcel size near ships, finer only where cheap; or per-parcel substeps on the GPU | 61 → 30 or fewer |
| Smaller budget share, or 2× detail instead of 4× | — |

None of these fixes the 6.3 ms non-gas step: that needs its own work before real time is possible.

## How to send numbers

On each device, open the page in Chrome (Android) or Safari (iOS 26+). Desktop Chrome, Edge or Safari works too. Keep the tab in front for about a minute, press **Copy results** and paste the text back.
