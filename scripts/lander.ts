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
  solid?: ("below" | "above" | "outside")[];
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

// Emergency: its own mountains in Hard's style (sheer peaks, a deep pit, ledges between twin
// peaks), with the tank leaking from the start: fuel drains, and the leak's jet pushes the ship
// sideways with about a tenth of one engine's thrust (LND-040).
const EMERGENCY = (() => {
  const W = 800;
  const f = sum(
    wave(30, 400, 2.4),
    wave(14, 130, 0.2),
    wave(5, 45, 1.7),
    spike(-280, 90, 15),
    spike(-150, 65, 12),
    // Twin peaks with a ledge between them.
    spike(-35, 100, 14),
    spike(25, 95, 14),
    spike(170, 75, 13),
    spike(290, 105, 16),
    // A deep pit with a pad at the bottom.
    spike(-215, -40, 10),
  );
  const pads: Pad[] = [
    { x: -345, width: 8, multiplier: 2 },
    { x: -215, width: 6, multiplier: 5 },
    { x: -95, width: 7, multiplier: 3 },
    { x: -5, width: 6, multiplier: 5 },
    { x: 100, width: 7, multiplier: 3 },
    { x: 230, width: 6, multiplier: 4 },
  ];
  return { W, f, pads, pts: line(-W / 2, W / 2, 3, f, pads, 1) };
})();
write(
  "lander-emergency",
  scenario({
    name: "lander-emergency",
    title: "Mammoth Lander: Emergency",
    description: "Sheer mountains, with a leaking tank, and you come in fast and spinning: fuel drains and the leak pushes you about. Get it under control and get down fast. The ground wraps round.",
    bodies: terrain(EMERGENCY.pts, EMERGENCY.pads, { width: EMERGENCY.W, seam: 30 }),
    bounds: { min: { x: -EMERGENCY.W / 2, y: -2000 }, max: { x: EMERGENCY.W / 2, y: 2000 }, wrap: true, farField: 10, depth: 2 },
    // Coming in drastic: fast sideways and spinning (about a quarter turn a second). One engine stops
    // the spin in about half a second; the leak empties the tank in about 20 s whatever you do, so a
    // little more economy than Hard (about 4 s more burning) gives a chance to sort it out.
    economy: 4.5,
    start: { position: { x: -390, y: 200 }, velocity: { x: 25, y: 0 }, spin: 1.5 },
    leak: { integrity: 0.4, normal: { x: 1, y: 0 }, speed: 30 },
    pads: EMERGENCY.pads,
    maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
    maxTilt: 10,
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

// Cave 2: drawn by hand (scripts/data/cave2.json, traced from the drawing). Its mouth opens to the
// left; a long passage of stalactites and stalagmites leads down to a lower gallery and round into a
// curled chamber, with pad 6 on a ledge inside the curl. Pads score by their number (×1 to ×6), so
// the further you get along the cave, the more a landing is worth. The outline has overhangs (the
// curl), so its rock is a crust along the line on its rock side, and the view fills everything
// outside the outline (solid "outside").
{
  const data = JSON.parse(readFileSync(join(root, "scripts", "data", "cave2.json"), "utf8")) as {
    outline: [number, number][];
    pads: { n: number; x: number; width: number; y: number }[];
  };
  const MARGIN = 1;
  let outline: Vec[] = data.outline.map(([x, y]) => ({ x, y }));
  // Each pad levels the floor under it: the stretch of outline within its width (and a margin) near
  // its drawn height becomes flat at the height the outline has at its centre. The floor runs right
  // to left (air on the outline's right), so the stretch is replaced by its right then left edge.
  const pads: Pad[] = [];
  const padTops: Vec[] = [];
  for (const p of data.pads) {
    const x0 = p.x - p.width / 2 - MARGIN;
    const x1 = p.x + p.width / 2 + MARGIN;
    const near = (q: Vec) => q.x >= x0 - 3 && q.x <= x1 + 3 && Math.abs(q.y - p.y) < 6;
    const i0 = outline.findIndex(near);
    let i1 = i0;
    while (i1 + 1 < outline.length && near(outline[i1 + 1])) i1++;
    if (i0 < 0 || outline[i0].x < outline[i1].x) throw new Error(`pad ${p.n}: no floor running right to left near it`);
    // The floor's height at the pad's centre, along that stretch.
    let y = p.y;
    for (let i = Math.max(0, i0 - 1); i <= Math.min(outline.length - 2, i1 + 1); i++) {
      const a = outline[i];
      const b = outline[i + 1];
      if ((a.x - p.x) * (b.x - p.x) <= 0 && a.x !== b.x) {
        y = a.y + ((b.y - a.y) * (p.x - a.x)) / (b.x - a.x);
        break;
      }
    }
    const keep = (q: Vec) => q.x > x1 || q.x < x0;
    const before = outline.slice(0, i0 + 1).filter((q, k) => k < i0 || keep(q));
    const after = outline.slice(i1).filter((q, k) => k > 0 || keep(q));
    outline = [...before, { x: x1, y }, { x: x0, y }, ...after];
    pads.push({ x: p.x, width: p.width, multiplier: p.n });
    padTops.push({ x: p.x, y });
  }
  const TOP = 250; // the top of the world over the cave's rock
  const LEFT = -140; // the left of the world, past the mouth
  // The ground left of the mouth carries on down past the edge of the world at its last slope.
  const [g0, g1] = [outline[outline.length - 2], outline[outline.length - 1]];
  const slope = (g1.y - g0.y) / (g1.x - g0.x);
  const groundAt = (x: number) => ({ x, y: g1.y + slope * (x - g1.x) });
  const surface = [{ x: outline[0].x, y: TOP }, ...outline, groundAt(LEFT - 40)];
  const bodies: Json[] = [];
  const rock = (vertices: Vec[], n: string) =>
    bodies.push({ id: n, fixed: true, mass: 1, friction: 0.9, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "polygon", vertices } });
  // How far rock goes from point p along unit vector u before the outline comes out into air again
  // (a thin stalactite's other side), past segment `skip`. A crust thicker than that pokes into the air.
  const rockDepth = (p: Vec, u: Vec, skip: number) => {
    let best = Infinity;
    for (let j = 0; j + 1 < surface.length; j++) {
      if (j === skip) continue;
      const a = surface[j];
      const e = { x: surface[j + 1].x - a.x, y: surface[j + 1].y - a.y };
      const den = u.x * e.y - u.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const w = { x: a.x - p.x, y: a.y - p.y };
      const t = (w.x * e.y - w.y * e.x) / den; // along u
      const k = (w.x * u.y - w.y * u.x) / den; // along the segment
      if (t > 1e-6 && k >= 0 && k <= 1) best = Math.min(best, t);
    }
    return best;
  };
  // A crust along each segment, on its rock side (the left of the way the outline runs): 15 m deep,
  // or less where the rock is thinner (spikes), so no crust reaches through into the air.
  for (let i = 0; i + 1 < surface.length; i++) {
    const a = surface[i];
    const b = surface[i + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) continue;
    const u = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    let depth = CRUST;
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      depth = Math.min(depth, 0.98 * rockDepth({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, u, i));
    }
    depth = Math.max(depth, 0.05);
    rock([a, b, { x: b.x + u.x * depth, y: b.y + u.y * depth }, { x: a.x + u.x * depth, y: a.y + u.y * depth }], `cave-${i}`);
  }
  const maxX = Math.max(...surface.map((q) => q.x));
  // A lid over the cave's rock, so nothing gets round the roof from above.
  rock([{ x: outline[0].x, y: TOP }, { x: maxX + 20, y: TOP }, { x: maxX + 20, y: TOP + 5 }, { x: outline[0].x, y: TOP + 5 }], "cave-lid");
  padTops.forEach((t, k) =>
    bodies.push({ id: `pad-${k + 1}`, fixed: true, mass: 1, friction: 0.9, position: { x: t.x, y: t.y + 0.2 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "box", width: pads[k].width, height: 0.4 } }),
  );
  // The outline of air, closed far off past the mouth so the open left reads as open.
  const air = [{ x: outline[0].x, y: 3000 }, ...surface, groundAt(-3000), { x: -3000, y: 3000 }];
  write(
    "lander-cave-2",
    scenario({
      name: "lander-cave-2",
      title: "Mammoth Lander: Cave 2",
      description: "A long, winding cave that curls round at its end. Pads score by their number, up to ×6 on the ledge inside the curl.",
      bodies,
      bounds: { min: { x: LEFT, y: -120 }, max: { x: maxX + 20, y: TOP + 20 }, wrap: false, farField: 10, depth: 2 },
      economy: 4.5,
      start: { position: { x: -75, y: 55 }, velocity: { x: 0, y: 0 } },
      pads,
      maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
      maxTilt: 12,
      lines: [air],
      solid: ["outside"],
    }),
  );
}

// Asteroids (Orbital, Binary, Heavy Orbital): a big, spinning rock with its own gravity (FLT-011),
// with mountains, plateaus and crater floors. Its pads ride on it (LND-011), so landing is judged
// against the pad's own motion and "up".
//
// The rock is one welded assembly of ordinary bodies: a core, and a ring of wedges out to the
// surface (each convex, so the surface can be any shape). Parts of one assembly never collide with
// each other, and it moves as one rigid body. Only the core pulls: the other parts carry a field of
// strength 0, so they feel none and the rock doesn't pull itself apart. With `feels`, every part is
// pulled by the other rocks (FLT-014), never by its own core.
type RockPad = Pad & { at: number; r: number };
function asteroid(o: {
  /** Ids: `${name}-core`, `${name}-0`, …; welds `${name}-w-…`. */
  name: string;
  R: number;
  inner: number;
  /** Seconds a turn (anticlockwise). */
  turn: number;
  mu: number;
  density: number;
  /** Pads: the angle round the rock (radians, anticlockwise from straight up), how far out, how wide. */
  pads: RockPad[];
  /** The surface's height above R by angle, between the pads. */
  rough: (a: number) => number;
  /** Surface pieces round it (more for a bigger rock, so its outline stays smooth). */
  pieces?: number;
  /** Ids of its pads start from pad-(padFrom + 1). */
  padFrom?: number;
  /** Where its centre of mass is and how it moves. Absent: still, at the origin. */
  at?: Vec;
  velocity?: Vec;
  feels?: boolean;
}): { bodies: Json[]; joints: Json[] } {
  const { R, pads } = o;
  const w = (2 * Math.PI) / o.turn;
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
        return (1 - k) * (p.r / Math.cos(half)) + k * (R + o.rough(a));
      }
    }
    return R + o.rough(a);
  };
  const N = o.pieces ?? 96;
  const angles: number[] = [];
  for (let i = 0; i < N; i++) angles.push((2 * Math.PI * i) / N);
  // The pads' flat edges exactly, so each pad sits on level ground.
  for (const p of pads) for (const s of [-1, 1]) angles.push(p.at + s * Math.atan((p.width / 2 + 3) / p.r));
  angles.sort((a, b) => a - b);
  const up = (a: number) => ({ x: -Math.sin(a), y: Math.cos(a) });
  const surface = angles.map((a) => ({ x: up(a).x * radius(a), y: up(a).y * radius(a) }));
  const inner = angles.map((a) => ({ x: up(a).x * o.inner, y: up(a).y * o.inner }));
  // A body of the rock: placed at its centroid, spinning with the rest.
  const field = o.feels ? { mu: 0, core: 1, feels: true } : { mu: 0, core: 1 };
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
      mass: o.density * area,
      friction: 0.9,
      restitution: 0,
      position: c,
      angle: 0,
      shape: { kind: "polygon", vertices: vs.map((v) => ({ x: v.x - c.x, y: v.y - c.y })) },
      gravity: { ...field },
      ...extra,
    });
  };
  // The core: a regular polygon through the wedges' inner corners. It alone pulls.
  const core: Vec[] = [];
  for (let i = 0; i < 16; i++) core.push(up((2 * Math.PI * i) / 16));
  piece(`${o.name}-core`, core.map((u) => ({ x: u.x * (o.inner + 2), y: u.y * (o.inner + 2) })), { gravity: o.feels ? { mu: o.mu, core: 20, feels: true } : { mu: o.mu, core: 20 } });
  for (let i = 0; i < angles.length; i++) {
    const j = (i + 1) % angles.length;
    // Counter-clockwise: inner corners, then out along the next angle and back along the surface.
    piece(`${o.name}-${i}`, [inner[i], surface[i], surface[j], inner[j]].reverse());
  }
  // Pads: on the flat stretches, facing out, riding with the rock.
  pads.forEach((p, k) => {
    const u = up(p.at);
    const c = { x: u.x * (p.r + 0.2), y: u.y * (p.r + 0.2) };
    bodies.push({
      id: `pad-${(o.padFrom ?? 0) + k + 1}`,
      mass: 1000,
      friction: 0.9,
      restitution: 0,
      position: c,
      angle: p.at,
      shape: { kind: "box", width: p.width, height: 0.4 },
      gravity: { ...field },
    });
  });
  // Centred on its centre of mass, so it spins in place (the surface isn't symmetric: about 1 m off),
  // then set spinning (and moving, and put where it goes), and welded to the core where each part's centre is.
  const at = (b: Json) => b.position as Vec;
  const M = bodies.reduce((m, b) => m + (b.mass as number), 0);
  const com = { x: bodies.reduce((t, b) => t + (b.mass as number) * at(b).x, 0) / M, y: bodies.reduce((t, b) => t + (b.mass as number) * at(b).y, 0) / M };
  for (const b of bodies) {
    const c = { x: at(b).x - com.x, y: at(b).y - com.y };
    b.position = o.at ? { x: c.x + o.at.x, y: c.y + o.at.y } : c;
    b.velocity = o.velocity ? { x: -w * c.y + o.velocity.x, y: w * c.x + o.velocity.y } : { x: -w * c.y, y: w * c.x };
    b.angularVelocity = w;
  }
  const corePos = at(bodies[0]);
  for (const b of bodies.slice(1))
    joints.push({ id: `${o.name}-w-${String(b.id)}`, a: `${o.name}-core`, b: b.id, anchorA: { x: at(b).x - corePos.x, y: at(b).y - corePos.y }, anchorB: { x: 0, y: 0 }, limits: { tension: 1e15, compression: 1e15, shear: 1e15, torque: 1e15 } });
  return { bodies, joints };
}

