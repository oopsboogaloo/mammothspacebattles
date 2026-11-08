// Mammoth Lander's game (docs/games/mammoth-lander.md): a ship at a time comes down onto one of
// several pads. A landing banks its score and closes its pad; a crash costs a life. After each
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
  /** Its tank, with `{n}`: a crash harder than `explodeAbove` sets it off (it must carry an explosive). */
  tank?: string;
  /** Where each ship starts (the template's origin goes here) and how it is moving. */
  start: { position: Vec2; velocity: Vec2 };
  pads: { id: string; multiplier: number }[];
  /** Fastest touchdown and largest tilt that still land (FLT-006, FLT-008). */
  maxSpeed: number;
  maxTilt: number;
  /** Ships a game (default 3): landed or crashed, each flies once. */
  ships?: number;
  /** Game time between a verdict and the next ship, s (default 2). */
  pause?: number;
  /** A crash touching down faster than this sets off the tank, m/s (default 3). */
  explodeAbove?: number;
  /** Points for using every pad (default 1,000). */
  clearBonus?: number;
}

export interface LanderState {
  /** The ship flying, or the last one (1, 2, …). */
  n: number;
  crashes: number;
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

const DEFAULTS = { ships: 3, pause: 2, explodeAbove: 3, clearBonus: 1000 };

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
  return { kind: "landing", ship: withN(spec.hull, state.n), pad: spec.pads[0].id, pads: spec.pads, used: [...state.used], maxSpeed: spec.maxSpeed, maxTilt: spec.maxTilt };
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
  return landerShip(game.spec, game.state.n);
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
  } else {
    state.crashes += 1;
    // A hard crash sets off the tank: the blast, shrapnel and dust are the explosion (LND-021).
    const tank = spec.tank ? world.bodies.find((b) => b.id === withN(spec.tank!, state.n)) : undefined;
    if (tank?.explosive && crashSpeed(world, c.goal.ship, st.at ?? world.tick, st.parts) >= o.explodeAbove) tank.explosive.trigger = true;
  }
  // The keys fly only the next ship: this one's engines lose their control links.
  const members = new Set(assemblyOf(world, c.goal.ship));
  world.links = world.links.filter((l) => !(l.kind === "control" && members.has(l.to)));
  if (state.used.length >= spec.pads.length) {
    state.phase = "over";
    state.ended = "cleared";
    state.score += o.clearBonus;
  } else {
    // The pause after the last life's crash too, so its explosion plays before the game ends.
    state.phase = "between";
    state.next = world.time + o.pause;
  }
}

/** The hardest touch between the ship (its parts at the start) and anything else, in the steps of its crash, m/s. */
function crashSpeed(world: World, ship: string, tick: number, parts?: string[]): number {
  const members = new Set(parts ?? assemblyOf(world, ship));
  let v = 0;
  for (const e of world.events) {
    if (e.type !== "collision" || e.tick < tick - 1) continue;
    if (members.has(String(e.data.a)) !== members.has(String(e.data.b))) v = Math.max(v, Number(e.data.speed));
  }
  return v;
}
