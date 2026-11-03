// Landing challenge (FLT-005…FLT-008): bring a ship to rest on a pad, gently and upright.
//
// The judge runs at the end of every step and lives in the world, so a run, a replay and a scrub
// back all reach the same verdict at the same step. It only reads the world: it never pushes on
// anything, and the ledger is unchanged.

import { assemblyOf } from "./joints.ts";
import { assemblyTotals } from "./probes.ts";
import { localVertices, type Shape } from "./shapes.ts";
import { rotate, sinCos, type Vec2 } from "./math.ts";
import type { World } from "./world.ts";

export interface LandingGoal {
  kind: "landing";
  /** A body of the ship. Its whole assembly counts; this body's angle is the ship's tilt (0 = upright). */
  ship: string;
  /** The fixed body to land on. */
  pad: string;
  /** Fastest closing speed at a touch on the pad that still counts as a landing, m/s. */
  maxSpeed: number;
  /** Largest tilt from upright the ship may come to rest at, degrees. */
  maxTilt: number;
}

export type LandingPhase = "flying" | "landed" | "crashed";

export interface LandingStatus {
  phase: LandingPhase;
  /** Why it crashed, or how it landed, in words. */
  reason?: string;
  /** Step of the verdict. */
  at?: number;
  /** The first touch on the pad: its closing speed, m/s. */
  touchdown?: number;
  /** Lowest point of the ship above the top of the pad, m. */
  altitude: number;
  /** Ship's velocity (its assembly's centre of mass), m/s. */
  vx: number;
  vy: number;
  /** Tilt from upright, degrees; positive is anticlockwise. */
  tilt: number;
  /** Propellant left in the ship's stores, kg. */
  fuel: number;
  /** Propellant at the start, kg. */
  fuelStart: number;
  /** Score once landed: up to 500 for fuel left, up to 500 for a soft touchdown. */
  score?: number;
  /** Time the ship has been at rest on the pad since, s (cleared when it moves). */
  restSince?: number;
  /** Last time the ship touched the pad, s. */
  padAt?: number;
}

export interface Challenge {
  goal: LandingGoal;
  status: LandingStatus;
}

/** Slower than this, in m/s and rad/s, counts as at rest: a ship bobbing gently on its legs still settles. */
export const REST_SPEED = 0.3;
export const REST_SPIN = 0.3;
/** How long the ship must stay at rest on the pad for the verdict, s. */
export const SETTLE_TIME = 0.5;
/** A bounce off the pad shorter than this doesn't interrupt settling, s. */
export const BOUNCE_TIME = 0.1;

const degrees = (a: number) => {
  let d = (a * 180) / Math.PI;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return d;
};

function lowest(shape: Shape, position: Vec2, angle: number): number {
  if (shape.kind === "disc") return position.y - shape.radius;
  const q = sinCos(angle);
  let y = Infinity;
  for (const v of localVertices(shape)) y = Math.min(y, position.y + rotate(q, v).y);
  return y;
}

function highest(shape: Shape, position: Vec2, angle: number): number {
  if (shape.kind === "disc") return position.y + shape.radius;
  const q = sinCos(angle);
  let y = -Infinity;
  for (const v of localVertices(shape)) y = Math.max(y, position.y + rotate(q, v).y);
  return y;
}

/** Ship telemetry for the HUD and the judge. */
export function landingTelemetry(world: World, goal: LandingGoal): Omit<LandingStatus, "phase" | "fuelStart"> & { spin: number; members: Set<string> } {
  const members = new Set(assemblyOf(world, goal.ship));
  const ship = world.bodies.find((b) => b.id === goal.ship);
  const pad = world.bodies.find((b) => b.id === goal.pad);
  const totals = assemblyTotals(world, goal.ship);
  let low = Infinity;
  let fuel = 0;
  for (const b of world.bodies) {
    if (!members.has(b.id)) continue;
    for (const st of b.contents ?? []) fuel += st.mass;
    low = Math.min(low, lowest(b.shape, b.position, b.angle));
  }
  const padTop = pad ? highest(pad.shape, pad.position, pad.angle) : 0;
  return {
    members,
    altitude: Number.isFinite(low) ? low - padTop : 0,
    vx: totals?.velocity.x ?? 0,
    vy: totals?.velocity.y ?? 0,
    spin: totals?.angularVelocity ?? 0,
    tilt: ship ? degrees(ship.angle) : 0,
    fuel,
  };
}

