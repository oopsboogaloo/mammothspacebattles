// Mammoth Asteroids' game (docs/games/mammoth-asteroids.md, MAS-070): levels of drifting rocks holding
// gold, a ship with a railgun, lives and a score. Like Lander's, the game lives in the world and runs
// inside the step, so a run and a replay agree. Everything it brings in or takes out (ships, rocks,
// gold collected, spent slugs) is recorded by the step as crossing the boundary.
//
// Ids: the player's ships are `p{n}-…` (n counts up with every new ship), a level's rocks are
// `a{level}-{k}` with pieces `a{level}-{k}-{i}`.
//
// Times in the spec are game seconds. The game runs at Lander's pace, one game second in two of the
// player's, and `pace` turns one into the other where the player's seconds matter (the clear bonus).

import { generateAsteroid } from "./asteroid.ts";
import { bodiesById } from "./bodies.ts";
import type { Material } from "./damage.ts";
import { shipState } from "./duel.ts";
import { removeBodies } from "./dust.ts";
import { assemblyOf } from "./joints.ts";
import { rotate, sinCos, type Vec2 } from "./math.ts";
import { createRng, nextFloat } from "./prng.ts";
import { massProps } from "./shapes.ts";
import type { BodyInput, JointInput, LinkInput, World } from "./world.ts";

export interface ArcadeSpec {
  /** The ship, laid out round the origin (its hull there), pointing up, with `{n}` in its ids (not its control channels). */
  ship: { bodies: BodyInput[]; joints?: JointInput[]; links?: LinkInput[] };
  /** The ship's hull and its railgun, with `{n}`. */
  hull: string;
  gun: string;
  /** Ships a game (default 3). */
  lives?: number;
  rocks: {
    radius: number;
    pieces: number;
    density: number;
    bond: number;
    material?: Material;
    /** Every piece pulls by its mass (AST-009). */
    gravity?: { G: number; core?: number; joined?: boolean };
    /** Gold pieces in each rock, and larger fragments: from, to. */
    gold: [number, number];
    compounds: [number, number];
    /** Drift speed, m/s: from, to. */
    speed: [number, number];
    /** The most a rock spins, either way, rad/s. */
    spin: number;
    /** The most rocks in a level (default 8): level N has N, up to this (MAS-020). */
    most?: number;
  };
  /**
   * Gunships (MAS-040…043): from level `fromLevel` one beams in `first` game seconds into the level
   * and another every `every` after, flown by a Hunting pilot whose combat skill is `skill.base` at
   * `fromLevel`, `perLevel` more each level, up to `max`. Past the level where the rocks stop
   * growing (`rocks.most`), each level changes the two times by `late.first` and `late.every` (down
   * to their least) and adds `late.skill` (up to `late.skillMax`).
   */
  gunship?: {
    /** The gunship, laid out round the origin (its hull there), pointing up, with `{n}` in its ids and channels; a pilot on one of its bodies. */
    template: { bodies: BodyInput[]; joints?: JointInput[]; links?: LinkInput[] };
    /** Its hull, with `{n}`. */
    hull: string;
    fromLevel: number;
    first: number;
    every: number;
    skill: { base: number; perLevel: number; max: number };
    /** The most flying at once (default 3): one that is due waits until another is out of the fight. */
    most?: number;
    late?: { first: number; firstMin: number; every: number; everyMin: number; skill: number; skillMax: number };
  };
  /**
   * How the player's controls drive the ship's engines (MAS-035): each row's `channel` is on when
   * any of its `any` holds, that is, every channel in its `on` is held and none in its `off`. The
   * demo's pilot sets the engines' channels itself, so the demo has no mixing.
   */
  mix?: { channel: string; any: { on: string[]; off?: string[] }[] }[];
  /** Game seconds between losing a ship and the next (default 1.25). */
  respawn?: number;
  /** Game seconds a new ship takes no damage after a loss (default 1). */
  grace?: number;
  /** Game seconds between the last gold and the next level (default 1.5). */
  clearPause?: number;
  /** Game seconds a railgun's slug lasts (default 0.7: at 200 m/s, less than the arena's height, so a slug can't come round and hit its own ship). */
  shellLife?: number;
  /** Game seconds in one of the player's (default 0.5). */
  pace?: number;
  /**
   * The title screen's game (MAS-060): every ship has a pilot in Clearing mode on its hull, flying
   * it through its own controls.
   */
  demo?: boolean;
  /** Lays out the levels: the same seed, the same levels. */
  seed: number;
}

