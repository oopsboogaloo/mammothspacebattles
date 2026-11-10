// Gas parcels (GAS-001…GAS-007, PRF-003).
//
// Model: smoothed-particle hydrodynamics (SPH, Monaghan 1992, "Smoothed particle
// hydrodynamics", ARA&A 30:543) for an ideal gas, P = (γ − 1)·ρ·u.
// Geometry is 2D: density is kg/m² and pressure N/m. Thermodynamics is per
// species (molar mass and γ), so temperature and sound speed are the 3D values.
//
// Each pair of parcels exchanges an equal and opposite impulse along the line
// between them (GAS-002), so momentum and angular momentum are conserved
// exactly. The kinetic energy the pair gains or loses is computed exactly and
// taken from, or given to, their thermal energy, split in proportion to each
// parcel's pressure term. Total energy is therefore conserved to rounding:
// compression heats, expansion cools, and artificial viscosity turns relative
// motion into heat.
//
// Wall model (GAS-004): a body surface acts as a mirror. A parcel within one
// smoothing length of a surface sees the kernel volume beyond it filled with a
// mirror image of its own gas: its density is renormalised for the missing
// share, and the mirror pushes it with the pressure that share would exert
// (a semi-analytic wall; Kulasegaram et al. 2004, Ferrand et al. 2013). For gas at
// rest this is exactly P per metre of wall. The impulse acts along the surface
// normal at the nearest surface point, on the parcel and, equal and opposite,
// on the body (or its free assembly as one rigid unit).
// The energy exchanged is again settled exactly against the parcel's thermal
// energy. A parcel that still reaches the surface bounces elastically.
//
// Kernel (2D): Wendland C2, W = 7/(πh²)·(1 − q)⁴·(1 + 4q) with q = r/h, used for
// both density and pressure so the scheme stays consistent. It does not suffer
// the pairing instability (Dehnen & Aly 2012, MNRAS 425:1068).

import { assemblyRoots } from "./joints.ts";
import { cross, rotate, sinCos, type Vec2 } from "./math.ts";
import { nextFloat, type RngState } from "./prng.ts";
import { boundingRadiusOf, localVertices, massProps, type Shape } from "./shapes.ts";
import { bodyMass, type Store } from "./bodies.ts";
import { gasCoreWasm, gasParcelBuffers } from "./gasWasm.ts";

/** Universal gas constant, J/(mol·K) (CODATA 2018, exact). */
export const R_GAS = 8.314462618;

export interface Species {
  /** kg/mol */
  molarMass: number;
  /** Ratio of specific heats near 300 K. */
  gamma: number;
  /** Colour for composition view. */
  colour: string;
  /** Chemical energy relative to the reaction products, J/kg (declared; 0 for oxidisers and products). */
  heat?: number;
}

/**
 * Species table. Molar masses from IUPAC standard atomic weights; γ near 300 K
 * from standard tables (e.g. Engineering ToolBox, "Specific heat ratio of gases").
 */
export const SPECIES: Readonly<Record<string, Species>> = {
  air: { molarMass: 0.028965, gamma: 1.4, colour: "#88c0ff" },
  helium: { molarMass: 0.0040026, gamma: 5 / 3, colour: "#ffd166" },
  co2: { molarMass: 0.04401, gamma: 1.289, colour: "#ef8a62" },
  h2o: { molarMass: 0.018015, gamma: 1.33, colour: "#67a9cf" },
  // Declared heat: 3.4e7 J/kg of H₂ (the lower heating value is 1.2e8). With 8 kg O₂ per kg H₂ the
  // products reach about 3,000 K, as dissociation limits a real H₂/O₂ flame to (PRP-003).
  h2: { molarMass: 0.002016, gamma: 1.405, colour: "#f7f7f7", heat: 3.4e7 },
  o2: { molarMass: 0.031998, gamma: 1.395, colour: "#b2182b" },
};

/** Declared reaction rules (PRP-003): fuel + ratio × oxidiser → product, releasing the fuel's heat. */
export interface Reaction {
  fuel: string;
  oxidiser: string;
  product: string;
  /** kg of oxidiser per kg of fuel. */
  ratio: number;
  /** Gas at or above this temperature, or next to gas that is, ignites, K. */
  ignition: number;
}

export const REACTIONS: readonly Reaction[] = [{ fuel: "h2", oxidiser: "o2", product: "h2o", ratio: 8, ignition: 800 }];

/** Temperature of propellant in stores, K. Injected gas starts at this temperature. */
export const STORE_TEMPERATURE = 300;

/** Thermal and chemical energy of a store's contents, J (0 for resources that are not gas species). */
export function storeEnergy(st: { resource: string; mass: number }, scale = 1): { thermal: number; chemical: number } {
  return { thermal: storeThermal(st, scale), chemical: storeChemical(st, scale) };
}

/** storeEnergy's thermal part alone, without making an object (the ledger asks many times a step). */
export function storeThermal(st: { resource: string; mass: number }, scale = 1): number {
  const sp = SPECIES[st.resource];
  if (!sp) return 0;
  const cv = R_GAS / sp.molarMass / (sp.gamma - 1);
  return (st.mass * cv * STORE_TEMPERATURE) / scale;
}

/** storeEnergy's chemical part alone. */
export function storeChemical(st: { resource: string; mass: number }, scale = 1): number {
  const sp = SPECIES[st.resource];
  return sp ? (st.mass * (sp.heat ?? 0)) / scale : 0;
}

/**
 * Chemical energy per kg of each composition, J/kg. A composition is never changed once a parcel or
 * chamber holds it (burning, mixing and drawing make a new object), so the sum is worked out once
 * per object: the ledger asks for every parcel's chemical energy many times a step.
 */
const heatPerKg = new WeakMap<Record<string, number>, number>();
function compositionHeat(c: Record<string, number>): number {
  let e = heatPerKg.get(c);
  if (e === undefined) {
    e = 0;
    for (const k in c) e += c[k] * (SPECIES[k]?.heat ?? 0);
    heatPerKg.set(c, e);
  }
  return e;
}

/** Chemical energy a parcel still holds, J. */
export function parcelChemical(p: { mass: number; composition: Record<string, number> }, scale = 1): number {
  return (p.mass * compositionHeat(p.composition)) / scale;
}

/**
 * Burns what a parcel can of each reaction, completely (fast chemistry). Mass and momentum are
 * unchanged; the released chemical energy becomes thermal energy, so total energy is unchanged.
 * Returns the energy released, J.
 */
export function burn(p: Parcel, scale = 1): number {
  let released = 0;
  for (const r of REACTIONS) {
    const yf = p.composition[r.fuel] ?? 0;
    const yo = p.composition[r.oxidiser] ?? 0;
    const b = Math.min(yf, yo / r.ratio);
    if (!(b > 0)) continue;
    const before = parcelChemical(p, scale);
    const c: Record<string, number> = { ...p.composition };
    c[r.fuel] = yf - b;
    c[r.oxidiser] = yo - r.ratio * b;
    c[r.product] = (c[r.product] ?? 0) + (1 + r.ratio) * b;
    for (const k of Object.keys(c)) if (!(c[k] > 1e-15)) delete c[k];
    p.composition = c;
    const q = before - parcelChemical(p, scale);
    p.thermal += q;
    released += q;
  }
  return released;
}

/** Reactions that a parcel's composition can still run. */
export function canBurn(p: Parcel): Reaction | null {
  for (const r of REACTIONS) if ((p.composition[r.fuel] ?? 0) > 0 && (p.composition[r.oxidiser] ?? 0) > 0) return r;
  return null;
}

/**
 * Ignition (PRP-003): a parcel that can burn does so when it, or any parcel within its smoothing
 * length, is at or above the reaction's ignition temperature. Returns the parcels that burned.
 */
export function igniteAndBurn(gas: GasState): number {
  const scale = gas.scale ?? 1;
  const ps = gas.parcels;
  const reactive = ps.filter((p) => canBurn(p));
  if (!reactive.length) return 0;
  let tmin = Infinity;
  for (const r of REACTIONS) tmin = Math.min(tmin, r.ignition);
  // Hot parcels, bucketed by cell for the neighbour test.
  let cell = 0;
  for (const p of reactive) cell = Math.max(cell, SMOOTHING * p.radius);
  const hot = new Map<string, Parcel[]>();
  for (const p of ps) {
    if (temperatureOf(p, scale) < tmin) continue;
    const key = `${Math.floor(p.position.x / cell)},${Math.floor(p.position.y / cell)}`;
    const list = hot.get(key);
    if (list) list.push(p);
    else hot.set(key, [p]);
  }
  let burned = 0;
  for (const p of reactive) {
    const r = canBurn(p)!;
    let lit = temperatureOf(p, scale) >= r.ignition;
    const cx = Math.floor(p.position.x / cell);
    const cy = Math.floor(p.position.y / cell);
    const h = SMOOTHING * p.radius;
    for (let dx = -1; dx <= 1 && !lit; dx++)
      for (let dy = -1; dy <= 1 && !lit; dy++)
        for (const q of hot.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (q === p) continue;
          const ddx = q.position.x - p.position.x;
          const ddy = q.position.y - p.position.y;
          if (ddx * ddx + ddy * ddy < h * h && temperatureOf(q, scale) >= r.ignition) {
            lit = true;
            break;
          }
        }
    if (lit && burn(p, scale) > 0) burned++;
  }
  return burned;
}

