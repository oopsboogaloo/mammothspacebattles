// World state, commands and the step function (ARC-002).
// Bodies are kept sorted by id so iteration order never depends on insertion
// order (DET-004). All edits go through commands (SBX-013), and every change
// to the conserved totals is attributed in the ledger (LED-001…LED-003).

import { addDelta, computeTotals, diff, emptyLedger, SOURCES, zeroDelta, type Delta, type Ledger, type Source, type Totals } from "./ledger.ts";
import { add, rotate, sinCos, type Vec2 } from "./math.ts";
import { applyDrags, applyField, applyImpactFix, applyImpulseAt, correctPositions, integratePositions, prepareBodies, solveContacts } from "./physics.ts";
import { createRng, nextFloat, type RngState } from "./prng.ts";
import type { Profile } from "./profile.ts";
import { massProps, normalizePolygon, type Shape } from "./shapes.ts";

export type { Vec2 } from "./math.ts";
export type { Shape } from "./shapes.ts";

export const WORLD_SCHEMA = 2;
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
}

/** Body as written in scenarios and commands: material fields are optional. */
export type BodyInput = Omit<Body, "fixed" | "restitution" | "friction"> & Partial<Pick<Body, "fixed" | "restitution" | "friction">>;

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
  bodies: Body[];
  drags: Drag[];
  contacts: Contact[];
  ledger: Ledger;
  events: WorldEvent[];
  /** Changes made by commands since the last step, attributed to the user at the next step. */
  pendingUser: Delta;
  /** Bodies touched by unattributed debug commands since the last step. */
  pendingDebug: string[];
}

/** Commands are the only way to change a world other than stepping it. */
export type Command =
  | { type: "body.add"; body: BodyInput }
  | { type: "body.remove"; id: string }
  | { type: "body.set"; id: string; patch: Partial<Omit<Body, "id">> }
  | { type: "body.impulse"; id: string; impulse: Vec2; point: Vec2 }
  | { type: "drag.set"; id: string; anchor: Vec2; target: Vec2; stiffness?: number; maxAcceleration?: number }
  | { type: "drag.clear"; id: string }
  | { type: "world.set"; patch: { gravity?: Vec2 } }
  | { type: "rng.sample"; label: string }
  /** Test hook: changes a velocity WITHOUT telling the ledger, to exercise violation reporting. */
  | { type: "debug.kick"; id: string; dv: Vec2 };

