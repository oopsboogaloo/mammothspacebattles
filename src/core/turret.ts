// Fixed gun turrets (WPN-009, WPN-010; docs/games/mammoth-thrust-design.md §2.1–2.3): a railgun on a
// carriage that a turned joint (ASM-008) aims. The turret is not a pilot. While it can see its
// target it picks a bearing, turns the gun to it, fires once the gun is on it, holds, and picks
// again. Everything else about it (its pieces, what breaks, what explodes) is the shared physics.
//
// Power is one small rule, until the engine has a power model: a battery holds a few shots, and a
// generator that is whole and has fuel refills it.

import { assemblyRoots } from "./joints.ts";
import { cross, dot, length, rotate, sinCos, sub, type Vec2 } from "./math.ts";
import { createRng, nextFloat, type RngState } from "./prng.ts";
import { railgunReady } from "./railgun.ts";
import { localVertices } from "./shapes.ts";
import type { Body, Joint, World } from "./world.ts";

/** A joint that can be turned (ASM-008): its rest angle moves toward `target` at `rate`, inside `min` and `max`. */
export interface JointTurn {
  /** How fast the rest angle moves, rad/s. */
  rate: number;
  /** The least and most the rest angle (b's angle less a's) may be, rad. */
  min: number;
  max: number;
  /** Where the rest angle is going, rad. */
  target: number;
}

export interface Turret {
  /** The turned joint that aims it: this body is the joint's `b` (the gun's carriage). */
  joint: string;
  /** The body with the railgun, welded to the carriage (or the carriage itself). Its bore is along its +y. */
  gun: string;
  /** The gun's barrel, if it is a separate piece: knocked off, the turret can't fire. */
  barrel?: string;
  /** The body that holds its shots (`charge`). Without one, it needs no power. */
  battery?: string;
  /** How far it sees, m. */
  range: number;
  /** Seconds from first sight to its first shot. */
  wait: number;
  /** Seconds it holds after a shot before picking again. */
  hold: number;
  /** "random": a bearing anywhere in the joint's arc. "ship": the target's present bearing, with a random error. */
  aim: "random" | "ship";
  /** The most the error is, either way, rad ("ship"). */
  spread: number;
  /** Seeds its own generator: the same seed, the same bearings. */
  seed: number;
  /** Off, it turns and fires nothing (Mammoth Thrust's factory stops its turrets this way). */
  enabled: boolean;
  /** The body it watches for, by id: set by the scenario, or by a game each step. */
  target?: string;
  /** State. */
  phase: "idle" | "waiting" | "turning" | "holding";
  /** State: when the wait or the hold ends, s. */
  until: number;
  /** State: it sees its target this step. */
  sees: boolean;
  /** State: this shot's error, rad ("ship"). */
  error: number;
  /** State: it is holding its gun's channel on this step. */
  firing: boolean;
  /** State: shots so far. */
  shots: number;
  rng: RngState;
}

export type TurretInput = Pick<Turret, "joint" | "gun"> & Partial<Omit<Turret, "joint" | "gun" | "rng">>;

export const TURRET_DEFAULTS = { range: 80, wait: 1.5, hold: 0.25, aim: "random" as const, spread: 0.14, seed: 1, enabled: true, phase: "idle" as const, until: 0, sees: false, error: 0, firing: false, shots: 0 };

export function normalizeTurret(t: TurretInput): Turret {
  return { ...TURRET_DEFAULTS, ...t, rng: createRng(t.seed ?? TURRET_DEFAULTS.seed) };
}

/** A battery's shots (WPN-010). */
export interface Charge {
  shots: number;
  capacity: number;
}

/** A generator (WPN-010): while it is whole and has fuel it burns `burn` kg/s of its own stores and adds `rate` shots a second to its battery. */
export interface Generator {
  battery: string;
  burn: number;
  rate: number;
}

/** On its bearing: the rest angle within this of where it is going, and the gun within this of the rest angle, rad. */
const ON_BEARING = 0.02;
const SETTLED = 0.05;
/** A mount, carriage or joint this damaged no longer turns. */
const STUCK = 0.3;

