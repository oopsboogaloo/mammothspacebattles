// Collision shapes and mass properties (PHY-001). Shapes are in body-local
// coordinates with the centre of mass at the origin. Uniform density is assumed.

import { cross, sub, type Vec2 } from "./math.ts";

export type Shape =
  | { kind: "disc"; radius: number } // m
  | { kind: "box"; width: number; height: number } // m
  | { kind: "polygon"; vertices: Vec2[] }; // m, convex, counter-clockwise, centroid at origin

export interface MassProps {
  area: number; // m²
  inertia: number; // kg·m², about the centre of mass
  boundingRadius: number; // m
}

export function polygonArea(vs: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < vs.length; i++) a += cross(vs[i], vs[(i + 1) % vs.length]);
  return a / 2;
}

export function polygonCentroid(vs: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i];
    const q = vs[(i + 1) % vs.length];
    const w = cross(p, q);
    a += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

/** Returns why a vertex list is not a valid convex polygon, or null if it is. Accepts either winding. */
export function polygonProblem(vs: readonly Vec2[]): string | null {
  if (vs.length < 3) return "needs at least 3 vertices";
  if (vs.length > 16) return "at most 16 vertices";
  const area = polygonArea(vs);
  if (!(Math.abs(area) > 1e-9)) return "has zero area";
  const sign = Math.sign(area);
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const b = vs[(i + 1) % vs.length];
    const c = vs[(i + 2) % vs.length];
    if (sign * cross(sub(b, a), sub(c, b)) <= 0) return "must be convex with no repeated or collinear vertices";
  }
  return null;
}

/** Counter-clockwise copy of the vertices, shifted so the centroid is at the origin. Also returns the shift. */
export function normalizePolygon(vs: readonly Vec2[]): { vertices: Vec2[]; centroid: Vec2 } {
  const ccw = polygonArea(vs) < 0 ? [...vs].reverse() : [...vs];
  const centroid = polygonCentroid(ccw);
  return { vertices: ccw.map((v) => ({ x: v.x - centroid.x, y: v.y - centroid.y })), centroid };
}

export function localVertices(shape: Shape): Vec2[] {
  if (shape.kind === "box") {
    const hx = shape.width / 2;
    const hy = shape.height / 2;
    return [
      { x: -hx, y: -hy },
      { x: hx, y: -hy },
      { x: hx, y: hy },
      { x: -hx, y: hy },
    ];
  }
  if (shape.kind === "polygon") return shape.vertices;
  throw new Error("A disc has no vertices");
}

export function massProps(shape: Shape, mass: number): MassProps {
  if (shape.kind === "disc") {
    const r = shape.radius;
    return { area: Math.PI * r * r, inertia: 0.5 * mass * r * r, boundingRadius: r };
  }
  const vs = localVertices(shape);
  // Second moment of area about the origin (the centroid), then scaled to mass.
  let area = 0;
  let j = 0;
  let maxR2 = 0;
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i];
    const q = vs[(i + 1) % vs.length];
    const w = cross(p, q);
    area += w / 2;
    j += (w * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y)) / 12;
    maxR2 = Math.max(maxR2, p.x * p.x + p.y * p.y);
  }
  return { area, inertia: (mass * j) / area, boundingRadius: Math.sqrt(maxR2) };
}
