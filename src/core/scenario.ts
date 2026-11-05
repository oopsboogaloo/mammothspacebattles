// Scenario files: schema, validation with JSON paths, parameters, migration,
// and running with probes and assertions (SCN-001…SCN-003, SCN-007, SCN-008).

import { hashValue } from "./canonical.ts";
import { evaluateFormula } from "./formula.ts";
import { SPECIES } from "./gas.ts";
import { resolvePath } from "./path.ts";
import { resolveProbe } from "./probes.ts";
import { generateAsteroid, type AsteroidSpec } from "./asteroid.ts";
import type { LandingGoal } from "./landing.ts";
import { PROFILES, getProfile } from "./profile.ts";
import { polygonProblem } from "./shapes.ts";
import { createWorld, stepInPlace, type BodyInput, type Bounds, type Command, type GasFill, type JointInput, type LinkInput, type Vec2, type World } from "./world.ts";

export const SCENARIO_SCHEMA = 1;

export interface Probe {
  id: string;
  path: string;
}

export interface Parameter {
  id: string;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  default: number;
}

/** Sandbox hints: what to switch on when the scenario opens (SCN-010). */
export interface ScenarioUi {
  lookFor?: string;
  overlays?: string[];
  graphs?: string[];
  camera?: { x: number; y: number; zoom: number };
  /** Body to select and follow with the camera. */
  follow?: string;
  /** Suggested key bindings, key → control channel (SBX-020), added when the scenario opens. */
  keys?: Record<string, string>;
  /** Draw body ids on the view (default true). */
  labels?: boolean;
}

export type LedgerQuantity = "mass" | "momentum" | "angularMomentum" | "energy";

export type Assertion =
  | { kind: "valueAt"; probe: string; step: number | "end"; equals: number; tol: number }
  | { kind: "rangeOver"; probe: string; from: number; to: number | "end"; min?: number; max?: number }
  | { kind: "event"; type: string; occurred: boolean; from?: number; to?: number | "end" }
  | { kind: "formula"; at: number | "end"; left: string; right: string; tol: number; relative?: boolean }
  | { kind: "ledgerResidual"; quantity: LedgerQuantity; maxAbs: number };

export interface Scenario {
  schema: number;
  name: string;
  title?: string;
  description?: string;
  profile: string;
  seed: number;
  parameters?: Parameter[];
  /** Parameter values this instance was built with (defaults unless overridden). */
  values: Record<string, number>;
  world: { bodies: BodyInput[]; gravity?: Vec2; joints?: JointInput[]; links?: LinkInput[]; gas?: GasFill[]; bounds?: Bounds; challenge?: LandingGoal; asteroids?: AsteroidSpec[] };
  timeline: { step: number; commands: Command[] }[];
  end: { steps: number };
  probes: Probe[];
  assertions: Assertion[];
  ui?: ScenarioUi;
}

export interface ValidationError {
  path: string;
  message: string;
}

export class ScenarioError extends Error {
  readonly errors: ValidationError[];
  constructor(errors: ValidationError[]) {
    super("Invalid scenario:\n" + errors.map((e) => `  ${e.path}: ${e.message}`).join("\n"));
    this.errors = errors;
  }
}

// ---------- Migration (SCN-007) ----------

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/** Migrations keyed by the schema version they upgrade FROM. None exist yet: v1 is the first schema. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function migrateScenario(raw: unknown, migrations: Readonly<Record<number, Migration>> = MIGRATIONS): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  let obj = raw as Record<string, unknown>;
  if (typeof obj.schema !== "number" || !Number.isInteger(obj.schema)) return raw; // validation reports it
  let version: number = obj.schema;
  if (version > SCENARIO_SCHEMA) {
    throw new ScenarioError([{ path: "$.schema", message: `schema ${version} is newer than this build supports (${SCENARIO_SCHEMA}); update the sandbox` }]);
  }
  while (version < SCENARIO_SCHEMA) {
    const m = migrations[version];
    if (!m) throw new ScenarioError([{ path: "$.schema", message: `no migration from schema ${version} to ${SCENARIO_SCHEMA}` }]);
    obj = m(obj);
    version = obj.schema as number;
  }
  return obj;
}

// ---------- Parameters (SCN-008) ----------

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Replaces every {"$param": id} in `value` with its number, and every {"$expr": "formula"}
 * with the formula evaluated over the parameters (e.g. "boxMass * 0.25"), reporting unknown ids.
 */
