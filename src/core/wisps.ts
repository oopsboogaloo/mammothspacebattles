// The plume's tail: gas that leaves the gas model (spreading out of the plane, or far from
// everything) carries on as simple particles, "wisps", that fade out over a second (GAS-011).
//
// A wisp moves in a straight line under the uniform field, grows as it fades, and bounces off
// solid bodies. Its mass fades with it, so it pushes less and less. The gas it came from has
// already left the world's books (the ledger's `boundary`), so a wisp is outside them too: what
// it gives a body when it bounces comes in from outside, and is recorded as `boundary` by the
// step. Deterministic: no random draws, a fixed order.

import { add, cross, dot, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { bodyMass } from "./bodies.ts";
import { collide } from "./collide.ts";
import { massProps } from "./shapes.ts";
import type { Parcel } from "./gas.ts";
import type { Body, World } from "./world.ts";

export interface Wisp {
  position: Vec2;
  velocity: Vec2;
  /** Mass when it left the gas, kg; it fades to nothing over `WISP_LIFE`. */
  mass: number;
  /** Radius when it left the gas, m; it grows to `WISP_GROW` times that. */
  radius: number;
  /** Seconds since it left the gas. */
  age: number;
  /** Its temperature when it left the gas, K (for its colour). */
  temperature: number;
}

/** How long a wisp lasts, s. */
export const WISP_LIFE = 1;
/** How much a wisp grows by the time it fades out. */
export const WISP_GROW = 3;
/** Most wisps at once; the oldest go first. */
export const WISP_LIMIT = 8000;
/** How much of its speed into a surface a wisp keeps when it bounces. */
const RESTITUTION = 0.3;

/** How far through its life a wisp is, 0–1. */
export const wispFade = (w: Wisp): number => Math.min(1, w.age / WISP_LIFE);
export const wispMass = (w: Wisp): number => w.mass * (1 - wispFade(w));
export const wispRadius = (w: Wisp): number => w.radius * (1 + (WISP_GROW - 1) * wispFade(w));

/** Turns gas that left the gas model, but not the world, into wisps. */
export function spawnWisps(world: World, gone: readonly Parcel[], temperature: (p: Parcel) => number): void {
  if (!gone.length) return;
  const b = world.bounds;
  const list = (world.wisps ??= []);
  for (const p of gone) {
    const inside = b.wrap || (p.position.x >= b.min.x && p.position.x <= b.max.x && p.position.y >= b.min.y && p.position.y <= b.max.y);
    if (!inside) continue;
    list.push({ position: { ...p.position }, velocity: { ...p.velocity }, mass: p.mass, radius: p.radius, age: 0, temperature: temperature(p) });
  }
  if (list.length > WISP_LIMIT) list.splice(0, list.length - WISP_LIMIT);
}

/**
 * Moves every wisp for one step, bounces it off the bodies it meets (changing only their
 * velocities), and drops those that have faded out. Returns how many bounced.
 */
/** Grid cell size for finding the bodies near a wisp, m. A body reaching over 4 cells is "big": checked against every wisp. */
const CELL = 4;
const cellKey = (cx: number, cy: number) => (cx + 1048576) * 2097152 + (cy + 1048576);

/**
 * The fixed bodies' grid cells, kept between steps while they stay as they were. A lander's ground
 * is hundreds of fixed bodies, and filing them all into the grid every step was most of the memory
 * a step churned through (an iPad paused for half a second now and then to clear it up).
 */
interface FixedGrid {
  bodies: Body[];
  index: number[];
  x: number[];
  y: number[];
  angle: number[];
  shape: Body["shape"][];
  /** Each cell's fixed bodies, by their index in the world's list, in order. */
  cells: Map<number, number[]>;
  /** Big fixed bodies, by index, in order. */
  big: number[];
  /** Every body's reach (bounding radius), by index; the fixed ones' are kept. */
  reach: number[];
}
const fixedGrids = new WeakMap<World, FixedGrid>();

/** Files a body's bounding circle into `cells` by its index. */
function file(cells: Map<number, number[]>, b: Body, i: number, r: number): void {
  const x0 = Math.floor((b.position.x - r) / CELL);
  const x1 = Math.floor((b.position.x + r) / CELL);
  const y0 = Math.floor((b.position.y - r) / CELL);
  const y1 = Math.floor((b.position.y + r) / CELL);
  for (let cx = x0; cx <= x1; cx++)
    for (let cy = y0; cy <= y1; cy++) {
      const k = cellKey(cx, cy);
      const list = cells.get(k);
      if (list) list.push(i);
      else cells.set(k, [i]);
    }
}

/** The world's fixed grid: the kept one if no fixed body has moved, changed or shifted in the list since. */
function fixedGrid(world: World): FixedGrid {
  const bodies = world.bodies;
  const kept = fixedGrids.get(world);
  if (kept) {
    let j = 0;
    let same = true;
    for (let i = 0; i < bodies.length && same; i++) {
      const b = bodies[i];
      if (!b.fixed) continue;
      same = j < kept.bodies.length && kept.bodies[j] === b && kept.index[j] === i && kept.x[j] === b.position.x && kept.y[j] === b.position.y && kept.angle[j] === b.angle && kept.shape[j] === b.shape;
      j++;
    }
    if (same && j === kept.bodies.length) return kept;
  }
  const g: FixedGrid = { bodies: [], index: [], x: [], y: [], angle: [], shape: [], cells: new Map(), big: [], reach: [] };
  bodies.forEach((b, i) => {
    if (!b.fixed) return;
    const r = massProps(b.shape, 1).boundingRadius;
    g.bodies.push(b);
    g.index.push(i);
    g.x.push(b.position.x);
    g.y.push(b.position.y);
    g.angle.push(b.angle);
    g.shape.push(b.shape);
    g.reach[i] = r;
    if (r > 4 * CELL) g.big.push(i);
    else file(g.cells, b, i, r);
  });
  fixedGrids.set(world, g);
  return g;
}

/**
 * Moves every wisp for one step, bounces it off the bodies it meets (changing only their
 * velocities), and drops those that have faded out. Returns how many bounced.
 */
export function stepWisps(world: World, dt: number): number {
  const list = world.wisps;
  if (!list?.length) return 0;
  const g = world.gravity;
  const bodies = world.bodies;
  // Bodies on a coarse grid by their bounding circles; big ones are checked against every wisp. The
  // fixed ones' cells are kept between steps; the moving ones are filed afresh. A wisp meets the
  // bodies of its cell in the world's order, then the big ones, also in order.
  const fixed = fixedGrid(world);
  const reach = fixed.reach;
  const moving = new Map<number, number[]>();
  const bigMoving: number[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i];
    if (b.fixed) continue;
    const r = massProps(b.shape, 1).boundingRadius;
    reach[i] = r;
    if (r > 4 * CELL) bigMoving.push(i);
    else file(moving, b, i, r);
  }
  const big = merge(fixed.big, bigMoving);
  let bounces = 0;
  /** Bounces wisp w (mass m, radius r) off body b if it has run into it. */
  const touch = (w: Wisp, m: number, r: number, i: number): void => {
    const b = bodies[i];
    const d = sub(w.position, b.position);
    const R = reach[i] + r;
    if (dot(d, d) > R * R) return;
    const hit = collide({ shape: { kind: "disc", radius: r }, position: w.position, rot: { c: 1, s: 0 } }, { shape: b.shape, position: b.position, rot: sinCos(b.angle) }, 0, 0);
    if (!hit || !hit.points.length) return;
    const pt = hit.points.reduce((a, c) => (c.separation < a.separation ? c : a));
    if (pt.separation >= 0) return;
    const n = hit.normal; // from the wisp into the body
    // Out of the body first, then the bounce.
    w.position = add(w.position, scale(n, pt.separation));
    const rb = sub(pt.point, b.position);
    const vb = b.fixed ? { x: 0, y: 0 } : add(b.velocity, { x: -b.angularVelocity * rb.y, y: b.angularVelocity * rb.x });
    const vn = dot(sub(w.velocity, vb), n); // > 0: moving into it
    if (vn <= 0) return;
    const mb = bodyMass(b);
    const invB = b.fixed ? 0 : 1 / mb;
    const ib = b.fixed ? 0 : massProps(b.shape, mb).inertia;
    const rn = cross(rb, n);
    const invI = ib > 0 ? (rn * rn) / ib : 0;
    const j = ((1 + RESTITUTION) * vn) / (1 / m + invB + invI);
    w.velocity = sub(w.velocity, scale(n, j / m));
    if (!b.fixed) {
      b.velocity = add(b.velocity, scale(n, j * invB));
      if (ib > 0) b.angularVelocity += (rn * j) / ib;
    }
    bounces += 1;
  };
  const kept: Wisp[] = [];
  for (const w of list) {
    w.age += dt;
    if (w.age >= WISP_LIFE) continue;
    w.velocity = { x: w.velocity.x + g.x * dt, y: w.velocity.y + g.y * dt };
    w.position = add(w.position, scale(w.velocity, dt));
    const m = wispMass(w);
    const r = wispRadius(w);
    const k = cellKey(Math.floor(w.position.x / CELL), Math.floor(w.position.y / CELL));
    const a = fixed.cells.get(k);
    const c = moving.get(k);
    // Each nearby body in the world's order (the two lists merged), then each big one.
    if (a && c) {
      let p = 0;
      let q = 0;
      while (p < a.length || q < c.length) touch(w, m, r, q >= c.length || (p < a.length && a[p] < c[q]) ? a[p++] : c[q++]);
    } else if (a) for (const i of a) touch(w, m, r, i);
    else if (c) for (const i of c) touch(w, m, r, i);
    for (const i of big) touch(w, m, r, i);
    kept.push(w);
  }
  world.wisps = kept;
  return bounces;
}

/** Two ascending lists as one. */
function merge(a: readonly number[], b: readonly number[]): number[] {
  if (!b.length) return a as number[];
  const out: number[] = [];
  let p = 0;
  let q = 0;
  while (p < a.length || q < b.length) out.push(q >= b.length || (p < a.length && a[p] < b[q]) ? a[p++] : b[q++]);
  return out;
}
