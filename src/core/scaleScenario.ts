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
  "command.maxAcceleration": D.accel,
};

/** Keys never scaled wherever they sit. */
const NONE = new Set(["schema", "seed", "angle", "angularVelocity", "restitution", "friction", "integrity", "step", "steps", "zoom", "omega", "economy", "yield", "count", "reload", "lives", "respawn", "grace", "delay", "every", "first", "skill", "spin", "time", "wait", "reveal", "seams", "pieces", "gold", "compounds", "multiplier", "maxTilt", "fragments", "blast", "damping", "arc", "capture", "rate", "hold", "shots", "capacity", "level", "extraLife", "most", "fromLevel", "pace", "clearPause", "shellLife", "temperature", "value", "flare", "efficiency", "goldDensity", "seamStrength", "compoundSize", "kills", "weight", "amount", "limit", "frontTurn", "cut", "early", "late", "slope", "aim", "life", "min", "max", "target", "shock", "countdown", "perLeak", "blastLeaks", "below", "more", "small", "gap", "flight", "combat", "base", "perLevel", "skillMax", "everyMin", "firstMin", "spread", "interval", "load", "watch", "pause", "ships", "clearBonus", "bonus", "index", "fraction", "last", "heat"]);

/** Objects whose numbers are all dimensionless: mass fractions by species. */
const NONE_INSIDE = new Set(["mixture", "composition"]);

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function scale(value: unknown, parent: string, units: Units, path: string, unknown: Set<string>): unknown {
  if (Array.isArray(value)) return value.map((v) => scale(v, parent + "[]", units, path + "[]", unknown));
  if (!isObj(value)) return value;
  const out: Record<string, unknown> = {};
  const vec = VECTORS[parent];
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "number") {
      const d = vec && (k === "x" || k === "y") ? vec : (FIELDS[`${parent}.${k}`] ?? FIELDS[k]);
      if (d) out[k] = v * factor(units, d);
      else {
        if (!NONE.has(k) && !NONE_INSIDE.has(parent)) unknown.add(`${parent}.${k}`);
        out[k] = v;
      }
    } else if (Array.isArray(v) && v.length && v.every((x) => typeof x === "number")) {
      // A range or list of numbers (rocks.speed: [least, most]).
      const d = FIELDS[`${parent}.${k}`];
      out[k] = d ? v.map((x: number) => x * factor(units, d)) : v;
      if (!d && !NONE.has(k)) unknown.add(`${parent}.${k}[]`);
    } else out[k] = scale(v, k, units, `${path}.${k}`, unknown);
  }
  return out;
}

/**
 * `scn` in `units` (of its own, which must be the core's: a scenario already scaled is refused).
 * Returns the scenario and the numbers it found no dimension for (left as they were).
 */
export function scaleScenario(scn: Scenario, units: Units): { scenario: Scenario; untagged: string[] } {
  if (scn.world.units) throw new Error("scaleScenario: the scenario is already in other units");
  const untagged = new Set<string>();
  const world = scale(scn.world, "world", units, "$.world", untagged) as Scenario["world"];
  const timeline = scale(scn.timeline, "timeline", units, "$.timeline", untagged) as Scenario["timeline"];
  return { scenario: { ...scn, world: { ...world, units: { ...units } }, timeline }, untagged: [...untagged].sort() };
}
