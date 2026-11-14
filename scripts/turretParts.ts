// Mammoth Thrust's turret (docs/games/mammoth-thrust.md §3, -design.md §4.4): a machine built of
// pieces, like a ship. A fixed base plate on the rock; welded to it a fuel tank, a generator, a
// mount and a battery; a pipe from tank to generator; and on the mount, by a joint that turns
// (ASM-008), a carriage with a railgun. Everything but the base is a free body held by its welds,
// so it can be knocked off, destroyed, and (the tank) set off.
//
//     tank == gen  (mount)  batt        up: away from the rock
//    ==========================  base
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };

/**
 * Thin metal, a third as tough as the ship's (energies in J): two of the ship's slugs destroy a
 * piece, where the ship's own metal would take five. The tank is thinner still: one slug sets it off.
 */
const HULL = { name: "hull", threshold: 150, toughness: 1000 };
const TANK = { name: "tank", threshold: 60, toughness: 500 };
/** Weld limits: Lander's (scripts/landShip.ts), times 3; the gun's and its pivot's times 6, for the recoil. */
const LANDER_WELD = { tension: 7650, compression: 15300, shear: 5350, torque: 1840 };
const stronger = (k: number) => ({ tension: LANDER_WELD.tension * k, compression: LANDER_WELD.compression * k, shear: LANDER_WELD.shear * k, torque: LANDER_WELD.torque * k });
const WELD = stronger(3);
const GUN_WELD = stronger(6);

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const rot = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });

export interface TurretTuning {
  /** How far it sees, m; game seconds from first sight to its first shot, and held after each shot. */
  range: number;
  wait: number;
  hold: number;
  aim: "random" | "ship";
  /** The gun's arc either side of straight up from its base, rad, and how fast it turns, rad/s. */
  arc: number;
  rate: number;
  /** The bolt, as a magazine's shell is written; its launch speed, m/s; game seconds between shots; and how many it carries. */
  bolt: Json;
  speed: number;
  reload: number;
  bolts: number;
  /** Shots the battery holds, shots a second the generator adds, and the fuel it burns doing it, kg/s. */
  shots: number;
  charge: number;
  burn: number;
  /** The fuel in its tank, kg (hydrogen and oxygen, 1 to 8). */
  fuel: number;
}

/**
 * A turret standing at `at` (the middle of its base's underside), its up turned by `angle` from +y.
 * Ids are `{name}-…`; its gun fires on the channel `{name}.fire`.
 */
