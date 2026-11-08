// Mammoth Lander's scenarios (docs/games/mammoth-lander.md), built from a line of terrain points.
// The ship is the LAND twin-engine lander, made breakable: its parts have materials, its welds have
// limits, and its tank carries a charge the game sets off in a hard crash (LND-021).
//   node scripts/lander.ts            writes scenarios/lander-*.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario, scenarioToJson } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };

// ---------- The ship ----------

const land = scenarioToJson(parseScenario(JSON.parse(readFileSync(join(root, "scenarios", "land-twin-engine.json"), "utf8")))) as Json & {
  world: { bodies: Json[]; joints: Json[]; links: Json[] };
};
const shipIds = new Set<string>();
for (const j of land.world.joints) [j.a, j.b].forEach((id) => shipIds.add(String(id)));
const hull = land.world.bodies.find((b) => b.id === "hull")!;
const origin = hull.position as Vec;
const id = (x: unknown) => `l{n}-${String(x)}`;

/** Each part's material: thin metal, so a crash bends and breaks it (energies in J). */
const material = (bid: string) => (bid === "tank" ? { name: "tank", threshold: 100, toughness: 1500 } : { name: "hull", threshold: 150, toughness: 3000 });
/** Weld limits: a landing's loads are far below them, a crash's are not. */
const WELD = { tension: 5000, compression: 10000, shear: 3500, torque: 1200 };

function ship(economy: number) {
  const bodies = land.world.bodies
    .filter((b) => shipIds.has(String(b.id)))
    .map((b) => {
      const out: Json = { ...b, id: id(b.id), position: { x: (b.position as Vec).x - origin.x, y: (b.position as Vec).y - origin.y }, material: material(String(b.id)) };
      if (out.injector) out.injector = { ...(out.injector as Json), economy };
      // The tank's charge: the propellant's stored energy, set off by the game in a hard crash.
      if (b.id === "tank") out.explosive = { charge: 0.05, arm: 1e6, fragments: 6, radius: 0.5 };
      return out;
    });
  const joints = land.world.joints.map((j) => ({ ...j, id: id(j.id), a: id(j.a), b: id(j.b), limits: WELD }));
  const links = land.world.links.map((l) => ({ ...l, id: id(l.id), ...(l.from !== undefined ? { from: id(l.from) } : {}), to: id(l.to) }));
  return { bodies, joints, links };
}

// ---------- Terrain ----------

interface Pad {
  x: number;
  width: number;
  multiplier: number;
}

/**
 * Ground from a line of points: a quad from each segment down to `bottom`, fixed. Pads flatten the
 * line under them and sit on it. In a wrapped world the first and last `seam` metres are copied past
 * the opposite edges, so a ship near an edge stands on real ground (nothing collides across the
 * seam itself: FLT-012's known limit, LND-042).
 */
function terrain(points: Vec[], pads: Pad[], opts: { bottom: number; width?: number; seam?: number }) {
  const bodies: Json[] = [];
  const quad = (a: Vec, b: Vec, n: string) =>
    bodies.push({
      id: n,
      fixed: true,
      mass: 1,
      friction: 0.9,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      angle: 0,
      angularVelocity: 0,
      shape: { kind: "polygon", vertices: [{ x: a.x, y: opts.bottom }, { x: b.x, y: opts.bottom }, b, a] },
    });
  for (let i = 0; i + 1 < points.length; i++) quad(points[i], points[i + 1], `ground-${i}`);
  if (opts.width && opts.seam) {
    const W = opts.width;
    const x0 = points[0].x;
    const x1 = points[points.length - 1].x;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      if (b.x <= x0 + opts.seam) quad({ x: a.x + W, y: a.y }, { x: b.x + W, y: b.y }, `ground-seam-r${i}`);
      if (a.x >= x1 - opts.seam) quad({ x: a.x - W, y: a.y }, { x: b.x - W, y: b.y }, `ground-seam-l${i}`);
    }
  }
  pads.forEach((p, k) => {
    const y = heightAt(points, p.x);
    bodies.push({ id: `pad-${k + 1}`, fixed: true, mass: 1, friction: 0.9, position: { x: p.x, y: y + 0.2 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "box", width: p.width, height: 0.4 } });
  });
  return bodies;
}

