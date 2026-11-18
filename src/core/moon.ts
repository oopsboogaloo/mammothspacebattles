// Moon Mammoth's game (docs/games/moon-mammoth.md, -design.md §3): a round mammoth, one disc in the
// world, runs round the outside of a small moon against the clock. Like the other games', it lives
// in the world and runs inside the step, so a run and a replay agree.
//
// Two parts. The drive, before the contact solve, is the mammoth's own moves: it reads the player's
// channels and sets the disc's velocity (run, jump, roll, duck and slide). The step books what that
// changes under `power`. The judge, after the step, keeps the clocks and the flags, and puts the
// mammoth back at the last flag when it fails; the step books that under `boundary`.
//
// Gravity, every contact, landing, and whether the mammoth fits under something are the shared
// physics'. Times and speeds in the spec are the game's (the page runs it at one in two of the player's).

import { collideDisc } from "./collide.ts";
import { add, dot, length, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { burst } from "./dust.ts";
import { castRope, releaseRope, type Rope, type RopeSpec } from "./rope.ts";
import { boundingRadiusOf } from "./shapes.ts";
import type { Body, BodyInput, World } from "./world.ts";

export interface MoonSpec {
  /** The mammoth: a disc of the scenario. */
  mammoth: string;
  /** The moon's centre: "up" is away from it. */
  centre: Vec2;
  /** The disc's radius standing, and ducked or sliding, m. */
  size: { stand: number; duck: number };
  /** Running: the top speed, how fast it is reached and lost on the ground, and how fast it steers in the air, m/s and m/s². */
  run: { speed: number; accel: number; brake: number; air: number };
  /**
   * Jumping: the speed it leaves the ground at; the share of its rise kept when the button is let
   * go; how long before landing a press still counts, and how long after leaving an edge, s.
   */
  jump: { speed: number; cut: number; early: number; late: number };
  /**
   * Rolling: a burst at `speed` for `time`, and the wait after it before the next, s. It comes up
   * to that speed at `accel` m/s² (default 600): hard, but not with endless force, so a roll into
   * something heavy stops against it and doesn't shove it along.
   */
  roll: { speed: number; time: number; wait: number; accel?: number };
  /** Ducked: a slide slows at `brake`; under `least` m/s it is a sit; with a direction held it creeps at `crawl`. */
  slide: { brake: number; least: number; crawl: number };
  /** The steepest ground it stands on: the cosine of its angle from level (0.5 is 60°). */
  slope: number;
  /** The flags, in order: where the mammoth's centre is standing at each, and the time for the leg that ends there (the first's isn't used). */
  flags: { at: Vec2; time: number }[];
  /** How near a flag counts as reaching it, m. */
  reach: number;
  /** The spikes' bodies' ids start with this. */
  spikes: string;
  /** Rocks that fall: fixed bodies of the scenario, each let go (a free body of `mass`) when the mammoth first comes within `within` m of it. */
  rocks?: { id: string; within: number; mass: number }[];
  /** How the page draws the moon: its outline. */
  view?: { outline: Vec2[] };
  /**
   * The mammoth's rifle and grappling hook (MMN-100…MMN-125), both aimed the same way. Absent: it has neither.
   * `aim`: where it points before the player has aimed, rad above the way the mammoth faces.
   * `rifle`: each shot is a disc of `mass` kg and `radius` m leaving at `speed` m/s, one every
   * `every` s while fire is held, gone after `life` s or when it hits something. The mammoth
   * recoils with the shot's momentum.
   * `hook`: the rope it casts (rope.ts), and how fast it is reeled in and paid out, m/s.
   * `breakable`: what the rifle is for, by id prefix (for the page's drawing: the engine's damage decides what breaks).
   */
  tools?: {
    aim: number;
    rifle: { speed: number; mass: number; radius: number; every: number; life: number };
    hook: RopeSpec & { reel: number };
    breakable?: string;
  };
}

/** The mammoth's rope's id, and what its shots' ids start with. */
export const MOON_ROPE = "hook";
export const MOON_SHOT = "shot-";

export type MoonAction = "idle" | "walk" | "turn" | "jump" | "fall" | "roll" | "sit" | "slide";

export interface MoonState {
  /** Waiting for the first move (the clocks stopped), running, or finished. */
  phase: "waiting" | "running" | "won";
  /** The last flag reached. */
  flag: number;
  /** What is left of the leg's time, and the run's whole time so far, s. */
  left: number;
  elapsed: number;
  /** Times sent back to a flag. */
  tries: number;
  /** The way it faces: 1 is to the right (clockwise round the moon). */
  facing: 1 | -1;
  /** What it is doing, and since when, s: the page picks the drawing from these. */
  action: MoonAction;
  since: number;
  grounded: boolean;
  ducked: boolean;
  /** When it was last on the ground, when a jump was last asked for, and when it last turned, s. */
  lastGround: number;
  jumpAsked: number;
  turnedAt: number;
  /** The jump button as it was last step; in a jump; and that jump already cut short. */
  jumpHeld: boolean;
  jumping: boolean;
  cut: boolean;
  /** The roll button as it was last step; when the roll ends, and when the next may start, s. */
  rollHeld: boolean;
  rollUntil: number;
  rollReady: number;
  /** Its velocity as its moves left it last step, and the way along the ground then: what a join in the rock took is given back. */
  drove?: { v: Vec2; t: Vec2; n: Vec2 };
  /** The last time it was sent back, and why: for the page's note. */
  back?: { at: number; why: "time" | "spikes" | "rock" };
  /** The rocks let go since the last flag or send-back, and where each rock began. */
  loose: string[];
  rocks: Record<string, { position: Vec2; angle: number; mass: number }>;
  /** Where its tools point, rad from its right toward its up, once the player has aimed (MMN-100). */
  aim?: number;
  /** The hook button as it was last step; shots fired so far (names the next); when the last was; and the shots in flight, with when each left. */
  hookHeld?: boolean;
  shots?: number;
  shotAt?: number;
  flying?: { id: string; at: number }[];
}

export interface MoonGame {
  spec: MoonSpec;
  state: MoonState;
}

export interface MoonOps {
  addBody(world: World, body: BodyInput): void;
}

/** The channels the player's controls set. */
export const MOON_CHANNELS = ["left", "right", "jump", "duck", "roll", "up", "fire", "hook"] as const;

/** The mammoth's up at a point, and its right: the frame its aim is in. */
function frameAt(spec: MoonSpec, p: Vec2): { up: Vec2; right: Vec2 } {
  const up = upAt(spec, p);
  return { up, right: { x: up.y, y: -up.x } };
}

/**
 * Where the mammoth's tools point (MMN-100): the angle the player last set (the `aim` channel, rad
 * from the mammoth's right toward its up), or before any, a little above the way it faces. As a
 * unit vector in the world, with the angle.
 */
export function moonAim(world: World): { angle: number; dir: Vec2; from: Vec2 } | null {
  const game = world.moon;
  const tools = game?.spec.tools;
  const m = game && mammothOf(world, game.spec);
  if (!game || !tools || !m) return null;
  const s = game.state;
  const angle = s.aim ?? (s.facing > 0 ? tools.aim : Math.PI - tools.aim);
  const q = sinCos(angle);
  const f = frameAt(game.spec, m.position);
  return { angle, dir: { x: f.right.x * q.c + f.up.x * q.s, y: f.right.y * q.c + f.up.y * q.s }, from: m.position };
}

/** The mammoth's rope, if it has one out. */
export const moonRope = (world: World): Rope | undefined => (world.moon?.spec.tools ? world.ropes?.find((r) => r.id === MOON_ROPE && r.holder === world.moon!.spec.mammoth) : undefined);

/** Long ago: before any time in a game (a plain number, so the state stays plain data). */
const NEVER = -1e9;
/** A contact this close counts as touching, m. */
const TOUCH = 0.03;
/**
 * Ground this near under the mammoth is ground it is on, m. A disc at a run is knocked up a
 * centimetre or two where two pieces of rock meet, and the solver stops a body that is about to land
 * a step short of the surface (a speculative contact, finished in one step): neither is being in the air.
 */
const NEAR = 0.25;
/** A knock from a join in the rock: at least this much up, m/s, and no more than this share of its speed back (and 1 m/s at least). */
const KNOCK = { up: 0.3, back: 0.07 };
/** How hard a roll comes up to its speed, m/s², where the level doesn't say. */
const ROLL_ACCEL = 600;
/** How long a turn is shown, s. */
const TURN = 0.1;
/** Off the ground for less than this is still shown as on it (a bump at a run), s. */
const HOP = 0.04;
/** A loose rock falling faster than this hurts, m/s. */
const ROCK_HURTS = 4;
/** A fallen rock slower than this, on something fixed, has come to rest, m/s. */
const ROCK_RESTS = 1.5;
/** A standing disc may overlap what it stands up into by this much, m: the ground it rests on is that deep in already. */
const ROOM = 0.04;

const approach = (v: number, to: number, by: number): number => (v < to ? Math.min(to, v + by) : Math.max(to, v - by));
const mammothOf = (world: World, spec: MoonSpec): Body | undefined => world.bodies.find((b) => b.id === spec.mammoth);
const upAt = (spec: MoonSpec, p: Vec2): Vec2 => {
  const d = sub(p, spec.centre);
  const n = length(d);
  return n > 0 ? scale(d, 1 / n) : { x: 0, y: 1 };
};

export function startMoon(world: World, spec: MoonSpec): MoonGame {
  const rocks: MoonState["rocks"] = {};
  for (const r of spec.rocks ?? []) {
    const b = world.bodies.find((x) => x.id === r.id);
    if (b) rocks[r.id] = { position: { ...b.position }, angle: b.angle, mass: b.mass };
  }
  return {
    spec: structuredClone(spec),
    state: {
      phase: "waiting",
      flag: 0,
      left: spec.flags[1]?.time ?? 0,
      elapsed: 0,
      tries: 0,
      facing: 1,
      action: "idle",
      since: 0,
      grounded: false,
      ducked: false,
      lastGround: NEVER,
      jumpAsked: NEVER,
      turnedAt: NEVER,
      jumpHeld: false,
      jumping: false,
      cut: false,
      rollHeld: false,
      rollUntil: NEVER,
      rollReady: NEVER,
      loose: [],
      rocks,
    },
  };
}

/** The ground under the mammoth, from last step's contacts: the normal of the one nearest to straight up and its gap then, or null in the air. */
function groundUnder(world: World, id: string, up: Vec2, slope: number): { n: Vec2; gap: number } | null {
  let best: { n: Vec2; gap: number } | null = null;
  let most = slope;
  for (const c of world.contacts) {
    if (c.separation > NEAR * (world.units?.length ?? 1)) continue;
    // The contact's normal runs from a to b: turned to point from the other body into the mammoth.
    const n = c.b === id ? c.normal : c.a === id ? scale(c.normal, -1) : null;
    if (!n) continue;
    const k = dot(n, up);
    if (k >= most) {
      most = k;
      best = { n, gap: c.separation };
    }
  }
  return best;
}

/** Whether a disc of radius r at p overlaps anything but the mammoth itself. */
function blocked(world: World, self: string, p: Vec2, r: number): boolean {
  const disc = { shape: { kind: "disc" as const, radius: r }, position: p, rot: { c: 1, s: 0 } };
  for (const b of world.bodies) {
    if (b.id === self) continue;
    const reach = boundingRadiusOf(b.shape) + r;
    const dx = b.position.x - p.x;
    const dy = b.position.y - p.y;
    if (dx * dx + dy * dy > reach * reach) continue;
    const m = collideDisc(disc, { shape: b.shape, position: b.position, rot: sinCos(b.angle) }, 0);
    if (m?.points.some((q) => q.separation < -ROOM * (world.units?.length ?? 1))) return true;
  }
  return false;
}

/**
 * The mammoth's moves for this step (MMN-010…MMN-043): sets the disc's velocity, and its size when
 * it ducks or stands. Runs before the contact solve, so the solve sees what its legs did.
 */
export function driveMoon(world: World, dt: number): void {
  const game = world.moon;
  if (!game) return;
  const { spec, state: s } = game;
  const m = mammothOf(world, spec);
  if (!m || m.shape.kind !== "disc") return;
  const now = world.time;
  const on = (ch: string): boolean => s.phase !== "won" && (world.controls[ch] ?? 0) > 0;
  const input = (on("right") ? 1 : 0) - (on("left") ? 1 : 0);

  const up = upAt(spec, m.position);
  // Rising in a jump, the ground just left is not ground it is on.
  const under = s.jumping && dot(m.velocity, up) > 1 ? null : groundUnder(world, m.id, up, spec.slope);
  const n = under?.n ?? null;
  // The gap now: the contact's was measured before the last step moved the mammoth.
  const gap = under ? under.gap + dot(m.velocity, under.n) * dt : 0;
  if (n) s.lastGround = now;
  // On the ground: touching it, or off it for no longer than a bump at a run throws it.
  const onGround = !!n || (!s.jumping && now - s.lastGround <= HOP);
  const landing = !!n && !s.grounded;
  s.grounded = onGround;

  // The rock is separate pieces, and a disc sliding along them is knocked up and back a little by
  // the corner of each next one (it rests a few millimetres into the piece it is on). That knock is
  // not the ground's shape: it is undone, so the mammoth runs and slides over the joins as over one
  // surface. A real rise in the ground knocks again every step, and still turns it.
  if (n && s.drove && !s.jumping) {
    const a = sub(m.velocity, s.drove.v);
    const along = dot(s.drove.v, s.drove.t);
    const lost = -dot(a, s.drove.t) * Math.sign(along);
    if (dot(a, s.drove.n) > KNOCK.up * (world.units?.length ?? 1) && lost > 0 && lost < Math.max((world.units?.length ?? 1), KNOCK.back * Math.abs(along))) m.velocity = { ...s.drove.v };
  }
  // Along the ground to the right (up a slope, not into it); in the air, level to the right.
  const t = n ? { x: n.y, y: -n.x } : { x: up.y, y: -up.x };

  // Roll (MMN-030, MMN-031): asked for on the ground, with the wait passed.
  const rollNow = on("roll");
  if (rollNow && !s.rollHeld && onGround && !s.ducked && now >= s.rollReady) {
    s.rollUntil = now + spec.roll.time;
    s.rollReady = s.rollUntil + spec.roll.wait;
  }
  s.rollHeld = rollNow;
  const rolling = now < s.rollUntil;

  // Duck (MMN-040, MMN-043): down at once, keeping its foot where it was; up only where there is room.
  const drop = spec.size.stand - spec.size.duck;
  // The rope (MMN-120…MMN-125): held, up reels it in and down pays it out; hanging from it, down
  // is not a duck.
  const tools = spec.tools;
  const rope = moonRope(world);
  const roped = rope?.mode === "held";
  if (rope && roped) rope.reel = ((on("duck") ? 1 : 0) - (on("up") ? 1 : 0)) * tools!.hook.reel;
  if (tools && s.phase !== "won") {
    const a = world.controls.aim;
    if (typeof a === "number" && Number.isFinite(a)) s.aim = a;
  }
  const wantDuck = on("duck") && !rolling && !(roped && !onGround);
  if (wantDuck && !s.ducked) {
    s.ducked = true;
    m.shape = { kind: "disc", radius: spec.size.duck };
    if (n) m.position = sub(m.position, scale(n, drop));
  } else if (!wantDuck && s.ducked) {
    const at = n ? add(m.position, scale(n, drop)) : m.position;
    if (!blocked(world, m.id, at, spec.size.stand)) {
      s.ducked = false;
      m.shape = { kind: "disc", radius: spec.size.stand };
      m.position = at;
    }
  }

  // The way it faces (MMN-012): not changed mid-roll.
  if (input !== 0 && input !== s.facing && !rolling) {
    s.facing = input as 1 | -1;
    if (onGround) s.turnedAt = now;
  }

  // Along the ground or the air (MMN-010, MMN-023, MMN-030, MMN-041).
  const vt = dot(m.velocity, t);
  let to = vt;
  if (rolling) {
    if (onGround) to = approach(vt, spec.roll.speed * s.facing, (spec.roll.accel ?? ROLL_ACCEL * (world.units?.length ?? 1)) * dt);
  } else if (onGround) {
    if (s.ducked) to = Math.abs(vt) <= spec.slide.crawl || input === 0 ? approach(vt, spec.slide.crawl * input, spec.slide.brake * dt) : approach(vt, 0, spec.slide.brake * dt);
    else to = approach(vt, spec.run.speed * input, (input !== 0 && input * vt >= 0 ? spec.run.accel : spec.run.brake) * dt);
  } else if (input !== 0 && !s.ducked && input * vt < spec.run.speed) {
    // In the air it steers, but is never slowed below what it has: a rolling jump keeps its speed.
    to = approach(vt, spec.run.speed * input, spec.run.air * dt);
  }
  if (to !== vt) m.velocity = add(m.velocity, scale(t, to - vt));

  // Jump (MMN-020…MMN-022, MMN-032).
  // Up is a jump too, but on the rope, where it reels in.
  const jumpNow = on("jump") || (!roped && on("up"));
  if (jumpNow && !s.jumpHeld) {
    s.jumpAsked = now;
    // A jump lets go of the rope (MMN-124).
    if (rope && roped) releaseRope(rope);
  }
  // The hook's button (MMN-120, MMN-124): casts the rope, or lets go of the one out.
  if (tools) {
    const hookNow = on("hook");
    if (hookNow && !s.hookHeld) {
      if (rope) releaseRope(rope);
      else castRope(world, MOON_ROPE, m, moonAim(world)!.dir, tools.hook, [MOON_SHOT]);
    }
    s.hookHeld = hookNow;
  }
  const rise = dot(m.velocity, up);
  if (s.jumping && n && rise <= 1) s.jumping = false;
  let leapt = false;
  if (!s.jumping && now - s.jumpAsked <= spec.jump.early && now - s.lastGround <= spec.jump.late) {
    leapt = true;
    m.velocity = add(m.velocity, scale(up, spec.jump.speed - rise));
    s.jumping = true;
    s.cut = false;
    s.jumpAsked = NEVER;
    s.lastGround = NEVER;
  } else if (s.jumping && !s.cut && !jumpNow && rise > 0) {
    m.velocity = sub(m.velocity, scale(up, rise * (1 - spec.jump.cut)));
    s.cut = true;
  }
  s.jumpHeld = jumpNow;

  // Landing: the gap the solver left under it is closed this step (it lets a body close exactly
  // the gap it has), so the mammoth doesn't hang a moment over the ground it has landed on.
  if (n && landing && !leapt && gap > 0.02 * (world.units?.length ?? 1)) {
    const vn = dot(m.velocity, n);
    const want = (-0.9 * gap) / dt;
    if (vn > want) m.velocity = add(m.velocity, scale(n, want - vn));
  }

  s.drove = n && !leapt ? { v: { ...m.velocity }, t, n } : undefined;

  // Its spin is only for show (the disc has no friction): it turns while it rolls, and not otherwise.
  if (rolling) m.angularVelocity = -dot(m.velocity, t) / m.shape.radius;
  else {
    m.angularVelocity = 0;
    m.angle = 0;
  }

  // What it is doing, for the page.
  const speed = Math.abs(dot(m.velocity, t));
  const inAir = !onGround;
  const action: MoonAction = rolling
    ? "roll"
    : s.ducked
      ? speed > spec.slide.least && speed > spec.slide.crawl * 1.05
        ? "slide"
        : "sit"
      : inAir
        ? dot(m.velocity, up) > 0
          ? "jump"
          : "fall"
        : now - s.turnedAt < TURN
          ? "turn"
          : speed > 0.5 * (world.units?.length ?? 1)
            ? "walk"
            : "idle";
  if (action !== s.action) {
    s.action = action;
    s.since = now;
  }
}

/** Puts the mammoth back at the last flag it reached, at rest, with the leg's full time; and the rocks back where they began. */
function sendBack(world: World, game: MoonGame, m: Body, why: NonNullable<MoonState["back"]>["why"], ops: MoonOps): void {
  const { spec, state: s } = game;
  m.shape = { kind: "disc", radius: spec.size.stand };
  m.position = { ...spec.flags[s.flag].at };
  m.velocity = { x: 0, y: 0 };
  m.angle = 0;
  m.angularVelocity = 0;
  world.contacts = world.contacts.filter((c) => c.a !== m.id && c.b !== m.id);
  s.left = spec.flags[s.flag + 1]?.time ?? 0;
  s.tries += 1;
  s.back = { at: world.time, why };
  s.ducked = false;
  s.jumping = false;
  s.cut = false;
  s.grounded = false;
  s.lastGround = NEVER;
  s.jumpAsked = NEVER;
  s.rollUntil = NEVER;
  s.rollReady = NEVER;
  s.drove = undefined;
  // Its rope and its shots in flight go with it.
  if (world.ropes) world.ropes = world.ropes.filter((r) => r.holder !== m.id);
  const shots = new Set((s.flying ?? []).map((f) => f.id));
  if (shots.size) {
    world.bodies = world.bodies.filter((b) => !shots.has(b.id));
    world.contacts = world.contacts.filter((c) => !shots.has(c.a) && !shots.has(c.b));
    s.flying = [];
  }
  resetRocks(world, s, ops);
  world.events.push({ tick: world.tick, type: "moon.back", data: { why, flag: s.flag } });
}

/** Every rock let go is taken out and put back where it began, fixed. */
function resetRocks(world: World, s: MoonState, ops: MoonOps): void {
  for (const id of s.loose) {
    const b = world.bodies.find((x) => x.id === id);
    const was = s.rocks[id];
    if (!b || !was) continue;
    world.bodies = world.bodies.filter((x) => x.id !== id);
    world.contacts = world.contacts.filter((c) => c.a !== id && c.b !== id);
    ops.addBody(world, { ...b, fixed: true, mass: was.mass, position: { ...was.position }, angle: was.angle, velocity: { x: 0, y: 0 }, angularVelocity: 0 } as BodyInput);
  }
  s.loose = [];
}

/**
 * The rifle (MMN-110…MMN-114): while fire is held, a shot every so often, a real body that leaves
 * along the aim at the rifle's speed on top of the mammoth's own, and the mammoth takes the shot's
 * momentum the other way. What a shot does to what it hits is the engine's damage (DMG-002): the
 * game only takes a shot out once it has hit something, or after its time. Returns whether a body
 * came or went.
 */
function runRifle(world: World, game: MoonGame, m: Body, ops: MoonOps): boolean {
  const { spec, state: s } = game;
  const rifle = spec.tools!.rifle;
  let changed = false;
  // Spent: it has struck something, or flown its time.
  const flying = s.flying ?? [];
  const spent = new Set<string>();
  for (const f of flying) {
    const hit = world.contacts.some((c) => (c.a === f.id || c.b === f.id) && c.normalImpulse > 0);
    if (hit || world.time - f.at >= rifle.life || !world.bodies.some((b) => b.id === f.id)) spent.add(f.id);
  }
  if (spent.size) {
    // A puff where one struck (one that only flew its time goes without).
    for (const b of world.bodies) if (spent.has(b.id) && world.contacts.some((c) => (c.a === b.id || c.b === b.id) && c.normalImpulse > 0)) burst(world, b);
    world.bodies = world.bodies.filter((b) => !spent.has(b.id));
    world.contacts = world.contacts.filter((c) => !spent.has(c.a) && !spent.has(c.b));
    s.flying = flying.filter((f) => !spent.has(f.id));
    changed = true;
  }
  if ((world.controls.fire ?? 0) > 0 && world.time - (s.shotAt ?? NEVER) >= rifle.every) {
    const aim = moonAim(world)!;
    const radius = m.shape.kind === "disc" ? m.shape.radius : spec.size.stand;
    const id = `${MOON_SHOT}${(s.shots = (s.shots ?? 0) + 1)}`;
    ops.addBody(world, {
      id,
      shape: { kind: "disc", radius: rifle.radius },
      mass: rifle.mass,
      restitution: 0,
      friction: 0.2,
      position: add(m.position, scale(aim.dir, radius + rifle.radius + 0.05 * (world.units?.length ?? 1))),
      velocity: add(m.velocity, scale(aim.dir, rifle.speed)),
      angle: 0,
      angularVelocity: 0,
      // It never strikes the mammoth that fired it.
      passes: [m.id],
    });
    // Recoil: the shot's momentum, the other way.
    m.velocity = sub(m.velocity, scale(aim.dir, (rifle.mass * rifle.speed) / m.mass));
    s.shotAt = world.time;
    s.flying = [...(s.flying ?? []), { id, at: world.time }];
    changed = true;
  }
  return changed;
}

/**
 * The clocks, the flags and the hazards, after the step (MMN-050…MMN-056). Returns whether it moved
 * or changed a body (the mammoth sent back, a rock let go or put back), for the step to record.
 */
export function runMoon(world: World, dt: number, ops: MoonOps): boolean {
  const game = world.moon;
  if (!game) return false;
  const { spec, state: s } = game;
  const m = mammothOf(world, spec);
  if (!m || s.phase === "won") return false;
  // The clocks start at the first move (MMN-056).
  if (s.phase === "waiting") {
    if (!MOON_CHANNELS.some((ch) => (world.controls[ch] ?? 0) > 0)) return false;
    s.phase = "running";
  }
  s.elapsed += dt;
  s.left -= dt;
  let changed = false;

  // The next flag (MMN-050, MMN-055).
  const next = spec.flags[s.flag + 1];
  if (next && length(sub(m.position, next.at)) <= spec.reach) {
    s.flag += 1;
    s.loose = [];
    world.events.push({ tick: world.tick, type: "moon.flag", data: { flag: s.flag, left: s.left, elapsed: s.elapsed } });
    if (s.flag >= spec.flags.length - 1) {
      s.phase = "won";
      s.left = 0;
      world.events.push({ tick: world.tick, type: "moon.won", data: { elapsed: s.elapsed, tries: s.tries } });
      return false;
    }
    s.left = spec.flags[s.flag + 1].time;
  }

  // The rifle (MMN-110…MMN-114).
  if (spec.tools && runRifle(world, game, m, ops)) changed = true;

  // Rocks: let go when the mammoth comes near (MMN-053).
  for (const r of spec.rocks ?? []) {
    if (s.loose.includes(r.id)) continue;
    const b = world.bodies.find((x) => x.id === r.id);
    if (!b || !b.fixed || length(sub(b.position, m.position)) > r.within) continue;
    // Taken out and put back as a free body: the step keeps what it knows of fixed bodies by the body itself.
    world.bodies = world.bodies.filter((x) => x.id !== r.id);
    world.contacts = world.contacts.filter((c) => c.a !== r.id && c.b !== r.id);
    ops.addBody(world, { ...b, fixed: false, mass: r.mass, velocity: { x: 0, y: 0 }, angularVelocity: 0 } as BodyInput);
    s.loose.push(r.id);
    changed = true;
  }

  // A rock that has fallen and come to rest on something fixed stays where it lies: fixed again,
  // an obstacle, not something the mammoth shoves along (MMN-053).
  for (const id of s.loose) {
    const b = world.bodies.find((x) => x.id === id);
    if (!b || b.fixed || length(b.velocity) > ROCK_RESTS * (world.units?.length ?? 1)) continue;
    const resting = world.contacts.some((c) => c.separation <= TOUCH * (world.units?.length ?? 1) && (c.a === id || c.b === id) && world.bodies.find((x) => x.id === (c.a === id ? c.b : c.a))?.fixed);
    if (!resting) continue;
    world.bodies = world.bodies.filter((x) => x.id !== id);
    world.contacts = world.contacts.filter((c) => c.a !== id && c.b !== id);
    ops.addBody(world, { ...b, fixed: true, velocity: { x: 0, y: 0 }, angularVelocity: 0 } as BodyInput);
    changed = true;
  }

  // Sent back (MMN-051, MMN-052, MMN-053): out of time, on the spikes, or under a falling rock.
  let why: NonNullable<MoonState["back"]>["why"] | null = s.left <= 0 ? "time" : null;
  if (!why)
    for (const c of world.contacts) {
      if (c.separation > TOUCH * (world.units?.length ?? 1) || (c.a !== m.id && c.b !== m.id)) continue;
      const other = c.a === m.id ? c.b : c.a;
      if (other.startsWith(spec.spikes)) why = "spikes";
      else if (s.loose.includes(other)) {
        const rock = world.bodies.find((x) => x.id === other);
        // Falling: moving toward the moon's centre. Pushed along the ground, it is only in the way.
        if (rock && -dot(rock.velocity, upAt(spec, rock.position)) > ROCK_HURTS * (world.units?.length ?? 1)) why = "rock";
      }
      if (why) break;
    }
  if (why) {
    sendBack(world, game, m, why, ops);
    changed = true;
  }
  return changed;
}
