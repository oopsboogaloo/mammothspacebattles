// Engine chambers as pressure vessels (§10.1, PRP-002).
//
// Gas enclosed by an engine's own walls, upstream of its throat, is held as one well-mixed volume
// (mass, thermal energy, composition) instead of as parcels. Its pressure follows from the gas law
// over the chamber's area; it flows out through the throat as a choked jet, released as parcels into
// the nozzle; and it pushes on each wall of the chamber, which loads the welds but, the chamber being
// closed but for the throat, moves nothing. A plug across the throat, moving with the engine, keeps
// nozzle gas out of the chamber and takes its push, so thrust is the jet's recoil plus the nozzle
// gas pushing back: what the walls would feel from a chamber full of parcels.
//
// The chamber is found from the geometry: free space inside the declared interior
// (`injector.chamber`), from the outlet to the throat (the narrowest cross-section), bounded by the
// bodies welded to the engine. If it is not enclosed (a wall broke off), something else is inside
// it (a shell in a breech), or its body is a gun, the gas stays as parcels; a vessel that stops
// being enclosed releases its gas as parcels where the chamber was. Every exchange keeps mass,
// momentum and energy exact.

import { bodyMass } from "./bodies.ts";
import { burn, mixture, type Parcel, type WallBody } from "./gas.ts";
import { assemblyRoots, topologyToken } from "./joints.ts";
import { add, cross, dot, invRotate, length, powPos, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { localVertices, massProps, type Shape } from "./shapes.ts";
import type { Body, World } from "./world.ts";

/** Gas held in an engine's chamber. */
export interface Vessel {
  mass: number; // kg
  thermal: number; // J (in the world's gas scale, as parcels)
  composition: Record<string, number>;
  /** Where the throat plane is, m along the injector's direction from its outlet. */
  throat: number;
  /** Mass allowed out but not yet released, kg; parcels released so far. */
  credit: number;
  count: number;
}

/** The chamber's shape in the engine's frame, per unit pressure where it says so. */
export interface VesselShape {
  sealed: boolean;
  /** Free area, m². */
  area: number;
  /** Throat plane, m along the direction from the outlet; opening across it, m from the axis. */
  throat: number;
  openFrom: number;
  openTo: number;
  /** Force per unit pressure on each wall, engine frame, and its moment about the engine's centre. */
  loads: { id: string; fx: number; fy: number; m: number }[];
  /** Grid: cell (i, j) is at across u0 + (i + ½)h, along s0 + (j + ½)h; `inside` marks chamber cells. */
  h: number;
  u0: number;
  s0: number;
  nu: number;
  ns: number;
  inside: Uint8Array;
  /** Engine-frame bounds of the chamber. */
  box: { minX: number; minY: number; maxX: number; maxY: number };
  /** The chamber's extent as a rectangle in the engine's frame, for drawing. */
  outline: Vec2[];
}

const CELLS_ACROSS = 64;
const shapeCache = new Map<string, VesselShape | null>();
// The same shapes within one step (geometry at rest doesn't change between the step's phases).
const perStep = new WeakMap<World, { tick: number; shapes: Map<string, VesselShape | null>; topo?: object }>();
// How far each shape reaches from its centre.
const reachOf = new WeakMap<Shape, number>();
function reach(shape: Shape): number {
  let r = reachOf.get(shape);
  if (r === undefined) {
    r = shape.kind === "disc" ? shape.radius : Math.max(...localVertices(shape).map((v) => length(v)));
    reachOf.set(shape, r);
  }
  return r;
}
/** How far the chamber reaches from the engine's centre. */
const boxReach = (bx: VesselShape["box"]) => Math.sqrt(Math.max(bx.minX * bx.minX, bx.maxX * bx.maxX) + Math.max(bx.minY * bx.minY, bx.maxY * bx.maxY));

interface Frame {
  q: { c: number; s: number };
  dir: Vec2;
  perp: Vec2;
  outlet: Vec2;
}
function frameOf(b: Body): Frame | null {
  const inj = b.injector!;
  const len = length(inj.direction);
  if (!(len > 0)) return null;
  const dir = scale(inj.direction, 1 / len);
  return { q: sinCos(b.angle), dir, perp: { x: -dir.y, y: dir.x }, outlet: inj.outlet };
}
/** Engine-frame point at (s along, u across) from the outlet. */
const at = (f: Frame, s: number, u: number): Vec2 => add(f.outlet, add(scale(f.dir, s), scale(f.perp, u)));

/** A body's outline in another body's frame: a polygon (counter-clockwise) or a disc. */
type Outline = { kind: "polygon"; vs: Vec2[] } | { kind: "disc"; c: Vec2; r: number };
function outlineIn(b: Body, other: { position: Vec2; angle: number; shape: Shape }): Outline {
  const qb = sinCos(b.angle);
  return outlineAt(invRotate(qb, sub(other.position, b.position)), other.angle - b.angle, other.shape);
}
/** An outline at a pose in some frame. */
function outlineAt(rel: Vec2, angle: number, shape: Shape): Outline {
  if (shape.kind === "disc") return { kind: "disc", c: rel, r: shape.radius };
  const qr = sinCos(angle);
  return { kind: "polygon", vs: localVertices(shape).map((v) => add(rel, rotate(qr, v))) };
}

/**
 * Each member's pose in `b`'s frame as its welds hold it at rest, walking the welds out from `b`
 * (so the chamber's shape doesn't flicker as the welds flex). Members no weld reaches keep their pose now.
 */
function restPoses(world: World, b: Body, members: Body[]): Map<string, { p: Vec2; angle: number }> {
  const ids = new Set(members.map((m) => m.id));
  const poses = new Map<string, { p: Vec2; angle: number }>([[b.id, { p: { x: 0, y: 0 }, angle: 0 }]]);
  const joints = world.joints.filter((j) => ids.has(j.a) && ids.has(j.b));
  const queue = [b.id];
  while (queue.length) {
    const id = queue.shift()!;
    const pa = poses.get(id)!;
    for (const j of joints) {
      const fromA = j.a === id;
      if (!fromA && j.b !== id) continue;
      const other = fromA ? j.b : j.a;
      if (poses.has(other)) continue;
      // Anchors meet: pa.p + R(θa)·anchorA = pb.p + R(θb)·anchorB, with θb = θa + referenceAngle.
      const angle = fromA ? pa.angle + j.referenceAngle : pa.angle - j.referenceAngle;
      const mine = fromA ? j.anchorA : j.anchorB;
      const theirs = fromA ? j.anchorB : j.anchorA;
      const p = sub(add(pa.p, rotate(sinCos(pa.angle), mine)), rotate(sinCos(angle), theirs));
      poses.set(other, { p, angle });
      queue.push(other);
    }
  }
  const qb = sinCos(b.angle);
  for (const m of members) if (!poses.has(m.id)) poses.set(m.id, { p: invRotate(qb, sub(m.position, b.position)), angle: m.angle - b.angle });
  return poses;
}
function contains(o: Outline, p: Vec2): boolean {
  if (o.kind === "disc") return (p.x - o.c.x) ** 2 + (p.y - o.c.y) ** 2 <= o.r * o.r;
  const vs = o.vs;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const c = vs[(i + 1) % vs.length];
    if ((c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x) < 0) return false;
  }
  return true;
}
/** An outline overlaps an axis-aligned box (separating axes). */
function overlapsBox(o: Outline, bx: VesselShape["box"]): boolean {
  if (o.kind === "disc") {
    const dx = Math.max(bx.minX - o.c.x, 0, o.c.x - bx.maxX);
    const dy = Math.max(bx.minY - o.c.y, 0, o.c.y - bx.maxY);
    return dx * dx + dy * dy < o.r * o.r;
  }
  const vs = o.vs;
  if (Math.max(...vs.map((v) => v.x)) <= bx.minX || Math.min(...vs.map((v) => v.x)) >= bx.maxX) return false;
  if (Math.max(...vs.map((v) => v.y)) <= bx.minY || Math.min(...vs.map((v) => v.y)) >= bx.maxY) return false;
  const corners = [
    { x: bx.minX, y: bx.minY },
    { x: bx.maxX, y: bx.minY },
    { x: bx.maxX, y: bx.maxY },
    { x: bx.minX, y: bx.maxY },
  ];
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i];
    const e = sub(vs[(i + 1) % vs.length], a);
    const n = { x: e.y, y: -e.x }; // outward for counter-clockwise
    if (corners.every((c) => dot(sub(c, a), n) >= 0)) return false;
  }
  return true;
}

