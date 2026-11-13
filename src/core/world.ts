// World state, commands and the step function (ARC-002).
// Bodies are kept sorted by id so iteration order never depends on insertion
// order (DET-004). All edits go through commands (SBX-013), and every change
// to the conserved totals is attributed in the ledger (LED-001…LED-003).

import { landerCommands, landerStartJudge, startLander, updateLander, type LanderGame, type LanderSpec } from "./lander.ts";
import { revealCompounds } from "./asteroid.ts";
import { normalizePilot, runPilots, type Pilot, type PilotGoal, type PilotInput } from "./pilot.ts";
import { applyCollectors, collectCaptured, normalizeCollector, type Collector, type CollectorInput } from "./collector.ts";
import { applyTractors, normalizeTractor, type Tractor, type TractorInput } from "./tractor.ts";
import { addDelta, computeTotals, diff, emptyLedger, SOURCES, zeroDelta, type Delta, type Ledger, type Source, type Totals } from "./ledger.ts";
import { bodiesById, bodyMass, type Store } from "./bodies.ts";
import { assemblyRoots, evaluateJoints, recordGasLoads } from "./joints.ts";
import { add, cross, length, rotate, scale, sinCos, sub, type Vec2 } from "./math.ts";
import { applyDrags, applyField, applyImpactFix, applyImpulseAt, correctPositions, integratePositions, prepareBodies, solveContacts, type RB } from "./physics.ts";
import { createRng, nextFloat, type RngState } from "./prng.ts";
import { collide } from "./collide.ts";
import { applyDamage, BREACH_WIDTH, defaultBreach, LEAK_PARCEL, LEAK_RADIUS, LEAK_SPEED, leakRate, type Breach, type Material } from "./damage.ts";
import { judgeLanding, startLanding, type Challenge, type LandingGoal } from "./landing.ts";
import { runDuel, startDuel, type Duel, type DuelGoal } from "./duel.ts";
import { arcadeMix, mixControls, runArcade, startArcade, type ArcadeGame, type ArcadeOps, type ArcadeSpec } from "./arcade.ts";
import { runThrust, startThrust, type ThrustGame, type ThrustSpec } from "./thrust.ts";
import { runTerrain, startTerrain, type Terrain, type TerrainOps, type TerrainSpec } from "./terrain.ts";
import { normalizeTurret, runTurrets, turnJoints, type Charge, type Generator, type JointTurn, type Turret, type TurretInput } from "./turret.ts";
import { SMOOTHING, addParcel, dropParcels, parcelAt, flyFree, freeFlightMask, burn, clearOf, emptyGas, temperatureOf, igniteAndBurn, makeFill, mixture, SPECIES, stepGasClustered, STORE_TEMPERATURE, storeEnergy, wallBodies, type Bounds, type ClosedRegion, type GasFill, type GasAccount, type GasState, type Parcel, type WallBody } from "./gas.ts";
import type { Profile } from "./profile.ts";
import { boundingRadiusOf, massProps, normalizePolygon, type Shape } from "./shapes.ts";
import { bodyIndex, holdingShape, plugWall, runVessel, spill, wallLoads, type Vessel } from "./vessel.ts";
import { detonate, releaseBlasts, type Blast, type Explosive } from "./explosive.ts";
import { spawnWisps, stepWisps, type Wisp } from "./wisps.ts";
import { removeDestroyed, stepDust, type Dust } from "./dust.ts";
import { fireRailguns, type Railgun } from "./railgun.ts";

export type { Vec2 } from "./math.ts";
export type { Shape } from "./shapes.ts";
export type { Store } from "./bodies.ts";
export { bodyMass } from "./bodies.ts";
export type { Bounds, GasFill, GasState, Parcel } from "./gas.ts";

export const WORLD_SCHEMA = 5;
/** Default world boundary: gas beyond it is removed (GAS-007), m. */
export const DEFAULT_BOUNDS: Bounds = { min: { x: -1000, y: -1000 }, max: { x: 1000, y: 1000 } };
const MAX_EVENTS = 10_000;

export interface Body {
  id: string;
  shape: Shape;
  mass: number; // kg
  /** Fixed bodies never move and have infinite mass (walls, ground). */
  fixed: boolean;
  restitution: number; // 0–1
  friction: number; // ≥ 0, Coulomb coefficient
  /** Position of the centre of mass, m. */
  position: Vec2;
  velocity: Vec2; // m/s
  angle: number; // rad
  angularVelocity: number; // rad/s
  /** Stores this component holds; their mass adds to `mass` (ASM-002). */
  contents?: Store[];
  /** Makes this body an injector (PRP-002). */
  injector?: Injector;
  /**
   * Makes this body a source of gravity (FLT-011): every other free body and gas parcel accelerates
   * toward it at mu·r/(r² + core²)^1.5, m/s², r from it to them. One way: sources feel no gravity,
   * from each other or anything, so they keep the paths they are given. `mu` is G·M, m³/s²;
   * `core` softens the pull near and inside the body, m. With `feels` (FLT-014) it is pulled after
   * all by the other sources, but never by those of its own assembly: two rocks that orbit each other.
   * With `joined` (AST-011) it pulls as one with the other joined sources it is welded to: one pull
   * from their centre, with their mu together, softened by half their reach from it. A rock of twenty
   * pieces is then one source, not twenty, and a piece that breaks off is a source of its own.
   */
  gravity?: { mu: number; core: number; feels?: boolean; joined?: boolean };
  /** How it takes damage (DMG-002). Absent: it can't be damaged. */
  material?: Material;
  /** 1 whole, 0 failed (DMG-001). At 0 it is wreckage: it no longer functions (DMG-003). */
  integrity: number;
  /** Where it leaks once damaged, if it holds gas (DMG-004). */
  breach?: Breach;
  /**
   * Holes it vents gas through (DMG-009), each at a steady `rate` (kg/s) while the store it draws on
   * holds gas: its own, or `from`'s (a body welded to it). Unlike a breach (DMG-004) a hole doesn't
   * depend on damage, and there may be many. Mammoth Thrust's power plant leaks coolant this way.
   */
  vents?: { from?: string; rate: number; holes: Breach[]; parcel?: number; radius?: number };
  /** Shells it carries and loads into place one at a time (WPN, first look). */
  magazine?: Magazine;
  /** An explosive charge that detonates on impact (WPN): see explosive.ts. */
  explosive?: Explosive;
  /** A tractor beam and tether (TRC): see tractor.ts. */
  tractor?: Tractor;
  /** A gun turret's fire control, on the gun's carriage (WPN-009): see turret.ts. */
  turret?: Turret;
  /** A battery's shots, and a generator that refills one (WPN-010): see turret.ts. */
  charge?: Charge;
  generator?: Generator;
  /**
   * A fixed body that stands on the terrain (TER-006): when a crater cuts the rock at its foot it
   * comes loose, a free body of this mass from then on, with whatever is welded to it. Those of one
   * `group` come loose together, welded to each other.
   */
  anchored?: { mass: number; group?: string };
  /** A tractor's siphon may draw this body's propellant through its beam (TRC-008): see tractor.ts. */
  siphon?: boolean;
  /**
   * Drawn folded back along its -y by up to `travel` m just after `gun` fires, and sliding out again
   * (an electric turret's outer barrel). Only the drawing moves: the body stays where it is.
   */
  recoil?: { gun: string; travel: number };
  /** A base's cargo collector, on a fixed body (BAS): see collector.ts. */
  collector?: Collector;
  /** An AI pilot flying this body's assembly (AIP): for now a computer built into the ship. See pilot.ts. */
  pilot?: Pilot;
  /** What it is made of, if valuable (AST-006): "gold". Drawn in its colour once it can be seen. */
  mineral?: string;
  /**
   * Bodies it never collides with, by id: they pass through it (Mammoth Asteroids' gold and the
   * ship that collects it, MAS-024).
   */
  passes?: readonly string[];
  /** Part of a larger asteroid fragment whose seams don't show yet (AST-007): see asteroid.ts. */
  compound?: { id: string; reveal: number; seams?: number };
}

/**
 * A magazine: shells carried as part of the body's mass, loaded one at a time at a set place in the
 * body's own frame (a cannon's bore) once it is clear and the body has not fired (its injector) for
 * `reload` seconds.
 * A loaded shell becomes a body of its own, moving with the place it appears at; the magazine's body
 * gives up its mass and momentum, so mass and momentum are unchanged.
 */
export interface Magazine {
  count: number;
  /** What each shell is: everything a body has but its id and motion. */
  shell: Omit<BodyInput, "id" | "position" | "velocity" | "angle" | "angularVelocity">;
  /** Where a loaded shell appears, in this body's frame. */
  at: Vec2;
  angle: number;
  /** Seconds after firing stops before the next shell loads. */
  reload: number;
  /**
   * A stop that holds a loaded shell in the bore: a block welded in front of it, in this body's frame.
   * It comes out of this body's own mass when a shell loads, and goes back into it when the fire
   * command arrives, just before the charge fires, so the shell can't roll out but can be fired.
   */
  stop?: { shape: Shape; mass: number; at: Vec2; angle?: number };
  /**
   * A railgun (WPN-008): shells are not loaded into the bore but launched from `at` along the bore
   * at `speed`, the moment the channel is on and `reload` has passed since the last shot. No stop.
   */
  railgun?: Railgun;
  /** State: seconds since the last load (a railgun: since the last shot); shells loaded or fired so far (names the next). */
  timer: number;
  loaded: number;
}

/**
 * An injector draws propellant from its own stores (topped up by feed links) when its control
 * channel is non-zero, and emits it as gas parcels at its outlet. With an igniter, what it emits
 * burns at once. It applies no force of its own: thrust comes only from gas on walls (§9.5).
 */
export interface Injector {
  /** Control channel that commands it, received through a control link (0–1). */
  channel: string;
  /** Mass flow at command 1, kg/s. */
  rate: number;
  /** Mass fractions drawn from its stores, e.g. { h2: 1/9, o2: 8/9 }. */
  mixture: Record<string, number>;
  /** Where parcels appear and which way they go, body-local. */
  outlet: Vec2;
  direction: Vec2;
  /** Parcels are spread across this width at the outlet, m. */
  width: number;
  /** Injection speed relative to the body, m/s. */
  speed: number;
  /** Mass of each parcel, kg, and its radius, m. */
  parcelMass: number;
  radius: number;
  igniter: boolean;
  /**
   * The engine's interior downstream of the outlet (chamber, throat, nozzle), m: `width` across
   * the outlet direction, `length` along it. It is closed out of the plane, so gas in it never
   * spreads out of the plane in a world with `bounds.depth` (GAS-009). Absent: no interior.
   */
  chamber?: { width: number; length: number };
  /**
   * Fuel economy (FLT-010, a flight-test cheat): the stores supply 1/economy of each parcel's mass,
   * so propellant lasts `economy` times as long at the same thrust. The rest is made from nothing,
   * and the ledger records it under `supply`. Absent or 1: mass is conserved.
   */
  economy?: number;
  /** State: gas held in the chamber as one volume, when the engine's walls enclose it (§10.1). */
  vessel?: Vessel;
  /** State: mass allowed by the command but not yet emitted, kg; parcels emitted so far; firing now. */
  credit: number;
  count: number;
  firing: boolean;
}

