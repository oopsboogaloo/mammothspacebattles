// Mammoth Thrust: what its page works out from the screen and the world (no drawing here).
import type { Vec2, World } from "../core/index.ts";

/** How much of the level the view shows from top to bottom, m: enough for the ship and a pod on its 12 m tether, with the ground round them. */
export const VIEW_HEIGHT = 90;
/** The view's zoom, px a metre, for a screen: `VIEW_HEIGHT` m tall, within what keeps the ship readable. */
export const zoomFor = (height: number): number => Math.min(12, Math.max(3.5, height / VIEW_HEIGHT));

/** The levels, in order: the scenario files `thrust-{n}`. */
export const LEVELS = 2;

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
  const game = world.thrust;
  if (!game) return null;
  const hull = world.bodies.find((b) => b.id === game.spec.hull.replaceAll("{n}", String(game.state.n)));
  if (!hull) return null;
  const ship = { x: hull.position.x + hull.velocity.x * ahead, y: hull.position.y + hull.velocity.y * ahead };
  const pod = game.state.pod === "tether" ? world.bodies.find((b) => b.id === game.spec.pod) : undefined;
  if (!pod) return ship;
  const p = { x: pod.position.x + pod.velocity.x * ahead, y: pod.position.y + pod.velocity.y * ahead };
  return { x: ship.x + 0.35 * (p.x - ship.x), y: ship.y + 0.35 * (p.y - ship.y) };
}

/** What the HUD calls the pod's state. */
export const POD_LABEL = { stand: "ON ITS STAND", loose: "LOOSE", tether: "ON THE TETHER", gone: "LOST" } as const;