/**
 * The mass of each parcel a chamber held as one volume releases: the injector's own, or heavier if
 * it would pass the world's parcel rate. Only chambers: their thrust is the jet's recoil, whatever the
 * parcel size. Injectors without one (FLY's engines, a gun's breech) keep their own parcels.
 */
export function parcelMassOf(world: World, inj: { parcelMass: number; rate: number }): number {
  const r = world.gas.parcelRate;
  return r ? Math.max(inj.parcelMass, inj.rate / r) : inj.parcelMass;
}

/** Can this injector hold its chamber gas as a vessel at all? */
export function canHold(b: Body): boolean {
  return !!b.injector?.chamber && !b.magazine && !b.fixed && b.integrity > 0;
}

/** The chamber of injector body `b` at the current geometry, or null if it has none. Cached by geometry. */
export function vesselShape(world: World, b: Body, roots = assemblyRoots(world)): VesselShape | null {
  if (!canHold(b)) return null;
  let memo = perStep.get(world);
  if (!memo || memo.tick !== world.tick) {
    memo = { tick: world.tick, shapes: new Map() };
    perStep.set(world, memo);
  }
  if (memo.shapes.has(b.id)) return memo.shapes.get(b.id)!;
  // Checking the topology walks every body and weld: once a step, not once per engine.
  memo.topo ??= topologyToken(world);
  const shape = vesselShapeNow(world, b, roots, memo.topo);
  memo.shapes.set(b.id, shape);
  return shape;
}