export const INJECTOR_DEFAULTS: Omit<Injector, "channel"> = {
  rate: 0.5,
  mixture: { h2: 1 / 9, o2: 8 / 9 },
  outlet: { x: 0, y: -0.15 },
  direction: { x: 0, y: -1 },
  width: 0.6,
  speed: 10,
  parcelMass: 0.001,
  radius: 0.035,
  igniter: true,
  credit: 0,
  count: 0,
  firing: false,
};

/** Why an injector is or isn't firing (INS-006). */
export function injectorStatus(world: World, body: Body): { firing: boolean; reason: string } {
  const inj = body.injector;
  if (!inj) return { firing: false, reason: "Not an injector" };
  if (body.integrity <= 0) return { firing: false, reason: "Destroyed" };
  // A link switched off carries nothing (Mammoth Thrust's shock takes a ship's controls for a moment).
  const hasLink = world.links.some((l) => l.kind === "control" && l.to === body.id && l.channel === inj.channel && !l.off);
  if (!hasLink) return { firing: false, reason: `No control link for channel "${inj.channel}"` };
  const command = world.controls[inj.channel] ?? 0;
  if (!(command > 0)) return { firing: false, reason: `Idle: ${inj.channel} = 0` };
  for (const [res, y] of Object.entries(inj.mixture)) {
    if (!(y > 0)) continue;
    const st = body.contents?.find((c) => c.resource === res);
    if (!st) return { firing: false, reason: `No ${res} store on the injector` };
    if (st.mass < (inj.parcelMass / (inj.economy ?? 1)) * y) {
      const fed = world.links.some((l) => l.kind === "feed" && l.to === body.id && l.resource === res);
      return { firing: false, reason: fed ? `No ${res}: the tank feeding it is empty` : `No feed: nothing links ${res} to it` };
    }
  }
  return { firing: true, reason: `Firing at ${(command * 100).toFixed(0)}%` };
}

const GOLDEN = 0.6180339887498949;

/** Body as written in scenarios and commands: material fields are optional. */
export type BodyInput = Omit<Body, "fixed" | "restitution" | "friction" | "injector" | "integrity" | "magazine" | "tractor" | "collector" | "pilot" | "turret"> &
  Partial<Pick<Body, "fixed" | "restitution" | "friction" | "integrity">> & { injector?: InjectorInput; magazine?: MagazineInput; tractor?: TractorInput; collector?: CollectorInput; pilot?: PilotInput; turret?: TurretInput };

/** A magazine as written in scenarios: its state starts at zero. */
export type MagazineInput = Omit<Magazine, "timer" | "loaded"> & Partial<Pick<Magazine, "timer" | "loaded">>;

/** An injector as written in scenarios: everything but the channel has a default. */
export type InjectorInput = Pick<Injector, "channel"> & Partial<Omit<Injector, "channel">>;

export interface JointLimits {
  tension: number; // N
  compression: number; // N
  shear: number; // N
  torque: number; // N·m
}

export const JOINT_DEFAULT_LIMITS: JointLimits = { tension: 5000, compression: 10000, shear: 3000, torque: 2000 };

/** A weld between two bodies (ASM-003). */
export interface Joint {
  id: string;
  a: string;
  b: string;
  /** Anchor on a and on b, in each body's local coordinates, m. */
  anchorA: Vec2;
  anchorB: Vec2;
  /** Unit axis in a's local frame for tension/compression; shear is across it. */
  axis: Vec2;
  /** b.angle − a.angle held by the weld, rad. */
  referenceAngle: number;
  limits: JointLimits;
  /** Last step's accumulated impulse on b (warm start), N·s and N·m·s. */
  impulse: { x: number; y: number; angular: number };
  /** Impulse the joint passed on from gas pushing its assembly last step (on b's side, about b's anchor). */
  gasImpulse?: { x: number; y: number; angular: number };
  /** 1 whole, 0 broken (DMG-001). Its limits scale with it: a damaged weld breaks more easily. */
  integrity: number;
  /** Last step's load; fraction is the worst of each load ÷ its (damaged) limit. */
  load: { tension: number; compression: number; shear: number; torque: number; fraction: number };
  /** A hidden seam of a larger asteroid fragment (AST-007): the limits it takes once revealed. */
  hidden?: JointLimits;
  /**
   * Where it starts to bend (DMG-008): a load beyond this share of its whole limits costs integrity,
   * down to 1 − (share − yield) ÷ (1 − yield), so it is left weaker and breaks sooner. The worst
   * load sets it: bending doesn't heal. Absent: it holds whole until it breaks.
   */
  yield?: number;
  /** It can be turned (ASM-008): its rest angle moves toward a target at a rate. See turret.ts. */
  turn?: JointTurn;
}

export type JointInput = Pick<Joint, "id" | "a" | "b" | "anchorA" | "anchorB"> & Partial<Pick<Joint, "axis" | "referenceAngle" | "integrity" | "hidden" | "yield" | "turn">> & { limits?: Partial<JointLimits> };

/** Zero-mass connections (ASM-006): feed links move a resource between stores; control links carry a channel to a component. */
export type Link = (
  | { id: string; kind: "feed"; from: string; to: string; resource: string; rate: number /* kg/s */ }
  | { id: string; kind: "control"; channel: string; to: string }
) & {
  /** 1 whole, 0 broken (DMG-001). It falls with damage to either end. Absent in a scenario: 1. */
  integrity: number;
  /** A control link switched off for now carries nothing, though whole (Mammoth Thrust's shock, plant.ts). */
  off?: boolean;
};

/** A link as written in scenarios: integrity defaults to 1. */
export type LinkInput = Link extends infer L ? (L extends Link ? Omit<L, "integrity"> & { integrity?: number } : never) : never;

export const BODY_DEFAULTS = { fixed: false, restitution: 0.5, friction: 0.4 } as const;

/** A user drag: a bounded, critically damped spring from a point on a body to a target (SBX-012). */
export interface Drag {
  id: string;
  /** Point on the body, in body-local coordinates, m. */
  anchor: Vec2;
  target: Vec2;
  /** Spring stiffness per kg, 1/s². */
  stiffness: number;
  /** Force limit per kg, m/s². */
  maxAcceleration: number;
}

export interface Contact {
  a: string;
  b: string;
  key: number;
  point: Vec2;
  /** Unit normal from a to b. */
  normal: Vec2;
  separation: number; // m
  normalImpulse: number; // N·s
  tangentImpulse: number; // N·s
  /** Kinetic energy this contact turned into heat this step, J (COL-006). */
  energyLost: number;
  /**
   * In a wrapped world, set when the pair met across an edge (FLT-015): b's copy was at its position
   * + shift. `point` is on a's side; on b it is `point − shift`.
   */
  shift?: Vec2;
}

export interface WorldEvent {
  tick: number;
  type: string;
  data: Record<string, number | string | boolean>;
}

export interface World {
  schema: number;
  tick: number;
  time: number; // s
  rng: RngState;
  /** Uniform gravitational field, m/s². */
  gravity: Vec2;
  /** Gas outside this rectangle leaves the world. */
  bounds: Bounds;
  bodies: Body[];
  gas: GasState;
  joints: Joint[];
  links: Link[];
  /** Current value of each control channel. */
  controls: Record<string, number>;
  drags: Drag[];
  contacts: Contact[];
  ledger: Ledger;
  events: WorldEvent[];
  /** Changes made by commands since the last step, attributed to the user at the next step. */
  pendingUser: Delta;
  /** Bodies touched by unattributed debug commands since the last step. */
  pendingDebug: string[];
  /** A landing challenge, judged after every step (FLT-005). */
  challenge?: Challenge;
  /** Mammoth Lander's game: ships, lives and pads (docs/games/mammoth-lander.md). */
  lander?: LanderGame;
  /** A combat duel, judged after every step (DUEL-001). */
  duel?: Duel;
  /** Mammoth Asteroids' game: levels, gold, lives and the score (docs/games/mammoth-asteroids.md). */
  arcade?: ArcadeGame;
  /** Ground from an outline, which explosions and shells crater (TER): see terrain.ts. */
  terrain?: Terrain;
  /** Mammoth Thrust's game: ships, the pod and the level's top (docs/games/mammoth-thrust.md). */
  thrust?: ThrustGame;
  /** Blast gas held for a step after its shell burst (WPN): see explosive.ts. */
  blasts?: Blast[];
  /** The plume's tail: gas gone from the gas model, fading out (GAS-011): see wisps.ts. */
  wisps?: Wisp[];
  /** Dust left by destroyed bodies, drifting and fading (DMG-007): see dust.ts. Only drawn. */
  dust?: Dust[];
}

/** Commands are the only way to change a world other than stepping it. */
export type Command =
  | { type: "body.add"; body: BodyInput }
  | { type: "body.remove"; id: string }
  | { type: "body.set"; id: string; patch: Partial<Omit<Body, "id">> }
  | { type: "body.impulse"; id: string; impulse: Vec2; point: Vec2 }
  | { type: "drag.set"; id: string; anchor: Vec2; target: Vec2; stiffness?: number; maxAcceleration?: number }
  | { type: "drag.clear"; id: string }
  | { type: "world.set"; patch: { gravity?: Vec2; bounds?: Bounds } }
  /** Fills a rectangle with gas parcels (GAS-001). Refused if it would exceed limit.gasParcels (PRF-003). */
  | { type: "gas.fill"; fill: GasFill }
  /** Removes every parcel inside the rectangle. */
  | { type: "gas.remove"; min: Vec2; max: Vec2 }
  | { type: "joint.add"; joint: JointInput }
  | { type: "joint.remove"; id: string }
  | { type: "joint.set"; id: string; limits: Partial<JointLimits> }
  /** Gives a pilot a new goal and/or skills (AIP-017); it keeps what it has learned. */
  | { type: "pilot.set"; id: string; goal?: PilotGoal; skill?: Partial<Pilot["skill"]> }
  /** Removes every joint touching the body: it leaves its assembly with its own momentum. */
  | { type: "body.detach"; id: string }
  | { type: "link.add"; link: LinkInput }
  | { type: "link.remove"; id: string }
  | { type: "control.set"; channel: string; value: number }
  | { type: "rng.sample"; label: string }
  /** Test hook: changes a velocity WITHOUT telling the ledger, to exercise violation reporting. */
  | { type: "debug.kick"; id: string; dv: Vec2 };

export function normalizeBody(input: BodyInput): Body {
  const { injector, magazine, tractor, collector, pilot, turret, ...rest } = structuredClone(input);
  const body: Body = { ...BODY_DEFAULTS, integrity: 1, ...rest };
  if (turret) body.turret = normalizeTurret(turret);
  if (tractor) body.tractor = normalizeTractor(tractor);
  if (collector) body.collector = normalizeCollector(collector);
  if (pilot) body.pilot = normalizePilot(pilot);
  if (injector) body.injector = { ...INJECTOR_DEFAULTS, ...injector };
  // A full reload time has passed at the start, so the first shell loads at once.
  if (magazine) body.magazine = { timer: magazine.reload, loaded: 0, ...magazine };
  if (body.shape.kind === "polygon") {
    const { vertices, centroid } = normalizePolygon(body.shape.vertices);
    body.shape = { kind: "polygon", vertices };
    // Keep the polygon where the author put it: the position moves to its centroid.
    body.position = add(body.position, rotate(sinCos(body.angle), centroid));
  }
  if (body.fixed) {
    body.velocity = { x: 0, y: 0 };
    body.angularVelocity = 0;
  }
  return body;
}

