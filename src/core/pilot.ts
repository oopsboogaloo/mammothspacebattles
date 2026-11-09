// AI pilots, phase 1: foundations (AIP-001…AIP-007; §9.10).
//
// A pilot is, for now, a computer built into a ship: a component on one of its bodies, flying the
// whole assembly that body belongs to. It flies only through the ship's control channels, as a
// player does (AIP-001): every few steps it reads the world, decides, and sets its channels. It
// runs inside the step, from the world alone, so it replays and branches like everything else
// (AIP-002).
//
// Its channels are those whose control links all lead into its own assembly; a channel shared
// with another ship is never touched (AIP-003).
//
// It learns its ship from the design (AIP-004): each engine channel pushes along the reverse of
// its injector's direction, from its outlet, so the design gives the direction and the lever
// about the centre of mass. How hard an engine pushes depends on the gas, so the design gives only
// a deliberate underestimate, and the pilot corrects it in flight from the acceleration it sees
// (normalised least mean squares), ignoring steps when something else touches the ship.
//
// From a wanted force and torque it sets the channels between 0 and 1 (thrust allocation,
// AIP-006), by bounded least squares with the torque weighted most. A ship whose engines all push
// one way (Gunship 2) can't push sideways, so to get a force it turns its thrust axis toward it.
// Goals in this phase: hold a heading (AIP-007), hold a velocity, or hover (velocity zero),
// allowing for gravity.

