// Fragmentable asteroids (AST-001, AST-002): a seeded generator.
//
// An asteroid is a convex outline cut into convex pieces (Voronoi cells around seeded points,
// relaxed so the pieces are of similar size), each a rigid body, with neighbours welded along
// their shared edge. A weld's limits scale with the length of that edge, so a long joint is
// stronger than a short one, and with a declared bond strength. Breaking bonds and splitting
// into separate parts are the ordinary weld rules (ASM-004, ASM-005). The same seed always
// gives the same asteroid.

import { add, cross, dot, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { createRng, nextFloat } from "./prng.ts";
import { polygonArea, polygonCentroid } from "./shapes.ts";
import type { Material } from "./damage.ts";
import type { BodyInput, JointInput } from "./world.ts";

export interface AsteroidSpec {
  /** Prefix for the pieces' ids: `<id>-0`, `<id>-1`, …; bonds are `<id>-b<i>-<j>`. */
  id: string;
  seed: number;
  /** How many pieces to cut it into. */
  pieces: number;
  /** Rough radius, m. */
  radius: number;
  /** Mass per area, kg/m². */
  density: number;
  /** Bond strength: tension and shear a bond carries per metre of shared edge, N/m. */
  bond: number;
  /** How the pieces take damage (DMG-002). Without one, hits never weaken the bonds. */
  material?: Material;
  position: Vec2;
  velocity?: Vec2;
  angle?: number;
  angularVelocity?: number;
}

const TWO_PI = 2 * Math.PI;
const OUTLINE_POINTS = 11;
const RELAX = 2;

/** Convex hull, counter-clockwise (monotone chain). */
function hull(points: Vec2[]): Vec2[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(sub(out[out.length - 1], out[out.length - 2]), sub(p, out[out.length - 1])) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(ps), ...half([...ps].reverse())];
}

/** The part of a convex polygon on the side of the line through `m` where (p − m)·n ≤ 0. */
function clip(poly: Vec2[], m: Vec2, n: Vec2): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = dot(sub(a, m), n);
    const db = dot(sub(b, m), n);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) out.push(add(a, scale(sub(b, a), da / (da - db))));
  }
  return out;
}

/** Drops repeated and nearly collinear vertices, which convex polygons may not have. */
function tidy(poly: Vec2[], size: number): Vec2[] {
  let vs = poly.filter((p, i) => length(sub(p, poly[(i + 1) % poly.length])) > 1e-6 * size);
  let changed = true;
  while (changed && vs.length > 3) {
    changed = false;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[(i + vs.length - 1) % vs.length];
      const b = vs[i];
      const c = vs[(i + 1) % vs.length];
      if (cross(sub(b, a), sub(c, b)) <= 1e-9 * size * size) {
        vs = vs.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return vs;
}

function inside(poly: Vec2[], p: Vec2): boolean {
  return poly.every((a, i) => cross(sub(poly[(i + 1) % poly.length], a), sub(p, a)) >= 0);
}

/** Voronoi cells of `sites` inside the convex `outline`. */
function cells(outline: Vec2[], sites: Vec2[]): Vec2[][] {
  return sites.map((s, i) => {
    let poly = outline;
    for (let j = 0; j < sites.length && poly.length; j++) {
      if (j === i) continue;
      poly = clip(poly, scale(add(s, sites[j]), 0.5), sub(sites[j], s));
    }
    return poly;
  });
}

/** The pieces and bonds of an asteroid (AST-002). Deterministic in `seed`. */
export function generateAsteroid(spec: AsteroidSpec): { bodies: BodyInput[]; joints: JointInput[] } {
  const rng = createRng(spec.seed);
  const R = spec.radius;
  // A lumpy convex outline.
  const ring: Vec2[] = [];
  for (let k = 0; k < OUTLINE_POINTS; k++) {
    const a = ((k + 0.6 * (nextFloat(rng) - 0.5)) / OUTLINE_POINTS) * TWO_PI;
    const q = sinCos(a);
    const r = R * (0.75 + 0.35 * nextFloat(rng));
    ring.push({ x: q.c * r, y: q.s * r });
  }
  const outline = hull(ring);
  // Seeded points inside it, relaxed towards their cells' centroids so pieces are of similar size.
  const n = Math.max(1, Math.floor(spec.pieces));
  let sites: Vec2[] = [];
  while (sites.length < n) {
    const p = { x: (2 * nextFloat(rng) - 1) * R * 1.1, y: (2 * nextFloat(rng) - 1) * R * 1.1 };
    if (inside(outline, p)) sites.push(p);
  }
  for (let it = 0; it < RELAX; it++) sites = cells(outline, sites).map((c, i) => (c.length >= 3 ? polygonCentroid(c) : sites[i]));
  const polys = cells(outline, sites).map((c) => tidy(c, R));

  const q = sinCos(spec.angle ?? 0);
  const v = spec.velocity ?? { x: 0, y: 0 };
  const w = spec.angularVelocity ?? 0;
  const keep: number[] = [];
  const centres: Vec2[] = [];
  const bodies: BodyInput[] = [];
  polys.forEach((poly, i) => {
    if (poly.length < 3 || poly.length > 16 || polygonArea(poly) < 1e-4 * R * R) return;
    const c = polygonCentroid(poly);
    const r = rotate(q, c);
    keep.push(i);
    centres[i] = c;
    bodies.push({
      id: `${spec.id}-${i}`,
      shape: { kind: "polygon", vertices: poly.map((p) => sub(p, c)) },
      mass: spec.density * polygonArea(poly),
      position: add(spec.position, r),
      velocity: { x: v.x - w * r.y, y: v.y + w * r.x },
      angle: spec.angle ?? 0,
      angularVelocity: w,
      restitution: 0.1,
      friction: 0.6,
      ...(spec.material ? { material: { ...spec.material } } : {}),
    });
  });
  // Bonds along shared edges: the vertices of piece i that lie on its border with piece j.
  const joints: JointInput[] = [];
  for (const i of keep)
    for (const j of keep) {
      if (j <= i) continue;
      const m = scale(add(sites[i], sites[j]), 0.5);
      const d = sub(sites[j], sites[i]);
      const dl = length(d);
      const onBorder = polys[i].filter((p) => Math.abs(dot(sub(p, m), d)) < 1e-6 * dl * R);
      if (onBorder.length < 2) continue;
      const [a, b] = onBorder;
      const len = length(sub(b, a));
      if (len < 1e-3 * R) continue;
      const mid = scale(add(a, b), 0.5);
      joints.push({
        id: `${spec.id}-b${i}-${j}`,
        a: `${spec.id}-${i}`,
        b: `${spec.id}-${j}`,
        anchorA: sub(mid, centres[i]),
        anchorB: sub(mid, centres[j]),
        axis: scale(d, 1 / dl), // across the border: tension pulls the pieces apart
        limits: { tension: spec.bond * len, compression: 4 * spec.bond * len, shear: spec.bond * len, torque: (spec.bond * len * len) / 4 },
      });
    }
  return { bodies, joints };
}
