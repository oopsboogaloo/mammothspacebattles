// Mammoth Thrust's levels (docs/games/mammoth-thrust.md §3, -design.md §4): the ground from an
// outline of its open space, the ship (Mammoth Asteroids' ship with a tractor unit and a tether
// unit), and the pod on its stand. The game itself is in the world (src/core/thrust.ts).
//   node scripts/thrust.ts            writes scenarios/thrust-1.json … thrust-6.json, and thrust-test.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initialWorld, parseScenario } from "../src/core/index.ts";
import { bearingsOnto } from "./aim.ts";
import { asteroidShip, SHIP_MIX } from "./asteroidShip.ts";
import { narrowest, type Vec } from "./terrain.ts";
import { capacitor, electricTurret, generator, pipe, turret, type ElectricTuning, type TurretTuning } from "./turretParts.ts";
import { antenna, powerPlant, type PlantTuning } from "./plantParts.ts";

const root = new URL("..", import.meta.url).pathname;
type Json = Record<string, unknown>;

/** Gravity, m/s² (Lander's is 1.6): a first value, to tune after play. */
const GRAVITY = 4;
/**
 * The engines' propellant flow, kg/s. The main thruster is Mammoth Asteroids'. The small ones have
 * twice its flow, for about twice the turning (MTH-020): they also brake harder and add to the
 * forward push. Measured in tests/core/thrust.test.ts.
 */
const SMALL = 1.45;
const MAIN = 7.776;
const ECONOMY = 66;
/** No passage is narrower than this, m (MTH-012): the tether is 12 m and the pod must swing through. */
const LEAST_WIDTH = 25;
/** The rock closes over the sky this far above the level's top, m: nothing flies that high (MTH-026). The sides wrap round. */
const WALL = 60;
/** The sky's outline is closed this high, m: far above any view. */
const SKY = 3000;

/** The ship: Mammoth Asteroids', with solid slugs (no charge), a tractor unit and a tether unit. */
function ship() {
  // A solid slug: no blast, so a shot at a wall beside the ship does nothing to it (MTH-020).
  const slug = { shape: { kind: "box", width: 0.26, height: 0.22 }, mass: 0.166667, restitution: 0, friction: 0.05 };
  const magazine = { count: 120, reload: 0.25, at: { x: 0, y: 0.51 }, angle: 0, shell: slug, railgun: { channel: "fire", speed: 144 } };
  // The beam is a 30° wedge down the ship's tail. It pulls whatever is free in it (TRC-013: Chloe,
  // 13 November 2026, to try again), but the tether takes only the pod (TRC-011): not the wreckage
  // of the ships before. It draws nothing toward the ship faster than 3 m/s (TRC-014; Chloe, 14
  // November 2026: pulled wreckage was arriving fast enough to wreck the ship): its pull fades to
  // nothing as the closing speed reaches that. Its pull is three times the engine's default (asked for by Chloe after
  // playing, 12 November 2026: picking the pod up was too hard).
  // The tether is the TRC spring between the two centres of mass (TRC-004), 12 m long. It takes the
  // pod from up to 22 m off, starts at the distance it took it at, and reels it in (or pays out) to
  // 12 m at 6 m/s (TRC-010), heavily damped, so nothing is snatched or thrown. It holds five times
  // the pull it did: Chloe had it let go under thrust.
  // Held on a fuel tank in its wedge, the beam draws the tank's fuel into the ship's two tanks
  // (TRC-008), 2 kg a game second: a full 8.1 kg tank in 8 s on screen. The tank isn't pulled.
  const tractor = { channel: "tractor", range: 40, arc: Math.PI / 6, force: 1200, maxSpeed: 3, capture: 1.2, only: ["pod"], pullAny: true, siphon: { rate: 2 }, tether: { length: 12, reach: 22, stiffness: 2000, damping: 1.5, maxTension: 100000, payOut: 6 } };
  // The shield (SHD-001…SHD-006; Chloe, 14 November 2026): held on, a field grows round the ship
  // in a quarter of a game second and stays up while there is fuel: 0.4 kg a game second (half the
  // first 0.8, which Chloe found drained it far too fast), so full tanks (8.1 kg) last 40 s on
  // screen. Each hit costs more: 0.0025 kg for each N·s of its impulse, at least 0.05 kg. The
  // engines and the gun don't work while it is up. The field weighs 2 kg.
  // It is elastic (SHD-006): it clears the ship by 1.5 m and is held to the ship's centre by a
  // spring of 3,000 N/m, damped at 0.15 of critical, pulling on the cockpit. Struck, it gives, the
  // ship sinking into it over that 1.5 m, and pushes back. Measured falling flat onto rock (no
  // gravity, the test level): undamaged up to 25 m/s and bouncing back at two thirds of its speed;
  // 2 welds broken at 30 m/s and 4 at 40, where the spring bottoms out and the ship's parts meet
  // the rock. Without a shield 4 welds break at 20 m/s; with the first, rigid field 2 at 20 and 7 at 30.
  const shield = { channel: "shield", grow: 14, burn: 0.4, hitBurn: 0.0025, minHit: 0.05, mass: 2, margin: 1.5, spring: { stiffness: 3000, damping: 0.15 } };
  // Half Mammoth Asteroids' fuel (Chloe, 14 November 2026: with a full load you never needed to
  // refuel): 8.1 kg in the two tanks, as much as one fuel tank on the ground holds.
  return asteroidShip({ small: SMALL, main: MAIN, economy: ECONOMY, magazine, tractor, shield, fuel: 0.5 });
}

/**
 * A turret's bolt (MTH-032): concussive. A small charge that makes 6 kg of gas (a cheat the ledger
 * records, as Mammoth Asteroids' shell) and damages only what is within 0.6 m of it, so it mostly
 * pushes the ship off course. Measured on the ship at rest: a burst 2 m from a wing tip pushes it
 * 0.6 m/s and breaks nothing; a direct hit pushes it 2.3 m/s, turns it, and destroys the part it
 * strikes. First values, for Chloe to tune.
 */
const BOLT = { shape: { kind: "disc", radius: 0.12 }, mass: 0.3, restitution: 0, friction: 0.3, explosive: { charge: 0.05, heat: 3e7, fragments: 0, radius: 0.6, gas: 6 } };
/**
 * The MVP1 turret (spec §3). Times are game seconds: it waits 3 s on screen from first sight, fires
 * every 2 s, and turns at 120° a second on screen. It turns to a random bearing in its arc before
 * each shot ("random"); aiming roughly at the ship ("ship") is the next step.
 */
/**
 * The electric turret (Chloe's drawing, 13 November 2026): the fuel turret's sight, timing and gun,
 * with the barrel riding 50° either way along its arc. It needs no power until the power design.
 */
const ELECTRIC_TURRET: ElectricTuning = { range: 80, wait: 1.5, hold: 0.25, aim: "random", arc: 0.87, rate: 2.1, bolt: BOLT, speed: 40, reload: 1, bolts: 40 };
/**
 * The power plant (Chloe, 13 November 2026). Times are game seconds (half of screen seconds): a hit
 * takes it offline 5 s on screen, and each hit while it is down 2 s more; critical, it blows 10 s
 * later. Its 12 kg of coolant leaks 0.1 kg/s for each slug in its domes: one slug empties it in 4
 * minutes on screen, two in two, and so on. Every third slug opens a new leak where it strikes; the
 * others make the newest leak bigger (Chloe: fewer, stronger leaks that show). The gas leaves at
 * 20 m/s, so each slug's share pushes 2 N. A ship in the transmitter's shock has no control for 1 s.
 */
const PLANT: PlantTuning = { coolant: 12, rate: 0.1, parcel: 0.01, puff: 0.12, charge: 3, radius: 14 };
/**
 * An explosion that reaches a dome punches up to 3 leaks in it (Chloe). Below half its coolant the
 * power fails for 2 to 3 s on screen at a time, more often as the coolant falls: on average once
 * every 8 s on screen at a quarter left, every 4 s near empty (0.5 a game second).
 */
const PLANT_LEAK = { perLeak: 3, leakSpeed: 20, blastLeaks: 3, outages: { below: 0.5, rate: 0.5, last: [1, 1.5] as [number, number] }, seed: 31 };
const PLANT_OFFLINE = { first: 2.5, more: 1 };
/** Turrets don't fire within this of a clear shot at the plant, rad (WPN-014): 10°. */
const REACTOR_MARGIN = (10 * Math.PI) / 180;
/** From critical to the blast, game seconds: 30 s on screen (Chloe, 14 November 2026: 10 was really tough). */
const PLANT_COUNTDOWN = 15;
const SHOCK = 0.5;
const TURRET: TurretTuning = { range: 80, wait: 1.5, hold: 0.25, aim: "random", arc: Math.PI / 3, rate: 2.1, bolt: BOLT, speed: 40, reload: 1, bolts: 40, shots: 5, charge: 1, burn: 0.02, fuel: 8.1 };

/**
 * Craters (TER-002, TER-003; asked for by Chloe, 12 November 2026). An explosion leaves one of 0.6
 * of its blast's reach: a turret's fuel tank 2.4 m, one of the ship's magazines 3.6 m. One that
 * would be under 1 m leaves none: a turret's bolt, the ship's battery, tanks and engines. Bullets
 * leave none either (the slug is still spent in the rock): with a crater for every slug and bolt
 * the ground's bodies grew past what a step can afford, and Chloe chose to keep craters for
 * explosions. So the limits are rarely near: 250 craters at most. First values.
 */
const CRATERS = { blast: 0.6, bullet: 0, least: 1, most: 8, limit: 250, small: 150 };

/** To a millionth, as the scenarios are written. */
const r6 = (n: number) => Math.round(n * 1e6) / 1e6 + 0;
const fixed = (id: string, shape: Json, position: Vec): Json => ({ id, fixed: true, mass: 1, friction: 0.9, position, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape });

/**
 * The pod on its stand, on flat floor at `at`: a disc of 1 m radius and about half the ship's mass,
 * very hard to destroy (MTH-025), in a shallow cup so it doesn't roll off.
 */