export function turret(name: string, at: Vec, angle: number, t: TurretTuning, seed: number) {
  const bodies: Json[] = [];
  const joints: Json[] = [];
  const links: Json[] = [];
  const id = (part: string) => `${name}-${part}`;
  const place = (p: Vec): Vec => {
    const r = rot(p, angle);
    return { x: round(at.x + r.x), y: round(at.y + r.y) };
  };
  const centre = new Map<string, Vec>();
  const body = (part: string, shape: Json, mass: number, c: Vec, extra: Json = {}) => {
    centre.set(part, c);
    bodies.push({ id: id(part), shape, mass, position: place(c), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, restitution: 0, friction: 0.4, material: HULL, ...extra });
  };
  const box = (part: string, x0: number, x1: number, y0: number, y1: number, mass: number, extra: Json = {}) => body(part, { kind: "box", width: round(x1 - x0), height: round(y1 - y0) }, mass, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, extra);
  /** A weld between two parts at a point of the turret's frame. */
  const weld = (n: string, a: string, b: string, p: Vec, limits = WELD, extra: Json = {}) => {
    const local = (part: string) => ({ x: round(p.x - centre.get(part)!.x), y: round(p.y - centre.get(part)!.y) });
    joints.push({ id: id(`w-${n}`), a: id(a), b: id(b), anchorA: local(a), anchorB: local(b), limits, ...extra });
  };
  const stores = (mass: number) => [
    { resource: "h2", mass: round(mass / 9), capacity: round(mass / 9) },
    { resource: "o2", mass: round((8 * mass) / 9), capacity: round((8 * mass) / 9) },
  ];

  // The base: a fixed plate on the rock, anchored to it (TER-006): when a crater cuts the rock at its
  // foot it comes loose, a 100 kg plate from then on, and the turret goes where the physics takes it.
  // (Heavy, so that its own gun's kick, 12 N·s a shot, barely moves a turret that has come loose.)
  centre.set("base", { x: 0, y: 0.15 });
  bodies.push({ id: id("base"), fixed: true, shape: { kind: "box", width: 6.4, height: 0.3 }, mass: 1, position: place({ x: 0, y: 0.15 }), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, friction: 0.9, anchored: { mass: 100 } });

  // The fuel tank: a standard one. What it holds goes up with it when it is destroyed.
  box("tank", -3.1, -1.7, 0.3, 1.3, 2, { material: TANK, siphon: true, contents: stores(t.fuel), explosive: { charge: 0.3, arm: 1e6, fragments: 6, radius: 4, whenDestroyed: true } });
  // The pipe, seen: the fuel passes through it, so cutting it starves the generator.
  box("pipe", -1.7, -1.3, 0.5, 0.65, 0.3, { contents: stores(0.02) });
  box("gen", -1.3, -0.3, 0.3, 1.3, 2, { contents: stores(0.02), generator: { battery: id("battery"), burn: t.burn, rate: t.charge } });
  box("battery", 2.1, 3.1, 0.3, 1.3, 2, { charge: { shots: t.shots, capacity: t.shots }, explosive: { charge: 0.05, arm: 1e6, fragments: 4, radius: 1, whenDestroyed: true } });
  // The mount: a half-disc. The carriage turns about a point inside it.
  const dome: Vec[] = [];
  for (let k = 0; k <= 8; k++) dome.push({ x: Math.cos((Math.PI * k) / 8), y: Math.sin((Math.PI * k) / 8) });
  const domeCentre = { x: 0.9, y: 0.3 + 4 / (3 * Math.PI) }; // a half-disc's centroid
  centre.set("mount", domeCentre);
  bodies.push({
    id: id("mount"),
    shape: { kind: "polygon", vertices: dome.map((p) => { const r = rot({ x: p.x, y: p.y - 4 / (3 * Math.PI) }, 0); return { x: round(r.x), y: round(r.y) }; }) },
    mass: 3,
    position: place(domeCentre),
    velocity: { x: 0, y: 0 },
    angle: round(angle),
    angularVelocity: 0,
    restitution: 0,
    friction: 0.4,
    material: HULL,
  });
  const pivot = { x: 0.9, y: 0.7 };
  // The carriage is the railgun's breech: it carries the bolts, at the pivot, so their weight neither
  // drags the gun down nor slows its turning. (With 12 kg of bolts in the barrel, the gun hung 0.19 rad
  // off its bearing and took seconds to settle.) The barrel is a light piece welded to it; the bore
  // is along the carriage's +y, and the muzzle is just past the barrel's tip.
  body("carriage", { kind: "box", width: 0.5, height: 0.5 }, 1, pivot, {
    turret: { joint: id("w-pivot"), gun: id("carriage"), barrel: id("gun"), battery: id("battery"), range: t.range, wait: t.wait, hold: t.hold, aim: t.aim, seed },
    magazine: { count: t.bolts, reload: t.reload, at: { x: 0, y: 2.15 }, angle: 0, shell: t.bolt, railgun: { channel: `${name}.fire`, speed: t.speed } },
  });
  box("gun", 0.75, 1.05, 0.9, 2.7, 1);

  for (const [part, x] of [["tank", -2.4], ["gen", -0.8], ["battery", 2.6]] as const) {
    weld(`${part}-a`, "base", part, { x: x - 0.4, y: 0.3 });
    weld(`${part}-b`, "base", part, { x: x + 0.4, y: 0.3 });
  }
  weld("mount-a", "base", "mount", { x: 0.2, y: 0.3 }, GUN_WELD);
  weld("mount-b", "base", "mount", { x: 1.6, y: 0.3 }, GUN_WELD);
  weld("pipe-tank", "tank", "pipe", { x: -1.7, y: 0.575 });
  weld("pipe-gen", "pipe", "gen", { x: -1.3, y: 0.575 });
  weld("pivot", "mount", "carriage", pivot, GUN_WELD, { turn: { rate: t.rate, min: round(-t.arc), max: round(t.arc), target: 0 } });
  weld("gun", "carriage", "gun", { x: 0.9, y: 0.95 }, GUN_WELD);

  // Fuel: tank to pipe to generator, each resource. The gun's trigger.
  for (const res of ["h2", "o2"]) {
    links.push({ id: id(`feed-${res}-a`), kind: "feed", from: id("tank"), to: id("pipe"), resource: res, rate: 0.5 });
    links.push({ id: id(`feed-${res}-b`), kind: "feed", from: id("pipe"), to: id("gen"), resource: res, rate: 0.5 });
  }
  links.push({ id: id("ctl-fire"), kind: "control", channel: `${name}.fire`, to: id("carriage") });
  return { bodies, joints, links, carriage: id("carriage"), tank: id("tank") };
}

