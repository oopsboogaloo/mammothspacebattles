// Mammoth Lander's game (docs/games/mammoth-lander.md): a ship at a time comes down onto one of
// several pads. The judge is physical: the damage model decides what a hit does. A landing banks its
// score and closes its pad; a broken ship is a crash; a ship left resting off the pads, out of fuel
// or abandoned, is stranded. Each ship flies once. After each
// verdict a short pause, then the next ship starts at the top in the same world: wreckage and
// parked ships stay all game (LND-020, LND-022). The game lives in the world, like the landing
// judge, so a run, a replay and a scrub agree.

import type { Vec2 } from "./math.ts";
import { assemblyOf } from "./joints.ts";
import { startLanding, type LandingGoal } from "./landing.ts";
import type { BodyInput, Command, JointInput, LinkInput, World } from "./world.ts";

export interface LanderSpec {
  /** The ship, laid out round the origin, with `{n}` in its ids (not its control channels). */
  ship: { bodies: BodyInput[]; joints?: JointInput[]; links?: LinkInput[] };
  /** The ship body that is the ship for the judge (its tilt is the ship's), with `{n}`. */
  hull: string;
  /** Its tank, with `{n}`. */
  tank?: string;
  /** Where each ship starts (the template's origin goes here) and how it is moving. */
  start: { position: Vec2; velocity: Vec2 };
  pads: { id: string; multiplier: number }[];
  /** A touchdown speed above which the ship is likely to be damaged: a guide for the HUD, not a rule, m/s. */
  maxSpeed: number;
  /** Largest tilt from upright that counts as standing on its legs, degrees. */
  maxTilt: number;
  /** Ships a game (default 3): landed or crashed, each flies once. */
  ships?: number;
  /** Game time between a verdict and the next ship, s (default 2); after a crash, `watch` more. */
  pause?: number;
  /** Game time to watch a crash play out before its verdict shows, s (default 1.25: 2.5 s at the game's half pace). */
  watch?: number;
  /** Points for using every pad (default 1,000). */
  clearBonus?: number;
  /**
   * The terrain's surface as lines to draw (a cave's floor and roof). Absent: the top edges of the
   * fixed bodies are drawn. Drawing only: the bodies are what collides.
   */
  lines?: Vec2[][];
  /** Which side of each of `lines` is rock, drawn solid to past the edge of any view. */
  solid?: ("below" | "above")[];
}

export interface LanderState {
  /** The ship flying, or the last one (1, 2, …). */
  n: number;
  crashes: number;
  /** Ships left resting off the pads (out of fuel, or abandoned). */
  stranded?: number;
  score: number;
  /** Pads landed on, in order. */
  used: string[];
  landings: { pad: string; score: number }[];
  phase: "flying" | "between" | "over";
  /** When the next ship starts (between ships), s. */
  next?: number;
  /** Why the game ended. */
  ended?: "ships" | "cleared";
}

export interface LanderGame {
  spec: LanderSpec;
  state: LanderState;
}

const DEFAULTS = { ships: 3, pause: 2, watch: 1.25, clearBonus: 1000 };

/** The control a player sets to give up on the ship flying (it is then stranded). */
export const ABANDON = "abandon";

const withN = <T>(x: T, n: number): T => JSON.parse(JSON.stringify(x).replaceAll("{n}", String(n))) as T;

/** The commands that add ship number `n` at the start, moving as the start says. */
export function landerShip(spec: LanderSpec, n: number): Command[] {
  const s = withN(spec.ship, n);
  const { position: at, velocity } = spec.start;
  return [
    ...s.bodies.map((b): Command => ({ type: "body.add", body: { ...b, position: { x: at.x + b.position.x, y: at.y + b.position.y }, velocity: { ...velocity } } })),
    ...(s.joints ?? []).map((joint): Command => ({ type: "joint.add", joint })),
    ...(s.links ?? []).map((link): Command => ({ type: "link.add", link })),
  ];
}

/** The landing judge's goal for ship `n`, with the pads used so far closed. */
function goalFor(game: LanderGame): LandingGoal {
  const { spec, state } = game;
  return { kind: "landing", ship: withN(spec.hull, state.n), pad: spec.pads[0].id, pads: spec.pads, used: [...state.used], maxSpeed: spec.maxSpeed, maxTilt: spec.maxTilt, physical: true };
}

/** A new game: ship 1 is added by the first step's commands. */
export function startLander(spec: LanderSpec): LanderGame {
  return { spec: structuredClone(spec), state: { n: 0, crashes: 0, score: 0, used: [], landings: [], phase: "between", next: 0 } };
}

/** Commands for this step: the next ship, when its time has come. Call before the step's other commands. */
export function landerCommands(world: World): Command[] {
  const game = world.lander;
  if (!game || game.state.phase !== "between" || world.time < (game.state.next ?? 0) - 1e-9) return [];
  // Every ship has flown, and the last one's verdict has played out (an explosion included): the game is over.
  if (game.state.n >= (game.spec.ships ?? DEFAULTS.ships)) {
    game.state.phase = "over";
    game.state.ended = "ships";
    game.state.next = undefined;
    return [];
  }
  game.state.n += 1;
  game.state.phase = "flying";
  game.state.next = undefined;
  // A fresh ship isn't abandoned.
  return [{ type: "control.set", channel: ABANDON, value: 0 }, ...landerShip(game.spec, game.state.n)];
}

/** After the step's commands: the judge for the ship just added. */
export function landerStartJudge(world: World): void {
  const game = world.lander;
  if (!game || game.state.phase !== "flying") return;
  const hull = withN(game.spec.hull, game.state.n);
  if (world.challenge?.goal.ship === hull) return;
  world.challenge = startLanding(world, goalFor(game));
}

/** After the judge: bank a landing or count a crash, stop the ship's controls, and end or pause the game. */
export function updateLander(world: World): void {
  const game = world.lander;
  const c = world.challenge;
  if (!game || !c || game.state.phase !== "flying" || c.status.phase === "flying") return;
  const { spec, state } = game;
  const o = { ...DEFAULTS, ...spec };
  const st = c.status;
  if (st.phase === "landed" && st.landedOn) {
    state.used.push(st.landedOn);
    state.landings.push({ pad: st.landedOn, score: st.score ?? 0 });
    state.score += st.score ?? 0;
  } else if (st.phase === "stranded") state.stranded = (state.stranded ?? 0) + 1;
  else state.crashes += 1;
  // The keys fly only the next ship: this one's engines lose their control links.
  const members = new Set(assemblyOf(world, c.goal.ship));
  world.links = world.links.filter((l) => !(l.kind === "control" && members.has(l.to)));
  if (state.used.length >= spec.pads.length) {
    state.phase = "over";
    state.ended = "cleared";
    state.score += o.clearBonus;
  } else {
    // The pause after the last life's verdict too, so a crash plays out before the game ends; a
    // crash is watched a while before its verdict shows.
    state.phase = "between";
    state.next = world.time + o.pause + (st.phase === "crashed" ? o.watch : 0);
  }
}
