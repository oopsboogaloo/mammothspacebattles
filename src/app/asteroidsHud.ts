// Mammoth Asteroids: what its page works out from the screen and the world (no drawing here).
import type { World } from "../core/index.ts";

/** The arena's height, m, and its width as a multiple of that: the screen's shape, within these (MAS-010). */
const HEIGHT = 160;
const NARROWEST = 1.2;
const WIDEST = 2.2;

/** The arena for a screen: 160 m high, as wide as the screen's shape makes it, within 1.2–2.2 × the height. */
export function arenaFor(width: number, height: number): { width: number; height: number } {
  const shape = height > 0 ? width / height : 16 / 9;
  return { width: HEIGHT * Math.min(WIDEST, Math.max(NARROWEST, shape)), height: HEIGHT };
}

/** What the HUD shows of the ship flying: its fuel (0–1), slugs left, and its worst-hit part or weld (0–1). */
export function shipStatus(world: World): { fuel: number; slugs: number; damage: number } {
  const game = world.arcade;
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
    // The tank's share: the engines' own small stores fill and empty as they fire.
    if (b.id === `${prefix}tank`)
      for (const c of b.contents ?? []) {
        fuel += c.mass;
        capacity += c.capacity;
      }
    if (b.magazine) slugs += b.magazine.count;
    damage = Math.max(damage, 1 - b.integrity);
  }
  for (const j of world.joints) if (own.has(j.a) && own.has(j.b)) damage = Math.max(damage, 1 - j.integrity);
  // A lost ship: whatever is left of it, it is lost.
  return { fuel: capacity > 0 ? fuel / capacity : 0, slugs, damage: game.state.lost ? 1 : damage };
}
