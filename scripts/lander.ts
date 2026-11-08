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

/** A leak in the tank (Emergency, LND-040): how damaged it is (1 whole), and where the hole faces in its frame. */
interface Leak {
  integrity: number;
  normal: Vec;
}

function ship(economy: number, leak?: Leak) {
  const bodies = land.world.bodies
    .filter((b) => shipIds.has(String(b.id)))
    .map((b) => {
      const out: Json = { ...b, id: id(b.id), position: { x: (b.position as Vec).x - origin.x, y: (b.position as Vec).y - origin.y }, material: material(String(b.id)) };
      if (out.injector) out.injector = { ...(out.injector as Json), economy };
      // The tank's charge: the propellant's stored energy, set off by the game in a hard crash.
      if (b.id === "tank") out.explosive = { charge: 0.05, arm: 1e6, fragments: 6, radius: 0.5 };
      // A leaking tank: damaged from the start, its hole on the side the leak faces (DMG-004).
      if (b.id === "tank" && leak) {
        const box = b.shape as { width: number; height: number };
        out.integrity = leak.integrity;
        out.breach = { point: { x: (leak.normal.x * box.width) / 2, y: (leak.normal.y * box.height) / 2 }, normal: leak.normal, credit: 0, count: 0 };
      }
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

function scenario(o: { name: string; title: string; description: string; bodies: Json[]; bounds: Json; economy: number; leak?: Leak; start: { position: Vec; velocity: Vec }; pads: Pad[]; maxSpeed: number; maxTilt: number }): Json {
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
        ship: ship(o.economy, o.leak),
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

// Bumps for mountains: a sharp peak (or, with negative height, a pit) of `height` m and half-width `half` m at `x`.
const spike = (x: number, height: number, half: number) => (at: number) => Math.max(0, 1 - Math.abs(at - x) / half) * height;
const sum =
  (...fs: ((x: number) => number)[]) =>
  (x: number) =>
    fs.reduce((y, f) => y + f(x), 0);
const wave = (amp: number, period: number, phase = 0) => (x: number) => amp * Math.sin((2 * Math.PI * x) / period + phase);

// Medium: lunar peaks and spikes, 800 m round. Pads in the valleys (wider, ×2/×3) and cut as shelves
// into the mountain sides (narrow, ×4/×5). Fuel matters: a quarter less than Easy.
const MEDIUM = (() => {
  const W = 800;
  const f = sum(wave(28, 400), wave(12, 160, 1), wave(5, 80, 2), spike(-260, 45, 18), spike(-40, 60, 22), spike(150, 38, 15), spike(300, 50, 20));
  const pads: Pad[] = [
    { x: -330, width: 12, multiplier: 2 },
    { x: -215, width: 7, multiplier: 4 },
    { x: -110, width: 10, multiplier: 3 },
    { x: 40, width: 6, multiplier: 5 },
    { x: 210, width: 11, multiplier: 2 },
    { x: 345, width: 6, multiplier: 4 },
  ];
  return { W, f, pads, pts: line(-W / 2, W / 2, 4, f, pads) };
})();
write(
  "lander-medium",
  scenario({
    name: "lander-medium",
    title: "Mammoth Lander: Medium",
    description: "Lunar peaks and spikes. Pads in the valleys and on shelves in the mountain sides. Fuel matters. The ground wraps round.",
    bodies: terrain(MEDIUM.pts, MEDIUM.pads, { bottom: -100, width: MEDIUM.W, seam: 30 }),
    bounds: { min: { x: -MEDIUM.W / 2, y: -2000 }, max: { x: MEDIUM.W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
    economy: 4,
    start: { position: { x: -380, y: 170 }, velocity: { x: 10, y: 0 } },
    pads: MEDIUM.pads,
    maxSpeed: 1.5,
    maxTilt: 12,
  }),
);

// Hard: sheer, jagged mountains, 800 m round, and narrow pads on ledges and down pits. Tighter limits.
const HARD = (() => {
  const W = 800;
  const f = sum(
    wave(35, 400, 0.5),
    wave(15, 100, 1.3),
    wave(6, 40, 2.1),
    spike(-300, 70, 14),
    spike(-180, 85, 16),
    spike(-30, 75, 12),
    spike(120, 95, 18),
    spike(260, 80, 14),
    // Pits, each with a pad at the bottom.
    spike(-240, -30, 9),
    spike(60, -35, 9),
  );
  const pads: Pad[] = [
    { x: -340, width: 8, multiplier: 2 },
    { x: -240, width: 6, multiplier: 5 },
    { x: -105, width: 6, multiplier: 4 },
    { x: 60, width: 6, multiplier: 5 },
    { x: 190, width: 7, multiplier: 3 },
    { x: 330, width: 6, multiplier: 4 },
  ];
  return { W, f, pads, pts: line(-W / 2, W / 2, 3, f, pads, 1) };
})();
const hard = (o: { name: string; title: string; description: string; leak?: Leak; economy: number }) =>
  scenario({
    ...o,
    bodies: terrain(HARD.pts, HARD.pads, { bottom: -120, width: HARD.W, seam: 30 }),
    bounds: { min: { x: -HARD.W / 2, y: -2000 }, max: { x: HARD.W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
    start: { position: { x: -390, y: 200 }, velocity: { x: 10, y: 0 } },
    pads: HARD.pads,
    maxSpeed: 1.2,
    maxTilt: 10,
  });
write(
  "lander-hard",
  hard({ name: "lander-hard", title: "Mammoth Lander: Hard", description: "Sheer mountains, narrow ledges and pits. Tight limits and tight fuel. The ground wraps round.", economy: 3.5 }),
);

// Emergency: Hard's mountains with the tank leaking from the start: fuel drains, and the leak's jet
// pushes the ship sideways with about a tenth of one engine's thrust (LND-040).
write(
  "lander-emergency",
  hard({
    name: "lander-emergency",
    title: "Mammoth Lander: Emergency",
    description: "Hard's mountains, with a leaking tank: fuel drains and the leak pushes you about. Get down fast.",
    economy: 3.5,
    leak: { integrity: 0.6, normal: { x: 1, y: 0 } },
  }),
);