/** Mountains on a rock: a peak of `height` m, `half` radians wide either side, at angle `at`. */
const bump = (at: number, height: number, half: number) => (a: number) => {
  let d = Math.abs(a - at) % (2 * Math.PI);
  d = Math.min(d, 2 * Math.PI - d);
  return Math.max(0, 1 - d / half) * height;
};

/** An asteroid level: no uniform gravity, the rocks' welds, and the ship in a circular orbit `r0` from the origin about `mu`. */
function rockLevel(o: { name: string; title: string; description: string; bodies: Json[]; joints: Json[]; pads: Pad[]; economy: number; r0: number; mu: number; soft: number; about?: { at: Vec; velocity: Vec } }) {
  const g0 = (o.mu * o.r0) / Math.pow(o.r0 * o.r0 + o.soft * o.soft, 1.5);
  // Over the top of the rock (or of `about`, a moving one), going round it anticlockwise.
  const c = o.about ?? { at: { x: 0, y: 0 }, velocity: { x: 0, y: 0 } };
  const scn = scenario({
    name: o.name,
    title: o.title,
    description: o.description,
    bodies: o.bodies,
    bounds: { min: { x: -1000, y: -1000 }, max: { x: 1000, y: 1000 }, wrap: false, farField: 10, depth: 2 },
    economy: o.economy,
    start: o.about ? { position: { x: c.at.x, y: c.at.y + o.r0 }, velocity: { x: c.velocity.x - Math.sqrt(g0 * o.r0), y: c.velocity.y } } : { position: { x: 0, y: o.r0 }, velocity: { x: -Math.sqrt(g0 * o.r0), y: 0 } },
    pads: o.pads,
    maxSpeed: 2, // a guide: damage starts above about 2 m/s (WELD)
    maxTilt: 12,
  }) as Json & { world: Json };
  scn.world.gravity = { x: 0, y: 0 };
  scn.world.joints = o.joints;
  write(o.name, scn);
}