/** Sets the engines' channels from the player's controls (the spec's `mix`), each step. */
export function arcadeMix(world: World): void {
  const spec = world.arcade?.spec;
  if (!spec?.mix || spec.demo) return;
  const held = (c: string) => (world.controls[c] ?? 0) > 0;
  let next: Record<string, number> | null = null;
  for (const row of spec.mix) {
    const value = row.any.some((r) => r.on.every(held) && !(r.off ?? []).some(held)) ? 1 : 0;
    if ((world.controls[row.channel] ?? 0) !== value) (next ??= { ...world.controls })[row.channel] = value;
  }
  if (next) world.controls = next;
}

export type ArcadePhase = "playing" | "clearing" | "waiting" | "over";

export interface ArcadeState {
  level: number;
  phase: ArcadePhase;
  /** Ships left, the one flying included. */
  lives: number;
  /** The ship flying, or the last one (1, 2, …): its parts are `p{n}-…`. */
  n: number;
  score: number;
  /** This level's gold: how many pieces, and those not yet collected. */
  gold: { total: number; left: string[] };
  /** When this level started, s. */
  levelStart: number;
  /** The ship is lost: the next comes when the wait ends (or with the next level). */
  lost: boolean;
  /** When the new ship's protection ends, s. */
  graceUntil?: number;
  /** When the wait (for a new ship, or the next level) ends, s. */
  next?: number;
  /** The last level's clear bonus, for the banner. */
  bonus?: number;
  /** Rings to draw where something beamed in: the step, the place and the size. */
  beams: { at: number; x: number; y: number; r: number }[];
  /** Slugs in flight: the step each was fired. */
  shells: Record<string, number>;
  /** Rock pieces a player's slug touched lately (their own rock's pieces with them): the step. */
  slugHits: Record<string, number>;
  /** When the next gunship is due, s (none this level if undefined). */
  nextGunship?: number;
  /** A gunship about to beam in: when, and where its ring is. */
  incoming?: { at: number; x: number; y: number };
  /** This level's gunships (`g{n}-…`), and whether each is out of the fight. */
  gunships: { n: number; hull: string; out: boolean }[];
  /** Gunships so far this game: numbers the next. */
  gunshipCount: number;
  /** For the game-over screen. */
  stats: { gold: number; welds: number; shots: number; gunships: number };
}

export interface ArcadeGame {
  spec: ArcadeSpec;
  state: ArcadeState;
}

/** How the game adds to the world: the world's own ways, handed in by the step. */
export interface ArcadeOps {
  addBody(world: World, body: BodyInput): void;
  addJoint(world: World, joint: JointInput): void;
  addLink(world: World, link: LinkInput): void;
}

export const ARCADE_DEFAULTS = { lives: 3, respawn: 1.25, grace: 1, clearPause: 1.5, shellLife: 0.7, pace: 0.5, most: 8 };

export const ARCADE_SCORES = { gold: 500, weld: 10, gunship: 1000 };
/** A gunship's ring shows this long before it beams in, game s; and it comes in at least this far from the player, m. */
const GUNSHIP_WARNING = 0.5;
const GUNSHIP_CLEAR = 70;
/** The most gunships flying at once, unless the scenario says. */
export const GUNSHIPS_AT_ONCE = 3;
/** A weld that breaks within this long of a player's slug touching its rock scores, game s. */
const SLUG_CREDIT = 0.25;
/** A rock keeps this far from the ship, and from the next rock's edge, when a level is laid out, m. */
const SHIP_CLEAR = 50;
const ROCK_GAP = 8;
/** How long a beam ring shows, game s. */
const BEAM = 0.5;
/** A new ship looks this far ahead for a clear spot, game s. */
const LOOK_AHEAD = 3;
/** Clear enough for a new ship, m: among spots at least this clear, the one nearest the centre wins. */
const CLEAR_ENOUGH = 40;
/** Touching: a contact pushing, or closer than this, m. */
const TOUCH = 0.05;

