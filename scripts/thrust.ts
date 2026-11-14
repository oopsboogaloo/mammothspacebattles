// Mammoth Thrust's levels (docs/games/mammoth-thrust.md §3, -design.md §4): the ground from an
// outline of its open space, the ship (Mammoth Asteroids' ship with a tractor unit and a tether
// unit), and the pod on its stand. The game itself is in the world (src/core/thrust.ts).
//   node scripts/thrust.ts            writes scenarios/thrust-1.json, thrust-2.json and thrust-3.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario } from "../src/core/index.ts";
import { asteroidShip, SHIP_MIX } from "./asteroidShip.ts";
import { narrowest, type Vec } from "./terrain.ts";
import { electricTurret, turret, type ElectricTuning, type TurretTuning } from "./turretParts.ts";
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
/** The sides of the level are walls this far above its top, m: nothing flies that high (MTH-026). */
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
  // The shield (SHD-001…SHD-005; Chloe, 14 November 2026): held on, a field grows round the ship
  // in a quarter of a game second and stays up while there is fuel, burning it fast: 0.8 kg a game
  // second, full tanks (16.2 kg) in 40 s on screen. Each hit costs more: 0.005 kg for each N·s of
  // its impulse, and at least 0.1 kg (a slug or a 1 kg rock: 0.1 kg; the ship falling onto rock at
  // 20 m/s: about 3.5 kg). The engines and the gun don't work while it is up. First values, for
  // Chloe to tune. The field weighs 2 kg while it is up: lighter, and the weld that holds it to the
  // ship soaks up its bounce (a 1 kg rock at 10 m/s came back at 0 m/s off a 0.5 kg field, 4 m/s off 2 kg).
  const shield = { channel: "shield", grow: 14, burn: 0.8, hitBurn: 0.005, minHit: 0.1, mass: 2 };
  return asteroidShip({ small: SMALL, main: MAIN, economy: ECONOMY, magazine, tractor, shield });
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
const PLANT_COUNTDOWN = 5;
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

const fixed = (id: string, shape: Json, position: Vec): Json => ({ id, fixed: true, mass: 1, friction: 0.9, position, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape });

/**
 * The pod on its stand, on flat floor at `at`: a disc of 1 m radius and about half the ship's mass,
 * very hard to destroy (MTH-025), in a shallow cup so it doesn't roll off.
 */