/**
 * Moves every turned joint's rest angle toward its target (ASM-008), at its rate times the health of
 * the joint and its two bodies (a damaged mount turns slower, and below 30% not at all). The weld
 * solver then holds the bodies at the new angle, as it holds any weld.
 */
export function turnJoints(world: World, dt: number): void {
  for (const j of world.joints) {
    const t = j.turn;
    if (!t) continue;
    const a = world.bodies.find((b) => b.id === j.a);
    const b = world.bodies.find((x) => x.id === j.b);
    const health = Math.min(j.integrity, a?.integrity ?? 0, b?.integrity ?? 0);
    if (health < STUCK) continue;
    const to = Math.min(t.max, Math.max(t.min, t.target));
    const step = t.rate * health * dt;
    const d = to - j.referenceAngle;
    j.referenceAngle = Math.abs(d) <= step ? to : j.referenceAngle + Math.sign(d) * step;
  }
}

/** Whether the straight line from a to b is clear of every fixed body. */
function clearLine(world: World, a: Vec2, b: Vec2): boolean {
  const d = sub(b, a);
  for (const o of world.bodies) {
    if (!o.fixed || o.shape.kind === "disc") continue;
    const q = sinCos(o.angle);
    const vs = localVertices(o.shape);
    let p = { x: o.position.x + q.c * vs[vs.length - 1].x - q.s * vs[vs.length - 1].y, y: o.position.y + q.s * vs[vs.length - 1].x + q.c * vs[vs.length - 1].y };
    for (const v of vs) {
      const w = { x: o.position.x + q.c * v.x - q.s * v.y, y: o.position.y + q.s * v.x + q.c * v.y };
      const e = sub(w, p);
      const den = cross(d, e);
      if (den !== 0) {
        const ap = sub(p, a);
        const t = cross(ap, e) / den;
        const u = cross(ap, d) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) return false;
      }
      p = w;
    }
  }
  return true;
}

/**
 * Whether a turret can still fire: its carriage, its gun (and barrel) and its joint whole and joined,
 * its mount fit to turn, and its battery if it has one.
 */
export function turretWorks(world: World, carriage: Body): boolean {
  const t = carriage.turret;
  if (!t || carriage.integrity <= 0) return false;
  const joint = world.joints.find((j) => j.id === t.joint);
  const gun = world.bodies.find((b) => b.id === t.gun);
  if (!joint || joint.b !== carriage.id || !gun || gun.integrity <= 0 || !gun.magazine?.railgun) return false;
  const mount = world.bodies.find((b) => b.id === joint.a);
  if (!joint.turn || Math.min(joint.integrity, mount?.integrity ?? 0, carriage.integrity) < STUCK) return false;
  const roots = assemblyRoots(world);
  const root = roots.get(joint.a);
  if (roots.get(gun.id) !== root) return false;
  if (t.barrel !== undefined) {
    const barrel = world.bodies.find((b) => b.id === t.barrel);
    if (!barrel || barrel.integrity <= 0 || roots.get(barrel.id) !== root) return false;
  }
  if (t.battery !== undefined) {
    const battery = world.bodies.find((b) => b.id === t.battery);
    if (!battery || battery.integrity <= 0 || !battery.charge || roots.get(battery.id) !== root) return false;
  }
  return true;
}

function setChannel(world: World, channel: string, value: number): void {
  if ((world.controls[channel] ?? 0) !== value) world.controls = { ...world.controls, [channel]: value };
}

/**
 * Runs every generator and turret for one step (WPN-009, WPN-010). Returns the fuel the generators
 * burned, kg: it leaves the world.
 */