export function startLanding(world: World, goal: LandingGoal): Challenge {
  const t = landingTelemetry(world, goal);
  return { goal, status: { phase: "flying", altitude: t.altitude, vx: t.vx, vy: t.vy, tilt: t.tilt, fuel: t.fuel, fuelStart: t.fuel } };
}

const fmt = (x: number, digits = 1) => x.toFixed(digits);

/**
 * Updates the verdict after a step. `fromTick` is the tick the step started at: collision events
 * from that tick on are this step's. Once landed or crashed the verdict stays; only telemetry updates.
 * Returns the new verdict if it changed this step.
 */
export function judgeLanding(world: World, c: Challenge, fromTick: number): LandingPhase | null {
  const { goal } = c;
  const t = landingTelemetry(world, goal);
  const s = c.status;
  s.altitude = t.altitude;
  s.vx = t.vx;
  s.vy = t.vy;
  s.tilt = t.tilt;
  s.fuel = t.fuel;
  if (s.phase !== "flying") return null;

  const crash = (reason: string): LandingPhase => {
    s.phase = "crashed";
    s.reason = reason;
    s.at = world.tick;
    return "crashed";
  };

  // New touches between the ship and anything else.
  for (const e of world.events) {
    if (e.tick < fromTick || e.type !== "collision") continue;
    const a = String(e.data.a);
    const b = String(e.data.b);
    const aIn = t.members.has(a);
    const bIn = t.members.has(b);
    if (aIn === bIn) continue;
    const other = aIn ? b : a;
    const speed = Number(e.data.speed);
    if (other !== goal.pad) {
      const body = world.bodies.find((x) => x.id === other);
      return crash(body?.fixed ? `Touched the ground off the pad, at ${fmt(speed)} m/s.` : `Hit ${other}.`);
    }
    if (speed > goal.maxSpeed) return crash(`Hit the pad at ${fmt(speed, 2)} m/s: land slower than ${fmt(goal.maxSpeed)} m/s.`);
    if (s.touchdown === undefined) s.touchdown = speed;
  }

  // At rest on the pad: landed, or tipped over.
  if (world.contacts.some((k) => (k.a === goal.pad && t.members.has(k.b)) || (k.b === goal.pad && t.members.has(k.a)))) s.padAt = world.time;
  const onPad = s.padAt !== undefined && world.time - s.padAt <= BOUNCE_TIME + 1e-9;
  const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);
  if (!(onPad && speed < REST_SPEED && Math.abs(t.spin) < REST_SPIN)) {
    s.restSince = undefined;
    return null;
  }
  s.restSince ??= world.time;
  if (world.time - s.restSince >= SETTLE_TIME - 1e-9) {
    if (Math.abs(t.tilt) > goal.maxTilt) return crash(`Came to rest tilted ${fmt(Math.abs(t.tilt), 0)}°: land within ${fmt(goal.maxTilt, 0)}° of upright.`);
    const touch = s.touchdown ?? 0;
    const fuelPart = s.fuelStart > 0 ? s.fuel / s.fuelStart : 0;
    s.score = Math.round(500 * fuelPart + 500 * Math.max(0, 1 - touch / goal.maxSpeed));
    s.phase = "landed";
    s.at = world.tick;
    s.reason = `Landed at ${fmt(touch)} m/s, ${fmt(Math.abs(t.tilt), 0)}° from upright, with ${fmt(s.fuel, 2)} kg of propellant left.`;
    return "landed";
  }
  return null;
}
