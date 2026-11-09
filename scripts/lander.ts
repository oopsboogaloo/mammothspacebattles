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
const material = (bid: string) => (bid === "tank" ? { name: "tank", threshold: 60, toughness: 500 } : { name: "hull", threshold: 150, toughness: 3000 });
/**
 * Weld limits, and where the welds start to bend (DMG-008): a share of the limits, beyond which a
 * load costs the weld integrity. Tuned by dropping the ship upright onto a pad: about 2 m/s does no
 * harm, 3 m/s bends the leg welds a little, 4 m/s badly, and about 4.5 m/s breaks a leg off.
 */
const WELD = { tension: 7650, compression: 15300, shear: 5350, torque: 1840 };
const YIELD = 0.3;

/** A leak in the tank (Emergency, LND-040): how damaged it is (1 whole), and where the hole faces in its frame. */
interface Leak {
  integrity: number;
  normal: Vec;
  /** How fast the gas jets out, m/s: the push, for the same loss of fuel. */
  speed?: number;
}

function ship(economy: number, leak?: Leak) {
  const bodies = land.world.bodies
    .filter((b) => shipIds.has(String(b.id)))
    .map((b) => {
      const out: Json = { ...b, id: id(b.id), position: { x: (b.position as Vec).x - origin.x, y: (b.position as Vec).y - origin.y }, material: material(String(b.id)) };
      if (out.injector) out.injector = { ...(out.injector as Json), economy };
      // The tank's charge: the propellant's stored energy. It goes off when the tank is damaged until
      // it bursts; before that, a damaged tank leaks (DMG-004).
      if (b.id === "tank") out.explosive = { charge: 0.05, arm: 1e6, fragments: 6, radius: 0.5, whenDestroyed: true };
      // A leaking tank: damaged from the start, its hole on the side the leak faces (DMG-004).
      if (b.id === "tank" && leak) {
        const box = b.shape as { width: number; height: number };
        out.integrity = leak.integrity;
        out.breach = { point: { x: (leak.normal.x * box.width) / 2, y: (leak.normal.y * box.height) / 2 }, normal: leak.normal, credit: 0, count: 0, speed: leak.speed };
      }
      return out;
    });
  const joints = land.world.joints.map((j) => ({ ...j, id: id(j.id), a: id(j.a), b: id(j.b), limits: WELD, yield: YIELD }));
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
/** How deep the ground goes under its surface, m. Nothing reaches below it. */
const CRUST = 15;

function terrain(points: Vec[], pads: Pad[], opts: { width?: number; seam?: number }) {
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
      // A crust under the surface, not a column to the bottom: a small body has a small bounding box,
      // so the ground costs little in the contact search and the wisps' (a column of 100 m was a box of 200).
      shape: { kind: "polygon", vertices: [{ x: a.x, y: Math.min(a.y, b.y) - CRUST }, { x: b.x, y: Math.min(a.y, b.y) - CRUST }, b, a] },
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
  // The line ends exactly at x1, whatever the step: Hard's 800 m at 3 m steps stopped at 398 m,
  // leaving a 2 m hole in the ground at the wrap seam.
  if (pts[pts.length - 1].x < x1 - 1e-9) {
    const pad = pads.find((p) => Math.abs(x1 - p.x) <= p.width / 2 + margin);
    pts.push({ x: x1, y: pad ? f(pad.x) : f(x1) });
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

function scenario(o: {
  name: string;
  title: string;
  description: string;
  bodies: Json[];
  bounds: Json;
  economy: number;
  leak?: Leak;
  start: { position: Vec; velocity: Vec; spin?: number };
  pads: Pad[];
  maxSpeed: number;
  maxTilt: number;
  lines?: Vec[][];
  solid?: ("below" | "above")[];
}): Json {
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
        ...(o.lines ? { lines: o.lines } : {}),
        ...(o.solid ? { solid: o.solid } : {}),
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
      bodies: terrain(pts, pads, { width: W, seam: 30 }),
      bounds: { min: { x: -W / 2, y: -2000 }, max: { x: W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
      economy: 5,
      start: { position: { x: -270, y: 120 }, velocity: { x: 15, y: 0 } },
      pads,
      maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
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
    bodies: terrain(MEDIUM.pts, MEDIUM.pads, { width: MEDIUM.W, seam: 30 }),
    bounds: { min: { x: -MEDIUM.W / 2, y: -2000 }, max: { x: MEDIUM.W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
    economy: 4,
    start: { position: { x: -380, y: 170 }, velocity: { x: 10, y: 0 } },
    pads: MEDIUM.pads,
    maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
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
const hard = (o: { name: string; title: string; description: string; leak?: Leak; economy: number; start?: { position: Vec; velocity: Vec; spin?: number } }) =>
  scenario({
    ...o,
    bodies: terrain(HARD.pts, HARD.pads, { width: HARD.W, seam: 30 }),
    bounds: { min: { x: -HARD.W / 2, y: -2000 }, max: { x: HARD.W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
    start: o.start ?? { position: { x: -390, y: 200 }, velocity: { x: 10, y: 0 } },
    pads: HARD.pads,
    maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
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
    description: "Hard's mountains, with a leaking tank, and you come in fast and spinning: fuel drains and the leak pushes you about. Get it under control and get down fast.",
    // Coming in drastic: fast sideways and spinning (about a quarter turn a second). One engine stops
    // the spin in about half a second; the leak empties the tank in about 20 s whatever you do, so a
    // little more economy than Hard (about 4 s more burning) gives a chance to sort it out.
    economy: 4.5,
    start: { position: { x: -390, y: 200 }, velocity: { x: 25, y: 0 }, spin: 1.5 },
    leak: { integrity: 0.4, normal: { x: 1, y: 0 }, speed: 30 },
  }),
);

// Cave: a bounded cave running down from its mouth, round stalactites and stalagmites that make a
// winding route before even the first pad. Five pads, deeper ones scoring more (×2 to ×6). Tight
// fuel: getting deep and down safely is the challenge. The ship starts at the mouth, still.
{
  /** The cave's floor before its stalagmites: down from the mouth to the end chamber. */
  const base = (x: number) => {
    const at: [number, number][] = [
      [-80, 0],
      [40, 0],
      [110, -20],
      [200, -50],
      [290, -85],
      [380, -115],
      [470, -150],
      [540, -150],
    ];
    for (let i = 0; i + 1 < at.length; i++) {
      const [x0, y0] = at[i];
      const [x1, y1] = at[i + 1];
      if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return at[at.length - 1][1];
  };
  const pads: Pad[] = [
    { x: 105, width: 10, multiplier: 2 },
    { x: 200, width: 8, multiplier: 3 },
    { x: 290, width: 7, multiplier: 4 },
    { x: 380, width: 6, multiplier: 5 },
    { x: 480, width: 6, multiplier: 6 },
  ];
  const MOUTH = 40;
  // Stalagmites rise from the floor, stalactites hang from the roof: between pads, one of each, so
  // the route weaves down and up.
  const floor = sum(base, wave(1.5, 23), spike(70, 11, 7), spike(160, 12, 7), spike(250, 13, 7), spike(335, 12, 6), spike(430, 14, 7));
  const height = () => 34;
  const roof = sum(base, height, wave(1.5, 17, 1), spike(140, -13, 6), spike(225, -14, 6), spike(315, -14, 6), spike(405, -15, 6), spike(455, -12, 5));
  // The far end is rounded: from XC the floor and roof close in a half circle across the cave.
  const XC = 513;
  const cy = (floor(XC) + roof(XC)) / 2;
  const r = (roof(XC) - floor(XC)) / 2;
  const END = XC + r;
  const cap: number[] = [];
  for (let k = 1; k <= 12; k++) cap.push((Math.PI / 2) * (k / 12));
  const fl = [...line(-80, XC, 2.5, floor, pads, 1.5), ...cap.map((t) => ({ x: XC + r * Math.sin(t), y: cy - r * Math.cos(t) }))];
  const rf: Vec[] = [];
  for (let x = MOUTH; x <= XC + 1e-9; x += 2.5) rf.push({ x, y: roof(x) });
  if (rf[rf.length - 1].x < XC - 1e-9) rf.push({ x: XC, y: roof(XC) });
  for (const t of cap) rf.push({ x: XC + r * Math.sin(t), y: cy + r * Math.cos(t) });
  let narrow = Infinity;
  for (let x = MOUTH; x <= XC; x += 0.5) narrow = Math.min(narrow, roof(x) - floor(x));
  if (narrow < 12) throw new Error(`the cave narrows to ${narrow.toFixed(1)} m somewhere: too tight for the ship`);
  const TOP = 300; // the top of the world
  const bodies = terrain(fl, pads, {});
  // The rock over the cave, solid to the top of the world, and the end wall.
  const rock = (vertices: Vec[], n: string) =>
    bodies.push({ id: n, fixed: true, mass: 1, friction: 0.9, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "polygon", vertices } });
  for (let i = 0; i + 1 < rf.length; i++) rock([rf[i], rf[i + 1], { x: rf[i + 1].x, y: rf[i + 1].y + CRUST }, { x: rf[i].x, y: rf[i].y + CRUST }], `roof-${i}`);
  // Behind the rounded end, solid rock.
  rock([{ x: END, y: cy - r - CRUST }, { x: END + 10, y: cy - r - CRUST }, { x: END + 10, y: TOP }, { x: END, y: TOP }], "cave-end");
  // The cliff over the mouth, up to the top of the world: the roof is a 15 m crust, so this seals the
  // space over it (cheaper than roof pieces each reaching the top).
  rock([{ x: MOUTH, y: rf[0].y }, { x: MOUTH + 5, y: rf[0].y }, { x: MOUTH + 5, y: TOP }, { x: MOUTH, y: TOP }], "cave-cliff");
  // And a lid over it all, so nothing gets in from above either.
  rock([{ x: MOUTH, y: TOP }, { x: END + 10, y: TOP }, { x: END + 10, y: TOP + 5 }, { x: MOUTH, y: TOP + 5 }], "cave-lid");
  write(
    "lander-cave",
    scenario({
      name: "lander-cave",
      title: "Mammoth Lander: Cave",
      description: "A cave running down from its mouth, round stalactites and stalagmites. Deeper pads score more, up to ×6. Tight fuel.",
      bodies,
      bounds: { min: { x: -80, y: -200 }, max: { x: 560, y: 320 }, wrap: false, farField: 10, depth: 2 },
      economy: 4,
      start: { position: { x: 10, y: 3.4 + 0.2 + 8 }, velocity: { x: 0, y: 0 } },
      pads,
      maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
      maxTilt: 12,
      lines: [fl, [{ x: MOUTH, y: TOP }, ...rf]],
      solid: ["below", "above"],
    }),
  );
}

// Orbital: a big, slowly spinning asteroid with its own gravity (FLT-011), 150 m across, turning
// once in 7 minutes, with mountains, plateaus and crater floors. Its pads ride on it (LND-011), so
// landing is judged against the pad's own motion and "up". The ship starts in a circular orbit.
//
// The rock is one welded assembly of ordinary bodies: a core, and a ring of wedges out to the
// surface (each convex, so the surface can be any shape). Parts of one assembly never collide with
// each other, and it moves as one rigid body. Only the core pulls: the other parts carry a field of
// strength 0, so they feel none and the rock doesn't pull itself apart.
{
  const R = 75;
  const INNER = 40;
  const TURN = 420; // s a turn
  const w = (2 * Math.PI) / TURN;
  const mu = 5625; // about 0.9 m/s² at the surface, softened inside by `core`
  // Pads: the angle round the rock (radians, anticlockwise from straight up), how far out, how wide.
  const pads: (Pad & { at: number; r: number })[] = [
    { at: 0.5, r: R + 9, x: 0, width: 10, multiplier: 2 }, // a plateau
    { at: 1.45, r: R - 7, x: 0, width: 7, multiplier: 4 }, // a crater floor
    { at: 2.4, r: R + 14, x: 0, width: 6, multiplier: 5 }, // a mountain top
    { at: 3.3, r: R + 2, x: 0, width: 12, multiplier: 2 }, // the plain
    { at: 4.3, r: R - 9, x: 0, width: 6, multiplier: 5 }, // a deep crater
    { at: 5.3, r: R + 6, x: 0, width: 8, multiplier: 3 }, // a plateau
  ];
  const bump = (at: number, height: number, half: number) => (a: number) => {
    let d = Math.abs(a - at) % (2 * Math.PI);
    d = Math.min(d, 2 * Math.PI - d);
    return Math.max(0, 1 - d / half) * height;
  };
  const rough = sum(
    (a: number) => 3 * Math.sin(5 * a + 1) + 2 * Math.sin(11 * a + 2) + 1.2 * Math.sin(23 * a),
    bump(0.95, 16, 0.18), // mountains between the pads
    bump(1.9, 12, 0.15),
    bump(2.85, 18, 0.16),
    bump(3.8, 11, 0.14),
    bump(4.8, 15, 0.17),
    bump(5.8, 13, 0.15),
  );
  // Each pad sits on a flat stretch of surface: a straight line `r` out, across its width and a margin.
  const radius = (a: number) => {
    for (const p of pads) {
      let d = a - p.at;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const half = Math.atan((p.width / 2 + 3) / p.r);
      if (Math.abs(d) <= half) return p.r / Math.cos(d);
      // Blend into the rough ground over 10° either side.
      const blend = Math.abs(d) - half;
      if (blend < 0.17) {
        const k = blend / 0.17;
        return (1 - k) * (p.r / Math.cos(half)) + k * (R + rough(a));
      }
    }
    return R + rough(a);
  };
  const N = 96;
  const angles: number[] = [];
  for (let i = 0; i < N; i++) angles.push((2 * Math.PI * i) / N);
  // The pads' flat edges exactly, so each pad sits on level ground.
  for (const p of pads) for (const s of [-1, 1]) angles.push(p.at + s * Math.atan((p.width / 2 + 3) / p.r));
  angles.sort((a, b) => a - b);
  const up = (a: number) => ({ x: -Math.sin(a), y: Math.cos(a) });
  const surface = angles.map((a) => ({ x: up(a).x * radius(a), y: up(a).y * radius(a) }));
  const inner = angles.map((a) => ({ x: up(a).x * INNER, y: up(a).y * INNER }));
  // A body of the rock: placed at its centroid, spinning with the rest.
  const DENSITY = 50; // kg/m²: heavy, so the ship hardly moves it
  const bodies: Json[] = [];
  const joints: Json[] = [];
  const centroidOf = (vs: Vec[]) => {
    let A = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const b = vs[(i + 1) % vs.length];
      const k = a.x * b.y - b.x * a.y;
      A += k;
      cx += (a.x + b.x) * k;
      cy += (a.y + b.y) * k;
    }
    return { area: Math.abs(A / 2), c: { x: cx / (3 * A), y: cy / (3 * A) } };
  };
  const piece = (n: string, vs: Vec[], extra: Json = {}) => {
    const { area, c } = centroidOf(vs);
    bodies.push({
      id: n,
      mass: DENSITY * area,
      friction: 0.9,
      restitution: 0,
      position: c,
      angle: 0,
      shape: { kind: "polygon", vertices: vs.map((v) => ({ x: v.x - c.x, y: v.y - c.y })) },
      gravity: { mu: 0, core: 1 },
      ...extra,
    });
  };
  // The core: a regular polygon through the wedges' inner corners. It alone pulls.
  const core: Vec[] = [];
  for (let i = 0; i < 16; i++) core.push(up((2 * Math.PI * i) / 16));
  piece("rock-core", core.map((u) => ({ x: u.x * (INNER + 2), y: u.y * (INNER + 2) })), { gravity: { mu, core: 20 } });
  for (let i = 0; i < angles.length; i++) {
    const j = (i + 1) % angles.length;
    // Counter-clockwise: inner corners, then out along the next angle and back along the surface.
    piece(`rock-${i}`, [inner[i], surface[i], surface[j], inner[j]].reverse());
  }
  // Pads: on the flat stretches, facing out, riding with the rock.
  pads.forEach((p, k) => {
    const u = up(p.at);
    const c = { x: u.x * (p.r + 0.2), y: u.y * (p.r + 0.2) };
    bodies.push({
      id: `pad-${k + 1}`,
      mass: 1000,
      friction: 0.9,
      restitution: 0,
      position: c,
      angle: p.at,
      shape: { kind: "box", width: p.width, height: 0.4 },
      gravity: { mu: 0, core: 1 },
    });
  });
  // Centred on its centre of mass, so it spins in place (the surface isn't symmetric: about 1 m off),
  // then set spinning, and welded to the core where each part's centre is.
  const at = (b: Json) => b.position as Vec;
  const M = bodies.reduce((m, b) => m + (b.mass as number), 0);
  const com = { x: bodies.reduce((t, b) => t + (b.mass as number) * at(b).x, 0) / M, y: bodies.reduce((t, b) => t + (b.mass as number) * at(b).y, 0) / M };
  for (const b of bodies) {
    const c = { x: at(b).x - com.x, y: at(b).y - com.y };
    b.position = c;
    b.velocity = { x: -w * c.y, y: w * c.x };
    b.angularVelocity = w;
  }
  const corePos = at(bodies[0]);
  for (const b of bodies.slice(1))
    joints.push({ id: `rock-w-${String(b.id)}`, a: "rock-core", b: b.id, anchorA: { x: at(b).x - corePos.x, y: at(b).y - corePos.y }, anchorB: { x: 0, y: 0 }, limits: { tension: 1e15, compression: 1e15, shear: 1e15, torque: 1e15 } });
  // In a circular orbit 60 m up, over the top and moving anticlockwise like the rock.
  const r0 = R + 60;
  const g0 = (mu * r0) / Math.pow(r0 * r0 + 20 * 20, 1.5);
  const scn = scenario({
    name: "lander-orbital",
    title: "Mammoth Lander: Orbital",
    description: "A big asteroid, slowly spinning, with its own gravity. Come down from orbit onto pads that ride on it. Down is towards the rock.",
    bodies,
    bounds: { min: { x: -1000, y: -1000 }, max: { x: 1000, y: 1000 }, wrap: false, farField: 10, depth: 2 },
    economy: 8,
    start: { position: { x: 0, y: r0 }, velocity: { x: -Math.sqrt(g0 * r0), y: 0 } },
    pads,
    maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
    maxTilt: 12,
  }) as Json & { world: Json };
  scn.world.gravity = { x: 0, y: 0 };
  scn.world.joints = joints;
  write("lander-orbital", scn);
}
