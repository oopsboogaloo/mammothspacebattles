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
  box("tank", -3.1, -1.7, 0.3, 1.3, 2, { material: TANK, contents: stores(t.fuel), explosive: { charge: 0.3, arm: 1e6, fragments: 6, radius: 4, whenDestroyed: true } });
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
