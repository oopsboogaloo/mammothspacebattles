// Probe paths with derived values (SCN-003). Besides plain paths into the world
// ("bodies[id=a].velocity.x"), two derived roots exist:
//   gas.<field>               totals over all parcels: mass, momentum.x, temperature, removed.mass, …
//   assembly[id=X].<field>    the assembly body X belongs to, as one rigid body: mass, momentum.x,
//                             velocity.x, angularVelocity, centre.x, angularMomentum, count

import { bodyMass } from "./bodies.ts";
import { gasTotals } from "./gas.ts";
import { assemblyOf } from "./joints.ts";
import { cross } from "./math.ts";
import { resolvePath } from "./path.ts";
import { massProps } from "./shapes.ts";
import type { World } from "./world.ts";

export interface AssemblyTotals {
  count: number;
  mass: number;
  centre: { x: number; y: number };
  momentum: { x: number; y: number };
  velocity: { x: number; y: number };
  /** About its centre of mass, rad/s. */
  angularVelocity: number;
  /** About the world origin, kg·m²/s. */
  angularMomentum: number;
  kinetic: number;
}

export function assemblyTotals(world: World, id: string): AssemblyTotals | undefined {
  if (!world.bodies.some((b) => b.id === id)) return undefined;
  const members = assemblyOf(world, id).map((m) => world.bodies.find((b) => b.id === m)!);
  let M = 0;
  let cx = 0;
  let cy = 0;
  let px = 0;
  let py = 0;
  let L = 0;
  let ke = 0;
  const parts = members.map((b) => {
    const m = bodyMass(b);
    const I = massProps(b.shape, m).inertia;
    M += m;
    cx += m * b.position.x;
    cy += m * b.position.y;
    px += m * b.velocity.x;
    py += m * b.velocity.y;
    L += m * cross(b.position, b.velocity) + I * b.angularVelocity;
    ke += 0.5 * m * (b.velocity.x ** 2 + b.velocity.y ** 2) + 0.5 * I * b.angularVelocity ** 2;
    return { b, m, I };
  });
  const c = { x: cx / M, y: cy / M };
  const v = { x: px / M, y: py / M };
  let Ic = 0;
  let Lc = 0;
  for (const { b, m, I } of parts) {
    const dx = b.position.x - c.x;
    const dy = b.position.y - c.y;
    Ic += I + m * (dx * dx + dy * dy);
    Lc += m * (dx * (b.velocity.y - v.y) - dy * (b.velocity.x - v.x)) + I * b.angularVelocity;
  }
  return { count: members.length, mass: M, centre: c, momentum: { x: px, y: py }, velocity: v, angularVelocity: Lc / Ic, angularMomentum: L, kinetic: ke };
}

/** Resolves a probe path, including the derived gas and assembly roots. */
export function resolveProbe(world: World, path: string): unknown {
  if (path.startsWith("gas.")) {
    const rest = path.slice(4);
    const v = resolvePath(gasTotals(world.gas), rest);
    return v !== undefined ? v : resolvePath(world.gas, rest);
  }
  const m = /^assembly\[id=([^\]]+)\]\.(.+)$/.exec(path);
  if (m) {
    const t = assemblyTotals(world, m[1]);
    return t ? resolvePath(t, m[2]) : undefined;
  }
  return resolvePath(world, path);
}
