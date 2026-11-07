# GPU gas: implementation plan

Agreed 6 November 2026. The decisions below stand as recommended unless changed.

**Status:** Phase 0 is done ([`perf/gpu-gas-phase0.md`](perf/gpu-gas-phase0.md)): no-go for Phase 1
as designed, on an iPad Pro and on a desktop with an RTX 40-series card. The gas at 4× detail
takes about 61 substeps a step, and a substep costs at least about 140 µs on the GPU however few the
parcels; the budget leaves about 7 µs. Phase 0b (Spikes 2 and 2b, one work-group per gas
cluster) met the same wall: the battle at 4× takes 23 ms of gas a step on the RTX and 116 ms on the
iPad. **The GPU spikes stop here**; next is a gas method with far fewer substeps, tried on the CPU
first ([`perf/gpu-gas-phase0.md`](perf/gpu-gas-phase0.md) §9). A further check of published approaches
and substep rules (§10) found none that closes the gap: the exhaust's own speed sets about two thirds
of today's substeps whatever the solver. What to do next is open.

## Goal

Run the gas on the GPU (WebGPU compute shaders) to buy **headroom**: the final game will have
several ships firing at once, explosions and leaks. Detail goes up only **4×** (parcels per
ship); the rest of the GPU's capacity is kept free for busy scenes. That still gives finer plumes
and better splashes on rocks and ground. Exact replay of the gas is given up; the physics
stays the same model (SPH-style parcels with pressure, walls, chemistry), checked by tolerances
instead of bit-identical hashes.

## What stays, what moves

| Part | Where | Why |
|---|---|---|
| Rigid bodies, welds, contacts, damage, AI, explosions' logic, tractors, duel | CPU (unchanged) | Tens to hundreds of objects, lots of branching: bad GPU work |
| Engine chambers (one volume each, PRP-011) | CPU (unchanged) | They set the thrust; keeping them on the CPU keeps control immediate |
| Free gas: plume, blast gas, leaks, fills | **GPU** | Thousands of identical particles: ideal GPU work |
| Wisps (plume tail) | **GPU**, later | Same reason; simple |
| Drawing the gas | Canvas 2D from a read-back copy first, then a WebGPU layer | Avoid reading the gas back every frame |

## How a frame works

The simulation already runs in a Web Worker, and its world step already pauses at the gas
phase to hand the gas to helper threads (`stepGasClustered` behind a generator in `world.ts`).
The GPU backend takes that same hand-off.

1. **Upload** (CPU → GPU, a few kB): every body's pose, velocity, angular velocity and shape,
   and any new parcels this frame (engine outlets, blasts, leaks) as a spawn list.
2. **GPU runs a batch** of steps (about 4 at 60 fps, 240 steps/s), each about 30 substeps, all on the GPU:
   1. bin parcels into a uniform grid (counting sort: atomic counts, prefix sum, scatter);
   2. density and pressure (each parcel gathers from its neighbours);
   3. pressure pushes and heating (gather again; each pair is computed from both sides);
   4. move, gravity, chemistry (burning h₂ + o₂ per parcel);
   5. walls: each parcel against the bodies filed in its grid cell (box, disc, polygon), with
      bodies moving through the batch at their uploaded velocities;
   6. sum each body's push from gas in fixed point (integer atomics: WGSL has no float atomics);
   7. far field, out-of-plane leaving (→ wisps), bounds; mark removed parcels;
   8. the next substep length from the fastest gas (a parallel max).
3. **Read back** (GPU → CPU, a few hundred bytes): each body's gas push per step, gas totals
   for the ledger, and the substep count. The CPU applies the pushes in the next batch: **one
   batch (~16 ms) late**.
4. **Draw**: Phase 1–3 read back positions and temperatures (about 16 bytes a parcel: 0.5 MB
   for 30,000) for the existing 2D renderer; Phase 4 draws straight from GPU memory.

## Headroom budget

Detail is set by a budget, not by what one ship can afford:

- **Reference battle** (a new benchmark scene, built in Phase 0 and kept): four ships firing
  all engines, the Mammoth among them, two explosions in the same second, asteroid hits.
- **Detail:** each ship's exhaust at 4× today's parcel count (parcels a quarter the mass).
- **Budget:** the reference battle must run in real time with the gas using **at most half** of
  the step time on a mid-range phone, and at most a quarter on your laptop. What is left covers
  more ships, bigger explosions and drawing.
- **Guard:** if a scene goes over budget anyway, the gas coarsens new parcels (heavier exhaust)
  until it is back under, instead of the game slowing down. It is shown in the HUD when it
  happens.

## Data on the GPU

Structure of arrays, 32-bit floats (WGSL has no 64-bit), fixed capacity (e.g. 65,536 parcels),
compacted after removals:

