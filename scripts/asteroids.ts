// Mammoth Asteroids' scenario (docs/games/mammoth-asteroids.md, -design.md §3): the arena, the ship
// (Lander's breakable LAND ship with a railgun on its nose) and the rocks' tuning. The game itself
// lays out each level (src/core/arcade.ts).
//   node scripts/asteroids.ts            writes scenarios/asteroids.json
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseScenario } from "../src/core/index.ts";
import { asteroidShip, SHIP_MIX } from "./asteroidShip.ts";

const root = new URL("..", import.meta.url).pathname;

/**
 * The engines' propellant flow, kg/s (to tune after play). Chloe asked for three times the LAND
 * ship's forward acceleration and twice its turning (11 November 2026). Measured in empty space,
 * that ship (48 kg) made 4.29 m/s² with both engines and 1.74 rad/s² with one; this one (67 kg)
 * made 12.9 m/s² with the main and both back thrusters, 3.48 rad/s² turning, and 4.2 m/s² braking.
 * After playing it she asked for a stronger forward engine (11 November 2026): the main thruster's
 * flow went from 2.8 to 4.86 kg/s, which makes 19.3 m/s² forward, half as much again.
 */
const SMALL = 0.68;
const MAIN = 4.86;
/**
 * Fuel economy (FLT-010): the two tanks (16.2 kg) last about two minutes of full thrust, as the LAND
 * ship's one did. To tune after play.
 */
const ECONOMY = 45;
/** The arena: 160 m high; the page sets the width from the screen's shape (this is 16:9). */
const HEIGHT = 160;
const WIDTH = 284;

/**
 * The ship (scripts/asteroidShip.ts) with its railgun's magazine. Times are game seconds: a reload
 * of 0.25 is two shots a second on screen.
 */
function ship() {
  // An explosive shell (asked for by Chloe after playing, 11 November 2026: a solid slug did nothing
  // to the rocks). It is the Mammoth scenario's, from the mining tuning (AST-008): 0.5 kg, 0.3 kg of
  // it charge, launched at 96 m/s. The blast's gas pushes the rock's pieces apart. No casing
  // fragments: they would fly round the arena. Chloe then asked for more power (11 November 2026):
  // the charge had three times TNT's energy and a 3 m blast, where that tuning had TNT and 2 m.
  // Then more damage again (11 November 2026, with the new ship): six times TNT's energy (75.6 kJ in
  // this profile) and a 4 m blast. Nine shells left a rock in 8 chunks with 11 of its 20 pieces destroyed.
  // Then more push from the blast's gas (11 November 2026). The shell's own 0.5 kg of gas can't move
  // 100 kg pieces much however hot it is: with eight times the energy they still left at about
  // 1 m/s. So the charge makes 5 kg more gas (`gas`, a cheat the ledger records) and has twice the
  // energy, and the rock is twice as tough so the blast destroys no more of it. Measured on three
  // rocks, nine shells each: the pieces leave at 1 to 3 m/s (the fastest at 4 to 5), where they
  // left at 0.5 to 2; 8 to 13 chunks, 7 to 12 pieces destroyed.
  // Then three times the shells at a third of the weight (asked for by Chloe, 11 November 2026):
  // 120 shells of 0.167 kg, so the magazine still weighs 20 kg and a shot kicks a third as hard.
  // Each blast is as it was: the same energy (0.1 kg of charge at three times the energy a kg) and
  // the same 5.5 kg of gas (5.33 kg of it made from nothing).
  const slug = { shape: { kind: "box", width: 0.26, height: 0.22 }, mass: 0.166667, restitution: 0, friction: 0.05, explosive: { charge: 0.1, fragments: 0, radius: 4, heat: 1.512e8, gas: 5.333333 } };
  // The muzzle is just past the gun's top (the gun is 0.7 m long, the shell 0.22 m); the bore is along +y.
  const magazine = { count: 120, reload: 0.25, at: { x: 0, y: 0.51 }, angle: 0, shell: slug, railgun: { channel: "fire", speed: 96 } };
  return asteroidShip({ small: SMALL, main: MAIN, economy: ECONOMY, magazine });
}

/**
 * The gunship: the stress test's Gunship 3 with its Hunting pilot (ids and channels `g{n}`, side
 * "enemy"), without its tractor. Its shell is a small solid slug, not Gunship 3's 1 kg explosive
 * one: sized so a hit damages the LAND ship without usually destroying it (MAS-041).
 */
/** The gunship's solid shell, kg (0.15 until 11 November 2026, when Chloe asked for more damage). */
const GUNSHIP_SHELL = 0.3;
function gunship() {
  const stress = JSON.parse(readFileSync(join(root, "scenarios", "stress-test.json"), "utf8")) as { ui: { spawn: { bodies: Json[]; joints: Json[]; links: Json[] } } };
  const t = JSON.parse(JSON.stringify(stress.ui.spawn).replaceAll("s{n}", "g{n}")) as { bodies: Json[]; joints: Json[]; links: Json[] };
  for (const b of t.bodies) {
    delete b.tractor;
    if (b.pilot) b.pilot = { ...(b.pilot as Json), side: "enemy" };
    const mag = b.magazine as (Json & { shell: Json }) | undefined;
    if (mag) mag.shell = { shape: { kind: "disc", radius: 0.1 }, mass: GUNSHIP_SHELL, restitution: 0, friction: 0.3 };
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
      mix: SHIP_MIX,
      hull: "p{n}-hull",
      gun: "p{n}-gun",
      lives: 3,
      rocks: {
        radius: 12,
        pieces: 20,
        // The mining tuning (AST-008): light rock of tough pieces and weak bonds, so a shell's blast
        // pushes pieces apart and few are destroyed. The bonds are 800 N/m, not that tuning's 3,500:
        // a bond's strength goes with the length of its edge, and these pieces are about three times
        // the size of the 4 m rocks it was tuned on. Measured on four shapes: a rock splits by hit
        // 2–4 and is in 3–10 chunks by hit 8, with 1–3 of its 20 pieces destroyed (design §2.3a).
        density: 6,
        bond: 800,
        // Twice the mining tuning's toughness, with a shell of twice the energy: the same damage.
        material: { name: "rock", threshold: 200, toughness: 40_000 },
        // About 2 m/s² at a large rock's surface (doubled on 11 November 2026: Chloe asked for
        // stronger gravity). The pieces welded together pull as one source
        // (AST-011), softened by half the rock's reach, so at the surface the pull is about
        // G M / (1.4 R²), with M ≈ 0.8 π R² × density.
        gravity: { G: 0.186, joined: true },
        orbit: true,
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
        most: 3, // flying at once: each costs about 0.9 ms a step (design §2.4)
        late: { first: -1, firstMin: 5, every: -2.5, everyMin: 10, skill: 0.05, skillMax: 1 },
      },
      respawn: 1.25,
      grace: 1,
      clearPause: 1.5,
      // A shell flies 134 m: less than the arena's height, so one fired straight up or down can't come
      // round the arena and hit the ship that fired it.
      shellLife: 1.4,
      pace: 0.5,
      seed: 1,
    },
  },
  timeline: [],
  end: { steps: 240 }, // the game runs on until it is over; this is how far a headless run goes
  probes: [],
  assertions: [],
  ui: { keys: { q: "left", e: "right", w: "fire", s: "reverse" }, overlays: [], labels: false }, // the page adds Space, the arrows and Shifts
};

parseScenario(scenario); // fails loudly if the scenario is malformed
writeFileSync(join(root, "scenarios", "asteroids.json"), JSON.stringify(scenario, null, 2) + "\n");
console.log("wrote scenarios/asteroids.json");
