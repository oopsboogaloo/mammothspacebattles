// Combat duel (mini game 3; DUEL-001…DUEL-003): the player's ship against AI ships.
//
// Like the landing challenge, the judge runs at the end of every step and lives in the world, so
// runs, replays and scrubbing back all reach the same verdict at the same step. It only reads.
//
// A ship is out of the fight once its named body (its hull) is gone, or once nothing it is still
// welded to can push it (no working engine). The player wins when every enemy is out, and loses
// when they are. A ship's health is the share of its parts still welded to its hull.

import { assemblyOf } from "./joints.ts";
import type { World } from "./world.ts";

export interface DuelGoal {
  kind: "duel";
  /** The player's ship: a body of it (its hull). */
  player: string;
  /** The enemy ships: a body of each (the pilot's). */
  enemies: string[];
}

export type DuelPhase = "fighting" | "won" | "lost";

export interface DuelStatus {
  phase: DuelPhase;
  reason?: string;
  /** Step of the verdict. */
  at?: number;
  /** Share of each ship's parts still welded to its hull, 0–1: the player's, and each enemy's. */
  player: number;
  enemies: Record<string, number>;
  /** Parts at the start. */
  start: Record<string, number>;
  /** Score once won: up to 500 for health left, up to 500 for a quick win (none after 2 minutes). */
  score?: number;
}

export interface Duel {
  goal: DuelGoal;
  status: DuelStatus;
}

/** A ship's parts welded to its hull, and whether it can still fly (a working engine among them). */
function shipState(world: World, id: string): { parts: number; flies: boolean } {
  if (!world.bodies.some((b) => b.id === id)) return { parts: 0, flies: false };
  const ids = new Set(assemblyOf(world, id));
  // A magazine's stop comes and goes as shells load: not a part.
  const parts = world.bodies.filter((b) => ids.has(b.id) && !b.id.endsWith("-stop"));
  return { parts: parts.length, flies: parts.some((b) => b.injector && !b.magazine && b.integrity > 0) };
}

export function startDuel(world: World, goal: DuelGoal): Duel {
  const start: Record<string, number> = {};
  for (const id of [goal.player, ...goal.enemies]) start[id] = Math.max(1, shipState(world, id).parts);
  const status: DuelStatus = { phase: "fighting", player: 1, enemies: Object.fromEntries(goal.enemies.map((e) => [e, 1])), start };
  return { goal, status };
}

/** Updates health and the verdict after a step. Returns the verdict if it changed this step. */
export function judgeDuel(world: World, d: Duel): DuelPhase | null {
  const s = d.status;
  const me = shipState(world, d.goal.player);
  s.player = Math.min(1, me.parts / s.start[d.goal.player]);
  let left = 0;
  for (const e of d.goal.enemies) {
    const st = shipState(world, e);
    s.enemies[e] = Math.min(1, st.parts / s.start[e]);
    if (st.flies) left += 1;
  }
  if (s.phase !== "fighting") return null;
  if (!me.flies) {
    s.phase = "lost";
    s.reason = me.parts ? "your ship has no engine left" : "your ship was destroyed";
    s.at = world.tick;
    return "lost";
  }
  if (left === 0) {
    s.phase = "won";
    s.reason = d.goal.enemies.length > 1 ? "every enemy is out of the fight" : "the enemy is out of the fight";
    s.at = world.tick;
    s.score = Math.round(500 * s.player + 500 * Math.max(0, 1 - world.time / 120));
    return "won";
  }
  return null;
}
