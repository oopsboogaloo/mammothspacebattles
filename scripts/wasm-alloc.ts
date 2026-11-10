// The Rust trial: steps one scenario with one solver, for a GC trace to count what it allocates.
//   node --trace-gc --trace-gc-nvp scripts/wasm-alloc.ts scenario.json ts|wasm [steps] [warm-up]
import { readFileSync } from "node:fs";
import { getProfile, initialWorld, parseScenario, setWasmSolver, stepInPlace, timelineByStep } from "../src/core/index.ts";

const [file, mode, stepsArg, warmArg] = process.argv.slice(2);
setWasmSolver(mode === "wasm");
const scn = parseScenario(JSON.parse(readFileSync(file, "utf8")));
const profile = getProfile(scn.profile);
const byStep = timelineByStep(scn);
const world = initialWorld(scn);
const warm = Number(warmArg ?? 240);
const steps = Number(stepsArg ?? 1200);
for (let s = 0; s < warm + steps; s++) {
  if (s === warm) console.log("MARK start");
  stepInPlace(world, byStep.get(s) ?? [], profile);
}
console.log(`MARK end ${steps} steps, ${profile.timestep} s`);
