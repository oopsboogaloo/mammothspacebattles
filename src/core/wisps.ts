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
import { collideDisc, worldPolygon, type Placed, type WorldPoly } from "./collide.ts";
import { boundingRadiusOf, massProps } from "./shapes.ts";
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
  /** How long it lasts, s, where that is not `WISP_LIFE` (Mammoth Asteroids). */
  life?: number;
}

/** How long a wisp lasts, s. */
export const WISP_LIFE = 1;
/**
 * How long a wisp lasts in Mammoth Asteroids' wrapped arena, s. A ship's exhaust leaves it at about
 * 200 m/s, so a 1 s tail crossed most of the 160 m arena: a ship thrusting up through the top edge
 * came back in at the bottom as the tail it had left behind arrived there, 0.7 to 0.9 s old, and
 * was pushed round by it (0.6 rad/s). At this life the tail is gone before the ship can meet it.
 */
export const WISP_LIFE_ARCADE = 0.4;
/** How much a wisp grows by the time it fades out. */
export const WISP_GROW = 3;
/** Most wisps at once; the oldest go first. */
export const WISP_LIMIT = 8000;
/** How much of its speed into a surface a wisp keeps when it bounces. */
const RESTITUTION = 0.3;

/** How far through its life a wisp is, 0–1. */
export const wispFade = (w: Wisp): number => Math.min(1, w.age / (w.life ?? WISP_LIFE));
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
    const wisp: Wisp = { position: { ...p.position }, velocity: { ...p.velocity }, mass: p.mass, radius: p.radius, age: 0, temperature: temperature(p) };
    if (world.arcade) wisp.life = WISP_LIFE_ARCADE;
    list.push(wisp);
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

/**
 * Big bodies get a coarser grid of their own once there are this many: a lander's rock is a hundred
 * big parts, and testing every wisp against every one was a quarter of the whole step.
 */
const BIG_CELL = 16;
const BIG_GRID_FROM = 8;
/** Added to a big body's reach when it is filed, m: far more than rounding in the distance test can be. */
const BIG_PAD = 1e-3;

/** Files a body's bounding circle into `cells` by its index. */
function file(cells: Map<number, number[]>, b: Body, i: number, r: number, CELL = 4): void {
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
    const r = boundingRadiusOf(b.shape);
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
 * velocities), and drops those that have faded out. Returns how many bounced. `bigGrid` false tests
 * every wisp against every big body, as before the big bodies had a grid: the same results, slower
 * (for the test that they are the same).
 */
export function stepWisps(world: World, dt: number, bigGrid = true): number {
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
    const r = boundingRadiusOf(b.shape);
    reach[i] = r;
    if (r > 4 * CELL) bigMoving.push(i);
    else file(moving, b, i, r);
  }
  const big = merge(fixed.big, bigMoving);
  // Many big bodies: filed by the cells their reach, plus the largest wisp's radius, covers, in
  // order. A wisp then meets only the big bodies of its cell, which are all it could touch: the same
  // bodies in the same order as testing every one.
  let bigCells: Map<number, number[]> | null = null;
  if (bigGrid && big.length >= BIG_GRID_FROM) {
    let rmax = 0;
    for (const w of list) rmax = Math.max(rmax, w.radius);
    rmax *= WISP_GROW;
    bigCells = new Map();
    for (const i of big) file(bigCells, bodies[i], i, reach[i] + rmax + BIG_PAD, BIG_CELL);
  }
  const bigKey = (p: Vec2) => cellKey(Math.floor(p.x / BIG_CELL), Math.floor(p.y / BIG_CELL));
  let bounces = 0;
  /** Bounces wisp w (mass m, radius r) off body b if it has run into it. */
  // Each body as placed this step, and its outline in world coordinates, worked out once when a wisp
  // first comes near it and shared by every wisp after (wisps change bodies' velocities, not where they are).
  const placed: (Placed | undefined)[] = [];
  const outline: (WorldPoly | undefined)[] = [];
  const touch = (w: Wisp, m: number, r: number, i: number): void => {
    const b = bodies[i];
    const dx = w.position.x - b.position.x;
    const dy = w.position.y - b.position.y;
    const R = reach[i] + r;
    if (dx * dx + dy * dy > R * R) return;
    const at = (placed[i] ??= { shape: b.shape, position: b.position, rot: sinCos(b.angle) });
    if (b.shape.kind !== "disc") outline[i] ??= worldPolygon(at);
    const hit = collideDisc({ shape: { kind: "disc", radius: r }, position: w.position, rot: { c: 1, s: 0 } }, at, 0, outline[i]);
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
    if (w.age >= (w.life ?? WISP_LIFE)) continue;
    // In place, the same arithmetic as before: a wisp's vectors are its own (spawnWisps copies them),
    // and a thousand wisps made two new objects each, every step.
    w.velocity.x = w.velocity.x + g.x * dt;
    w.velocity.y = w.velocity.y + g.y * dt;
    w.position.x = w.position.x + w.velocity.x * dt;
    w.position.y = w.position.y + w.velocity.y * dt;
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
    if (!bigCells) for (const i of big) touch(w, m, r, i);
    else {
      let near = bigCells.get(bigKey(w.position));
      let at = 0;
      while (near && at < near.length) {
        const i = near[at++];
        const before = w.position;
        touch(w, m, r, i);
        if (w.position !== before) {
          // Pushed out of a body: carry on with the big bodies of the cell it is in now, after i.
          near = bigCells.get(bigKey(w.position));
          at = 0;
          if (near) while (at < near.length && near[at] <= i) at++;
        }
      }
    }
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