export interface Parcel {
  id: number;
  mass: number; // kg
  /** Mass fraction per species; sums to 1. */
  composition: Record<string, number>;
  position: Vec2; // m
  velocity: Vec2; // m/s
  /** Thermal (internal) energy, J. */
  thermal: number;
  /** Size of the parcel, m. Its smoothing length is SMOOTHING × radius. */
  radius: number;
  /** Seconds since the parcel was made; kept only in worlds with `bounds.depth`. */
  age?: number;
  /** Chance it is still in the plane, 0–1; kept only in worlds with `bounds.depth` (GAS-009). */
  keep?: number;
}

export interface RemovedGas {
  count: number;
  mass: number; // kg
  momentum: Vec2; // kg·m/s
  angularMomentum: number; // kg·m²/s about the origin
  /** Kinetic + thermal + gravitational potential, J. */
  energy: number;
}

export interface GasState {
  parcels: Parcel[];
  /** Parcels that flew free in the last step (profile.gasFreeFlight); 0 or absent otherwise. */
  free?: number;
  /**
   * The largest smoothing length of all the gas, when part of it flies free and is not in this
   * state: the far field must not depend on which part is stepped. Only on that temporary state.
   */
  farReach?: number;
  nextId: number;
  /** Totals carried out of the world boundary so far (GAS-007). */
  removed: RemovedGas;
  /** Sum of |impulse| the gas has delivered to bodies so far, N·s. A wall-pressure probe. */
  wallImpulse: number;
  /** Substeps the last step needed. */
  substeps: number;
  /**
   * Dynamic scale (DEC-13): gas behaves as if every molar mass were this many times larger. Specific
   * energies at a given temperature are 1/scale as big, so sound and exhaust speeds are 1/√scale as fast.
   * 1 is real gas (the test profile); the sandbox uses 100.
   */
  scale: number;
  /** Most parcels a second one engine's chamber releases (profile.gasParcelRate); absent: no limit. */
  parcelRate?: number;
}

export interface GasFill {
  /** Rectangle to fill, world coordinates, m. */
  min: Vec2;
  max: Vec2;
  count: number;
  /** Total mass, kg. */
  mass: number;
  temperature: number; // K
  composition?: Record<string, number>;
  /** Bulk velocity, m/s. */
  velocity?: Vec2;
  /** Random velocity added to each parcel, up to this speed per axis, m/s. Net momentum is zeroed. */
  jitter?: number;
  /** Mirror the jitter across the rectangle's centre lines, so the fill is symmetric. */
  symmetric?: boolean;
}

/** Smoothing length ÷ parcel radius. With radius = half the spacing, h = 3 spacings (about 28 neighbours); wall pressure then matches the equation of state to about 1%. */
export const SMOOTHING = 6;
// The substep loop's own constants (CFL, retries, viscosity, the hard wall) are with the loop, in
// wasm/solver/src/gas.rs.

export function emptyGas(scale = 1): GasState {
  return {
    scale,
    parcels: [],
    nextId: 1,
    removed: {
      count: 0,
      mass: 0,
      momentum: { x: 0, y: 0 },
      angularMomentum: 0,
      energy: 0,
    },
    wallImpulse: 0,
    substeps: 0,
  };
}

export interface Mixture {
  gamma: number;
  /** Specific heat at constant volume, J/(kg·K). */
  cv: number;
  molarMass: number; // kg/mol
}

const mixtures = new Map<string, Mixture>();

function compositionKey(c: Record<string, number>): string {
  const keys = Object.keys(c);
  if (keys.length === 1) return keys[0] + ":" + c[keys[0]];
  return keys
    .sort()
    .map((k) => k + ":" + c[k])
    .join(",");
}

/**
 * The same, by object: a composition is never changed once it is a parcel's or a vessel's (each
 * change makes a new object), so its mixture is looked up once, not keyed by a sorted string on every
 * call (thousands of strings and arrays a step).
 */
const mixtureOf = new WeakMap<Record<string, number>, Mixture>();

/** Mass-weighted mixture properties. Unknown species are rejected by validation. */
export function mixture(composition: Record<string, number>): Mixture {
  let mx = mixtureOf.get(composition);
  if (mx) return mx;
  const key = compositionKey(composition);
  mx = mixtures.get(key);
  if (!mx) {
    mx = computeMixture(composition);
    if (mixtures.size < 1000) mixtures.set(key, mx);
  }
  mixtureOf.set(composition, mx);
  return mx;
}

function computeMixture(composition: Record<string, number>): Mixture {
  let cv = 0;
  let rSpec = 0;
  let total = 0;
  for (const k of Object.keys(composition).sort()) {
    const y = composition[k];
    const s = SPECIES[k];
    if (!s || !(y > 0)) continue;
    const r = R_GAS / s.molarMass;
    rSpec += y * r;
    cv += (y * r) / (s.gamma - 1);
    total += y;
  }
  if (!(total > 0))
    return {
      gamma: 1.4,
      cv: R_GAS / SPECIES.air.molarMass / 0.4,
      molarMass: SPECIES.air.molarMass,
    };
  rSpec /= total;
  cv /= total;
  return { gamma: 1 + rSpec / cv, cv, molarMass: R_GAS / rSpec };
}

/** Temperature of a parcel, K. `scale` is the gas's dynamic scale (GasState.scale). */
export function temperatureOf(p: Parcel, scale = 1): number {
  return (p.thermal * scale) / (p.mass * mixture(p.composition).cv);
}

export function soundSpeed(p: Parcel): number {
  const { gamma } = mixture(p.composition);
  return Math.sqrt(gamma * (gamma - 1) * Math.max(0, p.thermal / p.mass));
}

/** Gas summary for probes and the UI. */
export interface GasTotals {
  count: number;
  mass: number;
  momentum: Vec2;
  velocity: Vec2; // centre-of-mass velocity
  centre: Vec2; // centre of mass
  angularMomentum: number;
  kinetic: number;
  thermal: number;
  /** Mass-weighted mean temperature, K. */
  temperature: number;
  /** RMS distance from the centre of mass, m. */
  spread: number;
  removed: RemovedGas;
  wallImpulse: number;
  substeps: number;
}

