// Mammoth Thrust's levels (docs/games/mammoth-thrust.md §3, -design.md §4): the ground from an
// outline of its open space, the ship (Mammoth Asteroids' ship with a tractor unit and a tether
// unit), and the pod on its stand. The game itself is in the world (src/core/thrust.ts).
//   node scripts/thrust.ts            writes scenarios/thrust-1.json and thrust-2.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario } from "../src/core/index.ts";
import { asteroidShip, SHIP_MIX } from "./asteroidShip.ts";
import { narrowest, type Vec } from "./terrain.ts";
import { turret, type TurretTuning } from "./turretParts.ts";

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
  // The beam is a 30° wedge down the ship's tail, and pulls only the pod (TRC-011): not the wreckage
  // of the ships before. Its pull is three times the engine's default (asked for by Chloe after
  // playing, 12 November 2026: picking the pod up was too hard).
  // The tether is the TRC spring between the two centres of mass (TRC-004), 12 m long. It takes the
  // pod from up to 22 m off, starts at the distance it took it at, and reels it in (or pays out) to
  // 12 m at 6 m/s (TRC-010), heavily damped, so nothing is snatched or thrown. It holds five times
  // the pull it did: Chloe had it let go under thrust.
  // Held on a fuel tank in its wedge, the beam draws the tank's fuel into the ship's two tanks
  // (TRC-008), 2 kg a game second: a full 8.1 kg tank in 8 s on screen. The tank isn't pulled.
  const tractor = { channel: "tractor", range: 40, arc: Math.PI / 6, force: 1200, capture: 1.2, only: ["pod"], siphon: { rate: 2 }, tether: { length: 12, reach: 22, stiffness: 2000, damping: 1.5, maxTension: 100000, payOut: 6 } };
  return asteroidShip({ small: SMALL, main: MAIN, economy: ECONOMY, magazine, tractor });
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
  start: Vec;
  pod: Vec;
  /** The turrets: where each stands (the middle of its base, on flat rock) and which way is up for it, rad from +y. */
  turrets: { at: Vec; angle: number }[];
  /** The fuel tanks: where each stands, on flat rock. */
  tanks: Vec[];
}

function write(l: Level) {
  const left = l.ground[l.ground.length - 1].x;
  const right = l.ground[0].x;
  // The outline that makes the rock: closed over the sky a little above the level's top.
  const air = [{ x: left, y: l.top + WALL }, { x: right, y: l.top + WALL }, ...l.ground];
  if (l.caveBelow !== undefined) {
    const w = narrowest(air, l.caveBelow);
    if (w < LEAST_WIDTH) throw new Error(`level ${l.n}: a passage is ${w.toFixed(1)} m wide, less than ${LEAST_WIDTH} m`);
  }
  // The sky, for the stars: the open space above the ground, closed across each cave's mouth.
  const inCave = (p: Vec) => l.caves.some((c) => c.slice(1, -1).some((q) => q.x === p.x && q.y === p.y));
  const sky = [{ x: left, y: SKY }, { x: right, y: SKY }, ...l.ground.filter((p) => !inCave(p))];
  const turrets = l.turrets.map((t, k) => turret(`t${k + 1}`, t.at, t.angle, TURRET, 100 * l.n + k + 1));
  const tanks = l.tanks.map((at, k) => fuelTank(`fuel-${k + 1}`, at));
  const name = `thrust-${l.n}`;
  const scenario = {
    schema: 1,
    name,
    title: `Mammoth Thrust: ${l.title}`,
    description: l.description,
    profile: "sandbox",
    seed: 1,
    world: {
      gravity: { x: 0, y: -GRAVITY },
      bounds: { min: { x: left - 20, y: Math.min(...l.ground.map((p) => p.y)) - 40 }, max: { x: right + 20, y: l.top + WALL + 20 }, wrap: false, farField: 10, depth: 2 },
      // The rock is made from the outline when the world is (TER-001), and explosions and shells crater it.
      terrain: { outline: air, prefix: "rock-", craters: CRATERS },
      bodies: [...pod(l.pod), ...turrets.flatMap((t) => t.bodies), ...tanks.flatMap((t) => t.bodies)],
      joints: [...turrets.flatMap((t) => t.joints), ...tanks.flatMap((t) => t.joints)],
      links: turrets.flatMap((t) => t.links),
      thrust: {
        ship: ship(),
        mix: SHIP_MIX,
        hull: "p{n}-hull",
        tractor: "p{n}-hull",
        gun: "p{n}-gun",
        start: l.start,
        top: l.top,
        pod: "pod",
        turrets: turrets.map((t) => t.carriage),
        // Every tank the ship can draw from: the fuel tanks, and each turret's own.
        tanks: [...tanks.map((t) => t.tank), ...turrets.map((t) => t.tank)],
        lives: 3,
        respawn: 1.25,
        grace: 1,
        level: l.n,
        view: { colour: l.colour, pitch: 1, sky, caves: l.caves },
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