// Orbital: 150 m across, turning once in 7 minutes. The ship starts in a circular orbit 60 m up,
// over the top and moving anticlockwise like the rock.
{
  const R = 75;
  const mu = 5625; // about 0.9 m/s² at the surface, softened inside by `core`
  const pads: RockPad[] = [
    { at: 0.5, r: R + 9, x: 0, width: 10, multiplier: 2 }, // a plateau
    { at: 1.45, r: R - 7, x: 0, width: 7, multiplier: 4 }, // a crater floor
    { at: 2.4, r: R + 14, x: 0, width: 6, multiplier: 5 }, // a mountain top
    { at: 3.3, r: R + 2, x: 0, width: 12, multiplier: 2 }, // the plain
    { at: 4.3, r: R - 9, x: 0, width: 6, multiplier: 5 }, // a deep crater
    { at: 5.3, r: R + 6, x: 0, width: 8, multiplier: 3 }, // a plateau
  ];
  const rough = sum(
    (a: number) => 3 * Math.sin(5 * a + 1) + 2 * Math.sin(11 * a + 2) + 1.2 * Math.sin(23 * a),
    bump(0.95, 16, 0.18), // mountains between the pads
    bump(1.9, 12, 0.15),
    bump(2.85, 18, 0.16),
    bump(3.8, 11, 0.14),
    bump(4.8, 15, 0.17),
    bump(5.8, 13, 0.15),
  );
  const rock = asteroid({ name: "rock", R, inner: 40, turn: 420, mu, density: 50, pads, rough });
  rockLevel({
    name: "lander-orbital",
    title: "Mammoth Lander: Orbital",
    description: "A big asteroid, slowly spinning, with its own gravity. Come down from orbit onto pads that ride on it. Down is towards the rock.",
    ...rock,
    pads,
    economy: 8,
    r0: R + 60,
    mu,
    soft: 20,
  });
}

