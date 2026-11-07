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
export function stepWisps(world: World, dt: number): number {
  const list = world.wisps;
  if (!list?.length) return 0;
  const g = world.gravity;
  // Bodies on a coarse grid by their bounding circles; big ones are checked against every wisp.
  const CELL = 4;
  const grid = new Map<number, Body[]>();
  const big: Body[] = [];
  const key = (cx: number, cy: number) => (cx + 1048576) * 2097152 + (cy + 1048576);
  for (const b of world.bodies) {
    const r = boundingRadiusOf(b.shape);
    if (r > 4 * CELL) {
      big.push(b);
      continue;
    }
    const x0 = Math.floor((b.position.x - r) / CELL);
    const x1 = Math.floor((b.position.x + r) / CELL);
    const y0 = Math.floor((b.position.y - r) / CELL);
    const y1 = Math.floor((b.position.y + r) / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const cellList = grid.get(k);
        if (cellList) cellList.push(b);
        else grid.set(k, [b]);
      }
  }
  let bounces = 0;
  const kept: Wisp[] = [];
  for (const w of list) {
    w.age += dt;
    if (w.age >= WISP_LIFE) continue;
    w.velocity = { x: w.velocity.x + g.x * dt, y: w.velocity.y + g.y * dt };
    w.position = { x: w.position.x + w.velocity.x * dt, y: w.position.y + w.velocity.y * dt };
    const m = wispMass(w);
    const r = wispRadius(w);
    const near = grid.get(key(Math.floor(w.position.x / CELL), Math.floor(w.position.y / CELL)));
    // The cell's bodies, then the big ones (without building a joined list for every wisp).
    const nNear = near ? near.length : 0;
    for (let q = 0; q < nNear + big.length; q++) {
      const b = q < nNear ? near![q] : big[q - nNear];
      const dx = w.position.x - b.position.x;
      const dy = w.position.y - b.position.y;
      const R = boundingRadiusOf(b.shape) + r;
      if (dx * dx + dy * dy > R * R) continue;
      const hit = collide({ shape: { kind: "disc", radius: r }, position: w.position, rot: { c: 1, s: 0 } }, { shape: b.shape, position: b.position, rot: sinCos(b.angle) }, 0, 0);
      if (!hit || !hit.points.length) continue;
      const pt = hit.points.reduce((a, c) => (c.separation < a.separation ? c : a));
      if (pt.separation >= 0) continue;
      const n = hit.normal; // from the wisp into the body
      // Out of the body first, then the bounce.
      w.position = add(w.position, scale(n, pt.separation));
      const rb = sub(pt.point, b.position);
      const vb = b.fixed ? { x: 0, y: 0 } : add(b.velocity, { x: -b.angularVelocity * rb.y, y: b.angularVelocity * rb.x });
      const vn = dot(sub(w.velocity, vb), n); // > 0: moving into it
      if (vn <= 0) continue;
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
    }
    kept.push(w);
  }
  world.wisps = kept;
  return bounces;
}