// A quick check that nothing the shape depends on has been replaced since last time: the objects
// themselves (edits replace them), not their contents. While the weld topology is unchanged, body i
// and weld i are the same as last time, so it compares by index with no search and no string.
interface LastShape {
  topo: object;
  refs: object[]; // outlet, direction, chamber, then each member's shape, then each weld and its anchors
  memberIdx: number[];
  weldIdx: number[];
  angles: number[];
  shape: VesselShape | null;
}
const lastShape = new WeakMap<Body, LastShape>();

function unchanged(world: World, b: Body, last: LastShape, topo: object): boolean {
  if (last.topo !== topo) return false;
  const inj = b.injector!;
  const r = last.refs;
  if (r[0] !== inj.outlet || r[1] !== inj.direction || r[2] !== inj.chamber) return false;
  let k = 3;
  for (const i of last.memberIdx) if (world.bodies[i].shape !== r[k++]) return false;
  for (let n = 0; n < last.weldIdx.length; n++) {
    const j = world.joints[last.weldIdx[n]];
    if (j.anchorA !== r[k++] || j.anchorB !== r[k++] || j.referenceAngle !== last.angles[n]) return false;
  }
  return true;
}

function vesselShapeNow(world: World, b: Body, roots: ReadonlyMap<string, string>, topo: object): VesselShape | null {
  const f = frameOf(b);
  if (!f) return null;
  const last = lastShape.get(b);
  if (last && unchanged(world, b, last, topo)) return last.shape;
  const r = roots.get(b.id) ?? b.id;
  const memberIdx: number[] = [];
  world.bodies.forEach((x, i) => {
    if ((roots.get(x.id) ?? x.id) === r) memberIdx.push(i);
  });
  const members = memberIdx.map((i) => world.bodies[i]);
  const inj = b.injector!;
  const ids = new Set(members.map((m) => m.id));
  const weldIdx: number[] = [];
  world.joints.forEach((j, i) => {
    if (ids.has(j.a) && ids.has(j.b)) weldIdx.push(i);
  });
  const welds = weldIdx.map((i) => world.joints[i]);
  const refs: object[] = [inj.outlet, inj.direction, inj.chamber!, ...members.map((m) => m.shape), ...welds.flatMap((j) => [j.anchorA, j.anchorB])];
  const shape = shapeFor(b, f, members, world);
  lastShape.set(b, { topo, refs, memberIdx, weldIdx, angles: welds.map((j) => j.referenceAngle), shape });
  return shape;
}

