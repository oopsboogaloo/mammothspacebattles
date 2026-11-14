// Narrow-phase collision (COL-001): disc–disc, polygon–disc and polygon–polygon
// (boxes are polygons). Produces up to two contact points with signed
// separations; points closer than `margin` are kept as speculative contacts,
// which is what stops fast bodies tunnelling (COL-004).
// Polygon clipping follows Box2D's b2CollidePolygons (Erin Catto, MIT licence).

import { add, cross, dot, length, normalize, rotate, scale, sub, type Rot, type Vec2 } from "./math.ts";
import { localVertices, type Shape } from "./shapes.ts";

export interface ContactPoint {
  /** World point midway between the two surfaces. */
  point: Vec2;
  /** Distance between surfaces along the normal; negative means overlap. */
  separation: number;
  /** Stable feature id, used to match contacts between steps for warm starting. */
  key: number;
}

export interface Manifold {
  /** Unit normal pointing from body A to body B. */
  normal: Vec2;
  points: ContactPoint[];
}

export interface Placed {
  shape: Shape;
  position: Vec2;
  rot: Rot;
}

export interface WorldPoly {
  vertices: Vec2[];
  normals: Vec2[];
}

/**
 * The last outline worked out for each shape, and where: a body that hasn't moved (the rock, and
 * whatever rests on it) gets the same outline back instead of working it out again every step. The
 * same numbers either way; callers only read it.
 */
const outlines = new WeakMap<Shape, { x: number; y: number; c: number; s: number; poly: WorldPoly }>();

export function worldPolygon(p: Placed): WorldPoly {
  const kept = outlines.get(p.shape);
  if (kept && kept.x === p.position.x && kept.y === p.position.y && kept.c === p.rot.c && kept.s === p.rot.s) return kept.poly;
  const poly = outlineOf(p);
  outlines.set(p.shape, { x: p.position.x, y: p.position.y, c: p.rot.c, s: p.rot.s, poly });
  return poly;
}

function outlineOf(p: Placed): WorldPoly {
  const local = localVertices(p.shape);
  const vertices = local.map((v) => add(p.position, rotate(p.rot, v)));
  const normals = vertices.map((v, i) => {
    const e = sub(vertices[(i + 1) % vertices.length], v);
    return normalize({ x: e.y, y: -e.x });
  });
  return { vertices, normals };
}

function discDisc(a: Placed, b: Placed, margin: number): Manifold | null {
  const ra = (a.shape as { radius: number }).radius;
  const rb = (b.shape as { radius: number }).radius;
  const d = sub(b.position, a.position);
  const dist = length(d);
  const sep = dist - ra - rb;
  if (sep > margin) return null;
  const normal = dist > 1e-12 ? scale(d, 1 / dist) : { x: 1, y: 0 };
  return { normal, points: [{ point: add(a.position, scale(normal, ra + sep / 2)), separation: sep, key: 0 }] };
}

/** Polygon A against disc B. */
function polyDisc(a: Placed, b: Placed, margin: number, given?: WorldPoly): Manifold | null {
  const r = (b.shape as { radius: number }).radius;
  const poly = given ?? worldPolygon(a);
  const c = b.position;
  const n = poly.vertices.length;
  let best = 0;
  let sepMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = dot(poly.normals[i], sub(c, poly.vertices[i]));
    if (s > sepMax) {
      sepMax = s;
      best = i;
    }
  }
  if (sepMax - r > margin) return null;
  const v1 = poly.vertices[best];
  const v2 = poly.vertices[(best + 1) % n];
  const make = (normal: Vec2, surface: Vec2, sep: number, key: number): Manifold => ({
    normal,
    points: [{ point: add(surface, scale(normal, sep / 2)), separation: sep, key }],
  });
  if (sepMax < 1e-12) return make(poly.normals[best], sub(c, scale(poly.normals[best], sepMax)), sepMax - r, best);
  const u1 = dot(sub(c, v1), sub(v2, v1));
  const u2 = dot(sub(c, v2), sub(v1, v2));
  if (u1 <= 0 || u2 <= 0) {
    const v = u1 <= 0 ? v1 : v2;
    const d = sub(c, v);
    const dist = length(d);
    if (dist - r > margin) return null;
    return make(scale(d, 1 / dist), v, dist - r, 100 + (u1 <= 0 ? best : (best + 1) % n));
  }
  return make(poly.normals[best], sub(c, scale(poly.normals[best], sepMax)), sepMax - r, best);
}

function maxSeparation(a: WorldPoly, b: WorldPoly): { edge: number; sep: number } {
  let edge = 0;
  let sep = -Infinity;
  for (let i = 0; i < a.vertices.length; i++) {
    let si = Infinity;
    for (const v of b.vertices) si = Math.min(si, dot(a.normals[i], sub(v, a.vertices[i])));
    if (si > sep) {
      sep = si;
      edge = i;
    }
  }
  return { edge, sep };
}

