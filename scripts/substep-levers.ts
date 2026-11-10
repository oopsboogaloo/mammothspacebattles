// How many substeps the reference battle's gas would need under different substep rules
// (docs/perf/gpu-gas-phase0.md §10). The GPU spikes showed the GPU gas's cost is set by its chain of
// dependent substeps, so the number of substeps is the lever. Measured on today's gas: each rule's
// substep is worked out from the same states, not run.
//   node scripts/substep-levers.ts [--steps 480]
//
// Rules, each with the substep = CFL × h ÷ (a speed), CFL = 0.25, h the smallest smoothing length,
// per cluster (NFR-004; on the GPU each cluster runs alongside the others):
//   today       sound + parcel speed, and each body's speed + |ω| × 50 m (gas.ts signalSpeed)
//   bodySize    the same, with each body's own size in place of 50 m
//   relative    sound + the fastest speed of a parcel relative to a neighbour or a nearby body:
//               the same rule seen from the gas, not the arena (Galilean invariant)
//   implicit    no sound term (pressure solved implicitly): parcel speed relative to the arena
//   implicitRel no sound term: the fastest relative speed only (the advection limit of a Lagrangian method)
// Then the GPU's gas time a step, the largest over clusters of substeps × the measured time a
// substep at that cluster's size (Spike 2b, docs/perf/gpu-spike-results.json), × 2.47 for walls and
// the rest, at 1× and 4× detail (4× the parcels, half the smoothing length: 2× the substeps).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gasClusters, getProfile, initialWorld, mixture, parseScenario, SMOOTHING, stepInPlace, timelineByStep, wallBodies, type Body, parcelsOf } from "../src/core/index.ts";

const args = process.argv.slice(2);
const steps = Number(args[args.indexOf("--steps") + 1] ?? 480) || 480;
const root = new URL("..", import.meta.url).pathname;
const scn = parseScenario(JSON.parse(readFileSync(join(root, "scenarios", "reference-battle.json"), "utf8")));
const profile = getProfile(scn.profile);
const dt = profile.timestep;
const byStep = timelineByStep(scn);
const world = initialWorld(scn);
const results = JSON.parse(readFileSync(join(root, "docs", "perf", "gpu-spike-results.json"), "utf8"));

const RULES = ["today", "bodySize", "relative", "implicit", "implicitRel"] as const;
type Rule = (typeof RULES)[number];

function bodyRadius(b: Body): number {
  const s = b.shape as { kind: string; radius?: number; width?: number; height?: number; vertices?: { x: number; y: number }[] };
  if (s.kind === "disc") return s.radius ?? 0;
  if (s.kind === "box") return 0.5 * Math.hypot(s.width ?? 0, s.height ?? 0);
  return Math.max(0, ...(s.vertices ?? []).map((v) => Math.hypot(v.x, v.y)));
}