export function createWorld(
  seed: number,
  bodies: BodyInput[] = [],
  gravity: Vec2 = { x: 0, y: 0 },
  extra: { joints?: JointInput[]; links?: LinkInput[]; gas?: GasFill[]; bounds?: Bounds; challenge?: LandingGoal; duel?: DuelGoal; lander?: LanderSpec; arcade?: ArcadeSpec; thrust?: ThrustSpec; terrain?: TerrainSpec } = {},
  profile?: Profile,
): World {
  const gasScale = profile?.gasScale ?? 1;
  const world: World = {
    schema: WORLD_SCHEMA,
    tick: 0,
    time: 0,
    rng: createRng(seed),
    gravity: { ...gravity },
    bounds: structuredClone(extra.bounds ?? DEFAULT_BOUNDS),
    bodies: [],
    gas: profile?.gasParcelRate ? { ...emptyGas(gasScale), parcelRate: profile.gasParcelRate } : emptyGas(gasScale),
    joints: [],
    links: [],
    controls: {},
    drags: [],
    contacts: [],
    ledger: emptyLedger(),
    events: [],
    pendingUser: zeroDelta(),
    pendingDebug: [],
  };
  for (const body of bodies) addBody(world, body);
  // The ground's rock, from its outline (TER-001).
  if (extra.terrain) world.terrain = startTerrain(world, extra.terrain, TERRAIN_OPS);
  for (const j of extra.joints ?? []) addJoint(world, j);
  for (const l of extra.links ?? []) addLink(world, l);
  for (const f of extra.gas ?? []) fillGas(world, f, profile);
  world.events = [];
  // Mammoth Asteroids starts with its first ship and level in the world.
  if (extra.arcade) world.arcade = startArcade(world, extra.arcade, ARCADE_OPS);
  // Mammoth Thrust starts with its first ship in the world.
  if (extra.thrust) world.thrust = startThrust(world, extra.thrust, ARCADE_OPS);
  world.ledger.totals = computeTotals(world);
  if (extra.challenge) world.challenge = startLanding(world, structuredClone(extra.challenge));
  if (extra.lander) world.lander = startLander(extra.lander);
  if (extra.duel) world.duel = startDuel(world, structuredClone(extra.duel));
  return world;
}

export function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function addBody(world: World, input: BodyInput): void {
  if (world.bodies.some((b) => b.id === input.id)) throw new Error(`Duplicate body id "${input.id}"`);
  world.bodies.push(normalizeBody(input));
  world.bodies.sort((a, b) => compareIds(a.id, b.id));
}

export function addJoint(world: World, input: JointInput): void {
  if (world.joints.some((j) => j.id === input.id)) throw new Error(`Duplicate joint id "${input.id}"`);
  if (input.a === input.b) throw new Error("A joint needs two different bodies");
  const a = findBody(world, input.a);
  const b = findBody(world, input.b);
  const al = length(input.anchorA);
  const joint: Joint = {
    id: input.id,
    a: input.a,
    b: input.b,
    anchorA: { ...input.anchorA },
    anchorB: { ...input.anchorB },
    axis: input.axis ? scale(input.axis, 1 / length(input.axis)) : al > 1e-9 ? scale(input.anchorA, 1 / al) : { x: 1, y: 0 },
    referenceAngle: input.referenceAngle ?? b.angle - a.angle,
    limits: { ...JOINT_DEFAULT_LIMITS, ...input.limits },
    impulse: { x: 0, y: 0, angular: 0 },
    integrity: input.integrity ?? 1,
    load: { tension: 0, compression: 0, shear: 0, torque: 0, fraction: 0 },
    ...(input.hidden ? { hidden: { ...input.hidden } } : {}),
    ...(input.yield !== undefined ? { yield: input.yield } : {}),
    ...(input.turn ? { turn: { ...input.turn } } : {}),
  };
  world.joints = [...world.joints, joint].sort((p, q) => compareIds(p.id, q.id));
}

function addLink(world: World, input: LinkInput): void {
  const link = { integrity: 1, ...input } as Link;
  if (world.links.some((l) => l.id === link.id)) throw new Error(`Duplicate link id "${link.id}"`);
  const to = findBody(world, link.to);
  if (link.kind === "feed") {
    const from = findBody(world, link.from);
    if (from.id === to.id) throw new Error("A feed link needs two different stores");
    for (const b of [from, to]) {
      if (!b.contents?.some((s) => s.resource === link.resource)) throw new Error(`Feed links need a "${link.resource}" store at both ends; ${b.id} has none`);
    }
  }
  world.links = [...world.links, structuredClone(link)].sort((p, q) => compareIds(p.id, q.id));
}

/** How Mammoth Asteroids' game adds its ships and rocks: as commands do. */
const ARCADE_OPS: ArcadeOps = { addBody, addJoint, addLink };
/** How the ground adds to the world: also what tests and tools hand to `cutCrater`. */
export const TERRAIN_OPS: TerrainOps = { addBody, addJoint };

/** Control channels reaching a body through intact control links, with their values (ASM-006). */
export function controlInputs(world: World, bodyId: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const l of world.links) if (l.kind === "control" && l.to === bodyId) out[l.channel] = world.controls[l.channel] ?? 0;
  return out;
}

/**
 * Feed links move resource mass between stores at up to their rate. The receiving body's
 * velocity is updated so momentum is conserved; the mixing loses a little kinetic energy as heat.
 */
function runFeeds(world: World, dt: number): { touchedFixed: boolean; spinShift: number } {
  let touchedFixed = false;
  let spinShift = 0;
  // Bodies by id (ids are unique: adding a duplicate throws), shared and kept between steps.
  let byId: ReadonlyMap<string, Body> | undefined;
  for (const l of world.links) {
    if (l.kind !== "feed") continue;
    byId ??= bodiesById(world);
    const from = l.from === undefined ? undefined : byId.get(l.from);
    const to = byId.get(l.to);
    const src = from?.contents?.find((s) => s.resource === l.resource);
    const dst = to?.contents?.find((s) => s.resource === l.resource);
    if (!from || !to || !src || !dst) continue;
    const dm = Math.min(l.rate * dt, src.mass, Math.max(0, dst.capacity - dst.mass));
    if (!(dm > 0)) continue;
    if (from.fixed || to.fixed) touchedFixed = true;
    // A store's contents spin with its body (its inertia counts them): both bodies keep their spin,
    // so the spin energy and angular momentum the mass takes with it shift between them (recorded
    // as a transfer, with the angular momentum).
    const spin = (x: Body) => 0.5 * massProps(x.shape, bodyMass(x)).inertia * x.angularVelocity * x.angularVelocity;
    const spin0 = spin(from) + spin(to);
    const keBefore = 0.5 * dm * (from.velocity.x ** 2 + from.velocity.y ** 2) + 0.5 * bodyMass(to) * (to.velocity.x ** 2 + to.velocity.y ** 2);
    const mTo = bodyMass(to);
    if (!to.fixed) to.velocity = { x: (mTo * to.velocity.x + dm * from.velocity.x) / (mTo + dm), y: (mTo * to.velocity.y + dm * from.velocity.y) / (mTo + dm) };
    src.mass -= dm;
    dst.mass += dm;
    const keAfter = 0.5 * bodyMass(to) * (to.velocity.x ** 2 + to.velocity.y ** 2);
    world.ledger.thermal += Math.max(0, keBefore - keAfter);
    spinShift += spin(from) + spin(to) - spin0;
  }
  return { touchedFixed, spinShift };
}

/** Adds parcels for a fill, or refuses it if the parcel limit would be exceeded (PRF-003). */
function fillGas(world: World, fill: GasFill, profile?: Profile): void {
  const limit = profile?.limit.gasParcels ?? Infinity;
  const parcels = makeFill(fill, world.rng, wallBodies(world.bodies), world.gas.nextId, limit - world.gas.count, world.gas.scale ?? 1);
  if (!parcels) {
    pushEvent(world, { tick: world.tick, type: "limit.refused", data: { entity: "gasParcels", requested: fill.count, existing: world.gas.count, limit } });
    return;
  }
  for (const p of parcels) addParcel(world.gas, p);
  world.gas.nextId += parcels.length;
  pushEvent(world, { tick: world.tick, type: "gas.fill", data: { requested: fill.count, created: parcels.length } });
}

/**
 * Injectors emit propellant from their stores as gas parcels (PRP-002). Mass moves from the
 * store to the parcel; the injector recoils so momentum is unchanged; the parcel carries the
 * store's thermal and chemical energy, less any kinetic energy the injection gained, so energy
 * is unchanged too. Returns the parcels made.
 */
/** Shortest offset from a to b in a world that may wrap round (the nearest periodic image). */
export function nearestOffset(world: World, a: Vec2, b: Vec2): Vec2 {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (world.bounds.wrap) {
    const w = world.bounds.max.x - world.bounds.min.x;
    const h = world.bounds.max.y - world.bounds.min.y;
    dx -= w * Math.round(dx / w);
    dy -= h * Math.round(dy / h);
  }
  return { x: dx, y: dy };
}

/**
 * Gravity from bodies that carry it (FLT-011), as a kick on every other free body and gas parcel.
 * It is a field, like uniform gravity: the impulses it gives are recorded under `field`.
 */
