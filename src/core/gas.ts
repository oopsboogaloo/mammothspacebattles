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
import { localVertices, massProps, type Shape } from "./shapes.ts";
import { bodyMass, type Store } from "./bodies.ts";

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
  const sp = SPECIES[st.resource];
  if (!sp) return { thermal: 0, chemical: 0 };
  const cv = R_GAS / sp.molarMass / (sp.gamma - 1);
  return { thermal: (st.mass * cv * STORE_TEMPERATURE) / scale, chemical: (st.mass * (sp.heat ?? 0)) / scale };
}

/** Chemical energy a parcel still holds, J. */
export function parcelChemical(p: { mass: number; composition: Record<string, number> }, scale = 1): number {
  let e = 0;
  for (const k of Object.keys(p.composition)) e += p.composition[k] * (SPECIES[k]?.heat ?? 0);
  return (p.mass * e) / scale;
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
/** Substep = CFL × h ÷ (sound speed + speed), with h the kernel's full support radius (≈ 0.5 in the usual half-support convention). */
const CFL = 0.25;
const MAX_SUBSTEPS = 2000;
/** Halvings of a substep tried before thermal energy is clamped at zero (and the ledger reports it). */
const MAX_RETRIES = 20;
const VISC_ALPHA = 1;
const VISC_BETA = 2;
/** A parcel closer than this × radius to a surface and still approaching bounces elastically. */
const HARD_WALL = 0.5;

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

/** Mass-weighted mixture properties. Unknown species are rejected by validation. */
export function mixture(composition: Record<string, number>): Mixture {
  const key = compositionKey(composition);
  let mx = mixtures.get(key);
  if (!mx) {
    mx = computeMixture(composition);
    if (mixtures.size < 1000) mixtures.set(key, mx);
  }
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
}

function buildWalls(bodies: WallBody[], joints: { a: string; b: string }[], margin: number): { walls: Wall[]; units: Unit[] } {
  const roots = joints.length ? assemblyRoots({ bodies, joints } as never) : null;
  const groups = new Map<string, WallBody[]>();
  for (const b of bodies) {
    const r = roots?.get(b.id) ?? b.id;
    groups.set(r, [...(groups.get(r) ?? []), b]);
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
}

const W_C2 = 7 / Math.PI;
/** Parcel index multiplier in sort keys: allows 2^17 parcels with keys below 2^49. */
const IDX = 131072;
/** |dW/dr| = G_C2/h³ · q(1 − q)³ */
const G_C2 = 140 / Math.PI;

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
export function stepGas(
  gas: GasState,
  bodies: WallBody[],
  joints: { a: string; b: string }[],
  dt: number,
  bounds: Bounds,
  gravity: Vec2 = { x: 0, y: 0 },
): GasAccount {
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
    jointImpulse: new Map(),
    involved: new Set(),
  };
  const ps = gas.parcels;
  const n = ps.length;
  gas.substeps = 0;
  if (n === 0) return acc;

  // Pack into typed arrays.
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const m = new Float64Array(n);
  const E = new Float64Array(n);
  const hh = new Float64Array(n);
  const g1 = new Float64Array(n); // γ − 1
  const gam = new Float64Array(n);
  const rad = new Float64Array(n);
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

  // Substeps follow the CFL condition, re-evaluated every substep (velocities can grow fast).
  const signalSpeed = (): number => {
    let vmax = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.sqrt(gam[i] * g1[i] * Math.max(0, E[i] / m[i]));
      vmax = Math.max(vmax, c + Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]));
    }
    for (const u of units) vmax = Math.max(vmax, Math.sqrt(u.vx * u.vx + u.vy * u.vy) + Math.abs(u.w) * 50);
    return vmax;
  };
  const minDs = dt / MAX_SUBSTEPS;
  // Gas impulses on each body (x, y, torque about the body's centre), for joint loads.
  const partJ = new Float64Array(3 * walls.length);
  const tPart = new Float64Array(3 * walls.length);
  /** Adds an impulse on body k, acting along a line through (px, py), to `into`. */
  const pushPart = (into: Float64Array, k: number, jx: number, jy: number, px: number, py: number) => {
    const b = bodies[k];
    const w = walls[k];
    let bx = b.position.x;
    let by = b.position.y;
    if (w.unit >= 0) {
      const u = units[w.unit];
      const dx = bx - u.ex;
      const dy = by - u.ey;
      bx = u.cx + u.qc * dx - u.qs * dy;
      by = u.cy + u.qs * dx + u.qc * dy;
    }
    into[3 * k] += jx;
    into[3 * k + 1] += jy;
    into[3 * k + 2] += (px - bx) * jy - (py - by) * jx;
  };

  const rho = new Float64Array(n);
  const A = new Float64Array(n); // P/ρ²
  const cs = new Float64Array(n);
  const inv = 1 / hmax;
  const hmax2 = hmax * hmax;
  const s = { d: 0, nx: 0, ny: 0 };
  let wallImpulse = 0;

  // Cell coordinates are clamped to ±32767 so keys stay small integers; far parcels share edge cells (still correct, just slower).
  const clampCell = (c: number) => (c < -32767 ? -32767 : c > 32767 ? 32767 : c);
  const cellKey = (cx: number, cy: number) => (clampCell(cx) + 32768) * 65536 + (clampCell(cy) + 32768);

  // Bodies move with the gas through the step: rewind each unit from its end-of-step pose (where
  // the rigid-body integrator left it) to its start, then drift it with every substep. Moving walls
  // then sweep through the gas instead of jumping, and every impulse acts at the true geometry.
  for (const u of units) {
    u.cx = u.ex - u.vx0 * dt;
    u.cy = u.ey - u.vy0 * dt;
    u.th = -u.w0 * dt;
    const q = sinCos(u.th);
    u.qc = q.c;
    u.qs = q.s;
  }
  /** A world point in the end-of-step frame the walls were built in. */
  const toWallFrame = (wall: Wall, px: number, py: number, out: { x: number; y: number }) => {
    if (wall.unit < 0) {
      out.x = px;
      out.y = py;
      return;
    }
    const u = units[wall.unit];
    const dx = px - u.cx;
    const dy = py - u.cy;
    out.x = u.ex + u.qc * dx + u.qs * dy;
    out.y = u.ey - u.qs * dx + u.qc * dy;
  };
  const local = { x: 0, y: 0 };
  // Wall candidates per grid cell, rebuilt each substep from each wall's bounding circle at its current pose.
  // Only cells where gas is are filled, so a large body (a ground) costs no more than the gas it touches;
  // a wall that would still fill very many cells is tested against every parcel instead.
  const wallCells = new Map<number, number[]>();
  const bigWalls: number[] = [];
  const BIG_WALL_CELLS = 4096;
  const buildWallCells = () => {
    wallCells.clear();
    bigWalls.length = 0;
    let gx0 = Infinity;
    let gx1 = -Infinity;
    let gy0 = Infinity;
    let gy1 = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < gx0) gx0 = x[i];
      if (x[i] > gx1) gx1 = x[i];
      if (y[i] < gy0) gy0 = y[i];
      if (y[i] > gy1) gy1 = y[i];
    }
    const cx0 = Math.floor(gx0 * inv) - 1;
    const cx1 = Math.floor(gx1 * inv) + 1;
    const cy0 = Math.floor(gy0 * inv) - 1;
    const cy1 = Math.floor(gy1 * inv) + 1;
    for (let k = 0; k < walls.length; k++) {
      const w = walls[k];
      let cx = 0.5 * (w.minX + w.maxX);
      let cy = 0.5 * (w.minY + w.maxY);
      const r = 0.5 * Math.sqrt((w.maxX - w.minX) ** 2 + (w.maxY - w.minY) ** 2);
      if (w.unit >= 0) {
        const u = units[w.unit];
        const dx = cx - u.ex;
        const dy = cy - u.ey;
        cx = u.cx + u.qc * dx - u.qs * dy;
        cy = u.cy + u.qs * dx + u.qc * dy;
      }
      const x0 = Math.max(cx0, Math.floor((cx - r) * inv));
      const x1 = Math.min(cx1, Math.floor((cx + r) * inv));
      const y0 = Math.max(cy0, Math.floor((cy - r) * inv));
      const y1 = Math.min(cy1, Math.floor((cy + r) * inv));
      if (x0 > x1 || y0 > y1) continue; // no gas near this body
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > BIG_WALL_CELLS) {
        bigWalls.push(k);
        continue;
      }
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++) {
          const key = cellKey(gx, gy);
          const list = wallCells.get(key);
          if (list) list.push(k);
          else wallCells.set(key, [k]);
        }
    }
  };

  const applyUnit = (u: Unit, jx: number, jy: number, px: number, py: number) => {
    // Impulse (jx, jy) on the unit at point (px, py).
    u.vx += jx / u.M;
    u.vy += jy / u.M;
    u.w += ((px - u.cx) * jy - (py - u.cy) * jx) / u.I;
  };

  // Wall contacts: parcel, wall, distance, outward normal. Grown as needed.
  let cCap = 256;
  let cP = new Int32Array(cCap);
  let cW = new Int32Array(cCap);
  let cD = new Float64Array(cCap);
  let cNx = new Float64Array(cCap);
  let cNy = new Float64Array(cCap);
  const cStart = new Int32Array(n + 1);
  const growContacts = () => {
    cCap *= 2;
    const p2 = new Int32Array(cCap);
    p2.set(cP);
    cP = p2;
    const w2 = new Int32Array(cCap);
    w2.set(cW);
    cW = w2;
    const d2 = new Float64Array(cCap);
    d2.set(cD);
    cD = d2;
    const x2 = new Float64Array(cCap);
    x2.set(cNx);
    cNx = x2;
    const y2 = new Float64Array(cCap);
    y2.set(cNy);
    cNy = y2;
  };
  // Entries for the neighbour search: parcels 0..n−1, then one mirror ghost per wall contact.
  let eCap = 2 * n + 16;
  let ex = new Float64Array(eCap);
  let ey = new Float64Array(eCap);
  let gvx = new Float64Array(eCap);
  let gvy = new Float64Array(eCap);
  let gContact = new Int32Array(eCap);
  let gContact2 = new Int32Array(eCap);
  let cellX = new Int32Array(eCap);
  let cellY = new Int32Array(eCap);
  let order = new Float64Array(eCap);
  let idx = new Int32Array(eCap);
  // Pair lists: parcel–parcel and parcel–ghost. Grown as needed.
  let cap = n * 16;
  let pa = new Int32Array(cap);
  let pb = new Int32Array(cap);
  let pr = new Float64Array(cap);
  let gcap = 256;
  let ga = new Int32Array(gcap);
  let gb = new Int32Array(gcap);
  let gr = new Float64Array(gcap);

  const sVx = new Float64Array(n);
  const sVy = new Float64Array(n);
  const sE = new Float64Array(n);
  const dvx = new Float64Array(n);
  const dvy = new Float64Array(n);
  const mvx = new Float64Array(n);
  const mvy = new Float64Array(n);
  let pJ = new Float64Array(cap);
  let pS = new Float64Array(cap);
  let gJ = new Float64Array(gcap);
  let gS = new Float64Array(gcap);

  let runStart = new Int32Array(0);
  let runKey = new Float64Array(0);

  /** Parcels i and j are on opposite faces of the same body (a thin wall between them). */
  const separated = (i: number, j: number): boolean => {
    for (let a = cStart[i]; a < cStart[i + 1]; a++)
      for (let b = cStart[j]; b < cStart[j + 1]; b++) if (cW[a] === cW[b] && cNx[a] * cNx[b] + cNy[a] * cNy[b] < 0) return true;
    return false;
  };
  /** Parcel i sees the same face of the same body as wall contact c (so c's ghost is a mirror on i's side). */
  const sameFace = (i: number, c: number): boolean => {
    for (let a = cStart[i]; a < cStart[i + 1]; a++) if (cW[a] === cW[c] && cNx[a] * cNx[c] + cNy[a] * cNy[c] > 0.5) return true;
    return false;
  };
  const wallPointVelocity = (wall: Wall, px: number, py: number): [number, number] => {
    if (wall.unit < 0) return [0, 0];
    const u = units[wall.unit];
    return [u.vx - u.w * (py - u.cy), u.vy + u.w * (px - u.cx)];
  };

  let tDone = 0;
  let nsub = 0;
  while (tDone < dt) {
    const vmax = signalSpeed();
    let ds = vmax > 0 ? Math.max(minDs, (CFL * hmin) / vmax) : dt;
    if (tDone + ds >= dt * (1 - 1e-12)) ds = dt - tDone;

    // --- Wall contacts within one smoothing length. ---
    buildWallCells();
    let nc = 0;
    for (let i = 0; i < n; i++) {
      cStart[i] = nc;
      const list = wallCells.get(cellKey(clampCell(Math.floor(x[i] * inv)), clampCell(Math.floor(y[i] * inv))));
      if (!list && !bigWalls.length) continue;
      for (const k of list ? (bigWalls.length ? [...list, ...bigWalls] : list) : bigWalls) {
        const w = walls[k];
        toWallFrame(w, x[i], y[i], local);
        if (local.x < w.minX || local.x > w.maxX || local.y < w.minY || local.y > w.maxY) continue;
        surface(w, local.x, local.y, s);
        if (s.d >= hh[i]) continue;
        if (w.unit >= 0) {
          // The normal back in the world frame.
          const u = units[w.unit];
          const nx = u.qc * s.nx - u.qs * s.ny;
          s.ny = u.qs * s.nx + u.qc * s.ny;
          s.nx = nx;
        }
        if (nc === cCap) growContacts();
        cP[nc] = i;
        cW[nc] = k;
        cD[nc] = s.d;
        cNx[nc] = s.nx;
        cNy[nc] = s.ny;
        nc++;
      }
    }
    cStart[n] = nc;

    // --- Entries: parcels, then a mirror ghost for each contact outside the body. ---
    // Up to one ghost per contact plus one corner ghost per pair of contacts.
    let N = n + nc;
    for (let i = 0; i < n; i++) {
      const k = cStart[i + 1] - cStart[i];
      if (k > 1) N += (k * (k - 1)) / 2;
    }
    if (N > eCap) {
      eCap = 2 * N;
      ex = new Float64Array(eCap);
      ey = new Float64Array(eCap);
      gvx = new Float64Array(eCap);
      gvy = new Float64Array(eCap);
      gContact = new Int32Array(eCap);
      gContact2 = new Int32Array(eCap);
      cellX = new Int32Array(eCap);
      cellY = new Int32Array(eCap);
      order = new Float64Array(eCap);
      idx = new Int32Array(eCap);
    }
    for (let i = 0; i < n; i++) {
      ex[i] = x[i];
      ey[i] = y[i];
    }
    let ne = n;
    for (let c = 0; c < nc; c++) {
      const d = cD[c];
      if (!(d > 0)) continue;
      const i = cP[c];
      const nx = cNx[c];
      const ny = cNy[c];
      ex[ne] = x[i] - 2 * d * nx;
      ey[ne] = y[i] - 2 * d * ny;
      // Mirrored velocity relative to the wall: normal component reversed (free slip).
      const [wvx, wvy] = wallPointVelocity(walls[cW[c]], x[i] - d * nx, y[i] - d * ny);
      const vn = (vx[i] - wvx) * nx + (vy[i] - wvy) * ny;
      gvx[ne] = vx[i] - 2 * vn * nx;
      gvy[ne] = vy[i] - 2 * vn * ny;
      gContact[ne] = c;
      gContact2[ne] = -1;
      ne++;
    }
    // Corner ghosts: mirrored in both of two non-parallel faces near the parcel.
    for (let i = 0; i < n; i++) {
      for (let c1 = cStart[i]; c1 < cStart[i + 1]; c1++) {
        if (!(cD[c1] > 0)) continue;
        for (let c2 = c1 + 1; c2 < cStart[i + 1]; c2++) {
          if (!(cD[c2] > 0) || cNx[c1] * cNx[c2] + cNy[c1] * cNy[c2] > 0.5) continue;
          ex[ne] = x[i] - 2 * cD[c1] * cNx[c1] - 2 * cD[c2] * cNx[c2];
          ey[ne] = y[i] - 2 * cD[c1] * cNy[c1] - 2 * cD[c2] * cNy[c2];
          let gx = vx[i];
          let gy = vy[i];
          for (const c of [c1, c2]) {
            const [wvx, wvy] = wallPointVelocity(walls[cW[c]], x[i] - cD[c] * cNx[c], y[i] - cD[c] * cNy[c]);
            const vn = (gx - wvx) * cNx[c] + (gy - wvy) * cNy[c];
            gx -= 2 * vn * cNx[c];
            gy -= 2 * vn * cNy[c];
          }
          gvx[ne] = gx;
          gvy[ne] = gy;
          gContact[ne] = c1;
          gContact2[ne] = c2;
          ne++;
        }
      }
    }

    // --- Neighbour grid: sort entries by cell, then index (deterministic). ---
    for (let e = 0; e < ne; e++) {
      cellX[e] = clampCell(Math.floor(ex[e] * inv));
      cellY[e] = clampCell(Math.floor(ey[e] * inv));
      order[e] = cellKey(cellX[e], cellY[e]) * IDX + e;
    }
    const sorted = order.subarray(0, ne).sort();
    for (let k = 0; k < ne; k++) idx[k] = sorted[k] % IDX;
    let nRuns = 0;
    if (runStart.length < ne + 1) {
      runStart = new Int32Array(2 * ne + 1);
      runKey = new Float64Array(2 * ne + 1);
    }
    for (let k = 0; k < ne; k++) {
      const key = Math.floor(sorted[k] / IDX);
      if (k === 0 || key !== runKey[nRuns - 1]) {
        runStart[nRuns] = k;
        runKey[nRuns] = key;
        nRuns++;
      }
    }
    runStart[nRuns] = ne;

    let np = 0;
    let ng = 0;
    for (let r = 0; r < nRuns; r++) {
      const a0 = runStart[r];
      const a1 = runStart[r + 1];
      const key0 = runKey[r];
      // This run against itself, then the half stencil (0,+1), (+1,−1), (+1,0), (+1,+1).
      for (let st = 0; st < 5; st++) {
        let b0 = a0;
        let b1 = a1;
        if (st > 0) {
          const key = key0 + (st === 1 ? 1 : st === 2 ? 65535 : st === 3 ? 65536 : 65537);
          // Binary search for the run with this key (runs are sorted by key).
          let lo = r + 1;
          let hi = nRuns - 1;
          let found = -1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const v = runKey[mid];
            if (v === key) {
              found = mid;
              break;
            }
            if (v < key) lo = mid + 1;
            else hi = mid - 1;
          }
          if (found < 0) continue;
          b0 = runStart[found];
          b1 = runStart[found + 1];
        }
        for (let a = a0; a < a1; a++) {
          const e = idx[a];
          const exA = ex[e];
          const eyA = ey[e];
          for (let b = st === 0 ? a + 1 : b0; b < b1; b++) {
            const f = idx[b];
            const dx = exA - ex[f];
            const dy = eyA - ey[f];
            const r2 = dx * dx + dy * dy;
            if (r2 >= hmax2) continue; // most candidates are rejected here
            const eg = e >= n;
            const fg = f >= n;
            if (eg && fg) continue;
            const i = eg ? f : e; // the parcel
            const o = eg ? e : f; // the other entry
            const j = o >= n ? cP[gContact[o]] : o; // its parcel
            const h = 0.5 * (hh[i] + hh[j]);
            if (r2 >= h * h) continue;
            if (o < n) {
              if (cStart[i] !== cStart[i + 1] && cStart[j] !== cStart[j + 1] && separated(i, j)) continue;
              if (np === cap) {
                cap *= 2;
                const na = new Int32Array(cap);
                na.set(pa);
                pa = na;
                const nb = new Int32Array(cap);
                nb.set(pb);
                pb = nb;
                const nr = new Float64Array(cap);
                nr.set(pr);
                pr = nr;
              }
              pa[np] = i;
              pb[np] = o;
              pr[np] = Math.sqrt(r2);
              np++;
            } else {
              if (!sameFace(i, gContact[o]) || (gContact2[o] >= 0 && !sameFace(i, gContact2[o]))) continue;
              if (ng === gcap) {
                gcap *= 2;
                const na = new Int32Array(gcap);
                na.set(ga);
                ga = na;
                const nb = new Int32Array(gcap);
                nb.set(gb);
                gb = nb;
                const nr = new Float64Array(gcap);
                nr.set(gr);
                gr = nr;
              }
              ga[ng] = i;
              gb[ng] = o;
              gr[ng] = Math.sqrt(r2);
              ng++;
            }
          }
        }
      }
    }

    // --- Density: parcels plus mirror ghosts on the same face. ---
    for (let i = 0; i < n; i++) rho[i] = m[i] * (W_C2 / (hh[i] * hh[i]));
    for (let k = 0; k < np; k++) {
      const i = pa[k];
      const j = pb[k];
      const h = 0.5 * (hh[i] + hh[j]);
      const q = pr[k] / h;
      const t = 1 - q;
      const w = (W_C2 / (h * h)) * t * t * t * t * (1 + 4 * q);
      rho[i] += m[j] * w;
      rho[j] += m[i] * w;
    }
    for (let k = 0; k < ng; k++) {
      const i = ga[k];
      const j = cP[gContact[gb[k]]];
      const h = 0.5 * (hh[i] + hh[j]);
      const q = gr[k] / h;
      const t = 1 - q;
      rho[i] += m[j] * (W_C2 / (h * h)) * t * t * t * t * (1 + 4 * q);
    }
    for (let i = 0; i < n; i++) {
      const u = Math.max(0, E[i] / m[i]);
      A[i] = (g1[i] * u) / rho[i];
      cs[i] = Math.sqrt(gam[i] * g1[i] * u);
    }

    // --- Impulses and energy, retried with a shorter substep if any parcel's thermal energy
    // would go negative (expansion faster than the substep resolves). ---
    sVx.set(vx);
    sVy.set(vy);
    sE.set(E);
    for (const u of units) {
      u.sx = u.vx;
      u.sy = u.vy;
      u.sw = u.w;
    }
    let extX = 0;
    let extY = 0;
    let extA = 0;
    let wallImp = 0;
    for (let attempt = 0; ; attempt++) {
      tPart.fill(0);
      extX = 0;
      extY = 0;
      extA = 0;
      wallImp = 0;
      // --- Impulses, all from the state at the start of the substep (order-independent). ---
      // Parcel pairs: ±J along the pair axis. Parcel–ghost pairs: the wall's share, on the parcel
      // and, equal and opposite along the same line, on the body.
      dvx.fill(0, 0, n);
      dvy.fill(0, 0, n);
      for (const u of units) {
        u.dvx = 0;
        u.dvy = 0;
        u.dw = 0;
      }
      if (np > pJ.length) {
        pJ = new Float64Array(cap);
        pS = new Float64Array(cap);
      }
      for (let k = 0; k < np; k++) {
        const i = pa[k];
        const j = pb[k];
        const r = pr[k];
        pJ[k] = 0;
        if (r === 0) continue;
        const h = 0.5 * (hh[i] + hh[j]);
        const exx = (x[i] - x[j]) / r;
        const eyy = (y[i] - y[j]) / r;
        const vr = (vx[i] - vx[j]) * exx + (vy[i] - vy[j]) * eyy; // < 0 when approaching
        let visc = 0;
        if (vr < 0) {
          const mu = (h * vr * r) / (r * r + 0.01 * h * h);
          visc = (-VISC_ALPHA * 0.5 * (cs[i] + cs[j]) * mu + VISC_BETA * mu * mu) / (0.5 * (rho[i] + rho[j]));
        }
        const q = r / h;
        const t = 1 - q;
        const grad = (G_C2 / (h * h * h)) * q * t * t * t;
        const Jp = ds * m[i] * m[j] * (A[i] + A[j]) * grad;
        // Viscosity only dissipates: at most the impulse that stops the pair closing.
        const Jv = Math.min(ds * m[i] * m[j] * visc * grad, vr < 0 ? -vr / (1 / m[i] + 1 / m[j]) : 0);
        const Jm = Jp + Jv;
        if (!(Jm > 0)) continue;
        pJ[k] = Jm;
        // Thermal share of i: its own pressure term plus half the viscosity (Monaghan 1992).
        pS[k] = (Jp * (A[i] + A[j] > 0 ? A[i] / (A[i] + A[j]) : 0.5) + 0.5 * Jv) / Jm;
        dvx[i] += (Jm * exx) / m[i];
        dvy[i] += (Jm * eyy) / m[i];
        dvx[j] -= (Jm * exx) / m[j];
        dvy[j] -= (Jm * eyy) / m[j];
      }
      if (ng > gJ.length) {
        gJ = new Float64Array(gcap);
        gS = new Float64Array(gcap);
      }
      for (let k = 0; k < ng; k++) {
        const i = ga[k];
        const g = gb[k];
        const c = gContact[g];
        const j = cP[c];
        const r = gr[k];
        gJ[k] = 0;
        if (r === 0) continue;
        const h = 0.5 * (hh[i] + hh[j]);
        const exx = (x[i] - ex[g]) / r;
        const eyy = (y[i] - ey[g]) / r;
        const vr = (vx[i] - gvx[g]) * exx + (vy[i] - gvy[g]) * eyy;
        let visc = 0;
        if (vr < 0) {
          const mu = (h * vr * r) / (r * r + 0.01 * h * h);
          visc = (-VISC_ALPHA * 0.5 * (cs[i] + cs[j]) * mu + VISC_BETA * mu * mu) / (0.5 * (rho[i] + rho[j]));
        }
        const q = r / h;
        const t = 1 - q;
        const grad = (G_C2 / (h * h * h)) * q * t * t * t;
        // The mirror moves oppositely, so stopping the closing takes half the relative speed.
        const Jv = Math.min(ds * m[i] * m[j] * visc * grad, vr < 0 ? (-vr * m[i]) / 2 : 0);
        const Jp = ds * m[i] * m[j] * (A[i] + A[j]) * grad;
        const Jm = Jp + Jv;
        if (!(Jm > 0)) continue;
        gJ[k] = Jm;
        // Thermal share of the parcel; the rest is drawn from the ghost's source parcel, as in a real pair.
        gS[k] = (Jp * (A[i] + A[j] > 0 ? A[i] / (A[i] + A[j]) : 0.5) + 0.5 * Jv) / Jm;
        const jx = Jm * exx;
        const jy = Jm * eyy;
        dvx[i] += jx / m[i];
        dvy[i] += jy / m[i];
        const wall = walls[cW[c]];
        if (wall.unit >= 0) {
          const u = units[wall.unit];
          u.dvx -= jx / u.M;
          u.dvy -= jy / u.M;
          u.dw -= ((x[i] - u.cx) * jy - (y[i] - u.cy) * jx) / u.I;
          if (u.ids.length > 1) pushPart(tPart, cW[c], -jx, -jy, x[i], y[i]);
        } else {
          extX += jx;
          extY += jy;
          extA += x[i] * jy - y[i] * jx;
        }
        acc.involved.add(bodies[cW[c]].id);
        // Pressure statistic: the impulse's normal part on each face it pushes.
        wallImp += Math.abs(Jm * (exx * cNx[c] + eyy * cNy[c]));
        const c2 = gContact2[g];
        if (c2 >= 0) wallImp += Math.abs(Jm * (exx * cNx[c2] + eyy * cNy[c2]));
      }

      // --- Energy: each impulse's work, at the mean of old and new velocities, moves between
      // kinetic and thermal. Summed, this equals the exact change in kinetic energy. ---
      for (let i = 0; i < n; i++) {
        mvx[i] = vx[i] + 0.5 * dvx[i];
        mvy[i] = vy[i] + 0.5 * dvy[i];
      }
      for (let k = 0; k < np; k++) {
        const Jm = pJ[k];
        if (Jm === 0) continue;
        const i = pa[k];
        const j = pb[k];
        const r = pr[k];
        const work = (Jm * ((x[i] - x[j]) * (mvx[i] - mvx[j]) + (y[i] - y[j]) * (mvy[i] - mvy[j]))) / r;
        E[i] -= pS[k] * work;
        E[j] -= (1 - pS[k]) * work;
      }
      for (let k = 0; k < ng; k++) {
        const Jm = gJ[k];
        if (Jm === 0) continue;
        const i = ga[k];
        const g = gb[k];
        const c = gContact[g];
        const r = gr[k];
        const exx = (x[i] - ex[g]) / r;
        const eyy = (y[i] - ey[g]) / r;
        const wall = walls[cW[c]];
        let wvx = 0;
        let wvy = 0;
        if (wall.unit >= 0) {
          const u = units[wall.unit];
          const w = u.w + 0.5 * u.dw;
          wvx = u.vx + 0.5 * u.dvx - w * (y[i] - u.cy);
          wvy = u.vy + 0.5 * u.dvy + w * (x[i] - u.cx);
        }
        const work = Jm * (exx * (mvx[i] - wvx) + eyy * (mvy[i] - wvy));
        E[i] -= gS[k] * work;
        E[cP[c]] -= (1 - gS[k]) * work;
      }
      for (let i = 0; i < n; i++) {
        vx[i] += dvx[i];
        vy[i] += dvy[i];
      }
      for (const u of units) {
        u.vx += u.dvx;
        u.vy += u.dvy;
        u.w += u.dw;
      }

      let ok = true;
      for (let i = 0; i < n; i++) if (E[i] < 0) ok = false;
      if (ok || attempt >= MAX_RETRIES) break;
      vx.set(sVx);
      vy.set(sVy);
      E.set(sE);
      for (const u of units) {
        u.vx = u.sx;
        u.vy = u.sy;
        u.w = u.sw;
      }
      ds *= 0.5;
    }
    // Only if even the shortest substep could not resolve it: clamp, and the ledger reports the shortfall.
    for (let i = 0; i < n; i++) if (E[i] < 0) E[i] = 0;
    acc.externalImpulse.x += extX;
    acc.externalImpulse.y += extY;
    acc.angular += extA;
    for (let k = 0; k < partJ.length; k++) partJ[k] += tPart[k];
    wallImpulse += wallImp;
    tDone = ds === dt - tDone ? dt : tDone + ds;
    nsub++;

    // --- Elastic bounce for a parcel that would otherwise reach a surface this substep. ---
    for (let c = 0; c < nc; c++) {
      const i = cP[c];
      const d = cD[c];
      const nx = cNx[c];
      const ny = cNy[c];
      const wall = walls[cW[c]];
      const u = wall.unit >= 0 ? units[wall.unit] : null;
      const px = x[i] - d * nx;
      const py = y[i] - d * ny;
      const [wvx, wvy] = wallPointVelocity(wall, px, py);
      const vn = (vx[i] - wvx) * nx + (vy[i] - wvy) * ny;
      if (!(vn < 0) || d + vn * ds >= HARD_WALL * rad[i]) continue;
      const rn = u ? (px - u.cx) * ny - (py - u.cy) * nx : 0;
      const invK = 1 / m[i] + (u ? 1 / u.M + (rn * rn) / u.I : 0);
      const Jm = (-2 * vn) / invK;
      wallExchange(i, u, Jm * nx, Jm * ny, px, py, cW[c]);
      wallImpulse += Jm;
    }

    // --- Drift: parcels, and the bodies with them. ---
    for (let i = 0; i < n; i++) {
      x[i] += vx[i] * ds;
      y[i] += vy[i] * ds;
    }
    for (const u of units) {
      u.cx += u.vx * ds;
      u.cy += u.vy * ds;
      u.th += u.w * ds;
      const q = sinCos(u.th);
      u.qc = q.c;
      u.qs = q.s;
    }
  }

  /** Impulse J on the parcel, −J on the unit, both along the line through (px, py). Returns the scale applied (1 unless thermal ran out). */
  function wallExchange(i: number, u: Unit | null, jx: number, jy: number, px: number, py: number, wallIdx: number): number {
    const pvx = vx[i];
    const pvy = vy[i];
    // Exact ΔKE as a quadratic in the scale s.
    const rx = px - (u ? u.cx : 0);
    const ry = py - (u ? u.cy : 0);
    const a = jx * pvx + jy * pvy - (u ? jx * u.vx + jy * u.vy + u.w * (rx * jy - ry * jx) : 0);
    const rn = rx * jy - ry * jx;
    const b = 0.5 * (jx * jx + jy * jy) * (1 / m[i] + (u ? 1 / u.M : 0)) + (u ? (0.5 * rn * rn) / u.I : 0);
    let sc = 1;
    let dKE = a + b;
    if (dKE > E[i]) {
      sc = b > 0 ? (-a + Math.sqrt(Math.max(0, a * a + 4 * b * E[i]))) / (2 * b) : 0;
      sc = Math.max(0, Math.min(1, sc));
      dKE = sc * a + sc * sc * b;
    }
    const ix = sc * jx;
    const iy = sc * jy;
    vx[i] += ix / m[i];
    vy[i] += iy / m[i];
    if (u) {
      applyUnit(u, -ix, -iy, px, py);
      if (u.ids.length > 1) pushPart(partJ, wallIdx, -ix, -iy, px, py);
    } else {
      acc.externalImpulse.x += ix;
      acc.externalImpulse.y += iy;
      // About the origin: the impulse's line of action passes through the parcel.
      acc.angular += x[i] * iy - y[i] * ix;
    }
    E[i] = Math.max(0, E[i] - dKE);
    acc.involved.add(bodies[wallIdx].id);
    return sc;
  }

  gas.substeps = nsub;

  // Far field: free bodies as bounding circles at their end-of-step pose. Fixed bodies (a ground) don't
  // count: gas far from everything that moves can't change what happens to it.
  const ff = bounds.farField;
  const circles = ff ? walls.filter((w) => w.unit >= 0).map((w) => ({ x: 0.5 * (w.minX + w.maxX), y: 0.5 * (w.minY + w.maxY), r: 0.5 * Math.sqrt((w.maxX - w.minX) ** 2 + (w.maxY - w.minY) ** 2) + ff })) : [];
  const far = (px: number, py: number): boolean => {
    if (!ff || !circles.length) return false; // with no bodies there is nothing to be far from
    for (const c of circles) if ((px - c.x) ** 2 + (py - c.y) ** 2 < c.r * c.r) return false;
    return true;
  };

  // Write back parcels, removing those outside the world boundary.
  const kept: Parcel[] = [];
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    p.position = { x: x[i], y: y[i] };
    p.velocity = { x: vx[i], y: vy[i] };
    p.thermal = E[i];
    if (x[i] < bounds.min.x || x[i] > bounds.max.x || y[i] < bounds.min.y || y[i] > bounds.max.y || far(x[i], y[i])) {
      const r = acc.removed;
      r.count += 1;
      r.mass += m[i];
      r.momentum.x += m[i] * vx[i];
      r.momentum.y += m[i] * vy[i];
      r.angularMomentum += m[i] * (x[i] * vy[i] - y[i] * vx[i]);
      const pe = -m[i] * (gravity.x * x[i] + gravity.y * y[i]);
      r.energy += 0.5 * m[i] * (vx[i] * vx[i] + vy[i] * vy[i]) + E[i] + pe;
      acc.removedPotential += pe;
      continue;
    }
    kept.push(p);
  }
  gas.parcels = kept;
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

/** Views of bodies for the gas phase: mass and inertia include stores; pose and velocity writes land on the body. */
export function wallBodies(
  bodies: readonly {
    id: string;
    shape: Shape;
    fixed: boolean;
    mass: number;
    position: Vec2;
    angle: number;
    velocity: Vec2;
    angularVelocity: number;
    contents?: Store[];
  }[],
): WallBody[] {
  return bodies.map((b) => {
    const mass = bodyMass(b);
    const inertia = massProps(b.shape, mass).inertia;
    return {
      id: b.id,
      shape: b.shape,
      fixed: b.fixed,
      mass,
      inertia,
      get position() {
        return b.position;
      },
      set position(v: Vec2) {
        b.position = v;
      },
      get angle() {
        return b.angle;
      },
      set angle(a: number) {
        b.angle = a;
      },
      get velocity() {
        return b.velocity;
      },
      set velocity(v: Vec2) {
        b.velocity = v;
      },
      get angularVelocity() {
        return b.angularVelocity;
      },
      set angularVelocity(w: number) {
        b.angularVelocity = w;
      },
    };
  });
}