export function gasTotals(gas: GasState): GasTotals {
  let m = 0;
  let px = 0;
  let py = 0;
  let cx = 0;
  let cy = 0;
  let L = 0;
  let ke = 0;
  let th = 0;
  let mT = 0;
  for (const p of gas.parcels) {
    m += p.mass;
    px += p.mass * p.velocity.x;
    py += p.mass * p.velocity.y;
    cx += p.mass * p.position.x;
    cy += p.mass * p.position.y;
    L += p.mass * cross(p.position, p.velocity);
    ke += 0.5 * p.mass * (p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
    th += p.thermal;
    mT += p.mass * temperatureOf(p, gas.scale ?? 1);
  }
  const c = m > 0 ? { x: cx / m, y: cy / m } : { x: 0, y: 0 };
  let s2 = 0;
  for (const p of gas.parcels) s2 += p.mass * ((p.position.x - c.x) ** 2 + (p.position.y - c.y) ** 2);
  return {
    count: gas.parcels.length,
    mass: m,
    momentum: { x: px, y: py },
    velocity: m > 0 ? { x: px / m, y: py / m } : { x: 0, y: 0 },
    centre: c,
    angularMomentum: L,
    kinetic: ke,
    thermal: th,
    temperature: m > 0 ? mT / m : 0,
    spread: m > 0 ? Math.sqrt(s2 / m) : 0,
    removed: structuredClone(gas.removed),
    wallImpulse: gas.wallImpulse,
    substeps: gas.substeps,
  };
}

// ---------- Bodies as walls ----------

/** What the gas needs to know about a body. */
export interface WallBody {
  id: string;
  shape: Shape;
  fixed: boolean;
  mass: number;
  inertia: number;
  position: Vec2;
  angle: number;
  velocity: Vec2;
  angularVelocity: number;
  contents?: { mass: number }[];
}

interface Wall {
  /** Index of the rigid unit this body moves with, or −1 if fixed. */
  unit: number;
  disc: boolean;
  cx: number;
  cy: number;
  radius: number; // disc radius, or bounding radius
  /** Polygon: vertices and outward edge normals, world frame. */
  vx: Float64Array;
  vy: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** A free assembly, or a single body, that the gas pushes as one rigid body. */
interface Unit {
  ids: string[];
  M: number;
  I: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  w: number;
  vx0: number;
  vy0: number;
  w0: number;
  /** Changes accumulated during a substep. */
  dvx: number;
  dvy: number;
  dw: number;
  /** Saved velocities for a substep retry. */
  sx: number;
  sy: number;
  sw: number;
  /**
   * The unit moves with the gas through the step (cx, cy, th are its pose now). Walls are built at
   * the end-of-step pose (ex, ey, angle offset 0); th is the rotation from that pose, with cos/sin qc, qs.
   */
  ex: number;
  ey: number;
  th: number;
  qc: number;
  qs: number;
  /**
   * The furthest any of its walls (their boxes) reaches from its centre of mass, m: a point of the
   * unit's surface moves at most |v| + |ω| × reach.
   */
  reach: number;
}

function buildWalls(bodies: WallBody[], joints: { a: string; b: string }[], margin: number): { walls: Wall[]; units: Unit[] } {
  const roots = joints.length ? assemblyRoots({ bodies, joints } as never) : null;
  const groups = new Map<string, WallBody[]>();
  for (const b of bodies) {
    const r = roots?.get(b.id) ?? b.id;
    const g = groups.get(r);
    if (g) g.push(b);
    else groups.set(r, [b]);
  }
  const unitOf = new Map<string, number>();
  const units: Unit[] = [];
  const addUnit = (members: WallBody[]) => {
    let M = 0;
    let cx = 0;
    let cy = 0;
    let px = 0;
    let py = 0;
    for (const b of members) {
      M += b.mass;
      cx += b.mass * b.position.x;
      cy += b.mass * b.position.y;
      px += b.mass * b.velocity.x;
      py += b.mass * b.velocity.y;
    }
    cx /= M;
    cy /= M;
    let I = 0;
    let L = 0;
    for (const b of members) {
      const dx = b.position.x - cx;
      const dy = b.position.y - cy;
      I += b.inertia + b.mass * (dx * dx + dy * dy);
      L += b.mass * (dx * b.velocity.y - dy * b.velocity.x) + b.inertia * b.angularVelocity;
    }
    const u: Unit = {
      ids: members.map((b) => b.id),
      M,
      I,
      cx,
      cy,
      vx: px / M,
      vy: py / M,
      w: L / I,
      vx0: 0,
      vy0: 0,
      w0: 0,
      dvx: 0,
      dvy: 0,
      dw: 0,
      ex: cx,
      ey: cy,
      th: 0,
      qc: 1,
      qs: 0,
      reach: 0,
      sx: 0,
      sy: 0,
      sw: 0,
    };
    u.vx0 = u.vx;
    u.vy0 = u.vy;
    u.w0 = u.w;
    for (const b of members) unitOf.set(b.id, units.length);
    units.push(u);
  };
  for (const members of groups.values()) {
    if (members.some((b) => b.fixed)) {
      for (const b of members) if (!b.fixed) addUnit([b]);
    } else addUnit(members);
  }
  const walls: Wall[] = [];
  for (const b of bodies) {
    const unit = b.fixed ? -1 : unitOf.get(b.id)!;
    const mp = massProps(b.shape, 1);
    if (b.shape.kind === "disc") {
      const r = b.shape.radius;
      walls.push({
        unit,
        disc: true,
        cx: b.position.x,
        cy: b.position.y,
        radius: r,
        vx: new Float64Array(0),
        vy: new Float64Array(0),
        nx: new Float64Array(0),
        ny: new Float64Array(0),
        minX: b.position.x - r - margin,
        minY: b.position.y - r - margin,
        maxX: b.position.x + r + margin,
        maxY: b.position.y + r + margin,
      });
      continue;
    }
    const q = sinCos(b.angle);
    const local = localVertices(b.shape);
    const n = local.length;
    const vx = new Float64Array(n);
    const vy = new Float64Array(n);
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const w = rotate(q, local[i]);
      vx[i] = b.position.x + w.x;
      vy[i] = b.position.y + w.y;
      minX = Math.min(minX, vx[i]);
      minY = Math.min(minY, vy[i]);
      maxX = Math.max(maxX, vx[i]);
      maxY = Math.max(maxY, vy[i]);
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ex = vx[j] - vx[i];
      const ey = vy[j] - vy[i];
      const l = Math.sqrt(ex * ex + ey * ey);
      nx[i] = ey / l;
      ny[i] = -ex / l;
    }
    walls.push({
      unit,
      disc: false,
      cx: b.position.x,
      cy: b.position.y,
      radius: mp.boundingRadius,
      vx,
      vy,
      nx,
      ny,
      minX: minX - margin,
      minY: minY - margin,
      maxX: maxX + margin,
      maxY: maxY + margin,
    });
  }
  // Each unit's reach from its centre of mass: the furthest corner of its walls' own boxes (without
  // the margin the boxes are grown by: the gas sees the surface move, not the space round it).
  for (const w of walls) {
    if (w.unit < 0) continue;
    const u = units[w.unit];
    const dx = Math.max(Math.abs(w.minX + margin - u.ex), Math.abs(w.maxX - margin - u.ex));
    const dy = Math.max(Math.abs(w.minY + margin - u.ey), Math.abs(w.maxY - margin - u.ey));
    u.reach = Math.max(u.reach, Math.sqrt(dx * dx + dy * dy));
  }
  return { walls, units };
}

/** Signed distance from a point to a wall's surface (negative inside), with the outward normal. Writes into out. */
function surface(w: Wall, px: number, py: number, out: { d: number; nx: number; ny: number }): void {
  if (w.disc) {
    const dx = px - w.cx;
    const dy = py - w.cy;
    const l = Math.sqrt(dx * dx + dy * dy);
    out.d = l - w.radius;
    if (l > 0) {
      out.nx = dx / l;
      out.ny = dy / l;
    } else {
      out.nx = 1;
      out.ny = 0;
    }
    return;
  }
  const n = w.vx.length;
  let best = -Infinity;
  let bi = 0;
  for (let i = 0; i < n; i++) {
    const s = w.nx[i] * (px - w.vx[i]) + w.ny[i] * (py - w.vy[i]);
    if (s > best) {
      best = s;
      bi = i;
    }
  }
  if (best <= 0) {
    out.d = best;
    out.nx = w.nx[bi];
    out.ny = w.ny[bi];
    return;
  }
  // Outside: nearest point on the boundary.
  let bestD2 = Infinity;
  let cxp = 0;
  let cyp = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ex = w.vx[j] - w.vx[i];
    const ey = w.vy[j] - w.vy[i];
    const t = Math.max(0, Math.min(1, ((px - w.vx[i]) * ex + (py - w.vy[i]) * ey) / (ex * ex + ey * ey)));
    const qx = w.vx[i] + t * ex;
    const qy = w.vy[i] + t * ey;
    const d2 = (px - qx) * (px - qx) + (py - qy) * (py - qy);
    if (d2 < bestD2) {
      bestD2 = d2;
      cxp = qx;
      cyp = qy;
    }
  }
  const d = Math.sqrt(bestD2);
  out.d = d;
  if (d > 0) {
    out.nx = (px - cxp) / d;
    out.ny = (py - cyp) / d;
  } else {
    out.nx = w.nx[bi];
    out.ny = w.ny[bi];
  }
}

// ---------- Filling ----------

/** True if the point lies inside, or within `clearance` of, any body. */
function blocked(walls: Wall[], x: number, y: number, clearance: number): boolean {
  const s = { d: 0, nx: 0, ny: 0 };
  for (const w of walls) {
    if (x < w.minX - clearance || x > w.maxX + clearance || y < w.minY - clearance || y > w.maxY + clearance) continue;
    surface(w, x, y, s);
    if (s.d < clearance) return true;
  }
  return false;
}

/** A test for points inside, or within a clearance of, any of these bodies; builds their walls once. */
export function clearOf(bodies: WallBody[]): (x: number, y: number, clearance: number) => boolean {
  const { walls } = buildWalls(bodies, [], 0);
  return (x, y, clearance) => !blocked(walls, x, y, clearance);
}