function shapeFor(b: Body, f: Frame, members: Body[], world: World): VesselShape | null {
  const inj = b.injector!;
  const poses = restPoses(world, b, members);
  const key = JSON.stringify([inj.outlet, inj.direction, inj.chamber, members.map((m) => [m.id, poses.get(m.id), m.shape])]);
  if (shapeCache.has(key)) return shapeCache.get(key)!;
  const shape = computeShape(b, f, members, poses);
  if (shapeCache.size > 500) shapeCache.clear();
  shapeCache.set(key, shape);
  return shape;
}

function computeShape(b: Body, f: Frame, members: Body[], poses: Map<string, { p: Vec2; angle: number }>): VesselShape | null {
  const ch = b.injector!.chamber!;
  const W = ch.width;
  const L = ch.length;
  const margin = 0.25 * W;
  const h = W / CELLS_ACROSS;
  const u0 = -W / 2 - margin;
  const s0 = -margin;
  const nu = Math.ceil((W + 2 * margin) / h);
  const ns = Math.ceil((L + margin) / h);
  const outlines = members.map((m) => ({ id: m.id, o: outlineAt(poses.get(m.id)!.p, poses.get(m.id)!.angle, m.shape) }));
  const solidBy = new Int32Array(nu * ns).fill(-1);
  for (let j = 0; j < ns; j++)
    for (let i = 0; i < nu; i++) {
      const p = at(f, s0 + (j + 0.5) * h, u0 + (i + 0.5) * h);
      for (let k = 0; k < outlines.length; k++)
        if (contains(outlines[k].o, p)) {
          solidBy[j * nu + i] = k;
          break;
        }
    }
  // The throat: the deepest of the narrowest cross-sections downstream of the outlet.
  const jStart = Math.floor(margin / h);
  let minCount = Infinity;
  let T = -1;
  for (let j = jStart + 1; j < ns; j++) {
    let count = 0;
    for (let i = 0; i < nu; i++) if (Math.abs(u0 + (i + 0.5) * h) <= W / 2 && solidBy[j * nu + i] < 0) count++;
    if (count === 0) continue;
    if (count <= minCount) {
      minCount = count;
      T = j;
    }
  }
  if (T < 0 || T >= ns - 1) return null;
  // Flood the free space from the outlet, up to the throat row.
  let start = -1;
  const ic = Math.floor(nu / 2);
  for (let d = 0; d < nu && start < 0; d++)
    for (const i of [ic - d, ic + d])
      if (i >= 0 && i < nu && solidBy[jStart * nu + i] < 0) {
        start = jStart * nu + i;
        break;
      }
  if (start < 0) return null;
  const inside = new Uint8Array(nu * ns);
  const stack = [start];
  inside[start] = 1;
  let sealed = true;
  let cells = 0;
  while (stack.length) {
    const c = stack.pop()!;
    cells++;
    const i = c % nu;
    const j = (c - i) / nu;
    if (i === 0 || i === nu - 1 || j === 0) sealed = false;
    const next = [i > 0 ? c - 1 : -1, i < nu - 1 ? c + 1 : -1, j > 0 ? c - nu : -1, j < T ? c + nu : -1];
    for (const n of next) {
      if (n < 0 || inside[n] || solidBy[n] >= 0) continue;
      inside[n] = 1;
      stack.push(n);
    }
  }
  // Pressure loads: on each wall cell face that borders the chamber; the opening is across the throat row.
  const force = new Map<string, { fx: number; fy: number; m: number }>();
  const push = (id: string, dx: number, dy: number, p: Vec2) => {
    const e = force.get(id) ?? { fx: 0, fy: 0, m: 0 };
    e.fx += dx;
    e.fy += dy;
    e.m += p.x * dy - p.y * dx;
    force.set(id, e);
  };
  let openFrom = Infinity;
  let openTo = -Infinity;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let sLo = Infinity;
  let sHi = -Infinity;
  let uLo = Infinity;
  let uHi = -Infinity;
  for (let j = 0; j <= T; j++)
    for (let i = 0; i < nu; i++) {
      const c = j * nu + i;
      if (!inside[c]) continue;
      const s = s0 + (j + 0.5) * h;
      const u = u0 + (i + 0.5) * h;
      sLo = Math.min(sLo, s - 0.5 * h);
      sHi = Math.max(sHi, s + 0.5 * h);
      uLo = Math.min(uLo, u - 0.5 * h);
      uHi = Math.max(uHi, u + 0.5 * h);
      for (const [di, dj] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || ni >= nu || nj < 0 || nj >= ns) continue;
        const n = nj * nu + ni;
        const dir = add(scale(f.dir, dj), scale(f.perp, di)); // engine frame, from the chamber outwards
        const mid = at(f, s + 0.5 * h * dj, u + 0.5 * h * di);
        if (solidBy[n] >= 0) push(members[solidBy[n]].id, dir.x * h, dir.y * h, mid);
        else if (nj === T + 1 && dj === 1) {
          push(b.id, dir.x * h, dir.y * h, mid); // the plug
          openFrom = Math.min(openFrom, u - 0.5 * h);
          openTo = Math.max(openTo, u + 0.5 * h);
        }
      }
      const corners = [at(f, s - 0.5 * h, u - 0.5 * h), at(f, s + 0.5 * h, u + 0.5 * h)];
      for (const p of corners) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
  return {
    sealed,
    area: cells * h * h,
    throat: s0 + (T + 1) * h,
    openFrom,
    openTo,
    loads: [...force].map(([id, e]) => ({ id, ...e })),
    h,
    u0,
    s0,
    nu,
    ns,
    inside,
    box: { minX, minY, maxX, maxY },
    outline: [at(f, sLo, uLo), at(f, sLo, uHi), at(f, sHi, uHi), at(f, sHi, uLo)],
  };
}