function applyAttractors(world: World, rbs: RB[], dt: number, field: { impulse: Vec2; angular: number }): void {
  const src = world.bodies.filter((b) => b.gravity && b.gravity.mu > 0);
  if (!src.length) return;
  // Sources that feel each other (FLT-014): a source never pulls its own assembly's parts.
  const roots = world.bodies.some((b) => b.gravity?.feels || b.gravity?.joined) ? assemblyRoots(world) : null;
  // The sources as plain numbers, and the nearest copy worked out in place (as nearestOffset does):
  // with every piece of every rock a source (AST-009) this loop runs sources × bodies times a step.
  const sx: number[] = [];
  const sy: number[] = [];
  const mu: number[] = [];
  const core2: number[] = [];
  /** Each source's body (a group of joined sources has none), and its assembly. */
  const sid: string[] = [];
  const sroot: string[] | null = roots ? [] : null;
  // Joined sources (AST-011) pull as one for each assembly: gathered here, in order of first appearance.
  const groups = new Map<string, { mu: number; mx: number; my: number; members: Body[]; at: number }>();
  for (const s of src) {
    const g = s.gravity!;
    const root = roots ? (roots.get(s.id) ?? s.id) : s.id;
    if (g.joined) {
      let group = groups.get(root);
      if (!group) {
        groups.set(root, (group = { mu: 0, mx: 0, my: 0, members: [], at: sx.length }));
        // Its place in the lists, filled in below.
        sx.push(0);
        sy.push(0);
        mu.push(0);
        core2.push(0);
        sid.push("");
        sroot!.push(root);
      }
      group.mu += g.mu;
      group.mx += g.mu * s.position.x;
      group.my += g.mu * s.position.y;
      group.members.push(s);
      continue;
    }
    sx.push(s.position.x);
    sy.push(s.position.y);
    mu.push(g.mu);
    core2.push(g.core * g.core);
    sid.push(s.id);
    sroot?.push(root);
  }
  for (const group of groups.values()) {
    const cx = group.mx / group.mu;
    const cy = group.my / group.mu;
    // Its reach: the furthest of its members' own cores from the centre. Softened by half of it,
    // so the pull at a round rock's surface is about 0.7 of mu / R², and falls to nothing at its centre.
    let reach = 0;
    for (const m of group.members) {
      const dx = m.position.x - cx;
      const dy = m.position.y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) + m.gravity!.core;
      if (d > reach) reach = d;
    }
    sx[group.at] = cx;
    sy[group.at] = cy;
    mu[group.at] = group.mu;
    core2[group.at] = 0.25 * reach * reach;
  }
  const n = sx.length;
  const wrap = !!world.bounds.wrap;
  const w = world.bounds.max.x - world.bounds.min.x;
  const h = world.bounds.max.y - world.bounds.min.y;
  const out = { x: 0, y: 0 };
  /** The pull at p, into `out`. */
  const pull = (p: Vec2, self?: string, root?: string): Vec2 => {
    let ax = 0;
    let ay = 0;
    for (let i = 0; i < n; i++) {
      if (self !== undefined && sid[i] === self) continue;
      if (root !== undefined && sroot![i] === root) continue;
      let dx = sx[i] - p.x;
      let dy = sy[i] - p.y;
      if (wrap) {
        dx -= w * Math.round(dx / w);
        dy -= h * Math.round(dy / h);
      }
      const r2 = dx * dx + dy * dy + core2[i];
      const k = mu[i] / (r2 * Math.sqrt(r2));
      ax += k * dx;
      ay += k * dy;
    }
    out.x = ax;
    out.y = ay;
    return out;
  };
  for (const r of rbs) {
    if (r.invMass === 0 || (r.body.gravity && !r.body.gravity.feels)) continue;
    const a = r.body.gravity ? pull(r.body.position, r.body.id, roots!.get(r.body.id) ?? r.body.id) : pull(r.body.position, r.body.id);
    r.body.velocity = { x: r.body.velocity.x + a.x * dt, y: r.body.velocity.y + a.y * dt };
    const J = { x: r.mass * a.x * dt, y: r.mass * a.y * dt };
    field.impulse.x += J.x;
    field.impulse.y += J.y;
    field.angular += cross(r.body.position, J);
  }
  const gas = world.gas;
  const at = { x: 0, y: 0 };
  for (let i = 0; i < gas.count; i++) {
    at.x = gas.x[i];
    at.y = gas.y[i];
    const a = pull(at);
    gas.vx[i] = gas.vx[i] + a.x * dt;
    gas.vy[i] = gas.vy[i] + a.y * dt;
    const Jx = gas.mass[i] * a.x * dt;
    const Jy = gas.mass[i] * a.y * dt;
    field.impulse.x += Jx;
    field.impulse.y += Jy;
    field.angular += at.x * Jy - at.y * Jx;
  }
}

/**
 * Wraps a wrapped world round (FLT-012). A free assembly whose centre of mass has left the
 * rectangle moves, whole, by one width or height back into it, so its welds see nothing. Gas within
 * its far field (or 10 m) moves with it, so its own exhaust and chamber gas stay with it. Returns
 * whether anything moved.
 */