/**
 * Makes the parcels for a fill: a regular lattice over the rectangle, skipping points inside bodies.
 * The lattice has about `count` points; the result says how many were made. Returns null, having
 * drawn nothing from the RNG, if more than `maxCount` would be made.
 */
export function makeFill(fill: GasFill, rng: RngState, bodies: WallBody[], firstId: number, maxCount = Infinity, scale = 1): Parcel[] | null {
  const w = fill.max.x - fill.min.x;
  const h = fill.max.y - fill.min.y;
  const s = Math.sqrt((w * h) / fill.count);
  const nx = Math.max(1, Math.round(w / s));
  const ny = Math.max(1, Math.round(h / s));
  const sx = w / nx;
  const sy = h / ny;
  const radius = 0.5 * Math.min(sx, sy);
  const { walls } = buildWalls(bodies, [], 0);
  const composition = fill.composition ?? { air: 1 };
  const { cv } = mixture(composition);
  const bulk = fill.velocity ?? { x: 0, y: 0 };
  const jitter = fill.jitter ?? 0;
  // Random velocities: one draw per lattice point, or per mirror class when symmetric.
  const jit = new Map<number, Vec2>();
  const pts: { i: number; j: number; x: number; y: number }[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = fill.min.x + (i + 0.5) * sx;
      const y = fill.min.y + (j + 0.5) * sy;
      if (blocked(walls, x, y, 0.5 * radius)) continue;
      pts.push({ i, j, x, y });
      // Over the limit: stop before doing more work, and draw no random numbers (PRF-003).
      if (pts.length > maxCount) return null;
    }
  }
  const out: Parcel[] = [];
  if (pts.length === 0) return out;
  const m = fill.mass / pts.length;
  for (const p of pts) {
    let vx = 0;
    let vy = 0;
    if (jitter > 0) {
      if (fill.symmetric) {
        const ri = Math.min(p.i, nx - 1 - p.i);
        const rj = Math.min(p.j, ny - 1 - p.j);
        const key = rj * nx + ri;
        if (!jit.has(key))
          jit.set(key, {
            x: (2 * nextFloat(rng) - 1) * jitter,
            y: (2 * nextFloat(rng) - 1) * jitter,
          });
        const r = jit.get(key)!;
        vx = p.i === nx - 1 - p.i ? 0 : p.i === ri ? r.x : -r.x;
        vy = p.j === ny - 1 - p.j ? 0 : p.j === rj ? r.y : -r.y;
      } else {
        vx = (2 * nextFloat(rng) - 1) * jitter;
        vy = (2 * nextFloat(rng) - 1) * jitter;
      }
    }
    out.push({
      id: firstId + out.length,
      mass: m,
      composition: { ...composition },
      position: { x: p.x, y: p.y },
      velocity: { x: vx, y: vy },
      thermal: (m * cv * fill.temperature) / scale,
      radius,
    });
  }
  if (jitter > 0 && !fill.symmetric) {
    let mx = 0;
    let my = 0;
    for (const p of out) {
      mx += p.velocity.x;
      my += p.velocity.y;
    }
    mx /= out.length;
    my /= out.length;
    for (const p of out) p.velocity = { x: p.velocity.x - mx, y: p.velocity.y - my };
  }
  for (const p of out) p.velocity = { x: p.velocity.x + bulk.x, y: p.velocity.y + bulk.y };
  return out;
}

// ---------- Stepping ----------

/** What the gas phase did, for the ledger. */
export interface GasAccount {
  /** Impulse fixed bodies delivered to the gas, N·s. */
  externalImpulse: Vec2;
  /** Angular impulse about the origin fixed bodies delivered, N·m·s. */
  angular: number;
  /** What left through the world boundary this step (positive amounts; energy includes potential). */
  removed: RemovedGas;
  /** Gravitational potential energy of the parcels that left, at the point they left, J. */
  removedPotential: number;
  /**
   * Thermal energy made up when crushed gas could not be resolved (see the clamp in stepGas), J:
   * recorded by the ledger as a correction. The crushed parcels then leave the gas.
   */
  clamped: number;
  /**
   * For parts of free assemblies: the impulse their joints had to supply this step because the gas
   * pushed the assembly as one rigid body (rigid share minus the gas's direct push), for joint loads.
   */
  jointImpulse: Map<string, { x: number; y: number; angular: number }>;
  involved: Set<string>;
}

export interface Bounds {
  min: Vec2;
  max: Vec2;
  /**
   * Gas farther than this from every body also leaves the world (exhaust that has flown off), m.
   * Keeps the parcel count to what can still hit something. Off when absent.
   */
  farField?: number;
  /**
   * Depth of the world out of the plane, m (GAS-009). When set, gas that has left its engine
   * (older than DEPTH_DELAY, outside every engine interior) spreads out of the plane, as a 3D cloud
   * in vacuum would: each step a parcel's chance of still being in the plane is multiplied by
   * 1/(1 + x), x = c·dt/depth with c its sound speed, and it leaves whole once that chance falls
   * below its own fixed threshold. On average the same share of mass leaves as from a thinning
   * cloud, but every parcel keeps its full mass. What leaves is recorded at the boundary. Off when
   * absent: a 2D slab that never thins.
   */
  depth?: number;
  /**
   * The world wraps round at this rectangle (FLT-012): a free assembly whose centre of mass leaves it
   * comes back in at the opposite side, with the gas around it. Gas elsewhere still leaves here.
   */
  wrap?: boolean;
}

/** Gas younger than this has only just been made and doesn't spread out of the plane yet, s. */
export const DEPTH_DELAY = 0.1;
/**
 * A region closed out of the plane (an engine's interior, GAS-009): from (x, y) along the unit
 * vector (ux, uy) for `length`, and `halfWidth` either side. Gas in it never spreads out of the plane.
 */
export interface ClosedRegion {
  x: number;
  y: number;
  ux: number;
  uy: number;
  halfWidth: number;
  length: number;
}
const inClosed = (rs: readonly ClosedRegion[], px: number, py: number): boolean => {
  for (const r of rs) {
    const dx = px - r.x;
    const dy = py - r.y;
    const along = dx * r.ux + dy * r.uy;
    const across = dx * r.uy - dy * r.ux;
    if (along >= 0 && along <= r.length && across <= r.halfWidth && across >= -r.halfWidth) return true;
  }
  return false;
};
/**
 * A parcel's fixed threshold for leaving the plane, uniform in [0, 1), from its id. Whole parcels
 * leave rather than parcels thinning: a parcel much lighter than its neighbours is flung fast and
 * runs out of thermal energy under their push, which shrinks every substep and, clamped, creates
 * energy the ledger reports (GAS-009).
 */