/**
 * Thin metal for a power node (J): one of the ship's slugs sets it off. The barrel is thinner
 * still, and its outer part is held by a light weld: a slug that only glances off it still
 * destroys it or knocks it off. The arc is the turret's HULL: two slugs.
 */
const NODE = { name: "node", threshold: 60, toughness: 500 };
const BARREL = { name: "barrel", threshold: 30, toughness: 150 };

export interface ElectricTuning {
  /** As the fuel turret's (TurretTuning): sight, timing, aim, bolt and gun. */
  range: number;
  wait: number;
  hold: number;
  aim: "random" | "ship";
  /** The barrel's travel either side of straight up, along the arc, rad, and how fast it moves, rad/s. */
  arc: number;
  rate: number;
  bolt: Json;
  speed: number;
  reload: number;
  bolts: number;
}

/** The electric turret's shape (m): its base, the arc over it, and the barrel that rides the arc. */
export const ELECTRIC = {
  /** The base plate. */
  base: { width: 7.6, height: 0.4 },
  /** The arc: a circular segment on the base, its chord this wide and this high at the middle. */
  arc: { chord: 5.8, height: 1.9 },
  /** The barrel: the breech (which turns on the arc and carries the bolts) and the outer barrel, each this long. */
  breech: { width: 0.5, length: 1 },
  outer: { width: 0.28, length: 1 },
  /** How far the outer barrel folds back into the breech when it fires, m (drawn: see render.ts). */
  recoil: 0.7,
};

/**
 * An electric turret standing at `at` (the middle of its base's underside), its up turned by
 * `angle` from +y (Chloe's drawing, 13 November 2026). A fixed base on the rock; on it a neat arc,
 * welded; at each end of the arc a power node, which explodes when it is destroyed; and a barrel in
 * two parts that rides along the arc, turning about the arc's centre on a joint that turns
 * (ASM-008). Until the power design comes it needs no power (no battery). One slug on the barrel
 * destroys it; two on the arc; one on a node sets it off, and the blast puts the turret out of action.
 *
 *            ||  barrel (outer, breech)
 *        .-''''''-.     arc
 *      /|          |\   nodes at the arc's feet
 *    ====================  base
 */