function pod(at: Vec, angle = 0): Json[] {
  // The stand is anchored to the rock (TER-006): cut the rock at its foot and its three parts come
  // loose as one, 30 kg, and the pod goes with it. On an asteroid it stands at `angle` from upright.
  const off = (x: number, y: number): Vec => ({ x: r6(at.x + x * Math.cos(angle) - y * Math.sin(angle)), y: r6(at.y + x * Math.sin(angle) + y * Math.cos(angle)) });
  const part = (id: string, shape: Json, position: Vec, mass: number): Json => ({ ...fixed(id, shape, position), angle: r6(angle), anchored: { mass, group: "stand" } });
  return [
    part("stand", { kind: "box", width: 2.3, height: 0.3 }, off(0, 0.15), 20),
    part("stand-l", { kind: "box", width: 0.3, height: 0.35 }, off(-1, 0.475), 5),
    part("stand-r", { kind: "box", width: 0.3, height: 0.35 }, off(1, 0.475), 5),
    {
      id: "pod",
      shape: { kind: "disc", radius: 1 },
      mass: 34,
      position: off(0, 1.3),
      velocity: { x: 0, y: 0 },
      angle: 0,
      angularVelocity: 0,
      restitution: 0,
      friction: 0.6,
      material: { name: "pod", threshold: 20_000, toughness: 200_000 },
      explosive: { charge: 0.2, arm: 1e6, fragments: 6, radius: 3, whenDestroyed: true },
    },
  ];
}

/** Thin metal for a fuel tank, as the turrets' (J): one slug sets it off. */
const TANK = { name: "tank", threshold: 60, toughness: 500 };
/** What a fuel tank holds, kg: half the ship's load (hydrogen and oxygen, 1 to 8). */
const TANK_FUEL = 8.1;

/**
 * A fuel tank standing on flat rock at `at` (spec §3, Fuel): a free tank welded to a pad that is
 * anchored to the rock. The ship draws its fuel through the beam (MTH-042). While it holds fuel it
 * explodes when destroyed (MTH-043).
 */
function fuelTank(name: string, at: Vec, angle = 0) {
  // Round, on two stands (Chloe's drawing, 14 November 2026: a circle with FUEL on it): a 2 m disc
  // welded to two legs on a pad, the three fixed and anchored to the rock as one (TER-006).
  const store = (resource: string, mass: number) => ({ resource, mass: Math.round(mass * 1e6) / 1e6, capacity: Math.round(mass * 1e6) / 1e6 });
  const off = (x: number, y: number): Vec => ({ x: r6(at.x + x * Math.cos(angle) - y * Math.sin(angle)), y: r6(at.y + x * Math.sin(angle) + y * Math.cos(angle)) });
  const R = 1;
  const legX = 0.75;
  const legTop = r6(R + 0.6 - Math.sqrt(R * R - legX * legX)); // where the disc meets the legs
  const legH = r6(legTop - 0.3);
  const stand = (id: string, shape: Json, x: number, y: number, mass: number): Json => ({ ...fixed(id, shape, off(x, y)), angle: r6(angle), anchored: { mass, group: name } });
  const bodies: Json[] = [
    stand(`${name}-pad`, { kind: "box", width: 2.4, height: 0.3 }, 0, 0.15, 20),
    stand(`${name}-leg-l`, { kind: "box", width: 0.25, height: legH }, -legX, 0.3 + legH / 2, 5),
    stand(`${name}-leg-r`, { kind: "box", width: 0.25, height: legH }, legX, 0.3 + legH / 2, 5),
    {
      id: name,
      shape: { kind: "disc", radius: R },
      mass: 2,
      position: off(0, R + 0.6),
      velocity: { x: 0, y: 0 },
      angle: r6(angle),
      angularVelocity: 0,
      restitution: 0,
      friction: 0.4,
      material: TANK,
      siphon: true,
      contents: [store("h2", TANK_FUEL / 9), store("o2", (8 * TANK_FUEL) / 9)],
      explosive: { charge: 0.3, arm: 1e6, fragments: 6, radius: 4, whenDestroyed: true },
    },
  ];
  const limits = { tension: 22950, compression: 45900, shear: 16050, torque: 5520 };
  const joints: Json[] = (["l", "r"] as const).map((side, k) => {
    const x = side === "l" ? -legX : legX;
    return { id: `${name}-w-${k}`, a: `${name}-leg-${side}`, b: name, anchorA: { x: 0, y: r6(legH / 2) }, anchorB: { x, y: r6(legTop - (R + 0.6)) }, limits };
  });
  return { bodies, joints, tank: name };
}

interface Level {
  n: number;
  /** The scenario's file name, if not `thrust-{n}` (a test level). */
  file?: string;
  title: string;
  description: string;
  colour: string;
  /** The surface, left to right, and the height that ends the level. */
  top: number;
  /** The open space, clockwise (scripts/terrain.ts), without the sky's top: from the right wall's foot to the left wall's foot. */
  ground: Vec[];
  /** The caves, each a closed outline, for the view; and the height below which the least width is checked. */
  caves: Vec[][];
  caveBelow?: number;
  /** Dead-end alcoves left out of that check, as boxes (lower left, upper right); and a lower least width for this level, m. */
  alcoves?: [Vec, Vec][];
  leastWidth?: number;
  start: Vec;
  pod: Vec;
  /** The turrets: where each stands (the middle of its base, on flat rock) and which way is up for it, rad from +y. */
  turrets: { at: Vec; angle: number; electric?: boolean }[];
  /** The fuel tanks: where each stands, on flat rock (and on an asteroid, turned by `angle` from upright). */
  tanks: (Vec | { at: Vec; angle: number })[];
  /** The pod's stand's turn from upright, rad (an asteroid's). */
  podAngle?: number;
  /**
   * The power plant, if the level has one (plant.ts): where it stands; its two antennae (where each
   * stands and which way it points); its power lines, each needing the transmitter (`"tx"`) or not;
   * and which turrets (by number) are fed through the transmitter.
   */
  /**
   * An asteroid level: the rock is an island (its outline, counter-clockwise, cave included) in a
   * square of open space `box` m from the centre each way; its gravity is a uniform ball's of
   * `radius` with `gravity` m/s² at the surface (FLT-015), pulling toward the centre (0, 0); and the
   * level is left by getting `escape` m from the centre. `ground` and `top` aren't used.
   */
  asteroid?: { island: Vec[]; radius: number; gravity: number; box: number; escape: number; core?: Vec };
  /**
   * Electric turrets with their own power (WPN-013; Chloe's drawings, 14 November 2026): turrets
   * numbered `turrets` (from 1) are powered by one capacitor, charged by a generator, fed by fuel
   * tank number `tank` (from 1) through a pipe along `pipe` (tank to generator). The cables are
   * drawn along `cables`, each lit by the generator or the capacitor it leaves from.
   */
  powered?: { turrets: number[]; generator: { at: Vec; angle?: number }; capacitor: { at: Vec; angle?: number }; tank: number; pipe: Vec[]; cables: { points: Vec[]; from: "generator" | "capacitor" }[] }[];
  /** Seeds the turrets' generators: the level's number × 100 if not given (a renumbered level keeps its own). */
  seed?: number;
  plant?: {
    at: Vec;
    /** The plant's turn from upright, rad (on an asteroid's sloping floor). */
    angle?: number;
    /** One transmitter's two antennae ("tx"); or several transmitters, each its own pair. */
    antennae?: [{ at: Vec; angle: number }, { at: Vec; angle: number }];
    transmitters?: { id: string; antennae: [{ at: Vec; angle: number }, { at: Vec; angle: number }] }[];
    lines: { points: Vec[]; needs?: string[] }[];
    /** The turrets (by number) fed through the transmitter; or what each of those needs, by number. */
    beyond: number[] | Record<number, string[]>;
  };
}

/**
 * The levels wrap round (Chloe, 14 November 2026: no walls). A level's two ends meet at the same
 * height: each end is taken to the height halfway between the two, flat for its last few metres, so
 * flying off one side the ground goes on smoothly into the other.
 */
function joinEnds(ground: Vec[]): Vec[] {
  const r = ground[0];
  const l = ground[ground.length - 1];
  const h = Math.round(((r.y + l.y) / 2) * 10) / 10;
  const flat = (end: Vec, next: Vec, dir: number): Vec => ({ x: Math.round((end.x + dir * Math.min(LINK, Math.abs(next.x - end.x) / 2)) * 10) / 10, y: h });
  return [P(r.x, h), flat(r, ground[1], -1), ...ground.slice(1, -1), flat(l, ground[ground.length - 2], 1), P(l.x, h)];
}
/** How far each end of a level runs flat to meet the other, m. */
const LINK = 6;