function substitute(value: unknown, values: Record<string, number>, path: string, errors: ValidationError[]): unknown {
  if (Array.isArray(value)) return value.map((v, i) => substitute(v, values, `${path}[${i}]`, errors));
  if (!isObj(value)) return value;
  if ("$param" in value) {
    const id = value.$param;
    if (typeof id !== "string" || !(id in values)) {
      errors.push({ path, message: `unknown parameter ${JSON.stringify(id)}` });
      return NaN;
    }
    return values[id];
  }
  if ("$expr" in value) {
    if (typeof value.$expr !== "string") {
      errors.push({ path, message: "$expr must be a formula string" });
      return NaN;
    }
    try {
      return evaluateFormula(value.$expr, (id) => {
        if (!(id in values)) throw new Error(`unknown parameter "${id}"`);
        return values[id];
      });
    } catch (e) {
      errors.push({ path, message: (e as Error).message });
      return NaN;
    }
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = substitute(v, values, `${path}.${k}`, errors);
  return out;
}

// ---------- Validation (SCN-002) ----------

type V = { errors: ValidationError[] };

function err(v: V, path: string, message: string): void {
  v.errors.push({ path, message });
}
function num(v: V, x: unknown, path: string, opts: { int?: boolean; min?: number; max?: number; positive?: boolean } = {}): boolean {
  if (typeof x !== "number" || !Number.isFinite(x)) return err(v, path, "must be a finite number"), false;
  if (opts.int && !Number.isInteger(x)) return err(v, path, "must be an integer"), false;
  if (opts.min !== undefined && x < opts.min) return err(v, path, `must be ≥ ${opts.min}`), false;
  if (opts.max !== undefined && x > opts.max) return err(v, path, `must be ≤ ${opts.max}`), false;
  if (opts.positive && !(x > 0)) return err(v, path, "must be > 0"), false;
  return true;
}
function str(v: V, x: unknown, path: string): boolean {
  if (typeof x !== "string" || x.length === 0) return err(v, path, "must be a non-empty string"), false;
  return true;
}
function stepRef(v: V, x: unknown, path: string): void {
  if (x !== "end") num(v, x, path, { int: true, min: 0 });
}
function vec(v: V, x: unknown, path: string): void {
  if (!isObj(x)) return err(v, path, "must be an object {x, y}");
  num(v, x.x, `${path}.x`);
  num(v, x.y, `${path}.y`);
}

function validateShape(v: V, s: unknown, path: string): void {
  if (!isObj(s)) return err(v, path, 'must be an object with "kind"');
  switch (s.kind) {
    case "disc":
      num(v, s.radius, `${path}.radius`, { positive: true });
      return;
    case "box":
      num(v, s.width, `${path}.width`, { positive: true });
      num(v, s.height, `${path}.height`, { positive: true });
      return;
    case "polygon": {
      if (!Array.isArray(s.vertices)) return err(v, `${path}.vertices`, "must be an array of {x, y}");
      const before = v.errors.length;
      s.vertices.forEach((p, i) => vec(v, p, `${path}.vertices[${i}]`));
      if (v.errors.length === before) {
        const problem = polygonProblem(s.vertices as Vec2[]);
        if (problem) err(v, `${path}.vertices`, problem);
      }
      return;
    }
    default:
      err(v, `${path}.kind`, `must be "disc", "box" or "polygon", got ${JSON.stringify(s.kind)}`);
  }
}

function validateBody(v: V, b: unknown, path: string, partial = false): void {
  if (!isObj(b)) return err(v, path, "must be an object");
  const has = (k: string) => !partial || b[k] !== undefined;
  if (!partial) str(v, b.id, `${path}.id`);
  if (has("shape")) validateShape(v, b.shape, `${path}.shape`);
  if (has("mass")) num(v, b.mass, `${path}.mass`, { positive: true });
  if (has("position")) vec(v, b.position, `${path}.position`);
  if (has("velocity")) vec(v, b.velocity, `${path}.velocity`);
  if (has("angle")) num(v, b.angle, `${path}.angle`);
  if (has("angularVelocity")) num(v, b.angularVelocity, `${path}.angularVelocity`);
  if (b.fixed !== undefined && typeof b.fixed !== "boolean") err(v, `${path}.fixed`, "must be true or false");
  if (b.restitution !== undefined) num(v, b.restitution, `${path}.restitution`, { min: 0, max: 1 });
  if (b.friction !== undefined) num(v, b.friction, `${path}.friction`, { min: 0 });
  if (b.injector !== undefined) validateInjector(v, b.injector, `${path}.injector`);
  if (b.gravity !== undefined) {
    if (!isObj(b.gravity)) err(v, `${path}.gravity`, "must be an object {mu, core}");
    else {
      num(v, b.gravity.mu, `${path}.gravity.mu`, { min: 0 });
      num(v, b.gravity.core, `${path}.gravity.core`, { positive: true });
    }
  }
  if (b.integrity !== undefined) num(v, b.integrity, `${path}.integrity`, { min: 0, max: 1 });
  if (b.explosive !== undefined) validateExplosive(v, b.explosive, b.mass, `${path}.explosive`);
  if (b.tractor !== undefined) validateTractor(v, b.tractor, `${path}.tractor`);
  if (b.pilot !== undefined) {
    const pl = b.pilot;
    const pp = `${path}.pilot`;
    if (!isObj(pl)) err(v, pp, "must be {skill?, goal?, interval?}");
    else {
      if (pl.skill !== undefined) {
        if (!isObj(pl.skill)) err(v, `${pp}.skill`, "must be {flight?, combat?}");
        else for (const k of ["flight", "combat"]) if (pl.skill[k] !== undefined) num(v, pl.skill[k], `${pp}.skill.${k}`, { min: 0, max: 1 });
      }
      if (pl.interval !== undefined) num(v, pl.interval, `${pp}.interval`, { int: true, min: 1, max: 240 });
      if (pl.goal !== undefined) validatePilotGoal(v, pl.goal, `${pp}.goal`);
      const MODES = ["manual", "ignoring", "hunting", "cautious", "evading"];
      if (pl.mode !== undefined && !MODES.includes(pl.mode as string)) err(v, `${pp}.mode`, `must be one of ${MODES.join(", ")}`);
      if (pl.side !== undefined) str(v, pl.side, `${pp}.side`);
      if (pl.detect !== undefined) num(v, pl.detect, `${pp}.detect`, { positive: true });
      if (pl.route !== undefined) {
        if (!isObj(pl.route)) err(v, `${pp}.route`, "must be {waypoints, loop?, speed?}");
        else validateRoute(v, pl.route, `${pp}.route`);
      }
      if ((pl.mode === "ignoring" || pl.mode === "cautious" || pl.mode === "evading") && pl.route === undefined) err(v, `${pp}.route`, `${pl.mode} needs a route`);
    }
  }
  if (b.collector !== undefined) {
    const c = b.collector;
    const cp = `${path}.collector`;
    if (!isObj(c)) err(v, cp, "must be {mouth, range?, maxExtent?, stiffness?, damping?, reel?, capture?, maxTension?}");
    else {
      if (b.fixed !== true) err(v, cp, "a collector must be on a fixed body");
      vec(v, c.mouth, `${cp}.mouth`);
      for (const k of ["range", "maxExtent", "stiffness", "reel", "capture", "maxTension"]) if (c[k] !== undefined) num(v, c[k], `${cp}.${k}`, { positive: true });
      if (c.damping !== undefined) num(v, c.damping, `${cp}.damping`, { min: 0 });
    }
  }
  if (b.magazine !== undefined) {
    const m = b.magazine;
    const mp = `${path}.magazine`;
    if (!isObj(m)) err(v, mp, "must be an object {count, shell, at, angle, reload}");
    else {
      num(v, m.count, `${mp}.count`, { int: true, min: 0 });
      if (!isObj(m.shell)) err(v, `${mp}.shell`, "must be a body without id or motion: {shape, mass, …}");
      else {
        validateShape(v, m.shell.shape, `${mp}.shell.shape`);
        num(v, m.shell.mass, `${mp}.shell.mass`, { positive: true });
        if (m.shell.explosive !== undefined) validateExplosive(v, m.shell.explosive, m.shell.mass, `${mp}.shell.explosive`);
      }
      vec(v, m.at, `${mp}.at`);
      num(v, m.angle, `${mp}.angle`);
      num(v, m.reload, `${mp}.reload`, { min: 0 });
      if (m.stop !== undefined) {
        if (!isObj(m.stop)) err(v, `${mp}.stop`, "must be {shape, mass, at, angle?}");
        else {
          validateShape(v, m.stop.shape, `${mp}.stop.shape`);
          num(v, m.stop.mass, `${mp}.stop.mass`, { positive: true });
          vec(v, m.stop.at, `${mp}.stop.at`);
          if (m.stop.angle !== undefined) num(v, m.stop.angle, `${mp}.stop.angle`);
        }
      }
    }
  }
  if (b.material !== undefined) validateMaterial(v, b.material, `${path}.material`);
  if (b.contents !== undefined) {
    if (!Array.isArray(b.contents)) return err(v, `${path}.contents`, "must be an array of stores");
    b.contents.forEach((s, i) => {
      const sp = `${path}.contents[${i}]`;
      if (!isObj(s)) return err(v, sp, "must be {resource, mass, capacity}");
      str(v, s.resource, `${sp}.resource`);
      const okM = num(v, s.mass, `${sp}.mass`, { min: 0 });
      const okC = num(v, s.capacity, `${sp}.capacity`, { min: 0 });
      if (okM && okC && (s.mass as number) > (s.capacity as number)) err(v, `${sp}.mass`, "must not exceed capacity");
    });
  }
}

function validateMaterial(v: V, m: unknown, path: string): void {
  if (!isObj(m)) return err(v, path, "must be an object {threshold, toughness}");
  num(v, m.threshold, `${path}.threshold`, { min: 0 });
  num(v, m.toughness, `${path}.toughness`, { positive: true });
  if (m.name !== undefined) str(v, m.name, `${path}.name`);
}

function validatePilotGoal(v: V, g: unknown, path: string): void {
  const kinds = ["heading", "velocity", "hover", "idle", "point", "route", "station"];
  if (!isObj(g) || !kinds.includes(g.kind as string)) return err(v, path, `must be a goal: {kind: ${kinds.map((k) => `"${k}"`).join(" | ")}, …}`);
  if (g.kind === "heading") num(v, g.angle, `${path}.angle`);
  else if (g.kind === "velocity") vec(v, g.velocity, `${path}.velocity`);
  else if (g.kind === "point") {
    vec(v, g.target, `${path}.target`);
    for (const k of ["speed", "tolerance"]) if (g[k] !== undefined) num(v, g[k], `${path}.${k}`, { positive: true });
  } else if (g.kind === "route") validateRoute(v, g, path);
  else if (g.kind === "station") {
    str(v, g.body, `${path}.body`);
    vec(v, g.offset, `${path}.offset`);
  }
}

function validateRoute(v: V, r: Record<string, unknown>, path: string): void {
  if (!Array.isArray(r.waypoints) || !r.waypoints.length) return err(v, `${path}.waypoints`, "must be a list of points");
  r.waypoints.forEach((w, i) => vec(v, w, `${path}.waypoints[${i}]`));
  if (r.speed !== undefined) num(v, r.speed, `${path}.speed`, { positive: true });
}

function validateTractor(v: V, t: unknown, path: string): void {
  if (!isObj(t)) return err(v, path, "must be {channel, origin, direction, range?, arc?, force?, tether?}");
  str(v, t.channel, `${path}.channel`);
  vec(v, t.origin, `${path}.origin`);
  vec(v, t.direction, `${path}.direction`);
  if (isObj(t.direction) && t.direction.x === 0 && t.direction.y === 0) err(v, `${path}.direction`, "must not be zero");
  if (t.range !== undefined) num(v, t.range, `${path}.range`, { positive: true });
  if (t.arc !== undefined) num(v, t.arc, `${path}.arc`, { positive: true, max: Math.PI });
  if (t.force !== undefined) num(v, t.force, `${path}.force`, { min: 0 });
  if (t.capture !== undefined) num(v, t.capture, `${path}.capture`, { min: 0 });
  if (t.tether !== undefined) {
    if (!isObj(t.tether)) return err(v, `${path}.tether`, "must be {length?, stiffness?, damping?, maxTension?}");
    for (const k of ["length", "stiffness", "maxTension"]) if (t.tether[k] !== undefined) num(v, t.tether[k], `${path}.tether.${k}`, { positive: true });
    if (t.tether.damping !== undefined) num(v, t.tether.damping, `${path}.tether.damping`, { min: 0 });
  }
}

function validateExplosive(v: V, e: unknown, mass: unknown, path: string): void {
  if (!isObj(e)) return err(v, path, "must be {charge, heat?, fragments?, radius?, arm?}");
  if (num(v, e.charge, `${path}.charge`, { positive: true }) && typeof mass === "number" && (e.charge as number) > mass) err(v, `${path}.charge`, "must not exceed the shell's mass");
  if (e.heat !== undefined) num(v, e.heat, `${path}.heat`, { positive: true });
  if (e.fragments !== undefined) num(v, e.fragments, `${path}.fragments`, { int: true, min: 0, max: 8 });
  if (e.radius !== undefined) num(v, e.radius, `${path}.radius`, { positive: true });
  if (e.arm !== undefined) num(v, e.arm, `${path}.arm`, { min: 0 });
}

function validateInjector(v: V, i: unknown, path: string): void {
  if (!isObj(i)) return err(v, path, "must be an object {channel, …}");
  str(v, i.channel, `${path}.channel`);
  if (i.rate !== undefined) num(v, i.rate, `${path}.rate`, { min: 0 });
  for (const k of ["width", "speed"]) if (i[k] !== undefined) num(v, i[k], `${path}.${k}`, { min: 0 });
  for (const k of ["parcelMass", "radius"]) if (i[k] !== undefined) num(v, i[k], `${path}.${k}`, { positive: true });
  for (const k of ["outlet", "direction"]) if (i[k] !== undefined) vec(v, i[k], `${path}.${k}`);
  if (i.igniter !== undefined && typeof i.igniter !== "boolean") err(v, `${path}.igniter`, "must be true or false");
  if (i.economy !== undefined) num(v, i.economy, `${path}.economy`, { min: 1 });
  if (i.chamber !== undefined) {
    if (!isObj(i.chamber)) err(v, `${path}.chamber`, "must be an object {width, length}");
    else for (const k of ["width", "length"]) num(v, i.chamber[k], `${path}.chamber.${k}`, { positive: true });
  }
  if (i.mixture !== undefined) {
    if (!isObj(i.mixture) || !Object.keys(i.mixture).length) return err(v, `${path}.mixture`, "must be an object of species mass fractions");
    let sum = 0;
    for (const [k, y] of Object.entries(i.mixture)) {
      if (!SPECIES[k]) err(v, `${path}.mixture.${k}`, `unknown species (known: ${Object.keys(SPECIES).join(", ")})`);
      if (num(v, y, `${path}.mixture.${k}`, { min: 0, max: 1 })) sum += y as number;
    }
    if (Math.abs(sum - 1) > 1e-9) err(v, `${path}.mixture`, `mass fractions must sum to 1, got ${sum}`);
  }
}

function validateJoint(v: V, j: unknown, path: string): void {
  if (!isObj(j)) return err(v, path, "must be an object");
  str(v, j.id, `${path}.id`);
  str(v, j.a, `${path}.a`);
  str(v, j.b, `${path}.b`);
  vec(v, j.anchorA, `${path}.anchorA`);
  vec(v, j.anchorB, `${path}.anchorB`);
  if (j.axis !== undefined) vec(v, j.axis, `${path}.axis`);
  if (j.referenceAngle !== undefined) num(v, j.referenceAngle, `${path}.referenceAngle`);
  if (j.limits !== undefined) validateLimits(v, j.limits, `${path}.limits`);
  if (j.integrity !== undefined) num(v, j.integrity, `${path}.integrity`, { positive: true, max: 1 });
}

function validateLimits(v: V, l: unknown, path: string): void {
  if (!isObj(l)) return err(v, path, "must be an object");
  for (const k of ["tension", "compression", "shear", "torque"]) if (l[k] !== undefined) num(v, l[k], `${path}.${k}`, { positive: true });
}

function validateLink(v: V, l: unknown, path: string): void {
  if (!isObj(l)) return err(v, path, "must be an object");
  str(v, l.id, `${path}.id`);
  str(v, l.to, `${path}.to`);
  if (l.integrity !== undefined) num(v, l.integrity, `${path}.integrity`, { positive: true, max: 1 });
  if (l.kind === "feed") {
    str(v, l.from, `${path}.from`);
    str(v, l.resource, `${path}.resource`);
    num(v, l.rate, `${path}.rate`, { positive: true });
  } else if (l.kind === "control") str(v, l.channel, `${path}.channel`);
  else err(v, `${path}.kind`, 'must be "feed" or "control"');
}

function validateRect(v: V, min: unknown, max: unknown, path: string, minKey = "min", maxKey = "max"): void {
  vec(v, min, `${path}.${minKey}`);
  vec(v, max, `${path}.${maxKey}`);
  if (isObj(min) && isObj(max) && typeof min.x === "number" && typeof max.x === "number" && typeof min.y === "number" && typeof max.y === "number") {
    if (!(max.x > min.x) || !(max.y > min.y)) err(v, `${path}.${maxKey}`, `must be above and right of ${minKey}`);
  }
}

function validateFill(v: V, f: unknown, path: string): void {
  if (!isObj(f)) return err(v, path, "must be an object {min, max, count, mass, temperature}");
  validateRect(v, f.min, f.max, path);
  num(v, f.count, `${path}.count`, { int: true, min: 1 });
  num(v, f.mass, `${path}.mass`, { positive: true });
  num(v, f.temperature, `${path}.temperature`, { positive: true });
  if (f.velocity !== undefined) vec(v, f.velocity, `${path}.velocity`);
  if (f.jitter !== undefined) num(v, f.jitter, `${path}.jitter`, { min: 0 });
  if (f.symmetric !== undefined && typeof f.symmetric !== "boolean") err(v, `${path}.symmetric`, "must be true or false");
  if (f.composition !== undefined) {
    if (!isObj(f.composition) || Object.keys(f.composition).length === 0) return err(v, `${path}.composition`, "must be an object of species mass fractions");
    let sum = 0;
    for (const [k, y] of Object.entries(f.composition)) {
      if (!SPECIES[k]) err(v, `${path}.composition.${k}`, `unknown species (known: ${Object.keys(SPECIES).join(", ")})`);
      if (num(v, y, `${path}.composition.${k}`, { min: 0, max: 1 })) sum += y as number;
    }
    if (Math.abs(sum - 1) > 1e-9) err(v, `${path}.composition`, `mass fractions must sum to 1, got ${sum}`);
  }
}

function validateBounds(v: V, b: unknown, path: string): void {
  if (!isObj(b)) return err(v, path, "must be an object {min, max}");
  validateRect(v, b.min, b.max, path);
  if (b.farField !== undefined) num(v, b.farField, `${path}.farField`, { positive: true });
  if (b.depth !== undefined) num(v, b.depth, `${path}.depth`, { positive: true });
  if (b.wrap !== undefined && typeof b.wrap !== "boolean") err(v, `${path}.wrap`, "must be true or false");
}

function validateChallenge(v: V, c: unknown, bodies: unknown, path: string): void {
  if (!isObj(c)) return err(v, path, "must be an object {kind, ship, pad, maxSpeed, maxTilt}");
  if (c.kind !== "landing") return err(v, `${path}.kind`, 'must be "landing"');
  const list = Array.isArray(bodies) ? bodies.filter(isObj) : [];
  const ship = list.find((b) => b.id === c.ship);
  const pad = list.find((b) => b.id === c.pad);
  if (!ship) err(v, `${path}.ship`, "must be the id of a body in the world");
  if (!pad) err(v, `${path}.pad`, "must be the id of a body in the world");
  else if (pad.fixed !== true) err(v, `${path}.pad`, "must be a fixed body");
  num(v, c.maxSpeed, `${path}.maxSpeed`, { positive: true });
  num(v, c.maxTilt, `${path}.maxTilt`, { min: 0, max: 180 });
}

function validateCommand(v: V, c: unknown, path: string): void {
  if (!isObj(c)) return err(v, path, "must be an object");
  switch (c.type) {
    case "body.add":
      return validateBody(v, c.body, `${path}.body`);
    case "body.remove":
    case "drag.clear":
      str(v, c.id, `${path}.id`);
      return;
    case "body.set":
      str(v, c.id, `${path}.id`);
      if (isObj(c.patch) && "id" in c.patch) err(v, `${path}.patch.id`, "cannot change a body's id");
      return validateBody(v, c.patch, `${path}.patch`, true);
    case "body.impulse":
      str(v, c.id, `${path}.id`);
      vec(v, c.impulse, `${path}.impulse`);
      vec(v, c.point, `${path}.point`);
      return;
    case "drag.set":
      str(v, c.id, `${path}.id`);
      vec(v, c.anchor, `${path}.anchor`);
      vec(v, c.target, `${path}.target`);
      if (c.stiffness !== undefined) num(v, c.stiffness, `${path}.stiffness`, { positive: true });
      if (c.maxAcceleration !== undefined) num(v, c.maxAcceleration, `${path}.maxAcceleration`, { positive: true });
      return;
    case "world.set":
      if (!isObj(c.patch)) return err(v, `${path}.patch`, "must be an object");
      if (c.patch.gravity !== undefined) vec(v, c.patch.gravity, `${path}.patch.gravity`);
      if (c.patch.bounds !== undefined) validateBounds(v, c.patch.bounds, `${path}.patch.bounds`);
      return;
    case "gas.fill":
      return validateFill(v, c.fill, `${path}.fill`);
    case "gas.remove":
      return validateRect(v, c.min, c.max, path);
    case "joint.add":
      return validateJoint(v, c.joint, `${path}.joint`);
    case "joint.remove":
    case "body.detach":
    case "link.remove":
      str(v, c.id, `${path}.id`);
      return;
    case "joint.set":
      str(v, c.id, `${path}.id`);
      return validateLimits(v, c.limits, `${path}.limits`);
    case "pilot.set":
      str(v, c.id, `${path}.id`);
      if (c.goal !== undefined) validatePilotGoal(v, c.goal, `${path}.goal`);
      if (c.skill !== undefined) {
        if (!isObj(c.skill)) err(v, `${path}.skill`, "must be {flight?, combat?}");
        else for (const k of ["flight", "combat"]) if (c.skill[k] !== undefined) num(v, c.skill[k], `${path}.skill.${k}`, { min: 0, max: 1 });
      }
      return;
    case "link.add":
      return validateLink(v, c.link, `${path}.link`);
    case "control.set":
      str(v, c.channel, `${path}.channel`);
      num(v, c.value, `${path}.value`);
      return;
    case "rng.sample":
      str(v, c.label, `${path}.label`);
      return;
    case "debug.kick":
      str(v, c.id, `${path}.id`);
      vec(v, c.dv, `${path}.dv`);
      return;
    default:
      err(v, `${path}.type`, `unknown command type ${JSON.stringify(c.type)}`);
  }
}

function validateAssertion(v: V, a: unknown, path: string, names: Set<string>, probeIds: Set<string>): void {
  if (!isObj(a)) return err(v, path, "must be an object");
  const probe = (k: string) => {
    if (str(v, a[k], `${path}.${k}`) && !probeIds.has(a[k] as string)) err(v, `${path}.${k}`, `unknown probe "${a[k]}"`);
  };
  const expr = (k: string) => {
    if (!str(v, a[k], `${path}.${k}`)) return;
    try {
      evaluateFormula(a[k] as string, (id) => {
        if (!names.has(id)) throw new Error(`unknown probe or parameter "${id}"`);
        return 1;
      });
    } catch (e) {
      err(v, `${path}.${k}`, (e as Error).message);
    }
  };
  switch (a.kind) {
    case "valueAt":
      probe("probe");
      stepRef(v, a.step, `${path}.step`);
      num(v, a.equals, `${path}.equals`);
      num(v, a.tol, `${path}.tol`, { min: 0 });
      return;
    case "rangeOver":
      probe("probe");
      stepRef(v, a.from, `${path}.from`);
      stepRef(v, a.to, `${path}.to`);
      if (a.min === undefined && a.max === undefined) err(v, path, "needs min, max or both");
      if (a.min !== undefined) num(v, a.min, `${path}.min`);
      if (a.max !== undefined) num(v, a.max, `${path}.max`);
      return;
    case "event":
      str(v, a.type, `${path}.type`);
      if (typeof a.occurred !== "boolean") err(v, `${path}.occurred`, "must be true or false");
      if (a.from !== undefined) stepRef(v, a.from, `${path}.from`);
      if (a.to !== undefined) stepRef(v, a.to, `${path}.to`);
      return;
    case "formula":
      stepRef(v, a.at, `${path}.at`);
      expr("left");
      expr("right");
      num(v, a.tol, `${path}.tol`, { min: 0 });
      if (a.relative !== undefined && typeof a.relative !== "boolean") err(v, `${path}.relative`, "must be true or false");
      return;
    case "ledgerResidual":
      if (!["mass", "momentum", "angularMomentum", "energy"].includes(a.quantity as string)) {
        err(v, `${path}.quantity`, 'must be "mass", "momentum", "angularMomentum" or "energy"');
      }
      num(v, a.maxAbs, `${path}.maxAbs`, { min: 0 });
      return;
    default:
      err(v, `${path}.kind`, `unknown assertion kind ${JSON.stringify(a.kind)}`);
  }
}

function validateParameters(v: V, raw: unknown): Parameter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return err(v, "$.parameters", "must be an array"), [];
  const ids = new Set<string>();
  raw.forEach((p, i) => {
    const path = `$.parameters[${i}]`;
    if (!isObj(p)) return err(v, path, "must be an object");
    if (str(v, p.id, `${path}.id`)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(p.id as string)) err(v, `${path}.id`, "must be a plain identifier (letters, digits, _)");
      if (ids.has(p.id as string)) err(v, `${path}.id`, `duplicate parameter "${p.id}"`);
      ids.add(p.id as string);
    }
    str(v, p.label, `${path}.label`);
    if (p.unit !== undefined && typeof p.unit !== "string") err(v, `${path}.unit`, "must be a string");
    const okMin = num(v, p.min, `${path}.min`);
    const okMax = num(v, p.max, `${path}.max`);
    if (okMin && okMax && (p.min as number) > (p.max as number)) err(v, `${path}.max`, "must be ≥ min");
    if (p.step !== undefined) num(v, p.step, `${path}.step`, { positive: true });
    if (num(v, p.default, `${path}.default`) && okMin && okMax) {
      if ((p.default as number) < (p.min as number) || (p.default as number) > (p.max as number)) err(v, `${path}.default`, "must be within min..max");
    }
  });
  return raw as Parameter[];
}

