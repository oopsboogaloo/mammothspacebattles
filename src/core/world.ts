// World state, commands and the step function (ARC-002).
// Bodies are kept sorted by id so iteration order never depends on insertion
// order (DET-004). All edits go through commands (SBX-013), and every change
// to the conserved totals is attributed in the ledger (LED-001…LED-003).

import { addDelta, computeTotals, diff, emptyLedger, SOURCES, zeroDelta, type Delta, type Ledger, type Source, type Totals } from "./ledger.ts";
import { bodyMass, type Store } from "./bodies.ts";
import { evaluateJoints } from "./joints.ts";
import { add, length, rotate, scale, sinCos, type Vec2 } from "./math.ts";
import { applyDrags, applyField, applyImpactFix, applyImpulseAt, correctPositions, integratePositions, prepareBodies, rigid, solveContacts } from "./physics.ts";
import { createRng, nextFloat, type RngState } from "./prng.ts";
import { emptyGas, makeFill, stepGas, wallBodies, type Bounds, type GasFill, type GasState } from "./gas.ts";
import type { Profile } from "./profile.ts";
import { massProps, normalizePolygon, type Shape } from "./shapes.ts";

export type { Vec2 } from "./math.ts";
export type { Shape } from "./shapes.ts";
export type { Store } from "./bodies.ts";
export { bodyMass } from "./bodies.ts";
export type { Bounds, GasFill, GasState, Parcel } from "./gas.ts";

export const WORLD_SCHEMA = 4;
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
}

/** Body as written in scenarios and commands: material fields are optional. */
export type BodyInput = Omit<Body, "fixed" | "restitution" | "friction"> & Partial<Pick<Body, "fixed" | "restitution" | "friction">>;

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
  /** Last step's load; fraction is the worst of each load ÷ its limit. */
  load: { tension: number; compression: number; shear: number; torque: number; fraction: number };
}

export type JointInput = Pick<Joint, "id" | "a" | "b" | "anchorA" | "anchorB"> & Partial<Pick<Joint, "axis" | "referenceAngle">> & { limits?: Partial<JointLimits> };

/** Zero-mass connections (ASM-006): feed links move a resource between stores; control links carry a channel to a component. */
export type Link =
  | { id: string; kind: "feed"; from: string; to: string; resource: string; rate: number /* kg/s */ }
  | { id: string; kind: "control"; channel: string; to: string };

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
  /** Removes every joint touching the body: it leaves its assembly with its own momentum. */
  | { type: "body.detach"; id: string }
  | { type: "link.add"; link: Link }
  | { type: "link.remove"; id: string }
  | { type: "control.set"; channel: string; value: number }
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

export function createWorld(
  seed: number,
  bodies: BodyInput[] = [],
  gravity: Vec2 = { x: 0, y: 0 },
  extra: { joints?: JointInput[]; links?: Link[]; gas?: GasFill[]; bounds?: Bounds } = {},
  profile?: Profile,
): World {
  const world: World = {
    schema: WORLD_SCHEMA,
    tick: 0,
    time: 0,
    rng: createRng(seed),
    gravity: { ...gravity },
    bounds: structuredClone(extra.bounds ?? DEFAULT_BOUNDS),
    bodies: [],
    gas: emptyGas(),
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
  for (const j of extra.joints ?? []) addJoint(world, j);
  for (const l of extra.links ?? []) addLink(world, l);
  for (const f of extra.gas ?? []) fillGas(world, f, profile);
  world.events = [];
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
    load: { tension: 0, compression: 0, shear: 0, torque: 0, fraction: 0 },
  };
  world.joints = [...world.joints, joint].sort((p, q) => compareIds(p.id, q.id));
}

