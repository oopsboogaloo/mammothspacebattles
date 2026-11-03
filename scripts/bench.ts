// Benchmark (NFR-001, LED-004): steps per second for every scenario, plus
// per-subsystem time for each.
//   node scripts/bench.ts [--steps N] [--json out.json] [scenario.json ...]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getProfile, initialWorld, parseScenario, stepInPlace, timelineByStep } from "../src/core/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const stepsOverride = opt("--steps");
const jsonOut = opt("--json");
const root = new URL("..", import.meta.url).pathname;
const files = args.length ? args : readdirSync(join(root, "scenarios")).filter((f) => f.endsWith(".json")).sort().map((f) => join(root, "scenarios", f));

interface Row {
  scenario: string;
  bodies: number;
  parcels: number;
  /** Gas substeps in the last step. */
  substeps: number;
  steps: number;
  ms: number;
  stepsPerSecond: number;
  realTimeFactor: number;
  subsystemsMs: Record<string, number>;
}
const rows: Row[] = [];
for (const file of files) {
  const scn = parseScenario(JSON.parse(readFileSync(file, "utf8")));
  const profile = getProfile(scn.profile);
  const steps = stepsOverride ? Number(stepsOverride) : scn.end.steps;
  const byStep = timelineByStep(scn);
  const world = initialWorld(scn);
  const sub: Record<string, number> = {};
  const out: Record<string, number> = {};
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    stepInPlace(world, byStep.get(s) ?? [], profile, { clock: () => performance.now(), out });
    for (const [k, v] of Object.entries(out)) sub[k] = (sub[k] ?? 0) + v;
  }
  const ms = performance.now() - t0;
  const sps = steps / (ms / 1000);
  rows.push({
    scenario: scn.name,
    bodies: world.bodies.length,
    parcels: world.gas.parcels.length,
    substeps: world.gas.substeps,
    steps,
    ms: Math.round(ms * 10) / 10,
    stepsPerSecond: Math.round(sps),
    realTimeFactor: Math.round(sps * profile.timestep * 100) / 100,
    subsystemsMs: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  });
}

const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`${"scenario".padEnd(26)}${pad("bodies", 7)}${pad("parcels", 8)}${pad("substeps", 9)}${pad("steps", 7)}${pad("ms", 9)}${pad("steps/s", 10)}${pad("× real time", 13)}`);
for (const r of rows)
  console.log(
    `${r.scenario.padEnd(26)}${pad(r.bodies, 7)}${pad(r.parcels, 8)}${pad(r.substeps, 9)}${pad(r.steps, 7)}${pad(r.ms, 9)}${pad(r.stepsPerSecond, 10)}${pad(r.realTimeFactor, 13)}`,
  );
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ node: process.version, rows }, null, 2) + "\n");
