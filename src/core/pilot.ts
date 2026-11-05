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
import { assemblyOf } from "./joints.ts";
import { massProps } from "./shapes.ts";
import type { Body, World } from "./world.ts";

export type PilotGoal = { kind: "heading"; angle: number } | { kind: "velocity"; velocity: Vec2 } | { kind: "hover" } | { kind: "idle" };

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
  /** Steps between decisions. */
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
}

export const PILOT_DEFAULTS: Omit<Pilot, "goal"> = { skill: { flight: 0.7, combat: 0.5 }, interval: 8, next: 0, command: {}, lagged: {}, intent: "" };

export type PilotInput = Partial<Omit<Pilot, "skill">> & { skill?: Partial<Pilot["skill"]> };

export function normalizePilot(p: PilotInput): Pilot {
  return { ...PILOT_DEFAULTS, goal: { kind: "idle" }, ...p, skill: { ...PILOT_DEFAULTS.skill, ...p.skill }, command: { ...p.command }, lagged: { ...p.lagged } };
}

/** Exhaust speed the design assumes before the pilot has seen its engines work, m/s: low on purpose. */
const DESIGN_EXHAUST_SPEED = 100;
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

/**
 * Runs every pilot for one step (AIP-001, AIP-002): on its decision steps it reads the ship and the
 * world, learns from what its last commands did, decides, and sets its channels. Between decisions
 * its channels hold.
 */
export function runPilots(world: World, dt: number): void {
  for (const body of world.bodies) {
    const p = body.pilot;
    if (!p) continue;
    if (body.integrity <= 0) {
      p.intent = "wrecked";
      continue;
    }
    if (world.tick < p.next) continue;
    p.next = world.tick + Math.max(1, Math.floor(p.interval));
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
    const goal = p.goal;
    if (goal.kind === "heading") {
      const h = sinCos(goal.angle);
      want = { x: h.c, y: h.s };
      p.intent = `hold heading ${goal.angle.toFixed(2)} rad`;
    } else if (goal.kind === "velocity" || goal.kind === "hover") {
      const v = goal.kind === "velocity" ? goal.velocity : { x: 0, y: 0 };
      const k = 0.8 + 1.2 * s; // 1/s
      const raw = sub(v, ship.velocity);
      // An error along the thrust axis is fixed by throttle alone, and always is. One across it,
      // or one that needs braking, means turning the ship: small ones are let be (a tolerance
      // that shrinks with skill), with hysteresis, or every overshoot would set it turning.
      const tol = 0.15 + 0.35 * (1 - s);
      const eAlong = dot(raw, axis);
      const turn = add(sub(raw, scale(axis, eAlong)), scale(axis, Math.min(0, eAlong)));
      if (length(turn) < tol) p.settled = true;
      else if (length(turn) > 2 * tol) p.settled = false;
      const e = add(scale(axis, Math.max(0, eAlong)), p.settled ? { x: 0, y: 0 } : turn);
      // A slow integral of the error along the thrust axis, so a steady one (a hover sinking on a
      // misjudged engine) is worked off by throttle. Signed, so an overshoot winds it back down;
      // never negative, since it can only add throttle; and only near the wanted velocity, or it
      // would wind up while accelerating toward it.
      if (length(raw) < 1) p.trim = Math.min(2, Math.max(0, (p.trim ?? 0) + (eAlong < 0 ? 4 : 1) * eAlong * p.interval * dt)); // unwinds fast on overshoot
      const a = add(scale(e, k), scale(axis, 0.3 * k * (p.trim ?? 0)));
      force = scale(sub(a, g), ship.mass); // what the engines must supply, gravity included
      // Point the thrust axis along the force only when there is a force worth pointing for: a
      // few percent of what the engines can give. Below that, chasing its direction just spins.
      const most = chans.reduce((m, c) => m + c.gain, 0);
      if (length(force) > 0.03 * most) want = scale(force, 1 / length(force));
      p.intent = goal.kind === "hover" ? "hover" : `hold velocity ${v.x.toFixed(1)}, ${v.y.toFixed(1)} m/s`;
    } else p.intent = "idle";

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
    const along = goal.kind === "velocity" || goal.kind === "hover" ? Math.max(0, dot(force, axis)) * Math.max(0, (cosErr - 0.5) / 0.5) : 0;
    const fBody = scale(axisBody, along * authority);

    // Allocate: rows are body-frame force x, y, and torque; torque weighted most.
    const A = [chans.map((c) => c.gain * c.direction.x), chans.map((c) => c.gain * c.direction.y), chans.map((c) => c.gain * cross(c.point, c.direction))];
    const scaleT = Math.max(1, ...chans.map((c) => Math.abs(c.gain * cross(c.point, c.direction))));
    const scaleF = Math.max(1, ...chans.map((c) => c.gain));
    const u = allocate(A, [fBody.x, fBody.y, torque * authority], [1 / (scaleF * scaleF), 1 / (scaleF * scaleF), 25 / (scaleT * scaleT)], chans.length);
    const decay = 1 - expD(-(p.interval * dt) / ENGINE_LAG);
    chans.forEach((c, i) => {
      // The engines' lagged response to what was last commanded, over the coming interval.
      const prev = p.lagged[c.channel] ?? 0;
      p.lagged[c.channel] = prev + (u[i] - prev) * decay;
      p.command[c.channel] = u[i];
      world.controls[c.channel] = u[i];
    });
    p.seen = { tick: world.tick, velocity: ship.velocity, omega: ship.omega, quiet };
  }
}