const ROCK_PIECE = /^a\d+-\d+-\d+$/;
const PLAYER_SLUG = /^p\d+-.*-shell-\d+$/;

const withN = <T>(x: T, n: number): T => JSON.parse(JSON.stringify(x).replaceAll("{n}", String(n))) as T;

/** From a to b the short way round a world that wraps. */
function offset(world: World, a: Vec2, b: Vec2): Vec2 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (world.bounds.wrap) {
    const w = world.bounds.max.x - world.bounds.min.x;
    const h = world.bounds.max.y - world.bounds.min.y;
    dx -= w * Math.round(dx / w);
    dy -= h * Math.round(dy / h);
  }
  return { x: dx, y: dy };
}

const centre = (world: World): Vec2 => ({ x: (world.bounds.min.x + world.bounds.max.x) / 2, y: (world.bounds.min.y + world.bounds.max.y) / 2 });

/** Takes bodies out of the world with the welds, links and contacts on them: no dust, no event. */
function takeOut(world: World, ids: Set<string>): void {
  if (!ids.size) return;
  for (const b of world.bodies) if (ids.has(b.id) && b.pilot) for (const ch of Object.keys(b.pilot.command)) world.controls[ch] = 0;
  world.bodies = world.bodies.filter((b) => !ids.has(b.id));
  world.joints = world.joints.filter((j) => !ids.has(j.a) && !ids.has(j.b));
  world.links = world.links.filter((l) => !ids.has(l.to) && (l.kind !== "feed" || !ids.has(l.from)));
  world.drags = world.drags.filter((d) => !ids.has(d.id));
  world.contacts = world.contacts.filter((c) => !ids.has(c.a) && !ids.has(c.b));
}

interface Pose {
  position: Vec2;
  angle: number;
  velocity: Vec2;
  angularVelocity: number;
}

/**
 * Adds ship number `state.n`: the template turned to the pose's angle about its hull, moving as one
 * rigid body. With `grace`, its parts carry no material for that long, so nothing damages them
 * (their welds still break under load).
 */
function addShip(world: World, game: ArcadeGame, ops: ArcadeOps, pose: Pose, grace: number): void {
  const { spec, state } = game;
  const t = withN(spec.ship, state.n);
  const q = sinCos(pose.angle);
  const w = pose.angularVelocity;
  for (const b of t.bodies) {
    const r = rotate(q, b.position);
    const body: BodyInput = {
      ...b,
      position: { x: pose.position.x + r.x, y: pose.position.y + r.y },
      angle: (b.angle ?? 0) + pose.angle,
      velocity: { x: pose.velocity.x - w * r.y, y: pose.velocity.y + w * r.x },
      angularVelocity: w,
    };
    if (grace > 0) delete body.material;
    // The demo's ship flies itself (AIP-020).
    if (spec.demo && body.id === withN(spec.hull, state.n)) body.pilot = { mode: "clearing", goal: { kind: "idle" }, side: "player", skill: { flight: 0.8, combat: 0.8 } };
    ops.addBody(world, body);
  }
  for (const j of t.joints ?? []) ops.addJoint(world, j);
  for (const l of t.links ?? []) ops.addLink(world, l);
  state.lost = false;
  state.graceUntil = grace > 0 ? world.time + grace : undefined;
  state.beams.push({ at: world.tick, x: pose.position.x, y: pose.position.y, r: 4 });
  world.events.push({ tick: world.tick, type: "arcade.ship", data: { n: state.n, x: pose.position.x, y: pose.position.y, protected: grace > 0 } });
}

