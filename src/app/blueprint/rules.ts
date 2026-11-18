// The design rules (docs/blueprint/design-rules-proposal.md): what a part's size and settings give
// it. Calibrated on Thrust's ship, so that at Thrust's own sizes every rule gives back Thrust's own
// figures. Only the regular parts follow them; the OG parts (THRUST OG's) are kept as they are.
import { polygonArea } from "../../core/index.ts";
import type { Vec2 } from "../../core/index.ts";

/** Wall thickness, m (§1): every part's, by default; a container's is a setting within these. */
export const WALL = { default: 0.1, min: 0.02, max: 0.3 } as const;

/**
 * Weld limits per metre of the thinner wall a weld joins (§1; docs/nozzle-design-thoughts.md §5):
 * at 0.1 m they are Thrust's Standard welds.
 */
export const WELD_K = { tension: 229_500, compression: 459_000, shear: 160_500, torque: 55_200 } as const;

/** A wall's mass per m² of it, kg (Thrust's nozzle walls: 0.75 kg for 1.1 × 0.1 m). */
export const WALL_DENSITY = 0.75 / 0.11;

/**
 * A weld point's mass, kg (Chloe, 17 November 2026: welds shouldn't be free): a fillet bead of the
 * walls' own material, a right triangle with legs quality × the thinner wall, at the walls' density.
 * Its strength grows with its quality (weldLimits), its metal with the square: a Light point (0.5)
 * on 0.1 m walls is 0.0085 kg, Standard 0.034 kg, Heavy (2) 0.136 kg.
 */
export const weldPointMass = (thinner: number, quality = 1): number => (WALL_DENSITY * (quality * thinner) ** 2) / 2;

/**
 * Welds a ship may use, by its size (Chloe, 17 November 2026): Standard welds from 8 parts, Heavy
 * from 15; below 8, Light only. Returns the strongest weld quality a ship of `parts` parts may have.
 */
export const WELD_UNLOCK = { standard: 8, heavy: 15 } as const;
export const maxWeldQuality = (parts: number): number => (parts >= WELD_UNLOCK.heavy ? 2 : parts >= WELD_UNLOCK.standard ? 1 : 0.5);

export function weldLimits(thinner: number, quality = 1): { tension: number; compression: number; shear: number; torque: number } {
  const r = (x: number) => Math.round(x * thinner * quality * 1e6) / 1e6;
  return { tension: r(WELD_K.tension), compression: r(WELD_K.compression), shear: r(WELD_K.shear), torque: r(WELD_K.torque) };
}

export type ContainerKind = "tank" | "magazine" | "bullets";

interface ContainerRule {
  /** What 1 m² of inner area holds: kg of propellant (a tank) or shells (a magazine). */
  perArea: number;
  /** Dry mass per m² of wall, kg. */
  dryPerWall: number;
  /** Its material at the default wall (DMG-002): both figures go with the thickness. */
  material: { name: string; threshold: number; toughness: number };
  /** Explosive charge per unit it can hold (kg per kg, or per shell). */
  chargePerUnit: number;
  /** Least and most each way, m (its bounding box). */
  min: number;
  max: number;
}

/** Inner area of a box w × h with walls t. */
const boxInner = (w: number, h: number, t: number) => Math.max(0, w - 2 * t) * Math.max(0, h - 2 * t);

/**
 * Thrust's tank (1.5 × 1.0 m, 2 kg dry, 4.05 kg propellant) and THRUST 1's magazine (0.7 × 0.45 m,
 * 3 kg): rebalance v1, 256 of the new shells, about the mass of the 60 old ones.
 */
export const CONTAINERS: Record<ContainerKind, ContainerRule> = {
  tank: {
    perArea: 4.05 / boxInner(1.5, 1, WALL.default),
    dryPerWall: 2 / (1.5 - boxInner(1.5, 1, WALL.default)),
    material: { name: "tank", threshold: 60, toughness: 500 },
    chargePerUnit: 0.05 / 4.05,
    min: 0.3,
    max: 3,
  },
  magazine: {
    perArea: 256 / boxInner(0.7, 0.45, WALL.default),
    dryPerWall: 3 / (0.7 * 0.45 - boxInner(0.7, 0.45, WALL.default)),
    material: { name: "hull", threshold: 150, toughness: 3000 },
    chargePerUnit: 1 / 256,
    min: 0.3,
    max: 2,
  },
  // Chloe, 16 November 2026: chemically propelled bullets take twice the room of railgun shells.
  bullets: {
    perArea: 60 / boxInner(0.7, 0.45, WALL.default) / 2,
    dryPerWall: 3 / (0.7 * 0.45 - boxInner(0.7, 0.45, WALL.default)),
    material: { name: "hull", threshold: 150, toughness: 3000 },
    chargePerUnit: 1 / 60,
    min: 0.3,
    max: 2,
  },
};