function write(l0: Level) {
  const l = l0.asteroid ? l0 : { ...l0, ground: joinEnds(l0.ground) };
  const ast = l.asteroid;
  const left = ast ? -ast.box : l.ground[l.ground.length - 1].x;
  const right = ast ? ast.box : l.ground[0].x;
  // The outline that makes the rock: closed over the sky a little above the level's top; on an
  // asteroid level, the square of open space round the asteroid, clockwise.
  const air = ast ? [P(-ast.box, ast.box), P(ast.box, ast.box), P(ast.box, -ast.box), P(-ast.box, -ast.box)] : [{ x: left, y: l.top + WALL }, { x: right, y: l.top + WALL }, ...l.ground];
  if (l.caveBelow !== undefined) {
    const w = narrowest(air, l.caveBelow, l.alcoves);
    const least = l.leastWidth ?? LEAST_WIDTH;
    if (w < least) throw new Error(`level ${l.n}: a passage is ${w.toFixed(1)} m wide, less than ${least} m`);
  }
  // The sky, for the stars: the open space above the ground, closed across each cave's mouth.
  const inCave = (p: Vec) => l.caves.some((c) => c.slice(1, -1).some((q) => q.x === p.x && q.y === p.y));
  // It reaches 1 m past each side, so that where the level's copies meet (MTH-093) their skies
  // overlap: two skies only touching left a faint line of rock between them.
  const O = 1;
  const g0 = l.ground[0];
  const g1 = l.ground[l.ground.length - 1];
  const sky = ast
    ? [P(-ast.box - O, ast.box + O), P(ast.box + O, ast.box + O), P(ast.box + O, -ast.box - O), P(-ast.box - O, -ast.box - O)]
    : [{ x: left - O, y: SKY }, { x: right + O, y: SKY }, { x: right + O, y: g0.y }, ...l.ground.filter((p) => !inCave(p)), { x: left - O, y: g1.y }];
  // Each group of powered turrets is named for its first turret: `t{n}-cap`, `t{n}-gen`, `t{n}-pipe`.
  const group = (p: NonNullable<Level["powered"]>[number]) => `t${p.turrets[0]}`;
  const supply = new Map((l.powered ?? []).flatMap((p) => p.turrets.map((k) => [k, group(p)] as const)));
  const turrets = l.turrets.map((t, k) =>
    t.electric
      ? electricTurret(`t${k + 1}`, t.at, t.angle, ELECTRIC_TURRET, (l.seed ?? 100 * l.n) + k + 1, supply.has(k + 1) ? `${supply.get(k + 1)}-cap` : undefined)
      : turret(`t${k + 1}`, t.at, t.angle, TURRET, (l.seed ?? 100 * l.n) + k + 1),
  );
  // Each powered turret's capacitor, generator and pipe (WPN-013), and the cables drawn between them.
  const machines = (l.powered ?? []).flatMap((p) => {
    const name = group(p);
    const gen = generator(`${name}-gen`, p.generator.at, p.generator.angle ?? 0, `${name}-cap`, { burn: TURRET.burn, charge: TURRET.charge });
    const cap = capacitor(`${name}-cap`, p.capacitor.at, p.capacitor.angle ?? 0, TURRET.shots);
    const fuel = pipe(`${name}-pipe`, p.pipe, `fuel-${p.tank}`, `${name}-gen`);
    return [{ bodies: [...gen.bodies, ...cap.bodies, ...fuel.bodies], joints: [...gen.joints, ...cap.joints], links: fuel.links }];
  });
  const cables = (l.powered ?? []).flatMap((p) => p.cables.map((c) => ({ points: c.points, from: `${group(p)}-${c.from === "generator" ? "gen" : "cap"}` })));
  const tanks = l.tanks.map((t, k) => ("at" in t ? fuelTank(`fuel-${k + 1}`, t.at, t.angle) : fuelTank(`fuel-${k + 1}`, t)));
  const plant = l.plant ? powerPlant(l.plant.at, PLANT, l.plant.angle ?? 0) : undefined;
  const txs = l.plant ? (l.plant.transmitters ?? [{ id: "tx", antennae: l.plant.antennae! }]) : [];
  const aerials = txs.flatMap((t) => t.antennae).map((a, k) => antenna(`aerial-${k + 1}`, a.at, a.angle));
  const needsOf = (k: number): string[] | undefined => {
    const b = l.plant?.beyond;
    if (!b) return undefined;
    if (Array.isArray(b)) return b.includes(k) ? ["tx"] : undefined;
    return b[k];
  };
  const name = l.file ?? `thrust-${l.n}`;
  const scenario = {
    schema: 1,
    name,
    title: `Mammoth Thrust: ${l.title}`,
    description: l.description,
    profile: "sandbox",
    seed: 1,
    world: {
      gravity: ast ? { x: 0, y: 0 } : { x: 0, y: -GRAVITY },
      // The world wraps round at its sides (FLT-012, TER-008): the outline's sides lie on them, so
      // they are open, not rock. An asteroid's square wraps on all four sides.
      bounds: ast ? { min: { x: -ast.box, y: -ast.box }, max: { x: ast.box, y: ast.box }, wrap: true, farField: 10, depth: 2 } : { min: { x: left, y: Math.min(...l.ground.map((p) => p.y)) - 40 }, max: { x: right, y: l.top + WALL + 20 }, wrap: true, farField: 10, depth: 2 },
      // The rock is made from the outline when the world is (TER-001), and explosions and shells crater it.
      terrain: { outline: air, ...(ast ? { islands: [ast.island] } : {}), prefix: "rock-", craters: CRATERS },
      bodies: [
        // An asteroid's gravity: a source at its centre that pulls as a uniform ball (FLT-015), hidden in the rock.
        ...(ast ? [{ ...fixed("rock-core", { kind: "disc", radius: 0.5 }, ast.core ?? P(0, 0)), gravity: { mu: ast.gravity * ast.radius * ast.radius, core: 1, radius: ast.radius } }] : []),
        ...pod(l.pod, l.podAngle ?? 0), ...turrets.flatMap((t) => t.bodies), ...tanks.flatMap((t) => t.bodies), ...(plant?.bodies ?? []), ...aerials.flatMap((a) => a.bodies), ...machines.flatMap((m) => m.bodies)],
      joints: [...turrets.flatMap((t) => t.joints), ...tanks.flatMap((t) => t.joints), ...(plant?.joints ?? []), ...aerials.flatMap((a) => a.joints), ...machines.flatMap((m) => m.joints)],
      links: [...turrets.flatMap((t) => t.links), ...machines.flatMap((m) => m.links)],
      thrust: {
        ship: ship(),
        mix: SHIP_MIX,
        hull: "p{n}-hull",
        tractor: "p{n}-hull",
        gun: "p{n}-gun",
        start: l.start,
        top: l.top,
        ...(ast ? { escape: { centre: P(0, 0), radius: ast.escape } } : {}),
        pod: "pod",
        turrets: turrets.map((t) => t.carriage),
        // Every tank the ship can draw from: the fuel tanks, and each turret's own.
        tanks: [...tanks.map((t) => t.tank), ...turrets.flatMap((t) => (t.tank ? [t.tank] : []))],
        ...(plant && l.plant
          ? {
              plant: {
                parts: plant.parts,
                domes: plant.domes,
                core: plant.core,
                charge: plant.charge,
                light: plant.light,
                offline: PLANT_OFFLINE,
                countdown: PLANT_COUNTDOWN,
                ...PLANT_LEAK,
                lines: l.plant.lines,
                transmitters: txs.map((t, k) => ({ id: t.id, sides: aerials.slice(2 * k, 2 * k + 2).map((a) => ({ mount: a.mount, parts: a.parts, tip: a.tip })), width: 1, shock: SHOCK })),
                turrets: turrets.map((t, k) => ({ id: t.carriage, ...(needsOf(k + 1) ? { needs: needsOf(k + 1) } : {}) })),
              },
            }
          : {}),
        lives: 3,
        respawn: 1.25,
        grace: 1,
        level: l.n,
        view: { colour: l.colour, pitch: 1, sky, caves: l.caves, ...(ast ? { islands: [ast.island] } : {}), ...(cables.length ? { cables } : {}) },
      },
    },
    timeline: [],
    end: { steps: 240 }, // the game runs on until it is over; this is how far a headless run goes
    probes: [],
    assertions: [],
    ui: { keys: { q: "left", e: "right", w: "fire", s: "reverse", z: "tractor" }, overlays: [], labels: false }, // the page adds Space, the arrows, Shifts and the right-hand keys
  };
  parseScenario(scenario); // fails loudly if the scenario is malformed
  // Turrets never fire within 10° of a bearing whose bolt would land on the power plant (WPN-014;
  // Chloe, 14 November 2026: they were shredding it). The bolts fly in arcs, so each bearing's
  // flight is followed on the world as it starts (scripts/aim.ts).
  if (plant) {
    const w = initialWorld(parseScenario(scenario));
    for (const b of scenario.world.bodies as Json[]) {
      if (!b.turret) continue;
      const avoid = bearingsOnto(w, w.bodies.find((x) => x.id === b.id)!, plant.parts, { margin: REACTOR_MARGIN, step: Math.PI / 720 });
      if (avoid.length) b.turret = { ...(b.turret as Json), avoid };
    }
    parseScenario(scenario);
  }
  writeFileSync(join(root, "scenarios", `${name}.json`), JSON.stringify(scenario, null, 2) + "\n");
  console.log(`wrote scenarios/${name}.json`);
}

const P = (x: number, y: number): Vec => ({ x, y });

// Level 1, the surface (Chloe's drawing, 14 November 2026, traced at 0.1 m a pixel as level 3 was;
// MTH-011): no cave. Spires and mesas across 200 m with a valley in the middle, where the pod
// stands. One electric turret on the valley's left shoulder, powered its own way (WPN-013): a round
// fuel tank on the mesa feeds a generator below it through a pipe down the mesa's side; the
// generator charges a capacitor in a notch further down, and the capacitor powers the turret. A
// second fuel tank stands on the plateau to the right.
write({
  n: 1,
  title: "The surface",
  description: "Fly down to the pod in the valley, take it on the tether with the tractor beam, and carry it up past the top. The turret on the shoulder runs on its own capacitor, generator and fuel.",
  colour: "#7a7a28",
  top: 90,
  // Right to left: the open space is above.
  ground: [
    P(102.2, 36.7), P(98.6, 36.6), P(92.0, 39.3), P(85.78, 38.4), P(82.98, 38.4), P(80.0, 38.3), P(78.4, 37.5), P(77.5, 31.3),
    P(75.7, 29.9), P(73.7, 29.8), P(72.4, 30.9), P(73.0, 36.1), P(72.6, 37.1), P(67.5, 28.2), P(60.7, 27.5), P(52.5, 32.2),
    P(51.5, 33.4), P(49.5, 38.0), P(48.6, 46.4), P(47.1, 48.0), P(45.7, 46.1), P(45.5, 41.1), P(44.1, 33.7), P(37.5, 27.4),
    P(36.5, 27.2), P(35.7, 27.7), P(33.4, 32.3), P(31.8, 40.5), P(30.8, 41.8), P(29.5, 39.8), P(26.9, 28.8), P(25.9, 27.4),
    P(23.3, 25.1), P(22.3, 25.0), P(21.0, 26.4), P(20.1, 30.0), P(18.9, 30.7), P(10.9, 22.0), P(11.4, 18.6), P(15.2, 14.4),
    P(15.5, 7.2), P(12.5, 1.8), P(10.3, 0.6), P(7.7, 0.9), P(6.6, 3.3), P(6.5, 6.7), P(5.7, 7.3), P(5.0, 3.5),
    P(3.8, 0.9), P(0.96, -0.1), P(-2.24, -0.1), P(-3.6, -0.4), P(-6.6, 0.3), P(-6.9, 1.9), P(-7.7, 2.6), P(-9.2, 1.1),
    P(-11.0, 2.0), P(-11.6, 3.2), P(-11.7, 6.9), P(-12.7, 6.7), P(-13.0, 4.7), P(-14.0, 4.6), P(-15.1, 7.2), P(-16.2, 8.1),
    P(-16.3, 10.3), P(-17.9, 11.3), P(-18.5, 14.3), P(-27.3, 14.3), P(-29.4, 27.3), P(-30.3, 28.4), P(-31.5, 27.7), P(-32.6, 19.7),
    P(-34.84, 18.6), P(-37.04, 18.6), P(-40.8, 18.4), P(-42.0, 20.7), P(-41.7, 21.5), P(-40.1, 22.3), P(-39.7, 24.9), P(-42.6, 45.1),
    P(-43.7, 45.3), P(-44.8, 37.5), P(-46.0, 36.6), P(-46.5, 34.2), P(-47.3, 33.3), P(-49.5, 32.4), P(-50.7, 32.6), P(-53.5, 38.1),
    P(-55.63, 38.1), P(-58.43, 38.1), P(-59.9, 37.8), P(-60.7, 34.2), P(-62.1, 33.6), P(-64.1, 31.0), P(-66.5, 31.0), P(-69.5, 34.6),
    P(-70.8, 35.2), P(-71.0, 42.0), P(-71.7, 45.0), P(-72.7, 44.4), P(-73.7, 38.8), P(-74.8, 37.0), P(-75.7, 33.2), P(-78.3, 33.8),
    P(-80.8, 39.6), P(-89.2, 38.6), P(-90.9, 36.5), P(-94.0, 27.9), P(-96.6, 27.7), P(-99.5, 42.4), P(-101.3, 32.3), P(-102.3, 31.2),
  ],
  caves: [],
  start: P(-85, 62),
  pod: P(-0.64, -0.1),
  turrets: [{ at: P(-22.9, 14.3), angle: 0, electric: true }],
  // The turret's own tank on the mesa, and one on the plateau to the right.
  tanks: [P(-57.03, 38.1), P(84.38, 38.4)],
  powered: [
    {
      turrets: [1],
      tank: 1,
      generator: { at: P(-65.3, 31.0) },
      capacitor: { at: P(-35.94, 18.6) },
      // Down the mesa's side, from the tank's stand to the generator's side, 0.4 m out from the rock
      // all the way, so a slug can reach every piece of it (it ran inside the rock at first).
      pipe: [P(-58.35, 38.4), P(-60.18, 38.09), P(-61.01, 34.46), P(-62.35, 33.92), P(-64.28, 31.36), P(-64.45, 31.6)],
      cables: [
        { points: [P(-65.3, 31.0), P(-64.24, 19.65), P(-57.03, 15.09), P(-36.68, 16.15), P(-35.94, 18.6)], from: "generator" },
        { points: [P(-35.94, 18.6), P(-34.03, 10.96), P(-23.11, 11.91), P(-22.9, 14.3)], from: "capacitor" },
      ],
    },
  ],
});