import { add, cross, dot, expD, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { bodyMass } from "./bodies.ts";
import { assemblyOf, assemblyRoots } from "./joints.ts";
import { massProps } from "./shapes.ts";
import { railgunReady } from "./railgun.ts";
import type { Body, World } from "./world.ts";

export type PilotGoal =
  | { kind: "heading"; angle: number }
  | { kind: "velocity"; velocity: Vec2 }
  | { kind: "hover" }
  | { kind: "idle" }
  /** Fly to a point and stop there, or pass through it at cruise speed (AIP-008). */
  | { kind: "point"; target: Vec2; stop?: boolean; speed?: number; tolerance?: number }
  /** Fly a list of waypoints in turn, looping or not; `index` is the one it is heading for (state). */
  | { kind: "route"; waypoints: Vec2[]; loop?: boolean; speed?: number; index?: number }
  /** Hold a position offset from a body, moving with it (AIP-009). */
  | { kind: "station"; body: string; offset: Vec2 };

/**
 * Behaviour modes (AIP-015). "manual": its goal is set from outside. "ignoring": it flies its route
 * and ignores everyone. "hunting": it attacks any ship of another side it sees. "cautious": it flies
 * its route, watches the player when near, and fights back for a minute once fired toward.
 * "evading": it flies its route and runs from ships of other sides that close on it.
 */
export type PilotMode = "manual" | "ignoring" | "hunting" | "cautious" | "evading";

/** What the pilot knows about one engine channel, in the body frame of the pilot's body. */
export interface ThrustChannel {
  channel: string;
  /** Unit thrust direction and point of application, in the pilot body's frame, m. */
  direction: Vec2;
  point: Vec2;
  /** Learned thrust at command 1, N. */
  gain: number;
  /** The design's estimate it started from, N. */
  design: number;
}

export interface Pilot {
  /** Flight and combat skill, 0 (novice) to 1 (ace) (AIP-005). Phase 1 uses flight skill only. */
  skill: { flight: number; combat: number };
  goal: PilotGoal;
  /** Behaviour mode (AIP-015); default "manual". */
  mode?: PilotMode;
  /** The route Ignoring, Cautious and Evading fly. */
  route?: { waypoints: Vec2[]; loop?: boolean; speed?: number };
  /** Its side (AIP-016): it fights other sides. Ships with no pilot are the player's ("player"). Default "enemy". */
  side?: string;
  /** How far it sees ships, m (AIP-016). Default 150. */
  detect?: number;
  /** State: combat (phase 3): its target, grudge, what it has learned of its gun, and a shot in progress. */
  combat?: { target?: string; grudgeUntil?: number; offender?: string; muzzle: number; pulse: number; shot?: string; attacking?: boolean; shots: number };
  /** Time between decisions, in steps of 1/240 s (the scenario step) whatever the step rate. */
  interval: number;
  /** State: tick of the next decision. */
  next: number;
  /** State: the ship as learned (rebuilt when its parts change). */
  model?: { channels: ThrustChannel[]; parts: string };
  /** State: the commands last set, and the engines' lagged response to them (0–1). */
  command: Record<string, number>;
  lagged: Record<string, number>;
  /** State: last decision's view of the ship, to learn from. */
  seen?: { tick: number; velocity: Vec2; omega: number; quiet: boolean };
  /** State: the velocity loop's integral along the thrust axis (removes steady errors such as a hover sinking), m/s. */
  trim?: number;
  /** State: within tolerance of the velocity it wants (it then lets errors grow to twice that before acting). */
  settled?: boolean;
  /** State: what it is doing, for people (the inspector). */
  intent: string;
  /** State: Evading is running from someone. */
  fleeing?: boolean;
  /** Mad (phase 4): it may turn on its own side. */
  mad?: boolean;
  /** State: its plan, for the overlay: where it is going, the route, and what it is steering round. */
  plan?: { target?: Vec2; route?: Vec2[]; avoiding?: Vec2[]; aim?: Vec2; enemy?: Vec2 };
}

export const PILOT_DEFAULTS: Omit<Pilot, "goal"> = { skill: { flight: 0.7, combat: 0.5 }, interval: 8, next: 0, command: {}, lagged: {}, intent: "" };

export type PilotInput = Partial<Omit<Pilot, "skill">> & { skill?: Partial<Pilot["skill"]> };

export function normalizePilot(p: PilotInput): Pilot {
  return { ...PILOT_DEFAULTS, goal: { kind: "idle" }, ...p, skill: { ...PILOT_DEFAULTS.skill, ...p.skill }, command: { ...p.command }, lagged: { ...p.lagged } };
}

/** Exhaust speed the design assumes before the pilot has seen its engines work, m/s: low on purpose. */
const DESIGN_EXHAUST_SPEED = 50;
/** Engines take this long to answer a command, s (chamber pressure building). */
const ENGINE_LAG = 0.08;
/** Learning rate of the in-flight correction. */
const LEARN = 0.3;

interface ShipState {
  members: Body[];
  mass: number;
  inertia: number;
  centre: Vec2;
  velocity: Vec2;
  omega: number;
}

function shipState(world: World, body: Body): ShipState {
  const ids = new Set(assemblyOf(world, body.id));
  const members = world.bodies.filter((b) => ids.has(b.id));
  let M = 0;
  let c = { x: 0, y: 0 };
  let p = { x: 0, y: 0 };
  const parts = members.map((b) => {
    const m = bodyMass(b);
    M += m;
    c = add(c, scale(b.position, m));
    p = add(p, scale(b.velocity, m));
    return { b, m, I: massProps(b.shape, m).inertia };
  });
  c = scale(c, 1 / M);
  const v = scale(p, 1 / M);
  let I = 0;
  let L = 0;
  for (const { b, m, I: Ib } of parts) {
    const d = sub(b.position, c);
    I += Ib + m * dot(d, d);
    L += m * cross(d, sub(b.velocity, v)) + Ib * b.angularVelocity;
  }
  return { members, mass: M, inertia: I, centre: c, velocity: v, omega: L / I };
}

/** Gravity at a point: the uniform field plus every gravity source (FLT-011), m/s². */
function gravityAt(world: World, p: Vec2, ship: Set<string>): Vec2 {
  let g = { ...world.gravity };
  for (const s of world.bodies) {
    if (!s.gravity || !(s.gravity.mu > 0) || ship.has(s.id)) continue;
    const d = sub(s.position, p);
    const r2 = dot(d, d) + s.gravity.core * s.gravity.core;
    g = add(g, scale(d, s.gravity.mu / (r2 * Math.sqrt(r2))));
  }
  return g;
}

/** The pilot's channels: those whose every control link leads into its own assembly (AIP-003). */
export function pilotChannels(world: World, body: Body): string[] {
  const own = new Set(assemblyOf(world, body.id));
  const byChannel = new Map<string, boolean>();
  for (const l of world.links) {
    if (l.kind !== "control") continue;
    byChannel.set(l.channel, (byChannel.get(l.channel) ?? true) && own.has(l.to));
  }
  return [...byChannel.entries()].filter(([, mine]) => mine).map(([c]) => c).sort();
}

/** Learns the ship from its design (AIP-004): each engine channel's thrust direction, point and estimated strength. */
export function learnShip(world: World, body: Body, keep?: ThrustChannel[]): ThrustChannel[] {
  const q = sinCos(body.angle);
  const toBody = (v: Vec2) => ({ x: q.c * v.x + q.s * v.y, y: -q.s * v.x + q.c * v.y });
  const out: ThrustChannel[] = [];
  for (const ch of pilotChannels(world, body)) {
    const engines = world.links.filter((l) => l.kind === "control" && l.channel === ch).map((l) => world.bodies.find((b) => b.id === l.to)).filter((b): b is Body => !!b?.injector && !b.magazine && b.integrity > 0); // a cannon's charge is not an engine
    if (!engines.length) continue;
    // Sum the engines on this channel: thrust is the reverse of where the gas goes, from the outlet.
    let F = { x: 0, y: 0 };
    let T = 0;
    let est = 0;
    for (const e of engines) {
      const inj = e.injector!;
      const qe = sinCos(e.angle);
      const d0 = rotate(qe, inj.direction);
      const dl = length(d0);
      const dir = toBody(scale(d0, -1 / (dl || 1)));
      const at = toBody(sub(add(e.position, rotate(qe, inj.outlet)), body.position));
      const f = inj.rate * DESIGN_EXHAUST_SPEED;
      F = add(F, scale(dir, f));
      T += cross(at, scale(dir, f));
      est += f;
    }
    const dir = scale(F, 1 / (length(F) || 1));
    // A point on the line of action with the same torque: F × r gives the moment arm.
    const point = length(F) > 1e-9 ? scale({ x: -dir.y, y: dir.x }, -T / length(F)) : { x: 0, y: 0 };
    const old = keep?.find((k) => k.channel === ch);
    out.push({ channel: ch, direction: dir, point, design: est, gain: old ? old.gain : est });
  }
  return out;
}

/** Bounded least squares: commands u in [0, 1] minimising Σ w_k (A u − b)_k², by clamped coordinate descent. */
function allocate(A: number[][], b: number[], w: number[], n: number): number[] {
  const u = new Array<number>(n).fill(0);
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < n; i++) {
      let num = 0;
      let den = 0;
      for (let k = 0; k < b.length; k++) {
        let r = b[k];
        for (let j = 0; j < n; j++) if (j !== i) r -= A[k][j] * u[j];
        num += w[k] * A[k][i] * r;
        den += w[k] * A[k][i] * A[k][i];
      }
      if (den > 0) u[i] = Math.min(1, Math.max(0, num / den));
    }
  }
  return u;
}

