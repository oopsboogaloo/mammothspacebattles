// Moon Mammoth's levels (docs/games/moon-mammoth.md §3, -design.md §4): a round moon from a
// surface height given along its circumference, with its craters, boulders, ledges, spikes,
// girders, falling rocks and flags; the mammoth; and the moves' numbers. The game itself is in the
// world (src/core/moon.ts).
//   node scripts/moon.ts            writes scenarios/moon-1.json, moon-2.json, moon-test.json and moon-test-2.json
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
/**
 * The rifle and the hook (level 2; first values). As the player sees them: a 1 kg slug at 200 m/s,
 * eight a second, whose recoil takes 2 m/s off the mammoth; a rope cast at 75 m/s that reaches 14 m
 * and is reeled at 4 m/s.
 */
const TOOLS = {
  aim: 0.6,
  rifle: { speed: 400, mass: 1, radius: 0.15, every: 0.125, life: 1 },
  hook: { speed: 150, range: 14, reel: 8, stretch: 0.5, radius: 0.08, least: 1.5, retract: 120 },
  breakable: "block-",
};
/**
 * A block the rifle breaks: one slab 2 m thick, a tonne for each metre of its height, held where it
 * stands by its weight. Its material takes no damage from less than 30 kJ in a hit, which is more
 * than the mammoth delivers by rolling into it (half of 51 kJ); a shot delivers 40 kJ (half of its
 * 80 kJ), so three shots break it (DMG-002). One slab, not a stack: a fast shot arriving near the
 * join between two blocks has its blow shared between them, and neither then takes damage.
 */
const BLOCK = { thick: 2, mass: 1000, material: { name: "block", threshold: 30000, toughness: 20000 } };
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
  | { kind: "ledge"; at: number; length: number; height: number; tall?: boolean }
  /** A pit too wide to jump, spikes across its floor. */
  | { kind: "pit"; at: number; width: number; depth: number }
  /** A girder in the air, `above` the ground's level there (not a pit's floor): something for the hook. */
  | { kind: "beam"; at: number; length: number; above: number }
  /** A block the rifle breaks, `height` m high across the path, under a girder roof `roof` m long. */
  | { kind: "gate"; at: number; height: number; roof: number }
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
  /** The mammoth has its rifle and hook. */
  tools?: boolean;
}

