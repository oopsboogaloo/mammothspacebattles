// The Rust trial: steps scenarios with the TypeScript solver and the WebAssembly one and compares
// the world's hash every step, then times both and counts what each allocates.
//   node scripts/wasm-compare.ts [--steps N] [--time] [--thrust] scenario.json ...
// --thrust pulses every control channel the scenario's links carry (all on, one off, all off, each
// a third of a second), so engines fire and the gas step is compared too.
import { readFileSync } from "node:fs";
import { hashValue, getProfile, initialWorld, parseScenario, setWasmSolver, stepInPlace, timelineByStep, type Command } from "../src/core/index.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const steps = Number(opt("--steps") ?? 600);
const time = args.includes("--time") ? (args.splice(args.indexOf("--time"), 1), true) : false;
const thrust = args.includes("--thrust") ? (args.splice(args.indexOf("--thrust"), 1), true) : false;

function run(file: string, wasm: boolean, hashes: boolean) {
  setWasmSolver(wasm);
  const scn = parseScenario(JSON.parse(readFileSync(file, "utf8")));
  const profile = getProfile(scn.profile);
  const byStep = timelineByStep(scn);
  const world = initialWorld(scn);
  const pulse = (s: number): Command[] => {
    if (!thrust || s % 40) return [];
    // The links as they are now: the lander's ship arrives with the first step.
    const channels = [...new Set(world.links.flatMap((l) => (l.kind === "control" ? [l.channel] : [])))];
    if (!channels.length) return [];
    const k = (s / 40) % 3;
    if (k === 0) return channels.map((channel) => ({ type: "control.set", channel, value: 1 }));
    if (k === 1) return [{ type: "control.set", channel: channels[0], value: 0 }];
    return channels.map((channel) => ({ type: "control.set", channel, value: 0 }));
  };
  let parcels = 0;
  const out: string[] = [];
  const sub: Record<string, number> = {};
  const parts: Record<string, number> = {};
  const t0 = performance.now();
  for (let s = 0; s < steps; s++) {
    stepInPlace(world, [...(byStep.get(s) ?? []), ...pulse(s)], profile, time ? { clock: () => performance.now(), out: parts } : undefined);
    parcels = Math.max(parcels, world.gas.parcels.length);
    if (time) for (const [k, v] of Object.entries(parts)) sub[k] = (sub[k] ?? 0) + v;
    if (hashes) out.push(hashValue(world));
  }
  return { hashes: out, ms: performance.now() - t0, sub, parcels };
}

for (const file of args) {
  const name = file.replace(/.*[\/]/, "");
  const a = run(file, false, true);
  const b = run(file, true, true);
  const first = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
  let line = `${name.padEnd(34)} ${first < 0 ? `identical over ${steps} steps` : `DIFFERS from step ${first}`} (up to ${a.parcels} parcels)`;
  if (time) {
    const best = (w: boolean) => [0, 1, 2].map(() => run(file, w, false)).sort((x, y) => x.ms - y.ms)[0];
    const ts = best(false);
    const rs = best(true);
    const c = (r: typeof ts) => (r.sub.contacts ?? 0) + (r.sub.integrate ?? 0);
    const gas = (r: typeof ts) => r.sub.gas ?? 0;
    line += `  ms/step TS ${(ts.ms / steps).toFixed(3)} WASM ${(rs.ms / steps).toFixed(3)}  | contacts+integrate ms/step TS ${(c(ts) / steps).toFixed(3)} WASM ${(c(rs) / steps).toFixed(3)}  | gas ms/step TS ${(gas(ts) / steps).toFixed(3)} WASM ${(gas(rs) / steps).toFixed(3)}`;
  }
  console.log(line);
}
