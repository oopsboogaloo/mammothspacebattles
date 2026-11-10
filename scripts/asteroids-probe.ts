// Mammoth Asteroids, performance probe (docs/games/mammoth-asteroids-design.md §5 step 3): the step
// time of levels 1–6 before the game exists. Each level is that many rocks (12 m, 20 pieces, every
// piece pulling: AST-009) drifting in a wrapped 284 × 160 m arena, with the LAND ship (the flight
// test's, economy 20) in the middle firing both engines throughout. The budget is 6 ms a step.
//   node scripts/asteroids-probe.ts [--steps N] [--no-gravity] [--levels 8,10]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRng, getProfile, initialWorld, nextFloat, parseScenario, stepInPlace, type Command } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const steps = args.includes("--steps") ? Number(args[args.indexOf("--steps") + 1]) : 1200;
const pull = !args.includes("--no-gravity");
const levels = args.includes("--levels") ? args[args.indexOf("--levels") + 1].split(",").map(Number) : [1, 2, 3, 4, 5, 6];
const W = 284;
const H = 160;
const R = 12;

function level(n: number) {
  const raw = JSON.parse(readFileSync(join(root, "scenarios", "ft-asteroids.json"), "utf8"));
  raw.world.bodies = raw.world.bodies.filter((b: { id: string }) => !b.id.startsWith("rock-"));
  raw.world.bounds = { ...raw.world.bounds, min: { x: -W / 2, y: -H / 2 }, max: { x: W / 2, y: H / 2 } };
  const rng = createRng(1000 + n);
  const at: { x: number; y: number }[] = [];
  const far = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
    const dx = p.x - q.x - W * Math.round((p.x - q.x) / W);
    const dy = p.y - q.y - H * Math.round((p.y - q.y) / H);
    return dx * dx + dy * dy >= d * d;
  };
  while (at.length < n) {
    const p = { x: (nextFloat(rng) - 0.5) * W, y: (nextFloat(rng) - 0.5) * H };
    if (far(p, { x: 0, y: 0 }, 50) && at.every((q) => far(p, q, 2 * R + 8))) at.push(p);
  }
  raw.world.asteroids = at.map((position, k) => {
    const a = nextFloat(rng) * 2 * Math.PI;
    const v = 2 + 3 * nextFloat(rng);
    return {
      id: `a${n}-${k}`,
      seed: n * 100 + k,
      pieces: 20,
      radius: R,
      density: 20,
      bond: 20_000,
      material: { name: "rock", threshold: 200, toughness: 4000 },
      gold: 3,
      compounds: 2,
      goldIndestructible: true,
      ...(pull ? { gravity: { G: 0.02 } } : {}),
      position,
      velocity: { x: v * Math.cos(a), y: v * Math.sin(a) },
      angularVelocity: 0.2 * (nextFloat(rng) - 0.5),
    };
  });
  return parseScenario(raw);
}

const both: Command[] = [
  { type: "control.set", channel: "left", value: 1 },
  { type: "control.set", channel: "right", value: 1 },
];
console.log(`${steps} steps after 240 to warm up, engines firing${pull ? "" : ", no rock gravity"}`);
console.log("level  bodies  sources  parcels  mean ms  worst ms  violations");
for (const n of levels) {
  const scn = level(n);
  const profile = getProfile(scn.profile);
  const w = initialWorld(scn);
  for (let i = 0; i < 240; i++) stepInPlace(w, i === 0 ? both : [], profile);
  let total = 0;
  let worst = 0;
  for (let i = 0; i < steps; i++) {
    const t0 = performance.now();
    stepInPlace(w, [], profile);
    const t = performance.now() - t0;
    total += t;
    worst = Math.max(worst, t);
  }
  const sources = w.bodies.filter((b) => b.gravity).length;
  console.log(`${String(n).padStart(5)}  ${String(w.bodies.length).padStart(6)}  ${String(sources).padStart(7)}  ${String(w.gas.count).padStart(7)}  ${(total / steps).toFixed(2).padStart(7)}  ${worst.toFixed(1).padStart(8)}  ${String(w.ledger.violations).padStart(10)}`);
}