export function electricTurret(name: string, at: Vec, angle: number, t: ElectricTuning, seed: number, battery?: string) {
  const bodies: Json[] = [];
  const joints: Json[] = [];
  const links: Json[] = [];
  const id = (part: string) => `${name}-${part}`;
  const place = (p: Vec): Vec => {
    const r = rot(p, angle);
    return { x: round(at.x + r.x), y: round(at.y + r.y) };
  };
  const centre = new Map<string, Vec>();
  const local = (part: string, p: Vec) => ({ x: round(p.x - centre.get(part)!.x), y: round(p.y - centre.get(part)!.y) });
  /** A body whose outline is `vertices` in the turret's frame: placed at their centroid. */
  const polygon = (part: string, vertices: Vec[], mass: number, extra: Json, turn = 0) => {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < vertices.length; k++) {
      const p = vertices[k];
      const q = vertices[(k + 1) % vertices.length];
      const c = p.x * q.y - q.x * p.y;
      a += c;
      cx += (p.x + q.x) * c;
      cy += (p.y + q.y) * c;
    }
    const c = { x: cx / (3 * a), y: cy / (3 * a) };
    centre.set(part, c);
    const shape = { kind: "polygon", vertices: vertices.map((p) => { const r = rot({ x: p.x - c.x, y: p.y - c.y }, -turn); return { x: round(r.x), y: round(r.y) }; }) };
    bodies.push({ id: id(part), shape, mass, position: place(c), velocity: { x: 0, y: 0 }, angle: round(angle + turn), angularVelocity: 0, restitution: 0, friction: 0.4, material: HULL, ...extra });
  };
  const weld = (n: string, a: string, b: string, p: Vec, limits = WELD, extra: Json = {}) => {
    joints.push({ id: id(`w-${n}`), a: id(a), b: id(b), anchorA: local(a, p), anchorB: local(b, p), limits, ...extra });
  };

  const E = ELECTRIC;
  const top = E.base.height;
  // The base: a fixed plate on the rock, anchored to it (TER-006), as the fuel turret's.
  centre.set("base", { x: 0, y: top / 2 });
  bodies.push({ id: id("base"), fixed: true, shape: { kind: "box", width: E.base.width, height: top }, mass: 1, position: place({ x: 0, y: top / 2 }), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, friction: 0.9, anchored: { mass: 100 } });

  // The arc: a segment of a circle of radius R about `pivot`, its chord on the base.
  const half = E.arc.chord / 2;
  const R = (half * half + E.arc.height * E.arc.height) / (2 * E.arc.height);
  const pivot = { x: 0, y: top + E.arc.height - R };
  const reach = Math.asin(half / R);
  const arc: Vec[] = [];
  for (let k = 0; k <= 12; k++) {
    const a = reach - (2 * reach * k) / 12; // right to left: counter-clockwise
    arc.push({ x: pivot.x + R * Math.sin(a), y: pivot.y + R * Math.cos(a) });
  }
  polygon("arc", arc, 4, {});
  weld("arc-a", "base", "arc", { x: -half * 0.6, y: top }, GUN_WELD);
  weld("arc-b", "base", "arc", { x: half * 0.6, y: top }, GUN_WELD);

  // The power nodes: small trapezoids at the arc's feet. Destroyed, a node explodes.
  for (const [side, s] of [["l", -1], ["r", 1]] as const) {
    const inner = half - 0.05;
    const v = [
      { x: s * inner, y: top },
      { x: s * (inner + 0.85), y: top },
      { x: s * (inner + 0.65), y: top + 0.6 },
      { x: s * (inner + 0.2), y: top + 0.6 },
    ];
    polygon(`node-${side}`, s < 0 ? v.reverse() : v, 1, { material: NODE, explosive: { charge: 0.3, arm: 1e6, fragments: 6, radius: 4, whenDestroyed: true } });
    weld(`node-${side}`, "base", `node-${side}`, { x: s * (inner + 0.42), y: top });
  }

  // The barrel, radial from the pivot, standing on the arc: the breech turns on the joint and holds
  // the bolts; the outer barrel is welded to it.
  const r0 = R - 0.1;
  const r1 = r0 + E.breech.length;
  const r2 = r1 + E.outer.length;
  const box = (part: string, w: number, from: number, to: number, mass: number, extra: Json) =>
    polygon(part, [{ x: w / 2, y: pivot.y + from }, { x: w / 2, y: pivot.y + to }, { x: -w / 2, y: pivot.y + to }, { x: -w / 2, y: pivot.y + from }].reverse(), mass, { material: BARREL, ...extra });
  const breech = (r0 + r1) / 2;
  box("breech", E.breech.width, r0, r1, 1, {
    turret: { joint: id("w-pivot"), gun: id("breech"), barrel: id("barrel"), nodes: [id("node-l"), id("node-r")], ...(battery ? { battery, cabled: true } : {}), range: t.range, wait: t.wait, hold: t.hold, aim: t.aim, seed },
    magazine: { count: t.bolts, reload: t.reload, at: { x: 0, y: round(r2 + 0.15 - breech) }, angle: 0, shell: t.bolt, railgun: { channel: `${name}.fire`, speed: t.speed } },
  });
  box("barrel", E.outer.width, r1, r2, 0.5, { recoil: { gun: id("breech"), travel: E.recoil } });
  weld("pivot", "arc", "breech", pivot, GUN_WELD, { turn: { rate: t.rate, min: round(-t.arc), max: round(t.arc), target: 0 } });
  weld("barrel", "breech", "barrel", { x: 0, y: pivot.y + r1 }, LANDER_WELD);

  links.push({ id: id("ctl-fire"), kind: "control", channel: `${name}.fire`, to: id("breech") });
  return { bodies, joints, links, carriage: id("breech"), tank: undefined as string | undefined };
}

// ---- An electric turret's own power (Chloe's drawing, 14 November 2026; WPN-013) ----
//
//    (FUEL)==pipe==[gen]~~cable~~[cap]~~cable~~(turret)
//
// A fuel tank feeds a generator through a pipe; the generator charges a capacitor; the capacitor
// powers the turret. Each stands on its own pad on the rock. The cables can't be cut (they are
// drawn, not bodies); the pipe can.

