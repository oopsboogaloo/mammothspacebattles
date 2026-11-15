// Moon Mammoth's levels (docs/games/moon-mammoth.md §3, -design.md §4): a round moon from a
// surface height given along its circumference, with its craters, boulders, ledges, spikes,
// girders, falling rocks and flags; the mammoth; and the moves' numbers. The game itself is in the
// world (src/core/moon.ts).
//   node scripts/moon.ts            writes scenarios/moon-1.json and moon-test.json
//
// Numbers here are the game's: the page runs it at one in two of the player's seconds, so a speed
// the player sees is half of it here, an acceleration a quarter, and a time twice.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { initialWorld, parseScenario, polygonArea } from "../src/core/index.ts";

const root = new URL("..", import.meta.url).pathname;
type Vec = { x: number; y: number };
type Json = Record<string, unknown>;

/** Gravity at the moon's surface, m/s² (25 as the player sees it). */
const GRAVITY = 100;
/** The mammoth's radius standing and ducked, m. */
const STAND = 1;
const DUCK = 0.6;
/** The moves (first values, to tune after play). As the player sees them: run 9 m/s, jump 3.5 m, roll 16 m/s for 0.6 s. */
const MOVES = {
  size: { stand: STAND, duck: DUCK },
  run: { speed: 18, accel: 144, brake: 144, air: 70 },
  jump: { speed: 26.5, cut: 0.45, early: 0.05, late: 0.05 },
  roll: { speed: 32, time: 0.3, wait: 0.5 },
  slide: { brake: 16, least: 1, crawl: 5 },
  slope: 0.5,
  reach: 2.5,
};
/** How far a running jump carries, m, and how high a jump is: what the level's checks hold it to. */
const JUMP_LENGTH = (2 * MOVES.jump.speed * MOVES.run.speed) / GRAVITY;
const JUMP_HEIGHT = (MOVES.jump.speed * MOVES.jump.speed) / (2 * GRAVITY);
/** The surface is sampled this often, m: plain ground, and inside a crater (its bowl needs more). */
const STEP = 3;
const FINE = 1;
/** A spike's width and height, m. */
const SPIKE = { width: 0.8, height: 0.7 };

/** What stands along the course. `at` is metres clockwise round the moon from its top. */
type Feature =
  | { kind: "crater"; at: number; width: number; depth: number; spikes?: number }
  | { kind: "boulder"; at: number; width: number; height: number }
  | { kind: "ledge"; at: number; length: number; height: number }
  | { kind: "girder"; at: number; length: number; gap: number }
  | { kind: "rock"; at: number; height: number; within: number };

interface Level {
  name: string;
  title: string;
  description: string;
  radius: number;
  /** Long gentle waves: each `{ waves, height, turn }` is that many round the moon. */
  hills: { waves: number; height: number; turn: number }[];
  features: Feature[];
  /** The flags: where, and the time for the leg that ends there, game s. */
  flags: { at: number; time: number }[];
}