export function leaveThreshold(id: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const W_C2 = 7 / Math.PI;

// Wall integrals, tabulated once (only +, −, ×, ÷ and sqrt, so identical on every engine).
// wallFraction(q): share of the kernel (support 1) beyond a straight wall at distance q.
// wallLine(q): line integral of the kernel along that wall, i.e. |∫ ∇W dA| over the region beyond it.
const TABLE = 256;
const FRACTION = new Float64Array(TABLE + 1);
const LINE = new Float64Array(TABLE + 1);
(function buildTables() {
  const N = 400;
  for (let k = 0; k <= TABLE; k++) {
    const q = k / TABLE;
    const half = Math.sqrt(Math.max(0, 1 - q * q));
    // Line integral of W along x = q, |y| ≤ half (midpoint rule).
    let line = 0;
    for (let i = 0; i < N; i++) {
      const yv = -half + ((i + 0.5) * 2 * half) / N;
      const r = Math.sqrt(q * q + yv * yv);
      const t = 1 - r;
      line += t > 0 ? W_C2 * t * t * t * t * (1 + 4 * r) : 0;
    }
    LINE[k] = (line * 2 * half) / N;
    // Area integral of W over x > q (midpoint rule in x and y).
    let area = 0;
    for (let i = 0; i < N; i++) {
      const xv = q + ((i + 0.5) * (1 - q)) / N;
      const hy = Math.sqrt(Math.max(0, 1 - xv * xv));
      let strip = 0;
      for (let j = 0; j < 100; j++) {
        const yv = -hy + ((j + 0.5) * 2 * hy) / 100;
        const r = Math.sqrt(xv * xv + yv * yv);
        const t = 1 - r;
        strip += t > 0 ? W_C2 * t * t * t * t * (1 + 4 * r) : 0;
      }
      area += (strip * 2 * hy) / 100;
    }
    FRACTION[k] = (area * (1 - q)) / N;
  }
})();

function lookup(table: Float64Array, q: number): number {
  if (q <= 0) return table[0];
  if (q >= 1) return 0;
  const f = q * TABLE;
  const k = Math.floor(f);
  const t = f - k;
  return table[k] * (1 - t) + table[k + 1] * t;
}
export const wallFraction = (q: number): number => lookup(FRACTION, q);
export const wallLine = (q: number): number => lookup(LINE, q);

/**
 * Advances the gas by dt in CFL-limited substeps, exchanging impulses with bodies.
 * Bodies are walls at their end-of-step pose; their velocities change.
 */
/** Far-field circles: each free body's bounding box, grown by the far field. */
function farFieldCircles(walls: readonly Wall[], ff: number): { x: number; y: number; r: number }[] {
  return walls.filter((w) => w.unit >= 0).map((w) => ({ x: 0.5 * (w.minX + w.maxX), y: 0.5 * (w.minY + w.maxY), r: 0.5 * Math.sqrt((w.maxX - w.minX) ** 2 + (w.maxY - w.minY) ** 2) + ff }));
}

/**
 * Splits the gas into clusters that cannot reach each other, or the same free assembly, within the
 * step: parcels closer than their smoothing lengths plus twice how far they can move in the step, and
 * every assembly (or fixed body) a parcel could reach. Clusters are in a fixed order (by their first
 * parcel), each with its parcels and bodies in their original order.
 */
const MIN_CLUSTER = 32;

export function gasClusters(
  parcels: readonly Parcel[],
  bodies: readonly WallBody[],
  joints: readonly { a: string; b: string }[],
  dt: number,
): { parcels: number[]; bodies: number[] }[] {
  const n = parcels.length;
  if (!n) return [];
  // How far each parcel can get from the gas's mean motion in the step (twice its speed relative to
  // the mean, for headroom), plus how far its own pressure could push it from rest, plus half its
  // smoothing length: two parcels can meet only if they are within their summed reach. Pairs are then
  // checked with their own relative speed.
  let mx = 0;
  let my = 0;
  for (const p of parcels) {
    mx += p.velocity.x;
    my += p.velocity.y;
  }
  mx /= n;
  my /= n;
  const reach = new Float64Array(n);
  const half = new Float64Array(n);
  const push = new Float64Array(n);
  let rmax = 0;
  for (let i = 0; i < n; i++) {
    const p = parcels[i];
    half[i] = 0.5 * SMOOTHING * p.radius;
    // Pressure accelerates gas by about c²/h, so from rest it covers about ½·c²·dt²/h in a step (taken
    // twice), and never more than gas expanding into vacuum, 2c/(γ − 1), covers.
    const { gamma } = mixture(p.composition);
    const c2 = gamma * (gamma - 1) * Math.max(0, p.thermal / p.mass);
    push[i] = Math.min((c2 * dt * dt) / (2 * half[i]), ((2 * Math.sqrt(c2)) / (gamma - 1)) * dt);
    reach[i] = half[i] + push[i] + 2 * Math.sqrt((p.velocity.x - mx) ** 2 + (p.velocity.y - my) ** 2) * dt;
    rmax = Math.max(rmax, reach[i]);
  }
  // Union-find over parcels 0..n−1 and groups n..n+g−1 (a free assembly, or a fixed body).
  const roots = joints.length ? assemblyRoots({ bodies, joints } as never) : null;
  const groupOf = new Map<string, number>();
  const groups: { members: number[]; x: number; y: number; r: number; vx: number; vy: number }[] = [];
  bodies.forEach((b, k) => {
    const key = b.fixed ? `#${k}` : (roots?.get(b.id) ?? b.id);
    let g = groupOf.get(key);
    if (g === undefined) {
      g = groups.length;
      groupOf.set(key, g);
      groups.push({ members: [], x: 0, y: 0, r: 0, vx: 0, vy: 0 });
    }
    groups[g].members.push(k);
  });
  for (const g of groups) {
    // A circle round the group's parts, grown by how far they move in the step.
    let lo = { x: Infinity, y: Infinity };
    let hi = { x: -Infinity, y: -Infinity };
    // Its parts' spread about the first part's velocity (spin, flex), added to the circle.
    const v0 = bodies[g.members[0]].fixed ? { x: 0, y: 0 } : bodies[g.members[0]].velocity;
    let spread = 0;
    for (const k of g.members) {
      const b = bodies[k];
      const r = boundingRadiusOf(b.shape);
      lo = { x: Math.min(lo.x, b.position.x - r), y: Math.min(lo.y, b.position.y - r) };
      hi = { x: Math.max(hi.x, b.position.x + r), y: Math.max(hi.y, b.position.y + r) };
      if (!b.fixed) spread = Math.max(spread, Math.sqrt((b.velocity.x - v0.x) ** 2 + (b.velocity.y - v0.y) ** 2) + Math.abs(b.angularVelocity) * r);
    }
    g.x = 0.5 * (lo.x + hi.x);
    g.y = 0.5 * (lo.y + hi.y);
    g.r = 0.5 * Math.sqrt((hi.x - lo.x) ** 2 + (hi.y - lo.y) ** 2) + 2 * spread * dt;
    g.vx = v0.x;
    g.vy = v0.y;
  }
  const up = new Int32Array(n + groups.length);
  for (let i = 0; i < up.length; i++) up[i] = i;
  const find = (i: number): number => {
    while (up[i] !== i) {
      up[i] = up[up[i]];
      i = up[i];
    }
    return i;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) up[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  // Parcels: a grid of cells 2·rmax wide, each parcel against its own and the neighbouring cells.
  const cell = 2 * rmax;
  const grid = new Map<number, number[]>();
  const keyOf = (cx: number, cy: number) => (cx + 1048576) * 2097152 + (cy + 1048576);
  for (let i = 0; i < n; i++) {
    const key = keyOf(Math.floor(parcels[i].position.x / cell), Math.floor(parcels[i].position.y / cell));
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    const p = parcels[i].position;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(keyOf(cx + dx, cy + dy));
        if (!list) continue;
        for (const j of list) {
          if (j <= i) continue;
          const q = parcels[j].position;
          const vi = parcels[i].velocity;
          const vj = parcels[j].velocity;
          const d = half[i] + half[j] + push[i] + push[j] + 2 * Math.sqrt((vi.x - vj.x) ** 2 + (vi.y - vj.y) ** 2) * dt;
          if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 <= d * d) join(i, j);
        }
      }
  }
  // Which parcels each group can reach. A free assembly joins them into one cluster (its motion
  // is shared state); a fixed body never changes, so it doesn't, and goes with every cluster it reaches.
  const reaches = (g: (typeof groups)[number], i: number) => {
    const p = parcels[i].position;
    const v = parcels[i].velocity;
    const d = g.r + 2 * half[i] + push[i] + 2 * Math.sqrt((v.x - g.vx) ** 2 + (v.y - g.vy) ** 2) * dt;
    return (p.x - g.x) ** 2 + (p.y - g.y) ** 2 <= d * d;
  };
  const fixedGroups: number[] = [];
  groups.forEach((g, k) => {
    if (bodies[g.members[0]].fixed) {
      fixedGroups.push(k);
      return;
    }
    for (let i = 0; i < n; i++) if (reaches(g, i)) join(n + k, i);
  });
  const byRoot = new Map<number, { parcels: number[]; bodies: number[] }>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let c = byRoot.get(r);
    if (!c) {
      c = { parcels: [], bodies: [] };
      byRoot.set(r, c);
    }
    c.parcels.push(i);
  }
  groups.forEach((g, k) => {
    if (bodies[g.members[0]].fixed) return;
    const c = byRoot.get(find(n + k));
    if (c) c.bodies.push(...g.members);
  });
  for (const k of fixedGroups) {
    const g = groups[k];
    for (const c of byRoot.values()) if (c.parcels.some((i) => reaches(g, i))) c.bodies.push(...g.members);
  }
  // Small clusters go together into one: stepping each apart costs more than it saves.
  const big: { parcels: number[]; bodies: number[] }[] = [];
  const rest: { parcels: number[]; bodies: number[] } = { parcels: [], bodies: [] };
  for (const c of byRoot.values()) {
    if (c.parcels.length >= MIN_CLUSTER) big.push(c);
    else {
      rest.parcels.push(...c.parcels);
      rest.bodies.push(...c.bodies);
    }
  }
  if (rest.parcels.length) big.push(rest);
  for (const c of big) {
    c.parcels.sort((a, b) => a - b);
    // A fixed body several pooled clusters reach is listed once.
    c.bodies = [...new Set(c.bodies)].sort((a, b) => a - b);
  }
  big.sort((a, b) => a.parcels[0] - b.parcels[0]);
  return big;
}

