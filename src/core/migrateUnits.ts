// Scenario schema 1 → 2 (SCN-007; docs/units-rescale-plan.md, stage 2): from the core's units to the
// game's (lengths ×4, masses ×1024). Every number is converted by its dimension (scaleScenario.ts's
// table), and so is everything that stands for a number:
//   - a parameter by its unit ("m", "kg", "N", "m/s", "N·s"; anything else is kept): its default,
//     range and step;
//   - a placeholder: {"$param": p} where the field's factor differs from p's becomes p times their
//     ratio; a formula {"$expr": e} becomes e, with each parameter put back in its old units, times
//     the field's factor;
//   - an assertion: a value or a range by its probe's dimension; a formula with each probe and
//     parameter put back in its old units, so it checks exactly what it did; a ledger residual by
//     its quantity;
//   - the camera: its centre ×4, its zoom (pixels per metre) ÷4.
// Every factor is a power of two, so all of it is exact: a converted scenario runs bit for bit as
// the old one, divided by its factors (UNITS-003).

import { walk } from "./scaleScenario.ts";
import { D, factor, GAME_UNITS, type Dim, type Units } from "./units.ts";

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** A parameter's dimension, from its unit. */
const UNIT_DIM: Record<string, Dim> = { m: D.length, kg: D.mass, N: D.force, "m/s": D.speed, "N·s": D.momentum, J: D.energy };

/** Probe paths' last keys that are dimensionless. */
const PROBE_NONE = new Set(["angularVelocity", "angle", "integrity", "count", "length", "fraction", "value", "tick", "time", "substeps", "temperature", "tilt"]);

/** A probe's dimension, from its path (probes.ts): by its last key, and the one before for vectors. */
export function probeDim(path: string): Dim {
  const keys = path.replace(/\[[^\]]*\]/g, "").split(".");
  const key = keys[keys.length - 1];
  const prev = keys[keys.length - 2];
  if (key === "x" || key === "y") {
    if (prev === "velocity") return D.speed;
    if (prev === "position" || prev === "centre") return D.length;
    if (prev === "momentum") return D.momentum;
  }
  if (key === "vx" || key === "vy") return D.speed;
  if (key === "altitude" || key === "spread") return D.length;
  if (key === "mass" || key === "fuel" || prev === "delivered") return D.mass;
  if (key === "angularMomentum") return D.angularMomentum;
  if (key === "kinetic" || key === "thermal" || prev === "energy") return D.energy;
  if (key === "tension" || key === "compression" || key === "shear") return D.force;
  if (key === "torque") return D.energy;
  if (key === "wallImpulse") return D.momentum;
  if (PROBE_NONE.has(key)) return D.none;
  throw new Error(`probe "${path}": no dimension known for it (migrateUnits.ts probeDim)`);
}

const LEDGER: Record<string, Dim> = { mass: D.mass, momentum: D.momentum, angularMomentum: D.angularMomentum, energy: D.energy };

/** Exactly the number, as a formula literal. */
const lit = (x: number): string => String(x);

/**
 * `src` with each name in `scale` (a parameter or probe, with or without @step) divided by its
 * factor, and the rest as it was. Numbers are left alone, however written.
 */
export function rescaleFormula(src: string, scale: Record<string, number>): string {
  const re = /(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)(@(?:\d+|end))?|([\s\S])/g;
  let out = "";
  for (const m of src.matchAll(re)) {
    const f = m[2] !== undefined ? scale[m[2]] : undefined;
    out += f !== undefined && f !== 1 ? `(${m[2]}${m[3] ?? ""} / ${lit(f)})` : m[0];
  }
  return out;
}

/**
 * A schema 1 scenario (the core's units) as schema 2 (the game's): see the top of this file. `by` is
 * the conversion (default the game's units). Throws on a number it finds no dimension for, so
 * nothing is left behind unconverted.
 */