function build(level: Level): Json {
  const R = level.radius;
  const C = 2 * Math.PI * R;
  const problems: string[] = [];

  /** The surface's height over the base radius at s. */
  const height = (s: number): number => {
    let h = 0;
    for (const w of level.hills) h += w.height * Math.sin((2 * Math.PI * w.waves * s) / C + w.turn);
    for (const f of level.features) {
      if (f.kind === "crater") {
        const u = (s - f.at) / (f.width / 2);
        if (Math.abs(u) < 1) h -= (f.depth * (1 + Math.cos(Math.PI * u))) / 2;
      } else if (f.kind === "boulder") {
        const d = Math.abs(s - f.at);
        const top = f.width / 2 - 0.3;
        if (d < f.width / 2) h += d <= top ? f.height : (f.height * (f.width / 2 - d)) / 0.3;
      } else if (f.kind === "ledge") {
        if (s >= f.at && s <= f.at + f.length) h += f.height;
      }
    }
    return h;
  };
  /** The point `above` m over the surface at s, and the directions there. */
  const up = (s: number): Vec => ({ x: Math.sin(s / R), y: Math.cos(s / R) });
  const point = (s: number, above = 0): Vec => {
    const u = up(s);
    const r = R + height(s) + above;
    return { x: r * u.x, y: r * u.y };
  };
  const round = (p: Vec): Vec => ({ x: Math.round(p.x * 1e4) / 1e4, y: Math.round(p.y * 1e4) / 1e4 });

  // Where the surface is sampled: evenly, and on each side of every corner.
  const at = new Set<number>();
  const corner = (s: number) => {
    at.add(s - 0.001);
    at.add(s + 0.001);
  };
  for (const f of level.features) {
    if (f.kind === "crater") for (let s = f.at - f.width / 2; s <= f.at + f.width / 2 + 1e-9; s += FINE) at.add(s);
    else if (f.kind === "boulder") [f.at - f.width / 2, f.at - f.width / 2 + 0.3, f.at + f.width / 2 - 0.3, f.at + f.width / 2].forEach((s) => at.add(s));
    else if (f.kind === "ledge") [f.at, f.at + f.length].forEach(corner);
  }
  // The even samples, but none within a metre of a corner (short pieces of rock are more joins to cross).
  const corners = [...at];
  for (let s = 0; s < C - STEP / 2; s += STEP) if (!corners.some((k) => Math.abs(k - s) < 1)) at.add(s);
  const kept = [...at].filter((s) => s >= 0 && s < C).sort((a, b) => a - b);
  // The island's outline runs counter-clockwise (its rock on its left): the samples run clockwise.
  let outline = kept.map((s) => round(point(s)));
  if (polygonArea(outline) < 0) outline = outline.reverse();

  const fixed = (id: string, shape: Json, position: Vec, angle = 0, more: Json = {}): Json => ({ id, fixed: true, mass: 1, restitution: 0, friction: 0.9, position: round(position), velocity: { x: 0, y: 0 }, angle, angularVelocity: 0, shape, ...more });
  const bodies: Json[] = [];
  // The moon's pull: a uniform ball of its radius (FLT-015), carried by a small fixed body at its centre.
  bodies.push(fixed("moon-core", { kind: "disc", radius: 1 }, { x: 0, y: 0 }, 0, { gravity: { mu: GRAVITY * R * R, core: 1, radius: R } }));

  const rocks: Json[] = [];
  level.features.forEach((f, i) => {
    if (f.kind === "crater" && f.spikes) {
      if (f.spikes + 2 * STAND > JUMP_LENGTH) problems.push(`crater at ${f.at}: ${f.spikes} m of spikes is more than a running jump clears (${JUMP_LENGTH.toFixed(1)} m)`);
      const n = Math.round(f.spikes / SPIKE.width);
      for (let k = 0; k < n; k++) {
        const s = f.at + (k - (n - 1) / 2) * SPIKE.width;
        const vertices = [point(s - SPIKE.width / 2, -0.05), point(s + SPIKE.width / 2, -0.05), point(s, SPIKE.height)].map(round);
        bodies.push(fixed(`spike-${i}-${k}`, { kind: "polygon", vertices }, { x: 0, y: 0 }));
      }
    } else if (f.kind === "ledge") {
      if (f.height + 0.3 > JUMP_HEIGHT) problems.push(`ledge at ${f.at}: ${f.height} m is more than a jump reaches (${JUMP_HEIGHT.toFixed(1)} m)`);
    } else if (f.kind === "boulder") {
      if (f.height + 0.3 > JUMP_HEIGHT) problems.push(`boulder at ${f.at}: ${f.height} m is more than a jump reaches`);
    } else if (f.kind === "girder") {
      if (f.gap <= 2 * DUCK + 0.1 || f.gap >= 2 * STAND - 0.1) problems.push(`girder at ${f.at}: a gap of ${f.gap} m must be between the mammoth's ducked height and its standing height`);
      // It lies along the ground under it, the gap above.
      const a = point(f.at - f.length / 2);
      const b = point(f.at + f.length / 2);
      const thick = 0.5;
      const u = up(f.at);
      const mid = { x: (a.x + b.x) / 2 + u.x * (f.gap + thick / 2), y: (a.y + b.y) / 2 + u.y * (f.gap + thick / 2) };
      bodies.push(fixed(`girder-${i}`, { kind: "box", width: f.length, height: thick }, mid, Math.atan2(b.y - a.y, b.x - a.x)));
    } else if (f.kind === "rock") {
      bodies.push(fixed(`fall-${i}`, { kind: "disc", radius: 0.9 }, point(f.at, f.height), 0, { friction: 0.6 }));
      rocks.push({ id: `fall-${i}`, within: f.within, mass: 400 });
    }
  });

  const flags = level.flags.map((f) => ({ at: round(point(f.at, STAND + 0.02)), time: f.time }));
  bodies.push({ id: "mammoth", mass: 100, restitution: 0, friction: 0, position: flags[0].at, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "disc", radius: STAND } });

  if (problems.length) throw new Error(`${level.name}:\n  ${problems.join("\n  ")}`);
  const far = R + 60;
  const scenario: Json = {
    schema: 1,
    name: level.name,
    title: level.title,
    description: level.description,
    profile: "sandbox",
    seed: 1,
    world: {
      bounds: { min: { x: -far, y: -far }, max: { x: far, y: far } },
      // The open space is a square well outside the moon; the moon is an island of rock in it (TER-007).
      terrain: { outline: [{ x: -far, y: far }, { x: far, y: far }, { x: far, y: -far }, { x: -far, y: -far }], islands: [outline], restitution: 0 },
      bodies,
      moon: { mammoth: "mammoth", centre: { x: 0, y: 0 }, ...MOVES, flags, spikes: "spike-", ...(rocks.length ? { rocks } : {}), view: { outline } },
    },
    timeline: [],
    end: { steps: 240 },
    probes: [],
    assertions: [],
    ui: { overlays: [], labels: false },
  };
  // It must make a world.
  initialWorld(parseScenario(structuredClone(scenario)));
  return scenario;
}

