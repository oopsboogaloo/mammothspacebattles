// Mammoth Thrust's game (docs/games/mammoth-thrust.md, -design.md §3): a ship with a tractor beam
// flies down to a pod, takes it on its tether and carries it up past the level's top. Like Lander's
// and Asteroids', the game lives in the world and runs inside the step, so a run and a replay agree.
// What it brings in (each new ship) and moves (the beam back) is recorded by the step as crossing
// the boundary.
//
// The game damages nothing: ships break, and the pod survives, by the shared physics alone.
// Ids: the player's ships are `p{n}-…` (n counts up with every new ship).
// Times in the spec are game seconds (the game runs at Lander's pace, one in two of the player's).

import { shipState } from "./duel.ts";
import { assemblyOf } from "./joints.ts";
import { invRotate, length, sinCos, sub, type Vec2 } from "./math.ts";
import type { BodyInput, JointInput, LinkInput, World } from "./world.ts";

export interface ThrustSpec {
  /** The ship, laid out round the origin (its hull there), pointing up, with `{n}` in its ids (not its control channels). */
  ship: { bodies: BodyInput[]; joints?: JointInput[]; links?: LinkInput[] };
  /** The ship's hull and the part that carries its tractor, with `{n}`. */
  hull: string;
  tractor: string;
  /** How the player's controls drive the ship's engines, as Mammoth Asteroids' (MAS-035). */
  mix?: { channel: string; any: { on: string[]; off?: string[] }[] }[];
  /** Where each ship beams in, pointing up and at rest. */
  start: Vec2;
  /** The height that ends the level (MTH-024, MTH-026). */
  top: number;
  /** The pod: a body of the scenario. */
  pod: string;
  /** Ships a game (default 3). */
  lives?: number;
  /** Game seconds between losing a ship and the next (default 1.25). */
  respawn?: number;
  /** Game seconds a new ship takes no damage after a loss (default 1). */
  grace?: number;
  /** The level's number, for the page. */
  level?: number;
  /** Points: for the pod carried out, and for each kg of fuel left then. */
  scores?: { pod?: number; fuel?: number };
  /** The score and ships brought from the level before. */
  carry?: { score: number; lives: number };
  /**
   * How the page draws the level (MTH-053): the rock's colour and the height of a line and its gap, m;
   * the open sky (a closed outline: stars show inside it) and the open space underground (closed
   * outlines, plain black). Everything else is rock.
   */
  view?: { colour: string; pitch: number; sky: Vec2[]; caves: Vec2[][] };
}

export type ThrustPhase = "flying" | "between" | "won" | "over";
export type PodState = "stand" | "loose" | "tether" | "gone";

export interface ThrustState {
  phase: ThrustPhase;
  /** Ships left, the one flying included. */
  lives: number;
  /** The ship flying, or the last one (1, 2, …): its parts are `p{n}-…`. */
  n: number;
  score: number;
  pod: PodState;
  /** Where the pod stood at the start. */
  stand: Vec2;
  /** When the next ship comes, s. */
  next?: number;
  /** When the new ship's protection ends, s. */
  graceUntil?: number;
  /** Why the game is over: no ships left, or the pod destroyed. */
  reason?: "ships" | "pod";
  /** What the level scored when it was won: the pod and the fuel left. */
  bonus?: { pod: number; fuel: number };
  /** Rings to draw where something beamed in: the step, the place and the size. */
  beams: { at: number; x: number; y: number; r: number }[];
  /** For the end screens. */
  stats: { ships: number; back: number };
  /** When a ship was last beamed back from the top, s. */
  backAt?: number;
  /** Since when the ship flying has been out of fuel and at rest, s (it is then lost). */
  stuckSince?: number;
}

export interface ThrustGame {
  spec: ThrustSpec;
  state: ThrustState;
}

/** How the game adds to the world: the world's own ways, handed in by the step. */
export interface ThrustOps {
  addBody(world: World, body: BodyInput): void;
  addJoint(world: World, joint: JointInput): void;
  addLink(world: World, link: LinkInput): void;
}

export const THRUST_DEFAULTS = { lives: 3, respawn: 1.25, grace: 1 };
export const THRUST_SCORES = { pod: 2000, fuel: 100 };
/** The control that destroys the player's own ship, as Mammoth Asteroids' (MAS-039). */
export const THRUST_DESTRUCT = "destruct";
/** How long a beam ring shows, game s. */
const BEAM = 0.5;
/** The pod is on its stand while it is this near where it started, m. */
const ON_STAND = 0.5;
/** A ship with empty tanks is lost once it has lain this still for this long: m/s, rad/s, game s. */
const REST_SPEED = 0.3;
const REST_SPIN = 0.3;
const REST_TIME = 1;