function wrapAround(world: World): boolean {
  const b = world.bounds;
  const w = b.max.x - b.min.x;
  const h = b.max.y - b.min.y;
  const roots = world.joints.length ? assemblyRoots(world) : null;
  // Free assemblies only: one with a fixed part never wraps. Hundreds of fixed ground bodies were
  // grouped every step only to be skipped; the free groups keep the same order.
  const anchored = new Set<string>();
  for (const body of world.bodies) if (body.fixed) anchored.add(roots?.get(body.id) ?? body.id);
  const groups = new Map<string, Body[]>();
  for (const body of world.bodies) {
    const r = roots?.get(body.id) ?? body.id;
    if (anchored.has(r)) continue;
    const g = groups.get(r);
    if (g) g.push(body);
    else groups.set(r, [body]);
  }
  const reach = b.farField ?? 10;
  const movedParcels = new Set<number>();
  const gas = world.gas;
  const near: { x: number; y: number; r2: number }[] = [];
  let moved = false;
  for (const members of groups.values()) {
    if (members.some((m) => m.fixed)) continue;
    let m = 0;
    let cx = 0;
    let cy = 0;
    for (const x of members) {
      const mm = bodyMass(x);
      m += mm;
      cx += mm * x.position.x;
      cy += mm * x.position.y;
    }
    if (!(m > 0)) continue;
    cx /= m;
    cy /= m;
    let rad = 0;
    for (const x of members) {
      const dx = x.position.x - cx;
      const dy = x.position.y - cy;
      rad = Math.max(rad, Math.sqrt(dx * dx + dy * dy) + boundingRadiusOf(x.shape));
    }
    const r2 = (rad + reach) * (rad + reach);
    const sx = cx < b.min.x ? w : cx >= b.max.x ? -w : 0;
    const sy = cy < b.min.y ? h : cy >= b.max.y ? -h : 0;
    near.push({ x: cx + sx, y: cy + sy, r2 });
    if (sx === 0 && sy === 0) continue;
    moved = true;
    for (const x of members) x.position = { x: x.position.x + sx, y: x.position.y + sy };
    for (let i = 0; i < gas.count; i++) {
      if (movedParcels.has(gas.id[i])) continue;
      const dx = gas.x[i] - cx;
      const dy = gas.y[i] - cy;
      if (dx * dx + dy * dy > r2) continue;
      gas.x[i] = gas.x[i] + sx;
      gas.y[i] = gas.y[i] + sy;
      movedParcels.add(gas.id[i]);
    }
  }
  // Gas outside the rectangle wraps on its own, unless it is near a free assembly: that gas (in a
  // chamber straddling the edge, say) waits outside until the assembly itself wraps and takes it.
  for (let i = 0; i < gas.count; i++) {
    if (movedParcels.has(gas.id[i])) continue;
    const x = gas.x[i];
    const y = gas.y[i];
    if (x >= b.min.x && x < b.max.x && y >= b.min.y && y < b.max.y) continue;
    if (near.some((c) => (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r2)) continue;
    gas.x[i] = x < b.min.x ? x + w : x >= b.max.x ? x - w : x;
    gas.y[i] = y < b.min.y ? y + h : y >= b.max.y ? y - h : y;
    moved = true;
  }
  return moved;
}

/** Each injector's declared interior as a rectangle in the world, at the bodies' current pose (GAS-009). */
function engineInteriors(world: World): ClosedRegion[] {
  const out: ClosedRegion[] = [];
  for (const b of world.bodies) {
    const ch = b.injector?.chamber;
    if (!ch) continue;
    const q = sinCos(b.angle);
    const o = add(b.position, rotate(q, b.injector!.outlet));
    const d = rotate(q, b.injector!.direction);
    const len = length(d);
    if (!(len > 0)) continue;
    out.push({ x: o.x, y: o.y, ux: d.x / len, uy: d.y / len, halfWidth: ch.width / 2, length: ch.length });
  }
  return out;
}

/**
 * Makes one parcel of mass `dm` from a body's stores and sends it off at `point` with velocity
 * `vParcel` (PRP-002, DMG-004). `draw` kg comes from the stores in the fractions `parts`; the rest,
 * if any, is made from nothing (an economy, FLT-010). Mass moves from the store to the parcel, the
 * body recoils so momentum is unchanged, and the parcel carries the store's thermal energy less
 * any kinetic energy the emission gained, so energy is unchanged too.
 */
function emitParcel(world: World, b: Body, parts: [string, number][], dm: number, draw: number, point: Vec2, vParcel: Vec2, radius: number): Parcel {
  const gs = world.gas.scale ?? 1;
  const r = sub(point, b.position);
  const vPoint = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
  // Kinetic energy of the body before the mass leaves it.
  const ke = (body: Body) => {
    const m = bodyMass(body);
    return 0.5 * m * (body.velocity.x ** 2 + body.velocity.y ** 2) + 0.5 * massProps(body.shape, m).inertia * body.angularVelocity ** 2;
  };
  // Mass made by an economy above 1 (FLT-010) appears moving with the outlet: its kinetic energy
  // there is supplied, not work the emission does, so it must not cool the gas.
  const supplied = dm - draw;
  const before = ke(b) + 0.5 * supplied * (vPoint.x ** 2 + vPoint.y ** 2);
  let thermal = 0;
  const composition: Record<string, number> = {};
  for (const [res, y] of parts) {
    const st = b.contents!.find((c) => c.resource === res)!;
    st.mass -= draw * y;
    if (st.mass < 0) st.mass = 0;
    composition[res] = y;
    const sp = mixture({ [res]: 1 });
    thermal += (dm * y * sp.cv * STORE_TEMPERATURE) / gs;
  }
  // Recoil: the body gives the parcel its relative velocity (momentum conserved).
  const J = { x: -dm * (vParcel.x - b.velocity.x), y: -dm * (vParcel.y - b.velocity.y) };
  const m1 = bodyMass(b);
  const I1 = massProps(b.shape, m1).inertia;
  b.velocity = add(b.velocity, scale(J, 1 / m1));
  b.angularVelocity += cross(r, J) / I1;
  const after = ke(b) + 0.5 * dm * (vParcel.x ** 2 + vParcel.y ** 2);
  return {
    id: world.gas.nextId++,
    mass: dm,
    composition,
    position: point,
    velocity: vParcel,
    thermal: Math.max(0, thermal - (after - before)),
    radius,
  };
}

function runInjectors(world: World, dt: number, profile?: Profile): Parcel[] {
  const made: Parcel[] = [];
  const gs = world.gas.scale ?? 1;
  const limit = profile?.limit.gasParcels ?? Infinity;
  const roots = world.bodies.some((b) => b.injector?.chamber) ? assemblyRoots(world) : null;
  const index = roots ? bodyIndex(world) : undefined;
  for (const b of world.bodies) {
    const inj = b.injector;
    if (!inj || b.fixed) continue;
    const status = injectorStatus(world, b);
    const command = Math.min(1, Math.max(0, world.controls[inj.channel] ?? 0));
    if (status.firing !== inj.firing) {
      inj.firing = status.firing;
      if (status.firing) pushEvent(world, { tick: world.tick, type: "ignition", data: { id: b.id } });
    }
    // An engine whose walls enclose its chamber holds the gas there as one volume (§10.1).
    const shape = roots && inj.chamber ? holdingShape(world, b, roots, index) : null;
    if (shape) {
      // A damaged engine delivers less: its flow falls with its integrity (LND-021).
      const drawn = status.firing ? drawPropellant(b, command * inj.rate * b.integrity * dt, gs) : null;
      inj.credit = 0;
      for (const p of runVessel(world, b, shape, drawn, dt, limit)) {
        addParcel(world.gas, p);
        made.push(p);
      }
      continue;
    }
    if (inj.vessel) {
      // No longer enclosed: the chamber's gas spills out where it was.
      for (const p of spill(world, b)) {
        addParcel(world.gas, p);
        made.push(p);
      }
    }
    if (!status.firing) {
      inj.credit = 0;
      continue;
    }
    inj.credit += command * inj.rate * b.integrity * dt;
    while (inj.credit >= inj.parcelMass && world.gas.count < limit) {
      const stores = Object.entries(inj.mixture).filter(([, y]) => y > 0);
      if (stores.some(([res, y]) => (b.contents?.find((c) => c.resource === res)?.mass ?? 0) < (inj.parcelMass / (inj.economy ?? 1)) * y)) break;
      const dm = inj.parcelMass;
      const q = sinCos(b.angle);
      // Spread across the outlet in mirrored pairs, so injection itself is symmetric.
      const spread = (inj.count % 2 === 0 ? 1 : -1) * (((Math.floor(inj.count / 2) * GOLDEN) % 1) * 0.5);
      const local = add(inj.outlet, scale({ x: -inj.direction.y, y: inj.direction.x }, spread * inj.width));
      const point = add(b.position, rotate(q, local));
      const r = sub(point, b.position);
      const vPoint = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
      const vParcel = add(vPoint, scale(rotate(q, inj.direction), inj.speed));
      const p = emitParcel(world, b, stores, dm, dm / (inj.economy ?? 1), point, vParcel, inj.radius);
      if (inj.igniter) burn(p, gs);
      addParcel(world.gas, p);
      made.push(p);
      inj.credit -= dm;
      inj.count += 1;
    }
    inj.credit = Math.min(inj.credit, inj.parcelMass);
  }
  return made;
}

/**
 * Draws up to `want` kg of propellant from an injector's stores in its mixture's fractions (less if a
 * store runs short), with the stores' thermal energy. An economy above 1 (FLT-010) makes the rest of
 * the mass from nothing, as for parcels.
 */
function drawPropellant(b: Body, want: number, gs: number): { mass: number; composition: Record<string, number>; thermal: number } | null {
  const inj = b.injector!;
  const economy = inj.economy ?? 1;
  const parts = Object.entries(inj.mixture).filter(([, y]) => y > 0);
  let dm = want;
  for (const [res, y] of parts) {
    const have = b.contents?.find((c) => c.resource === res)?.mass ?? 0;
    dm = Math.min(dm, (have * economy) / y);
  }
  if (!(dm > 0)) return null;
  const composition: Record<string, number> = {};
  let thermal = 0;
  for (const [res, y] of parts) {
    const st = b.contents!.find((c) => c.resource === res)!;
    st.mass = Math.max(0, st.mass - (dm * y) / economy);
    composition[res] = y;
    thermal += storeEnergy({ resource: res, mass: dm * y }, gs).thermal;
  }
  return { mass: dm, composition, thermal };
}

/**
 * Damaged bodies holding gas leak it through their breach (DMG-004, rule in damage.ts), with the
 * same mass, momentum and energy bookkeeping as an injector: the leak pushes the body like a jet.
 */
/**
 * The bodies the gas phase needs this step: whole assemblies with a part within reach of some gas
 * (the far field, two smoothing lengths and twice the step's travel, with 5 m to spare), and those of
 * `keep`. Bodies beyond it can't touch the gas or keep it from leaving by the far field, so a
 * wreck-strewn world doesn't make a little gas slow. If none of them moves, one moving body is kept,
 * so gas far from everything still leaves as it would (the far field needs something to be far from).
 */
function bodiesNearGas(world: World, dt: number, keep: string[]): Body[] {
  const gas = world.gas;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let vmax = 0;
  let hmax = 0;
  for (let i = 0; i < gas.count; i++) {
    minX = Math.min(minX, gas.x[i]);
    minY = Math.min(minY, gas.y[i]);
    maxX = Math.max(maxX, gas.x[i]);
    maxY = Math.max(maxY, gas.y[i]);
    vmax = Math.max(vmax, Math.sqrt(gas.vx[i] * gas.vx[i] + gas.vy[i] * gas.vy[i]));
    hmax = Math.max(hmax, SMOOTHING * gas.radius[i]);
  }
  const R = (world.bounds.farField ?? 0) + 2 * hmax + 2 * vmax * dt + 5;
  const roots = assemblyRoots(world);
  const rootOf = (id: string) => roots.get(id) ?? id;
  const wanted = new Set(keep.map(rootOf));
  for (const b of world.bodies) {
    const r = boundingRadiusOf(b.shape);
    const reach = R + r + (Math.sqrt(b.velocity.x * b.velocity.x + b.velocity.y * b.velocity.y) + Math.abs(b.angularVelocity) * r) * dt;
    const dx = Math.max(minX - b.position.x, 0, b.position.x - maxX);
    const dy = Math.max(minY - b.position.y, 0, b.position.y - maxY);
    if (dx * dx + dy * dy <= reach * reach) wanted.add(rootOf(b.id));
  }
  if (!world.bodies.some((b) => !b.fixed && wanted.has(rootOf(b.id)))) {
    const moving = world.bodies.find((b) => !b.fixed);
    if (moving) wanted.add(rootOf(moving.id));
  }
  return wanted.size === 0 ? [] : world.bodies.filter((b) => wanted.has(rootOf(b.id)));
}

/**
 * Holes vent gas (DMG-009): each at its body's steady rate, drawn from the store of the body named
 * (or its own), as parcels moving out of the hole. Mass, momentum and energy as a leak's (DMG-004):
 * the store's body gives each parcel its push. A hole pressed against something stays shut.
 */
function runVents(world: World, dt: number, limit: number): void {
  for (const b of world.bodies) {
    const v = b.vents;
    if (!v?.holes.length) continue;
    const src = v.from ? world.bodies.find((o) => o.id === v.from) : b;
    if (!src || src.fixed) continue;
    const roots = v.from ? assemblyRoots(world) : null;
    if (roots && roots.get(src.id) !== roots.get(b.id)) continue;
    const q = sinCos(b.angle);
    const parcel = v.parcel ?? LEAK_PARCEL;
    const radius = v.radius ?? LEAK_RADIUS;
    for (const hole of v.holes) {
      if (hole.count === 0 && hole.credit === 0) pushEvent(world, { tick: world.tick, type: "vent", data: { id: b.id } });
      // A hole's size scales its rate: a hole made bigger vents faster.
      const rate = v.rate * (hole.size ?? 1);
      hole.credit += rate * dt;
      while (hole.credit >= parcel && world.gas.count < limit) {
        const gasses = (src.contents ?? []).filter((s) => SPECIES[s.resource] && s.mass > 0);
        const total = gasses.reduce((t, s) => t + s.mass, 0);
        if (total < parcel) {
          hole.credit = 0;
          break;
        }
        const parts: [string, number][] = gasses.map((s) => [s.resource, s.mass / total]);
        const n = rotate(q, hole.normal);
        const speed = hole.speed ?? LEAK_SPEED;
        const ahead = radius + 0.01 + ((hole.credit - parcel) / rate) * speed;
        const point = add(b.position, add(rotate(q, hole.point), scale(n, ahead)));
        const near = world.bodies.filter((o) => {
          const dx = point.x - o.position.x;
          const dy = point.y - o.position.y;
          const reach = boundingRadiusOf(o.shape) + radius + 1e-6;
          return dx * dx + dy * dy <= reach * reach;
        });
        if (!clearOf(wallBodies(near))(point.x, point.y, radius)) break;
        const r = sub(point, b.position);
        const vPoint = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
        addParcel(world.gas, emitParcel(world, src, parts, parcel, parcel, point, add(vPoint, scale(n, speed)), radius));
        hole.credit -= parcel;
        hole.count += 1;
      }
      hole.credit = Math.min(hole.credit, parcel);
    }
  }
}

function runLeaks(world: World, dt: number, profile?: Profile): void {
  const limit = profile?.limit.gasParcels ?? Infinity;
  runVents(world, dt, limit);
  for (const b of world.bodies) {
    const rate = leakRate(b);
    if (!(rate > 0)) continue;
    if (!b.breach) b.breach = defaultBreach(b);
    const br = b.breach;
    if (br.count === 0 && br.credit === 0) pushEvent(world, { tick: world.tick, type: "leak", data: { id: b.id } });
    br.credit += rate * dt;
    while (br.credit >= LEAK_PARCEL && world.gas.count < limit) {
      const gasses = (b.contents ?? []).filter((s) => SPECIES[s.resource] && s.mass > 0);
      const total = gasses.reduce((t, s) => t + s.mass, 0);
      if (total < LEAK_PARCEL) break;
      const parts: [string, number][] = gasses.map((s) => [s.resource, s.mass / total]);
      const q = sinCos(b.angle);
      const n = rotate(q, br.normal);
      // Across the breach in mirrored pairs (as injectors do), and staggered along the jet by when in
      // the step each parcel's mass would have left, so parcels never start on top of each other.
      const spread = (br.count % 2 === 0 ? 1 : -1) * (((Math.floor(br.count / 2) * GOLDEN) % 1) * 0.5) * BREACH_WIDTH * (1 - b.integrity);
      const speed = br.speed ?? LEAK_SPEED;
      const ahead = LEAK_RADIUS + 0.01 + ((br.credit - LEAK_PARCEL) / rate) * speed;
      const point = add(b.position, add(rotate(q, br.point), add(scale(n, ahead), scale({ x: -n.y, y: n.x }, spread))));
      // Nothing leaks into another body: a breach pressed against something stays shut until it moves off.
      // Only bodies that reach within the clearance can block it (a wreck-strewn world has hundreds).
      const near = world.bodies.filter((o) => {
        const dx = point.x - o.position.x;
        const dy = point.y - o.position.y;
        const reach = boundingRadiusOf(o.shape) + LEAK_RADIUS + 1e-6;
        return dx * dx + dy * dy <= reach * reach;
      });
      if (!clearOf(wallBodies(near))(point.x, point.y, LEAK_RADIUS)) break;
      const r = sub(point, b.position);
      const vPoint = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
      const p = emitParcel(world, b, parts, LEAK_PARCEL, LEAK_PARCEL, point, add(vPoint, scale(n, speed)), LEAK_RADIUS);
      addParcel(world.gas, p);
      br.credit -= LEAK_PARCEL;
      br.count += 1;
    }
    br.credit = Math.min(br.credit, LEAK_PARCEL);
  }
}

/**
 * Magazines load their next shell when the place is clear (WPN, first look). The shell appears moving
 * with that point of the body; the body gives up the shell's mass and the momentum it carries, so
 * mass and momentum are unchanged. Angular momentum and kinetic energy change a little as the mass
 * moves from the body's centre to the bore (recorded as a transfer, like feeds).
 */
function runMagazines(world: World, dt: number): void {
  for (const b of [...world.bodies]) {
    const mag = b.magazine;
    if (!mag || mag.railgun || b.integrity <= 0 || b.fixed) continue;
    // The reload starts once the breech has stopped firing: loading during a shot fired two shells.
    mag.timer = b.injector?.firing ? 0 : mag.timer + dt;
    if (mag.count < 1 || mag.timer < mag.reload - 1e-9) continue;
    const q = sinCos(b.angle);
    const angle = b.angle + mag.angle;
    const id = `${b.id}-shell-${mag.loaded + 1}`;
    // The shell as it will be: a polygon is moved to its centroid, so check the bore where it really lands.
    const shell = normalizeBody({ ...structuredClone(mag.shell), id, position: add(b.position, rotate(q, mag.at)), velocity: { x: 0, y: 0 }, angle, angularVelocity: b.angularVelocity });
    // An explosive shell remembers its gun, and arms once it has left it.
    if (shell.explosive) shell.explosive = { ...shell.explosive, from: b.id, armed: false };
    // Loading into an occupied bore would push bodies apart violently: wait until it is clear.
    const placedShell = { shape: shell.shape, position: shell.position, rot: sinCos(angle) };
    if (world.bodies.some((o) => { const m = collide(placedShell, { shape: o.shape, position: o.position, rot: sinCos(o.angle) }, 0, 0); return m !== null && m.points.some((p) => p.separation < -1e-3); })) continue;
    const r = sub(shell.position, b.position);
    shell.velocity = add(b.velocity, { x: -b.angularVelocity * r.y, y: b.angularVelocity * r.x });
    const m0 = bodyMass(b);
    const ms = bodyMass(mag.shell); // with anything the shell carries
    mag.count -= 1;
    mag.loaded += 1;
    mag.timer = 0;
    // Momentum: the body keeps what the shell doesn't take.
    const m1 = bodyMass(b);
    b.velocity = { x: (m0 * b.velocity.x - ms * shell.velocity.x) / m1, y: (m0 * b.velocity.y - ms * shell.velocity.y) / m1 };
    addBody(world, shell); // already normalised: normalising again changes nothing
    pushEvent(world, { tick: world.tick, type: "loaded", data: { id: b.id, shell: id, left: mag.count } });
    if (mag.stop) deployStop(world, b, mag.stop);
  }
}

const stopId = (b: Body) => `${b.id}-stop`;

/** Puts a magazine's stop in front of the loaded shell: its mass comes out of the body's own, moving with it. */
function deployStop(world: World, b: Body, stop: NonNullable<Magazine["stop"]>): void {
  const id = stopId(b);
  if (world.bodies.some((x) => x.id === id) || !(b.mass > stop.mass)) return;
  const q = sinCos(b.angle);
  const r = rotate(q, stop.at);
  const body = normalizeBody({ id, shape: structuredClone(stop.shape), mass: stop.mass, position: add(b.position, r), velocity: { x: 0, y: 0 }, angle: b.angle + (stop.angle ?? 0), angularVelocity: b.angularVelocity, restitution: 0, friction: 0.3 });
  // As a shell loads: the body keeps the momentum the stop doesn't take.
  const m0 = bodyMass(b);
  body.velocity = add(b.velocity, { x: -b.angularVelocity * (body.position.y - b.position.y), y: b.angularVelocity * (body.position.x - b.position.x) });
  b.mass -= stop.mass;
  const m1 = bodyMass(b);
  b.velocity = { x: (m0 * b.velocity.x - stop.mass * body.velocity.x) / m1, y: (m0 * b.velocity.y - stop.mass * body.velocity.y) / m1 };
  addBody(world, body);
  addJoint(world, { id: `${id}-weld`, a: b.id, b: id, anchorA: { ...stop.at }, anchorB: { x: 0, y: 0 }, limits: { tension: 1e7, compression: 1e7, shear: 1e7, torque: 1e7 } });
}

/**
 * Takes a magazine's stop back into its body when the body is about to fire (commanded, linked and
 * fuelled: before the charge fires this step). Momentum is kept exactly. Spin keeps the stop's motion
 * relative to the body, so it doesn't depend on how fast the two drift together; the small change in
 * angular momentum, as the stop's mass moves to the body's centre, is recorded as a transfer, as when
 * a shell loads. What kinetic energy the merge loses becomes heat.
 */
function retractStops(world: World): void {
  for (const b of world.bodies) {
    const mag = b.magazine;
    if (!mag?.stop || !b.injector || !injectorStatus(world, b).firing) continue;
    const id = stopId(b);
    const stop = world.bodies.find((x) => x.id === id);
    const weld = world.joints.find((j) => j.id === `${id}-weld`);
    if (!stop || !weld) continue; // broken off: it is debris now
    const ke = (x: Body) => {
      const m = bodyMass(x);
      return 0.5 * m * (x.velocity.x ** 2 + x.velocity.y ** 2) + 0.5 * massProps(x.shape, m).inertia * x.angularVelocity ** 2;
    };
    const before = ke(b) + ke(stop);
    const m0 = bodyMass(b);
    const I0 = massProps(b.shape, m0).inertia;
    const r = sub(stop.position, b.position);
    const Ls = cross(r, scale(sub(stop.velocity, b.velocity), stop.mass)) + massProps(stop.shape, stop.mass).inertia * stop.angularVelocity;
    b.mass += stop.mass;
    const m1 = bodyMass(b);
    const I1 = massProps(b.shape, m1).inertia;
    // Momentum, and angular momentum about b's centre, of the two together.
    b.velocity = { x: (m0 * b.velocity.x + stop.mass * stop.velocity.x) / m1, y: (m0 * b.velocity.y + stop.mass * stop.velocity.y) / m1 };
    b.angularVelocity = (I0 * b.angularVelocity + Ls) / I1;
    world.joints = world.joints.filter((j) => j !== weld);
    world.bodies = world.bodies.filter((x) => x !== stop);
    world.ledger.thermal += before - ke(b);
    pushEvent(world, { tick: world.tick, type: "unlatched", data: { id: b.id } });
  }
}

function findBody(world: World, id: string): Body {
  const body = world.bodies.find((b) => b.id === id);
  if (!body) throw new Error(`No body with id "${id}"`);
  return body;
}

function pushEvent(world: World, e: WorldEvent): void {
  world.events.push(e);
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS);
}