/** The test moon: small and smooth, with one of each thing, well apart (tests/core/moon.test.ts). */
const TEST: Level = {
  name: "moon-test",
  title: "Moon Mammoth: test moon",
  description: "A small smooth moon with one ledge, one girder, one crater with spikes and one falling rock, for the tests of the mammoth's moves.",
  radius: 40,
  hills: [],
  features: [
    { kind: "ledge", at: 20, length: 8, height: 2.5 },
    { kind: "girder", at: 45, length: 5, gap: 1.5 },
    { kind: "crater", at: 80, width: 14, depth: 3, spikes: 4 },
    { kind: "rock", at: 100, height: 11, within: 14.5 },
  ],
  flags: [
    { at: 0, time: 0 },
    { at: 60, time: 8 },
    { at: 120, time: 8 },
  ],
};

/**
 * Level 1: one lap, clockwise from the top. Each thing on its own first (boulders, a crater, a
 * ledge, girders, a falling rock), then in pairs.
 */
const LEVEL_1: Level = {
  name: "moon-1",
  title: "Moon Mammoth",
  description: "Run a lap of the moon against the clock: jump the boulders and the spikes in the craters, slide under the girders, and roll out from under the falling rocks. Out of time, you go back to the last flag.",
  radius: 80,
  hills: [
    { waves: 3, height: 1.2, turn: 0.4 },
    { waves: 7, height: 0.5, turn: 2.1 },
  ],
  features: [
    { kind: "boulder", at: 35, width: 2, height: 1.2 },
    { kind: "boulder", at: 50, width: 2.4, height: 1.6 },
    { kind: "crater", at: 95, width: 11, depth: 2.2, spikes: 2.4 },
    { kind: "ledge", at: 120, length: 14, height: 2.5 },
    { kind: "girder", at: 170, length: 5, gap: 1.5 },
    { kind: "girder", at: 186, length: 5, gap: 1.5 },
    { kind: "crater", at: 205, width: 11, depth: 2.2, spikes: 2.4 },
    { kind: "rock", at: 250, height: 11, within: 14.5 },
    { kind: "boulder", at: 264, width: 2, height: 1.5 },
    { kind: "rock", at: 282, height: 11, within: 14.5 },
    { kind: "ledge", at: 315, length: 10, height: 2.5 },
    { kind: "crater", at: 340, width: 11, depth: 2.2, spikes: 3.2 },
    { kind: "girder", at: 380, length: 5, gap: 1.5 },
    { kind: "boulder", at: 392, width: 2, height: 1.5 },
    { kind: "girder", at: 403, length: 5, gap: 1.5 },
    { kind: "rock", at: 422, height: 11, within: 14.5 },
    { kind: "crater", at: 442, width: 11, depth: 2.2, spikes: 3.2 },
    { kind: "ledge", at: 462, length: 8, height: 3 },
  ],
  flags: [
    { at: 0, time: 0 },
    { at: 70, time: 7 },
    { at: 150, time: 8 },
    { at: 225, time: 8 },
    { at: 300, time: 8 },
    { at: 365, time: 7 },
    { at: 492, time: 12 },
  ],
};

for (const level of [TEST, LEVEL_1]) {
  const file = join(root, "scenarios", `${level.name}.json`);
  writeFileSync(file, `${JSON.stringify(build(level))}\n`);
  console.log(`wrote ${file}`);
}
