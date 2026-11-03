// Conservation ledger (LED-001…LED-003).
// After every step the ledger records totals over all dynamic (non-fixed) bodies,
// what each source contributed during the step, and the unattributed residual.
// A residual above the profile tolerance is recorded as a violation.

import { cross, dot, type Vec2 } from "./math.ts";
import { massProps } from "./shapes.ts";
import type { World } from "./world.ts";

export interface Totals {
  mass: number; // kg
  momentum: Vec2; // kg·m/s
  /** About the world origin, kg·m²/s. */
  angularMomentum: number;
  energy: {
    kinetic: number; // J
    potential: number; // J, gravitational
    thermal: number; // J, heat from contacts
    chemical: number; // J
    total: number; // J
  };
}

/** One set of changes over a step. */
export interface Delta {
  mass: number;
  momentumX: number;
  momentumY: number;
  angularMomentum: number;
  energy: number;
}

export type Source = "user" | "field" | "contact" | "correction";
export const SOURCES: readonly Source[] = ["user", "field", "contact", "correction"];

export interface StepLedger {
  tick: number;
  /** What each source contributed. `field` and `correction` energy are the integrator's and position solver's numerical work. */
  sources: Record<Source, Delta>;
  residual: Delta;
}

export interface Ledger {
  totals: Totals;
  /** Accumulated heat from contacts, J. */
  thermal: number;
  chemical: number;
  violations: number;
  last: StepLedger | null;
  /** Largest |residual| seen so far, per quantity. */
  maxResidual: Delta;
}

export const zeroDelta = (): Delta => ({ mass: 0, momentumX: 0, momentumY: 0, angularMomentum: 0, energy: 0 });

export function addDelta(into: Delta, d: Delta): void {
  into.mass += d.mass;
  into.momentumX += d.momentumX;
  into.momentumY += d.momentumY;
  into.angularMomentum += d.angularMomentum;
  into.energy += d.energy;
}

export function diff(a: Totals, b: Totals): Delta {
  return {
    mass: b.mass - a.mass,
    momentumX: b.momentum.x - a.momentum.x,
    momentumY: b.momentum.y - a.momentum.y,
    angularMomentum: b.angularMomentum - a.angularMomentum,
    energy: b.energy.total - a.energy.total,
  };
}

export function computeTotals(world: World, thermal = world.ledger.thermal, chemical = world.ledger.chemical): Totals {
  let mass = 0;
  let px = 0;
  let py = 0;
  let L = 0;
  let ke = 0;
  let pe = 0;
  const g = world.gravity;
  for (const b of world.bodies) {
    if (b.fixed) continue;
    const { inertia } = massProps(b.shape, b.mass);
    const v = b.velocity;
    mass += b.mass;
    px += b.mass * v.x;
    py += b.mass * v.y;
    L += b.mass * cross(b.position, v) + inertia * b.angularVelocity;
    ke += 0.5 * b.mass * dot(v, v) + 0.5 * inertia * b.angularVelocity * b.angularVelocity;
    pe -= b.mass * dot(g, b.position);
  }
  return {
    mass,
    momentum: { x: px, y: py },
    angularMomentum: L,
    energy: { kinetic: ke, potential: pe, thermal, chemical, total: ke + pe + thermal + chemical },
  };
}

export function emptyLedger(): Ledger {
  return {
    totals: { mass: 0, momentum: { x: 0, y: 0 }, angularMomentum: 0, energy: { kinetic: 0, potential: 0, thermal: 0, chemical: 0, total: 0 } },
    thermal: 0,
    chemical: 0,
    violations: 0,
    last: null,
    maxResidual: zeroDelta(),
  };
}