/** One cluster's gas step as plain data, so it can run anywhere (here or in a helper thread). */
export interface ClusterJob {
  parcels: Parcel[];
  bodies: { id: string; shape: Shape; fixed: boolean; mass: number; inertia: number; position: Vec2; angle: number; velocity: Vec2; angularVelocity: number }[];
  joints: { a: string; b: string }[];
  dt: number;
  bounds: Bounds;
  gravity: Vec2;
  closed: readonly ClosedRegion[];
  far: { x: number; y: number; r: number }[];
  scale: number;
  timed: boolean;
}

/** What a cluster's step produced. */
export interface ClusterResult {
  /** Each job parcel's state after the step, in job order; `gone` if it left the world. */
  parcels: { position: Vec2; velocity: Vec2; thermal: number; age?: number; keep?: number; gone: boolean }[];
  bodies: { position: Vec2; angle: number; velocity: Vec2; angularVelocity: number }[];
  account: { externalImpulse: Vec2; angular: number; removed: RemovedGas; removedPotential: number; clamped: number; jointImpulse: [string, { x: number; y: number; angular: number }][]; involved: string[] };
  substeps: number;
  wallImpulse: number;
  timings: Record<string, number>;
}

/** Steps one cluster (see `stepGasClustered`). Pure: reads the job, mutates only the job's own objects. */
export function runClusterJob(job: ClusterJob, clock?: () => number): ClusterResult {
  const sub: GasState = { parcels: job.parcels.slice(), nextId: 0, removed: { count: 0, mass: 0, momentum: { x: 0, y: 0 }, angularMomentum: 0, energy: 0 }, wallImpulse: 0, substeps: 0, scale: job.scale };
  const out: Record<string, number> = {};
  const acc = stepGas(sub, job.bodies, job.joints, job.dt, job.bounds, job.gravity, job.closed, job.timed && clock ? { clock, out } : undefined, job.far);
  const left = new Set(job.parcels);
  for (const p of sub.parcels) left.delete(p);
  return {
    parcels: job.parcels.map((p) => ({ position: p.position, velocity: p.velocity, thermal: p.thermal, age: p.age, keep: p.keep, gone: left.has(p) })),
    bodies: job.bodies.map((b) => ({ position: b.position, angle: b.angle, velocity: b.velocity, angularVelocity: b.angularVelocity })),
    account: { externalImpulse: acc.externalImpulse, angular: acc.angular, removed: acc.removed, removedPotential: acc.removedPotential, clamped: acc.clamped, jointImpulse: [...acc.jointImpulse], involved: [...acc.involved] },
    substeps: sub.substeps,
    wallImpulse: sub.wallImpulse,
    timings: out,
  };
}

/** The gas step split into cluster jobs, and how to take their results back in. */
export interface ClusteredGas {
  jobs: ClusterJob[];
  /** Writes the results (in job order) into the gas and bodies, and returns the merged account. */
  apply(results: ClusterResult[], timings?: { out: Record<string, number> }): GasAccount;
}

/** Prepares the gas step as cluster jobs (`gasClusters`), or null when there is no gas. */
export function clusterGas(
  gas: GasState,
  bodies: WallBody[],
  joints: { a: string; b: string }[],
  dt: number,
  bounds: Bounds,
  gravity: Vec2,
  closed: readonly ClosedRegion[],
  timed: boolean,
  copy: boolean,
): ClusteredGas | null {
  const ps = gas.parcels;
  if (!ps.length) return null;
  const clusters = gasClusters(ps, bodies, joints, dt);
  let hmax = gas.farReach ?? 0;
  if (gas.farReach === undefined) for (const p of ps) hmax = Math.max(hmax, SMOOTHING * p.radius);
  const far = bounds.farField ? farFieldCirclesFor(bodies, bounds.farField, hmax) : [];
  // A job's bodies are plain copies of the bodies' state (stepped apart from the world, then written back).
  const plain = (b: WallBody) => ({ id: b.id, shape: b.shape, fixed: b.fixed, mass: b.mass, inertia: b.inertia, position: b.position, angle: b.angle, velocity: b.velocity, angularVelocity: b.angularVelocity });
  const jobs: ClusterJob[] = clusters.map((c) => {
    const ids = new Set(c.bodies.map((k) => bodies[k].id));
    return {
      parcels: c.parcels.map((i) => (copy ? structuredClone(ps[i]) : ps[i])),
      bodies: c.bodies.map((k) => plain(bodies[k])),
      joints: joints.filter((j) => ids.has(j.a) && ids.has(j.b)),
      dt,
      bounds,
      gravity,
      closed,
      far,
      scale: gas.scale ?? 1,
      timed,
    };
  });
  return {
    jobs,
    apply(results, timings) {
      const total: GasAccount = {
        externalImpulse: { x: 0, y: 0 },
        angular: 0,
        removed: { count: 0, mass: 0, momentum: { x: 0, y: 0 }, angularMomentum: 0, energy: 0 },
        removedPotential: 0,
        clamped: 0,
        jointImpulse: new Map(),
        involved: new Set(),
      };
      const gone = new Set<Parcel>();
      let substeps = 0;
      results.forEach((res, k) => {
        const c = clusters[k];
        res.parcels.forEach((r, j) => {
          const p = ps[c.parcels[j]];
          p.position = r.position;
          p.velocity = r.velocity;
          p.thermal = r.thermal;
          if (r.age !== undefined) p.age = r.age;
          if (r.keep !== undefined) p.keep = r.keep;
          if (r.gone) gone.add(p);
        });
        res.bodies.forEach((r, j) => {
          const b = bodies[c.bodies[j]];
          if (b.fixed) return;
          if (b.position !== r.position) b.position = r.position;
          if (b.angle !== r.angle) b.angle = r.angle;
          if (b.velocity !== r.velocity) b.velocity = r.velocity;
          if (b.angularVelocity !== r.angularVelocity) b.angularVelocity = r.angularVelocity;
        });
        if (timings) for (const [key, v] of Object.entries(res.timings)) timings.out[key] = (timings.out[key] ?? 0) + v;
        substeps = Math.max(substeps, res.substeps);
        gas.wallImpulse += res.wallImpulse;
        const a = res.account;
        total.externalImpulse.x += a.externalImpulse.x;
        total.externalImpulse.y += a.externalImpulse.y;
        total.angular += a.angular;
        total.removedPotential += a.removedPotential;
        total.clamped += a.clamped;
        const r = total.removed;
        r.count += a.removed.count;
        r.mass += a.removed.mass;
        r.momentum.x += a.removed.momentum.x;
        r.momentum.y += a.removed.momentum.y;
        r.angularMomentum += a.removed.angularMomentum;
        r.energy += a.removed.energy;
        for (const [id, J] of a.jointImpulse) total.jointImpulse.set(id, J);
        for (const id of a.involved) total.involved.add(id);
      });
      gas.parcels = ps.filter((p) => !gone.has(p));
      gas.substeps = substeps;
      const tot = gas.removed;
      tot.count += total.removed.count;
      tot.mass += total.removed.mass;
      tot.momentum.x += total.removed.momentum.x;
      tot.momentum.y += total.removed.momentum.y;
      tot.angularMomentum += total.removed.angularMomentum;
      tot.energy += total.removed.energy;
      return total;
    },
  };
}

/**
 * The far field's circles (§9.5): each free body's world box, grown by the largest smoothing length
 * `hmax` (as its walls are), then by the far field `ff`. Gas outside all of them leaves.
 */
export function farFieldCirclesFor(bodies: readonly WallBody[], ff: number, hmax: number): { x: number; y: number; r: number }[] {
  const far: { x: number; y: number; r: number }[] = [];
  for (const b of bodies) {
    if (b.fixed) continue;
    let minX: number, minY: number, maxX: number, maxY: number;
    if (b.shape.kind === "disc") {
      const r = b.shape.radius;
      minX = b.position.x - r;
      minY = b.position.y - r;
      maxX = b.position.x + r;
      maxY = b.position.y + r;
    } else {
      // In plain numbers: the same operations as rotate(q, v), with no vector per vertex.
      const q = sinCos(b.angle);
      minX = minY = Infinity;
      maxX = maxY = -Infinity;
      for (const v of localVertices(b.shape)) {
        const wx = q.c * v.x - q.s * v.y;
        const wy = q.s * v.x + q.c * v.y;
        minX = Math.min(minX, b.position.x + wx);
        minY = Math.min(minY, b.position.y + wy);
        maxX = Math.max(maxX, b.position.x + wx);
        maxY = Math.max(maxY, b.position.y + wy);
      }
    }
    const x0 = minX - hmax;
    const y0 = minY - hmax;
    const x1 = maxX + hmax;
    const y1 = maxY + hmax;
    far.push({ x: 0.5 * (x0 + x1), y: 0.5 * (y0 + y1), r: 0.5 * Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2) + ff });
  }
  return far;
}

