// The world's units (docs/units-rescale-plan.md): how many of a world's length and mass units make
// one of the core's own. A world built with units {length: 4, mass: 1024} is the same world as one
// with {1, 1} and every quantity multiplied by its factor (lengths ×4, masses ×1024, speeds ×4,
// energies ×16,384, …; time is never scaled). Every constant the core writes in its own units is
// taken through `factor`, so it scales with the world: the proof is the units test, which runs each
// scenario both ways and finds them equal bit for bit after dividing by the factors (powers of two
// make that exact).

import type { Profile } from "./profile.ts";

export interface Units {
  length: number;
  mass: number;
}

/** A quantity's dimension: its exponents of length, mass and time. Time never scales. */
export type Dim = readonly [l: number, m: number, t: number];

export const BASE_UNITS: Units = { length: 1, mass: 1 };

const powInt = (x: number, n: number): number => {
  let r = 1;
  const b = n < 0 ? 1 / x : x;
  for (let i = 0; i < Math.abs(n); i++) r *= b;
  return r;
};

/** What a quantity of dimension `d` is multiplied by in `units`. */
export const factor = (units: Units | undefined, d: Dim): number =>
  units ? powInt(units.length, d[0]) * powInt(units.mass, d[1]) : 1;

// The dimensions used most.
export const D = {
  none: [0, 0, 0],
  length: [1, 0, 0],
  area: [2, 0, 0],
  mass: [0, 1, 0],
  speed: [1, 0, -1],
  accel: [1, 0, -2],
  force: [1, 1, -2],
  momentum: [1, 1, -1],
  energy: [2, 1, -2],
  inertia: [2, 1, 0],
  angularMomentum: [2, 1, -1],
  massRate: [0, 1, -1],
  density: [-2, 1, 0],
  pressure: [0, 1, -2], // 2D: force per length; also stiffness, N/m
  damping: [0, 1, -1], // N·s/m
  specificEnergy: [2, 0, -2],
  mu: [3, 0, -2],
  perLength: [-1, 0, 0],
  perMass: [0, -1, 0],
  perEnergy: [-2, -1, 2],
  power: [2, 1, -3],
  G: [3, -1, -2], // mu per kg
  hitBurn: [-1, 0, 1], // kg per N·s
  hitDraw: [1, 0, -1], // J per N·s
} as const satisfies Record<string, Dim>;


const profiles = new WeakMap<Profile, Map<string, Profile>>();

/** A profile in `units`: its tolerances and limits scaled (cached, so a world's profile stays one object). */
export function scaledProfile(p: Profile, units: Units | undefined): Profile {
  if (!units || (units.length === 1 && units.mass === 1)) return p;
  const key = `${units.length}|${units.mass}`;
  let byUnits = profiles.get(p);
  if (!byUnits) profiles.set(p, (byUnits = new Map()));
  const hit = byUnits.get(key);
  if (hit) return hit;
  const f = (d: Dim) => factor(units, d);
  const out: Profile = {
    ...p,
    // Gas (DEC-13): its scale divides every molar mass, so specific energies (L²/T²) at a temperature
    // grow as it shrinks; temperatures are kept.
    gasScale: (p.gasScale ?? 1) / f(D.specificEnergy),
    tol: {
      ...p.tol,
      mass: p.tol.mass * f(D.mass),
      momentum: p.tol.momentum * f(D.momentum),
      angularMomentum: p.tol.angularMomentum * f(D.angularMomentum),
      energy: p.tol.energy * f(D.energy),
      penetration: p.tol.penetration * f(D.length),
    },
    limit: { ...p.limit, maxSpeed: p.limit.maxSpeed * f(D.speed), minThickness: p.limit.minThickness * f(D.length), minFragment: p.limit.minFragment * f(D.length) },
  };
  byUnits.set(key, out);
  return out;
}