// Heavy Orbital: a bigger, denser rock, 180 m across, with stronger gravity (about 1.5 m/s² at the
// surface, against the ship's 4 m/s² of thrust) and turning faster, once in 3 minutes, so its
// surface moves at about 3 m/s. More fuel, for fighting the stronger pull.
{
  const R = 90;
  const mu = 12150;
  const pads: RockPad[] = [
    { at: 0.3, r: R + 6, x: 0, width: 9, multiplier: 2 }, // a plateau
    { at: 1.3, r: R - 10, x: 0, width: 6, multiplier: 5 }, // a deep crater
    { at: 2.3, r: R + 16, x: 0, width: 6, multiplier: 4 }, // a mountain top
    { at: 3.4, r: R + 1, x: 0, width: 11, multiplier: 2 }, // the plain
    { at: 4.4, r: R - 6, x: 0, width: 7, multiplier: 4 }, // a crater floor
    { at: 5.4, r: R + 12, x: 0, width: 6, multiplier: 5 }, // a mountain shelf
  ];
  const rough = sum(
    (a: number) => 4 * Math.sin(6 * a + 2) + 2.5 * Math.sin(13 * a + 1) + 1.2 * Math.sin(27 * a),
    bump(0.8, 22, 0.16),
    bump(1.8, 15, 0.14),
    bump(2.85, 24, 0.15),
    bump(3.9, 14, 0.13),
    bump(4.9, 20, 0.16),
    bump(5.9, 17, 0.14),
  );
  const rock = asteroid({ name: "rock", R, inner: 48, turn: 180, mu, density: 80, pads, rough, pieces: 128 });
  rockLevel({
    name: "lander-heavy-orbital",
    title: "Mammoth Lander: Heavy Orbital",
    description: "A bigger, heavier asteroid, spinning faster, with stronger gravity. Its pads sweep past at 3 m/s.",
    ...rock,
    pads,
    economy: 10,
    r0: R + 70,
    mu,
    soft: 20,
  });
}