// A test level, not played: the first level 1 (12 November 2026), with the first turret, the one
// that carries its own tank, generator and battery. The core tests of the ship, the tether and
// that turret fly here (tests/core/thrust.test.ts), as they did before Chloe drew level 1.
write({
  n: 1,
  file: "thrust-test",
  title: "Test: the first surface",
  description: "The first level 1, kept for the tests: mountains with a hollow, one turret of the first kind.",
  colour: "#c8502e",
  top: 120,
  ground: [
    P(150, 62), P(138, 40), P(124, 36), P(112, 16), P(96, 16), P(84, 18), P(70, 30), P(56, 24), P(44, 6), P(42, 5), P(34, 5), P(30, 2),
    P(20, -8), P(4, -8), P(-4, -6), P(-12, 8), P(-24, 26), P(-36, 22), P(-48, 10), P(-78, 10), P(-92, 12), P(-104, 30),
    P(-120, 34), P(-135, 58), P(-150, 60),
  ],
  caves: [],
  start: P(-63, 75),
  pod: P(12, -8),
  turrets: [{ at: P(38, 5), angle: 0 }],
  tanks: [P(104, 16)],
});

// Level 2, the chamber (Chloe's drawing, 14 November 2026, traced at 0.1 m a pixel as level 3 was;
// MTH-011): a shaft about 20 m wide drops from the surface into a chamber 65 m across, where the
// pod stands on the floor. Three electric turrets on their own power (WPN-013): one on the surface
// to the right, beside its capacitor, generator and tank; and one hanging from each side of the
// chamber's roof. The right one takes its power from the surface capacitor by a long cable; the
// left one has its own capacitor, generator and tank down the chamber's left wall. A fuel tank on
// the surface to the left.
{
  // Right to left: the open space is above (the shaft's lips are P(9.4, 43.6) and P(-9.4, 46.2)).
  const ground = [
    P(102.2, 66.9), P(94.6, 65.3), P(92.6, 58.9), P(89.5, 53.3), P(87.9, 48.5), P(84.93, 48.4), P(82.25, 47.6), P(81.7, 48.1),
    P(78.52, 47.81), P(76.12, 47.71), P(72.53, 47.64), P(70.33, 47.67), P(67.35, 47.91), P(58.55, 48.17), P(57.1, 48.3), P(45.7, 55.4),
    P(41.7, 61.2), P(37.5, 69.1), P(30.9, 70.0), P(26.1, 63.9), P(23.3, 61.9), P(20.0, 48.9), P(9.4, 43.6), P(6.7, 36.2),
    P(8.3, 21.8), P(6.8, 12.2), P(7.4, 2.6), P(11.6, -0.9), P(15.63, -0.65), P(24.42, -0.52), P(32.0, -1.8), P(37.3, -7.8),
    P(38.0, -16.0), P(33.4, -26.0), P(27.4, -30.6), P(8.38, -30.49), P(5.18, -30.48), P(-30.8, -30.4), P(-32.57, -29.32), P(-34.88, -27.74),
    P(-38.9, -20.8), P(-38.23, -13.22), P(-37.43, -10.96), P(-34.6, -6.2), P(-33.22, -5.05), P(-31.48, -3.71), P(-27.5, -1.8), P(-24.67, -1.27),
    P(-15.88, -0.72), P(-15.3, -1.1), P(-11.7, 1.6), P(-10.9, 4.2), P(-11.3, 12.8), P(-10.1, 23.8), P(-11.7, 29.0), P(-11.9, 32.2),
    P(-9.8, 40.8), P(-9.4, 46.2), P(-12.1, 52.0), P(-24.5, 52.7), P(-30.7, 54.5), P(-37.3, 50.9), P(-42.7, 50.0), P(-51.4, 43.6),
    P(-56.67, 44.12), P(-59.45, 44.46), P(-63.4, 44.9), P(-67.5, 48.6), P(-72.5, 51.2), P(-75.9, 59.4), P(-84.7, 65.7), P(-85.7, 68.9),
    P(-85.9, 74.5), P(-80.4, 79.7), P(-80.2, 80.5), P(-80.9, 81.5), P(-84.5, 82.2), P(-93.1, 82.0), P(-93.9, 79.8), P(-91.8, 77.1),
    P(-93.1, 68.9), P(-95.2, 67.3), P(-96.6, 64.5), P(-102.2, 64.2),
  ];
  const mouth = [ground.findIndex((p) => p.x === 9.4 && p.y === 43.6), ground.findIndex((p) => p.x === -9.4 && p.y === 46.2)];
  write({
    n: 2,
    title: "The chamber",
    description: "The pod is in a chamber at the foot of a shaft, under two turrets. Fly down, take it on the tether, and carry it up the shaft and past the top.",
    colour: "#9d1ab8",
    top: 120,
    ground,
    caves: [ground.slice(mouth[0], mouth[1] + 1)],
    caveBelow: 40,
    leastWidth: 18,
    start: P(-60, 75),
    pod: P(6.78, -30.49),
    turrets: [
      // On the surface to the right; hanging from the chamber's roof, right and left.
      { at: P(62.95, 48.04), angle: -0.03, electric: true },
      { at: P(20.02, -0.58), angle: -3.126, electric: true },
      { at: P(-20.28, -1.0), angle: -3.079, electric: true },
    ],
    // On the surface to the left; the surface turrets' own; the left roof turret's own, in the chamber's corner.
    tanks: [P(-58.06, 44.29), { at: P(83.59, 48.0), angle: 0.289 }, { at: P(-33.73, -28.53), angle: -0.599 }],
    powered: [
      {
        turrets: [1, 2],
        tank: 2,
        generator: { at: P(77.32, 47.76), angle: 0.04 },
        capacitor: { at: P(71.43, 47.66), angle: -0.013 },
        pipe: [P(82.3, 48.45), P(78.12, 48.45)],
        cables: [
          { points: [P(77.28, 48.38), P(77.28, 46.26), P(71.98, 46.26), P(71.98, 47.85)], from: "generator" },
          { points: [P(70.92, 47.85), P(70.92, 46.26), P(62.97, 46.26), P(62.95, 48.04)], from: "capacitor" },
          { points: [P(70.92, 46.26), P(70.92, 38.31), P(20.56, 8.1), P(20.02, -0.58)], from: "capacitor" },
        ],
      },
      {
        turrets: [3],
        tank: 3,
        generator: { at: P(-37.83, -12.09), angle: -1.914 },
        capacitor: { at: P(-32.35, -4.38), angle: -2.486 },
        pipe: [P(-34.56, -26.36), P(-38.27, -20.53), P(-38.59, -14.17), P(-37.74, -13.11)],
        cables: [
          { points: [P(-38.27, -11.52), P(-36.15, -5.16), P(-32.35, -4.38)], from: "generator" },
          { points: [P(-32.35, -4.38), P(-26.08, 0.67), P(-20.56, 0.67), P(-20.28, -1.0)], from: "capacitor" },
        ],
      },
    ],
  });
}