/** Shells sitting loaded in a gun (the latest a magazine loaded, still in its bore): part of their ship, not shots or obstacles. */
function loadedRounds(world: World): Set<string> {
  const out = new Set<string>();
  for (const g of world.bodies) {
    const mag = g.magazine;
    if (!mag || mag.loaded < 1) continue;
    const id = `${g.id}-shell-${mag.loaded}`;
    const sh = world.bodies.find((b) => b.id === id);
    if (sh && length(sub(sh.position, g.position)) < length(mag.at) + 2) out.add(id);
  }
  return out;
}

interface Obstacle {
  /** Its assembly. */
  root: string;
  /** Its mass, kg (fixed bodies: infinite). */
  mass: number;
  centre: Vec2;
  radius: number;
  velocity: Vec2;
}

/** Everything the pilot must not hit, as circles: each other assembly (moving or fixed) round its parts. */
function obstacles(world: World, own: Set<string>): Obstacle[] {
  const roots = assemblyRoots(world);
  const groups = new Map<string, Body[]>();
  // Its own shells, loaded or fired (and their fragments), are named after its magazines: not obstacles.
  const shells = world.bodies.filter((b) => own.has(b.id) && b.magazine).map((b) => `${b.id}-shell-`);
  // Any ship's loaded round sits in its bore, inside that ship's outline.
  const loaded = loadedRounds(world);
  for (const b of world.bodies) {
    if (own.has(b.id) || loaded.has(b.id) || shells.some((pre) => b.id.startsWith(pre))) continue;
    const r = roots.get(b.id)!;
    const g = groups.get(r);
    if (g) g.push(b);
    else groups.set(r, [b]);
  }
  const out: Obstacle[] = [];
  for (const [root, bs] of groups) {
    let m = 0;
    let c = { x: 0, y: 0 };
    let v = { x: 0, y: 0 };
    for (const b of bs) {
      const mb = b.fixed ? 1 : bodyMass(b);
      m += mb;
      c = add(c, scale(b.position, mb));
      v = add(v, scale(b.fixed ? { x: 0, y: 0 } : b.velocity, mb));
    }
    c = scale(c, 1 / m);
    let R = 0;
    for (const b of bs) R = Math.max(R, length(sub(b.position, c)) + massProps(b.shape, 1).boundingRadius);
    out.push({ root, mass: bs.some((b) => b.fixed) ? Infinity : m, centre: c, radius: R, velocity: scale(v, 1 / m) });
  }
  return out;
}

/**
 * Steers a wanted velocity round obstacles (AIP-010): for each, where the ship would pass it within
 * `ahead` seconds on that velocity, and if closer than its clearance, it adds a sideways push away,
 * and holds its closing speed to what it could still stop from (braking at `brake` after a half
 * turn of `flip` seconds). Returns the new velocity and the centres of what it is avoiding.
 */
function avoid(v: Vec2, pos: Vec2, own: number, obs: Obstacle[], ahead: number, margin: number, brake: number, flip: number): { v: Vec2; avoiding: Vec2[] } {
  let out = v;
  const avoiding: Vec2[] = [];
  for (const o of obs) {
    const r = sub(o.centre, pos);
    const clear = o.radius + own + margin;
    const dist = length(r);
    if (dist - clear > length(sub(v, o.velocity)) * ahead + clear) continue; // far out of reach
    const w = sub(out, o.velocity); // our motion relative to it
    const ww = dot(w, w);
    const t = ww > 1e-9 ? Math.min(ahead, Math.max(0, dot(r, w) / ww)) : 0;
    const closest = sub(scale(w, t), r); // from it to us, at the closest approach
    const miss = length(closest);
    if (miss >= clear) continue;
    avoiding.push(o.centre);
    // Away from it, sideways to the motion: the closest-approach direction, or across the motion if dead on.
    const away = miss > 1e-6 ? scale(closest, 1 / miss) : length(w) > 1e-9 ? scale({ x: -w.y, y: w.x }, 1 / length(w)) : scale(r, -1 / (dist || 1));
    const urgency = (2 * (clear - miss)) / Math.max(0.5, t);
    out = add(out, scale(away, urgency));
    // And never close on it faster than it could still stop in the room left: the turn, then the burn.
    const rHat = scale(r, 1 / (dist || 1));
    const closing = dot(sub(out, o.velocity), rHat);
    const room = Math.max(0, dist - clear);
    const allowed = brake * (-flip + Math.sqrt(flip * flip + (2 * room) / brake));
    if (closing > allowed) out = sub(out, scale(rHat, closing - allowed));
  }
  return { v: out, avoiding };
}