/**
 * Migrates, substitutes parameters and validates untrusted input.
 * `values` overrides parameter defaults. Throws ScenarioError listing every problem.
 */
export function parseScenario(raw: unknown, values: Record<string, number> = {}): Scenario {
  const migrated = migrateScenario(raw);
  const v: V = { errors: [] };
  if (!isObj(migrated)) throw new ScenarioError([{ path: "$", message: "must be a JSON object" }]);

  const params = validateParameters(v, migrated.parameters);
  const resolved: Record<string, number> = {};
  for (const p of params) if (isObj(p) && typeof p.id === "string") resolved[p.id] = typeof p.default === "number" ? p.default : NaN;
  for (const [k, val] of Object.entries(values)) {
    const p = params.find((q) => q.id === k);
    if (!p) err(v, `values.${k}`, `unknown parameter "${k}"`);
    else if (!(val >= p.min && val <= p.max)) err(v, `values.${k}`, `must be within ${p.min}..${p.max}`);
    else resolved[k] = val;
  }
  const data: Record<string, unknown> = { ...migrated };
  for (const key of ["world", "timeline", "end", "assertions"]) data[key] = substitute(migrated[key], resolved, `$.${key}`, v.errors);

  num(v, data.schema, "$.schema", { int: true });
  str(v, data.name, "$.name");
  if (data.title !== undefined && typeof data.title !== "string") err(v, "$.title", "must be a string");
  if (data.description !== undefined && typeof data.description !== "string") err(v, "$.description", "must be a string");
  if (str(v, data.profile, "$.profile") && !PROFILES[data.profile as string]) {
    err(v, "$.profile", `unknown profile "${data.profile}" (known: ${Object.keys(PROFILES).join(", ")})`);
  }
  num(v, data.seed, "$.seed", { int: true });

  const ids = new Set<string>();
  if (!isObj(data.world) || !Array.isArray(data.world.bodies)) err(v, "$.world.bodies", "must be an array");
  else {
    data.world.bodies.forEach((b, i) => {
      validateBody(v, b, `$.world.bodies[${i}]`);
      if (isObj(b) && typeof b.id === "string") {
        if (ids.has(b.id)) err(v, `$.world.bodies[${i}].id`, `duplicate id "${b.id}"`);
        ids.add(b.id);
      }
    });
    if (data.world.gravity !== undefined) vec(v, data.world.gravity, "$.world.gravity");
    if (data.world.joints !== undefined) {
      if (!Array.isArray(data.world.joints)) err(v, "$.world.joints", "must be an array");
      else data.world.joints.forEach((j, i) => validateJoint(v, j, `$.world.joints[${i}]`));
    }
    if (data.world.asteroids !== undefined) {
      if (!Array.isArray(data.world.asteroids)) err(v, "$.world.asteroids", "must be an array");
      else
        data.world.asteroids.forEach((a, i) => {
          const p = `$.world.asteroids[${i}]`;
          if (!isObj(a)) return err(v, p, "must be an object {id, seed, pieces, radius, density, bond, position}");
          str(v, a.id, `${p}.id`);
          num(v, a.seed, `${p}.seed`, { int: true });
          num(v, a.pieces, `${p}.pieces`, { int: true, min: 1, max: 200 });
          for (const k of ["radius", "density", "bond"]) num(v, a[k], `${p}.${k}`, { positive: true });
          vec(v, a.position, `${p}.position`);
          if (a.velocity !== undefined) vec(v, a.velocity, `${p}.velocity`);
          for (const k of ["angle", "angularVelocity"]) if (a[k] !== undefined) num(v, a[k], `${p}.${k}`);
          if (a.material !== undefined) validateMaterial(v, a.material, `${p}.material`);
          for (const k of ["gold", "compounds"]) if (a[k] !== undefined) num(v, a[k], `${p}.${k}`, { int: true, min: 0, max: 50 });
          if (a.compoundSize !== undefined) num(v, a.compoundSize, `${p}.compoundSize`, { int: true, min: 2, max: 20 });
          for (const k of ["goldDensity", "seamStrength"]) if (a[k] !== undefined) num(v, a[k], `${p}.${k}`, { positive: true });
          if (a.reveal !== undefined) num(v, a.reveal, `${p}.reveal`, { min: 0, max: 1 });
        });
    }
    if (data.world.links !== undefined) {
      if (!Array.isArray(data.world.links)) err(v, "$.world.links", "must be an array");
      else data.world.links.forEach((l, i) => validateLink(v, l, `$.world.links[${i}]`));
    }
    if (data.world.gas !== undefined) {
      if (!Array.isArray(data.world.gas)) err(v, "$.world.gas", "must be an array of fills");
      else data.world.gas.forEach((f, i) => validateFill(v, f, `$.world.gas[${i}]`));
    }
    if (data.world.bounds !== undefined) validateBounds(v, data.world.bounds, "$.world.bounds");
    if (data.world.challenge !== undefined) validateChallenge(v, data.world.challenge, data.world.bodies, "$.world.challenge");
  }

  let endSteps = Infinity;
  if (!isObj(data.end)) err(v, "$.end", "must be an object {steps}");
  else if (num(v, data.end.steps, "$.end.steps", { int: true, min: 0 })) endSteps = data.end.steps as number;

  if (!Array.isArray(data.timeline)) err(v, "$.timeline", "must be an array");
  else
    data.timeline.forEach((e, i) => {
      const p = `$.timeline[${i}]`;
      if (!isObj(e)) return err(v, p, "must be an object {step, commands}");
      if (num(v, e.step, `${p}.step`, { int: true, min: 0 }) && (e.step as number) >= endSteps) {
        err(v, `${p}.step`, `is at or after the end (${endSteps}) so would never run`);
      }
      if (!Array.isArray(e.commands)) err(v, `${p}.commands`, "must be an array");
      else e.commands.forEach((c, j) => validateCommand(v, c, `${p}.commands[${j}]`));
    });

  const probeIds = new Set<string>();
  if (!Array.isArray(data.probes)) err(v, "$.probes", "must be an array");
  else
    data.probes.forEach((p, i) => {
      const path = `$.probes[${i}]`;
      if (!isObj(p)) return err(v, path, "must be an object {id, path}");
      if (str(v, p.id, `${path}.id`)) {
        if (probeIds.has(p.id as string)) err(v, `${path}.id`, `duplicate probe id "${p.id}"`);
        if ((p.id as string) in resolved) err(v, `${path}.id`, `"${p.id}" is already a parameter name`);
        probeIds.add(p.id as string);
      }
      if (str(v, p.path, `${path}.path`)) {
        try {
          resolvePath({}, p.path as string);
        } catch (e) {
          err(v, `${path}.path`, (e as Error).message);
        }
      }
    });

  const names = new Set([...probeIds, ...Object.keys(resolved)]);
  if (!Array.isArray(data.assertions)) err(v, "$.assertions", "must be an array");
  else data.assertions.forEach((a, i) => validateAssertion(v, a, `$.assertions[${i}]`, names, probeIds));

  if (data.ui !== undefined) {
    if (!isObj(data.ui)) err(v, "$.ui", "must be an object");
    else {
      if (data.ui.lookFor !== undefined && typeof data.ui.lookFor !== "string") err(v, "$.ui.lookFor", "must be a string");
      if (data.ui.labels !== undefined && typeof data.ui.labels !== "boolean") err(v, "$.ui.labels", "must be true or false");
      if (data.ui.follow !== undefined && !(typeof data.ui.follow === "string" && ids.has(data.ui.follow))) err(v, "$.ui.follow", "must be the id of a body in the world");
      if (data.ui.keys !== undefined) {
        if (!isObj(data.ui.keys)) err(v, "$.ui.keys", "must be an object of key → channel");
        else for (const [k, ch] of Object.entries(data.ui.keys)) if (!/^[a-z0-9]$/.test(k) || typeof ch !== "string" || !ch) err(v, `$.ui.keys.${k}`, "must map one lower-case letter or digit to a channel name");
      }
      for (const k of ["overlays", "graphs"]) {
        const arr = data.ui[k];
        if (arr !== undefined && (!Array.isArray(arr) || arr.some((x) => typeof x !== "string"))) err(v, `$.ui.${k}`, "must be an array of strings");
      }
      if (data.ui.camera !== undefined) {
        const c = data.ui.camera;
        if (!isObj(c)) err(v, "$.ui.camera", "must be an object {x, y, zoom}");
        else {
          num(v, c.x, "$.ui.camera.x");
          num(v, c.y, "$.ui.camera.y");
          num(v, c.zoom, "$.ui.camera.zoom", { positive: true });
        }
      }
    }
  }

  if (v.errors.length) throw new ScenarioError(v.errors);
  return { ...(data as unknown as Scenario), values: resolved };
}

