// Fragmentable asteroids (AST-001, AST-002): a seeded generator.
//
// An asteroid is a convex outline cut into convex pieces (Voronoi cells around seeded points,
// relaxed so the pieces are of similar size), each a rigid body, with neighbours welded along
// their shared edge. A weld's limits scale with the length of that edge, so a long joint is
// stronger than a short one, and with a declared bond strength. Breaking bonds and splitting
// into separate parts are the ordinary weld rules (ASM-004, ASM-005). The same seed always
// gives the same asteroid.
//
// Minerals and larger fragments (AST-006, AST-007). `gold` pieces, chosen at random, are gold:
// denser than rock and much tougher, drawn gold. `compounds` larger fragments are each a few
// neighbouring pieces welded with hidden seams, `seamStrength` times as strong as a bond: they
// hold together and are drawn as one piece. Once a larger fragment has lost `reveal` of its
// integrity (by mass), one of its pieces is wrecked, or one of its seams breaks, its seams show and take ordinary bond
// limits, so it can break up further. A gold piece inside one is drawn as rock until then.

import { add, cross, dot, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { createRng, nextFloat } from "./prng.ts";
import { polygonArea, polygonCentroid } from "./shapes.ts";
import type { Material } from "./damage.ts";
import type { Body, BodyInput, JointInput, World } from "./world.ts";

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
  /** Gold pieces, chosen at random (AST-006). Default 0. */
  gold?: number;
  /** A gold piece's density as a multiple of the rock's. Default 2. */
  goldDensity?: number;
  /** Larger fragments with hidden seams (AST-007). Default 0. */
  compounds?: number;
  /** Pieces in each larger fragment. Default 3. */
  compoundSize?: number;
  /** A hidden seam's strength as a multiple of an ordinary bond's. Default 20. */
  seamStrength?: number;
  /** Fraction of a larger fragment's integrity (by mass) it loses before its seams show. Default 0.25. */
  reveal?: number;
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
  // Larger fragments: grow each from a random piece through its bonds (drawn after the shape, so
  // the same seed gives the same outline and pieces with or without them).
  const pick = (n: number) => Math.min(n - 1, Math.floor(nextFloat(rng) * n));
  const id = (i: number) => `${spec.id}-${i}`;
  const near = new Map<string, string[]>();
  for (const j of joints) {
    near.set(j.a, [...(near.get(j.a) ?? []), j.b]);
    near.set(j.b, [...(near.get(j.b) ?? []), j.a]);
  }
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const used = new Set<string>();
  const size = Math.max(2, Math.floor(spec.compoundSize ?? 3));
  for (let c = 0; c < Math.floor(spec.compounds ?? 0); c++) {
    const free = keep.map(id).filter((x) => !used.has(x));
    if (!free.length) break;
    const group = [free[pick(free.length)]];
    while (group.length < size) {
      const edge = [...new Set(group.flatMap((g) => near.get(g) ?? []))].filter((x) => !used.has(x) && !group.includes(x)).sort();
      if (!edge.length) break;
      group.push(edge[pick(edge.length)]);
    }
    if (group.length < 2) continue;
    const k = spec.seamStrength ?? 20;
    let seams = 0;
    for (const j of joints) {
      if (!group.includes(j.a) || !group.includes(j.b)) continue;
      const l = j.limits as Required<NonNullable<JointInput["limits"]>>;
      j.hidden = { ...l };
      j.limits = { tension: l.tension * k, compression: l.compression * k, shear: l.shear * k, torque: l.torque * k };
      seams++;
    }
    const compound = { id: `${spec.id}-c${c}`, reveal: spec.reveal ?? 0.25, seams };
    for (const g of group) {
      used.add(g);
      byId.get(g)!.compound = { ...compound };
    }
  }
  // Gold: denser and much tougher than the rock round it.
  for (let g = 0; g < Math.floor(spec.gold ?? 0); g++) {
    const rock = keep.map(id).filter((x) => !byId.get(x)!.mineral);
    if (!rock.length) break;
    const b = byId.get(rock[pick(rock.length)])!;
    b.mineral = "gold";
    b.mass *= spec.goldDensity ?? 2;
    if (spec.material) b.material = { name: "gold", threshold: spec.material.threshold * 5, toughness: spec.material.toughness * 10 };
  }
  return { bodies, joints };
}

/**
 * Shows the seams of larger fragments that have taken enough damage (AST-007): their hidden
 * welds take ordinary limits, and their pieces, gold included, are drawn as they are. Returns
 * the ids revealed; raises `compound.reveal`. Changes no motion, so the ledger is unaffected.
 */
export function revealCompounds(world: World): string[] {
  const groups = new Map<string, Body[]>();
  for (const b of world.bodies) if (b.compound) groups.set(b.compound.id, [...(groups.get(b.compound.id) ?? []), b]);
  const out: string[] = [];
  for (const [cid, members] of groups) {
    const mass = members.reduce((s, b) => s + b.mass, 0);
    const lost = members.reduce((s, b) => s + b.mass * (1 - b.integrity), 0) / mass;
    const ids = new Set(members.map((b) => b.id));
    // A seam that broke (overload, or a piece detached) splits it open too.
    const { reveal, seams } = members[0].compound!;
    const split = seams !== undefined && world.joints.filter((j) => j.hidden && ids.has(j.a) && ids.has(j.b)).length < seams;
    if (!(lost >= reveal) && !members.some((b) => b.integrity <= 0) && !split) continue;
    for (const j of world.joints) {
      if (!j.hidden || !(ids.has(j.a) || ids.has(j.b))) continue;
      j.limits = j.hidden;
      delete j.hidden;
    }
    for (const b of members) delete b.compound;
    world.events.push({ tick: world.tick, type: "compound.reveal", data: { id: cid, pieces: members.length, gold: members.some((b) => b.mineral === "gold") } });
    out.push(cid);
  }
  return out;
}
