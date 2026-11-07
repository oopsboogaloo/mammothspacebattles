// Smooth motion on screen. The worker hands over the world in bunches (every 30 ms or so, later when
// a step is slow), so drawing the latest world as it comes moves things in uneven jumps. Instead
// the page keeps its own clock that runs at the simulation's pace, and draws the latest world moved
// on (or back) to that time by each thing's velocity. Only drawing changes: the world is untouched.
import type { World } from "../core/world.ts";

/** How fast the shown time closes on the latest world's time, s (real). */
const PULL_S = 0.15;
/** The furthest the shown time may stray from the latest world's, s (game): beyond it, it snaps. */
export const MAX_LEAD_S = 0.1;

/** The game time the screen shows now (set by the view each frame). */
export const shown = { time: 0 };

/** The next shown time: on at `rate` game seconds a real second, pulled towards `latest`. */
export function nextShownTime(shown: number, latest: number, realDt: number, rate: number): number {
  let t = shown + realDt * rate;
  t += (latest - t) * (1 - Math.exp(-realDt / PULL_S));
  // Far off means a different run (a reset, another scenario): start from it.
  if (Math.abs(latest - t) > 1) return latest;
  return Math.min(latest + MAX_LEAD_S, Math.max(latest - MAX_LEAD_S, t));
}

const sources = new WeakMap<World, World>();
/** The world a moved-on copy was made from (itself if none): what per-step caches know. */
export const sourceOf = (w: World): World => sources.get(w) ?? w;

/** The world as it would look `dt` game seconds on: what moves carried on by its velocity. */
export function extrapolate(world: World, dt: number): World {
  if (Math.abs(dt) < 1e-6) return world;
  const on = <T extends { position: { x: number; y: number }; velocity: { x: number; y: number } }>(p: T): T => ({
    ...p,
    position: { x: p.position.x + p.velocity.x * dt, y: p.position.y + p.velocity.y * dt },
  });
  const shown: World = {
    ...world,
    bodies: world.bodies.map((b) => (b.fixed ? b : { ...on(b), angle: b.angle + b.angularVelocity * dt })),
    gas: { ...world.gas, parcels: world.gas.parcels.map(on) },
    wisps: world.wisps?.map(on),
    dust: world.dust?.map(on),
  };
  sources.set(shown, world);
  return shown;
}