/** The scenario as a file: parameter placeholders are not re-inserted, values are dropped. */
export function scenarioToJson(scn: Scenario): Record<string, unknown> {
  const { values: _values, ...rest } = scn;
  void _values;
  return structuredClone(rest) as unknown as Record<string, unknown>;
}

// ---------- Running ----------

export interface AssertionResult {
  index: number;
  kind: Assertion["kind"];
  pass: boolean;
  message: string;
}

export interface RunResult {
  scenario: string;
  steps: number;
  world: World;
  finalHash: string;
  /** Hash after every tick, index = tick (DET-001). Only when requested. */
  hashes?: string[];
  /** probes[id][tick] — NaN where the path did not resolve to a number. */
  probes: Record<string, number[]>;
  assertions: AssertionResult[];
  passed: boolean;
}

/** Builds the scenario's world at tick 0, with step-0 commands not yet applied. */
export function initialWorld(scn: Scenario): World {
  // Generated asteroids (AST-002) become ordinary pieces and bonds.
  const made = (scn.world.asteroids ?? []).map(generateAsteroid);
  return createWorld(
    scn.seed,
    [...scn.world.bodies, ...made.flatMap((a) => a.bodies)],
    scn.world.gravity,
    { joints: [...(scn.world.joints ?? []), ...made.flatMap((a) => a.joints)], links: scn.world.links, gas: scn.world.gas, bounds: scn.world.bounds, challenge: scn.world.challenge },
    getProfile(scn.profile),
  );
}