interface Ship {
  /** Its assembly. */
  root: string;
  /** A body of it to name and follow it by: its pilot's body, or its first part. */
  id: string;
  side: string;
  centre: Vec2;
  velocity: Vec2;
}

/** Every other ship, with its side (AIP-016). */
function shipsAround(world: World, own: Set<string>): Ship[] {
  const roots = assemblyRoots(world);
  const groups = new Map<string, Body[]>();
  for (const b of world.bodies) {
    if (own.has(b.id) || b.fixed) continue;
    const r = roots.get(b.id)!;
    const g = groups.get(r);
    if (g) g.push(b);
    else groups.set(r, [b]);
  }
  const out: Ship[] = [];
  for (const [root, bs] of groups) {
    // A ship, until cockpits exist: a working pilot or tractor (Gunship 2's hull), or a working engine
    // and gun together. A gun or engine broken off on its own is debris.
    const works = (x: Body) => x.integrity > 0;
    const engine = bs.some((x) => works(x) && x.injector && !x.magazine);
    const gun = bs.some((x) => works(x) && x.magazine && x.injector);
    if (!bs.some((x) => works(x) && (x.pilot || x.tractor)) && !(engine && gun)) continue;
    // Named by its pilot's body, else its tractor's (Gunship 2's hull), else its heaviest part.
    const pilot = bs.find((b) => b.pilot);
    const name = pilot ?? bs.find((b) => b.tractor) ?? bs.reduce((m, b) => (bodyMass(b) > bodyMass(m) ? b : m));
    let m = 0;
    let c = { x: 0, y: 0 };
    let v = { x: 0, y: 0 };
    for (const b of bs) {
      const mb = bodyMass(b);
      m += mb;
      c = add(c, scale(b.position, mb));
      v = add(v, scale(b.velocity, mb));
    }
    out.push({ root, id: name.id, side: pilot ? (pilot.pilot!.side ?? "enemy") : "player", centre: scale(c, 1 / m), velocity: scale(v, 1 / m) });
  }
  return out;
}

/** Its gun, from the design: the body with a magazine, its fire channel, and the bore direction in that body's frame. */
function gunOf(world: World, members: Body[], channels: string[]): { body: Body; channel: string; bore: Vec2 } | null {
  // Only a gun whose fire channel is the pilot's own (AIP-003): never another ship's. A gas
  // cannon fires through its injector's channel; a railgun (WPN-008) through its own.
  const fireChannel = (x: Body) => x.magazine?.railgun?.channel ?? x.injector?.channel;
  const b = members.find((x) => x.magazine && fireChannel(x) && x.integrity > 0 && channels.includes(fireChannel(x)!));
  if (!b) return null;
  const at = b.magazine!.at;
  const bore = length(at) > 1e-9 ? scale(at, 1 / length(at)) : { x: 0, y: 1 };
  return { body: b, channel: fireChannel(b)!, bore };
}

/**
 * Where to point the bore to hit a target (AIP-011): the shell leaves at `muzzle` speed on top of
 * the ship's own velocity, so in the ship's frame the target moves at its velocity less ours. `lead`
 * (0–1, from combat skill) is how much of that motion it allows for. Returns a unit direction.
 */
export function aimAt(from: Vec2, ownV: Vec2, target: Vec2, targetV: Vec2, muzzle: number, lead: number): Vec2 {
  const r = sub(target, from);
  const w = scale(sub(targetV, ownV), lead);
  const a = dot(w, w) - muzzle * muzzle;
  const b = 2 * dot(r, w);
  const c = dot(r, r);
  let t = length(r) / muzzle;
  const disc = b * b - 4 * a * c;
  if (Math.abs(a) > 1e-9 && disc >= 0) {
    const sq = Math.sqrt(disc);
    const ts = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter((x) => x > 0);
    if (ts.length) t = Math.min(...ts);
  }
  const d = add(r, scale(w, t));
  return scale(d, 1 / (length(d) || 1));
}