const withN = <T>(x: T, n: number): T => JSON.parse(JSON.stringify(x).replaceAll("{n}", String(n))) as T;
const idOf = (id: string, n: number): string => id.replaceAll("{n}", String(n));

/** Adds ship number `state.n` at the start, pointing up and at rest. With `grace`, its parts carry no material for that long. */
function addShip(world: World, game: ThrustGame, ops: ThrustOps, grace: number): void {
  const { spec, state } = game;
  const t = withN(spec.ship, state.n);
  for (const b of t.bodies) {
    const body: BodyInput = { ...b, position: { x: spec.start.x + b.position.x, y: spec.start.y + b.position.y }, velocity: { x: 0, y: 0 }, angularVelocity: 0 };
    if (grace > 0) delete body.material;
    ops.addBody(world, body);
  }
  for (const j of t.joints ?? []) ops.addJoint(world, j);
  for (const l of t.links ?? []) ops.addLink(world, l);
  state.graceUntil = grace > 0 ? world.time + grace : undefined;
  state.stuckSince = undefined;
  state.stats.ships += 1;
  state.beams.push({ at: world.tick, x: spec.start.x, y: spec.start.y, r: 4 });
  world.events.push({ tick: world.tick, type: "thrust.ship", data: { n: state.n, x: spec.start.x, y: spec.start.y, protected: grace > 0 } });
}

/** The ship's protection is over: its parts get their materials back. */
function endGrace(world: World, game: ThrustGame): void {
  const { spec, state } = game;
  const materials = new Map(withN(spec.ship, state.n).bodies.map((b) => [b.id, b.material]));
  for (const b of world.bodies) {
    const m = materials.get(b.id);
    if (m && !b.material) b.material = structuredClone(m);
  }
  state.graceUntil = undefined;
}

/** The fuel in the flying ship's tanks, kg. */
export function thrustFuel(world: World): { mass: number; capacity: number } {
  const game = world.thrust;
  let mass = 0;
  let capacity = 0;
  if (!game) return { mass, capacity };
  const prefix = `p${game.state.n}-tank`;
  for (const b of world.bodies) {
    if (!b.id.startsWith(prefix)) continue;
    for (const c of b.contents ?? []) {
      mass += c.mass;
      capacity += c.capacity;
    }
  }
  return { mass, capacity };
}

/** What the pod is doing: on the ship's tether, on its stand, loose, or gone. */
function podState(world: World, game: ThrustGame): PodState {
  const { spec, state } = game;
  const pod = world.bodies.find((b) => b.id === spec.pod);
  if (!pod || pod.integrity <= 0) return "gone";
  const tractor = world.bodies.find((b) => b.id === idOf(spec.tractor, state.n))?.tractor;
  if (tractor?.mode === "tether" && tractor.cargo === spec.pod) return "tether";
  return length(sub(pod.position, state.stand)) <= ON_STAND ? "stand" : "loose";
}

/** A new game: ship 1 at the start. */
export function startThrust(world: World, spec: ThrustSpec, ops: ThrustOps): ThrustGame {
  const pod = world.bodies.find((b) => b.id === spec.pod);
  const game: ThrustGame = {
    spec: structuredClone(spec),
    state: {
      phase: "flying",
      lives: spec.carry?.lives ?? spec.lives ?? THRUST_DEFAULTS.lives,
      n: 1,
      score: spec.carry?.score ?? 0,
      pod: "stand",
      stand: pod ? { ...pod.position } : { x: 0, y: 0 },
      beams: [],
      stats: { ships: 0, back: 0 },
    },
  };
  addShip(world, game, ops, 0);
  return game;
}

/**
 * Runs the game for one step, inside the step: a lost ship, the wait and the next ship; the pod's
 * state; and the level's top, which ends the level with the pod and sends the ship back without it.
 * Returns whether it added or moved anything (for the ledger).
 */