/**
 * Where every body is, for holdingShape: a grid of cells, each listing the bodies whose bounding
 * circle reaches it, so each engine looks only at bodies near it rather than at all of them. Build
 * one where the bodies stand still for a run of holdingShape calls (it reads positions once).
 */
export interface BodyIndex {
  grid: Map<number, number[]>;
  big: number[]; // bodies too large to file cell by cell, checked by every query
  r: Float64Array;
  stamp: Int32Array;
  query: number;
}
const INDEX_CELL = 2; // m
const INDEX_MAX_CELLS = 64; // a body over more cells than this goes in `big`
const cellKey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
const cellOf = (v: number) => Math.max(-32767, Math.min(32767, Math.floor(v / INDEX_CELL)));

export function bodyIndex(world: World): BodyIndex {
  const n = world.bodies.length;
  const grid = new Map<number, number[]>();
  const big: number[] = [];
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const o = world.bodies[i];
    const ro = reach(o.shape);
    r[i] = ro;
    const x0 = cellOf(o.position.x - ro);
    const x1 = cellOf(o.position.x + ro);
    const y0 = cellOf(o.position.y - ro);
    const y1 = cellOf(o.position.y + ro);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > INDEX_MAX_CELLS) {
      big.push(i);
      continue;
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = cellKey(cx, cy);
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  }
  return { grid, big, r, stamp: new Int32Array(n), query: 0 };
}

/** The vessel's shape, if it holds its gas now: enclosed, and nothing else inside it. */
export function holdingShape(world: World, b: Body, roots: ReadonlyMap<string, string>, index?: BodyIndex): VesselShape | null {
  const shape = vesselShape(world, b, roots);
  if (!shape || !shape.sealed) return null;
  const r = roots.get(b.id) ?? b.id;
  const R = boxReach(shape.box);
  // Does body o sit inside the chamber? (Which order bodies are tried in can't change the answer.)
  const blocks = (o: Body, ro: number): boolean => {
    const dx = o.position.x - b.position.x;
    const dy = o.position.y - b.position.y;
    const rr = ro + R;
    if (dx * dx + dy * dy >= rr * rr) return false;
    if ((roots.get(o.id) ?? o.id) === r) return false;
    return overlapsBox(outlineIn(b, o), shape.box);
  };
  if (!index) {
    for (const o of world.bodies) if (blocks(o, reach(o.shape))) return null;
    return shape;
  }
  const q = ++index.query;
  const seen = index.stamp;
  for (const i of index.big) {
    seen[i] = q;
    if (blocks(world.bodies[i], index.r[i])) return null;
  }
  const x0 = cellOf(b.position.x - R);
  const x1 = cellOf(b.position.x + R);
  const y0 = cellOf(b.position.y - R);
  const y1 = cellOf(b.position.y + R);
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) {
      const list = index.grid.get(cellKey(cx, cy));
      if (!list) continue;
      for (const i of list) {
        if (seen[i] === q) continue;
        seen[i] = q;
        if (blocks(world.bodies[i], index.r[i])) return null;
      }
    }
  return shape;
}