/** A steady, replayable wobble in [-1, 1] from a tick and a name (no draw on the world's random stream). */
function wobble(tick: number, id: string): number {
  let h = 2166136261 ^ tick;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Whether a straight line of fire is clear of everything but the target: no rock or other ship in
 * the way. Debris lighter than `light` (bits knocked off, loose shells) is shot through.
 */
function clearShot(from: Vec2, dir: Vec2, range: number, obs: Obstacle[], target: string, light: number): boolean {
  for (const o of obs) {
    if (o.root === target || o.mass < light) continue;
    const r = sub(o.centre, from);
    const t = dot(r, dir);
    if (t < 0 || t > range) continue;
    if (length(sub(r, scale(dir, t))) < o.radius + 0.5) return false;
  }
  return true;
}

/**
 * Runs every pilot for one step (AIP-001, AIP-002): on its decision steps it reads the ship and the
 * world, learns from what its last commands did, decides, and sets its channels. Between decisions
 * its channels hold.
 */
/** The unit of a pilot's decision interval, s: 1/240 s, the scenario step. */
const INTERVAL_TICK = 1 / 240;

export function runPilots(world: World, dt: number): void {
  for (const body of world.bodies) {
    const p = body.pilot;
    if (!p) continue;
    if (body.integrity <= 0) {
      p.intent = "wrecked";
      continue;
    }
    if (world.tick < p.next) continue;
    // The interval counts 1/240 s (as scenario steps do), whatever the step rate.
    p.next = world.tick + Math.max(1, Math.floor((p.interval * INTERVAL_TICK) / dt + 1e-9));
    const ship = shipState(world, body);
    const ids = new Set(ship.members.map((b) => b.id));
    // Relearn when the ship's parts change (a part lost, a new one welded on).
    const parts = ship.members.map((b) => b.id).join(",");
    if (!p.model || p.model.parts !== parts) p.model = { channels: learnShip(world, body, p.model?.channels), parts };
    const chans = p.model.channels;
    const q = sinCos(body.angle);
    const g = gravityAt(world, ship.centre, ids);

    // Learn: compare what the ship did since the last decision with what the lagged commands should have done.
    const quiet = !world.contacts.some((c) => ids.has(c.a) || ids.has(c.b)) && !world.bodies.some((b) => ids.has(b.id) && b.tractor && b.tractor.mode === "tether");
    if (p.seen && p.seen.quiet && quiet && world.tick > p.seen.tick) {
      const T = (world.tick - p.seen.tick) * dt;
      const fObs = scale(sub(scale(sub(ship.velocity, p.seen.velocity), 1 / T), g), ship.mass);
      const tObs = (ship.inertia * (ship.omega - p.seen.omega)) / T;
      let fPred = { x: 0, y: 0 };
      let tPred = 0;
      for (const c of chans) {
        const u = p.lagged[c.channel] ?? 0;
        const d = rotate(q, c.direction);
        fPred = add(fPred, scale(d, c.gain * u));
        tPred += c.gain * u * cross(c.point, c.direction);
      }
      const ef = sub(fObs, fPred);
      const et = tObs - tPred;
      // Normalised LMS on each active channel's gain, in force units (torque over an arm of 1 m).
      let norm = 1e-9;
      for (const c of chans) norm += (p.lagged[c.channel] ?? 0) ** 2 * (1 + cross(c.point, c.direction) ** 2);
      for (const c of chans) {
        const u = p.lagged[c.channel] ?? 0;
        if (u < 0.05) continue;
        const d = rotate(q, c.direction);
        const arm = cross(c.point, c.direction);
        c.gain += (LEARN * u * (dot(ef, d) + et * arm)) / norm;
        c.gain = Math.min(20 * c.design, Math.max(0.2 * c.design, c.gain));
      }
    }

    // Decide: a wanted force (world) and torque about the centre of mass.
    const s = Math.min(1, Math.max(0, p.skill.flight));
    const authority = 0.4 + 0.6 * s; // share of the ship's turn and thrust it is willing to use
    const axisBody = (() => {
      let a = { x: 0, y: 0 };
      for (const c of chans) a = add(a, scale(c.direction, c.gain));
      return length(a) > 1e-9 ? scale(a, 1 / length(a)) : { x: 0, y: 1 };
    })();
    const axis = rotate(q, axisBody); // where the engines push, in the world
    let force = { x: 0, y: 0 };
    let want = axis; // unit vector the thrust axis should point along
    // Ignoring (AIP-015): it flies its route, whatever else is about.
    if (p.mode === "ignoring" && p.route && p.goal.kind !== "route") p.goal = { kind: "route", waypoints: p.route.waypoints, loop: p.route.loop ?? true, speed: p.route.speed, index: 0 };
    let goal: PilotGoal = p.goal;
    let label = "";
    p.plan = {};
    // Combat modes (phase 3): sides, sight, a target, and where to aim (AIP-011, AIP-015, AIP-016).
    const cs = Math.min(1, Math.max(0, p.skill.combat));
    const ownR = Math.max(...ship.members.map((b) => length(sub(b.position, ship.centre)) + massProps(b.shape, 1).boundingRadius));
    const gun = gunOf(world, ship.members, pilotChannels(world, body));
    p.combat ??= { muzzle: 40, pulse: 0, shots: 0 };
    const cb = p.combat;
    // A railgun's launch speed is in its design; a gas cannon's is learned from its shots.
    if (gun?.body.magazine?.railgun && !cb.shots) cb.muzzle = gun.body.magazine.railgun.speed;
    // Learn the gun's muzzle speed from its own last shot, once that shell is clear of the barrel.
    if (cb.shot) {
      const sh = world.bodies.find((b) => b.id === cb.shot);
      if (!sh) cb.shot = undefined;
      else if (gun && length(sub(sh.position, gun.body.position)) > 6) {
        cb.muzzle = 0.5 * cb.muzzle + 0.5 * length(sub(sh.velocity, ship.velocity));
        cb.shot = undefined;
      }
    }
    let aim: Vec2 | null = null; // where the bore should point, if fighting
    let fire = false;
    const mode = p.mode ?? "manual";
    if (mode === "hunting" || mode === "cautious" || mode === "evading") {
      const side = p.side ?? "enemy";
      const seen = shipsAround(world, ids).filter((x) => length(sub(x.centre, ship.centre)) <= (p.detect ?? 150));
      const foes = seen.filter((x) => x.side !== side || (mode === "hunting" && p.mad)); // a mad pilot may turn on its own side
      const nearest = (xs: Ship[]) => xs.reduce<Ship | null>((m, x) => (!m || length(sub(x.centre, ship.centre)) < length(sub(m.centre, ship.centre)) ? x : m), null);
      // Cautious: a foreign shell whose path passes within 4 ship widths of it, or a hit, starts a minute's rage.
      if (mode === "cautious") {
        const own = new Set(ship.members.map((b) => b.id));
        const mine = gun ? `${gun.body.id}-shell-` : "\u0000";
        const loaded = loadedRounds(world); // still in a gun: not fired
        for (const b of world.bodies) {
          if (!b.id.includes("-shell-") || b.id.startsWith(mine) || own.has(b.id) || loaded.has(b.id)) continue;
          const r = sub(b.position, ship.centre);
          const w = sub(b.velocity, ship.velocity);
          if (length(w) < 5) continue; // a loaded shell, not one in flight
          const t = Math.max(0, Math.min(3, -dot(r, w) / dot(w, w)));
          const hit = world.contacts.some((c) => (c.a === b.id && own.has(c.b)) || (c.b === b.id && own.has(c.a)));
          if (hit || length(add(r, scale(w, t))) < 4 * 2 * ownR) {
            cb.grudgeUntil = world.tick + Math.round(60 / dt);
            const gunId = b.id.slice(0, b.id.indexOf("-shell-"));
            const owner = shipsAround(world, ids).find((x) => assemblyOf(world, x.id).includes(gunId));
            cb.offender = owner?.id ?? cb.offender;
          }
        }
      }
      const angry = mode === "cautious" && cb.grudgeUntil !== undefined && world.tick < cb.grudgeUntil;
      let target: Ship | null = null;
      if (mode === "hunting") target = nearest(foes);
      else if (angry) target = seen.find((x) => x.id === cb.offender) ?? nearest(foes.filter((x) => x.side === "player"));
      if (target) {
        // Attack: close to a stand-off distance, matching its motion, then turn and fire.
        cb.target = target.id;
        const standoff = 35 + 20 * (1 - cs);
        const d = sub(target.centre, ship.centre);
        const dist = length(d);
        const relV = length(sub(ship.velocity, target.velocity));
        if (dist < standoff + 20 && relV < 3) cb.attacking = true;
        else if (dist > standoff + 40 || relV > 6) cb.attacking = false;
        p.plan.enemy = target.centre;
        if (cb.attacking && gun) {
          const muzzleAt = add(gun.body.position, rotate(sinCos(gun.body.angle), gun.body.magazine!.at));
          let dir = aimAt(muzzleAt, ship.velocity, target.centre, target.velocity, cb.muzzle, 0.3 + 0.7 * cs);
          // Aim error that grows as combat skill falls: up to about 4°, steady for a second at a time.
          const e = 0.07 * (1 - cs) * wobble(Math.floor(world.time + 1e-9), body.id);
          const qe = sinCos(e);
          dir = rotate(qe, dir);
          aim = dir;
          p.plan.aim = add(muzzleAt, scale(dir, Math.min(dist, 120)));
          // Fire control (AIP-012): aimed well enough, in range, a shell in the bore, the line clear.
          const boreWorld = rotate(sinCos(gun.body.angle), gun.bore);
          const tol = 0.01 + 0.06 * (1 - cs);
          const loaded = gun.body.magazine!.railgun ? railgunReady(gun.body) : loadedRounds(world).has(`${gun.body.id}-shell-${gun.body.magazine!.loaded}`);
          const inRange = dist < 100;
          const clear = clearShot(muzzleAt, dir, dist, obstacles(world, ids), target.root, 0.2 * ship.mass);
          fire = loaded && inRange && clear && dot(boreWorld, dir) > sinCos(tol).c;
          label = `${angry ? "fighting back" : "attacking"} ${target.id}${fire ? ", firing" : !loaded ? ", reloading" : !clear ? ", no clear shot" : ""}`;
          if (fire && cb.pulse <= 0) {
            cb.pulse = Math.max(1, Math.round(0.1 / (p.interval * INTERVAL_TICK)));
            cb.shot = `${gun.body.id}-shell-${gun.body.magazine!.loaded}`;
            cb.shots += 1;
          }
          goal = { kind: "velocity", velocity: target.velocity }; // hold its distance while aiming
        } else {
          const away = dist > 1e-6 ? scale(d, -1 / dist) : { x: 0, y: -1 };
          goal = { kind: "station", body: target.id, offset: scale(away, standoff) };
          label = `${angry ? "turning on" : "closing on"} ${target.id}`;
        }
      } else {
        cb.target = undefined;
        cb.attacking = false;
        const threat = nearest(foes);
        const tooClose = threat && length(sub(threat.centre, ship.centre)) < 60 && dot(sub(threat.velocity, ship.velocity), sub(ship.centre, threat.centre)) > 0;
        if (mode === "evading" && threat && (tooClose || (p.fleeing && length(sub(threat.centre, ship.centre)) < 100))) {
          // Evading: run, straight away from it, until there is room again.
          p.fleeing = true;
          const away = sub(ship.centre, threat.centre);
          goal = { kind: "point", target: add(ship.centre, scale(away, 60 / (length(away) || 1))), stop: false, speed: 6 + 8 * s };
          label = `evading ${threat.id}`;
          p.plan.enemy = threat.centre;
        } else if (mode === "cautious" && !angry && nearest(foes.filter((x) => x.side === "player"))) {
          // Cautious: the player is near; stop and watch it.
          const pl = nearest(foes.filter((x) => x.side === "player"))!;
          const watch = sub(pl.centre, ship.centre);
          if (length(ship.velocity) > 1) goal = { kind: "velocity", velocity: { x: 0, y: 0 } };
          else if (gun) aim = scale(watch, 1 / (length(watch) || 1));
          label = `watching ${pl.id}`;
          p.plan.enemy = pl.centre;
        } else {
          p.fleeing = false;
          if (p.route && p.goal.kind !== "route") p.goal = { kind: "route", waypoints: p.route.waypoints, loop: p.route.loop ?? true, speed: p.route.speed, index: 0 };
          goal = p.goal;
        }
      }
    }
    let holdTight = false;
    // Navigation: points, routes and stations become a wanted velocity (AIP-008, AIP-009).
    if (goal.kind === "route" && goal.waypoints.length) {
      const i = Math.min(goal.index ?? 0, goal.waypoints.length - 1);
      const last = i === goal.waypoints.length - 1 && !goal.loop;
      const at = goal.waypoints[i];
      const tolR = 2 + 2 * (1 - s);
      if (length(sub(at, ship.centre)) < tolR * 2 && !last) goal.index = (i + 1) % goal.waypoints.length;
      p.plan.route = goal.waypoints;
      label = `route: waypoint ${(goal.index ?? i) + 1} of ${goal.waypoints.length}`;
      goal = { kind: "point", target: goal.waypoints[goal.index ?? i], stop: last, speed: goal.speed };
    }
    if (goal.kind === "point" || goal.kind === "station") {
      const most = chans.reduce((m, c) => m + c.gain, 0);
      // How hard it plans to brake: half its share of the thrust (the velocity loop near the mark
      // doesn't ask for all of it), less gravity; and how long a half turn takes.
      const aBrake = Math.max(0.3, (0.5 * authority * most) / ship.mass - length(g));
      const tFlip = Math.PI / (0.8 + 1.2 * s) + 0.3;
      let target: Vec2;
      let carry = { x: 0, y: 0 };
      let stop = true;
      let cruise = 4 + 8 * s;
      let tolP = 1 + 2 * (1 - s);
      if (goal.kind === "station") {
        const st = goal;
        const host = world.bodies.find((b) => b.id === st.body);
        target = host ? add(host.position, st.offset) : ship.centre;
        carry = host ? host.velocity : carry; // move with it
        if (!label) label = `keep station on ${st.body}`;
      } else {
        target = goal.target;
        stop = goal.stop !== false;
        cruise = goal.speed ?? cruise;
        tolP = goal.tolerance ?? tolP;
        if (!label) label = `fly to ${target.x.toFixed(0)}, ${target.y.toFixed(0)}`;
      }
      const d = sub(target, ship.centre);
      const dist = length(d);
      // The fastest it can go and still stop in the distance left: the half turn, then the burn.
      const r = Math.max(0, dist - 0.5 * tolP); // aim inside the tolerance
      const vStop = aBrake * (-tFlip + Math.sqrt(tFlip * tFlip + (2 * r) / aBrake));
      // Keeping station, it closes gently (speed in proportion to the gap), so as not to overshoot a moving mark.
      const speed = goal.kind === "station" ? Math.min(cruise, vStop, 0.3 * dist) : stop ? Math.min(cruise, vStop) : cruise;
      // Holding at a mark, small drifts matter: every turn to hold the heading also pushes the ship.
      if (goal.kind === "point" && stop && dist < 2 * tolP) holdTight = true;
      let vWant = dist > 1e-6 ? add(carry, scale(d, speed / dist)) : carry;
      // Closing on a stop faster than planned: ask for that excess again, so it brakes hard along
      // the line (the velocity loop alone eases off as it nears the mark, and overshoots).
      if (goal.kind === "point" && stop && dist > 1e-6) {
        const closing = dot(sub(ship.velocity, carry), scale(d, 1 / dist));
        if (closing > speed) vWant = sub(vWant, scale(d, (closing - speed) / dist));
      }
      p.plan.target = target;
      goal = { kind: "velocity", velocity: vWant };
    }
    // Steer round whatever is in the way (AIP-010).
    if (goal.kind === "velocity" && p.goal.kind !== "velocity") {
      const mostT = chans.reduce((m, c) => m + c.gain, 0);
      const brake = Math.max(0.3, (authority * mostT) / ship.mass - length(g));
      const steered = avoid(goal.velocity, ship.centre, ownR, obstacles(world, ids), 3 + 4 * s, 5 - 2 * s, brake, Math.PI / (0.8 + 1.2 * s) + 0.3);
      if (steered.avoiding.length) label += ", steering round";
      p.plan.avoiding = steered.avoiding;
      goal = { kind: "velocity", velocity: steered.v };
    }
    if (goal.kind === "heading") {
      const h = sinCos(goal.angle);
      want = { x: h.c, y: h.s };
      p.intent = `hold heading ${goal.angle.toFixed(2)} rad`;
    } else if (goal.kind === "velocity" || goal.kind === "hover") {
      const v = goal.kind === "velocity" ? goal.velocity : { x: 0, y: 0 };
      // Slower than the turning loop, which it steers: a turn takes about a second.
      const k = 0.4 + 0.6 * s; // 1/s
      const raw = sub(v, ship.velocity);
      // An error along the thrust axis is fixed by throttle alone, and always is. One across it,
      // or one that needs braking, means turning the ship: small ones are let be (a tolerance
      // that shrinks with skill), with hysteresis, or every overshoot would set it turning.
      const tol = (0.15 + 0.35 * (1 - s)) * (holdTight ? 0.5 : 1);
      const eAlong = dot(raw, axis);
      const turn = add(sub(raw, scale(axis, eAlong)), scale(axis, Math.min(0, eAlong)));
      if (length(turn) < tol) p.settled = true;
      else if (length(turn) > 2 * tol) p.settled = false;
      const e = add(scale(axis, Math.max(0, eAlong)), p.settled ? { x: 0, y: 0 } : turn);
      // A slow integral of the error along the thrust axis, so a steady one (a hover sinking on a
      // misjudged engine) is worked off by throttle. Under gravity only: in open space it just overshoots. Signed, so an overshoot winds it back down;
      // never negative, since it can only add throttle; and only near the wanted velocity, or it
      // would wind up while accelerating toward it.
      if (length(raw) < 1 && length(g) > 0.05) p.trim = Math.min(2, Math.max(0, (p.trim ?? 0) + (eAlong < 0 ? 4 : 1) * eAlong * p.interval * INTERVAL_TICK)); // unwinds fast on overshoot
      const a = add(scale(e, k), scale(axis, 0.3 * k * (p.trim ?? 0)));
      force = scale(sub(a, g), ship.mass); // what the engines must supply, gravity included
      // Point the thrust axis along the force only when there is a force worth pointing for: a
      // few percent of what the engines can give. Below that, chasing its direction just spins.
      const most = chans.reduce((m, c) => m + c.gain, 0);
      if (length(force) > 0.03 * most) want = scale(force, 1 / length(force));
      p.intent = label || (goal.kind === "hover" ? "hover" : `hold velocity ${v.x.toFixed(1)}, ${v.y.toFixed(1)} m/s`);
    } else p.intent = "idle";

    // Aiming: point the bore along the aim, which means turning the thrust axis by the angle
    // between bore and thrust axis in the gun's frame (none for Gunship 2).
    if (aim && gun) {
      const boreInPilot = rotate(sinCos(gun.body.angle - body.angle), gun.bore);
      const turn = { c: dot(boreInPilot, axisBody), s: cross(boreInPilot, axisBody) };
      want = rotate(turn, aim);
      if (label) p.intent = label;
    }

    // Attitude: a PD law on the heading error (its sine, saturated beyond 90°), as an angular
    // acceleration, then a torque.
    const sinErr = cross(axis, want);
    const cosErr = dot(axis, want);
    const err = cosErr >= 0 ? sinErr : Math.sign(sinErr || 1);
    // Cascaded: the error asks for a turn rate (capped), the rate error for an angular acceleration
    // (capped). Gunship 2 turns by firing one engine, which also pushes it, so gentle turns cost
    // less unwanted thrust.
    const wMax = 0.8 + 1.2 * s; // rad/s
    const aMax = 2 + 4 * s; // rad/s²
    const wWant = Math.max(-wMax, Math.min(wMax, (2 + 2 * s) * err));
    const alpha = Math.max(-aMax, Math.min(aMax, (4 + 4 * s) * (wWant - ship.omega)));
    const torque = ship.inertia * alpha;
    // Thrust only once roughly pointing the right way: full when aligned, none past 60°.
    // Aiming, it still thrusts along the nose when that helps (as against a shot's recoil).
    const along = (goal.kind === "velocity" || goal.kind === "hover") ? Math.max(0, dot(force, axis)) * Math.max(0, (cosErr - 0.5) / 0.5) : 0;
    const fBody = scale(axisBody, along * authority);

    // Allocate: rows are body-frame force x, y, and torque; torque weighted most.
    const A = [chans.map((c) => c.gain * c.direction.x), chans.map((c) => c.gain * c.direction.y), chans.map((c) => c.gain * cross(c.point, c.direction))];
    const scaleT = Math.max(1, ...chans.map((c) => Math.abs(c.gain * cross(c.point, c.direction))));
    const scaleF = Math.max(1, ...chans.map((c) => c.gain));
    const u = allocate(A, [fBody.x, fBody.y, torque * authority], [1 / (scaleF * scaleF), 1 / (scaleF * scaleF), 25 / (scaleT * scaleT)], chans.length);
    const decay = 1 - expD(-(p.interval * INTERVAL_TICK) / ENGINE_LAG);
    chans.forEach((c, i) => {
      // The engines' lagged response to what was last commanded, over the coming interval.
      const prev = p.lagged[c.channel] ?? 0;
      p.lagged[c.channel] = prev + (u[i] - prev) * decay;
      p.command[c.channel] = u[i];
      world.controls[c.channel] = u[i];
    });
    // The trigger: a short press, held for the pulse (AIP-012).
    if (gun && (mode === "hunting" || mode === "cautious")) world.controls[gun.channel] = p.command[gun.channel] = cb.pulse > 0 ? 1 : 0;
    if (cb.pulse > 0) cb.pulse -= 1;
    p.seen = { tick: world.tick, velocity: ship.velocity, omega: ship.omega, quiet };
  }
}
