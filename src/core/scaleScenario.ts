// Converts a scenario to other units (docs/units-rescale-plan.md): every number it holds multiplied
// by its dimension's factor (units.ts). Which dimension a number has is known from where it sits:
// its key and the key of the object holding it (`position.x` is a length, `limits.torque` an
// energy). The table is checked by the units test: a scenario and its conversion must run equal,
// bit for bit, after dividing by the factors, so a number tagged wrong shows up there.

import type { Scenario } from "./scenario.ts";
import { D, factor, type Dim, type Units } from "./units.ts";

/** Objects whose x and y are both of one dimension, by their key ([] for an array's elements). */
const VECTORS: Record<string, Dim> = {
  position: D.length,
  velocity: D.speed,
  anchorA: D.length,
  anchorB: D.length,
  "vertices[]": D.length,
  gravity: D.accel,
  min: D.length,
  max: D.length,
  centre: D.length,
  at: D.length,
  origin: D.length,
  outlet: D.length,
  point: D.length,
  "points[]": D.length,
  "outline[]": D.length,
  "caves[]": D.length,
  "islands[]": D.length,
  "lines[]": D.length,
  "sky[]": D.length,
  "waypoints[]": D.length,
  "caves[][]": D.length,
  "islands[][]": D.length,
  "lines[][]": D.length,
  "points[][]": D.length,
  mouth: D.length,
  start: D.length,
  impulse: D.momentum,
  dv: D.speed,
  target: D.length,
  anchor: D.length,
  offset: D.length,
  tip: D.length,
  "parked[]": D.length,
  "flags[]": D.length,
  direction: D.none,
  axis: D.none,
  normal: D.none,
  camera: D.length,
};

/**
 * Numbers by "parent.key" (the parent is the key of the object holding it; [] for an array's
 * elements), then by key alone. Anything not listed is dimensionless (angles, ratios, counts,
 * times, steps, seeds): those are listed too where a key could be mistaken for one that scales.
 */