// Binary: two rocks, 220 m apart, orbiting each other once in about 6 minutes and each turning
// gently. They pull each other (FLT-014), each in proportion to its mass (the same G for both), so
// their centre of mass stays put; they start on a circular orbit about it. The ship starts in orbit
// over one of them.
{
  const G = 1500 / (Math.PI * 50 * 50 * 50); // mu = G × mass: about 1500 for a rock 100 m across at 50 kg/m² (0.6 m/s² at its surface)
  const D = 220;
  const SOFT = 20;
  const A: RockPad[] = [
    { at: 0.4, r: 50 + 6, x: 0, width: 9, multiplier: 2 }, // a plateau
    { at: 2.5, r: 50 - 6, x: 0, width: 6, multiplier: 5 }, // a crater
    { at: 4.6, r: 50 + 10, x: 0, width: 6, multiplier: 4 }, // a mountain top
  ];
  const B: RockPad[] = [
    { at: 1.2, r: 46 + 2, x: 0, width: 10, multiplier: 2 }, // the plain
    { at: 3.2, r: 46 + 12, x: 0, width: 6, multiplier: 5 }, // a peak
    { at: 5.2, r: 46 - 5, x: 0, width: 7, multiplier: 3 }, // a crater floor
  ];
  const rockA = asteroid({
    name: "rock-a",
    R: 50,
    inner: 26,
    turn: 360,
    mu: 0,
    density: 50,
    pads: A,
    rough: sum((a: number) => 2.5 * Math.sin(5 * a) + 1.5 * Math.sin(12 * a + 1), bump(1.4, 12, 0.2), bump(3.5, 10, 0.18), bump(5.6, 9, 0.2)),
    feels: true,
  });
  const rockB = asteroid({
    name: "rock-b",
    R: 46,
    inner: 24,
    turn: -400, // the other way round
    mu: 0,
    density: 50,
    pads: B,
    rough: sum((a: number) => 2 * Math.sin(4 * a + 2) + 1.8 * Math.sin(9 * a), bump(0.2, 11, 0.2), bump(2.2, 9, 0.18), bump(4.2, 13, 0.2)),
    padFrom: A.length,
    feels: true,
  });
  const massOf = (r: { bodies: Json[] }) => r.bodies.reduce((m, b) => m + (b.mass as number), 0);
  const mA = massOf(rockA);
  const mB = massOf(rockB);
  const M = mA + mB;
  // Each core pulls with mu = G × its rock's mass.
  (rockA.bodies[0].gravity as Json).mu = G * mA;
  (rockB.bodies[0].gravity as Json).mu = G * mB;
  // A circular orbit about the centre of mass (at the origin): the relative pull at D, softened by the cores.
  const aRel = (G * M * D) / Math.pow(D * D + SOFT * SOFT, 1.5);
  const vRel = Math.sqrt(aRel * D);
  const place = (r: { bodies: Json[] }, x: number, vy: number) => {
    for (const b of r.bodies) {
      const p = b.position as Vec;
      const v = b.velocity as Vec;
      b.position = { x: p.x + x, y: p.y };
      b.velocity = { x: v.x, y: v.y + vy };
    }
  };
  const aAt = { x: (-D * mB) / M, y: 0 };
  const aVel = { x: 0, y: (-vRel * mB) / M };
  place(rockA, aAt.x, aVel.y);
  place(rockB, (D * mA) / M, (vRel * mA) / M);
  const pads = [...A, ...B];
  rockLevel({
    name: "lander-binary",
    title: "Mammoth Lander: Binary",
    description: "Two asteroids orbiting each other, each gently spinning, pulling each other and you. Land on either.",
    bodies: [...rockA.bodies, ...rockB.bodies],
    joints: [...rockA.joints, ...rockB.joints],
    pads,
    economy: 8,
    // In orbit 55 m over rock A, moving with it; rock B swings round into view.
    r0: 50 + 55,
    mu: G * mA,
    soft: 20,
    about: { at: aAt, velocity: aVel },
  });
}
