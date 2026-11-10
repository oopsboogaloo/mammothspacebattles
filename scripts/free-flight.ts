// Free-flight prototype (docs/perf/gpu-gas-phase0.md §11): gas that can't come within a margin of
// any body flies on without pressure. Compares margins against free flight off: cost in the reference
// battle, and what the gas does (ships' speed from thrust, the push plumes give the rocks behind the
// ships, LAND's climb, Gunship 2's climb).
//   node scripts/free-flight.ts [--margins 2,3,4] [--steps 480]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, timelineByStep, type Command, type Profile, type World } from "../src/core/index.ts";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const margins = opt("--margins", "2,3,4").split(",").map(Number);
const steps = Number(opt("--steps", "480"));
const root = new URL("..", import.meta.url).pathname;
const load = (name: string) => parseScenario(JSON.parse(readFileSync(join(root, "scenarios", `${name}.json`), "utf8")));
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const speed = (w: World, id: string) => {
  const v = assemblyTotals(w, id)!.velocity;
  return Math.hypot(v.x, v.y);
};

interface Run {
  world: World;
  msPerStep: number;
  gasMsPerStep: number;
  substeps: number;
  parcels: number;
  freeShare: number;
}
function run(name: string, n: number, margin: number | undefined, extra: Record<number, Command[]> = {}): Run {
  const scn = load(name);
  const base = getProfile(scn.profile);
  const profile: Profile = { ...base, gasFreeFlight: margin };
  const tl = timelineByStep(scn);
  const world = initialWorld(scn);
  const out: Record<string, number> = {};
  let ms = 0;
  let gas = 0;
  let sub = 0;
  let parcels = 0;
  let free = 0;
  let k = 0;
  for (let s = 0; s < n; s++) {
    for (const key of Object.keys(out)) delete out[key];
    const t0 = performance.now();
    stepInPlace(world, [...(tl.get(s) ?? []), ...(extra[s] ?? [])], profile, { clock: () => performance.now(), out });
    const t = performance.now() - t0;
    // Steady burn from step 60, without the steps the spinning-fragment bug sends to the substep floor.
    if (s >= 60 && world.gas.substeps <= 200) {
      ms += t;
      gas += out.gas ?? 0;
      sub += world.gas.substeps;
      parcels += world.gas.count;
      free += world.gas.free ?? 0;
      k++;
    }
  }
  return { world, msPerStep: ms / k, gasMsPerStep: gas / k, substeps: sub / k, parcels: parcels / k, freeShare: free / Math.max(1, parcels) };
}

/** Momentum the rocks in the plumes (rock-c behind the Mammoth, rock-d behind Gunship 2) have taken up. */
function rockPush(w: World): number {
  let px = 0;
  let py = 0;
  for (const b of w.bodies)
    if (b.id.startsWith("rock-c") || b.id.startsWith("rock-d")) {
      px += b.mass * b.velocity.x;
      py += b.mass * b.velocity.y;
    }
  return Math.hypot(px, py);
}

const configs: (number | undefined)[] = [undefined, ...margins];
const label = (m: number | undefined) => (m === undefined ? "off" : `${m} h`);
console.log(`reference battle, ${steps} steps (steady: from step 60)`);
console.log("free flight   ms/step  gas ms  substeps  parcels  free   MAM m/s  GS3 m/s  GS2 m/s  FLY m/s  rocks N·s  violations");
for (const m of configs) {
  const r = run("reference-battle", steps, m);
  const w = r.world;
  console.log(
    [
      label(m).padEnd(12),
      r.msPerStep.toFixed(1).padStart(8),
      r.gasMsPerStep.toFixed(1).padStart(7),
      r.substeps.toFixed(1).padStart(9),
      r.parcels.toFixed(0).padStart(8),
      `${(100 * r.freeShare).toFixed(0)}%`.padStart(5),
      speed(w, "mam-cockpit").toFixed(2).padStart(9),
      speed(w, "gs3-hull").toFixed(2).padStart(8),
      speed(w, "gs2-hull").toFixed(2).padStart(8),
      speed(w, "fly-hull").toFixed(2).padStart(8),
      rockPush(w).toFixed(2).padStart(10),
      String(w.ledger.violations).padStart(11),
    ].join(" "),
  );
}
console.log("\nLAND both engines 1 s, GS2 both engines 3 s (gas fingerprint cases): climb speed, m/s");
for (const m of configs) {
  const land = run("land-twin-engine", 240, m, { 0: [set("left", 1), set("right", 1)] }).world;
  const gs2 = run("gunship-2", 720, m, { 0: [set("left", 1), set("right", 1)] }).world;
  console.log(`${label(m).padEnd(12)} LAND vy ${assemblyTotals(land, "hull")!.velocity.y.toFixed(3)}   GS2 vy ${assemblyTotals(gs2, "hull")!.velocity.y.toFixed(3)}   violations ${land.ledger.violations + gs2.ledger.violations}`);
}