function pod(at: Vec): Json[] {
  // The stand is anchored to the rock (TER-006): cut the rock at its foot and its three parts come
  // loose as one, 30 kg, and the pod goes with it.
  const part = (id: string, shape: Json, position: Vec, mass: number): Json => ({ ...fixed(id, shape, position), anchored: { mass, group: "stand" } });
  return [
    part("stand", { kind: "box", width: 2.3, height: 0.3 }, { x: at.x, y: at.y + 0.15 }, 20),
    part("stand-l", { kind: "box", width: 0.3, height: 0.35 }, { x: at.x - 1, y: at.y + 0.475 }, 5),
    part("stand-r", { kind: "box", width: 0.3, height: 0.35 }, { x: at.x + 1, y: at.y + 0.475 }, 5),
    {
      id: "pod",
      shape: { kind: "disc", radius: 1 },
      mass: 34,
      position: { x: at.x, y: at.y + 1.3 },
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
function fuelTank(name: string, at: Vec) {
  const store = (resource: string, mass: number) => ({ resource, mass: Math.round(mass * 1e6) / 1e6, capacity: Math.round(mass * 1e6) / 1e6 });
  const bodies: Json[] = [
    { ...fixed(`${name}-pad`, { kind: "box", width: 2, height: 0.3 }, { x: at.x, y: at.y + 0.15 }), anchored: { mass: 30 } },
    {
      id: name,
      shape: { kind: "box", width: 1.4, height: 1.6 },
      mass: 2,
      position: { x: at.x, y: at.y + 1.1 },
      velocity: { x: 0, y: 0 },
      angle: 0,
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
  const joints: Json[] = [-0.5, 0.5].map((x, k) => ({ id: `${name}-w-${k}`, a: `${name}-pad`, b: name, anchorA: { x, y: 0.15 }, anchorB: { x, y: -0.8 }, limits }));
  return { bodies, joints, tank: name };
}

interface Level {
  n: number;
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
  /** The fuel tanks: where each stands, on flat rock. */
  tanks: Vec[];
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
  asteroid?: { island: Vec[]; radius: number; gravity: number; box: number; escape: number };
  plant?: { at: Vec; antennae: [{ at: Vec; angle: number }, { at: Vec; angle: number }]; lines: { points: Vec[]; needs?: string[] }[]; beyond: number[] };
}

function write(l: Level) {
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
  const sky = ast ? air : [{ x: left, y: SKY }, { x: right, y: SKY }, ...l.ground.filter((p) => !inCave(p))];
  const turrets = l.turrets.map((t, k) => (t.electric ? electricTurret : turret)(`t${k + 1}`, t.at, t.angle, (t.electric ? ELECTRIC_TURRET : TURRET) as never, 100 * l.n + k + 1));
  const tanks = l.tanks.map((at, k) => fuelTank(`fuel-${k + 1}`, at));
  const plant = l.plant ? powerPlant(l.plant.at, PLANT) : undefined;
  const aerials = l.plant ? l.plant.antennae.map((a, k) => antenna(`aerial-${k + 1}`, a.at, a.angle)) : [];
  const name = `thrust-${l.n}`;
  const scenario = {
    schema: 1,
    name,
    title: `Mammoth Thrust: ${l.title}`,
    description: l.description,
    profile: "sandbox",
    seed: 1,
    world: {
      gravity: ast ? { x: 0, y: 0 } : { x: 0, y: -GRAVITY },
      bounds: ast ? { min: { x: -ast.box - 20, y: -ast.box - 20 }, max: { x: ast.box + 20, y: ast.box + 20 }, wrap: false, farField: 10, depth: 2 } : { min: { x: left - 20, y: Math.min(...l.ground.map((p) => p.y)) - 40 }, max: { x: right + 20, y: l.top + WALL + 20 }, wrap: false, farField: 10, depth: 2 },
      // The rock is made from the outline when the world is (TER-001), and explosions and shells crater it.
      terrain: { outline: air, ...(ast ? { islands: [ast.island] } : {}), prefix: "rock-", craters: CRATERS },
      bodies: [
        // An asteroid's gravity: a source at its centre that pulls as a uniform ball (FLT-015), hidden in the rock.
        ...(ast ? [{ ...fixed("rock-core", { kind: "disc", radius: 0.5 }, P(0, 0)), gravity: { mu: ast.gravity * ast.radius * ast.radius, core: 1, radius: ast.radius } }] : []),
        ...pod(l.pod), ...turrets.flatMap((t) => t.bodies), ...tanks.flatMap((t) => t.bodies), ...(plant?.bodies ?? []), ...aerials.flatMap((a) => a.bodies)],
      joints: [...turrets.flatMap((t) => t.joints), ...tanks.flatMap((t) => t.joints), ...(plant?.joints ?? []), ...aerials.flatMap((a) => a.joints)],
      links: turrets.flatMap((t) => t.links),
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
                transmitters: [{ id: "tx", sides: aerials.map((a) => ({ mount: a.mount, parts: a.parts, tip: a.tip })), width: 1, shock: SHOCK }],
                turrets: turrets.map((t, k) => ({ id: t.carriage, ...(l.plant!.beyond.includes(k + 1) ? { needs: ["tx"] } : {}) })),
              },
            }
          : {}),
        lives: 3,
        respawn: 1.25,
        grace: 1,
        level: l.n,
        view: { colour: l.colour, pitch: 1, sky, caves: l.caves, ...(ast ? { islands: [ast.island] } : {}) },
      },
    },
    timeline: [],
    end: { steps: 240 }, // the game runs on until it is over; this is how far a headless run goes
    probes: [],
    assertions: [],
    ui: { keys: { q: "left", e: "right", w: "fire", s: "reverse", z: "tractor" }, overlays: [], labels: false }, // the page adds Space, the arrows, Shifts and the right-hand keys
  };
  parseScenario(scenario); // fails loudly if the scenario is malformed
  writeFileSync(join(root, "scenarios", `${name}.json`), JSON.stringify(scenario, null, 2) + "\n");
  console.log(`wrote scenarios/${name}.json`);
}

const P = (x: number, y: number): Vec => ({ x, y });

// Level 1, the surface (MTH-011): no cave. Mountains across 300 m with a hollow between them; the
// pod stands in the hollow, in plain sight. The ship comes in over the flat to the left.
write({
  n: 1,
  title: "The surface",
  description: "Fly down to the pod in the hollow, take it on the tether with the tractor beam, and carry it up past the top.",
  colour: "#c8502e",
  top: 120,
  // Right to left: the open space is above.
  ground: [
    P(150, 62), P(138, 40), P(124, 36), P(112, 16), P(96, 16), P(84, 18), P(70, 30), P(56, 24), P(44, 6), P(42, 5), P(34, 5), P(30, 2),
    P(20, -8), P(4, -8), P(-4, -6), P(-12, 8), P(-24, 26), P(-36, 22), P(-48, 10), P(-78, 10), P(-92, 12), P(-104, 30),
    P(-120, 34), P(-135, 58), P(-150, 60),
  ],
  caves: [],
  start: P(-63, 75),
  pod: P(12, -8),
  // One turret, on a ledge at the hollow's rim, overlooking the pod.
  turrets: [{ at: P(38, 5), angle: 0 }],
  // One fuel tank, on the flat to the right.
  tanks: [P(104, 16)],
});

// Level 2, one chamber (MTH-011): a shaft 30 m wide and 80 m deep opens into a single chamber 120 m
// across. The pod stands on the chamber's floor, to the left of the shaft.
{
  // The shaft and chamber, clockwise from the shaft's right lip: down its right wall, round the
  // chamber (roof, right wall, floor, left wall, roof), and up the shaft's left wall to its left lip.
  const cave = [
    P(15, 16), P(15, -62), P(45, -62), P(60, -77), P(60, -100), P(48, -112), P(-48, -112), P(-60, -100), P(-60, -77), P(-45, -62),
    P(-15, -62), P(-15, 18),
  ];
  write({
    n: 2,
    title: "The chamber",
    description: "The pod is in a chamber at the foot of a shaft. Fly down, take it on the tether, and carry it up the shaft and past the top.",
    colour: "#3fa35a",
    top: 130,
    ground: [
      P(150, 56), P(134, 44), P(118, 24), P(100, 24), P(80, 26), P(64, 44), P(48, 40), P(30, 22),
      ...cave,
      P(-26, 20), P(-40, 34), P(-56, 30), P(-70, 20), P(-96, 20), P(-112, 24), P(-130, 46), P(-150, 50),
    ],
    caves: [cave],
    caveBelow: 15,
    start: P(-83, 80),
    pod: P(-30, -112),
    // One on the surface to the right of the shaft; in the chamber, one on the floor and one hanging from the roof over the pod.
    turrets: [
      { at: P(109, 24), angle: 0 },
      { at: P(30, -112), angle: 0 },
      { at: P(-30, -62), angle: Math.PI },
    ],
    // One on the surface beside the start, one on the chamber's floor at the foot of the shaft.
    tanks: [P(-91, 20), P(5, -112)],
  });
}

// Level 3, the winding cave (Chloe's drawing, 13 November 2026, traced at 0.1 m a pixel): a cave
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
    n: 3,
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

// Level 4, the asteroid (13 November 2026, a first design to try, before Chloe draws one): a round
// asteroid 180 m across floating in a box of open space 340 m across, its gravity a uniform ball's
// (FLT-015): 4 m/s² at the surface, falling as 1/r² outside and in a straight line to nothing at
// its centre. A tunnel winds down from a mouth on its upper left into a chamber above its centre,
// where the pod stands (gravity there 0.5 m/s²). Eight electric turrets round the tunnel and
// chamber, five fuel turrets round the surface (one hanging underneath). Escape: 150 m from the
// centre. Generated from shapes (disc, chamber, tunnel) traced as level 3 was; the points are below.
{
  // The asteroid's rock, counter-clockwise (rock on the left), cave included.
  const island = [
      P(60.2, 67), P(53.2, 72.8), P(46.5, 77.2), P(32.8, 84), P(24.5, 86.8), P(15.8, 88.8), P(8.2, 89.8), P(1.6, 90), P(-1.6, 90), P(-8.2, 89.8),
      P(-19.5, 88), P(-30.8, 84.8), P(-38, 81.8), P(-40.2, 80.2), P(-47.8, 69), P(-47.9, 67), P(-48.1, 59), P(-48, 56.8), P(-42.8, 52.4), P(-35.2, 50.1),
      P(-24.4, 52.3), P(-16.6, 53.7), P(-13.8, 54), P(-9.8, 56.2), P(-4, 58), P(4, 58), P(6.8, 57.2), P(11.5, 55.5), P(16.7, 52.6), P(21.8, 46.4),
      P(23.5, 43.5), P(25.5, 37.8), P(26, 34.5), P(25.9, 27.8), P(23.6, 20.2), P(20.5, 15.8), P(16.8, 12), P(11.6, 12), P(8.4, 12), P(-4.4, 12),
      P(-7.6, 12), P(-16.8, 12), P(-18, 13), P(-20.5, 15.8), P(-23.2, 20), P(-25.2, 25.2), P(-25.8, 28), P(-34, 26.4), P(-42, 26.1), P(-46.5, 27.8),
      P(-67.2, 40.2), P(-69.8, 42.8), P(-71.2, 45.5), P(-72, 48.2), P(-68.9, 51.2), P(-75.1, 56.3), P(-72.5, 53.5), P(-79.2, 43), P(-83.5, 34), P(-86, 27.1),
      P(-88, 19.4), P(-90, 4.8), P(-90, -4.8), P(-88.8, -15.8), P(-86.8, -24.5), P(-84, -32.8), P(-79.2, -43), P(-76.1, -48.2), P(-71.4, -54.8), P(-67.8, -59.5),
      P(-65, -62.5), P(-59, -67.8), P(-57.2, -69.2), P(-51.5, -74), P(-43, -79.2), P(-34, -83.5), P(-24.5, -86.8), P(-14.2, -89), P(-4, -90), P(4, -90),
      P(14.2, -89), P(24.5, -86.8), P(34, -83.5), P(43, -79.2), P(51.5, -74), P(57.8, -69.2), P(59.5, -67.8), P(65, -62), P(67.8, -59), P(71.4, -54.8),
      P(76.1, -48.2), P(79.2, -43), P(84, -32.8), P(86.8, -24.5), P(88.8, -15.8), P(90, -4.8), P(90, 4.8), P(88, 19.4), P(86, 27.1), P(81.8, 38),
      P(76, 48.5), P(69.2, 57.8),
  ];
  // The cave, for the view: the island's points inside the surface, closed across the mouth.
  const cave = [
      P(-40.2, 80.2), P(-47.8, 69), P(-47.9, 67), P(-48.1, 59), P(-48, 56.8), P(-42.8, 52.4), P(-35.2, 50.1), P(-24.4, 52.3), P(-16.6, 53.7), P(-13.8, 54),
      P(-9.8, 56.2), P(-4, 58), P(4, 58), P(6.8, 57.2), P(11.5, 55.5), P(16.7, 52.6), P(21.8, 46.4), P(23.5, 43.5), P(25.5, 37.8), P(26, 34.5),
      P(25.9, 27.8), P(23.6, 20.2), P(20.5, 15.8), P(16.8, 12), P(11.6, 12), P(8.4, 12), P(-4.4, 12), P(-7.6, 12), P(-16.8, 12), P(-18, 13),
      P(-20.5, 15.8), P(-23.2, 20), P(-25.2, 25.2), P(-25.8, 28), P(-34, 26.4), P(-42, 26.1), P(-46.5, 27.8), P(-67.2, 40.2), P(-69.8, 42.8), P(-71.2, 45.5),
      P(-72, 48.2), P(-68.9, 51.2), P(-75.1, 56.3),
  ];
  write({
    n: 4,
    title: "The asteroid",
    description: "A round asteroid with a winding tunnel into a chamber where the pod stands. Its gravity pulls toward its centre. Fly in, take the pod on the tether, and carry it 150 m out from the centre.",
    colour: "#8a7bd8",
    top: 150,
    ground: [],
    caves: [cave],
    start: P(0, 118),
    pod: P(-6.0, 12.0),
    turrets: [
      { at: P(87.0, 23.2), angle: -1.313 },
      { at: P(-87.0, 23.2), angle: 1.313 },
      { at: P(-73.8, -51.5), angle: 2.191 },
      { at: P(0.0, -90.0), angle: -3.142 },
      { at: P(73.8, -51.5), angle: -2.191 },
      { at: P(-20.5, 53.0), angle: -2.972, electric: true },
      { at: P(19.2, 49.5), angle: 2.273, electric: true },
      { at: P(24.8, 24.0), angle: 1.282, electric: true },
      { at: P(0.0, 58.0), angle: -3.142, electric: true },
      { at: P(-39.0, 51.2), angle: 2.856, electric: true },
      { at: P(-38.0, 26.2), angle: 0.048, electric: true },
      { at: P(-72.0, 53.8), angle: -0.686, electric: true },
      { at: P(-48.0, 63.0), angle: 1.55, electric: true },
    ],
    tanks: [P(0.0, 90.0), P(10.0, 12.0)],
    asteroid: { island, radius: 90, gravity: 4, box: 170, escape: 150 },
  });
}