// Level 3, the canyon (Chloe's drawing, 14 November 2026, traced at 0.1 m a pixel: the open space
// found by its colour, its outline simplified to 0.5 m, and flat under each turret, tank and the
// pod): a wide canyon 200 m across
// opens into caves under its walls. The power plant stands on a ledge high on the left wall; its
// lines run through the rock to the four turrets on the left, and cross the canyon between two
// antennae to the four on the right (a shelf, both faces of a spit, and the right wall's top). The
// pod stands on a pillar in the middle of the floor. Fuel: two tanks on the surface at the right,
// one on the left ledge, one on the floor.
{
  // Right to left: the open space is above (the caves start under the antennae, at P(44.1, -36.4) and P(-19.6, -52.7)).
  const ground = [
    P(102.3, -1.1), P(93.2, -1.5), P(89.2, -1.5), P(87.0, -1.7), P(83.0, -1.7), P(79.0, -1.6), P(77.3, -9.0), P(72.5, -10.5), P(69.3, -17.4), P(66.9, -19.0),
    P(63.8, -24.2), P(59.6, -25.5), P(59.0, -27.4), P(50.2, -27.4), P(44.7, -30.7), P(44.1, -36.4), P(60.6, -39.0), P(62.5, -42.0), P(68.9, -43.9), P(73.7, -49.5),
    P(79.1, -52.1), P(80.2, -54.9), P(80.3, -59.6), P(70.1, -61.3), P(67.8, -64.2), P(61.0, -64.7), P(55.4, -68.3), P(46.6, -68.3), P(37.0, -68.7), P(30.9, -70.8),
    P(21.7, -70.6), P(12.9, -70.6), P(10.4, -70.1), P(8.5, -70.8), P(7.5, -72.2), P(8.1, -74.4), P(13.0, -75.2), P(21.8, -75.2), P(22.0, -75.8), P(33.3, -76.6),
    P(35.5, -78.0), P(41.0, -79.2), P(44.7, -82.1), P(58.3, -85.5), P(61.0, -95.3), P(62.9, -98.7), P(66.3, -102.0), P(67.6, -106.6), P(67.9, -115.4), P(67.2, -118.5),
    P(67.8, -122.7), P(66.5, -126.8), P(64.1, -127.6), P(61.6, -130.1), P(53.8, -130.6), P(50.4, -131.6), P(48.3, -133.9), P(46.9, -138.7), P(45.4, -139.7), P(40.4, -140.1),
    P(31.6, -140.1), P(26.8, -139.2), P(24.2, -135.7), P(25.5, -133.6), P(25.3, -129.5), P(22.3, -127.3), P(21.8, -123.6), P(19.3, -122.5), P(18.3, -116.7), P(15.1, -116.7),
    P(12.1, -124.9), P(12.4, -126.5), P(14.1, -127.6), P(14.1, -131.7), P(15.1, -134.3), P(12.5, -136.1), P(12.5, -138.5), P(10.5, -142.6), P(7.7, -143.5), P(-1.2, -143.5),
    P(-19.0, -142.8), P(-23.0, -142.8), P(-37.2, -139.4), P(-41.0, -134.4), P(-48.0, -133.7), P(-52.5, -132.0), P(-53.9, -130.5), P(-54.5, -120.3), P(-53.3, -116.0), P(-41.0, -112.0),
    P(-39.5, -109.8), P(-37.3, -102.3), P(-36.1, -101.0), P(-33.0, -100.6), P(-24.2, -100.6), P(-20.5, -100.9), P(-16.2, -97.6), P(-16.6, -91.8), P(-18.0, -87.4), P(-20.4, -86.9),
    P(-21.0, -86.1), P(-25.0, -86.1), P(-28.9, -85.2), P(-34.3, -81.0), P(-42.9, -79.5), P(-44.7, -78.4), P(-45.2, -75.5), P(-44.3, -72.2), P(-38.3, -67.4), P(-37.8, -61.9),
    P(-36.7, -59.2), P(-32.0, -58.5), P(-23.2, -58.5), P(-19.7, -58.1), P(-19.6, -52.7), P(-20.5, -51.0), P(-23.7, -48.9), P(-25.0, -43.7), P(-27.7, -42.7), P(-28.9, -34.2),
    P(-30.3, -33.0), P(-32.5, -33.2), P(-32.7, -39.1), P(-34.6, -42.7), P(-56.4, -42.5), P(-58.6, -38.2), P(-58.8, -33.6), P(-60.5, -30.4), P(-61.0, -18.4), P(-63.6, -17.5),
    P(-64.6, -14.2), P(-71.3, -9.6), P(-76.6, -0.5), P(-78.4, 0.9), P(-102.4, 1.3),
  ];
  const mouth = [ground.findIndex((p) => p.x === 44.1 && p.y === -36.4), ground.findIndex((p) => p.x === -19.6 && p.y === -52.7)];
  write({
    n: 3,
    title: "The canyon",
    description: "The pod stands on a pillar at the bottom of a canyon, under eight electric turrets and a power plant. Fly down, take it on the tether, and carry it back up and past the top.",
    colour: "#2f74c0",
    top: 70,
    ground,
    caves: [ground.slice(mouth[0], mouth[1] + 1)],
    caveBelow: -30,
    // Two dead ends that narrow to nothing, as drawn: the tip of the cave at the top right, and the
    // crevice at the pillar's right foot.
    alcoves: [[P(66, -64), P(82, -45)], [P(20, -140), P(30, -125)]],
    leastWidth: 18,
    start: P(-88, 35),
    pod: P(16.7, -116.7),
    turrets: [
      // The right wall's top; under the left ledge (hanging); the right shelf; the spit, on top and
      // underneath (hanging); under the left ledge lower down (hanging); the floor, right and left.
      { at: P(54.6, -27.4), angle: 0, electric: true },
      { at: P(-27.6, -58.5), angle: Math.PI, electric: true },
      { at: P(51.0, -68.3), angle: 0, electric: true },
      { at: P(17.3, -70.6), angle: 0, electric: true },
      { at: P(17.4, -75.2), angle: Math.PI, electric: true },
      { at: P(-28.6, -100.6), angle: Math.PI, electric: true },
      { at: P(36.0, -140.1), angle: 0, electric: true },
      { at: P(3.2, -143.5), angle: 0, electric: true },
    ],
    tanks: [P(91.2, -1.5), P(85.0, -1.7), P(-23.0, -86.1), P(-21.0, -142.8)],
    plant: {
      at: P(-45.6, -43.0),
      antennae: [
        { at: P(-19.7, -53.0), angle: -Math.PI / 2 },
        { at: P(44.1, -34.0), angle: Math.PI / 2 },
      ],
      lines: [
        { points: [P(-45.4, -43.0), P(-45.4, -52.0), P(-58.8, -79.4), P(-64.4, -93.0), P(-64.4, -140.0), P(-46.8, -150.6), P(3.0, -150.6), P(3.2, -143.5)] },
        { points: [P(3.0, -150.6), P(36.2, -150.6), P(36.0, -140.1)] },
        { points: [P(-45.4, -52.0), P(-28.4, -52.0), P(-27.6, -58.5)] },
        { points: [P(-28.4, -52.0), P(-19.7, -53.0)] },
        { points: [P(-58.8, -79.4), P(-28.8, -97.0), P(-28.6, -100.6)] },
        { points: [P(44.1, -34.0), P(53.2, -32.0), P(54.6, -27.4)], needs: ["tx"] },
        { points: [P(53.2, -32.0), P(67.2, -32.0), P(86.4, -49.4), P(86.4, -73.4), P(51.2, -73.4), P(51.0, -68.3)], needs: ["tx"] },
        { points: [P(51.2, -73.4), P(17.2, -73.4), P(17.3, -70.6)], needs: ["tx"] },
        { points: [P(17.2, -73.4), P(17.4, -75.2)], needs: ["tx"] },
      ],
      beyond: [1, 3, 4, 5],
    },
  });
}

// Level 4, the winding cave (Chloe's drawing, 13 November 2026; level 3 until 14 November, traced at 0.1 m a pixel): a cave
// that winds down from a mouth 38 m wide, past ledges, into a wide chamber 135 m down. The pod
// stands on the chamber's floor at the left, two fuel tanks beside it, one more on the surface.
// Six electric turrets: two on a ledge under the mouth, one on the left ledge, one on the right
// wall and one on the roof, hanging, and one on the chamber's floor.
{
  // Right to left: the open space is above (the cave's mouth is between P(50.2, 4) and P(11.6, 2.8)).
  const ground = [
    P(102.4, 8.8), P(91.6, 9.6), P(91.6, 11.2), P(88, 12.4), P(86, 15.2), P(80.8, 15.2), P(80, 12.4), P(72.2, 4), P(50.2, 4), P(44.4, -5.6),
    P(44, -15.6), P(40.8, -21.2), P(38.3, -21.1), P(30.5, -22.9), P(28.7, -23.5), P(20.9, -25.3), P(20.4, -26.8), P(17.2, -26.8), P(16, -29.6), P(3.6, -33.6),
    P(-2.8, -43.6), P(-2.1, -49), P(-1.9, -50.2), P(-1.6, -53.6), P(1.6, -53.6), P(4.6, -55.9), P(11.4, -60.1), P(16.4, -70.4), P(23.2, -73.2), P(25.6, -76),
    P(28, -76), P(28, -77.6), P(32, -78.8), P(34, -82), P(41.2, -82.7), P(49.2, -83.7), P(58.4, -84.8), P(68.8, -93.2), P(74.8, -104.4), P(74, -116.8),
    P(71.6, -124.8), P(64.4, -125.2), P(61.2, -127.6), P(50.8, -130.4), P(41.6, -130.5), P(33.6, -130.3), P(22, -131.6), P(21.2, -133.2), P(17.2, -133.2), P(6.4, -133.2),
    P(3.2, -133.2), P(-0.4, -133.2), P(-3.6, -133.2), P(-11.6, -133.2), P(-12.8, -131.6), P(-17.2, -131.2), P(-20.4, -131.2), P(-37.2, -129.2), P(-41.6, -127.6), P(-46.4, -127.6),
    P(-46.8, -120.4), P(-45.6, -118.4), P(-39.2, -117.2), P(-38.4, -115.6), P(-32.8, -114), P(-32.4, -112.4), P(-22.4, -111.2), P(-22, -109.6), P(-18.8, -109.6), P(-14.4, -106.4),
    P(-5.2, -107.2), P(1.6, -106), P(2.4, -104.4), P(7.2, -104.4), P(6.4, -98), P(-7.6, -94), P(-11.2, -88.8), P(-16.8, -88.4), P(-20.4, -85.6), P(-25.2, -77.2),
    P(-34.4, -74.4), P(-37.2, -69.6), P(-39.6, -68.8), P(-41.2, -66.4), P(-40.8, -56.4), P(-39.6, -53.6), P(-34.8, -50.6), P(-34.8, -49.4), P(-37.6, -49.2), P(-38.1, -47.7),
    P(-45.9, -45.9), P(-50.8, -45.2), P(-56.4, -43.6), P(-57.2, -40), P(-54.4, -36.8), P(-37.2, -30.8), P(-32, -22.8), P(-28, -21.6), P(-27.6, -20), P(-21.2, -18.8),
    P(-20.8, -17.2), P(-14, -16), P(-14, -14.4), P(-10, -14.4), P(-3.2, -6), P(2.4, -2), P(2.4, -0.4), P(6.4, -0.4), P(8.8, 2.4), P(11.6, 2.8),
    P(7.2, 6.8), P(-5.2, 9.6), P(-5.2, 11.2), P(-16.4, 15.2), P(-19.2, 18), P(-23.2, 16.8), P(-27.6, 12.4), P(-32, 12), P(-35.2, 12), P(-38.4, 11.6),
    P(-39.2, 9.6), P(-48.4, 5.2), P(-52, 6.8), P(-53.6, 9.6), P(-56, 9.6), P(-57.6, 12.4), P(-65.6, 15.2), P(-67.6, 18), P(-72.8, 18), P(-78.4, 15.2),
    P(-84.8, 15.2), P(-94.8, 1.2), P(-102.4, 0.8),
  ];
  const mouth = [ground.findIndex((p) => p.x === 50.2 && p.y === 4), ground.findIndex((p) => p.x === 11.6 && p.y === 2.8)];
  write({
    n: 4,
    seed: 300,
    title: "The winding cave",
    description: "The pod is at the bottom of a winding cave, past six electric turrets. Fly down, take it on the tether, and carry it back up and past the top.",
    colour: "#3fa35a",
    top: 90,
    ground,
    caves: [ground.slice(mouth[0], mouth[1] + 1)],
    caveBelow: 0,
    // The tips of the two alcoves (the left ledge's, and the chamber's left end) narrow to nothing.
    // Over the pod the roof is 19 m up, as drawn: tighter than the 25 m elsewhere, so the pod is
    // carried out level to the right before it is lifted.
    alcoves: [[P(-70, -52), P(-34, -26)], [P(-70, -135), P(-34, -110)]],
    leastWidth: 18,
    start: P(-70, 50),
    pod: P(-18.8, -131.2),
    turrets: [
      // Top to bottom: two on the ledge under the mouth, the left ledge, the right wall (hanging),
      // the roof (hanging), and the chamber's floor.
      { at: P(24.8, -24.4), angle: 0.237, electric: true },
      { at: P(34.4, -22.0), angle: 0.237, electric: true },
      { at: P(-42.0, -46.8), angle: -0.237, electric: true },
      { at: P(8.0, -58.0), angle: 2.575, electric: true },
      { at: P(45.2, -83.2), angle: 3.017, electric: true },
      { at: P(37.6, -130.4), angle: -0.029, electric: true },
    ],
    tanks: [P(4.8, -133.2), P(-2.0, -133.2), P(-33.6, 12.0)],
    // The power plant on the surface right of the mouth (Chloe's second drawing). Its lines run
    // through the rock to every turret; to the one on the left ledge they cross the cave between
    // two antennae.
    plant: {
      at: P(61.2, 4),
      antennae: [
        { at: P(-34.8, -50), angle: -1.571 },
        { at: P(-2, -49.6), angle: 1.681 },
      ],
      lines: [
        { points: [P(55.9, 4), P(55.9, -1.1), P(46.5, -23.4), P(35.4, -26.3), P(25.3, -28.9), P(9.9, -49), P(10.5, -54.1), P(45.5, -79.2), P(69.9, -79.8), P(79.4, -92.5), P(79.9, -119.5), P(68, -135.1), P(37.8, -135.1), P(37.6, -130.4)] },
        { points: [P(35.4, -26.3), P(34.4, -22)] },
        { points: [P(25.3, -28.9), P(24.8, -24.4)] },
        { points: [P(9.9, -49), P(-2, -49.6)] },
        { points: [P(10.5, -54.1), P(8, -58)] },
        { points: [P(45.5, -79.2), P(45.2, -83.2)] },
        { points: [P(-34.8, -50), P(-42.5, -49.9), P(-42.5, -46.6), P(-42, -46.8)], needs: ["tx"] },
      ],
      beyond: [3],
    },
  });
}