function build(level: Level): Json {
  const R = level.radius;
  const C = 2 * Math.PI * R;
  const problems: string[] = [];

  /** The ground's level at s, over the base radius: its long waves, with nothing cut in or built on. */
  const level0 = (s: number): number => {
    let h = 0;
    for (const w of level.hills) h += w.height * Math.sin((2 * Math.PI * w.waves * s) / C + w.turn);
    return h;
  };
  /**
   * The ground's level, made flat under each gate (level for 4 m either side, easing back over the
   * next 4 m): a block standing on a slope creeps down it.
   */
  const levelled = (s: number): number => {
    let h = level0(s);
    for (const f of level.features) {
      if (f.kind !== "gate") continue;
      const d = Math.abs(s - f.at);
      if (d < 8) h += (level0(f.at) - h) * Math.min(1, (8 - d) / 4);
    }
    return h;
  };
  /** The surface's height over the base radius at s. */
  const height = (s: number): number => {
    let h = levelled(s);
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
      } else if (f.kind === "pit") {
        if (Math.abs(s - f.at) <= f.width / 2) h -= f.depth;
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
    else if (f.kind === "pit") [f.at - f.width / 2, f.at + f.width / 2].forEach(corner);
    else if (f.kind === "gate") for (let k = -8; k <= 8; k += 2) at.add(f.at + k);
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
    } else if (f.kind === "pit") {
      if (f.width < JUMP_LENGTH + 2) problems.push(`pit at ${f.at}: ${f.width} m could be jumped (a running jump clears ${JUMP_LENGTH.toFixed(1)} m)`);
      const n = Math.floor((f.width - 2.4) / SPIKE.width);
      for (let k = 0; k < n; k++) {
        const s = f.at + (k - (n - 1) / 2) * SPIKE.width;
        const vertices = [point(s - SPIKE.width / 2, -0.05), point(s + SPIKE.width / 2, -0.05), point(s, SPIKE.height)].map(round);
        bodies.push(fixed(`spike-${i}-${k}`, { kind: "polygon", vertices }, { x: 0, y: 0 }));
      }
    } else if (f.kind === "beam") {
      const u = up(f.at);
      const r = R + level0(f.at) + f.above;
      bodies.push(fixed(`girder-${i}`, { kind: "box", width: f.length, height: 0.5 }, { x: r * u.x, y: r * u.y }, -f.at / R));
    } else if (f.kind === "gate") {
      // The block stands on the ground, square to it; the roof just over it.
      const a = point(f.at - 1);
      const b = point(f.at + 1);
      const lie = Math.atan2(b.y - a.y, b.x - a.x);
      const u = up(f.at);
      const foot = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const high = f.height / 2 + 0.01;
      bodies.push({ id: `block-${i}`, mass: BLOCK.mass * f.height, restitution: 0, friction: 0.9, position: round({ x: foot.x + u.x * high, y: foot.y + u.y * high }), velocity: { x: 0, y: 0 }, angle: lie, angularVelocity: 0, shape: { kind: "box", width: BLOCK.thick, height: f.height }, material: BLOCK.material });
      const top = f.height + 0.4;
      bodies.push(fixed(`girder-${i}`, { kind: "box", width: f.roof, height: 0.5 }, { x: foot.x + u.x * top, y: foot.y + u.y * top }, lie));
    } else if (f.kind === "ledge") {
      if (!f.tall && f.height + 0.3 > JUMP_HEIGHT) problems.push(`ledge at ${f.at}: ${f.height} m is more than a jump reaches (${JUMP_HEIGHT.toFixed(1)} m)`);
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
      moon: { mammoth: "mammoth", centre: { x: 0, y: 0 }, ...MOVES, flags, spikes: "spike-", ...(rocks.length ? { rocks } : {}), view: { outline }, ...(level.tools ? { tools: TOOLS } : {}) },
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

/** The second test moon: small and smooth, with a gate, a pit under a beam and a cliff under a beam, and the tools (tests/core/moonTools.test.ts). */
const TEST_2: Level = {
  name: "moon-test-2",
  title: "Moon Mammoth: test moon 2",
  description: "A small smooth moon with a gate of blocks to shoot, a pit to swing across and a cliff to climb, for the tests of the mammoth's rifle and hook.",
  radius: 40,
  hills: [],
  tools: true,
  features: [
    { kind: "gate", at: 20, height: 4, roof: 8 },
    { kind: "pit", at: 60, width: 14, depth: 9 },
    { kind: "beam", at: 60, length: 4, above: 8 },
    { kind: "ledge", at: 100, length: 30, height: 7, tall: true },
    { kind: "beam", at: 102, length: 4, above: 11.5 },
  ],
  flags: [
    { at: 0, time: 0 },
    { at: 40, time: 30 },
    { at: 85, time: 30 },
    { at: 120, time: 30 },
  ],
};

/**
 * Level 2: the rifle and the hook. Gates of blocks to shoot through, pits to swing across from a
 * girder overhead, and cliffs to climb on the rope: each on its own first, then closer together.
 * The girder over a cliff reaches out past its edge, so the hook has a clear line to it from the
 * cliff's foot: aimed at one set back over the top, the hook strikes the cliff's face first.
 */
const LEVEL_2: Level = {
  name: "moon-2",
  title: "Moon Mammoth: level 2",
  description: "A lap with the rifle and the grappling hook: shoot through the gates of blocks, swing across the pits from the girders overhead, and climb the cliffs on the rope.",
  radius: 80,
  hills: [
    { waves: 2, height: 0.8, turn: 1.3 },
    { waves: 5, height: 0.4, turn: 0.2 },
  ],
  tools: true,
  features: [
    { kind: "gate", at: 30, height: 4, roof: 10 },
    { kind: "pit", at: 85, width: 14, depth: 9 },
    { kind: "beam", at: 85, length: 4, above: 8 },
    { kind: "ledge", at: 140, length: 40, height: 7, tall: true },
    { kind: "beam", at: 141, length: 8, above: 11.5 },
    { kind: "gate", at: 205, height: 4, roof: 10 },
    { kind: "pit", at: 255, width: 18, depth: 9 },
    { kind: "beam", at: 255, length: 8, above: 8 },
    { kind: "ledge", at: 310, length: 34, height: 8.5, tall: true },
    { kind: "beam", at: 311, length: 8, above: 12.4 },
    { kind: "gate", at: 328, height: 4, roof: 8 },
    { kind: "pit", at: 378, width: 14, depth: 9 },
    { kind: "beam", at: 378, length: 4, above: 8 },
    { kind: "gate", at: 408, height: 4, roof: 8 },
  ],
  flags: [
    { at: 0, time: 0 },
    { at: 55, time: 10 },
    { at: 115, time: 9 },
    { at: 165, time: 13 },
    { at: 225, time: 11 },
    { at: 290, time: 10 },
    { at: 358, time: 17 },
    { at: 440, time: 14 },
  ],
};

for (const level of [TEST, LEVEL_1, TEST_2, LEVEL_2]) {
  const file = join(root, "scenarios", `${level.name}.json`);
  writeFileSync(file, `${JSON.stringify(build(level))}\n`);
  console.log(`wrote ${file}`);
}