function applyOne(world: World, cmd: Command, profile?: Profile): void {
  switch (cmd.type) {
    case "body.add":
      addBody(world, cmd.body);
      break;
    case "body.remove":
      findBody(world, cmd.id);
      world.bodies = world.bodies.filter((b) => b.id !== cmd.id);
      world.joints = world.joints.filter((j) => j.a !== cmd.id && j.b !== cmd.id);
      world.links = world.links.filter((l) => l.to !== cmd.id && (l.kind !== "feed" || l.from !== cmd.id));
      world.drags = world.drags.filter((d) => d.id !== cmd.id);
      world.contacts = world.contacts.filter((c) => c.a !== cmd.id && c.b !== cmd.id);
      break;
    case "body.set": {
      const body = findBody(world, cmd.id);
      Object.assign(body, structuredClone(cmd.patch));
      if (cmd.patch.shape?.kind === "polygon") body.shape = { kind: "polygon", vertices: normalizePolygon(cmd.patch.shape.vertices).vertices };
      if (body.fixed) {
        body.velocity = { x: 0, y: 0 };
        body.angularVelocity = 0;
      }
      break;
    }
    case "body.impulse": {
      const body = findBody(world, cmd.id);
      const m = bodyMass(body);
      const mp = massProps(body.shape, m);
      applyImpulseAt({ body, invMass: body.fixed ? 0 : 1 / m, invInertia: body.fixed ? 0 : 1 / mp.inertia }, cmd.impulse, cmd.point);
      break;
    }
    case "joint.add":
      addJoint(world, cmd.joint);
      break;
    case "joint.remove":
      if (!world.joints.some((j) => j.id === cmd.id)) throw new Error(`No joint with id "${cmd.id}"`);
      world.joints = world.joints.filter((j) => j.id !== cmd.id);
      break;
    case "pilot.set": {
      const p = findBody(world, cmd.id).pilot;
      if (!p) throw new Error(`Body "${cmd.id}" has no pilot`);
      if (cmd.goal) {
        p.goal = structuredClone(cmd.goal);
        p.trim = 0;
        p.settled = false;
      }
      if (cmd.skill) p.skill = { ...p.skill, ...cmd.skill };
      p.next = world.tick; // decide at once
      break;
    }
    case "joint.set": {
      const j = world.joints.find((x) => x.id === cmd.id);
      if (!j) throw new Error(`No joint with id "${cmd.id}"`);
      j.limits = { ...j.limits, ...cmd.limits };
      break;
    }
    case "body.detach":
      findBody(world, cmd.id);
      world.joints = world.joints.filter((j) => j.a !== cmd.id && j.b !== cmd.id);
      break;
    case "link.add":
      addLink(world, cmd.link);
      break;
    case "link.remove":
      if (!world.links.some((l) => l.id === cmd.id)) throw new Error(`No link with id "${cmd.id}"`);
      world.links = world.links.filter((l) => l.id !== cmd.id);
      break;
    case "control.set":
      world.controls = { ...world.controls, [cmd.channel]: cmd.value };
      break;
    case "drag.set": {
      findBody(world, cmd.id);
      const drag: Drag = {
        id: cmd.id,
        anchor: { ...cmd.anchor },
        target: { ...cmd.target },
        stiffness: cmd.stiffness ?? 100,
        maxAcceleration: cmd.maxAcceleration ?? 200,
      };
      world.drags = [...world.drags.filter((d) => d.id !== cmd.id), drag].sort((a, b) => compareIds(a.id, b.id));
      break;
    }
    case "drag.clear":
      world.drags = world.drags.filter((d) => d.id !== cmd.id);
      break;
    case "world.set":
      if (cmd.patch.gravity) world.gravity = { ...cmd.patch.gravity };
      if (cmd.patch.bounds) world.bounds = structuredClone(cmd.patch.bounds);
      break;
    case "gas.fill":
      fillGas(world, cmd.fill, profile);
      break;
    case "gas.remove": {
      const { min, max } = cmd;
      const gas = world.gas;
      const inside = new Uint8Array(gas.count);
      for (let i = 0; i < gas.count; i++) inside[i] = gas.x[i] < min.x || gas.x[i] > max.x || gas.y[i] < min.y || gas.y[i] > max.y ? 0 : 1;
      dropParcels(gas, inside);
      break;
    }
    case "rng.sample":
      pushEvent(world, { tick: world.tick, type: "rng.sample", data: { label: cmd.label, value: nextFloat(world.rng) } });
      break;
    case "debug.kick": {
      const body = findBody(world, cmd.id);
      body.velocity = add(body.velocity, cmd.dv);
      break;
    }
  }
}

/**
 * Applies commands now. The change to conserved totals is attributed to the
 * user at the next step — except debug.kick, which is deliberately not.
 */
export function applyCommands(world: World, commands: readonly Command[], profile?: Profile): void {
  for (const cmd of commands) {
    const before = computeTotals(world);
    applyOne(world, cmd, profile);
    if (cmd.type === "debug.kick") {
      world.pendingDebug.push(cmd.id);
      continue;
    }
    addDelta(world.pendingUser, diff(before, computeTotals(world)));
  }
}

/** Kept for M0 call sites: applies one command. */
export function applyCommand(world: World, cmd: Command): void {
  applyCommands(world, [cmd]);
}

export interface StepTimings {
  clock: () => number;
  /** Milliseconds per subsystem for the last step (LED-004). */
  out: Record<string, number>;
}

