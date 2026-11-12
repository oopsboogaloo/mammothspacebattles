// Mammoth Thrust's levels (docs/games/mammoth-thrust.md §3, -design.md §4): the ground from an
// outline of its open space, the ship (Mammoth Asteroids' ship with a tractor unit and a tether
// unit), and the pod on its stand. The game itself is in the world (src/core/thrust.ts).
//   node scripts/thrust.ts            writes scenarios/thrust-1.json and thrust-2.json
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario } from "../src/core/index.ts";
import { asteroidShip, SHIP_MIX } from "./asteroidShip.ts";
import { crust, narrowest, type Vec } from "./terrain.ts";

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
  // The beam is a 30° wedge down the ship's tail. The tether is the TRC spring between the two
  // centres of mass (TRC-004), 12 m long. Taken nearer than that, it starts at the distance it was
  // taken at and pays out at 4 m/s (TRC-010): at its full length at once, it threw ship and pod
  // apart with 6,000 N and tore the tractor unit off.
  const tractor = { channel: "tractor", range: 40, arc: Math.PI / 6, force: 400, capture: 1.2, tether: { length: 12, stiffness: 2000, damping: 0.7, maxTension: 20000, payOut: 4 } };
  return asteroidShip({ small: SMALL, main: MAIN, economy: ECONOMY, magazine, tractor });
}

const fixed = (id: string, shape: Json, position: Vec): Json => ({ id, fixed: true, mass: 1, friction: 0.9, position, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape });

/**
 * The pod on its stand, on flat floor at `at`: a disc of 1 m radius and about half the ship's mass,
 * very hard to destroy (MTH-025), in a shallow cup so it doesn't roll off.
 */
function pod(at: Vec): Json[] {
  return [
    fixed("stand", { kind: "box", width: 2.3, height: 0.3 }, { x: at.x, y: at.y + 0.15 }),
    fixed("stand-l", { kind: "box", width: 0.3, height: 0.35 }, { x: at.x - 1, y: at.y + 0.475 }),
    fixed("stand-r", { kind: "box", width: 0.3, height: 0.35 }, { x: at.x + 1, y: at.y + 0.475 }),
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
      bodies: [...crust(air, "rock-"), ...pod(l.pod)],
      thrust: {
        ship: ship(),
        mix: SHIP_MIX,
        hull: "p{n}-hull",
        tractor: "p{n}-tractor",
        start: l.start,
        top: l.top,
        pod: "pod",
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
    P(150, 62), P(138, 40), P(124, 36), P(112, 16), P(96, 16), P(84, 18), P(70, 30), P(56, 24), P(44, 6), P(30, 2),
    P(20, -8), P(4, -8), P(-4, -6), P(-12, 8), P(-24, 26), P(-36, 22), P(-48, 10), P(-78, 10), P(-92, 12), P(-104, 30),
    P(-120, 34), P(-135, 58), P(-150, 60),
  ],
  caves: [],
  start: P(-63, 75),
  pod: P(12, -8),
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
  });
}
