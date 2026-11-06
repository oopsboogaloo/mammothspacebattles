// Combat duel (mini game 3; DUEL-001…DUEL-004): the player's ship against AI ships.
//
// The judge runs inside every step and lives in the world, so runs, replays and scrubbing back all
// reach the same verdict at the same step.
//
// A ship is out of the fight once its named body (its hull) is gone, or once nothing it is still
// welded to can push it (no working engine). That is a kill for the other side. First to `kills`
// wins; until then a ship that is out comes back (DUEL-004): what is left of it bursts into dust,
// and a fresh copy of it, as it was at the start, appears at rest `respawn` metres from the ship
// that survived, at the first clear spot off its line of fire. The verdict waits `delay` seconds after the deciding
// kill, so the explosions can be enjoyed. A ship's health is the share of its parts still welded
// to its hull. The step records what a respawn takes away and brings in as crossing the boundary.

import { add, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { removeBodies } from "./dust.ts";
import { assemblyOf } from "./joints.ts";
import { massProps } from "./shapes.ts";
import type { Body, Joint, Link, World } from "./world.ts";

export interface DuelGoal {
  kind: "duel";
  /** The player's ship: a body of it (its hull). */
  player: string;
  /** The enemy ships: a body of each (the pilot's). */
  enemies: string[];
  /** Kills to win (default 1: one knockout decides it). */
  kills?: number;
  /** How far from the surviving ship a knocked-out ship comes back, m (default 90). */
  respawn?: number;
  /** Seconds between the deciding kill and the verdict (default 3). */
  delay?: number;
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
  /** Kills so far: the player's, and the enemies' (all together). */
  kills: { player: number; enemies: number };
  /** The deciding kill has happened: the verdict to give, and the step to give it. */
  decided?: { phase: "won" | "lost"; reason: string; at: number };
  /** How many times each ship has come back (names its new shells apart from its old ones). */
  lives: Record<string, number>;
  /** Score once won: 1,000 a kill, less 500 for each time you were knocked out, plus up to 500 for speed (none after 5 minutes). */
  score?: number;
}

/** A ship as it was at the start: its bodies, the welds between them, and the links that reach them. */
interface ShipTemplate {
  bodies: Body[];
  joints: Joint[];
  links: Link[];
  centre: Vec2;
  /** Its reach from its centre, m. */
  radius: number;
}

export interface Duel {
  goal: DuelGoal;
  status: DuelStatus;
  /** The ships as they started, to bring them back. */
  templates: Record<string, ShipTemplate>;
}

/** A ship's parts welded to its hull, and whether it can still fly (a working engine among them). */
function shipState(world: World, id: string): { parts: number; flies: boolean; centre?: Vec2 } {
  if (!world.bodies.some((b) => b.id === id)) return { parts: 0, flies: false };
  const ids = new Set(assemblyOf(world, id));
  // A magazine's stop comes and goes as shells load: not a part.
  const parts = world.bodies.filter((b) => ids.has(b.id) && !b.id.endsWith("-stop"));
  let c = { x: 0, y: 0 };
  for (const b of parts) c = add(c, b.position);
  return { parts: parts.length, flies: parts.some((b) => b.injector && !b.magazine && b.integrity > 0), centre: scale(c, 1 / Math.max(1, parts.length)) };
}

function template(world: World, id: string): ShipTemplate {
  const ids = new Set(assemblyOf(world, id));
  const bodies = world.bodies.filter((b) => ids.has(b.id) && !b.id.endsWith("-stop")).map((b) => structuredClone(b));
  let c = { x: 0, y: 0 };
  for (const b of bodies) c = add(c, b.position);
  c = scale(c, 1 / Math.max(1, bodies.length));
  const radius = Math.max(0, ...bodies.map((b) => length(sub(b.position, c)) + massProps(b.shape, 1).boundingRadius));
  return {
    bodies,
    joints: world.joints.filter((j) => ids.has(j.a) && ids.has(j.b)).map((j) => structuredClone(j)),
    links: world.links.filter((l) => ids.has(l.to) || (l.kind === "feed" && ids.has(l.from))).map((l) => structuredClone(l)),
    centre: c,
    radius,
  };
}

export function startDuel(world: World, goal: DuelGoal): Duel {
  const ships = [goal.player, ...goal.enemies];
  const start: Record<string, number> = {};
  for (const id of ships) start[id] = Math.max(1, shipState(world, id).parts);
  const status: DuelStatus = {
    phase: "fighting",
    player: 1,
    enemies: Object.fromEntries(goal.enemies.map((e) => [e, 1])),
    start,
    kills: { player: 0, enemies: 0 },
    lives: Object.fromEntries(ships.map((s) => [s, 0])),
  };
  return { goal, status, templates: Object.fromEntries(ships.map((s) => [s, template(world, s)])) };
}

/** Brings a ship back: what is left of it bursts into dust, and its start copy appears at rest near `near`, clear of everything. */
function respawn(world: World, d: Duel, id: string, near: Vec2, from: Vec2): void {
  const t = d.templates[id];
  const lives = (d.status.lives[id] = (d.status.lives[id] ?? 0) + 1);
  const ids = new Set(t.bodies.map((b) => b.id));
  removeBodies(world, ids, "duel.wreck");
  // At `respawn` metres from the survivor, off the line it was firing along (shells still in flight
  // there would meet the new ship): first square to it, then round, the line itself last.
  const dist = d.goal.respawn ?? 90;
  const away = sub(from, near);
  const dir = length(away) > 1e-6 ? scale(away, 1 / length(away)) : { x: 0, y: 1 };
  const clear = (p: Vec2) => world.bodies.every((b) => length(sub(b.position, p)) > t.radius + massProps(b.shape, 1).boundingRadius + 3);
  const bearings = [2, -2, 3, -3, 1, -1, 4, 0].map((k) => (k * Math.PI) / 4);
  let at = add(near, scale(rotate(sinCos(bearings[0]), dir), dist));
  search: for (const reach of [dist, 1.5 * dist])
    for (const a of bearings) {
      const p = add(near, scale(rotate(sinCos(a), dir), reach));
      if (clear(p)) {
        at = p;
        break search;
      }
    }
  const shift = sub(at, t.centre);
  for (const tb of t.bodies) {
    const b = structuredClone(tb);
    b.position = add(b.position, shift);
    b.velocity = { x: 0, y: 0 };
    b.angularVelocity = 0;
    // Its shells are named apart from those its last life fired, still in flight.
    if (b.magazine) b.magazine.loaded = 1000 * lives;
    world.bodies.push(b);
  }
  for (const j of t.joints) world.joints.push(structuredClone(j));
  for (const l of t.links) if (!world.links.some((x) => x.id === l.id)) world.links.push(structuredClone(l));
  world.events.push({ tick: world.tick, type: "duel.respawn", data: { id, x: at.x, y: at.y, lives } });
}

/**
 * Runs the duel for one step (inside the step, so the ledger sees respawns): health, kills,
 * respawns, and the verdict once its delay has passed. Returns whether it changed the world.
 */
export function runDuel(world: World, d: Duel, dt: number): boolean {
  const s = d.status;
  const g = d.goal;
  const me = shipState(world, g.player);
  s.player = Math.min(1, me.parts / s.start[g.player]);
  const foes = g.enemies.map((e) => ({ id: e, ...shipState(world, e) }));
  for (const f of foes) s.enemies[f.id] = Math.min(1, f.parts / s.start[f.id]);
  if (s.phase !== "fighting") return false;
  if (s.decided) {
    if (world.tick < s.decided.at) return false;
    s.phase = s.decided.phase;
    s.reason = s.decided.reason;
    s.at = world.tick;
    if (s.phase === "won") s.score = Math.max(0, Math.round(1000 * s.kills.player - 500 * s.kills.enemies + 500 * Math.max(0, 1 - world.time / 300)));
    world.events.push({ tick: world.tick, type: `duel.${s.phase}`, data: s.score !== undefined ? { reason: s.reason, score: s.score } : { reason: s.reason } });
    return false;
  }
  const target = Math.max(1, Math.floor(g.kills ?? 1));
  const playerOut = !me.flies;
  const out = foes.filter((f) => !f.flies);
  if (!playerOut && !out.length) return false;
  if (playerOut) s.kills.enemies += 1;
  s.kills.player += out.length;
  world.events.push({ tick: world.tick, type: "duel.kill", data: { player: s.kills.player, enemies: s.kills.enemies } });
  const delay = Math.round((g.delay ?? 3) / dt);
  if (s.kills.enemies >= target) {
    s.decided = { phase: "lost", reason: target > 1 ? `they got to ${target} first` : me.parts ? "your ship has no engine left" : "your ship was destroyed", at: world.tick + delay };
    return false;
  }
  if (s.kills.player >= target) {
    s.decided = { phase: "won", reason: target > 1 ? `you got to ${target} first` : g.enemies.length > 1 ? "every enemy is out of the fight" : "the enemy is out of the fight", at: world.tick + delay };
    return false;
  }
  // Bring the knocked-out ships back, away from the survivors.
  const survivor = (ids: string[]) => ids.map((id) => shipState(world, id)).find((x) => x.flies)?.centre ?? { x: 0, y: 0 };
  let changed = false;
  if (playerOut) {
    respawn(world, d, g.player, survivor(foes.filter((f) => f.flies).map((f) => f.id)), me.centre ?? d.templates[g.player].centre);
    changed = true;
  }
  for (const f of out) {
    respawn(world, d, f.id, survivor([g.player]), f.centre ?? d.templates[f.id].centre);
    changed = true;
  }
  // Whole again.
  s.player = Math.min(1, shipState(world, g.player).parts / s.start[g.player]);
  for (const e of g.enemies) s.enemies[e] = Math.min(1, shipState(world, e).parts / s.start[e]);
  return changed;
}