/** One slug breaks a piece of pipe. */
const PIPE = { name: "pipe", threshold: 30, toughness: 150 };
/** What the pipe and the generator hold of fuel in passing, kg: next to nothing (WPN-013: it has no fuel of its own). */
const IN_PASSING = 0.0001;

/** A machine on a pad: a fixed plate anchored to the rock, and one body welded on it. Its frame: x along the rock, y up. */
function onPad(name: string, at: Vec, angle: number, pad: { width: number; mass: number }, part: { width: number; height: number; mass: number; extra: Json }) {
  const place = (p: Vec): Vec => {
    const r = rot(p, angle);
    return { x: round(at.x + r.x), y: round(at.y + r.y) };
  };
  const bodies: Json[] = [
    { id: `${name}-pad`, fixed: true, shape: { kind: "box", width: pad.width, height: 0.3 }, mass: 1, position: place({ x: 0, y: 0.15 }), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, friction: 0.9, anchored: { mass: pad.mass } },
    { id: name, shape: { kind: "box", width: part.width, height: part.height }, mass: part.mass, position: place({ x: 0, y: 0.3 + part.height / 2 }), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, restitution: 0, friction: 0.4, material: HULL, ...part.extra },
  ];
  const joints: Json[] = [-1, 1].map((k, n) => ({ id: `${name}-w-${n}`, a: `${name}-pad`, b: name, anchorA: { x: round((k * part.width) / 3), y: 0.15 }, anchorB: { x: round((k * part.width) / 3), y: round(-part.height / 2) }, limits: WELD }));
  return { bodies, joints };
}

/**
 * A generator at `at` (WPN-013): 1.4 m wide, 2.2 m tall, charging `battery` at `rate` shots a second
 * and burning `burn` kg/s while it does. Its light (drawn) is green while it is online: whole and fed.
 */
export function generator(name: string, at: Vec, angle: number, battery: string, t: { burn: number; charge: number }) {
  const stores = [
    { resource: "h2", mass: 0, capacity: round(IN_PASSING / 9) },
    { resource: "o2", mass: 0, capacity: round((8 * IN_PASSING) / 9) },
  ];
  return onPad(name, at, angle, { width: 2, mass: 20 }, { width: 1.4, height: 2.2, mass: 2, extra: { contents: stores, generator: { battery, burn: t.burn, rate: t.charge } } });
}

/**
 * A capacitor at `at` (WPN-013): 1.2 m wide, 1.8 m tall, holding `shots`. Its bar (drawn) shows how
 * full it is, red once empty. Destroyed, it fails with a small explosion, as the old battery did.
 */
export function capacitor(name: string, at: Vec, angle: number, shots: number) {
  return onPad(name, at, angle, { width: 1.8, mass: 20 }, { width: 1.2, height: 1.8, mass: 2, extra: { charge: { shots, capacity: shots }, explosive: { charge: 0.05, arm: 1e6, fragments: 4, radius: 1, whenDestroyed: true } } });
}

/**
 * A fuel pipe from `from` (a tank) to `to` (a generator) along `points`: a piece of pipe for each
 * stretch, fixed where it lies on the rock and anchored to it, each passing the fuel to the next by
 * feed links. One slug breaks a piece, and the fuel stops there.
 */
export function pipe(name: string, points: Vec[], from: string, to: string) {
  const bodies: Json[] = [];
  const links: Json[] = [];
  const ids: string[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k];
    const b = points[k + 1];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    const id = `${name}-${k + 1}`;
    ids.push(id);
    bodies.push({
      id,
      fixed: true,
      shape: { kind: "box", width: round(L), height: 0.3 },
      mass: 1,
      position: { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) },
      velocity: { x: 0, y: 0 },
      angle: round(Math.atan2(b.y - a.y, b.x - a.x)),
      angularVelocity: 0,
      friction: 0.6,
      material: PIPE,
      anchored: { mass: round(0.5 * L) },
      contents: [
        { resource: "h2", mass: 0, capacity: round(IN_PASSING / 9) },
        { resource: "o2", mass: 0, capacity: round((8 * IN_PASSING) / 9) },
      ],
    });
  }
  const chain = [from, ...ids, to];
  for (let k = 0; k + 1 < chain.length; k++)
    for (const res of ["h2", "o2"]) links.push({ id: `${name}-feed-${res}-${k + 1}`, kind: "feed", from: chain[k], to: chain[k + 1], resource: res, rate: 0.5 });
  return { bodies, links, pieces: ids };
}