export function runTurrets(world: World, dt: number): number {
  let burned = 0;
  const now = world.time;
  // Generators: fuel in, shots out.
  for (const g of world.bodies) {
    const gen = g.generator;
    if (!gen || g.integrity <= 0) continue;
    const battery = world.bodies.find((b) => b.id === gen.battery);
    if (!battery?.charge || battery.integrity <= 0 || battery.charge.shots >= battery.charge.capacity) continue;
    const stores = g.contents ?? [];
    const have = stores.reduce((m, s) => m + s.mass, 0);
    const need = gen.burn * dt;
    if (have < need || need <= 0) continue;
    for (const s of stores) s.mass -= (need * s.mass) / have;
    burned += need;
    battery.charge.shots = Math.min(battery.charge.capacity, battery.charge.shots + gen.rate * dt);
  }

  for (const c of world.bodies) {
    const t = c.turret;
    if (!t) continue;
    const gun = world.bodies.find((b) => b.id === t.gun);
    const channel = gun?.magazine?.railgun?.channel;
    // Last step's shot is over: the channel is held on for one step.
    if (t.firing && channel) setChannel(world, channel, 0);
    t.firing = false;
    const joint: Joint | undefined = world.joints.find((j) => j.id === t.joint);
    if (!gun || !channel || !joint?.turn || !t.enabled || !turretWorks(world, c)) {
      t.sees = false;
      if (t.phase !== "idle" && t.phase !== "waiting") t.phase = "turning"; // it starts again from a fresh bearing
      continue;
    }
    const target = t.target !== undefined ? world.bodies.find((b) => b.id === t.target) : undefined;
    const to = target ? sub(target.position, gun.position) : { x: 0, y: 0 };
    const dist = length(to);
    t.sees = !!target && dist <= t.range && dist > 1e-6 && clearLine(world, gun.position, target.position);
    if (!t.sees) continue; // the gun stops where it is

    const pick = (): void => {
      t.phase = "turning";
      t.error = (2 * nextFloat(t.rng) - 1) * t.spread;
      if (t.aim === "random") joint.turn!.target = joint.turn!.min + (joint.turn!.max - joint.turn!.min) * nextFloat(t.rng);
    };
    if (t.phase === "idle") {
      t.phase = "waiting";
      t.until = now + t.wait;
    }
    if (t.phase === "waiting" || t.phase === "holding") {
      if (now < t.until - 1e-9) continue;
      pick();
    }
    // Turning. Aiming at the ship, the bearing follows it: the gun's bore is its +y.
    let onTarget = true;
    if (t.aim === "ship") {
      const bore = rotate(sinCos(gun.angle + (gun.magazine?.angle ?? 0) - t.error), { x: 0, y: 1 });
      const s = cross(bore, to) / dist; // the sine of the angle from the bore round to the target
      const ahead = dot(bore, to) > 0;
      joint.turn.target = joint.referenceAngle + (ahead ? s : s >= 0 ? 1 : -1);
      onTarget = ahead && Math.abs(s) < ON_BEARING;
      // Out of its arc: it can't get there.
      if (!onTarget && (joint.referenceAngle <= joint.turn.min + 1e-9 || joint.referenceAngle >= joint.turn.max - 1e-9) && Math.abs(Math.min(joint.turn.max, Math.max(joint.turn.min, joint.turn.target)) - joint.referenceAngle) < 1e-9) continue;
    } else {
      onTarget = Math.abs(Math.min(joint.turn.max, Math.max(joint.turn.min, joint.turn.target)) - joint.referenceAngle) < 1e-9;
    }
    const a = world.bodies.find((b) => b.id === joint.a);
    const settled = !!a && Math.abs(c.angle - a.angle - joint.referenceAngle) < SETTLED;
    if (!onTarget || !settled || !railgunReady(gun)) continue;
    const battery = t.battery !== undefined ? world.bodies.find((b) => b.id === t.battery)?.charge : undefined;
    if (t.battery !== undefined && (!battery || battery.shots < 1)) continue; // waiting on power
    if (battery) battery.shots -= 1;
    setChannel(world, channel, 1);
    t.firing = true;
    t.shots += 1;
    t.phase = "holding";
    t.until = now + t.hold;
    world.events.push({ tick: world.tick, type: "turret.fire", data: { id: c.id, angle: joint.referenceAngle } });
  }
  return burned;
}