function addLink(world: World, link: Link): void {
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
function runFeeds(world: World, dt: number): boolean {
  let touchedFixed = false;
  for (const l of world.links) {
    if (l.kind !== "feed") continue;
    const from = world.bodies.find((b) => b.id === l.from);
    const to = world.bodies.find((b) => b.id === l.to);
    const src = from?.contents?.find((s) => s.resource === l.resource);
    const dst = to?.contents?.find((s) => s.resource === l.resource);
    if (!from || !to || !src || !dst) continue;
    const dm = Math.min(l.rate * dt, src.mass, Math.max(0, dst.capacity - dst.mass));
    if (!(dm > 0)) continue;
    if (from.fixed || to.fixed) touchedFixed = true;
    const keBefore = 0.5 * dm * (from.velocity.x ** 2 + from.velocity.y ** 2) + 0.5 * bodyMass(to) * (to.velocity.x ** 2 + to.velocity.y ** 2);
    const mTo = bodyMass(to);
    if (!to.fixed) to.velocity = { x: (mTo * to.velocity.x + dm * from.velocity.x) / (mTo + dm), y: (mTo * to.velocity.y + dm * from.velocity.y) / (mTo + dm) };
    src.mass -= dm;
    dst.mass += dm;
    const keAfter = 0.5 * bodyMass(to) * (to.velocity.x ** 2 + to.velocity.y ** 2);
    world.ledger.thermal += Math.max(0, keBefore - keAfter);
  }
  return touchedFixed;
}

/** Adds parcels for a fill, or refuses it if the parcel limit would be exceeded (PRF-003). */
function fillGas(world: World, fill: GasFill, profile?: Profile): void {
  const limit = profile?.limit.gasParcels ?? Infinity;
  const parcels = makeFill(fill, world.rng, wallBodies(world.bodies), world.gas.nextId, limit - world.gas.parcels.length);
  if (!parcels) {
    pushEvent(world, { tick: world.tick, type: "limit.refused", data: { entity: "gasParcels", requested: fill.count, existing: world.gas.parcels.length, limit } });
    return;
  }
  world.gas.parcels.push(...parcels);
  world.gas.nextId += parcels.length;
  pushEvent(world, { tick: world.tick, type: "gas.fill", data: { requested: fill.count, created: parcels.length } });
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
      world.gas.parcels = world.gas.parcels.filter((p) => p.position.x < min.x || p.position.x > max.x || p.position.y < min.y || p.position.y > max.y);
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

  applyCommands(world, commands, profile);
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
  };

  // Feed links move resources between stores. Mass and momentum must not change; angular momentum may,
  // because a store's contents sit at its body's centre (recorded, not checked).
  let before = computeTotals(world);
  if (world.links.length) {
    const touchedFixed = runFeeds(world, dt);
    const after = computeTotals(world);
    // Mass moving to or from a fixed body leaves or enters the dynamic totals: attribute all of it then.
    sources.transfer = touchedFixed ? diff(before, after) : { ...zeroDelta(), angularMomentum: after.angularMomentum - before.angularMomentum };
    before = after;
  }
  const rbs = prepareBodies(world);

  // External field.
  const field = applyField(rbs, world.gravity, dt);
  const g = world.gravity;
  if ((g.x !== 0 || g.y !== 0) && world.gas.parcels.length) {
    for (const p of world.gas.parcels) {
      p.velocity = { x: p.velocity.x + g.x * dt, y: p.velocity.y + g.y * dt };
      const J = { x: p.mass * g.x * dt, y: p.mass * g.y * dt };
      field.impulse.x += J.x;
      field.impulse.y += J.y;
      field.angular += p.position.x * J.y - p.position.y * J.x;
    }
  }
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
  const { account, jointAccount, solved } = solveContacts(world, rbs, profile);
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
  let breakHeat = 0;
  if (world.joints.length) {
    const brk = evaluateJoints(world, dt, rigidImpulse, rigid);
    world.ledger.thermal -= brk.predictedKE;
    breakHeat = -brk.predictedKE;
    sources.joint.momentumX += brk.externalImpulse.x;
    sources.joint.momentumY += brk.externalImpulse.y;
    sources.joint.angularMomentum += brk.angular;
    after = computeTotals(world);
  }

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
  mark("integrate");

  // Gas: parcels exchange impulses with each other and with bodies, conserving momentum,
  // angular momentum and energy by construction. Fixed bodies are external; so is the boundary.
  if (world.gas.parcels.length) {
    before = after;
    const gas = stepGas(world.gas, wallBodies(world.bodies), world.joints, dt, world.bounds, world.gravity);
    after = computeTotals(world);
    sources.contact.momentumX += gas.externalImpulse.x;
    sources.contact.momentumY += gas.externalImpulse.y;
    sources.contact.angularMomentum += gas.angular;
    const r = gas.removed;
    sources.boundary = { mass: -r.mass, momentumX: -r.momentum.x, momentumY: -r.momentum.y, angularMomentum: -r.angularMomentum, energy: -r.energy };
    // Parcels drift during the gas phase, so their potential energy changes there (including
    // parcels that then left, up to where they left).
    sources.field.energy += after.energy.potential - before.energy.potential + gas.removedPotential;
    for (const id of gas.involved) account.involved.add(id);
    if (r.count) pushEvent(world, { tick: world.tick + 1, type: "gas.left", data: { count: r.count, mass: r.mass } });
  } else world.gas.substeps = 0;
  mark("gas");

  for (const d of world.drags) {
    if (!world.bodies.some((b) => b.id === d.id)) world.drags = world.drags.filter((x) => x.id !== d.id);
  }

  world.tick += 1;
  world.time = world.tick * dt;
  finishLedger(world, start, after, sources, profile, [...account.involved], contactHeat + breakHeat);
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
  // Contacts and joints may only turn kinetic energy into heat, never the reverse.
  check("contactEnergy", Math.min(0, contactHeat), profile.tol.energy);
}

/** Pure form of stepInPlace: returns a new world and leaves the input untouched. */
export function step(world: World, commands: readonly Command[], profile: Profile): World {
  const next = structuredClone(world);
  stepInPlace(next, commands, profile);
  return next;
}
