// Scenario files: schema, validation with JSON paths, migration, and running
// with probes and assertions (SCN-001, SCN-002, SCN-003, SCN-007).

import { hashValue } from "./canonical.ts";
import { evaluateFormula } from "./formula.ts";
import { resolvePath } from "./path.ts";
import { PROFILES, getProfile } from "./profile.ts";
import { createWorld, stepInPlace, type Body, type Command, type World } from "./world.ts";

export const SCENARIO_SCHEMA = 1;

export interface Probe {
  id: string;
  path: string;
}

export type Assertion =
  | { kind: "valueAt"; probe: string; step: number | "end"; equals: number; tol: number }
  | { kind: "rangeOver"; probe: string; from: number; to: number | "end"; min?: number; max?: number }
  | { kind: "event"; type: string; occurred: boolean; from?: number; to?: number | "end" }
  | { kind: "formula"; at: number | "end"; left: string; right: string; tol: number; relative?: boolean }
  | { kind: "ledgerResidual"; quantity: string; maxAbs: number };

export interface Scenario {
  schema: number;
  name: string;
  description?: string;
  profile: string;
  seed: number;
  world: { bodies: Body[] };
  timeline: { step: number; commands: Command[] }[];
  end: { steps: number };
  probes: Probe[];
  assertions: Assertion[];
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

// ---------- Validation (SCN-002) ----------

type V = { errors: ValidationError[] };
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function err(v: V, path: string, message: string): void {
  v.errors.push({ path, message });
}
function num(v: V, x: unknown, path: string, opts: { int?: boolean; min?: number; positive?: boolean } = {}): boolean {
  if (typeof x !== "number" || !Number.isFinite(x)) return err(v, path, "must be a finite number"), false;
  if (opts.int && !Number.isInteger(x)) return err(v, path, "must be an integer"), false;
  if (opts.min !== undefined && x < opts.min) return err(v, path, `must be ≥ ${opts.min}`), false;
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

function validateBody(v: V, b: unknown, path: string, partial = false): void {
  if (!isObj(b)) return err(v, path, "must be an object");
  const has = (k: string) => !partial || b[k] !== undefined;
  if (!partial) str(v, b.id, `${path}.id`);
  if (has("shape")) {
    if (!isObj(b.shape) || b.shape.kind !== "disc") err(v, `${path}.shape`, 'must be {"kind": "disc", "radius": number}');
    else num(v, b.shape.radius, `${path}.shape.radius`, { positive: true });
  }
  if (has("mass")) num(v, b.mass, `${path}.mass`, { positive: true });
  if (has("position")) vec(v, b.position, `${path}.position`);
  if (has("velocity")) vec(v, b.velocity, `${path}.velocity`);
  if (has("angle")) num(v, b.angle, `${path}.angle`);
  if (has("angularVelocity")) num(v, b.angularVelocity, `${path}.angularVelocity`);
}

function validateCommand(v: V, c: unknown, path: string): void {
  if (!isObj(c)) return err(v, path, "must be an object");
  switch (c.type) {
    case "body.add":
      return validateBody(v, c.body, `${path}.body`);
    case "body.remove":
      str(v, c.id, `${path}.id`);
      return;
    case "body.set":
      str(v, c.id, `${path}.id`);
      if (isObj(c.patch) && "id" in c.patch) err(v, `${path}.patch.id`, "cannot change a body's id");
      return validateBody(v, c.patch, `${path}.patch`, true);
    case "rng.sample":
      str(v, c.label, `${path}.label`);
      return;
    default:
      err(v, `${path}.type`, `unknown command type ${JSON.stringify(c.type)}`);
  }
}

function validateAssertion(v: V, a: unknown, path: string, probeIds: Set<string>): void {
  if (!isObj(a)) return err(v, path, "must be an object");
  const probe = (k: string) => {
    if (str(v, a[k], `${path}.${k}`) && !probeIds.has(a[k] as string)) err(v, `${path}.${k}`, `unknown probe "${a[k]}"`);
  };
  const expr = (k: string) => {
    if (!str(v, a[k], `${path}.${k}`)) return;
    try {
      evaluateFormula(a[k] as string, (id) => {
        if (!probeIds.has(id)) throw new Error(`unknown probe "${id}"`);
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
      str(v, a.quantity, `${path}.quantity`);
      num(v, a.maxAbs, `${path}.maxAbs`, { min: 0 });
      return;
    default:
      err(v, `${path}.kind`, `unknown assertion kind ${JSON.stringify(a.kind)}`);
  }
}

/** Migrates and validates untrusted input. Throws ScenarioError listing every problem. */
export function parseScenario(raw: unknown): Scenario {
  const data = migrateScenario(raw);
  const v: V = { errors: [] };
  if (!isObj(data)) throw new ScenarioError([{ path: "$", message: "must be a JSON object" }]);
  num(v, data.schema, "$.schema", { int: true });
  str(v, data.name, "$.name");
  if (data.description !== undefined && typeof data.description !== "string") err(v, "$.description", "must be a string");
  if (str(v, data.profile, "$.profile") && !PROFILES[data.profile as string]) {
    err(v, "$.profile", `unknown profile "${data.profile}" (known: ${Object.keys(PROFILES).join(", ")})`);
  }
  num(v, data.seed, "$.seed", { int: true });

  const ids = new Set<string>();
  if (!isObj(data.world) || !Array.isArray(data.world.bodies)) err(v, "$.world.bodies", "must be an array");
  else
    data.world.bodies.forEach((b, i) => {
      validateBody(v, b, `$.world.bodies[${i}]`);
      if (isObj(b) && typeof b.id === "string") {
        if (ids.has(b.id)) err(v, `$.world.bodies[${i}].id`, `duplicate id "${b.id}"`);
        ids.add(b.id);
      }
    });

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

  if (!Array.isArray(data.assertions)) err(v, "$.assertions", "must be an array");
  else data.assertions.forEach((a, i) => validateAssertion(v, a, `$.assertions[${i}]`, probeIds));

  if (v.errors.length) throw new ScenarioError(v.errors);
  return data as unknown as Scenario;
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

export function runScenario(scn: Scenario, opts: { recordHashes?: boolean } = {}): RunResult {
  const profile = getProfile(scn.profile);
  const world = createWorld(scn.seed, scn.world.bodies);
  const byStep = new Map<number, Command[]>();
  for (const e of scn.timeline) byStep.set(e.step, [...(byStep.get(e.step) ?? []), ...e.commands]);

  const probes: Record<string, number[]> = {};
  for (const p of scn.probes) probes[p.id] = [];
  const sample = () => {
    for (const p of scn.probes) {
      const v = resolvePath(world, p.path);
      probes[p.id].push(typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : NaN);
    }
  };
  const hashes: string[] | undefined = opts.recordHashes ? [hashValue(world)] : undefined;
  sample();
  for (let s = 0; s < scn.end.steps; s++) {
    stepInPlace(world, byStep.get(s) ?? [], profile);
    sample();
    hashes?.push(hashValue(world));
  }

  const assertions = scn.assertions.map((a, index) => checkAssertion(a, index, probes, world, scn.end.steps));
  return {
    scenario: scn.name,
    steps: scn.end.steps,
    world,
    finalHash: hashes ? hashes[hashes.length - 1] : hashValue(world),
    hashes,
    probes,
    assertions,
    passed: assertions.every((a) => a.pass),
  };
}

function checkAssertion(a: Assertion, index: number, probes: Record<string, number[]>, world: World, last: number): AssertionResult {
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
      const lookup = (id: string, ref: number | "here" | "end") => probes[id][ref === "here" ? at : ref === "end" ? last : ref] ?? NaN;
      const l = evaluateFormula(a.left, lookup);
      const r = evaluateFormula(a.right, lookup);
      const diff = Math.abs(l - r);
      const limit = a.relative ? a.tol * Math.abs(r) : a.tol;
      return res(diff <= limit, `at ${at}: ${a.left} = ${fmt(l)}, ${a.right} = ${fmt(r)}, |diff| ${fmt(diff)} vs ${a.relative ? "relative " : ""}tol ${a.tol}`);
    }
    case "ledgerResidual":
      return res(false, "the conservation ledger arrives in M1; this assertion cannot pass yet");
  }
}