- position, velocity (vec2 each), mass, thermal energy, radius, age / keep (GAS-009);
- composition: six species fractions (air, helium, co2, h2o, h2, o2);
- id (for the leave threshold and colour noise), flags.

Precision check: the arena spans ±500 m; float32 resolves about 0.06 mm there, against parcel
radii of 35 mm and more. Fine. Long-run energy and momentum sums drift slightly: the ledger gets
tolerances (Phase 5).

## Phases

Each phase is its own PR (or a few), behind a switch (`?gpu=1`) until Phase 6. Players see no
change until then.

### Phase 0: spike (go/no-go on hardware), ~1 PR

- The reference battle scene (see the budget above), on today's CPU gas: its cost now is the
  baseline.
- A test page that runs a WebGPU compute pass in the simulation worker: 10k–100k particles,
  grid sort plus neighbour pressure, timed per substep.
- Run it on your devices (phone, laptop) and in CI's headless Chromium (WebGPU via its software
  adapter, if it works there; that decides how CI tests the GPU path).
- **Exit:** substep cost per 10k parcels on each device; an estimate of the reference battle at
  4× detail against the budget; whether CI can run WebGPU at all.

**Outcome (6 November 2026):** done, see [`perf/gpu-gas-phase0.md`](perf/gpu-gas-phase0.md).
Substep cost on an iPad Pro, desktop Intel UHD 770 and RTX 40 is 250, 685 and 140 µs at 4,000
parcels; the reference battle at 4× would take 37, 99 and 23 ms of gas a step against 1–2 ms. CI can
run WebGPU (SwiftShader) for correctness. No-go as designed.

### Phase 0b: Spike 2, one work-group per cluster, ~1 PR

**Outcome (6 November 2026):** no-go as built ([`perf/gpu-gas-phase0.md`](perf/gpu-gas-phase0.md) §7).
Clusters run side by side, but each is slow: about 80 µs a substep on the RTX and 146 µs on the
iPad even at one parcel a thread, from dependent loads from GPU main memory. The battle at 4×:
30 ms of gas a step on the RTX, 121 ms on the iPad (Spike 1: 23 and 37). Next: the same kernel
with each cluster's parcels in work-group memory (Spike 2b).

**Spike 2b outcome (7 November 2026):** no-go ([`perf/gpu-gas-phase0.md`](perf/gpu-gas-phase0.md)
§8–9). About 25% faster than Spike 2 on the RTX (58 µs a substep with most threads idle), no faster on
the iPad. The battle at 4×: 23 ms of gas a step on the RTX, 116 ms on the iPad.

- On the spike page, a fused mode: each gas cluster (NFR-004) runs in one work-group, looping over
  all its substeps (sort, density, force, move) with work-group barriers, so a step is one dispatch.
  Clusters run side by side; each can take its own substeps.
- Time it for clusters of 500–4,000 parcels, 1–8 at once, on the same devices.
- **Exit:** a substep near 10–20 µs (go: Phase 1 in this form), or not (try a large-time-step gas
  on the CPU first).

### Phase 1: gas core on the GPU, ~2 PRs

- Port pressure, heating, moving, gravity, substep rule, bounds and far field to WGSL.
- No bodies yet: compare against the CPU gas on SC-02 (gas in a box: pressure, temperature)
  and RS-07 (free expansion into vacuum: centre of mass stays put, spread rate).
- **Exit:** pressure within 2% of the CPU gas; momentum drift under 10⁻⁴ of the total.

### Phase 2: walls and the ships, ~2–3 PRs (the riskiest)

- Bodies as moving walls; gas pushes summed per body and fed back one batch late.
- Engine outlets spawn parcels on the GPU from the CPU chambers.
- LAND and FLY first, then GS3 and the Mammoth.
- **Exit:** thrust and exhaust speed within 5% of the CPU gas; LAND's landing test passes
  across 20 runs; flying feels the same to you.

### Phase 3: everything else that touches gas, ~2–3 PRs

- Chemistry and ignition, explosions' gas, store leaks (DMG-004), gas loads on welds
  (from the per-body pushes), wrapping arenas, wisps on the GPU, clusters retired (not needed).
- **Exit:** every scenario runs on the GPU path; e2e suite passes in Chromium with `?gpu=1`.

### Phase 4: drawing from the GPU, then 4× detail, ~2 PRs

- A WebGPU canvas under the 2D canvas draws the gas (and glow) straight from GPU memory; no
  per-frame read-back.
- Then raise detail **4×** (parcels a quarter the mass) and **retune the ships**: thrust depends
  on resolution, so each ship's numbers in the design log are re-measured.
- Add the over-budget guard.
- **Exit:** the reference battle within budget on your phone and laptop.

### Phase 5: tests, ledger and spec, ~1–2 PRs

- Gas tests become tolerance tests (thrust, pressure, plume speed) run on both backends.
- Determinism (DET-001…004) stays required for the CPU path and for gas-free scenes; the GPU
  path is "statistically the same". Replay/scrub on GPU restores snapshots but does not promise
  the same future.