/**
 * The gun (Chloe, 16 November 2026): bullets fired by their own propellant, so it needs no power,
 * but slower than a railgun of the same length: 100 m/s from a 0.7 m barrel (the railgun's 144),
 * going as the square root of the length (the propellant's push over the barrel: v² ∝ length).
 */
export const GUN = { speed: 100, length: 0.7, muzzle: 0.16 } as const;
export const gunSpeed = (length: number) => round(GUN.speed * Math.sqrt(length / GUN.length), 3);

/** A bullet: the railgun's shell's mass, in a cartridge that takes twice the room. */
export const BULLET = { shape: { kind: "box" as const, width: 0.22, height: 0.22 }, mass: 0.166667, restitution: 0, friction: 0.05 };

/** The propellant's mixture by mass: H₂ : O₂ is 1 : 8 (the game's). */
export const MIXTURE = { h2: 1 / 9, o2: 8 / 9 } as const;

/**
 * The area inside a convex outline whose walls are t thick: the outline cut back by each side
 * moved in by t. A short side the walls swallow drops out (a corner squeezed between two long
 * sides); nothing is left when the walls fill it.
 */
export function innerArea(vertices: Vec2[], t: number): number {
  let vs = vertices;
  if (polygonArea(vs) < 0) vs = [...vs].reverse();
  const n = vs.length;
  let inner: Vec2[] = vs.map((v) => ({ ...v }));
  for (let i = 0; i < n && inner.length; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0)) continue;
    // Inside is to the side's left (the outline being anticlockwise): keep what is at least t in.
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const depth = (p: Vec2) => (p.x - a.x) * nx + (p.y - a.y) * ny - t;
    const kept: Vec2[] = [];
    for (let k = 0; k < inner.length; k++) {
      const p = inner[k];
      const q = inner[(k + 1) % inner.length];
      const dp = depth(p);
      const dq = depth(q);
      if (dp >= 0) kept.push(p);
      if (dp >= 0 !== dq >= 0) {
        const f = dp / (dp - dq);
        kept.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
      }
    }
    inner = kept;
  }
  return inner.length >= 3 ? Math.max(0, polygonArea(inner)) : 0;
}

/** What a container gets from its outline and walls. */
export interface ContainerSpec {
  /** kg of propellant, or shells. */
  holds: number;
  dryMass: number;
  material: { name: string; threshold: number; toughness: number };
  charge: number;
}

export function containerSpec(kind: ContainerKind, vertices: Vec2[], t: number): ContainerSpec {
  const r = CONTAINERS[kind];
  const outer = Math.abs(polygonArea(vertices));
  const inner = innerArea(vertices, t);
  // Shells are whole: rounded down, after a little for floating point (Thrust's 0.125 m² × 480 is 59.999…).
  const holds = kind === "tank" ? round(inner * r.perArea, 9) : Math.floor(inner * r.perArea + 1e-6);
  const k = t / WALL.default;
  return {
    holds,
    dryMass: round((outer - inner) * r.dryPerWall, 6),
    material: { name: r.material.name, threshold: round(r.material.threshold * k, 6), toughness: round(r.material.toughness * k, 6) },
    charge: round(holds * r.chargePerUnit, 9),
  };
}

/** The thickest a container's walls may be: within the limits, and leaving room inside. */
export function maxWall(width: number, height: number): number {
  return Math.min(WALL.max, Math.floor((Math.min(width, height) / 4) * 1000) / 1000);
}

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- power (design rules §4) ----------

// Rebalance v1 (docs/rebalance-v1.md; Chloe, 18 November 2026): real-world figures to start from,
// set in the game's units and written here in the designer's (the core's: lengths ÷4, masses ÷1024;
// energy ÷16384, power ÷16384, energy per kg ÷16).
const G_ENERGY = 16384;
const G_SPECIFIC = 16;

/**
 * The railgun's shell (Chloe): 40 kg at 1,200 m/s, 28.8 MJ (it was 171 kg at 576 m/s). Its size goes
 * with its mass at the old shell's density. A shot draws its energy at 40%: 72 MJ.
 */
export const SHELL = { mass: 40 / 1024, speed: 1200 / 4, shape: { kind: "box" as const, width: 0.125, height: 0.105 }, efficiency: 0.4 } as const;
/** A railgun shot, kJ (the designer's units). */
export const railgunShot = (mass: number = SHELL.mass, speed: number = SHELL.speed): number => (0.5 * mass * speed * speed) / SHELL.efficiency / 1000;