/** Is engine-frame point p inside the chamber? */
function insideChamber(shape: VesselShape, b: Body, p: Vec2): boolean {
  const f = frameOf(b)!;
  const d = sub(p, f.outlet);
  const s = dot(d, f.dir);
  const u = dot(d, f.perp);
  const i = Math.floor((u - shape.u0) / shape.h);
  const j = Math.floor((s - shape.s0) / shape.h);
  return i >= 0 && i < shape.nu && j >= 0 && j < shape.ns && shape.inside[j * shape.nu + i] === 1;
}

/** The vessel's pressure, N/m (a 2D pressure, as the parcels'). */
export function vesselPressure(v: Vessel, area: number): number {
  if (!(v.mass > 0) || !(area > 0)) return 0;
  const g = mixture(v.composition).gamma;
  return ((g - 1) * v.thermal) / area;
}

const kineticOf = (b: Body): number => {
  const m = bodyMass(b);
  return 0.5 * m * (b.velocity.x ** 2 + b.velocity.y ** 2) + 0.5 * massProps(b.shape, m).inertia * b.angularVelocity ** 2;
};

/**
 * Releases `dm` kg of the vessel's gas as a parcel at world point `point` with velocity `vParcel` and
 * thermal energy `thermal` (J). The body recoils so momentum is unchanged; the vessel pays the parcel's
 * thermal energy and whatever kinetic energy the release gained, so energy is unchanged.
 */
function release(world: World, b: Body, dm: number, thermal: number, point: Vec2, vParcel: Vec2, radius: number): Parcel {
  const v = b.injector!.vessel!;
  const r = sub(point, b.position);
  const before = kineticOf(b);
  v.mass -= dm;
  const J = { x: -dm * (vParcel.x - b.velocity.x), y: -dm * (vParcel.y - b.velocity.y) };
  const m1 = bodyMass(b);
  const I1 = massProps(b.shape, m1).inertia;
  b.velocity = add(b.velocity, scale(J, 1 / m1));
  b.angularVelocity += cross(r, J) / I1;
  // The mass moved with the body before; its kinetic energy then was part of `before`.
  const after = kineticOf(b) + 0.5 * dm * (vParcel.x ** 2 + vParcel.y ** 2);
  v.thermal -= thermal + (after - before);
  return {
    id: world.gas.nextId++,
    mass: dm,
    composition: { ...v.composition },
    position: point,
    velocity: vParcel,
    thermal,
    radius,
  };
}

/** Takes a parcel into the vessel: its mass, momentum and energy join the engine body. */
function absorb(b: Body, p: Parcel): void {
  const v = b.injector!.vessel!;
  const before = kineticOf(b) + 0.5 * p.mass * (p.velocity.x ** 2 + p.velocity.y ** 2);
  const m0 = bodyMass(b);
  const I0 = massProps(b.shape, m0).inertia;
  const r = sub(p.position, b.position);
  // Mix compositions by mass.
  const total = v.mass + p.mass;
  const comp: Record<string, number> = {};
  for (const [k, y] of Object.entries(v.composition)) comp[k] = (comp[k] ?? 0) + (y * v.mass) / total;
  for (const [k, y] of Object.entries(p.composition)) comp[k] = (comp[k] ?? 0) + (y * p.mass) / total;
  v.composition = comp;
  v.mass = total;
  // Momentum and angular momentum: the parcel's join the body's (its mass now sits at the centre).
  const m1 = bodyMass(b);
  const I1 = massProps(b.shape, m1).inertia;
  b.velocity = { x: (m0 * b.velocity.x + p.mass * p.velocity.x) / m1, y: (m0 * b.velocity.y + p.mass * p.velocity.y) / m1 };
  b.angularVelocity = (I0 * b.angularVelocity + p.mass * cross(r, p.velocity)) / I1;
  v.thermal += p.thermal + before - kineticOf(b);
}

