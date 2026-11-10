// The Rust trial: steps scenarios with the TypeScript solver and the WebAssembly one and compares
// the world's hash every step, then times both and counts what each allocates.
//   node scripts/wasm-compare.ts [--steps N] [--time] scenario.json ...
import { readFileSync } from "node:fs";
import { hashValue, getProfile, initialWorld, parseScenario, setWasmSolver, stepInPlace, timelineByStep } from "../src/core/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const steps = Number(opt("--steps") ?? 600);
const time = args.includes("--time") ? (args.splice(args.indexOf("--time"), 1), true) : false;

function run(file: string, wasm: boolean, hashes: boolean) {
  setWasmSolver(wasm);
  const scn = parseScenario(JSON.parse(readFileSync(file, "utf8")));
  const profile = getProfile(scn.profile);
  const byStep = timelineByStep(scn);
  const world = initialWorld(scn);
  const out: string[] = [];
  const sub: Record<string, number> = {};
  const parts: Record<string, number> = {};
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    stepInPlace(world, byStep.get(s) ?? [], profile, time ? { clock: () => performance.now(), out: parts } : undefined);
    if (time) for (const [k, v] of Object.entries(parts)) sub[k] = (sub[k] ?? 0) + v;
    if (hashes) out.push(hashValue(world));
  }
  return { hashes: out, ms: performance.now() - t0, sub };
}

for (const file of args) {
  const name = file.replace(/.*[\/]/, "");
  const a = run(file, false, true);
  const b = run(file, true, true);
  const first = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
  let line = `${name.padEnd(34)} ${first < 0 ? `identical over ${steps} steps` : `DIFFERS from step ${first}`}`;
  if (time) {
    const best = (w: boolean) => [0, 1, 2].map(() => run(file, w, false)).sort((x, y) => x.ms - y.ms)[0];
    const ts = best(false);
    const rs = best(true);
    const c = (r: typeof ts) => (r.sub.contacts ?? 0) + (r.sub.integrate ?? 0);
    line += `  ms/step TS ${(ts.ms / steps).toFixed(3)} WASM ${(rs.ms / steps).toFixed(3)}  | contacts+integrate ms/step TS ${(c(ts) / steps).toFixed(3)} WASM ${(c(rs) / steps).toFixed(3)}`;
  }
  console.log(line);
}