/** The battery's figures, as THRUST 1's (1.2 × 0.5 m, 2 kg; 2 t in the game). */
const BATTERY_AREA = 0.6;
const BATTERY_MASS_PER_AREA = 2 / BATTERY_AREA;
/** 450 Wh per kg (the best commercial lithium cells), in kJ per m². */
const BATTERY_PER_AREA = ((450 * 3600) / G_SPECIFIC / 1000) * BATTERY_MASS_PER_AREA;

/**
 * Power (design rules §4), rebalance v1:
 * - battery: 450 Wh/kg (THRUST 1's: 3.3 GJ, about 46 shots). Its blast is today's at full.
 * - generator: 50 kW/kg, 10 × a fuel cell's (THRUST 1's: 102 MW each; Chloe, 18 November 2026,
 *   after flying it: 12.5 kW/kg was nowhere near enough for half the ship).
 * - propellant: ~7 MJ of electricity a kg (H₂ + O₂ at 1 : 8, about 13 MJ/kg, half of it made electric).
 * - shield: up, it drains THRUST 1's battery in 20 s; each hit costs the energy it brings at 25%.
 * - tractor: the beam 60 MW, the tether 20 MW.
 */
export const POWER = {
  /** kJ a generator makes from 1 kg of propellant. */
  perKg: (7e6 / G_SPECIFIC) / 1000,
  battery: { perArea: BATTERY_PER_AREA, massPerArea: BATTERY_MASS_PER_AREA, chargeFull: 0.05 / (BATTERY_PER_AREA * BATTERY_AREA), min: 0.2, max: 2 },
  generator: { perArea: ((50_000 / G_SPECIFIC) / 1000) * (2 / 0.56), massPerArea: 2 / 0.56, min: 0.3, max: 2 },
  /** The shield's draw while up (kW), and each hit's: the energy it brings, at this efficiency. */
  shield: { draw: (BATTERY_PER_AREA * BATTERY_AREA) / 20, hitEfficiency: 0.25 },
  /** A railgun shot, kJ. */
  railgunShot: railgunShot(),
  /** The tractor's beam and its tether, kW. */
  beam: 60e6 / G_ENERGY / 1000,
  tether: 20e6 / G_ENERGY / 1000,
} as const;

/** The pilot (Chloe): a woolly mammoth cow, 4 t, in the cockpit. kg (the designer's units). */
export const PILOT = { mass: 4000 / 1024 } as const;

export type PowerKind = "battery" | "generator";

/** A battery's or generator's figures from its outline's area. */
export function powerSpec(kind: PowerKind, area: number): { mass: number; capacity?: number; output?: number; charge?: number } {
  if (kind === "battery") {
    const capacity = round(area * POWER.battery.perArea, 6);
    return { mass: round(area * POWER.battery.massPerArea, 6), capacity, charge: round(capacity * POWER.battery.chargeFull, 9) };
  }
  return { mass: round(area * POWER.generator.massPerArea, 6), output: round(area * POWER.generator.perArea, 6) };
}

// ---------- pressure and burning (design rules §5; Chloe, 17 November 2026) ----------

/**
 * Walls under pressure, and burning completely:
 * - `k`: a wall t thick spanning L holds 2·k·t ÷ L, N/m (the thin-wall rule p = σ·t ÷ r, r = L/2 in
 *   the plane). Set so THRUST 1's main engine runs at half what its tanks can feed.
 * - `feedMargin`: a pressure-fed engine's chamber runs at most its weakest tank's hold over this (the
 *   injector's and the pipes' losses). Chloe's choice, to try.
 * - `lstar`, `lstarFloor`: below L* = chamber width × length ÷ throat of `lstar` m the propellant
 *   leaves before it has all burned: efficiency √(L* ÷ lstar), down to `lstarFloor`. Set at THRUST 1's
 *   main engine (Chloe's choice B: smaller, lighter engines pay a little).
 */
export const PRESSURE = { k: 25_700, feedMargin: 1.5, lstar: 0.3, lstarFloor: 0.7 } as const;

/** The pressure a wall t thick spanning L holds, N/m. */
export const holdPressure = (t: number, span: number): number => (span > 0 ? (2 * PRESSURE.k * t) / span : Infinity);

/** How completely a chamber burns, from its L*: 1 at or above the rule's L*, less below it. */
export const burnEfficiency = (lstar: number): number => Math.max(PRESSURE.lstarFloor, Math.min(1, Math.sqrt(Math.max(0, lstar) / PRESSURE.lstar)));
