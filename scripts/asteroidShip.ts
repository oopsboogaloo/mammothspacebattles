// Mammoth Asteroids' own ship (docs/games/mammoth-asteroids-design.md §3.1), from Chloe's sketch of
// 11 November 2026: a cockpit with a railgun on its nose, a battery under it, a generator and a
// magazine each side, and a fuel tank as each wing. Five engines: a main thruster under the battery,
// and four small ones on the wings, two facing back and two facing forward, which turn the ship in
// place, add to the main thruster and brake.
type Json = Record<string, unknown>;
type Vec = { x: number; y: number };

/** Thin metal, as Lander's ship (energies in J). The tanks are thinner. */
const HULL = { name: "hull", threshold: 150, toughness: 3000 };
const TANK = { name: "tank", threshold: 60, toughness: 500 };
/**
 * Weld limits: Lander's (scripts/landShip.ts), times 3 and for the gun's mount times 6. Lander's own
 * bent under the railgun's recoil: its mount broke at about the 19th shot (design §3.1).
 */
const LANDER_WELD = { tension: 7650, compression: 15300, shear: 5350, torque: 1840 };
const stronger = (k: number) => ({ tension: LANDER_WELD.tension * k, compression: LANDER_WELD.compression * k, shear: LANDER_WELD.shear * k, torque: LANDER_WELD.torque * k });
const WELD = stronger(3);
const GUN_WELD = stronger(6);
const YIELD = 0.3;

const MIX = { h2: 1 / 9, o2: 8 / 9 };

export interface ShipTuning {
  /** Propellant flow of each small thruster and of the main one, kg/s at full command. */
  small: number;
  main: number;
  /** Fuel economy (FLT-010): the tanks supply this share less of what the engines throw. */
  economy: number;
  /** The railgun's magazine, as scenarios write it. */
  magazine: Json;
}

const rot = (v: Vec, a: number): Vec => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0; // + 0: never −0
const rv = (v: Vec): Vec => ({ x: round(v.x), y: round(v.y) });