// Level 5, the asteroid (Chloe's drawing, 14 November 2026, traced at 0.13 m a pixel as level 3 was;
// it replaces the first design of 13 November): an asteroid about 200 m across, curled round on
// itself, with one way in on its left into a ring of caves. The power plant stands on the floor of
// the lower cave; its lines run through the rock to the turrets of the lower and right parts, and
// reach the upper part across the open by either of two transmitters. Thirteen electric turrets,
// inside and out; the pod stands on a ledge in the right-hand cave, its stand level to the pull
// (on the ledge's slope it rolled out of its cup). Gravity is a uniform ball's (FLT-015), 4 m/s² at
// 84 m (the asteroid's area as a disc), from its middle; the level is left 300 m from there, about
// 175 m beyond its furthest point (150 until Chloe asked for twice the room to fly about, 14
// November 2026), in a square 680 m across that wraps round.
{
  // The asteroid's rock, counter-clockwise (rock on the left), its caves included.
  const island = [
    P(31.85, 97.5), P(18.98, 94.64), P(13.91, 92.56), P(11.57, 92.04), P(11.22, 92.82), P(2.45, 93.53), P(-19.24, 96.2), P(-21.97, 95.42),
    P(-32.89, 88.01), P(-42.43, 88.03), P(-45.03, 88.14), P(-53.17, 88.01), P(-75.4, 73.58), P(-76.81, 66.85), P(-78.32, 58.18), P(-79.56, 52.91),
    P(-91.0, 42.25), P(-90.87, 38.74), P(-89.83, 36.4), P(-84.5, 34.32), P(-83.33, 26.91), P(-86.45, 22.62), P(-81.38, 15.99), P(-78.26, 14.56),
    P(-69.21, 16.33), P(-60.59, 18.13), P(-46.28, 21.06), P(-33.02, 18.46), P(-28.34, 17.03), P(-18.85, 8.84), P(-16.9, 8.58), P(2.21, 21.06),
    P(13.52, 30.55), P(13.52, 35.23), P(5.61, 38.31), P(-2.52, 41.68), P(-8.71, 44.72), P(-11.18, 50.57), P(-4.16, 60.71), P(0.91, 66.56),
    P(2.86, 67.47), P(7.93, 67.34), P(29.38, 58.63), P(31.33, 58.24), P(43.42, 61.49), P(48.1, 61.1), P(49.4, 59.15), P(48.87, 58.2),
    P(53.96, 51.02), P(56.8, 45.73), P(60.99, 38.0), P(63.31, 33.41), P(63.44, 30.68), P(49.01, 13.91), P(46.02, 11.57), P(39.01, 13.23),
    P(36.47, 13.82), P(28.86, 15.73), P(27.28, 15.18), P(25.29, 18.19), P(21.45, 17.29), P(-0.39, 0.78), P(-8.06, -16.25), P(-7.15, -24.44),
    P(-0.65, -26.78), P(5.98, -27.82), P(7.78, -34.69), P(10.09, -43.18), P(11.57, -47.71), P(11.83, -53.56), P(-8.84, -72.8), P(-9.62, -73.06),
    P(-10.22, -71.81), P(-12.79, -72.15), P(-13.13, -72.8), P(-14.31, -72.62), P(-36.44, -68.02), P(-39.65, -65.78), P(-52.91, -44.72), P(-51.87, -41.99),
    P(-41.64, -30.08), P(-37.01, -22.6), P(-35.36, -20.93), P(-36.92, -9.36), P(-59.93, -4.29), P(-65.2, -7.5), P(-72.88, -11.8), P(-98.93, -27.43),
    P(-101.53, -38.74), P(-95.29, -48.49), P(-92.56, -50.96), P(-91.83, -54.86), P(-90.32, -63.53), P(-90.35, -66.56), P(-89.31, -68.9), P(-74.88, -78.39),
    P(-64.61, -87.49), P(-49.01, -87.49), P(-42.53, -92.54), P(-40.61, -94.29), P(-33.93, -100.36), P(-29.64, -101.92), P(-24.96, -100.88), P(-24.89, -102.03),
    P(-16.74, -105.35), P(-14.82, -107.12), P(-9.36, -107.64), P(0.39, -104.52), P(2.34, -103.61), P(11.96, -94.38), P(13.52, -93.73), P(23.66, -96.2),
    P(29.9, -96.85), P(43.94, -94.9), P(49.01, -93.21), P(55.51, -84.63), P(60.23, -81.86), P(67.3, -76.62), P(68.77, -76.96), P(70.2, -75.01),
    P(67.21, -54.34), P(65.52, -49.27), P(54.73, -42.38), P(44.98, -37.96), P(43.68, -36.01), P(40.95, -24.7), P(52.39, -12.35), P(56.29, -10.53),
    P(63.7, -11.44), P(83.59, -16.77), P(85.93, -16.77), P(94.51, -13.13), P(95.16, -9.62), P(93.86, 0.91), P(103.74, 14.04), P(104.52, 15.6),
    P(104.25, 18.25), P(103.91, 27.04), P(104.26, 28.86), P(95.42, 46.41), P(87.62, 53.17), P(76.31, 54.08), P(67.47, 64.48), P(69.55, 71.89),
    P(80.6, 78.78), P(83.59, 85.8), P(80.47, 93.86), P(74.62, 95.29), P(67.21, 91.39), P(63.31, 91.78), P(57.07, 85.41), P(52.0, 82.94),
    P(41.86, 91.13), P(32.11, 97.5),
  ];
  // Its caves, for the view: the island's outline from the upper part's lower tip round inside to
  // the lower part's upper tip, closed across the way in.
  const cave = [
    P(-81.38, 15.99), P(-78.26, 14.56), P(-69.21, 16.33), P(-60.59, 18.13), P(-46.28, 21.06), P(-33.02, 18.46), P(-28.34, 17.03), P(-18.85, 8.84),
    P(-16.9, 8.58), P(2.21, 21.06), P(13.52, 30.55), P(13.52, 35.23), P(5.61, 38.31), P(-2.52, 41.68), P(-8.71, 44.72), P(-11.18, 50.57),
    P(-4.16, 60.71), P(0.91, 66.56), P(2.86, 67.47), P(7.93, 67.34), P(29.38, 58.63), P(31.33, 58.24), P(43.42, 61.49), P(48.1, 61.1),
    P(49.4, 59.15), P(48.87, 58.2), P(53.96, 51.02), P(56.8, 45.73), P(60.99, 38.0), P(63.31, 33.41), P(63.44, 30.68), P(49.01, 13.91),
    P(46.02, 11.57), P(39.01, 13.23), P(36.47, 13.82), P(28.86, 15.73), P(27.28, 15.18), P(25.29, 18.19), P(21.45, 17.29), P(-0.39, 0.78),
    P(-8.06, -16.25), P(-7.15, -24.44), P(-0.65, -26.78), P(5.98, -27.82), P(7.78, -34.69), P(10.09, -43.18), P(11.57, -47.71), P(11.83, -53.56),
    P(-8.84, -72.8), P(-9.62, -73.06), P(-10.22, -71.81), P(-12.79, -72.15), P(-13.13, -72.8), P(-14.31, -72.62), P(-36.44, -68.02), P(-39.65, -65.78),
    P(-52.91, -44.72), P(-51.87, -41.99), P(-41.64, -30.08), P(-37.01, -22.6), P(-35.36, -20.93), P(-36.92, -9.36), P(-59.93, -4.29), P(-65.2, -7.5),
    P(-72.88, -11.8),
  ];
  write({
    n: 5,
    seed: 500,
    title: "The asteroid",
    description: "An asteroid curled round on itself, with one way into its caves. Its gravity pulls toward its middle. Fly in, take the pod on the tether, and carry it 300 m out from the middle.",
    colour: "#8a3cff",
    top: 150,
    ground: [],
    caves: [cave],
    start: P(0, 135),
    pod: P(26.28, 16.69),
    podAngle: -0.986,
    turrets: [
      { at: P(6.84, 93.18), angle: -0.081, electric: true },
      { at: P(-77.57, 62.52), angle: 1.398, electric: true },
      { at: P(51.42, 54.61), angle: 2.186, electric: true },
      { at: P(58.9, 41.86), angle: 2.068, electric: true },
      { at: P(1.54, 39.99), angle: -0.394, electric: true },
      { at: P(104.08, 22.65), angle: -1.532, electric: true },
      { at: P(-64.9, 17.23), angle: -2.936, electric: true },
      { at: P(-69.04, -9.65), angle: 0.51, electric: true },
      { at: P(-39.33, -26.34), angle: -2.125, electric: true },
      { at: P(8.93, -38.94), angle: 1.837, electric: true },
      { at: P(-91.07, -59.19), angle: 1.743, electric: true },
      { at: P(63.76, -79.24), angle: -2.504, electric: true },
      { at: P(-20.82, -103.69), angle: 2.755, electric: true },
    ],
    tanks: [
      { at: P(-43.73, 88.08), angle: -0.041 },
      { at: P(37.74, 13.53), angle: -0.229 },
      { at: P(-11.51, -71.98), angle: 0.132 },
      { at: P(-41.57, -93.41), angle: 2.403 },
    ],
    asteroid: { island, radius: 84, gravity: 4, box: 340, escape: 300, core: P(2.47, -1.17) },
    plant: {
      at: P(-25.37, -70.32),
      angle: -0.205,
      transmitters: [
        { id: "tx1", antennae: [{ at: P(-35.25, 18.6), angle: 2.879 }, { at: P(-42.4, -8.03), angle: -0.262 }] },
        { id: "tx2", antennae: [{ at: P(-7.04, 14.67), angle: -2.554 }, { at: P(1.36, 2.06), angle: 0.588 }] },
      ],
      lines: [
        { points: [P(-42.4, -8.03), P(-45.2, -21.81), P(-39.33, -26.34)] },
        { points: [P(-44.78, -16.29), P(-55.26, -14.64), P(-71.38, -25.25), P(-68.62, -65.9), P(-25.37, -70.32)] },
        { points: [P(-62.42, -19.05), P(-69.04, -9.65)] },
        { points: [P(-69.31, -56.26), P(-91.07, -59.19)] },
        { points: [P(-25.37, -70.32), P(-26.59, -75.55), P(-28.66, -83.13), P(-14.88, -96.91), P(-20.82, -103.69)] },
        { points: [P(-14.88, -96.91), P(23.71, -61.77)] },
        { points: [P(23.71, -61.77), P(18.88, -36.28), P(18.19, -27.32)] },
        { points: [P(18.88, -36.28), P(8.93, -38.94)] },
        { points: [P(18.19, -27.32), P(1.36, 2.06)] },
        { points: [P(18.19, -27.32), P(72.63, 22.98), P(104.08, 22.65)] },
        { points: [P(72.63, 22.98), P(62.7, 42.55), P(56.09, 55.64), P(51.42, 54.61)] },
        { points: [P(62.7, 42.55), P(58.9, 41.86)] },
        { points: [P(23.71, -61.77), P(49.2, -74.17), P(59.53, -70.04), P(63.76, -79.24)] },
        { points: [P(-35.25, 18.6), P(-30.73, 29.59)], needs: ["tx1|tx2"] },
        { points: [P(-64.9, 17.23), P(-67.25, 28.49), P(-1.1, 30.97), P(1.54, 39.99)], needs: ["tx1|tx2"] },
        { points: [P(-21.08, 30.15), P(-20.39, 82.24), P(6.48, 84.72), P(6.84, 93.18)], needs: ["tx1|tx2"] },
        { points: [P(-20.39, 51.92), P(-77.57, 62.52)], needs: ["tx1|tx2"] },
        { points: [P(-15.57, 29.87), P(-7.04, 14.67)], needs: ["tx1|tx2"] },
      ],
      // The upper part's turrets: power through either transmitter.
      beyond: { 1: ["tx1|tx2"], 2: ["tx1|tx2"], 5: ["tx1|tx2"], 7: ["tx1|tx2"] },
    },
  });
}
// Level 6, the warren (Chloe's sketch, 14 November 2026, "a much rougher sketch": traced at
// 0.15 m a pixel and approximated). Layers of rock with caves between them, full of stalactites:
// a roof over the top, a middle shelf, a lower shelf, and the floor, where the pod stands at the
// right. The power plant stands on the lower shelf's right end. Its lines run through the rock: to
// the turrets of the right-hand rock and the lower shelf directly; across the caves to the middle
// shelf (and the floor beyond its left end) by any of three transmitters; and on up to the roof by
// any of three more. The lines are tidied from the sketch: straight runs along each shelf
// and down its walls, with a straight branch to each turret and antenna. Eighteen electric turrets, six fuel tanks.
{
  // Right to left: the open space is above (the caves are reached past the roof's left pillar).
  const ground = [
    P(153.3, -2.1), P(148.8, 0.3), P(143.55, 7.8), P(129.0, 22.35), P(107.1, 34.2), P(93.75, 46.05), P(90.15, 47.55), P(78.45, 46.05),
    P(68.44, 47.67), P(59.66, 47.13), P(59.1, 49.05), P(52.2, 50.55), P(43.5, 55.5), P(21.0, 57.0), P(15.5, 58.12), P(12.7, 57.98),
    P(12.45, 56.85), P(10.65, 57.75), P(5.74, 56.87), P(2.96, 56.53), P(2.25, 55.95), P(-3.6, 57.6), P(-10.5, 57.45), P(-15.0, 55.35),
    P(-20.85, 54.65), P(-29.55, 53.35), P(-30.75, 54.6), P(-39.75, 54.6), P(-41.25, 53.55), P(-42.0, 51.15), P(-41.4, 44.55), P(-43.5, 39.45),
    P(-42.44, 28.25), P(-42.16, 19.45), P(-40.8, 2.55), P(-41.25, -1.05), P(-39.6, -7.95), P(-38.4, -7.95), P(-36.45, -3.45), P(-34.2, 5.25),
    P(-35.01, 6.62), P(-33.39, 15.28), P(-31.65, 30.15), P(-29.55, 33.0), P(-26.25, 32.4), P(-21.75, 33.15), P(-19.95, 32.25), P(-18.75, 23.25),
    P(-17.25, 20.55), P(-16.05, 20.85), P(-12.6, 26.7), P(-8.7, 25.35), P(-5.55, 19.95), P(-4.52, 19.68), P(-0.58, 11.82), P(1.95, 7.8),
    P(2.85, 4.2), P(7.05, -0.75), P(8.4, -13.65), P(10.05, -16.35), P(10.95, -15.9), P(13.2, -9.0), P(16.8, -3.0), P(16.65, 3.6),
    P(17.85, 6.9), P(20.55, 10.35), P(22.05, 10.05), P(23.25, 5.25), P(26.85, 2.85), P(29.25, 3.6), P(31.5, 1.95), P(36.3, 1.35),
    P(39.0, 3.0), P(41.55, 9.3), P(47.25, 16.5), P(54.15, 22.95), P(56.25, 23.85), P(59.25, 19.95), P(61.5, 10.65), P(63.45, 8.1),
    P(64.11, 8.59), P(71.79, 4.31), P(71.85, 3.45), P(78.75, 3.0), P(94.95, -3.6), P(98.55, -8.1), P(98.55, -15.3), P(99.6, -18.0),
    P(103.8, -22.05), P(106.05, -25.65), P(108.75, -28.05), P(120.45, -29.55), P(120.0, -31.35), P(108.9, -37.65), P(107.7, -40.05), P(109.21, -41.95),
    P(109.19, -50.75), P(108.6, -51.15), P(111.45, -55.65), P(126.15, -59.4), P(126.6, -60.6), P(112.65, -67.2), P(112.2, -76.5), P(111.0, -78.6),
    P(107.25, -81.45), P(106.7, -87.22), P(84.1, -87.22), P(81.3, -89.7), P(75.9, -92.25), P(72.9, -91.5), P(69.9, -87.45), P(65.1, -94.8),
    P(59.1, -99.0), P(53.7, -98.25), P(49.2, -99.75), P(46.8, -99.15), P(45.0, -100.2), P(36.6, -100.05), P(34.2, -99.15), P(28.2, -84.15),
    P(25.95, -81.3), P(22.8, -85.95), P(20.85, -96.15), P(18.75, -96.75), P(14.85, -95.85), P(13.65, -97.05), P(11.85, -97.2), P(11.69, -95.8),
    P(9.01, -95.0), P(-3.45, -94.2), P(-9.45, -95.1), P(-12.45, -93.9), P(-18.3, -89.1), P(-24.3, -88.35), P(-27.0, -89.7), P(-37.2, -91.5),
    P(-40.5, -97.5), P(-41.25, -102.0), P(-38.1, -103.2), P(-38.4, -105.6), P(-37.35, -106.35), P(-29.25, -107.85), P(-22.95, -111.3), P(-14.25, -111.75),
    P(-3.75, -114.15), P(0.0, -116.55), P(1.91, -116.01), P(10.69, -115.59), P(12.3, -117.3), P(29.7, -118.2), P(35.1, -119.55), P(48.4, -120.71),
    P(57.2, -120.49), P(57.75, -121.35), P(67.05, -121.05), P(75.75, -119.25), P(77.4, -117.6), P(79.35, -110.4), P(80.85, -110.55), P(84.6, -114.3),
    P(88.5, -114.45), P(92.4, -112.65), P(97.65, -106.8), P(101.85, -104.85), P(108.45, -103.95), P(115.35, -105.15), P(116.7, -106.5), P(119.53, -103.85),
    P(126.77, -108.85), P(125.4, -111.9), P(128.4, -115.8), P(132.0, -126.6), P(132.75, -131.7), P(134.04, -132.28), P(132.96, -141.02), P(132.3, -147.0),
    P(130.2, -151.5), P(127.5, -153.75), P(118.8, -157.05), P(107.46, -158.68), P(103.86, -158.68), P(97.2, -157.8), P(86.1, -162.15), P(85.44, -163.92),
    P(82.64, -163.92), P(82.05, -163.2), P(78.15, -163.5), P(72.45, -160.95), P(67.05, -155.1), P(58.35, -150.75), P(53.55, -150.45), P(46.65, -151.95),
    P(39.75, -150.9), P(37.2, -148.95), P(36.44, -150.27), P(27.76, -148.83), P(27.6, -147.75), P(24.3, -147.15), P(11.4, -148.65), P(3.6, -147.9),
    P(-4.8, -145.8), P(-11.7, -147.15), P(-12.11, -149.36), P(-20.89, -150.04), P(-22.5, -146.55), P(-29.4, -147.0), P(-31.2, -146.1), P(-33.15, -138.3),
    P(-33.75, -130.5), P(-36.15, -127.65), P(-38.25, -128.7), P(-39.75, -135.3), P(-43.65, -141.6), P(-46.05, -142.35), P(-55.16, -140.09), P(-57.94, -140.41),
    P(-58.5, -142.05), P(-59.55, -140.4), P(-69.15, -139.05), P(-78.15, -133.5), P(-80.85, -134.55), P(-81.9, -131.85), P(-84.6, -130.95), P(-97.5, -130.5),
    P(-101.7, -128.7), P(-106.35, -124.5), P(-103.5, -111.9), P(-103.8, -105.3), P(-104.87, -104.59), P(-104.23, -95.81), P(-103.2, -95.4), P(-104.7, -94.2),
    P(-103.35, -85.2), P(-100.95, -79.8), P(-98.1, -76.8), P(-91.8, -73.5), P(-90.75, -81.0), P(-89.7, -81.75), P(-85.95, -72.3), P(-76.05, -70.8),
    P(-73.95, -71.1), P(-73.2, -73.2), P(-71.7, -93.0), P(-70.8, -94.8), P(-69.9, -94.65), P(-68.1, -90.75), P(-66.3, -73.35), P(-64.5, -68.55),
    P(-61.2, -66.3), P(-61.42, -65.38), P(-54.68, -59.72), P(-52.95, -60.15), P(-49.95, -57.3), P(-45.45, -55.95), P(-44.25, -57.3), P(-43.5, -67.2),
    P(-41.85, -68.1), P(-38.1, -54.45), P(-35.1, -54.6), P(-32.4, -57.6), P(-29.4, -54.6), P(-23.1, -51.0), P(-19.2, -49.8), P(-12.9, -50.1),
    P(-4.5, -52.65), P(-1.5, -54.6), P(1.2, -69.9), P(3.9, -71.7), P(6.6, -70.35), P(10.2, -55.05), P(13.5, -54.15), P(17.7, -55.35),
    P(18.25, -56.56), P(27.05, -56.84), P(28.65, -55.5), P(31.95, -55.2), P(37.05, -57.6), P(41.7, -68.1), P(45.15, -71.7), P(48.45, -69.6),
    P(54.45, -58.8), P(59.55, -56.25), P(62.85, -50.55), P(63.9, -45.15), P(63.3, -38.25), P(58.05, -31.35), P(57.45, -28.95), P(53.55, -23.4),
    P(51.15, -22.8), P(47.25, -24.15), P(43.05, -29.1), P(40.85, -28.74), P(38.05, -28.86), P(34.65, -29.55), P(26.55, -28.05), P(15.9, -32.7),
    P(5.4, -33.15), P(1.8, -31.65), P(-0.45, -25.35), P(-2.4, -24.15), P(-6.85, -31.69), P(-15.65, -31.91), P(-16.2, -30.3), P(-18.3, -30.0),
    P(-21.0, -24.9), P(-22.8, -12.9), P(-24.9, -10.5), P(-26.4, -12.45), P(-28.35, -22.35), P(-31.2, -28.95), P(-32.4, -30.75), P(-34.2, -31.35),
    P(-41.7, -30.15), P(-42.9, -28.65), P(-45.0, -29.25), P(-47.7, -27.6), P(-52.35, -19.8), P(-57.9, -12.9), P(-59.4, -13.8), P(-64.5, -23.1),
    P(-71.7, -21.3), P(-72.75, -22.29), P(-80.55, -18.21), P(-80.85, -17.1), P(-91.35, -15.15), P(-94.35, -16.2), P(-98.25, -15.6), P(-100.05, -16.5),
    P(-102.75, -24.6), P(-104.55, -27.0), P(-109.65, -27.75), P(-116.85, -26.4), P(-119.25, -25.5), P(-121.2, -23.25), P(-125.85, -8.85), P(-131.25, -5.7),
    P(-136.05, -4.35), P(-138.3, 1.05), P(-140.4, 2.1), P(-153.3, 1.5),
  ];
  const mouth = [ground.findIndex((p) => p.x === -39.6 && p.y === -7.95), ground.findIndex((p) => p.x === -42.9 && p.y === -28.65)];
  write({
    n: 6,
    title: "The warren",
    description: "Caves layered under a roof of rock, a power plant deep inside and the pod on the floor below it. Fly in, take the pod on the tether, and carry it out past the top.",
    colour: "#8a5c94",
    top: 100,
    ground,
    caves: [ground.slice(mouth[0], mouth[1] + 1)],
    start: P(-125, 40),
    pod: P(105.66, -158.68),
    turrets: [
      { at: P(-25.2, 54.0), angle: 0.149, electric: true }, // roof
      { at: P(64.05, 47.4), angle: 0.062, electric: true }, // roof
      { at: P(-42.3, 23.85), angle: 1.602, electric: true }, // roof
      { at: P(-2.55, 15.75), angle: 2.036, electric: true }, // roof
      { at: P(-34.2, 10.95), angle: -1.755, electric: true }, // roof
      { at: P(67.95, 6.45), angle: 2.633, electric: true }, // roof
      { at: P(-76.65, -20.25), angle: -0.483, electric: true }, // middle
      { at: P(-11.25, -31.8), angle: 0.026, electric: true }, // middle
      { at: P(109.2, -46.35), angle: 1.568, electric: true }, // right
      { at: P(22.65, -56.7), angle: 3.111, electric: true }, // middle
      { at: P(-58.05, -62.55), angle: -2.444, electric: true }, // middle
      { at: P(-104.55, -100.2), angle: -1.644, electric: true }, // middle
      { at: P(123.15, -106.35), angle: 2.538, electric: true }, // right
      { at: P(6.3, -115.8), angle: -3.093, electric: true }, // lower
      { at: P(52.8, -120.6), angle: -3.117, electric: true }, // lower
      { at: P(133.5, -136.65), angle: 1.447, electric: true }, // right
      { at: P(-16.5, -149.7), angle: 0.078, electric: true }, // middle
      { at: P(32.1, -149.55), angle: -0.164, electric: true }, // middle
    ],
    tanks: [
      { at: P(4.35, 56.7), angle: 0.123 },
      { at: P(14.1, 58.05), angle: 0.053 },
      { at: P(39.45, -28.8), angle: 0.042 },
      { at: P(10.35, -95.4), angle: -0.291 },
      { at: P(-56.55, -140.25), angle: 0.116 },
      { at: P(84.04, -163.92), angle: -0.0 },
    ],
    plant: {
      at: P(95.4, -87.22),
      transmitters: [
        { id: "tx1", antennae: [{ at: P(28.69, 3.39), angle: 3.017 }, { at: P(24.63, -29.04), angle: -0.124 }] },
        { id: "tx2", antennae: [{ at: P(81.61, 1.29), angle: 2.47 }, { at: P(57.53, -28.99), angle: -0.672 }] },
        { id: "tx3", antennae: [{ at: P(-26.1, -52.6), angle: -3.044 }, { at: P(-22.52, -88.97), angle: 0.098 }] },
        { id: "tx4", antennae: [{ at: P(44.11, -71.35), angle: -3.074 }, { at: P(46.04, -99.85), angle: 0.068 }] },
        { id: "tx5", antennae: [{ at: P(-38.06, -103.23), angle: 2.181 }, { at: P(-81.4, -133.53), angle: -0.961 }] },
        { id: "tx6", antennae: [{ at: P(-39.71, -6.91), angle: 3.026 }, { at: P(-42.3, -29.25), angle: -0.115 }] },
      ],
      // The power lines, tidied from the sketch into straight runs through the rock, each lit by what feeds its part of the rock.
      lines: [
        { points: [P(-38, -3), P(-38, 40), P(100, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(-25.2, 54.0), P(-25.2, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(64.05, 47.4), P(64.05, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(-2.55, 15.75), P(-2.55, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(67.95, 6.45), P(67.95, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(28.69, 3.39), P(28.69, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(81.61, 1.29), P(81.61, 40)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(-42.3, 23.85), P(-38, 23.85)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(-34.2, 10.95), P(-38, 10.95)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(-38, -3), P(-39.71, -6.91)], needs: ["tx1|tx2|tx6", "tx3|tx4|tx5"] },
        { points: [P(58, -42), P(-112, -42), P(-112, -160), P(34, -160)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-76.65, -20.25), P(-76.65, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-11.25, -31.8), P(-11.25, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(22.65, -56.7), P(22.65, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-58.05, -62.55), P(-58.05, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(24.63, -29.04), P(24.63, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(57.53, -28.99), P(57.53, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-26.1, -52.6), P(-26.1, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(44.11, -71.35), P(44.11, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-42.3, -29.25), P(-42.3, -42)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-104.55, -100.2), P(-112, -100.2)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-16.5, -149.7), P(-16.5, -160)], needs: ["tx3|tx4|tx5"] },
        { points: [P(32.1, -149.55), P(32.1, -160)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-81.4, -133.53), P(-81.4, -160)], needs: ["tx3|tx4|tx5"] },
        { points: [P(-34, -103), P(140, -103)] },
        { points: [P(140, -46.35), P(140, -136.65)] },
        { points: [P(95.4, -87.22), P(95.4, -103)] },
        { points: [P(6.3, -115.8), P(6.3, -103)] },
        { points: [P(52.8, -120.6), P(52.8, -103)] },
        { points: [P(-22.52, -88.97), P(-22.52, -103)] },
        { points: [P(46.04, -99.85), P(46.04, -103)] },
        { points: [P(-38.06, -103.23), P(-34, -103)] },
        { points: [P(109.2, -46.35), P(140, -46.35)] },
        { points: [P(133.5, -136.65), P(140, -136.65)] },
        { points: [P(123.15, -106.35), P(123.15, -103)] },
      ],
      // The middle shelf (and the floor past its left end) through any of three transmitters from
      // the lower shelf; the roof through any of three more from the middle shelf.
      beyond: { 1: ["tx1|tx2|tx6", "tx3|tx4|tx5"], 2: ["tx1|tx2|tx6", "tx3|tx4|tx5"], 3: ["tx1|tx2|tx6", "tx3|tx4|tx5"], 4: ["tx1|tx2|tx6", "tx3|tx4|tx5"], 5: ["tx1|tx2|tx6", "tx3|tx4|tx5"], 6: ["tx1|tx2|tx6", "tx3|tx4|tx5"], 7: ["tx3|tx4|tx5"], 8: ["tx3|tx4|tx5"], 10: ["tx3|tx4|tx5"], 11: ["tx3|tx4|tx5"], 12: ["tx3|tx4|tx5"], 17: ["tx3|tx4|tx5"], 18: ["tx3|tx4|tx5"] },
    },
  });
}