/** Per-step work of one injector's vessel: take in propellant, burn it, let it out. Returns released parcels. */
export function runVessel(world: World, b: Body, shape: VesselShape, drawn: { mass: number; composition: Record<string, number>; thermal: number } | null, dt: number, limit: number): Parcel[] {
  const inj = b.injector!;
  const v = (inj.vessel ??= { mass: 0, thermal: 0, composition: {}, throat: shape.throat, credit: 0, count: 0 });
  v.throat = shape.throat;
  const gs = world.gas.scale ?? 1;
  // Stray parcels inside the chamber join it (gas that was there when it closed).
  const f = frameOf(b)!;
  const q = f.q;
  const R = boxReach(shape.box);
  let strays: Parcel[] | null = null;
  for (const p of world.gas.parcels) {
    const dx = p.position.x - b.position.x;
    const dy = p.position.y - b.position.y;
    if (dx * dx + dy * dy > R * R) continue;
    if (insideChamber(shape, b, invRotate(q, { x: dx, y: dy }))) (strays ??= []).push(p);
  }
  if (strays) {
    for (const p of strays) absorb(b, p);
    const gone = new Set(strays);
    world.gas.parcels = world.gas.parcels.filter((p) => !gone.has(p));
  }
  if (drawn && drawn.mass > 0) {
    const total = v.mass + drawn.mass;
    const comp: Record<string, number> = {};
    for (const [k, y] of Object.entries(v.composition)) comp[k] = (comp[k] ?? 0) + (y * v.mass) / total;
    for (const [k, y] of Object.entries(drawn.composition)) comp[k] = (comp[k] ?? 0) + (y * drawn.mass) / total;
    v.composition = comp;
    v.mass = total;
    v.thermal += drawn.thermal;
    if (inj.igniter) burn(v as unknown as Parcel, gs);
  }
  // Choked outflow through the opening, integrated over the step in a few parts.
  const out: Parcel[] = [];
  const W = shape.openTo - shape.openFrom;
  if (!(W > 0) || !(v.mass > 0)) return out;
  const g = mixture(v.composition).gamma;
  const starT = 2 / (g + 1); // T*/T0
  const starRho = powPos(starT, 1 / (g - 1)); // ρ*/ρ0
  let M = v.mass;
  let U = v.thermal;
  const PARTS = 8;
  for (let k = 0; k < PARTS; k++) {
    const u = Math.max(0, U / M);
    const cStar = Math.sqrt(g * (g - 1) * u * starT);
    const dm = Math.min(0.5 * M, (M / shape.area) * starRho * cStar * W * (dt / PARTS));
    M -= dm;
    U -= g * u * starT * dm + 0.5 * cStar * cStar * dm;
    v.credit += dm;
  }
  const GOLDEN = 0.6180339887498949;
  const pm = parcelMassOf(world, inj);
  while (v.credit >= pm && v.mass > pm && world.gas.parcels.length + out.length < limit) {
    const dm = pm;
    const u = Math.max(0, v.thermal / v.mass);
    const uStar = u * starT;
    const cStar = Math.sqrt(g * (g - 1) * uStar);
    const frac = (((v.count + 0.5) * GOLDEN) % 1);
    const across = shape.openFrom + (0.15 + 0.7 * frac) * W;
    const local = at(f, shape.throat + inj.radius, across);
    const point = add(b.position, rotate(q, local));
    const r = sub(point, b.position);
    const vPoint = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
    // The jet leaves at c*·(1 + 1/γ): its momentum flux ṁ·c* plus the throat's pressure P*·A* =
    // ṁ·c*/γ, so the recoil gives the choked throat's whole thrust. The throat pressure pushed back
    // on the plug only through the parcels just released, and at the game's detail they were too
    // sparse to carry it (about 40% of it, docs/perf/gpu-gas-phase0.md §15). Each kilogram still
    // carries the throat's stagnation enthalpy, γ·u* + c*²/2, as heat plus motion.
    const vOut = cStar * (1 + 1 / g);
    const vParcel = add(vPoint, scale(rotate(q, f.dir), vOut));
    const p = release(world, b, dm, dm * (g * uStar + 0.5 * cStar * cStar - 0.5 * vOut * vOut), point, vParcel, inj.radius);
    out.push(p);
    v.credit -= dm;
    v.count++;
  }
  v.credit = Math.min(v.credit, pm);
  return out;
}