export function runThrust(world: World, dt: number, ops: ThrustOps): boolean {
  const game = world.thrust;
  if (!game) return false;
  const { spec, state: s } = game;
  const o = { ...THRUST_DEFAULTS, ...spec };
  const now = world.time;
  const due = (at: number | undefined) => at !== undefined && now >= at - 1e-9;
  let changed = false;

  if (s.beams.length) s.beams = s.beams.filter((b) => world.tick - b.at < Math.round(BEAM / dt));
  if (s.phase === "won" || s.phase === "over") return false;

  const hullId = idOf(spec.hull, s.n);

  // 1. The pod (MTH-025): destroyed, the game is over.
  const pod = podState(world, game);
  if (pod !== s.pod) {
    s.pod = pod;
    world.events.push({ tick: world.tick, type: "thrust.pod", data: { state: pod } });
  }
  if (pod === "gone") {
    s.phase = "over";
    s.reason = "pod";
    s.next = undefined;
    world.events.push({ tick: world.tick, type: "thrust.over", data: { score: s.score, reason: "pod" } });
    return changed;
  }

  if (s.phase === "flying") {
    // 2. Self-destruct, as Mammoth Asteroids' (MAS-039): the cockpit and everything on the ship that
    // explodes when destroyed go at once; the ship is then lost by the rule below.
    if ((world.controls[THRUST_DESTRUCT] ?? 0) > 0) {
      if (world.bodies.some((b) => b.id === hullId)) {
        const ship = new Set(assemblyOf(world, hullId));
        for (const b of world.bodies) if (ship.has(b.id) && (b.id === hullId || b.explosive?.whenDestroyed)) b.integrity = 0;
        world.events.push({ tick: world.tick, type: "thrust.destruct", data: { n: s.n } });
        changed = true;
      }
      world.controls = { ...world.controls, [THRUST_DESTRUCT]: 0 };
    }

    // 3. Out of fuel and lying still: the ship can never fly again, so it is lost (it has crashed, or
    // been set down with empty tanks).
    const hull = world.bodies.find((b) => b.id === hullId);
    const fuel = thrustFuel(world);
    const still = !!hull && length(hull.velocity) < REST_SPEED && Math.abs(hull.angularVelocity) < REST_SPIN;
    if (hull && fuel.capacity > 0 && fuel.mass <= 1e-6 && still) s.stuckSince ??= now;
    else s.stuckSince = undefined;
    const stuck = s.stuckSince !== undefined && now - s.stuckSince >= REST_TIME;

    // 4. The ship is lost when its hull is gone, or no working engine is still welded to it (the
    // duel's rule). Nothing else on the level changes (MTH-023).
    if (stuck || !shipState(world, hullId).flies) {
      s.lives -= 1;
      s.graceUntil = undefined;
      s.stuckSince = undefined;
      // The keys fly only the next ship: the wreck and what broke off it lose their control links.
      const prefix = `p${s.n}-`;
      world.links = world.links.filter((l) => !(l.kind === "control" && l.to.startsWith(prefix)));
      world.events.push({ tick: world.tick, type: "thrust.lost", data: { n: s.n, lives: s.lives } });
      s.phase = "between";
      s.next = now + o.respawn;
      return true;
    }

    // 5. Protection over.
    if (due(s.graceUntil)) endGrace(world, game);

    // 6. The level's top (MTH-024, MTH-026).
    if (hull && hull.position.y > spec.top) {
      if (pod === "tether") {
        const left = thrustFuel(world).mass;
        s.bonus = { pod: spec.scores?.pod ?? THRUST_SCORES.pod, fuel: Math.round((spec.scores?.fuel ?? THRUST_SCORES.fuel) * left) };
        s.score += s.bonus.pod + s.bonus.fuel;
        s.phase = "won";
        world.events.push({ tick: world.tick, type: "thrust.won", data: { score: s.score, pod: s.bonus.pod, fuel: s.bonus.fuel } });
        return changed;
      }
      // Without the pod: back to the start, as it is, to finish the mission. The ship moves as one
      // rigid thing to the start, upright and at rest; its damage, fuel and shells are untouched.
      const ship = new Set(assemblyOf(world, hullId));
      const q = sinCos(hull.angle);
      const from = { ...hull.position };
      const turn = hull.angle;
      for (const b of world.bodies) {
        if (!ship.has(b.id)) continue;
        const r = invRotate(q, { x: b.position.x - from.x, y: b.position.y - from.y });
        b.position = { x: spec.start.x + r.x, y: spec.start.y + r.y };
        b.angle -= turn;
        b.velocity = { x: 0, y: 0 };
        b.angularVelocity = 0;
        if (b.tractor && b.tractor.mode !== "off") {
          b.tractor.mode = "off";
          b.tractor.cargo = undefined;
          b.tractor.paid = undefined;
          b.tractor.latched = b.tractor.held;
        }
      }
      world.contacts = world.contacts.filter((c) => !ship.has(c.a) && !ship.has(c.b));
      s.stats.back += 1;
      s.backAt = now;
      s.beams.push({ at: world.tick, x: from.x, y: from.y, r: 4 }, { at: world.tick, x: spec.start.x, y: spec.start.y, r: 4 });
      world.events.push({ tick: world.tick, type: "thrust.back", data: { n: s.n } });
      changed = true;
    }
    return changed;
  }

  // 7. The wait after a loss is over: the game, or the next ship at the start.
  if (s.phase === "between" && due(s.next)) {
    s.next = undefined;
    if (s.lives <= 0) {
      s.phase = "over";
      s.reason = "ships";
      world.events.push({ tick: world.tick, type: "thrust.over", data: { score: s.score, reason: "ships" } });
      return changed;
    }
    s.n += 1;
    s.phase = "flying";
    addShip(world, game, ops, o.grace);
    changed = true;
  }
  return changed;
}
