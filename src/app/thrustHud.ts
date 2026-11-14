// Mammoth Thrust: what its page works out from the screen and the world (no drawing here).
import { plantCoolant, type Vec2, type World } from "../core/index.ts";

/** How much of the level the view shows from top to bottom, m: enough for the ship and a pod on its 12 m tether, with the ground round them. */
export const VIEW_HEIGHT = 90;
/** The view's zoom, px a metre, for a screen: `VIEW_HEIGHT` m tall, within what keeps the ship readable. */
export const zoomFor = (height: number): number => Math.min(12, Math.max(3.5, height / VIEW_HEIGHT));

/** The levels, in order: the scenario files `thrust-{n}`. */
export const LEVELS = 5;

/** What the HUD shows of the ship flying: its fuel (0–1), slugs left, and its worst-hit part or weld (0–1). */
export function shipStatus(world: World): { fuel: number; slugs: number; damage: number } {
  const game = world.thrust;
  if (!game) return { fuel: 0, slugs: 0, damage: 0 };
  const prefix = `p${game.state.n}-`;
  let fuel = 0;
  let capacity = 0;
  let damage = 0;
  let slugs = 0;
  const own = new Set<string>();
  for (const b of world.bodies) {
    if (!b.id.startsWith(prefix) || b.id.includes("-shell-")) continue;
    own.add(b.id);
    // The tanks' share: the engines' own small stores fill and empty as they fire.
    if (b.id.startsWith(`${prefix}tank`))
      for (const c of b.contents ?? []) {
        fuel += c.mass;
        capacity += c.capacity;
      }
    if (b.magazine) slugs += b.magazine.count;
    damage = Math.max(damage, 1 - b.integrity);
  }
  for (const j of world.joints) if (own.has(j.a) && own.has(j.b)) damage = Math.max(damage, 1 - j.integrity);
  // A lost ship: whatever is left of it, it is lost.
  return { fuel: capacity > 0 ? fuel / capacity : 0, slugs, damage: game.state.phase === "between" || game.state.reason === "ships" ? 1 : damage };
}

/**
 * Where the view looks: at the ship flying (moved on by `ahead` s, for smooth motion), drawn a little
 * toward the pod while the pod is on its tether, so both stay in view. With no ship, at the start.
 */
export function lookAt(world: World, ahead: number): Vec2 | null {
  const look = lookParts(world, ahead);
  return look && { x: look.ship.x + look.lean.x, y: look.ship.y + look.lean.y };
}

/** How far toward the pod the view leans while the pod is on the tether, of the way from the ship. */
export const POD_LEAN = 0.35;
/** The time the view takes to lean toward the pod, or back, s on screen (it closes 63% of the gap in this time). */
export const LEAN_TIME = 0.4;

/** The view's two parts: the ship, which it follows at once, and its lean toward the pod, which it eases into. */
export function lookParts(world: World, ahead: number): { ship: Vec2; lean: Vec2 } | null {
  const game = world.thrust;
  if (!game) return null;
  const hull = world.bodies.find((b) => b.id === game.spec.hull.replaceAll("{n}", String(game.state.n)));
  if (!hull) return null;
  const ship = { x: hull.position.x + hull.velocity.x * ahead, y: hull.position.y + hull.velocity.y * ahead };
  const pod = game.state.pod === "tether" ? world.bodies.find((b) => b.id === game.spec.pod) : undefined;
  if (!pod) return { ship, lean: { x: 0, y: 0 } };
  const p = { x: pod.position.x + pod.velocity.x * ahead, y: pod.position.y + pod.velocity.y * ahead };
  return { ship, lean: { x: POD_LEAN * (p.x - ship.x), y: POD_LEAN * (p.y - ship.y) } };
}

/** Moves a lean toward where it should be, over `dt` s: never a jump, however long the frame. */
export function easeLean(from: Vec2, to: Vec2, dt: number): Vec2 {
  const k = 1 - Math.exp(-Math.min(dt, 0.1) / LEAN_TIME);
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/** What the HUD calls the pod's state. */
export const POD_LABEL = { stand: "ON ITS STAND", loose: "LOOSE", tether: "ON THE TETHER", gone: "LOST" } as const;

/**
 * The power plant's coolant (MTH-086), for the HUD: the share of the reactor's coolant left (0–1),
 * and the holes it leaks from. Null on a level without a plant.
 */
export function coolantStatus(world: World): { share: number; holes: number } | null {
  const spec = world.thrust?.spec.plant;
  const state = world.thrust?.state.plant;
  if (!spec || !state) return null;
  const core = world.bodies.find((b) => b.id === spec.core);
  const capacity = (core?.contents ?? []).reduce((m, c) => m + c.capacity, 0);
  return { share: capacity > 0 ? Math.max(0, Math.min(1, plantCoolant(world, spec) / capacity)) : 0, holes: state.holes };
}