// ---------- Free flight (prototype) ----------
// Far from every body, a plume in vacuum hardly pushes on itself: it flies on (rocket plumes are
// modelled so past the near field: continuum near the nozzle, free-molecular beyond). Such gas is
// left out of the gas step and moves ballistically, keeping its mass, momentum and heat, so the
// ledger stays exact. It obeys the same boundary rules (bounds, far field, out of the plane) and
// rejoins the gas step as soon as it could come near a body within a step.

/** Bounding radius of a body's shape about its position. */
function shapeRadius(b: WallBody): number {
  const s = b.shape;
  if (s.kind === "disc") return s.radius;
  if (s.kind === "box") return 0.5 * Math.sqrt(s.width * s.width + s.height * s.height);
  let r = 0;
  for (const v of s.vertices) r = Math.max(r, Math.sqrt(v.x * v.x + v.y * v.y));
  return r;
}

/**
 * Which parcels fly free this step: those that cannot come within `margin` smoothing lengths of any
 * body (its bounding circle) during the step, however both move.
 */
export function freeFlightMask(parcels: readonly Parcel[], bodies: readonly WallBody[], dt: number, margin: number): Uint8Array {
  const n = parcels.length;
  const free = new Uint8Array(n);
  if (!n) return free;
  const nb = bodies.length;
  const bx = new Float64Array(nb);
  const by = new Float64Array(nb);
  const br = new Float64Array(nb);
  const bs = new Float64Array(nb);
  for (let k = 0; k < nb; k++) {
    const b = bodies[k];
    bx[k] = b.position.x;
    by[k] = b.position.y;
    br[k] = shapeRadius(b);
    bs[k] = Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y) + Math.abs(b.angularVelocity) * br[k];
  }
  // The furthest any parcel's test reaches beyond a body's own circle and motion.
  let extra = 0;
  for (const p of parcels) extra = Math.max(extra, margin * SMOOTHING * p.radius + Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y) * dt);
  // Bodies filed in a coarse grid by the circle each can reach, so a parcel tests only those in its cell.
  const cell = 2;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 65536 + cy;
  for (let k = 0; k < nb; k++) {
    const r = br[k] + bs[k] * dt + extra;
    for (let cx = Math.floor((bx[k] - r) / cell); cx <= Math.floor((bx[k] + r) / cell); cx++)
      for (let cy = Math.floor((by[k] - r) / cell); cy <= Math.floor((by[k] + r) / cell); cy++) {
        const list = grid.get(key(cx, cy));
        if (list) list.push(k);
        else grid.set(key(cx, cy), [k]);
      }
  }
  for (let i = 0; i < n; i++) {
    const p = parcels[i];
    const reach = margin * SMOOTHING * p.radius;
    const ps = Math.sqrt(p.velocity.x * p.velocity.x + p.velocity.y * p.velocity.y);
    const list = grid.get(key(Math.floor(p.position.x / cell), Math.floor(p.position.y / cell)));
    let ok = true;
    if (list)
      for (const k of list) {
        const r = br[k] + reach + (ps + bs[k]) * dt;
        const dx = p.position.x - bx[k];
        const dy = p.position.y - by[k];
        if (dx * dx + dy * dy < r * r) {
          ok = false;
          break;
        }
      }
    if (ok) free[i] = 1;
  }
  return free;
}

/**
 * Moves free parcels one step (a drift: the field's kick came earlier in the step), then applies the gas step's boundary rules
 * (outside the bounds, the far field, out of the plane), recording what leaves in `acc`. Returns the
 * parcels that stay.
 */
