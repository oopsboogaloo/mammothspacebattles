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

export type ContainerKind = "tank" | "magazine";

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
};

/** The propellant's mixture by mass: H₂ : O₂ is 1 : 8 (the game's). */
export const MIXTURE = { h2: 1 / 9, o2: 8 / 9 } as const;

/**
 * The area inside a convex outline whose walls are t thick: each side moved in by t, and the
 * corners where the moved sides meet. Zero if the walls fill it.
 */
export function innerArea(vertices: Vec2[], t: number): number {
  let vs = vertices;
  if (polygonArea(vs) < 0) vs = [...vs].reverse();
  const n = vs.length;
  // Each side as a line moved inward (to its left, the outline being anticlockwise).
  const lines = vs.map((a, i) => {
    const b = vs[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    return { p: { x: a.x + nx * t, y: a.y + ny * t }, d: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } };
  });
  const inner: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i + n - 1) % n];
    const l2 = lines[i];
    const det = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
    if (Math.abs(det) < 1e-12) return 0;
    const s = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / det;
    inner.push({ x: l1.p.x + l1.d.x * s, y: l1.p.y + l1.d.y * s });
  }
  // Walls so thick the moved sides cross over: nothing inside.
  for (let i = 0; i < n; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % n];
    if ((b.x - a.x) * lines[i].d.x + (b.y - a.y) * lines[i].d.y <= 0) return 0;
  }
  return Math.max(0, polygonArea(inner));
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
  const holds = kind === "magazine" ? Math.floor(inner * r.perArea + 1e-6) : round(inner * r.perArea, 9);
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