export function migrateUnits(raw: Record<string, unknown>, by: Units = GAME_UNITS): Record<string, unknown> {
  const f = (d: Dim | undefined) => (d ? factor(by, d) : 1);
  const params = (Array.isArray(raw.parameters) ? raw.parameters : []) as Record<string, unknown>[];
  const pf: Record<string, number> = {};
  for (const p of params) if (typeof p.id === "string") pf[p.id] = f(UNIT_DIM[typeof p.unit === "string" ? p.unit : ""]);
  // A value standing for a number of factor `to`: a placeholder rewritten, or a number converted.
  const holder = (v: Record<string, unknown>, to: number): unknown => {
    if (typeof v.$param === "string") {
      const from = pf[v.$param] ?? 1;
      return from === to ? v : { $expr: `${v.$param} * ${lit(to / from)}` };
    }
    if (typeof v.$expr === "string") {
      const e = rescaleFormula(v.$expr, pf);
      return to === 1 ? { $expr: e } : { $expr: `(${e}) * ${lit(to)}` };
    }
    return undefined;
  };
  const value = (v: unknown, to: number): unknown => (typeof v === "number" ? v * to : isObj(v) ? (holder(v, to) ?? v) : v);
  const unknown = new Set<string>();
  const num = (n: number, d: Dim | undefined) => n * f(d);
  const leaf = (v: Record<string, unknown>, d: Dim | undefined) => holder(v, f(d));

  const out: Record<string, unknown> = { ...raw, schema: 2 };
  if (params.length) {
    out.parameters = params.map((p) => {
      const k = pf[p.id as string] ?? 1;
      const q: Record<string, unknown> = { ...p };
      for (const key of ["default", "min", "max", "step"]) if (typeof q[key] === "number") q[key] = (q[key] as number) * k;
      return q;
    });
  }
  if (isObj(raw.world)) {
    const { units: _u, ...world } = raw.world;
    void _u;
    out.world = walk(world, "world", num, unknown, leaf);
  }
  if (raw.timeline !== undefined) out.timeline = walk(raw.timeline, "timeline", num, unknown, leaf);
  // Assertions: by the probes they read.
  const probes = (Array.isArray(raw.probes) ? raw.probes : []) as { id: string; path: string }[];
  const qf: Record<string, number> = {};
  for (const p of probes) qf[p.id] = f(probeDim(p.path));
  const names = { ...pf, ...qf };
  if (Array.isArray(raw.assertions)) {
    out.assertions = raw.assertions.map((a: Record<string, unknown>) => {
      const b: Record<string, unknown> = { ...a };
      if (a.kind === "valueAt" || a.kind === "rangeOver") {
        const k = qf[a.probe as string] ?? 1;
        for (const key of ["equals", "tol", "min", "max"]) if (b[key] !== undefined) b[key] = value(b[key], k);
      } else if (a.kind === "formula") {
        b.left = rescaleFormula(a.left as string, names);
        b.right = rescaleFormula(a.right as string, names);
      } else if (a.kind === "ledgerResidual") b.maxAbs = value(a.maxAbs, f(LEDGER[a.quantity as string]));
      return b;
    });
  }
  if (isObj(raw.ui)) {
    const ui: Record<string, unknown> = { ...raw.ui };
    if (isObj(ui.camera)) {
      const c = ui.camera as { x: number; y: number; zoom: number };
      ui.camera = { ...c, x: c.x * f(D.length), y: c.y * f(D.length), zoom: c.zoom / f(D.length) };
    }
    if (ui.spawn !== undefined) ui.spawn = walk(ui.spawn, "spawn", num, unknown, leaf);
    out.ui = ui;
  }
  if (unknown.size) throw new Error(`migrateUnits: no dimension known for ${[...unknown].sort().join(", ")}`);
  return out;
}

/**
 * A schema 2 scenario (the game's units) back in the core's own, as schema 1: the inverse of
 * `migrateUnits`, for the scripts that build levels in the core's units from other levels.
 */
export function toCoreUnits(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.schema !== 2) return raw;
  return { ...migrateUnits(raw, { length: 1 / GAME_UNITS.length, mass: 1 / GAME_UNITS.mass }), schema: 1 };
}