/** Advances the world one fixed step in place, mutating it. Commands apply at the start of the step. */
export function stepInPlace(world: World, commands: readonly Command[], profile: Profile, timings?: StepTimings): void {
  const dt = profile.timestep;
  let t0 = timings?.clock() ?? 0;
  const mark = (name: string) => {
    if (!timings) return;
    const t = timings.clock();
    timings.out[name] = t - t0;
    t0 = t;
  };

  const fromTick = world.tick;
  applyCommands(world, world.lander ? [...landerCommands(world), ...commands] : commands, profile);
  if (world.lander) landerStartJudge(world);
  // Mammoth Asteroids' ship: the player's controls drive its engines (MAS-035).
  if (world.arcade?.spec.mix) arcadeMix(world);
  if (world.thrust?.spec.mix) mixControls(world, world.thrust.spec.mix);
  // AI pilots decide and set their own channels, as a player's keys would (AIP-001, AIP-002).
  if (world.bodies.some((b) => b.pilot)) runPilots(world, profile.timestep);
  mark("commands");
  const start = world.ledger.totals;
  const sources: Record<Source, Delta> = {
    user: world.pendingUser,
    field: zeroDelta(),
    contact: zeroDelta(),
    joint: zeroDelta(),
    transfer: zeroDelta(),
    correction: zeroDelta(),
    boundary: zeroDelta(),
    supply: zeroDelta(),
    tractor: zeroDelta(),
    power: zeroDelta(),
  };

  // Feed links move resources between stores. Mass and momentum must not change; angular momentum may,
  // because a store's contents sit at its body's centre (recorded, not checked). So may gravitational
  // potential energy, when the stores are at different heights: that is the feed pumping propellant
  // up or down, and so may spin energy, as the mass carries its share of a spinning body's spin to
  // another (both recorded as a transfer, like angular momentum).
  // `before` holds the totals of the world as it is now, all the way to the field's kick: each
  // block below that changes the world ends by setting it, so none needs to work them out again
  // before it starts (the totals walk every body and parcel, and nothing changes in between).
  let before = computeTotals(world);
  // Turrets (WPN-009, WPN-010) and the joints that aim them (ASM-008). What a generator burns leaves
  // the world; the joint's turning is work the weld solver does, booked with the joints'.
  if (world.bodies.some((b) => b.turret || b.generator) || world.joints.some((j) => j.turn)) {
    const burned = runTurrets(world, dt);
    turnJoints(world, dt);
    if (burned > 0) {
      const after = computeTotals(world);
      addDelta(sources.boundary, diff(before, after));
      before = after;
    }
  }
  if (world.links.length) {
    const { touchedFixed, spinShift } = runFeeds(world, dt);
    const after = computeTotals(world);
    // Mass moving to or from a fixed body leaves or enters the dynamic totals: attribute all of it then.
    sources.transfer = touchedFixed
      ? diff(before, after)
      : { ...zeroDelta(), angularMomentum: after.angularMomentum - before.angularMomentum, energy: after.energy.potential - before.energy.potential + spinShift };
    before = after;
  }
  if (world.bodies.some((b) => b.magazine)) {
    const t0 = before;
    retractStops(world);
    runMagazines(world, dt);
    const t1 = computeTotals(world);
    sources.transfer.angularMomentum += t1.angularMomentum - t0.angularMomentum;
    sources.transfer.energy += t1.energy.total - t0.energy.total;
    before = t1;
  }
  // Railguns (WPN-008): the launch is an equal and opposite push, powered by the ship.
  if (world.bodies.some((b) => b.magazine?.railgun)) {
    const t0 = before;
    fireRailguns(world, dt, addBody as never, normalizeBody as never);
    const t1 = computeTotals(world);
    sources.transfer.angularMomentum += t1.angularMomentum - t0.angularMomentum;
    sources.power.energy += t1.energy.total - t0.energy.total;
    before = t1;
  }
  // Injectors turn stored propellant into gas; mixtures that are hot enough burn (PRP-002, PRP-003).
  // Mass, momentum and energy are unchanged; angular momentum may change as mass moves from a
  // store at the body's centre to the outlet (recorded, not checked, as for feeds), and so may
  // gravitational potential energy, by the height of the outlet above the centre.
  if (world.bodies.some((b) => b.injector || b.breach || b.vents?.holes.length || (b.integrity < 1 && b.contents?.length)) || world.gas.count) {
    const t0 = before;
    runInjectors(world, dt, profile);
    runLeaks(world, dt, profile);
    igniteAndBurn(world.gas);
    const t1 = computeTotals(world);
    sources.transfer.angularMomentum += t1.angularMomentum - t0.angularMomentum;
    sources.transfer.energy += t1.energy.potential - t0.energy.potential;
    // An injector with an economy makes the rest of each parcel from nothing (FLT-010): record it all.
    if (world.bodies.some((b) => (b.injector?.economy ?? 1) !== 1)) {
      const d = diff(t0, t1);
      sources.supply = { mass: d.mass, momentumX: d.momentumX, momentumY: d.momentumY, angularMomentum: 0, energy: d.energy - (t1.energy.potential - t0.energy.potential) };
    }
    before = t1;
  }
  const rbs = prepareBodies(world);

  // External field.
  const field = applyField(rbs, world.gravity, dt);
  const g = world.gravity;
  if ((g.x !== 0 || g.y !== 0) && world.gas.count) {
    const gas = world.gas;
    for (let i = 0; i < gas.count; i++) {
      gas.vx[i] = gas.vx[i] + g.x * dt;
      gas.vy[i] = gas.vy[i] + g.y * dt;
      const Jx = gas.mass[i] * g.x * dt;
      const Jy = gas.mass[i] * g.y * dt;
      field.impulse.x += Jx;
      field.impulse.y += Jy;
      field.angular += gas.x[i] * Jy - gas.y[i] * Jx;
    }
  }
  applyAttractors(world, rbs, dt, field);
  let after = computeTotals(world);
  sources.field.momentumX = field.impulse.x;
  sources.field.momentumY = field.impulse.y;
  sources.field.angularMomentum = field.angular;
  sources.field.energy += after.energy.total - before.energy.total;

  // User drag springs.
  before = after;
  if (world.drags.length) {
    applyDrags(world, rbs, dt);
    after = computeTotals(world);
  }
  // With no drags nothing changed: the same totals, so the same (zero) difference.
  addDelta(sources.user, diff(before, after));

  // Tractor beams and tethers (TRC): equal and opposite pulls, so only energy changes, which the ship
  // supplies. A base's collector (BAS) is fixed: its pull is external, recorded with its impulse.
  if (world.bodies.some((b) => b.tractor || b.collector)) {
    before = after;
    applyTractors(world, rbs, dt);
    const ext = applyCollectors(world, rbs, dt);
    after = computeTotals(world);
    sources.tractor = { mass: 0, momentumX: ext.impulse.x, momentumY: ext.impulse.y, angularMomentum: ext.angular, energy: after.energy.total - before.energy.total };
  }
  mark("forces");

  // Contacts: kinetic energy lost becomes heat.
  before = after;
  const { account, jointAccount, capped, solved } = solveContacts(world, rbs, profile);
  world.ledger.thermal -= account.predictedKE + jointAccount.predictedKE;
  const contactHeat = -account.predictedKE - jointAccount.predictedKE;
  sources.contact.momentumX = account.externalImpulse.x;
  sources.contact.momentumY = account.externalImpulse.y;
  sources.contact.angularMomentum = account.angular;
  sources.joint.momentumX = jointAccount.externalImpulse.x;
  sources.joint.momentumY = jointAccount.externalImpulse.y;
  sources.joint.angularMomentum = jointAccount.angular;
  for (const id of jointAccount.involved) account.involved.add(id);
  mark("contacts");

  // Integrate positions. Only gravitational potential can change here: free assemblies move
  // rigidly, which conserves momentum, angular momentum and kinetic energy exactly.
  before = computeTotals(world);
  const rigidImpulse = integratePositions(rbs, dt, world);
  after = computeTotals(world);
  sources.field.energy += after.energy.potential - before.energy.potential;
  // Joints past a limit break (ASM-004). The solver already held them to their limits, so
  // breaking changes no velocity and the ledger has nothing more to record.
  if (world.joints.length) evaluateJoints(world, dt, rigidImpulse, capped);
  // Contacts damage what they hit (DMG-002); what fails stops working or breaks (DMG-003).
  applyDamage(world);

  // Disc pairs that met mid-step move onto their true paths; this is part of the contact.
  before = after;
  applyImpactFix(solved);
  after = computeTotals(world);
  sources.contact.angularMomentum += after.angularMomentum - before.angularMomentum;
  sources.contact.energy += after.energy.total - before.energy.total;

  // Position correction moves bodies, not velocities; record what that did.
  before = after;
  correctPositions(world, solved, profile);
  after = computeTotals(world);
  sources.correction.angularMomentum = after.angularMomentum - before.angularMomentum;
  sources.correction.energy = after.energy.total - before.energy.total;

  // Explosive shells that struck something detonate (WPN): fragments and blast gas take the charge's
  // energy exactly. Angular momentum and potential energy shift a little as the shell's mass leaves
  // its centre; that is recorded as a transfer.
  if (world.bodies.some((b) => b.explosive) || world.blasts?.length) {
    before = after;
    const released = releaseBlasts(world, dt);
    if (detonate(world, world.joints.length ? assemblyRoots(world) : null, dt).length + released) {
      after = computeTotals(world);
      sources.transfer.angularMomentum += after.angularMomentum - before.angularMomentum;
      sources.transfer.energy += after.energy.potential - before.energy.potential;
      // A charge that makes more gas than its shell weighs (`gas`): what it made from nothing, recorded.
      const d = diff(before, after);
      if (d.mass > 1e-9) addDelta(sources.supply, { mass: d.mass, momentumX: d.momentumX, momentumY: d.momentumY, angularMomentum: 0, energy: d.energy - (after.energy.potential - before.energy.potential) });
    }
  }
  // Larger asteroid fragments that took enough damage show their seams (AST-007).
  if (world.bodies.some((b) => b.compound)) revealCompounds(world);
  // What has been destroyed leaves the world in a puff of dust (DMG-007).
  stepDust(world, dt);
  if (world.bodies.some((b) => b.integrity <= 0 && !b.fixed)) {
    before = computeTotals(world);
    removeDestroyed(world);
    after = computeTotals(world);
    addDelta(sources.boundary, diff(before, after));
  }
  mark("integrate");

  let gasJointImpulse = new Map<string, { x: number; y: number; angular: number }>();
  // Gas: parcels exchange impulses with each other and with bodies, conserving momentum,
  // angular momentum and energy by construction. Fixed bodies are external; so is the boundary.
  // Engines holding their chamber gas: a plug across each throat, moving with the engine, and the
  // chamber's push on its walls (internal, so it only loads the welds).
  const holding: { b: Body; plug: WallBody | null; shape: NonNullable<ReturnType<typeof holdingShape>> }[] = [];
  if (world.bodies.some((b) => b.injector?.vessel)) {
    const roots = assemblyRoots(world);
    const index = bodyIndex(world);
    for (const b of world.bodies) {
      if (!b.injector?.vessel) continue;
      const shape = holdingShape(world, b, roots, index);
      if (shape) holding.push({ b, plug: plugWall(b, shape), shape });
    }
  }
  // The parcels that leave the gas model this step, as they were when they left (for the wisps).
  const leftGas: Parcel[] = [];
  if (world.gas.count) {
    before = after;
    const plugs = holding.filter((h) => h.plug);
    // Only bodies that could meet the gas this step take part (wreckage far from any gas costs nothing).
    const near = bodiesNearGas(world, dt, plugs.map((h) => h.b.id));
    const nearIds = new Set(near.map((b) => b.id));
    const nearJoints = near.length === world.bodies.length ? world.joints : world.joints.filter((j) => nearIds.has(j.a) && nearIds.has(j.b));
    const walls = plugs.length ? [...wallBodies(near), ...plugs.map((h) => h.plug!)] : wallBodies(near);
    const joints = plugs.length ? [...nearJoints, ...plugs.map((h) => ({ a: h.b.id, b: h.plug!.id }))] : nearJoints;
    const closed = world.bounds.depth ? engineInteriors(world) : [];
    // Free flight (prototype, profile.gasFreeFlight): gas that can't come near a body this step flies
    // on its own; the rest is stepped as gas. Both are put back in their original order.
    const tm = timings?.clock();
    const all = world.gas;
    const n0 = all.count;
    const mask = profile.gasFreeFlight ? freeFlightMask(all, walls, dt, profile.gasFreeFlight) : null;
    if (timings && mask) timings.out["gas.mask"] = timings.clock() - tm!;
    let nFree = 0;
    if (mask) for (let i = 0; i < n0; i++) nFree += mask[i];
    // What leaves the gas this step, stepped or flying free: marked here, dropped below.
    const gone = new Uint8Array(n0);
    let hmaxAll = 0;
    let subset: number[] | undefined;
    if (nFree) {
      subset = [];
      for (let i = 0; i < n0; i++) {
        hmaxAll = Math.max(hmaxAll, SMOOTHING * all.radius[i]);
        if (!mask![i]) subset.push(i);
      }
    }
    const gas: GasAccount = stepGasClustered(all, walls, joints, dt, world.bounds, world.gravity, closed, timings, nFree ? { subset, farReach: hmaxAll, gone } : { gone });
    if (nFree) {
      const tf = timings?.clock();
      const r0 = { ...gas.removed, momentum: { ...gas.removed.momentum } };
      flyFree(all, mask!, walls, dt, world.bounds, world.gravity, closed, all.scale ?? 1, gas, hmaxAll, gone);
      // What flew out joins the world's running totals, as the gas step's own leavers do.
      const tot = all.removed;
      tot.count += gas.removed.count - r0.count;
      tot.mass += gas.removed.mass - r0.mass;
      tot.momentum.x += gas.removed.momentum.x - r0.momentum.x;
      tot.momentum.y += gas.removed.momentum.y - r0.momentum.y;
      tot.angularMomentum += gas.removed.angularMomentum - r0.angularMomentum;
      tot.energy += gas.removed.energy - r0.energy;
      if (timings) timings.out["gas.free"] = timings.clock() - tf!;
    }
    for (let i = 0; i < n0; i++) if (gone[i]) leftGas.push(parcelAt(all, i));
    if (leftGas.length) dropParcels(all, gone);
    if (profile.gasFreeFlight) world.gas.free = nFree;
    gasJointImpulse = gas.jointImpulse;
    // A plug is part of its engine.
    for (const h of plugs) {
      const id = h.plug!.id;
      const J = gasJointImpulse.get(id);
      if (gas.involved.delete(id)) gas.involved.add(h.b.id);
      if (!J) continue;
      gasJointImpulse.delete(id);
      const rel = sub(h.plug!.position, h.b.position);
      const e = gasJointImpulse.get(h.b.id) ?? { x: 0, y: 0, angular: 0 };
      gasJointImpulse.set(h.b.id, { x: e.x + J.x, y: e.y + J.y, angular: e.angular + J.angular + cross(rel, J) });
    }
    after = computeTotals(world);
    sources.contact.momentumX += gas.externalImpulse.x;
    sources.contact.momentumY += gas.externalImpulse.y;
    sources.contact.angularMomentum += gas.angular;
    const r = gas.removed;
    addDelta(sources.boundary, { mass: -r.mass, momentumX: -r.momentum.x, momentumY: -r.momentum.y, angularMomentum: -r.angularMomentum, energy: -r.energy });
    // Crushed gas the substeps could not resolve: the thermal energy its clamp made up.
    sources.correction.energy += gas.clamped;
    // Parcels drift during the gas phase, so their potential energy changes there (including
    // parcels that then left, up to where they left).
    sources.field.energy += after.energy.potential - before.energy.potential + gas.removedPotential;
    for (const id of gas.involved) account.involved.add(id);
    if (r.count) pushEvent(world, { tick: world.tick + 1, type: "gas.left", data: { count: r.count, mass: r.mass } });
  } else world.gas.substeps = 0;
  // The plume's tail (GAS-011): wisps bounce off bodies with what gas that has left the world
  // still carries, so what they give is recorded as coming in through the boundary. Then the gas
  // that has just left the gas model, but not the world, becomes wisps.
  if (world.wisps?.length) {
    before = after;
    stepWisps(world, dt);
    after = computeTotals(world);
    addDelta(sources.boundary, diff(before, after));
  }
  if (leftGas.length) {
    const scale = world.gas.scale ?? 1;
    spawnWisps(world, leftGas, (p) => temperatureOf(p, scale));
  }
  mark("gas");

  // What the welds supply against each chamber's push on its walls.
  for (const h of holding)
    for (const [id, J] of wallLoads(world, h.b, h.shape, dt)) {
      const e = gasJointImpulse.get(id) ?? { x: 0, y: 0, angular: 0 };
      gasJointImpulse.set(id, { x: e.x - J.x, y: e.y - J.y, angular: e.angular - J.angular });
    }
  // Gas loads on joints, for next step's joint evaluation (one step later; see evaluateJoints).
  if (world.joints.length) recordGasLoads(world, gasJointImpulse);

  for (const d of world.drags) {
    if (!world.bodies.some((b) => b.id === d.id)) world.drags = world.drags.filter((x) => x.id !== d.id);
  }

  // Cargo a collector reeled all the way in leaves the world, delivered (BAS-004).
  if (world.bodies.some((b) => b.collector?.captured)) {
    const t0 = computeTotals(world);
    collectCaptured(world);
    after = computeTotals(world);
    addDelta(sources.boundary, diff(t0, after));
  }

  // A duel (DUEL-001, DUEL-004): kills, and knocked-out ships coming back, which takes their
  // remains out and brings a fresh copy in through the boundary.
  if (world.duel) {
    const t0 = computeTotals(world);
    if (runDuel(world, world.duel, dt)) {
      after = computeTotals(world);
      addDelta(sources.boundary, diff(t0, after));
    }
  }

  // Mammoth Asteroids (MAS-070): gold collected and spent slugs leave, and new ships and levels
  // come in, through the boundary.
  if (world.arcade) {
    const t0 = computeTotals(world);
    if (runArcade(world, dt, ARCADE_OPS)) {
      after = computeTotals(world);
      addDelta(sources.boundary, diff(t0, after));
    }
  }

  // Craters (TER-002, TER-003): the rock is fixed, so cutting it changes no total; a shell spent in
  // the rock leaves through the boundary.
  if (world.terrain?.craters) {
    let t0: ReturnType<typeof computeTotals> | undefined;
    if (runTerrain(world, TERRAIN_OPS, () => (t0 = computeTotals(world))) && t0) {
      after = computeTotals(world);
      addDelta(sources.boundary, diff(t0, after));
    }
  }

  // Mammoth Thrust (MTH-023, MTH-026): each new ship comes in, and a ship beamed back from the
  // level's top is moved, through the boundary.
  if (world.thrust) {
    const t0 = computeTotals(world);
    if (runThrust(world, dt, ARCADE_OPS)) {
      after = computeTotals(world);
      addDelta(sources.boundary, diff(t0, after));
    }
  }

  // A wrapped world (FLT-012): what crosses an edge comes back in at the other one.
  if (world.bounds.wrap) {
    const t0 = computeTotals(world);
    if (wrapAround(world)) {
      after = computeTotals(world);
      addDelta(sources.boundary, diff(t0, after));
    }
  }

  world.tick += 1;
  world.time = world.tick * dt;
  finishLedger(world, start, after, sources, profile, [...account.involved], contactHeat);
  world.pendingUser = zeroDelta();
  world.pendingDebug = [];
  mark("ledger");
  if (world.challenge) {
    const verdict = judgeLanding(world, world.challenge, fromTick);
    if (verdict) {
      const st = world.challenge.status;
      pushEvent(world, { tick: world.tick, type: verdict, data: st.score !== undefined ? { reason: st.reason ?? "", score: st.score } : { reason: st.reason ?? "" } });
    }
    if (world.lander) updateLander(world);
  }
}