function heightAt(points: Vec[], x: number): number {
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (x >= a.x && x <= b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return points[points.length - 1].y;
}

/** A line from `x0` to `x1` every `step` m by `f`, flat (at the line's height there) under each pad and a margin. */
function line(x0: number, x1: number, step: number, f: (x: number) => number, pads: Pad[], margin = 2): Vec[] {
  const pts: Vec[] = [];
  for (let x = x0; x <= x1 + 1e-9; x += step) {
    const pad = pads.find((p) => Math.abs(x - p.x) <= p.width / 2 + margin);
    pts.push({ x, y: pad ? f(pad.x) : f(x) });
  }
  // The pads' flat edges exactly, so a pad sits on level ground.
  for (const p of pads)
    for (const e of [p.x - p.width / 2 - margin, p.x + p.width / 2 + margin]) if (!pts.some((q) => Math.abs(q.x - e) < 1e-6)) pts.push({ x: e, y: f(p.x) });
  return pts.sort((a, b) => a.x - b.x);
}

// ---------- Scenarios ----------

function write(file: string, scn: Json) {
  writeFileSync(join(root, "scenarios", `${file}.json`), JSON.stringify(scn, null, 2) + "\n");
  parseScenario(scn); // fails loudly if the scenario is malformed
  console.log(`wrote scenarios/${file}.json`);
}

function scenario(o: { name: string; title: string; description: string; bodies: Json[]; bounds: Json; economy: number; start: { position: Vec; velocity: Vec }; pads: Pad[]; maxSpeed: number; maxTilt: number }): Json {
  return {
    schema: 1,
    name: o.name,
    title: o.title,
    description: o.description,
    profile: "sandbox",
    seed: 1,
    world: {
      gravity: { x: 0, y: -1.6 },
      bounds: o.bounds,
      bodies: o.bodies,
      lander: {
        ship: ship(o.economy),
        hull: "l{n}-hull",
        tank: "l{n}-tank",
        start: o.start,
        pads: o.pads.map((p, k) => ({ id: `pad-${k + 1}`, multiplier: p.multiplier })),
        maxSpeed: o.maxSpeed,
        maxTilt: o.maxTilt,
        explodeAbove: 3.5,
      },
    },
    timeline: [],
    end: { steps: 240 }, // the game runs on until it is over; this is how far a headless run goes
    probes: [],
    assertions: [],
    ui: { keys: { q: "left", e: "right" }, overlays: [], labels: false },
  };
}

// Easy (docs/games/mammoth-lander.md §5): gently rolling ground, 600 m round, five pads from wide
// (×2) to narrow (×5), plenty of fuel, starting 120 m up and moving sideways at 15 m/s.
{
  const W = 600;
  const pads: Pad[] = [
    { x: -220, width: 16, multiplier: 2 },
    { x: -110, width: 10, multiplier: 3 },
    { x: 0, width: 7, multiplier: 4 },
    { x: 110, width: 5, multiplier: 5 },
    { x: 215, width: 12, multiplier: 2 },
  ];
  const f = (x: number) => 6 * Math.sin((2 * Math.PI * x) / 200) + 3 * Math.sin((2 * Math.PI * x) / 75 + 1) + 2 * Math.sin((2 * Math.PI * x) / 120 + 2);
  const pts = line(-W / 2, W / 2, 5, f, pads);
  write(
    "lander-easy",
    scenario({
      name: "lander-easy",
      title: "Mammoth Lander: Easy",
      description: "Gently rolling ground, five pads and plenty of fuel. Smaller pads score more. The ground wraps round.",
      bodies: terrain(pts, pads, { bottom: -60, width: W, seam: 30 }),
      bounds: { min: { x: -W / 2, y: -2000 }, max: { x: W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
      economy: 5,
      start: { position: { x: -270, y: 120 }, velocity: { x: 15, y: 0 } },
      pads,
      maxSpeed: 2,
      maxTilt: 15,
    }),
  );
}