// Heats (explosive.heat, burst.heat, J/kg) are left as they are: they are taken "before the gas
// scale" (DEC-13), which the world's units already turn (units.ts scaledProfile).
const FIELDS: Record<string, Dim> = {
  "bodies[].mass": D.mass,
  "body.mass": D.mass,
  "patch.mass": D.mass,
  "shell.mass": D.mass,
  "stop.mass": D.mass,
  "anchored.mass": D.mass,
  "shape.radius": D.length,
  "shape.width": D.length,
  "shape.height": D.length,
  "contents[].mass": D.mass,
  "contents[].capacity": D.mass,
  "gravity.mu": D.mu,
  "gravity.core": D.length,
  "gravity.radius": D.length,
  "gravity.G": D.G,
  "recoil.travel": D.length,
  "vents.rate": D.massRate,
  "vents.parcel": D.mass,
  "vents.radius": D.length,
  "breach.credit": D.mass,
  "breach.speed": D.speed,
  "material.threshold": D.energy,
  "material.toughness": D.energy,
  "injector.rate": D.massRate,
  "injector.width": D.length,
  "injector.speed": D.speed,
  "injector.parcelMass": D.mass,
  "injector.radius": D.length,
  "injector.credit": D.mass,
  "chamber.width": D.length,
  "chamber.length": D.length,
  "nozzle.length": D.length,
  "links[].rate": D.massRate,
  "link.rate": D.massRate,
  "railgun.speed": D.speed,
  "railgun.shot": D.energy,
  "explosive.charge": D.mass,
  "explosive.gas": D.mass,
  "explosive.radius": D.length,
  "explosive.arm": D.speed,
  "burst.charge": D.mass,
  "burst.gas": D.mass,
  "limits.tension": D.force,
  "limits.compression": D.force,
  "limits.shear": D.force,
  "limits.torque": D.energy,
  "bounds.farField": D.length,
  "bounds.depth": D.length,
  "gas[].mass": D.mass,
  "gas[].jitter": D.speed,
  "fill.mass": D.mass,
  "fill.jitter": D.speed,
  "asteroids[].radius": D.length,
  "asteroids[].density": D.density,
  "asteroids[].bond": D.pressure,
  "rocks.radius": D.length,
  "rocks.density": D.density,
  "rocks.bond": D.pressure,
  "rocks.speed": D.speed,
  "lander.maxSpeed": D.speed,
  "challenge.maxSpeed": D.speed,
  "duel.respawn": D.length,
  "thrust.top": D.length,
  "escape.radius": D.length,
  "scores.fuel": D.perMass,
  "gunships.foot": D.length,
  "gunships.wake": D.length,
  "view.pitch": D.length,
  "transmitters[].width": D.length,
  "plant.leakSpeed": D.speed,
  "impact.threshold": D.energy,
  "impact.perSize": D.energy,
  "size.stand": D.length,
  "size.duck": D.length,
  "run.speed": D.speed,
  "run.accel": D.accel,
  "run.brake": D.accel,
  "run.air": D.accel,
  "jump.speed": D.speed,
  "roll.speed": D.speed,
  "roll.accel": D.accel,
  "slide.brake": D.accel,
  "slide.least": D.speed,
  "slide.crawl": D.speed,
  "moon.reach": D.length,
  "rocks[].within": D.length,
  "rocks[].mass": D.mass,
  "rifle.speed": D.speed,
  "rifle.mass": D.mass,
  "rifle.radius": D.length,
  "hook.speed": D.speed,
  "hook.range": D.length,
  "hook.stretch": D.length,
  "hook.radius": D.length,
  "hook.least": D.length,
  "hook.retract": D.speed,
  "hook.reel": D.speed,
  "craters.bullet": D.length,
  "craters.least": D.length,
  "craters.most": D.length,
  "tractor.range": D.length,
  "tractor.force": D.force,
  "tractor.maxSpeed": D.speed,
  "tractor.draw": D.power,
  "tractor.tetherDraw": D.power,
  "siphon.rate": D.massRate,
  "tether.length": D.length,
  "tether.reach": D.length,
  "tether.stiffness": D.pressure,
  "tether.maxTension": D.force,
  "tether.payOut": D.speed,
  "collector.range": D.length,
  "collector.maxExtent": D.length,
  "collector.capture": D.length,
  "collector.stiffness": D.pressure,
  "collector.reel": D.speed,
  "collector.maxTension": D.force,
  "turret.range": D.length,
  "spawn.radius": D.length,
  "generator.burn": D.massRate,
  "shield.radius": D.length,
  "shield.grow": D.speed,
  "shield.burn": D.massRate,
  "shield.hitBurn": D.hitBurn,
  "shield.minHit": D.mass,
  "shield.draw": D.power,
  "shield.hitDraw": D.hitDraw,
  "shield.minHitDraw": D.energy,
  "shield.mass": D.mass,
  "spring.stiffness": D.pressure,
  "power.capacity": D.energy,
  "power.stored": D.energy,
  "power.output": D.power,
  "power.perKg": D.specificEnergy,
  "goal.speed": D.speed,
  "goal.tolerance": D.length,
  "route.speed": D.speed,
  "pilot.detect": D.length,
  // drag.set, in a timeline: its pull per metre per kg is 1/s², kept.
  "commands[].maxAcceleration": D.accel,
  "commands[].stiffness": D.none,
};