/** Releases all of a vessel's gas as parcels spread over where the chamber was (it is no longer enclosed). */
export function spill(world: World, b: Body): Parcel[] {
  const inj = b.injector!;
  const v = inj.vessel;
  const out: Parcel[] = [];
  if (!v) return out;
  const f = frameOf(b);
  if (!f || !(v.mass > 0)) {
    inj.vessel = undefined;
    return out;
  }
  const W = inj.chamber!.width;
  const h = 2 * inj.radius;
  const others = world.bodies.filter((o) => o !== b).map((o) => outlineIn(b, o));
  const self = outlineIn(b, b);
  const spots: Vec2[] = [];
  for (let s = 0.5 * h; s < v.throat; s += h)
    for (let u = -W / 2 + 0.5 * h; u < W / 2; u += h) {
      const p = at(f, s, u);
      if (!contains(self, p) && !others.some((o) => contains(o, p))) spots.push(p);
    }
  if (!spots.length) spots.push(at(f, 0, 0));
  const n = Math.max(1, Math.min(spots.length, Math.round(v.mass / parcelMassOf(world, inj))));
  const step = spots.length / n;
  const q = f.q;
  for (let k = 0; k < n; k++) {
    const local = spots[Math.floor(k * step)];
    const point = add(b.position, rotate(q, local));
    const r = sub(point, b.position);
    const vPoint = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
    const dm = k === n - 1 ? v.mass : v.mass / (n - k);
    const thermal = k === n - 1 ? 0 : (v.thermal * dm) / v.mass;
    const p = release(world, b, dm, thermal, point, vPoint, inj.radius);
    out.push(p);
  }
  // The last parcel takes whatever thermal energy is left, so the total is exact.
  const last = out[out.length - 1];
  last.thermal = Math.max(0, v.thermal);
  inj.vessel = undefined;
  return out;
}

/** The plug across a holding vessel's throat: a thin wall moving with the engine, for the gas step. */
export function plugWall(b: Body, shape: VesselShape): WallBody | null {
  const W = shape.openTo - shape.openFrom;
  if (!(W > 0)) return null;
  const f = frameOf(b)!;
  const t = shape.h * 2;
  const cLocal = at(f, shape.throat - t / 2, (shape.openFrom + shape.openTo) / 2);
  const corners = [
    add(scale(f.perp, -W / 2), scale(f.dir, -t / 2)),
    add(scale(f.perp, W / 2), scale(f.dir, -t / 2)),
    add(scale(f.perp, W / 2), scale(f.dir, t / 2)),
    add(scale(f.perp, -W / 2), scale(f.dir, t / 2)),
  ];
  const area = corners.reduce((s, p, i) => s + cross(p, corners[(i + 1) % 4]), 0);
  const vertices = area > 0 ? corners : [...corners].reverse();
  const q = f.q;
  const r = rotate(q, cLocal);
  return {
    id: `${b.id}#plug`,
    shape: { kind: "polygon", vertices },
    fixed: false,
    mass: 0,
    inertia: 0,
    position: add(b.position, r),
    angle: b.angle,
    velocity: add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x }),
    angularVelocity: b.angularVelocity,
  };
}

/** The vessel's push on its walls over dt, as impulses on each body (world frame, angular about its centre). */
export function wallLoads(world: World, b: Body, shape: VesselShape, dt: number): Map<string, { x: number; y: number; angular: number }> {
  const out = new Map<string, { x: number; y: number; angular: number }>();
  const v = b.injector!.vessel;
  if (!v) return out;
  const P = vesselPressure(v, shape.area);
  if (!(P > 0)) return out;
  const q = sinCos(b.angle);
  const byId = new Map(world.bodies.map((x) => [x.id, x]));
  for (const l of shape.loads) {
    const body = byId.get(l.id);
    if (!body) continue;
    const F = rotate(q, { x: l.fx, y: l.fy });
    // Moment about the engine's centre, moved to this body's centre.
    const rel = sub(body.position, b.position);
    const angular = l.m - cross(rel, F);
    out.set(l.id, { x: P * dt * F.x, y: P * dt * F.y, angular: P * dt * angular });
  }
  return out;
}
