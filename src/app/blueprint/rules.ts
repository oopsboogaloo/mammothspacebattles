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

/** Thrust's tank (1.5 × 1.0 m, 2 kg dry, 4.05 kg propellant) and THRUST 1's magazine (0.7 × 0.45 m, 3 kg, 60 shells). */
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
    perArea: 60 / boxInner(0.7, 0.45, WALL.default),
    dryPerWall: 3 / (0.7 * 0.45 - boxInner(0.7, 0.45, WALL.default)),
    material: { name: "hull", threshold: 150, toughness: 3000 },
    chargePerUnit: 1 / 60,
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

/**
 * Power, calibrated on Thrust's battery (1.2 × 0.5 m, 2 kg) and generators (0.7 × 0.8 m, 2 kg each)
 * and today's shield (0.4 kg/s of fuel, 0.00125 kg per N·s of each hit, at least 0.025 kg).
 */
export const POWER = {
  /** kJ a generator makes from 1 kg of propellant. */
  perKg: 1000,
  battery: { perArea: 2700, massPerArea: 2 / 0.6, chargeFull: 0.05 / (2700 * 0.6), min: 0.2, max: 2 },
  generator: { perArea: 400, massPerArea: 2 / 0.56, min: 0.3, max: 2 },
  /** The shield's draw while up (kW), and each hit's (kJ per N·s, and at least). */
  shield: { draw: 400, hitDraw: 1.25, minHitDraw: 25 },
  /** A railgun shot, kJ: its kinetic energy (½ × 0.167 kg × 144²) at 50%. Chloe will raise it. */
  railgunShot: 3.5,
  /** The tractor's beam and its tether, kW. */
  beam: 10,
  tether: 5,
} as const;

export type PowerKind = "battery" | "generator";

/** A battery's or generator's figures from its outline's area. */
export function powerSpec(kind: PowerKind, area: number): { mass: number; capacity?: number; output?: number; charge?: number } {
  if (kind === "battery") {
    const capacity = round(area * POWER.battery.perArea, 6);
    return { mass: round(area * POWER.battery.massPerArea, 6), capacity, charge: round(capacity * POWER.battery.chargeFull, 9) };
  }
  return { mass: round(area * POWER.generator.massPerArea, 6), output: round(area * POWER.generator.perArea, 6) };
}
