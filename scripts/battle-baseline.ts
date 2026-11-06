// Baseline cost of the reference battle on the CPU gas (docs/gpu-gas-plan.md, Phase 0).
//   node scripts/battle-baseline.ts [--steps 480] [--json docs/perf/reference-battle-baseline.json]
// Steps the scene and reports, per step: total and gas time, parcels, substeps and parcel-substeps.
// "Steady" is the burn after the chambers have filled (from step 60), without the steps where the
// substep fell to its floor (more than 200 substeps; see `clamped`); "all" is every step.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gasClusters, getProfile, initialWorld, parseScenario, stepInPlace, timelineByStep, wallBodies } from "../src/core/index.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const steps = Number(opt("--steps", "480"));
const jsonOut = opt("--json", "");
const root = new URL("..", import.meta.url).pathname;
const scn = parseScenario(JSON.parse(readFileSync(join(root, "scenarios", "reference-battle.json"), "utf8")));
const profile = getProfile(scn.profile);
const byStep = timelineByStep(scn);
const world = initialWorld(scn);

interface StepRow {
  ms: number;
  gasMs: number;
  parcels: number;
  substeps: number;
  phases: Record<string, number>;
}
const rows: StepRow[] = [];
const out: Record<string, number> = {};
const clock = () => performance.now();
// Gas clusters (NFR-004) every 20 steps from step 60, sizes largest first: what a GPU work-group per
// cluster would each have to step (docs/gpu-gas-plan.md, Phase 0b).
const clusterSamples: number[][] = [];
for (let s = 0; s < steps; s++) {
  for (const k of Object.keys(out)) delete out[k];
  const t0 = clock();
  stepInPlace(world, byStep.get(s) ?? [], profile, { clock, out });
  const ms = clock() - t0;
  rows.push({ ms, gasMs: out.gas ?? 0, parcels: world.gas.parcels.length, substeps: world.gas.substeps, phases: { ...out } });
  if (s >= 60 && s % 20 === 0)
    clusterSamples.push(gasClusters(world.gas.parcels, wallBodies(world.bodies), world.joints, profile.timestep).map((c) => c.parcels.length).sort((a, b) => b - a));
}
const ranks = Math.max(...clusterSamples.map((c) => c.length));
const clusters = {
  count: Math.round((10 * clusterSamples.reduce((a, c) => a + c.length, 0)) / clusterSamples.length) / 10,
  /** Mean size of the largest, second largest, … cluster. */
  sizes: Array.from({ length: ranks }, (_, r) => Math.round(clusterSamples.reduce((a, c) => a + (c[r] ?? 0), 0) / clusterSamples.length)),
};

const CLAMP = 200;
const summary = (rs: StepRow[]) => {
  const mean = (f: (r: StepRow) => number) => rs.reduce((a, r) => a + f(r), 0) / Math.max(1, rs.length);
  const sorted = (f: (r: StepRow) => number) => rs.map(f).sort((a, b) => a - b);
  const pct = (f: (r: StepRow) => number, p: number) => {
    const v = sorted(f);
    return v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
  };
  const phases: Record<string, number> = {};
  for (const r of rs) for (const [k, v] of Object.entries(r.phases)) phases[k] = (phases[k] ?? 0) + v / rs.length;
  const ps = mean((r) => r.parcels * r.substeps);
  const gas = mean((r) => r.gasMs);
  const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
  return {
    steps: rs.length,
    msPerStep: round(mean((r) => r.ms)),
    gasMsPerStep: round(gas),
    gasMsP95: round(pct((r) => r.gasMs, 0.95)),
    otherMsPerStep: round(mean((r) => r.ms - r.gasMs)),
    parcels: Math.round(mean((r) => r.parcels)),
    parcelsMax: Math.max(...rs.map((r) => r.parcels)),
    substeps: round(mean((r) => r.substeps), 1),
    parcelSubstepsPerStep: Math.round(ps),
    usPerParcelSubstep: round((1000 * gas) / Math.max(1, ps), 3),
    realTimeFactor: round((1000 * profile.timestep) / mean((r) => r.ms), 3),
    phasesMs: Object.fromEntries(Object.entries(phases).map(([k, v]) => [k, round(v)])),
  };
};
const steady = rows.filter((r, s) => s >= 60 && r.substeps <= CLAMP);
const clamped = rows.map((r, s) => (r.substeps > CLAMP ? s : -1)).filter((s) => s >= 0);
const detonations = world.events.filter((e) => e.type === "detonation").map((e) => e.tick);
const result = {
  scenario: scn.name,
  node: process.version,
  date: new Date().toISOString().slice(0, 10),
  stepsPerSecond: Math.round(1 / profile.timestep),
  detonations,
  clamped: clamped.length ? { count: clamped.length, from: clamped[0], to: clamped[clamped.length - 1] } : null,
  steady: { ...summary(steady), clusters },
  all: summary(rows),
};
console.log(JSON.stringify(result, null, 2));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2) + "\n");