export function normalizeBody(input: BodyInput): Body {
  const body: Body = { ...BODY_DEFAULTS, ...structuredClone(input) };
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

export function createWorld(seed: number, bodies: BodyInput[] = [], gravity: Vec2 = { x: 0, y: 0 }): World {
  const world: World = {
    schema: WORLD_SCHEMA,
    tick: 0,
    time: 0,
    rng: createRng(seed),
    gravity: { ...gravity },
    bodies: [],
    drags: [],
    contacts: [],
    ledger: emptyLedger(),
    events: [],
    pendingUser: zeroDelta(),
    pendingDebug: [],
  };
  for (const body of bodies) addBody(world, body);
  world.ledger.totals = computeTotals(world);
  return world;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addBody(world: World, input: BodyInput): void {
  if (world.bodies.some((b) => b.id === input.id)) throw new Error(`Duplicate body id "${input.id}"`);
  world.bodies.push(normalizeBody(input));
  world.bodies.sort((a, b) => compareIds(a.id, b.id));
}

export function findBody(world: World, id: string): Body {
  const body = world.bodies.find((b) => b.id === id);
  if (!body) throw new Error(`No body with id "${id}"`);
  return body;
}

function pushEvent(world: World, e: WorldEvent): void {
  world.events.push(e);
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS);
}

function applyOne(world: World, cmd: Command): void {
  switch (cmd.type) {
    case "body.add":
      addBody(world, cmd.body);
      break;
    case "body.remove":
      findBody(world, cmd.id);
      world.bodies = world.bodies.filter((b) => b.id !== cmd.id);
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
      const mp = massProps(body.shape, body.mass);
      applyImpulseAt({ body, invMass: body.fixed ? 0 : 1 / body.mass, invInertia: body.fixed ? 0 : 1 / mp.inertia }, cmd.impulse, cmd.point);
      break;
    }
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
      break;
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
export function applyCommands(world: World, commands: readonly Command[]): void {
  for (const cmd of commands) {
    const before = computeTotals(world);
    applyOne(world, cmd);
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

/** Advances the world by one fixed step, mutating it. Commands apply at the start of the step. */
export function stepInPlace(world: World, commands: readonly Command[], profile: Profile, timings?: StepTimings): void {
  const dt = profile.timestep;
  let t0 = timings?.clock() ?? 0;
  const mark = (name: string) => {
    if (!timings) return;
    const t = timings.clock();
    timings.out[name] = t - t0;
    t0 = t;
  };

  applyCommands(world, commands);
  mark("commands");
  const start = world.ledger.totals;
  const sources: Record<Source, Delta> = { user: world.pendingUser, field: zeroDelta(), contact: zeroDelta(), correction: zeroDelta() };
  const rbs = prepareBodies(world);

  // External field.
  let before = computeTotals(world);
  const field = applyField(rbs, world.gravity, dt);
  let after = computeTotals(world);
  sources.field.momentumX = field.impulse.x;
  sources.field.momentumY = field.impulse.y;
  sources.field.angularMomentum = field.angular;
  sources.field.energy += after.energy.total - before.energy.total;

  // User drag springs.
  before = after;
  applyDrags(world, rbs, dt);
  after = computeTotals(world);
  addDelta(sources.user, diff(before, after));
  mark("forces");

  // Contacts: kinetic energy lost becomes heat.
  before = after;
  const { account, solved } = solveContacts(world, rbs, profile);
  world.ledger.thermal -= account.predictedKE;
  const contactHeat = -account.predictedKE;
  sources.contact.momentumX = account.externalImpulse.x;
  sources.contact.momentumY = account.externalImpulse.y;
  sources.contact.angularMomentum = account.angular;
  mark("contacts");

  // Integrate positions. Only gravitational potential can change here.
  before = computeTotals(world);
  integratePositions(rbs, dt);
  after = computeTotals(world);
  sources.field.energy += after.energy.potential - before.energy.potential;

  // Disc pairs that met mid-step move onto their true paths; this is part of the contact.
  before = after;
  applyImpactFix(solved);
  after = computeTotals(world);
  sources.contact.angularMomentum += after.angularMomentum - before.angularMomentum;
  sources.contact.energy += after.energy.total - before.energy.total;

  // Position correction moves bodies, not velocities; record what that did.
  before = after;
  correctPositions(solved, profile);
  after = computeTotals(world);
  sources.correction.angularMomentum = after.angularMomentum - before.angularMomentum;
  sources.correction.energy = after.energy.total - before.energy.total;
  mark("integrate");

  for (const d of world.drags) {
    if (!world.bodies.some((b) => b.id === d.id)) world.drags = world.drags.filter((x) => x.id !== d.id);
  }

  world.tick += 1;
  world.time = world.tick * dt;
  finishLedger(world, start, after, sources, profile, [...account.involved], contactHeat);
  world.pendingUser = zeroDelta();
  world.pendingDebug = [];
  mark("ledger");
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
  // Contacts may only turn kinetic energy into heat, never the reverse.
  check("contactEnergy", Math.min(0, contactHeat), profile.tol.energy);
}

/** Pure form of stepInPlace: returns a new world and leaves the input untouched. */
export function step(world: World, commands: readonly Command[], profile: Profile): World {
  const next = structuredClone(world);
  stepInPlace(next, commands, profile);
  return next;
}