/** The ship's protection is over: its parts get their materials back. */
function endGrace(world: World, game: ArcadeGame): void {
  const { spec, state } = game;
  const materials = new Map(withN(spec.ship, state.n).bodies.map((b) => [b.id, b.material]));
  for (const b of world.bodies) {
    const m = materials.get(b.id);
    if (m && !b.material) b.material = structuredClone(m);
  }
  state.graceUntil = undefined;
}

/**
 * Lays out the level's rocks (MAS-020): min(level, most) of them, at random from the level's own
 * seed, clear of the ship and each other the short way round, each drifting and turning, with its
 * gold. If the arena is too full for the clearances, they shrink until the rocks fit.
 */
function layout(world: World, game: ArcadeGame, ops: ArcadeOps, shipAt: Vec2): void {
  const { spec, state } = game;
  const rk = spec.rocks;
  const rng = createRng(spec.seed * 1000 + state.level);
  const count = Math.max(1, Math.min(state.level, rk.most ?? ARCADE_DEFAULTS.most));
  const W = world.bounds.max.x - world.bounds.min.x;
  const H = world.bounds.max.y - world.bounds.min.y;
  const between = (lo: number, hi: number) => lo + (hi - lo) * nextFloat(rng);
  const whole = (lo: number, hi: number) => Math.min(hi, lo + Math.floor(nextFloat(rng) * (hi - lo + 1)));
  const far = (p: Vec2, q: Vec2, d: number) => {
    const o = offset(world, p, q);
    return o.x * o.x + o.y * o.y >= d * d;
  };
  let fromShip = SHIP_CLEAR;
  let apart = 2 * rk.radius + ROCK_GAP;
  const placed: Vec2[] = [];
  const gold: string[] = [];
  for (let k = 0; k < count; k++) {
    let at: Vec2;
    for (let tries = 1; ; tries++) {
      at = { x: world.bounds.min.x + nextFloat(rng) * W, y: world.bounds.min.y + nextFloat(rng) * H };
      const here = at;
      if (far(here, shipAt, fromShip) && placed.every((q) => far(here, q, apart))) break;
      if (tries % 40 === 0) {
        fromShip *= 0.9;
        apart *= 0.95;
      }
    }
    placed.push(at);
    const heading = sinCos(between(0, 2 * Math.PI));
    const speed = between(rk.speed[0], rk.speed[1]);
    const rock = generateAsteroid({
      id: `a${state.level}-${k}`,
      seed: Math.floor(nextFloat(rng) * 2 ** 31),
      pieces: rk.pieces,
      radius: rk.radius,
      density: rk.density,
      bond: rk.bond,
      ...(rk.material ? { material: rk.material } : {}),
      ...(rk.gravity ? { gravity: rk.gravity } : {}),
      gold: whole(rk.gold[0], rk.gold[1]),
      compounds: whole(rk.compounds[0], rk.compounds[1]),
      goldIndestructible: true,
      position: at,
      velocity: { x: speed * heading.c, y: speed * heading.s },
      angle: between(0, 2 * Math.PI),
      angularVelocity: between(-rk.spin, rk.spin),
    });
    for (const b of rock.bodies) {
      ops.addBody(world, b);
      if (b.mineral === "gold") gold.push(b.id);
    }
    for (const j of rock.joints) ops.addJoint(world, j);
    state.beams.push({ at: world.tick, x: at.x, y: at.y, r: rk.radius });
  }
  state.gold = { total: gold.length, left: gold.sort() };
  state.levelStart = world.time;
  // The level's gunships: none yet, the first due when the level's plan says.
  const plan = gunshipPlan(spec, state.level);
  state.gunships = [];
  state.incoming = undefined;
  state.nextGunship = plan ? world.time + plan.first : undefined;
  world.events.push({ tick: world.tick, type: "arcade.level", data: { level: state.level, rocks: count, gold: gold.length } });
}