interface ClipVertex {
  v: Vec2;
  id: number;
}

function clipSegment(vIn: ClipVertex[], normal: Vec2, offset: number, clipId: number): ClipVertex[] {
  const out: ClipVertex[] = [];
  const d0 = dot(normal, vIn[0].v) - offset;
  const d1 = dot(normal, vIn[1].v) - offset;
  if (d0 <= 0) out.push(vIn[0]);
  if (d1 <= 0) out.push(vIn[1]);
  if (d0 * d1 < 0) {
    const t = d0 / (d0 - d1);
    out.push({ v: add(vIn[0].v, scale(sub(vIn[1].v, vIn[0].v), t)), id: clipId });
  }
  return out;
}

function polyPoly(a: Placed, b: Placed, margin: number, slop: number): Manifold | null {
  const pa = worldPolygon(a);
  const pb = worldPolygon(b);
  const sa = maxSeparation(pa, pb);
  if (sa.sep > margin) return null;
  const sb = maxSeparation(pb, pa);
  if (sb.sep > margin) return null;

  const flip = sb.sep > sa.sep + 0.1 * slop;
  const ref = flip ? pb : pa;
  const inc = flip ? pa : pb;
  const edge1 = flip ? sb.edge : sa.edge;
  const nRef = ref.normals[edge1];

  // Incident edge: the one on the other polygon most anti-parallel to the reference normal.
  let incEdge = 0;
  let minDot = Infinity;
  for (let i = 0; i < inc.normals.length; i++) {
    const d = dot(nRef, inc.normals[i]);
    if (d < minDot) {
      minDot = d;
      incEdge = i;
    }
  }
  const incPts: ClipVertex[] = [
    { v: inc.vertices[incEdge], id: incEdge },
    { v: inc.vertices[(incEdge + 1) % inc.vertices.length], id: (incEdge + 1) % inc.vertices.length },
  ];

  const v11 = ref.vertices[edge1];
  const v12 = ref.vertices[(edge1 + 1) % ref.vertices.length];
  const tangent = normalize(sub(v12, v11));
  const normal = { x: tangent.y, y: -tangent.x };
  const frontOffset = dot(normal, v11);
  const side1 = -dot(tangent, v11);
  const side2 = dot(tangent, v12);

  let clipped = clipSegment(incPts, scale(tangent, -1), side1, 50 + edge1);
  if (clipped.length < 2) return null;
  clipped = clipSegment(clipped, tangent, side2, 60 + edge1);
  if (clipped.length < 2) return null;

  const points: ContactPoint[] = [];
  for (const cv of clipped) {
    const separation = dot(normal, cv.v) - frontOffset;
    if (separation <= margin) {
      points.push({
        point: sub(cv.v, scale(normal, separation / 2)),
        separation,
        key: (flip ? 1000 : 0) + edge1 * 100 + cv.id,
      });
    }
  }
  if (points.length === 0) return null;
  return { normal: flip ? scale(normal, -1) : normal, points };
}

/** Contact manifold between two placed shapes, normal from A to B, or null if further apart than margin. */
export function collide(a: Placed, b: Placed, margin: number, slop: number): Manifold | null {
  const ka = a.shape.kind;
  const kb = b.shape.kind;
  if (ka === "disc" && kb === "disc") return discDisc(a, b, margin);
  if (ka !== "disc" && kb === "disc") return polyDisc(a, b, margin);
  if (ka === "disc" && kb !== "disc") {
    const m = polyDisc(b, a, margin);
    return m && { normal: scale(m.normal, -1), points: m.points };
  }
  return polyPoly(a, b, margin, slop);
}

/**
 * collide(disc, body) for many discs against the same body: a polygon body's outline in world
 * coordinates, `poly` (worldPolygon of it), is worked out once by the caller and shared. The same
 * result as collide(disc, body, margin, 0).
 */
export function collideDisc(disc: Placed, body: Placed, margin: number, poly?: WorldPoly): Manifold | null {
  if (body.shape.kind === "disc") return discDisc(disc, body, margin);
  const m = polyDisc(body, disc, margin, poly);
  return m && { normal: scale(m.normal, -1), points: m.points };
}

/** Point-in-shape test, used for picking in the UI. */
export function containsPoint(p: Placed, point: Vec2): boolean {
  if (p.shape.kind === "disc") return length(sub(point, p.position)) <= p.shape.radius;
  const poly = worldPolygon(p);
  return poly.vertices.every((v, i) => cross(sub(poly.vertices[(i + 1) % poly.vertices.length], v), sub(point, v)) >= 0);
}