function finishLedger(
  world: World,
  start: Totals,
  end: Totals,
  sources: Record<Source, Delta>,
  profile: Profile,
  involved: string[],
  contactHeat: number,
): void {
  const residual = diff(start, end);
  for (const s of SOURCES) {
    const d = sources[s];
    residual.mass -= d.mass;
    residual.momentumX -= d.momentumX;
    residual.momentumY -= d.momentumY;
    residual.angularMomentum -= d.angularMomentum;
    residual.energy -= d.energy;
  }
  const ledger = world.ledger;
  ledger.totals = end;
  ledger.last = { tick: world.tick, sources, residual };
  const m = ledger.maxResidual;
  m.mass = Math.max(m.mass, Math.abs(residual.mass));
  m.momentumX = Math.max(m.momentumX, Math.abs(residual.momentumX));
  m.momentumY = Math.max(m.momentumY, Math.abs(residual.momentumY));
  m.angularMomentum = Math.max(m.angularMomentum, Math.abs(residual.angularMomentum));
  m.energy = Math.max(m.energy, Math.abs(residual.energy));

  const entities = (world.pendingDebug.length ? world.pendingDebug : involved).slice(0, 8).join(",");
  const check = (quantity: string, value: number, tol: number) => {
    if (Math.abs(value) <= tol) return;
    ledger.violations += 1;
    pushEvent(world, { tick: world.tick, type: "violation", data: { quantity, magnitude: value, tolerance: tol, entities } });
  };
  check("mass", residual.mass, profile.tol.mass);
  check("momentum", Math.sqrt(residual.momentumX * residual.momentumX + residual.momentumY * residual.momentumY), profile.tol.momentum);
  check("angularMomentum", residual.angularMomentum, profile.tol.angularMomentum);
  check("energy", residual.energy, profile.tol.energy);
  // Contacts and joints may only turn kinetic energy into heat, never the reverse. Sequential
  // impulses with warm starting are not strictly dissipative: bodies kept in contact by gas thrust
  // can gain about 10⁻⁵ of the kinetic energy present, so the tolerance scales with it.
  check("contactEnergy", Math.min(0, contactHeat), profile.tol.energy + 1e-5 * end.energy.kinetic);
}

/** Pure form of stepInPlace: returns a new world and leaves the input untouched. */
export function step(world: World, commands: readonly Command[], profile: Profile): World {
  const next = structuredClone(world);
  stepInPlace(next, commands, profile);
  return next;
}