/** When a level's gunships come, and how well they fight (MAS-040, MAS-041, MAS-043); null if it has none. */
export function gunshipPlan(spec: ArcadeSpec, level: number): { first: number; every: number; skill: number } | null {
  const g = spec.gunship;
  if (!g || level < g.fromLevel) return null;
  const most = spec.rocks.most ?? ARCADE_DEFAULTS.most;
  const extra = g.late ? Math.max(0, level - most) : 0;
  const skill = Math.min(g.skill.max, g.skill.base + g.skill.perLevel * (level - g.fromLevel));
  if (!g.late || extra === 0) return { first: g.first, every: g.every, skill };
  return {
    first: Math.max(g.late.firstMin, g.first + g.late.first * extra),
    every: Math.max(g.late.everyMin, g.every + g.late.every * extra),
    skill: Math.min(g.late.skillMax, skill + g.late.skill * extra),
  };
}

/** How clear a point stays over the next few seconds: its least distance to any free body's edge, each taken to drift in a straight line, m. */
function clearance(world: World, p: Vec2, free: { b: World["bodies"][number]; reach: number }[]): number {
  let worst = Infinity;
  for (const { b, reach } of free) {
    const r = offset(world, p, b.position);
    const v = b.velocity;
    const vv = v.x * v.x + v.y * v.y;
    const t = vv > 1e-12 ? Math.min(LOOK_AHEAD, Math.max(0, -(r.x * v.x + r.y * v.y) / vv)) : 0;
    const cx = r.x + v.x * t;
    const cy = r.y + v.y * t;
    const d = Math.sqrt(cx * cx + cy * cy) - reach;
    if (d < worst) worst = d;
  }
  return worst;
}

/**
 * Where a gunship beams in (MAS-040): of a 9 × 5 grid over the whole arena, a point at least 70 m
 * from the player the short way round whose clearance over the next few seconds is greatest
 * (clearances past 40 m count the same); the furthest from the player wins a tie.
 */
export function gunshipSpot(world: World, player: Vec2): Vec2 {
  const W = world.bounds.max.x - world.bounds.min.x;
  const H = world.bounds.max.y - world.bounds.min.y;
  const free = world.bodies.filter((b) => !b.fixed).map((b) => ({ b, reach: massProps(b.shape, 1).boundingRadius }));
  let best: Vec2 | null = null;
  let bestScore = -Infinity;
  let bestFar = -Infinity;
  for (const least of [GUNSHIP_CLEAR, 0]) {
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 5; j++) {
        const p = { x: world.bounds.min.x + ((i + 0.5) * W) / 9, y: world.bounds.min.y + ((j + 0.5) * H) / 5 };
        const o = offset(world, player, p);
        const far = Math.sqrt(o.x * o.x + o.y * o.y);
        if (far < least) continue;
        const score = Math.min(clearance(world, p, free), CLEAR_ENOUGH);
        if (score > bestScore || (score === bestScore && far > bestFar)) {
          best = p;
          bestScore = score;
          bestFar = far;
        }
      }
    if (best) break;
  }
  return best ?? centre(world);
}

/** Beams gunship number `state.gunshipCount + 1` in at a spot, at rest, pointing up, its pilot's combat skill the level's. */
function addGunship(world: World, game: ArcadeGame, ops: ArcadeOps, at: Vec2, skill: number): void {
  const { spec, state } = game;
  const g = spec.gunship!;
  const n = (state.gunshipCount += 1);
  const t = withN(g.template, n);
  for (const b of t.bodies) {
    const body: BodyInput = { ...b, position: { x: at.x + b.position.x, y: at.y + b.position.y }, velocity: { x: 0, y: 0 }, angularVelocity: 0 };
    if (body.pilot) body.pilot = { ...body.pilot, skill: { ...body.pilot.skill, combat: skill } };
    ops.addBody(world, body);
  }
  for (const j of t.joints ?? []) ops.addJoint(world, j);
  for (const l of t.links ?? []) ops.addLink(world, l);
  state.gunships.push({ n, hull: withN(g.hull, n), out: false });
  world.events.push({ tick: world.tick, type: "arcade.gunship", data: { n, x: at.x, y: at.y, skill } });
}

