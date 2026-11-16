// Playing a game with a ship from the blueprint designer (Chloe, 16 November 2026): for debugging
// designs, not the players' path. The designer saves the blueprint and opens a game's page with
// `?blueprint=1`; every level that game loads then carries the blueprint's ship in place of its own,
// wired by the blueprint's mixer, and the game's menus offer the way back.
import type { Blueprint } from "./blueprint/model.ts";

export const PLAYTEST_KEY = "msb.playtest.v1";
export type PlaytestGame = "thrust" | "asteroids" | "lander";

/** Saves the blueprint and opens the game with it. */
export function playIn(game: PlaytestGame, bp: Blueprint): void {
  localStorage.setItem(PLAYTEST_KEY, JSON.stringify(bp));
  window.location.href = `${game}.html?blueprint=1`;
}

/** The blueprint this page is playing with, if it was opened from the designer. */
export const playtest: Blueprint | null = (() => {
  try {
    if (typeof window === "undefined" || !new URLSearchParams(window.location.search).has("blueprint")) return null;
    const raw = localStorage.getItem(PLAYTEST_KEY);
    return raw ? (JSON.parse(raw) as Blueprint) : null;
  } catch {
    return null;
  }
})();

export function backToBlueprint(): void {
  window.location.href = "blueprint.html";
}

/** Fields that hold channels, resources or names, never a part's id: left as they are. */
const NOT_IDS = new Set(["channel", "blocks", "resource", "name", "kind", "mode", "label"]);

/** The actions as the games name their controls (Thrust's keys: fire, tractor beam, shield). */
const ACTIONS: Record<string, string> = { "action-a": "fire", "action-b": "tractor", "action-c": "shield" };

/**
 * A game's level with the blueprint's ship in place of its own: its parts numbered as the game's
 * ships are (`p{n}-…`), laid out round its cockpit, its hull, gun, beam and tank named for the game,
 * and its mixer driving it (Actions A, B and C on the game's fire, beam and shield controls).
 */
export function withBlueprint(raw: Record<string, unknown>, bp: Blueprint): Record<string, unknown> {
  const out = structuredClone(raw) as { world: Record<string, unknown> };
  const w = out.world;
  const g = (w.thrust ?? w.arcade ?? w.lander) as Record<string, unknown> | undefined;
  if (!g) return raw;
  const cockpit = bp.components.find((c) => c.kind === "cockpit")?.bodies[0] ?? bp.ship.bodies[0]?.id;
  if (!cockpit) return raw;
  const ship = structuredClone(bp.ship);
  const at = ship.bodies.find((b) => b.id === cockpit)!.position;
  const centre = { x: at.x, y: at.y };
  for (const b of ship.bodies) b.position = { x: b.position.x - centre.x, y: b.position.y - centre.y };
  const ids = new Set([...ship.bodies.map((b) => b.id), ...ship.joints.map((j) => j.id), ...ship.links.map((l) => l.id)]);
  const n = (id: string) => `p{n}-${id}`;
  const walk = (x: unknown, key = ""): unknown => {
    if (typeof x === "string") return !NOT_IDS.has(key) && ids.has(x) ? n(x) : x;
    if (Array.isArray(x)) return x.map((v) => walk(v, key));
    if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v, k)]));
    return x;
  };
  g.ship = walk(ship);
  g.hull = n(cockpit);
  const find = (test: (b: Blueprint["ship"]["bodies"][number]) => boolean) => ship.bodies.find(test)?.id;
  if (w.thrust) {
    g.tractor = n(find((b) => !!b.tractor) ?? cockpit);
    const gun = find((b) => !!b.magazine?.railgun);
    if (gun) g.gun = n(gun);
    else delete g.gun;
  }
  if (w.arcade) g.gun = n(find((b) => !!b.magazine) ?? cockpit);
  if (w.lander) {
    const tank = find((b) => !b.injector && !!b.contents?.length);
    if (tank) g.tank = n(tank);
    else delete g.tank;
  }
  // Its own wiring, not the game's mix: the actions on the game's fire, beam and shield controls.
  delete g.mix;
  const r = (c: string) => ACTIONS[c] ?? c;
  w.mix = { ...bp.mix, rows: bp.mix.rows.map((row) => ({ ...row, lines: row.lines.map((l) => ({ ...l, control: r(l.control), ...(l.ease ? { ease: { ...l.ease, control: r(l.ease.control) } } : {}) })) })) };
  return out;
}