/** The ship as a template: ids `p{n}-…`, pointing up (+y), its cockpit `p{n}-hull` centred on the origin. */
export function asteroidShip(t: ShipTuning) {
  const bodies: Json[] = [];
  const joints: Json[] = [];
  const links: Json[] = [];
  const at = new Map<string, { position: Vec; angle: number }>();
  const id = (name: string) => `p{n}-${name}`;

  const body = (name: string, shape: Json, mass: number, position: Vec, extra: Json = {}, angle = 0) => {
    at.set(name, { position, angle });
    bodies.push({ id: id(name), shape, mass, position: rv(position), velocity: { x: 0, y: 0 }, angle: round(angle), angularVelocity: 0, restitution: 0, friction: 0.3, material: HULL, ...extra });
  };
  const box = (name: string, x0: number, x1: number, y0: number, y1: number, mass: number, extra: Json = {}) =>
    body(name, { kind: "box", width: round(x1 - x0), height: round(y1 - y0) }, mass, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, extra);
  /** A convex polygon from its corners in the ship's frame: its body sits at their centroid. */
  const poly = (name: string, corners: Vec[], mass: number, extra: Json = {}, angle = 0) => {
    let a = 0;
    let c = { x: 0, y: 0 };
    for (let i = 0; i < corners.length; i++) {
      const p = corners[i];
      const q = corners[(i + 1) % corners.length];
      const w = p.x * q.y - q.x * p.y;
      a += w;
      c = add(c, { x: (p.x + q.x) * w, y: (p.y + q.y) * w });
    }
    c = { x: c.x / (3 * a), y: c.y / (3 * a) };
    body(name, { kind: "polygon", vertices: corners.map((p) => rv(rot(sub(p, c), -angle))) }, mass, c, extra, angle);
  };
  /** A weld between two parts at a point of the ship's frame. */
  const weld = (name: string, a: string, b: string, p: Vec, limits = WELD) => {
    const local = (part: string) => rv(rot(sub(p, at.get(part)!.position), -at.get(part)!.angle));
    joints.push({ id: id(`w-${name}`), a: id(a), b: id(b), anchorA: local(a), anchorB: local(b), limits, yield: YIELD });
  };

  // The row across the ship: tank, generator, battery, generator, tank; a magazine on each generator.
  const fuel = () => [
    { resource: "h2", mass: 0.9, capacity: 0.9 },
    { resource: "o2", mass: 7.2, capacity: 7.2 },
  ];
  // A tank's charge is its propellant's stored energy: it goes off when the tank is destroyed (LND-021).
  const tank = { material: TANK, contents: fuel(), explosive: { charge: 0.05, arm: 1e6, fragments: 6, radius: 0.5, whenDestroyed: true } };
  box("tank-l", -2.8, -1.3, -0.5, 0.5, 2, structuredClone(tank));
  box("tank-r", 1.3, 2.8, -0.5, 0.5, 2, structuredClone(tank));
  box("gen-l", -1.3, -0.6, -0.5, 0.3, 2);
  box("gen-r", 0.6, 1.3, -0.5, 0.3, 2);
  // A magazine explodes very violently when destroyed: 1 kg of its 3 kg is charge (TNT), reaching
  // 6 m. Measured: it destroys the cockpit, both tanks, the battery, the generator beside it and the
  // main thruster, so the ship is lost, and leaves about 14 damaged parts as wreckage. (2 kg at three
  // times TNT's energy left nothing of the ship at all.)
  const magazine = { explosive: { charge: 1, arm: 1e6, fragments: 8, radius: 6, whenDestroyed: true } };
  box("mag-l", -1.3, -0.6, 0.3, 0.75, 3, structuredClone(magazine));
  box("mag-r", 0.6, 1.3, 0.3, 0.75, 3, structuredClone(magazine));
  // The battery stores nothing yet (energy use is to come); destroyed, it fails with a small explosion.
  box("battery", -0.6, 0.6, -0.5, 0, 2, { explosive: { charge: 0.05, arm: 1e6, fragments: 4, radius: 1, whenDestroyed: true } });
  // The cockpit is the ship's hull: the game follows it, and the ship is lost with it.
  poly(
    "hull",
    [
      { x: -0.6, y: 0 },
      { x: 0.6, y: 0 },
      { x: 0.6, y: 0.7 },
      { x: 0.3, y: 1.2 },
      { x: -0.3, y: 1.2 },
      { x: -0.6, y: 0.7 },
    ],
    6,
  );
  // The railgun, on the centre line so its recoil doesn't turn the ship. The bore is along +y.
  box("gun", -0.15, 0.15, 1.2, 1.9, 1, { magazine: t.magazine });

  for (const s of ["l", "r"] as const) {
    const k = s === "l" ? -1 : 1;
    weld(`tank-gen-${s}-a`, `tank-${s}`, `gen-${s}`, { x: 1.3 * k, y: -0.4 });
    weld(`tank-gen-${s}-b`, `tank-${s}`, `gen-${s}`, { x: 1.3 * k, y: 0.2 });
    weld(`gen-battery-${s}`, `gen-${s}`, "battery", { x: 0.6 * k, y: -0.25 });
    weld(`gen-mag-${s}`, `gen-${s}`, `mag-${s}`, { x: 0.95 * k, y: 0.3 });
    weld(`mag-hull-${s}`, `mag-${s}`, "hull", { x: 0.6 * k, y: 0.5 });
    weld(`gen-hull-${s}`, `gen-${s}`, "hull", { x: 0.6 * k, y: 0.15 });
    weld(`gun-${s}`, "hull", "gun", { x: 0.1 * k, y: 1.2 }, GUN_WELD);
  }
  weld("battery-hull", "battery", "hull", { x: 0, y: 0 });

  /**
   * An engine: a head that injects and lights the propellant, between two walls that open out to
   * make its nozzle. `mouth` is the middle of the head's face; `angle` turns the engine from firing
   * down (0) to firing up (π). Thrust comes only from the gas on the head and walls.
   */
  const engine = (name: string, channel: string, onto: string, mouth: Vec, angle: number, width: number, length: number, flare: number, rate: number, mass: number, tanks: string[]) => {
    const place = (p: Vec) => add(mouth, rot(p, angle));
    const thick = 0.1;
    const head = 0.15;
    at.set(name, { position: place({ x: 0, y: head / 2 }), angle });
    bodies.push({
      id: id(name),
      shape: { kind: "box", width, height: head },
      mass: mass * 0.5,
      position: rv(place({ x: 0, y: head / 2 })),
      velocity: { x: 0, y: 0 },
      angle: round(angle),
      angularVelocity: 0,
      restitution: 0,
      friction: 0.3,
      material: HULL,
      // What is left in an engine goes up with it: a small explosion when it is destroyed (MAS-037).
      explosive: { charge: round(0.004 * mass), arm: 1e6, fragments: 4, radius: 0.5, whenDestroyed: true },
      contents: [
        { resource: "h2", mass: 0, capacity: round(rate * 0.02 * MIX.h2) },
        { resource: "o2", mass: 0, capacity: round(rate * 0.02 * MIX.o2) },
      ],
      injector: {
        channel,
        rate,
        mixture: MIX,
        outlet: { x: 0, y: -head / 2 - 0.05 },
        direction: { x: 0, y: -1 },
        width: round((width - 2 * thick) * 0.75),
        speed: 10,
        parcelMass: round(Math.max(0.001, rate / 500)),
        radius: 0.035,
        igniter: true,
        chamber: { width, length: round(length + 0.25) },
        economy: t.economy,
      },
    });
    for (const k of [-1, 1]) {
      const side = k < 0 ? "a" : "b";
      const top = (width / 2) * k;
      const bottom = (width / 2 + flare) * k;
      const corners = [
        { x: top - thick * k, y: 0 },
        { x: top, y: 0 },
        { x: bottom, y: -length },
        { x: bottom - thick * k, y: -length },
      ].map(place);
      poly(`${name}-wall-${side}`, k * Math.cos(angle) < 0 ? corners : corners.slice().reverse(), mass * 0.25, {}, angle);
      weld(`${name}-wall-${side}`, name, `${name}-wall-${side}`, place({ x: top - (thick / 2) * k, y: 0 }));
    }
    weld(`${onto}-${name}`, onto, name, place({ x: 0, y: head }));
    // What the engine draws from its stores is its flow less the economy's share. One tank feeds it
    // four times that. Two tanks each feed it just over half, so they empty together and the ship
    // stays balanced: with more, the first tank would supply it all.
    const draw = rate / t.economy;
    tanks.forEach((tk, i) => {
      for (const [res, share] of Object.entries(MIX)) links.push({ id: id(`feed-${res}-${name}${tanks.length > 1 ? `-${i}` : ""}`), kind: "feed", from: id(tk), to: id(name), resource: res, rate: round(draw * share * (tanks.length > 1 ? 0.52 : 4)) });
    });
    links.push({ id: id(`ctl-${name}`), kind: "control", channel, to: id(name) });
  };

  // The main thruster, under the battery, fed by both tanks.
  engine("main", "main", "battery", { x: 0, y: -0.65 }, 0, 1.2, 1.1, 0.25, t.main, 3, ["tank-l", "tank-r"]);
  // The small thrusters, two on each wing: back ones fire down and push the ship forward, front ones
  // fire up and push it back. Each is fed by its own wing's tank.
  for (const s of ["l", "r"] as const) {
    const x = s === "l" ? -2.05 : 2.05;
    engine(`back-${s}`, `b${s}`, `tank-${s}`, { x, y: -0.65 }, 0, 0.8, 0.7, 0.12, t.small, 1.2, [`tank-${s}`]);
    engine(`front-${s}`, `f${s}`, `tank-${s}`, { x, y: 0.65 }, Math.PI, 0.8, 0.7, 0.12, t.small, 1.2, [`tank-${s}`]);
  }
  links.push({ id: id("ctl-fire"), kind: "control", channel: "fire", to: id("gun") });
  // The game places a ship by its hull: the parts are laid out round the cockpit's centre.
  const o = at.get("hull")!.position;
  for (const b of bodies) b.position = rv(sub(b.position as Vec, o));
  return { bodies, joints, links };
}

/**
 * How the player's three controls drive the five engines (MAS-035). An engine fires when any of its
 * rows holds: every channel in `on` held, and none in `off`.
 *   right alone: back left and front right, which turn the ship right where it is;
 *   left alone: back right and front left;
 *   both: the main thruster and both back ones;
 *   reverse: both front ones.
 */
export const SHIP_MIX = [
  { channel: "bl", any: [{ on: ["right"] }] },
  { channel: "br", any: [{ on: ["left"] }] },
  { channel: "fr", any: [{ on: ["right"], off: ["left"] }, { on: ["reverse"] }] },
  { channel: "fl", any: [{ on: ["left"], off: ["right"] }, { on: ["reverse"] }] },
  { channel: "main", any: [{ on: ["left", "right"] }] },
];