export function flyFree(
  parcels: readonly Parcel[],
  bodies: readonly WallBody[],
  dt: number,
  bounds: Bounds,
  gravity: Vec2,
  closed: readonly ClosedRegion[],
  scale: number,
  acc: GasAccount,
  /** The largest smoothing length of all the gas (free and stepped), for the far field. */
  hmax: number,
): Parcel[] {
  const ff = bounds.farField;
  const circles = ff ? farFieldCirclesFor(bodies, ff, hmax) : [];
  const far = (x: number, y: number) => {
    if (!ff || !circles.length) return false;
    for (const c of circles) if ((x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r) return false;
    return true;
  };
  const leave = (p: Parcel) => {
    const r = acc.removed;
    const m = p.mass;
    const { x, y } = p.position;
    const { x: vx, y: vy } = p.velocity;
    r.count += 1;
    r.mass += m;
    r.momentum.x += m * vx;
    r.momentum.y += m * vy;
    r.angularMomentum += m * (x * vy - y * vx);
    const pe = -m * (gravity.x * x + gravity.y * y);
    r.energy += 0.5 * m * (vx * vx + vy * vy) + p.thermal + parcelChemical(p, scale) + pe;
    acc.removedPotential += pe;
  };
  const kept: Parcel[] = [];
  for (const p of parcels) {
    // A drift, as the gas step's own move: the field's kick to every parcel was given (and recorded)
    // earlier in the step.
    p.position = { x: p.position.x + p.velocity.x * dt, y: p.position.y + p.velocity.y * dt };
    const { x, y } = p.position;
    const outside = !bounds.wrap && (x < bounds.min.x || x > bounds.max.x || y < bounds.min.y || y > bounds.max.y);
    if (outside || far(x, y)) {
      leave(p);
      continue;
    }
    if (bounds.depth) {
      p.age = (p.age ?? 0) + dt;
      if (p.age > DEPTH_DELAY && !inClosed(closed, x, y)) {
        const mix = mixture(p.composition);
        const c = Math.sqrt(mix.gamma * (mix.gamma - 1) * Math.max(0, p.thermal / p.mass));
        p.keep = (p.keep ?? 1) / (1 + (c * dt) / bounds.depth);
        if (p.keep < leaveThreshold(p.id)) {
          leave(p);
          continue;
        }
      }
    }
    kept.push(p);
  }
  return kept;
}

/**
 * Steps the gas cluster by cluster (`gasClusters`): each with only its own parcels and the bodies it
 * can reach, at its own substeps. Clusters can't meet within the step, so stepping them apart is the
 * same physics; it is cheaper (a calm cluster takes long substeps, and no cluster files every body),
 * and clusters can run in parallel (`clusterGas`, `runClusterJob`). Results are taken back in cluster
 * order, so they never depend on where or in what order clusters ran.
 */
export function stepGasClustered(
  gas: GasState,
  bodies: WallBody[],
  joints: { a: string; b: string }[],
  dt: number,
  bounds: Bounds,
  gravity: Vec2 = { x: 0, y: 0 },
  closed: readonly ClosedRegion[] = [],
  timings?: { clock: () => number; out: Record<string, number> },
): GasAccount {
  const tc = timings?.clock();
  const prepared = clusterGas(gas, bodies, joints, dt, bounds, gravity, closed, !!timings, false);
  if (!prepared) return stepGas(gas, bodies, joints, dt, bounds, gravity, closed, timings);
  if (timings) {
    for (const k of ["setup", "contacts", "neighbours", "density", "impulses", "move", "finish"]) timings.out[`gas.${k}`] = 0;
    timings.out["gas.clusters"] = timings.clock() - tc!;
  }
  return prepared.apply(
    prepared.jobs.map((j) => runClusterJob(j, timings?.clock)),
    timings,
  );
}

export function stepGas(
  gas: GasState,
  bodies: WallBody[],
  joints: { a: string; b: string }[],
  dt: number,
  bounds: Bounds,
  gravity: Vec2 = { x: 0, y: 0 },
  closed: readonly ClosedRegion[] = [],
  timings?: { clock: () => number; out: Record<string, number> },
  /** Far-field circles to use instead of the bodies' own (when stepping part of the gas). */
  farCircles?: readonly { x: number; y: number; r: number }[],
): GasAccount {
  // Time per phase, summed over the substeps, into `timings.out` as gas.<phase> (LED-004). Reading the
  // clock changes nothing in the results.
  let tMark = timings ? timings.clock() : 0;
  const phase = (name: string) => {
    if (!timings) return;
    const t = timings.clock();
    timings.out[`gas.${name}`] = (timings.out[`gas.${name}`] ?? 0) + (t - tMark);
    tMark = t;
  };
  if (timings) for (const k of ["setup", "contacts", "neighbours", "density", "impulses", "move", "finish"]) timings.out[`gas.${k}`] = 0;
  const acc: GasAccount = {
    externalImpulse: { x: 0, y: 0 },
    angular: 0,
    removed: {
      count: 0,
      mass: 0,
      momentum: { x: 0, y: 0 },
      angularMomentum: 0,
      energy: 0,
    },
    removedPotential: 0,
    clamped: 0,
    jointImpulse: new Map(),
    involved: new Set(),
  };
  const ps = gas.parcels;
  const n = ps.length;
  gas.substeps = 0;
  if (n === 0) return acc;

  // Pack straight into the WebAssembly module's memory (gasWasm.ts).
  const buf = gasParcelBuffers(n);
  let { x, y, vx, vy, m, E, g1, gam } = buf; // g1 is γ − 1
  const { hh, rad } = buf;
  let hmax = 0;
  let hmin = Infinity;
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    x[i] = p.position.x;
    y[i] = p.position.y;
    vx[i] = p.velocity.x;
    vy[i] = p.velocity.y;
    m[i] = p.mass;
    E[i] = p.thermal;
    rad[i] = p.radius;
    hh[i] = SMOOTHING * p.radius;
    hmax = Math.max(hmax, hh[i]);
    hmin = Math.min(hmin, hh[i]);
    const mix = mixture(p.composition);
    gam[i] = mix.gamma;
    g1[i] = mix.gamma - 1;
  }

  const { walls, units } = buildWalls(bodies, joints, hmax);

  // The substep loop (wall contacts, mirror ghosts, neighbours, density, impulses and energy with
  // their retries, the bounce, the drift) is in the WebAssembly module: wasm/solver/src/gas.rs.
  phase("setup");
  const r = gasCoreWasm(n, walls, units, bodies, dt, acc, timings);
  // The module's memory may have grown: take the views again.
  ({ x, y, vx, vy, m, E, g1, gam } = r.buffers);
  const { partJ, crushed } = r.buffers;
  const wallImpulse = r.wallImpulse;
  const nsub = r.nsub;
  if (timings) tMark = timings.clock();

  gas.substeps = nsub;

  // Far field: free bodies as bounding circles at their end-of-step pose. Fixed bodies (a ground) don't
  // count: gas far from everything that moves can't change what happens to it.
  const ff = bounds.farField;
  const circles = farCircles ?? (ff ? farFieldCircles(walls, ff) : []);
  const far = (px: number, py: number): boolean => {
    if (!ff || !circles.length) return false; // with no bodies there is nothing to be far from
    for (const c of circles) if ((px - c.x) ** 2 + (py - c.y) ** 2 < c.r * c.r) return false;
    return true;
  };

  // Write back parcels, removing those outside the world boundary.
  const scale = gas.scale ?? 1;
  /** Records the share `f` of parcel i (and of its chemical energy `chem`) as gone through the boundary. */
  const leave = (i: number, f: number, chem: number) => {
    const r = acc.removed;
    const dm = f * m[i];
    r.mass += dm;
    r.momentum.x += dm * vx[i];
    r.momentum.y += dm * vy[i];
    r.angularMomentum += dm * (x[i] * vy[i] - y[i] * vx[i]);
    const pe = -dm * (gravity.x * x[i] + gravity.y * y[i]);
    r.energy += 0.5 * dm * (vx[i] * vx[i] + vy[i] * vy[i]) + f * E[i] + f * chem + pe;
    acc.removedPotential += pe;
  };
  const depth = bounds.depth;
  const kept: Parcel[] = [];
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    p.position = { x: x[i], y: y[i] };
    p.velocity = { x: vx[i], y: vy[i] };
    p.thermal = E[i];
    // A wrapped world keeps gas that crosses its bounds: it wraps round after the step (FLT-012).
    const outside = !bounds.wrap && (x[i] < bounds.min.x || x[i] > bounds.max.x || y[i] < bounds.min.y || y[i] > bounds.max.y);
    if (outside || far(x[i], y[i]) || crushed[i]) {
      acc.removed.count += 1;
      leave(i, 1, parcelChemical(p, scale));
      continue;
    }
    if (depth) {
      // Out of the plane (GAS-009): the chance of staying shrinks by 1/(1 + x), x = c·dt/depth, and
      // the parcel leaves whole when it falls below the parcel's own threshold.
      p.age = (p.age ?? 0) + dt;
      if (p.age > DEPTH_DELAY && !inClosed(closed, x[i], y[i])) {
        const c = Math.sqrt(gam[i] * g1[i] * Math.max(0, E[i] / m[i]));
        p.keep = (p.keep ?? 1) / (1 + (c * dt) / depth);
        if (p.keep < leaveThreshold(p.id)) {
          acc.removed.count += 1;
          leave(i, 1, parcelChemical(p, scale));
          continue;
        }
      }
    }
    kept.push(p);
  }
  gas.parcels = kept;
  phase("finish");
  const tot = gas.removed;
  tot.count += acc.removed.count;
  tot.mass += acc.removed.mass;
  tot.momentum.x += acc.removed.momentum.x;
  tot.momentum.y += acc.removed.momentum.y;
  tot.angularMomentum += acc.removed.angularMomentum;
  tot.energy += acc.removed.energy;
  gas.wallImpulse += wallImpulse;

  // What the joints of each free assembly had to supply: each part's rigid share of the unit's
  // change, minus the gas's direct push on it.
  bodies.forEach((b, k) => {
    const w = walls[k];
    if (w.unit < 0) return;
    const u = units[w.unit];
    if (u.ids.length < 2) return;
    const dvx = u.vx - u.vx0;
    const dvy = u.vy - u.vy0;
    const dw = u.w - u.w0;
    const rx = b.position.x - u.ex;
    const ry = b.position.y - u.ey;
    const sx = b.mass * (dvx - dw * ry) - partJ[3 * k];
    const sy = b.mass * (dvy + dw * rx) - partJ[3 * k + 1];
    const sa = b.inertia * dw - partJ[3 * k + 2];
    if (sx !== 0 || sy !== 0 || sa !== 0) acc.jointImpulse.set(b.id, { x: sx, y: sy, angular: sa });
  });

  // Write back each unit's pose and velocity to its parts. A part keeps its offset from the
  // unit's rigid motion (rotated with it), so momentum, angular momentum and energy carry over exactly.
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const u of units) {
    const moved = u.cx !== u.ex || u.cy !== u.ey || u.th !== 0;
    if (!moved && u.vx === u.vx0 && u.vy === u.vy0 && u.w === u.w0) continue;
    for (const id of u.ids) {
      const b = byId.get(id)!;
      const rx = b.position.x - u.ex;
      const ry = b.position.y - u.ey;
      // Offset from rigid motion at the end-of-step pose.
      const ox = b.velocity.x - (u.vx0 - u.w0 * ry);
      const oy = b.velocity.y - (u.vy0 + u.w0 * rx);
      const nrx = u.qc * rx - u.qs * ry;
      const nry = u.qs * rx + u.qc * ry;
      b.position = { x: u.cx + nrx, y: u.cy + nry };
      b.angle += u.th;
      b.velocity = { x: u.vx - u.w * nry + (u.qc * ox - u.qs * oy), y: u.vy + u.w * nrx + (u.qs * ox + u.qc * oy) };
      b.angularVelocity += u.w - u.w0;
    }
  }
  return acc;
}

type WallSource = { id: string; shape: Shape; fixed: boolean; mass: number; position: Vec2; angle: number; velocity: Vec2; angularVelocity: number; contents?: Store[] };

/** A body seen by the gas phase: mass and inertia include stores; pose and velocity writes land on the body. */
class BodyWall implements WallBody {
  readonly id: string;
  readonly shape: Shape;
  readonly fixed: boolean;
  readonly mass: number;
  readonly inertia: number;
  private readonly b: WallSource;
  constructor(b: WallSource) {
    this.b = b;
    this.id = b.id;
    this.shape = b.shape;
    this.fixed = b.fixed;
    this.mass = bodyMass(b);
    this.inertia = massProps(b.shape, this.mass).inertia;
  }
  get position(): Vec2 {
    return this.b.position;
  }
  set position(v: Vec2) {
    this.b.position = v;
  }
  get angle(): number {
    return this.b.angle;
  }
  set angle(a: number) {
    this.b.angle = a;
  }
  get velocity(): Vec2 {
    return this.b.velocity;
  }
  set velocity(v: Vec2) {
    this.b.velocity = v;
  }
  get angularVelocity(): number {
    return this.b.angularVelocity;
  }
  set angularVelocity(w: number) {
    this.b.angularVelocity = w;
  }
}

/** Views of bodies for the gas phase: mass and inertia include stores; pose and velocity writes land on the body. */
export function wallBodies(bodies: readonly WallSource[]): WallBody[] {
  return bodies.map((b) => new BodyWall(b));
}