/** Substeps a step for one cluster under every rule. */
function clusterSubsteps(pIdx: number[], bIdx: number[], walls: ReturnType<typeof wallBodies>): Record<Rule, number> {
  const ps = pIdx.map((i) => parcelsOf(world.gas)[i]);
  const bs = bIdx.map((k) => world.bodies.find((b) => b.id === walls[k].id)!).filter((b) => b && !b.fixed);
  let hmin = Infinity;
  let hmax = 0;
  for (const p of ps) {
    hmin = Math.min(hmin, SMOOTHING * p.radius);
    hmax = Math.max(hmax, SMOOTHING * p.radius);
  }
  const c = ps.map((p) => {
    const m = mixture(p.composition);
    return Math.sqrt(m.gamma * (m.gamma - 1) * Math.max(0, p.thermal / p.mass));
  });
  const speed = ps.map((p) => Math.hypot(p.velocity.x, p.velocity.y));
  // Fastest speed of each parcel relative to a neighbour (within h) or to a nearby body's surface.
  const rel = new Float64Array(ps.length);
  const cells = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / hmax)},${Math.floor(y / hmax)}`;
  ps.forEach((p, i) => (cells.get(key(p.position.x, p.position.y)) ?? cells.set(key(p.position.x, p.position.y), []).get(key(p.position.x, p.position.y))!).push(i));
  ps.forEach((p, i) => {
    const cx = Math.floor(p.position.x / hmax);
    const cy = Math.floor(p.position.y / hmax);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j === i) continue;
          const q = ps[j];
          const h = 0.5 * SMOOTHING * (p.radius + q.radius);
          if (Math.hypot(p.position.x - q.position.x, p.position.y - q.position.y) >= h) continue;
          rel[i] = Math.max(rel[i], Math.hypot(p.velocity.x - q.velocity.x, p.velocity.y - q.velocity.y));
        }
    for (const b of bs) {
      const rx = p.position.x - b.position.x;
      const ry = p.position.y - b.position.y;
      if (Math.hypot(rx, ry) > bodyRadius(b) + SMOOTHING * p.radius) continue;
      const wx = b.velocity.x - b.angularVelocity * ry;
      const wy = b.velocity.y + b.angularVelocity * rx;
      rel[i] = Math.max(rel[i], Math.hypot(p.velocity.x - wx, p.velocity.y - wy));
    }
  });
  const body50 = Math.max(0, ...bs.map((b) => Math.hypot(b.velocity.x, b.velocity.y) + Math.abs(b.angularVelocity) * 50));
  const bodyOwn = Math.max(0, ...bs.map((b) => Math.hypot(b.velocity.x, b.velocity.y) + Math.abs(b.angularVelocity) * bodyRadius(b)));
  const max = (f: (i: number) => number) => ps.reduce((m, _, i) => Math.max(m, f(i)), 0);
  const v: Record<Rule, number> = {
    today: Math.max(max((i) => c[i] + speed[i]), body50),
    bodySize: Math.max(max((i) => c[i] + speed[i]), bodyOwn),
    relative: max((i) => c[i] + rel[i]),
    implicit: Math.max(max((i) => speed[i]), bodyOwn),
    implicitRel: max((i) => rel[i]),
  };
  const out = {} as Record<Rule, number>;
  for (const r of RULES) out[r] = v[r] > 0 ? Math.max(1, Math.ceil(dt / ((0.25 * hmin) / v[r]))) : 1;
  return out;
}

/** µs a substep at n parcels a cluster, linear between the measured sizes (flat below the smallest). */
function substepUs(rows: { n: number; us: number | null }[], n: number): number {
  const m = rows.filter((r) => r.us !== null).sort((a, b) => a.n - b.n) as { n: number; us: number }[];
  if (n <= m[0].n) return m[0].us;
  for (let k = 1; k < m.length; k++) if (n <= m[k].n) return m[k - 1].us + ((n - m[k - 1].n) / (m[k].n - m[k - 1].n)) * (m[k].us - m[k - 1].us);
  const a = m[m.length - 2];
  const b = m[m.length - 1];
  return b.us + ((n - b.n) * (b.us - a.us)) / (b.n - a.n);
}
const runs = results.spike2b.runs as { device: string; fused: { n: number; wgs: number; us: number | null }[] }[];
const device = (name: string, wgs: number) => runs.find((r) => r.device.includes(name))!.fused.filter((f) => f.wgs === wgs && f.us !== null && !(f.n === 250 && f.us > 200 && wgs === 256 && name === "RTX"));
const DEVICES = { "RTX 40": device("RTX", 1024), "iPad Pro": device("iPad", 256) };
const REST = 2.47;

const samples: { rule: Rule; limiting: number; biggestSub: number; gpu: Record<string, [number, number]> }[] = [];
let measuredToday = 0;
let nSamples = 0;
for (let s = 0; s < steps; s++) {
  stepInPlace(world, byStep.get(s) ?? [], profile);
  if (s < 60 || s % 10 !== 0) continue;
  const walls = wallBodies(world.bodies);
  const cs = gasClusters(world.gas, walls, world.joints, dt);
  const per = cs.map((cl) => ({ n: cl.parcels.length, sub: clusterSubsteps(cl.parcels, cl.bodies, walls) }));
  // Skip the steps where a fast-spinning fragment drives today's rule to its floor (the known bug).
  if (Math.max(...per.map((p) => p.sub.today)) > 200) continue;
  measuredToday += world.gas.substeps;
  nSamples++;
  const biggest = per.reduce((a, b) => (b.n > a.n ? b : a));
  for (const rule of RULES) {
    const gpu: Record<string, [number, number]> = {};
    for (const [name, rows] of Object.entries(DEVICES))
      gpu[name] = [1, 4].map((d) => (REST / 1000) * Math.max(...per.map((p) => Math.sqrt(d) * p.sub[rule] * substepUs(rows, d * p.n)))) as [number, number];
    samples.push({ rule, limiting: Math.max(...per.map((p) => p.sub[rule])), biggestSub: biggest.sub[rule], gpu });
  }
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
console.log(`reference battle, steps 60–${steps} every 10 (${nSamples} samples; steps with today's rule over 200 substeps left out)`);
console.log(`substeps today (the world's own count): ${(measuredToday / nSamples).toFixed(1)}`);
console.log("rule          substeps (limiting cluster)  largest cluster   GPU gas ms/step at 1× / 4×: " + Object.keys(DEVICES).join(" | "));
for (const rule of RULES) {
  const ss = samples.filter((x) => x.rule === rule);
  const gpu = Object.keys(DEVICES).map((d) => `${mean(ss.map((x) => x.gpu[d][0])).toFixed(1)} / ${mean(ss.map((x) => x.gpu[d][1])).toFixed(1)}`).join(" | ");
  console.log(`${rule.padEnd(14)}${mean(ss.map((x) => x.limiting)).toFixed(1).padStart(10)}${mean(ss.map((x) => x.biggestSub)).toFixed(1).padStart(22)}      ${gpu}`);
}
console.log("budget: 1.04 ms (laptop or desktop), 2.08 ms (phone)");