/**
 * The clearest spot for a new ship: of a 7 × 5 grid over the middle of the arena, the point whose
 * worst clearance over the next few seconds is greatest, taking every free body to drift in a
 * straight line. Clearances past 40 m count the same, and nearer the centre wins a tie, so the ship
 * comes back at the centre whenever the centre is safe.
 */
export function clearestSpot(world: World): Vec2 {
  const c = centre(world);
  const W = world.bounds.max.x - world.bounds.min.x;
  const H = world.bounds.max.y - world.bounds.min.y;
  const points: Vec2[] = [];
  for (let i = -3; i <= 3; i++) for (let j = -2; j <= 2; j++) points.push({ x: c.x + (i * 0.3 * W) / 3, y: c.y + (j * 0.3 * H) / 2 });
  points.sort((p, q) => (p.x - c.x) ** 2 + (p.y - c.y) ** 2 - ((q.x - c.x) ** 2 + (q.y - c.y) ** 2) || p.x - q.x || p.y - q.y);
  const free = world.bodies.filter((b) => !b.fixed).map((b) => ({ b, reach: massProps(b.shape, 1).boundingRadius }));
  let best = points[0];
  let bestScore = -Infinity;
  for (const p of points) {
    const score = Math.min(clearance(world, p, free), CLEAR_ENOUGH);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

/** A new game: ship 1 at the centre, pointing up, and level 1 round it. */
export function startArcade(world: World, spec: ArcadeSpec, ops: ArcadeOps): ArcadeGame {
  const game: ArcadeGame = {
    spec: structuredClone(spec),
    state: {
      level: 1,
      phase: "playing",
      lives: spec.lives ?? ARCADE_DEFAULTS.lives,
      n: 1,
      score: 0,
      gold: { total: 0, left: [] },
      levelStart: world.time,
      lost: false,
      beams: [],
      shells: {},
      slugHits: {},
      gunships: [],
      gunshipCount: 0,
      stats: { gold: 0, welds: 0, shots: 0, gunships: 0 },
    },
  };
  const at = centre(world);
  addShip(world, game, ops, { position: at, angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 }, 0);
  layout(world, game, ops, at);
  return game;
}

/**
 * Runs the game for one step, inside the step: slugs that have had their time, the score for welds
 * and gold, a lost ship, the wait and the next ship, a cleared level and the next one. Returns
 * whether it added or removed anything (for the ledger).
 */
export function runArcade(world: World, dt: number, ops: ArcadeOps): boolean {
  const game = world.arcade;
  if (!game) return false;
  const { spec, state: s } = game;
  const o = { ...ARCADE_DEFAULTS, ...spec };
  const now = world.time;
  const ticks = (seconds: number) => Math.round(seconds / dt);
  const due = (at: number | undefined) => at !== undefined && now >= at - 1e-9;
  let changed = false;

  if (s.beams.length) s.beams = s.beams.filter((b) => world.tick - b.at < ticks(BEAM));
  // This step's events: they are in order, so the last few.
  const recent: World["events"] = [];
  for (let i = world.events.length - 1; i >= 0 && world.events[i].tick >= world.tick; i--) if (world.events[i].tick === world.tick) recent.push(world.events[i]);
  recent.reverse();

  // 1. Slugs: the new ones are noted, and those that have had their time go.
  const hullId = withN(spec.hull, s.n);
  const gunId = withN(spec.gun, s.n);
  for (const e of recent) {
    if (e.type !== "railgun.fired") continue;
    s.shells[String(e.data.shell)] = world.tick;
    if (e.data.id === gunId) s.stats.shots += 1;
  }
  const byId = bodiesById(world);
  const spent = new Set<string>();
  for (const id of Object.keys(s.shells)) {
    if (!byId.has(id)) delete s.shells[id];
    else if (world.tick - s.shells[id] >= ticks(o.shellLife)) {
      spent.add(id);
      delete s.shells[id];
    }
  }
  if (spent.size) {
    takeOut(world, spent);
    changed = true;
  }

  // 2. Welds broken by the player's slugs: a slug's first touch on a rock marks that rock's pieces.
  const credit = ticks(SLUG_CREDIT);
  for (const id of Object.keys(s.slugHits)) if (world.tick - s.slugHits[id] > credit) delete s.slugHits[id];
  for (const e of recent) {
    if (e.type !== "collision") continue;
    const a = String(e.data.a);
    const b = String(e.data.b);
    const piece = PLAYER_SLUG.test(a) && ROCK_PIECE.test(b) ? b : PLAYER_SLUG.test(b) && ROCK_PIECE.test(a) ? a : null;
    if (!piece) continue;
    // The whole rock the piece came from, by its name: the shell's blast may have destroyed the
    // piece it struck, and broken welds between its neighbours, in this same step.
    const rock = piece.slice(0, piece.lastIndexOf("-") + 1);
    for (const x of world.bodies) if (x.id.startsWith(rock) && ROCK_PIECE.test(x.id)) s.slugHits[x.id] = world.tick;
    s.slugHits[piece] = world.tick;
  }
  for (const e of recent) {
    if (e.type !== "joint.break") continue;
    const a = String(e.data.a);
    const b = String(e.data.b);
    if (!ROCK_PIECE.test(a) || !ROCK_PIECE.test(b) || (s.slugHits[a] === undefined && s.slugHits[b] === undefined)) continue;
    s.score += ARCADE_SCORES.weld;
    s.stats.welds += 1;
  }

  if (s.phase === "over") return changed;

  // 3. Gold the ship is touching, if it can be seen (not inside a larger fragment whose seams don't show).
  if (!s.lost && s.gold.left.length && world.bodies.some((b) => b.id === hullId)) {
    const ship = new Set(assemblyOf(world, hullId));
    const left = new Set(s.gold.left);
    const got = new Set<string>();
    for (const c of world.contacts) {
      if (!(c.normalImpulse > 0 || c.separation <= TOUCH)) continue;
      const id = ship.has(c.a) && left.has(c.b) ? c.b : ship.has(c.b) && left.has(c.a) ? c.a : null;
      if (id && !world.bodies.find((b) => b.id === id)?.compound) got.add(id);
    }
    if (got.size) {
      removeBodies(world, got, "arcade.gold");
      s.gold.left = s.gold.left.filter((id) => !got.has(id));
      s.score += ARCADE_SCORES.gold * got.size;
      s.stats.gold += got.size;
      changed = true;
    }
  }

  // 4. The ship is lost when its hull is gone, or no working engine is still welded to it (the duel's rule).
  if (!s.lost && (s.phase === "playing" || s.phase === "clearing") && !shipState(world, hullId).flies) {
    s.lost = true;
    s.lives -= 1;
    // The keys fly only the next ship: the wreck and what broke off it lose their control links.
    const prefix = `p${s.n}-`;
    world.links = world.links.filter((l) => !(l.kind === "control" && l.to.startsWith(prefix)));
    // The demo's pilot goes with its ship.
    for (const b of world.bodies) if (b.pilot && b.id.startsWith(prefix)) delete b.pilot;
    world.events.push({ tick: world.tick, type: "arcade.lost", data: { n: s.n, lives: s.lives } });
    if (s.phase === "playing") {
      s.phase = "waiting";
      s.next = now + o.respawn;
    }
  }

  // 5. A gunship out of the fight (the same rule) scores once; its pilot lets go and its wreck stays.
  for (const g of s.gunships) {
    if (g.out || shipState(world, g.hull).flies) continue;
    g.out = true;
    s.score += ARCADE_SCORES.gunship;
    s.stats.gunships += 1;
    const prefix = `g${g.n}-`;
    for (const b of world.bodies) {
      if (!b.id.startsWith(prefix) || !b.pilot) continue;
      for (const ch of Object.keys(b.pilot.command)) world.controls[ch] = 0;
      delete b.pilot;
    }
    world.links = world.links.filter((l) => !(l.kind === "control" && l.to.startsWith(prefix)));
    world.events.push({ tick: world.tick, type: "arcade.gunship.out", data: { n: g.n } });
  }

  // 6. Protection over.
  if (due(s.graceUntil)) endGrace(world, game);

  // 9. Gunships: a ring where the next will come, then the gunship.
  if (spec.gunship && (s.phase === "playing" || s.phase === "waiting")) {
    const plan = gunshipPlan(spec, s.level);
    if (s.incoming && due(s.incoming.at)) {
      const at = { x: s.incoming.x, y: s.incoming.y };
      s.incoming = undefined;
      if (plan) addGunship(world, game, ops, at, plan.skill);
      changed = true;
    } else if (plan && !s.incoming && due(s.nextGunship) && s.gunships.filter((g) => !g.out).length < (spec.gunship.most ?? GUNSHIPS_AT_ONCE)) {
      // No more than `most` fly at once: one that is due waits here until another is out.
      const hull = world.bodies.find((b) => b.id === hullId);
      const at = gunshipSpot(world, hull ? hull.position : centre(world));
      s.incoming = { at: now + GUNSHIP_WARNING, x: at.x, y: at.y };
      s.beams.push({ at: world.tick, x: at.x, y: at.y, r: 6 });
      // The next is `every` after this one was due; after this one came, if it had to wait.
      const due0 = s.nextGunship ?? now;
      s.nextGunship = (now - due0 > 2 * dt ? now : due0) + plan.every;
    }
  }

  // 7. The last gold collected: the bonus, a pause, then the next level.
  if ((s.phase === "playing" || s.phase === "waiting") && s.gold.total > 0 && !s.gold.left.length) {
    const seconds = (now - s.levelStart) / o.pace;
    s.bonus = 1000 * s.level + 10 * Math.max(0, Math.floor(120 - seconds));
    s.score += s.bonus;
    s.phase = "clearing";
    s.next = now + o.clearPause;
    world.events.push({ tick: world.tick, type: "arcade.clear", data: { level: s.level, bonus: s.bonus, seconds } });
  } else if (s.phase === "clearing" && due(s.next)) {
    if (s.lost && s.lives <= 0) {
      s.phase = "over";
      s.next = undefined;
      world.events.push({ tick: world.tick, type: "arcade.over", data: { score: s.score, level: s.level } });
      return changed;
    }
    // Everything beams out: rocks, debris, slugs, the wreck, and the ship, which comes back fresh
    // where it was and moving as it was (or, if it was lost, at the centre of the empty arena).
    const hull = world.bodies.find((b) => b.id === hullId);
    const pose: Pose =
      !s.lost && hull ? { position: { ...hull.position }, angle: hull.angle, velocity: { ...hull.velocity }, angularVelocity: hull.angularVelocity } : { position: centre(world), angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 };
    const protect = s.lost ? o.grace : 0;
    takeOut(world, new Set(world.bodies.filter((b) => !b.fixed).map((b) => b.id)));
    s.shells = {};
    s.slugHits = {};
    s.n += 1;
    s.level += 1;
    s.phase = "playing";
    s.next = undefined;
    addShip(world, game, ops, pose, protect);
    layout(world, game, ops, pose.position);
    changed = true;
  } else if (s.phase === "waiting" && due(s.next)) {
    // 8. The wait after a loss is over: the game, or the next ship at the clearest spot.
    s.next = undefined;
    if (s.lives <= 0) {
      s.phase = "over";
      world.events.push({ tick: world.tick, type: "arcade.over", data: { score: s.score, level: s.level } });
      return changed;
    }
    s.n += 1;
    s.phase = "playing";
    addShip(world, game, ops, { position: clearestSpot(world), angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 }, o.grace);
    changed = true;
  }
  return changed;
}