export function timelineByStep(scn: Scenario): Map<number, Command[]> {
  const byStep = new Map<number, Command[]>();
  for (const e of scn.timeline) byStep.set(e.step, [...(byStep.get(e.step) ?? []), ...e.commands]);
  return byStep;
}

export function runScenario(scn: Scenario, opts: { recordHashes?: boolean; steps?: number } = {}): RunResult {
  const profile = getProfile(scn.profile);
  const world = initialWorld(scn);
  const byStep = timelineByStep(scn);
  const steps = opts.steps ?? scn.end.steps;

  const probes: Record<string, number[]> = {};
  for (const p of scn.probes) probes[p.id] = [];
  const sample = () => {
    for (const p of scn.probes) {
      const v = resolveProbe(world, p.path);
      probes[p.id].push(typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : NaN);
    }
  };
  const hashes: string[] | undefined = opts.recordHashes ? [hashValue(world)] : undefined;
  sample();
  for (let s = 0; s < steps; s++) {
    stepInPlace(world, byStep.get(s) ?? [], profile);
    sample();
    hashes?.push(hashValue(world));
  }

  const assertions = scn.assertions.map((a, index) => checkAssertion(a, index, probes, scn.values, world, steps));
  return {
    scenario: scn.name,
    steps,
    world,
    finalHash: hashes ? hashes[hashes.length - 1] : hashValue(world),
    hashes,
    probes,
    assertions,
    passed: assertions.every((a) => a.pass),
  };
}