- Ledger: rigid bodies checked as now; gas checked against tolerances.
- **Exit:** spec updated, CI green on both paths.

### Phase 6: switch over, ~1 PR

- GPU on by default where WebGPU exists; `?gpu=0` to opt out; CPU gas kept as the fallback
  (Firefox on Android, old devices) and for the Node tests.

## Decisions for you

1. **Keep the CPU gas as a fallback?** Recommended: yes. It keeps all the Node tests,
   Firefox Android and old devices working; it costs keeping two versions in step (shared
   constants, and the comparison tests in Phase 5 catch drift).
2. **Determinism:** keep it for everything except GPU gas (recommended), or drop it everywhere.
3. **Ledger:** keep checking gas with tolerances (recommended), or stop auditing gas.
4. **Start with Phase 0** before committing to the rest.

## Ideas weighed (6 November 2026)

Measured in the reference battle on the CPU gas (Node), after Phase 0.

| Idea | Finding | Status |
|---|---|---|
| **Speed limit on parcels** | The substep follows sound speed + parcel speed (here up to 161 + 278 m/s). A 200 m/s limit gives 31 → 27 substeps a step, clipping 9% of parcels; 100 m/s gives 21, clipping 57%. Even with every parcel still, sound alone needs 13, so 2.4× at most. It cuts thrust (exhaust is about 160 m/s), deletes momentum, penalises fast ships and weakens blasts. | Rejected |
| **Pulsed engines** | 4 steps on, 4 off: still 5 clusters, the biggest half the size; parcels, cost and thrust all halve, like half throttle; substeps barely fall (30 → 28). The puffs don't separate into clusters. | No performance gain |
| **Hard split of a big cluster** (each piece sees the others a step late) | News travels up to about 1.6 m a step at the cut; pushes stop being equal and opposite, so momentum leaks; waves partly reflect at the cut. | Rejected |
| **Split with overlapping borders** (each piece also steps a border strip of its neighbours' parcels; borders swapped every k substeps) | Exact for its own parcels for k substeps if the strip is k reaches wide. Costs duplicate work in the strips (about 50–70% for a 10 m plume in 4 pieces at k = 8) and a few GPU-wide waits a step, not about 430. | Fallback in Phase 0b for one oversized cluster |
| **Sources don't mix** (gas interacts only with gas from the same source: a ship, a shell burst, a tank leak) | Gas still pushes every body, and a ship's own plumes still interact; crossing plumes pass through each other. Cluster size is bounded by one ship's gas (the Mammoth's, about 1,400 parcels at 4×), and finding clusters becomes nearly free (6.1 of 22.5 ms a step on the CPU in the reference battle). It would apply to the CPU gas too, to keep the two in step. | **Kept as an option for later**; sources mix for now |

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| CI can't run WebGPU headless | GPU path untested in CI | Phase 0 checks; fallback: software adapter, or a self-hosted runner |
| One-batch lag on gas pushes | Splashes push rocks ~16 ms late; landing on own exhaust feels softer | Chambers (thrust) stay CPU; measure in Phase 2; smaller batches if needed |
| Phones' GPUs vary, throttle when hot | Uneven frame rate | Detail scales with measured speed; CPU fallback |
| GPU device lost (driver reset, tab in background) | Gas vanishes | Rebuild from the last read-back snapshot |
| Two gas implementations drift apart | Different behaviour by browser | Shared constants; cross-check tests on fixed scenes |
| Higher resolution changes thrust | Ships handle differently | Retune per ship in Phase 4; design log updated |
| Debugging shaders is harder | Slower progress on gas bugs | Debug read-backs; keep the CPU gas as the reference |

## What we'd measure to call it a success

- The reference battle in real time with the gas within budget (half the step on a mid-range
  phone, a quarter on your laptop).
- 4× more parcels in a plume with the same thrust (after retuning).
- Splash on a rock and on the ground visibly richer than today (side-by-side screenshots).

## References

- WebGPU support: [web.dev, WebGPU in major browsers](https://web.dev/blog/webgpu-supported-major-browsers)
- WebGPU particle fluids at 30k–70k particles on integrated graphics:
  [webgpu-ocean](https://github.com/matsuoka-601/webgpu-ocean),
  [Codrops: a journey into WebGPU fluids](https://tympanus.net/codrops/2025/01/29/particles-progress-and-perseverance-a-journey-into-webgpu-fluids/)
- No float atomics in WGSL; integer/compare-exchange workarounds:
  [example scatter-add shader](https://docs.rs/crate/hanzo-ml/0.11.70/source/src/wgpu/shaders/scatter_add_set.wgsl)
- Current gas design and what was tried: `docs/spec.md` §9.4–9.5 and §10.1
