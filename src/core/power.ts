// Power (PWR-001…PWR-004; docs/blueprint/design-rules-proposal.md §4, approved 16 November 2026):
// batteries store energy, generators refill them by burning the ship's propellant, and the shield,
// railguns, tractor beam and tether draw on them.
//
// A ship's batteries are pooled: every battery welded into one assembly serves every device on it.
// A ship with neither a battery nor a generator has no power system: its devices work as they did
// before power existed (the games' own ships, THRUST OG). Energy is in kJ, power in kW.
//
// Stored energy is not part of the conservation ledger (it never was: the railgun's launch energy is
// recorded under `power`). The fuel a generator burns leaves the world as the shield's always has,
// and the step records it at the boundary.

import { assemblyRoots } from "./joints.ts";
import type { Body, World } from "./world.ts";
import { D, factor } from "./units.ts";

export interface Power {
  /** A battery: what it can hold, kJ, and what it holds (state; full at the start). */
  capacity?: number;
  stored?: number;
  /** A generator: the most it makes, kW, and the energy it makes from each kg of propellant, kJ/kg. */
  output?: number;
  perKg?: number;
  /** State: how hard a generator worked last step, 0 to 1. */
  load?: number;
}

/** Too little fuel to burn, kg. */
const DRY = 1e-9;

const isBattery = (b: Body) => (b.power?.capacity ?? 0) > 0 && b.integrity > 0;
const isGenerator = (b: Body) => (b.power?.output ?? 0) > 0 && b.integrity > 0;
/** A tank a generator can burn from: propellant in stores, not an engine's own. */
const isTank = (b: Body, dry: number) => !b.injector && (b.contents ?? []).some((c) => c.mass > dry && (c.resource === "h2" || c.resource === "o2"));

/** The batteries and generators on the same assembly as a body, or null if that ship has no power system. */
function systemOf(world: World, roots: ReadonlyMap<string, string>, id: string): { batteries: Body[]; generators: Body[] } | null {
  const root = roots.get(id);
  const batteries: Body[] = [];
  const generators: Body[] = [];
  for (const b of world.bodies) {
    if (!b.power || roots.get(b.id) !== root) continue;
    if (isBattery(b)) batteries.push(b);
    if (isGenerator(b)) generators.push(b);
  }
  // A ship that was built with power but lost every battery and generator has none to give.
  if (!batteries.length && !generators.length) return world.bodies.some((b) => b.power && roots.get(b.id) === root) ? { batteries, generators } : null;
  return { batteries, generators };
}

/**
 * Draws `kJ` from the batteries on a body's ship, in proportion to what each holds (PWR-002). With
 * too little stored, it draws nothing and returns false. A ship with no power system always has
 * enough (returns true, draws nothing).
 */
export function takeEnergy(world: World, roots: ReadonlyMap<string, string> | null, id: string, kJ: number): boolean {
  if (!(kJ > 0)) return true;
  if (!world.bodies.some((b) => b.power)) return true;
  const sys = systemOf(world, roots ?? assemblyRoots(world), id);
  if (!sys) return true;
  const total = sys.batteries.reduce((s, b) => s + (b.power!.stored ?? 0), 0);
  if (total + 1e-9 * factor(world.units, D.energy) < kJ) return false;
  for (const b of sys.batteries) {
    const p = b.power!;
    p.stored = Math.max(0, (p.stored ?? 0) - (kJ * (p.stored ?? 0)) / total);
  }
  return true;
}

/** Whatever is left, drawn: for a hit bigger than the battery holds (the shield then drops). Returns what it took. */
export function drainEnergy(world: World, roots: ReadonlyMap<string, string> | null, id: string, kJ: number): number {
  if (!(kJ > 0) || !world.bodies.some((b) => b.power)) return 0;
  const sys = systemOf(world, roots ?? assemblyRoots(world), id);
  if (!sys) return 0;
  const total = sys.batteries.reduce((s, b) => s + (b.power!.stored ?? 0), 0);
  const take = Math.min(total, kJ);
  if (take > 0) for (const b of sys.batteries) b.power!.stored = Math.max(0, (b.power!.stored ?? 0) - (take * (b.power!.stored ?? 0)) / total);
  return take;
}

/** A ship's power now: energy stored and room, kJ; generators' most and last step's output, kW. For the page. */
export function powerOf(world: World, id: string): { stored: number; capacity: number; output: number; making: number } | null {
  if (!world.bodies.some((b) => b.power)) return null;
  const sys = systemOf(world, assemblyRoots(world), id);
  if (!sys) return null;
  return {
    stored: sys.batteries.reduce((s, b) => s + (b.power!.stored ?? 0), 0),
    capacity: sys.batteries.reduce((s, b) => s + (b.power!.capacity ?? 0), 0),
    output: sys.generators.reduce((s, b) => s + (b.power!.output ?? 0), 0),
    making: sys.generators.reduce((s, b) => s + (b.power!.output ?? 0) * (b.power!.load ?? 0), 0),
  };
}

/**
 * Runs the generators for one step (PWR-003): each makes as much as its ship's batteries have room
 * for, up to its output, burning `perKg` kJ of the ship's propellant for each kJ it makes, from the
 * tanks on its ship in proportion to what they hold. No fuel, no power. Returns the fuel burned, kg.
 */
export function runPower(world: World, dt: number): number {
  const gens = world.bodies.filter((b) => b.power?.output);
  if (!gens.length) return 0;
  const roots = assemblyRoots(world);
  let burned = 0;
  // The world's units (units.ts): too little to burn, kg, and to make, kJ.
  const dry = DRY * (world.units?.mass ?? 1);
  const tiny = 1e-12 * factor(world.units, D.energy);
  // By ship: its generators share the room in its batteries.
  const ships = new Map<string, Body[]>();
  for (const g of gens) {
    g.power!.load = 0;
    if (!isGenerator(g)) continue;
    const r = roots.get(g.id)!;
    ships.set(r, [...(ships.get(r) ?? []), g]);
  }
  for (const [root, ship] of ships) {
    const batteries = world.bodies.filter((b) => roots.get(b.id) === root && isBattery(b));
    const room = batteries.reduce((s, b) => s + b.power!.capacity! - (b.power!.stored ?? 0), 0);
    const most = ship.reduce((s, g) => s + g.power!.output! * dt, 0);
    let make = Math.min(room, most);
    if (!(make > tiny)) continue;
    const tanks = world.bodies.filter((b) => roots.get(b.id) === root && isTank(b, dry));
    const stores = tanks.flatMap((t) => t.contents!.filter((c) => c.mass > dry && (c.resource === "h2" || c.resource === "o2")));
    const fuel = stores.reduce((s, c) => s + c.mass, 0);
    // The kJ a kg makes: the generators' own figure (all the same on a ship built by the rules).
    const perKg = ship.reduce((s, g) => s + g.power!.perKg! * g.power!.output!, 0) / ship.reduce((s, g) => s + g.power!.output!, 0);
    make = Math.min(make, fuel * perKg);
    if (!(make > tiny)) continue;
    const kg = make / perKg;
    for (const c of stores) c.mass = Math.max(0, c.mass - (kg * c.mass) / fuel);
    burned += kg;
    for (const b of batteries) {
      const p = b.power!;
      const share = (p.capacity! - (p.stored ?? 0)) / room;
      p.stored = Math.min(p.capacity!, (p.stored ?? 0) + make * share);
    }
    for (const g of ship) g.power!.load = make / most;
  }
  return burned;
}