/** Keys never scaled wherever they sit. */
const NONE = new Set([
  "schema", "seed", "angle", "angularVelocity", "restitution", "friction", "integrity", "step", "steps", "zoom", "omega", "economy", "yield", "count", "reload", "lives", "respawn", "grace", "delay", "every", "first", "skill", "spin", "time", "wait", "reveal", "seams", "pieces", "gold", "compounds", "multiplier", "maxTilt", "fragments", "blast", "damping", "arc", "capture", "rate", "hold", "shots", "capacity", "level", "extraLife", "most", "fromLevel", "pace", "clearPause", "shellLife", "temperature", "value", "flare", "efficiency", "goldDensity", "seamStrength", "compoundSize", "kills", "weight", "amount", "limit", "frontTurn", "cut", "early", "late", "slope", "aim", "life", "min", "max", "target", "shock", "countdown", "perLeak", "blastLeaks", "below", "more", "small", "gap", "flight", "combat", "base", "perLevel", "skillMax", "everyMin", "firstMin", "spread", "interval", "load", "watch", "pause", "ships", "clearBonus", "bonus", "index", "fraction", "last", "heat",
]);

/** Objects whose numbers are all dimensionless: mass fractions by species. */
const NONE_INSIDE = new Set(["mixture", "composition"]);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** The dimension of a number at `key` in an object held at `parent`, or undefined if it has none listed. */
export function dimAt(parent: string, key: string): Dim | undefined {
  const vec = VECTORS[parent];
  return vec && (key === "x" || key === "y") ? vec : (FIELDS[`${parent}.${key}`] ?? FIELDS[key]);
}

/** Whether a number at `key` in `parent` is known to be dimensionless. */
export const dimensionless = (parent: string, key: string): boolean => NONE.has(key) || NONE_INSIDE.has(parent);

/**
 * Converts every number in `value` (held at `parent`) by its dimension: `num(n, d, path)` gives the
 * new value of number n of dimension d (undefined: none listed). Numbers with no dimension listed
 * and not known to be dimensionless are added to `unknown`. Objects for which `leaf` returns
 * something (a parameter placeholder, say) are replaced by it.
 */
export function walk(
  value: unknown,
  parent: string,
  num: (n: number, d: Dim | undefined) => number,
  unknown: Set<string>,
  leaf?: (v: Record<string, unknown>, d: Dim | undefined) => unknown,
): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, parent + "[]", num, unknown, leaf));
  if (!isObj(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const d = dimAt(parent, k);
    const known = !!d || dimensionless(parent, k);
    let r: unknown;
    if (typeof v === "number") {
      if (!known) unknown.add(`${parent}.${k}`);
      out[k] = num(v, d);
    } else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number")) {
      // A range or list of numbers (rocks.speed: [least, most]).
      if (!known) unknown.add(`${parent}.${k}[]`);
      out[k] = v.map((x: number) => num(x, d));
    } else if (leaf && isObj(v) && (r = leaf(v, d)) !== undefined) {
      if (!known) unknown.add(`${parent}.${k}`);
      out[k] = r;
    } else out[k] = walk(v, k, num, unknown, leaf);
  }
  return out;
}

/** Units combined: `a` then `b` (a world in a's units, converted by b). Absent: the core's. */
const compose = (a: Units | undefined, b: Units): Units | undefined => {
  const u = { length: (a?.length ?? 1) * b.length, mass: (a?.mass ?? 1) * b.mass };
  return u.length === 1 && u.mass === 1 ? undefined : u;
};

/**
 * `scn` converted by `by`: every number multiplied by its dimension's factor in `by`, and its world's
 * units changed to match (a world in the game's units converted by ¼ and 1/1024 is in the core's).
 * Returns the scenario and the numbers it found no dimension for (left as they were).
 */
export function scaleScenario(scn: Scenario, by: Units): { scenario: Scenario; untagged: string[] } {
  const untagged = new Set<string>();
  const num = (n: number, d: Dim | undefined) => (d ? n * factor(by, d) : n);
  const { units: _old, ...rest } = scn.world;
  void _old;
  const world = walk(rest, "world", num, untagged) as Scenario["world"];
  const timeline = walk(scn.timeline, "timeline", num, untagged) as Scenario["timeline"];
  const units = compose(scn.world.units, by);
  return {
    scenario: { ...scn, world: { ...world, ...(units ? { units } : {}) }, timeline },
    untagged: [...untagged].sort(),
  };
}
