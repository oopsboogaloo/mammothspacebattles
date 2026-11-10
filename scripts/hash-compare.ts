// Steps scenarios with this checkout's core and with another checkout's (the commit before a
// change, say) and compares the world's hash every step: the check that a port or an optimisation
// changes speed, never the physics.
//   git worktree add ../before origin/main
//   node scripts/hash-compare.ts --against ../before [--steps N] [--thrust] [--time] scenario.json ...
// --thrust pulses every control channel the world's links carry (from step 40: all on, one off, all
// off, a third of a second each), so engines fire and the gas, wisps and welds are all at work.
// --time also reports each core's ms a step (best of 3, no hashing) and its gas part.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type Core = typeof import("../src/core/index.ts");

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const flag = (name: string) => (args.includes(name) ? (args.splice(args.indexOf(name), 1), true) : false);
const against = opt("--against");
const steps = Number(opt("--steps") ?? 600);
const thrust = flag("--thrust");
const time = flag("--time");
if (!against || !args.length) {
  console.error("usage: node scripts/hash-compare.ts --against <checkout> [--steps N] [--thrust] [--time] scenario.json ...");
  process.exit(2);
}

const here: Core = await import("../src/core/index.ts");
const there: Core = await import(pathToFileURL(resolve(against, "src/core/index.ts")).href);

function run(core: Core, file: string, hashes: boolean) {
  const scn = core.parseScenario(JSON.parse(readFileSync(file, "utf8")));
  const profile = core.getProfile(scn.profile);
  const byStep = core.timelineByStep(scn);
  const world = core.initialWorld(scn);
  const pulse = (s: number) => {
    if (!thrust || s % 40) return [];
    // The links as they are now: the lander's ship arrives with the first step.
    const channels = [...new Set(world.links.flatMap((l) => (l.kind === "control" ? [l.channel] : [])))];
    const k = (s / 40 + 2) % 3;
    if (k === 1) return channels.slice(0, 1).map((channel) => ({ type: "control.set" as const, channel, value: 0 }));
    return channels.map((channel) => ({ type: "control.set" as const, channel, value: k === 0 ? 1 : 0 }));
  };
  const out: string[] = [];
  const parts: Record<string, number> = {};
  let gas = 0;
  let parcels = 0;
  let wisps = 0;
  let ms = 0;
  for (let s = 0; s < steps; s++) {
    const commands = [...(byStep.get(s) ?? []), ...pulse(s)];
    const t0 = performance.now();
    core.stepInPlace(world, commands, profile, time && !hashes ? { clock: () => performance.now(), out: parts } : undefined);
    ms += performance.now() - t0;
    gas += parts.gas ?? 0;
    // The other checkout may hold its gas as a list of parcels, this one as arrays: count either.
    const held = world.gas as unknown as { count?: number; parcels?: unknown[] };
    parcels = Math.max(parcels, held.count ?? held.parcels?.length ?? 0);
    wisps = Math.max(wisps, world.wisps?.length ?? 0);
    if (hashes) out.push(core.hashValue(world));
  }
  return { hashes: out, ms: ms / steps, gas: gas / steps, parcels, wisps };
}

let differ = 0;
for (const file of args) {
  const a = run(there, file, true);
  const b = run(here, file, true);
  const first = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
  if (first >= 0) differ++;
  let line = `${file.replace(/.*[\\/]/, "").padEnd(34)} ${first < 0 ? `identical over ${steps} steps` : `DIFFERS from step ${first}`} (up to ${b.parcels} parcels, ${b.wisps} wisps)`;
  if (time) {
    const best = (core: Core) => [0, 1, 2].map(() => run(core, file, false)).sort((x, y) => x.ms - y.ms)[0];
    const t = best(there);
    const h = best(here);
    line += `  ms/step ${t.ms.toFixed(3)} -> ${h.ms.toFixed(3)} (${(t.ms / h.ms).toFixed(2)}x)  | gas part ${t.gas.toFixed(3)} -> ${h.gas.toFixed(3)}`;
  }
  console.log(line);
}
process.exit(differ ? 1 : 0);
