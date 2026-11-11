// Mammoth Asteroids' scenario (docs/games/mammoth-asteroids.md, -design.md §3): the arena, the ship
// (Lander's breakable LAND ship with a railgun on its nose) and the rocks' tuning. The game itself
// lays out each level (src/core/arcade.ts).
//   node scripts/asteroids.ts            writes scenarios/asteroids.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario } from "../src/core/index.ts";
import { landShip, material, WELD, YIELD } from "./landShip.ts";

const root = new URL("..", import.meta.url).pathname;

/** Fuel economy (FLT-010): a tank lasts a level and more. To tune after play. */
const ECONOMY = 15;
/** The arena: 160 m high; the page sets the width from the screen's shape (this is 16:9). */
const HEIGHT = 160;
const WIDTH = 284;

/**
 * The railgun: a small block on top of the hull, on the ship's centre line, so its recoil pushes the
 * ship straight back and doesn't turn it. Its slug is light and weak: it breaks up when it hits.
 * Times are game seconds: a reload of 0.125 is four shots a second on screen.
 */
function ship() {
  const s = landShip("p{n}-", ECONOMY);
  const slug = { shape: { kind: "disc", radius: 0.06 }, mass: 0.1, restitution: 0, friction: 0.3, material: { name: "slug", threshold: 0, toughness: 50 } };
  const gun = {
    id: "p{n}-gun",
    shape: { kind: "box", width: 0.5, height: 0.3 },
    mass: 1,
    position: { x: 0, y: 0.65 }, // on the hull's top face (the hull is 1 m high, centred on the origin)
    velocity: { x: 0, y: 0 },
    angle: 0,
    angularVelocity: 0,
    restitution: 0,
    friction: 0.3,
    material: material("gun"),
    // The muzzle is just past the block's top; the bore is along +y.
    magazine: { count: 60, reload: 0.125, at: { x: 0, y: 0.3 }, angle: 0, shell: slug, railgun: { channel: "fire", speed: 200 } },
  };
  const weld = (side: string, x: number) => ({ id: `p{n}-gun-${side}`, a: "p{n}-hull", b: "p{n}-gun", anchorA: { x, y: 0.5 }, anchorB: { x, y: -0.15 }, limits: WELD, yield: YIELD });
  return {
    bodies: [...s.bodies, gun],
    joints: [...s.joints, weld("l", -0.2), weld("r", 0.2)],
    links: [...s.links, { id: "p{n}-ctl-fire", kind: "control", channel: "fire", to: "p{n}-gun" }],
  };
}

/**
 * The gunship: the stress test's Gunship 3 with its Hunting pilot (ids and channels `g{n}`, side
 * "enemy"), without its tractor. Its shell is a small solid slug, not Gunship 3's 1 kg explosive
 * one: sized so a hit damages the LAND ship without usually destroying it (MAS-041).
 */
function gunship() {
  const stress = JSON.parse(readFileSync(join(root, "scenarios", "stress-test.json"), "utf8")) as { ui: { spawn: { bodies: Json[]; joints: Json[]; links: Json[] } } };
  const t = JSON.parse(JSON.stringify(stress.ui.spawn).replaceAll("s{n}", "g{n}")) as { bodies: Json[]; joints: Json[]; links: Json[] };
  for (const b of t.bodies) {
    delete b.tractor;
    if (b.pilot) b.pilot = { ...(b.pilot as Json), side: "enemy" };
    const mag = b.magazine as (Json & { shell: Json }) | undefined;
    if (mag) mag.shell = { shape: { kind: "disc", radius: 0.1 }, mass: 0.15, restitution: 0, friction: 0.3 };
  }
  return { bodies: t.bodies, joints: t.joints, links: t.links.filter((l) => l.channel !== "g{n}.tractor") };
}
type Json = Record<string, unknown>;

const scenario = {
  schema: 1,
  name: "asteroids",
  title: "Mammoth Asteroids",
  description: "Break the rocks with the railgun and collect their gold. The arena wraps round.",
  profile: "sandbox",
  seed: 1,
  world: {
    gravity: { x: 0, y: 0 },
    bounds: { min: { x: -WIDTH / 2, y: -HEIGHT / 2 }, max: { x: WIDTH / 2, y: HEIGHT / 2 }, wrap: true, farField: 10, depth: 2 },
    bodies: [],
    arcade: {
      ship: ship(),
      hull: "p{n}-hull",
      gun: "p{n}-gun",
      lives: 3,
      rocks: {
        radius: 12,
        pieces: 20,
        density: 20,
        // The mining tuning (tough pieces, weaker bonds), to retune for the slug (design §5 step 8).
        bond: 20_000,
        material: { name: "rock", threshold: 100, toughness: 20_000 },
        // About 1 m/s² at a large rock's surface: G ≈ R² / M, M ≈ 0.8 π R² × density.
        gravity: { G: 0.02 },
        gold: [2, 3],
        compounds: [1, 2],
        speed: [2, 6],
        spin: 0.1,
        most: 8,
      },
      // Game seconds: 20 s into the level and every minute after, on screen (MAS-040). From level 9,
      // where the rocks stop growing, 2 s sooner and 5 s closer together a level, and more skilled (MAS-043).
      gunship: {
        template: gunship(),
        hull: "g{n}-hull",
        fromLevel: 3,
        first: 10,
        every: 30,
        skill: { base: 0.3, perLevel: 0.1, max: 0.8 },
        late: { first: -1, firstMin: 5, every: -2.5, everyMin: 10, skill: 0.05, skillMax: 1 },
      },
      respawn: 1.25,
      grace: 1,
      clearPause: 1.5,
      // A slug flies 140 m: less than the arena's height, so one fired straight up or down can't come
      // round the arena and hit the ship that fired it (at 1.5 s it did, in under a second).
      shellLife: 0.7,
      pace: 0.5,
      seed: 1,
    },
  },
  timeline: [],
  end: { steps: 240 }, // the game runs on until it is over; this is how far a headless run goes
  probes: [],
  assertions: [],
  ui: { keys: { q: "left", e: "right", w: "fire" }, overlays: [], labels: false }, // the page adds Space, the arrows and Shifts
};

parseScenario(scenario); // fails loudly if the scenario is malformed
writeFileSync(join(root, "scenarios", "asteroids.json"), JSON.stringify(scenario, null, 2) + "\n");
console.log("wrote scenarios/asteroids.json");