function checkAssertion(
  a: Assertion,
  index: number,
  probes: Record<string, number[]>,
  params: Record<string, number>,
  world: World,
  last: number,
): AssertionResult {
  const tick = (s: number | "end") => (s === "end" ? last : s);
  const fmt = (x: number) => (Number.isFinite(x) ? x.toPrecision(6) : String(x));
  const res = (pass: boolean, message: string): AssertionResult => ({ index, kind: a.kind, pass, message });
  const outOfRange = (t: number) => t < 0 || t > last;

  switch (a.kind) {
    case "valueAt": {
      const t = tick(a.step);
      if (outOfRange(t)) return res(false, `step ${t} is outside 0..${last}`);
      const got = probes[a.probe][t];
      const pass = Math.abs(got - a.equals) <= a.tol;
      return res(pass, `${a.probe}@${t} = ${fmt(got)}, expected ${fmt(a.equals)} ± ${a.tol}`);
    }
    case "rangeOver": {
      const from = tick(a.from);
      const to = tick(a.to);
      if (outOfRange(from) || outOfRange(to) || from > to) return res(false, `range ${from}..${to} is invalid for 0..${last}`);
      for (let t = from; t <= to; t++) {
        const v = probes[a.probe][t];
        if (!(a.min === undefined || v >= a.min) || !(a.max === undefined || v <= a.max)) {
          return res(false, `${a.probe}@${t} = ${fmt(v)} is outside [${a.min ?? "-∞"}, ${a.max ?? "∞"}]`);
        }
      }
      return res(true, `${a.probe} stayed within [${a.min ?? "-∞"}, ${a.max ?? "∞"}] over ${from}..${to}`);
    }
    case "event": {
      const from = a.from === undefined ? 0 : tick(a.from);
      const to = a.to === undefined ? last : tick(a.to);
      const found = world.events.some((e) => e.type === a.type && e.tick >= from && e.tick <= to);
      return res(found === a.occurred, `event "${a.type}" ${found ? "occurred" : "did not occur"} in ${from}..${to}`);
    }
    case "formula": {
      const at = tick(a.at);
      if (outOfRange(at)) return res(false, `step ${at} is outside 0..${last}`);
      const lookup = (id: string, ref: number | "here" | "end") =>
        id in probes ? (probes[id][ref === "here" ? at : ref === "end" ? last : ref] ?? NaN) : (params[id] ?? NaN);
      const l = evaluateFormula(a.left, lookup);
      const r = evaluateFormula(a.right, lookup);
      const diff = Math.abs(l - r);
      const limit = a.relative ? a.tol * Math.abs(r) : a.tol;
      return res(diff <= limit, `at ${at}: ${a.left} = ${fmt(l)}, ${a.right} = ${fmt(r)}, |diff| ${fmt(diff)} vs ${a.relative ? "relative " : ""}tol ${a.tol}`);
    }
    case "ledgerResidual": {
      const m = world.ledger.maxResidual;
      const value = a.quantity === "momentum" ? Math.max(m.momentumX, m.momentumY) : m[a.quantity];
      return res(value <= a.maxAbs, `largest ${a.quantity} residual ${fmt(value)} vs limit ${a.maxAbs}`);
    }
  }
}
