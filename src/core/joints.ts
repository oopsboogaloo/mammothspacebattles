// Weld joints and assemblies (ASM-001, ASM-003…ASM-005).
// Each component stays a rigid body. A joint welds two bodies at a pair of
// anchor points and holds their relative angle; it is solved with the
// contacts by sequential impulses. The impulse it needs each step gives its
// load (tension, compression, shear, torque); past a limit it breaks.
// The solver follows Box2D's weld joint (Erin Catto) without softness.

import { add, cross, crossSV, dot, rotate, scale, sinCos, sub, type Rot, type Vec2 } from "./math.ts";
import type { Body, Joint, World } from "./world.ts";

/** What the rigid-body view of a body needs; matches physics.ts's RB. */
export interface JointBody {
  body: Body;
  mass: number;
  invMass: number;
  invInertia: number;
  inertia: number;
  rot: Rot;
}

/** Changes made by constraint impulses, for the ledger. */
export interface ConstraintAccount {
  /** Impulse delivered to dynamic bodies by fixed bodies. */
  externalImpulse: Vec2;
  /** Angular impulse about the origin delivered to dynamic bodies. */
  angular: number;
  /** Kinetic energy change predicted from every impulse application, J. */
  predictedKE: number;
  involved: Set<string>;
}

export const emptyAccount = (): ConstraintAccount => ({ externalImpulse: { x: 0, y: 0 }, angular: 0, predictedKE: 0, involved: new Set() });

type JointImpulse = { x: number; y: number; angular: number };

interface JointSolver {
  j: Joint;
  a: JointBody;
  b: JointBody;
  rA: Vec2;
  rB: Vec2;
  /** Inverse of the 2×2 point-constraint mass matrix. */
  m11: number;
  m12: number;
  m22: number;
  /** The 2×2 point-constraint matrix itself, for solves along one direction. */
  k11: number;
  k12: number;
  k22: number;
  angularMass: number;
  /** The joint's axis in world space; impulse on b along it is compression. */
  axis: Vec2;
  /** Impulse limits for this step (ASM-003 limits × dt): along the axis, across it, and angular. */
  lo: number;
  hi: number;
  shear: number;
  torque: number;
  P: Vec2;
  L: number;
}

/**
 * What the welds join, worked out once and kept until a body or weld is added, removed or
 * replaced: each body's assembly root, each assembly's members, each body's welds, and each weld's
 * far side. Every step asked for these many times over (the solver, gas, pilots, tractors, loads),
 * rebuilding them each time. A cache entry is checked against the bodies' ids and the welds' ids
 * and ends, in order, so any change to either rebuilds it.
 */
interface Topology {
  bodyIds: string[];
  joints: { id: string; a: string; b: string }[];
  jointKeys: string[];
  roots: ReadonlyMap<string, string>;
  members?: Map<string, string[]>;
  adj?: Adjacency;
  sides: Map<string, Set<string>>;
}
const topologies = new WeakMap<object, Topology>();

function topology(world: Pick<World, "bodies" | "joints">): Topology {
  const { bodies, joints } = world;
  const t = topologies.get(joints);
  if (t && t.bodyIds.length === bodies.length && t.joints.length === joints.length) {
    let same = true;
    for (let i = 0; i < bodies.length && same; i++) same = bodies[i].id === t.bodyIds[i];
    for (let i = 0; i < joints.length && same; i++) {
      const j = joints[i];
      same = j === t.joints[i] && j.id + "\u0000" + j.a + "\u0000" + j.b === t.jointKeys[i];
    }
    if (same) return t;
  }
  const fresh: Topology = {
    bodyIds: bodies.map((b) => b.id),
    joints: [...joints],
    jointKeys: joints.map((j) => j.id + "\u0000" + j.a + "\u0000" + j.b),
    roots: buildRoots(bodies, joints),
    sides: new Map(),
  };
  topologies.set(joints, fresh);
  return fresh;
}

/** Union-find over joints: body id → id of its assembly's root (the smallest id in it). */
function buildRoots(bodies: readonly { id: string }[], joints: readonly { a: string; b: string }[]): Map<string, string> {
  const parent = new Map<string, string>();
  for (const b of bodies) parent.set(b.id, b.id);
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  for (const j of joints) {
    if (!parent.has(j.a) || !parent.has(j.b)) continue;
    const ra = find(j.a);
    const rb = find(j.b);
    if (ra !== rb) {
      if (ra < rb) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }
  const out = new Map<string, string>();
  for (const id of parent.keys()) out.set(id, find(id));
  return out;
}

/** Body id → id of its assembly's root (the smallest id in it). Shared: callers must not change it. */
export function assemblyRoots(world: Pick<World, "bodies" | "joints">): ReadonlyMap<string, string> {
  return topology(world).roots;
}

/** The ids of every body in `id`'s assembly, sorted. */
export function assemblyOf(world: World, id: string): string[] {
  const t = topology(world);
  if (!t.members) {
    t.members = new Map();
    for (const [b, r] of t.roots) {
      const list = t.members.get(r);
      if (list) list.push(b);
      else t.members.set(r, [b]);
    }
    for (const list of t.members.values()) list.sort();
  }
  const root = t.roots.get(id);
  return root === undefined ? [] : [...t.members.get(root)!];
}

export interface AssemblyProps {
  mass: number; // kg
  centreOfMass: Vec2; // m
  /** About the assembly's centre of mass, kg·m² (parallel axis theorem). */
  inertia: number;
  count: number;
}

/** Mass properties of a set of bodies treated as one rigid assembly (ASM-001, ORC-004). */
export function assemblyProps(bodies: { mass: number; inertia: number; position: Vec2 }[]): AssemblyProps {
  let m = 0;
  let cx = 0;
  let cy = 0;
  for (const b of bodies) {
    m += b.mass;
    cx += b.mass * b.position.x;
    cy += b.mass * b.position.y;
  }
  const com = m > 0 ? { x: cx / m, y: cy / m } : { x: 0, y: 0 };
  let I = 0;
  for (const b of bodies) {
    const d = sub(b.position, com);
    I += b.inertia + b.mass * dot(d, d);
  }
  return { mass: m, centreOfMass: com, inertia: I, count: bodies.length };
}

export function prepareJoints(world: World, byId: Map<string, JointBody>, dt: number): JointSolver[] {
  const out: JointSolver[] = [];
  for (const j of world.joints) {
    const a = byId.get(j.a);
    const b = byId.get(j.b);
    if (!a || !b || (a.invMass === 0 && b.invMass === 0)) continue;
    const rA = rotate(a.rot, j.anchorA);
    const rB = rotate(b.rot, j.anchorB);
    const mA = a.invMass;
    const mB = b.invMass;
    const iA = a.invInertia;
    const iB = b.invInertia;
    const k11 = mA + mB + iA * rA.y * rA.y + iB * rB.y * rB.y;
    const k12 = -iA * rA.x * rA.y - iB * rB.x * rB.y;
    const k22 = mA + mB + iA * rA.x * rA.x + iB * rB.x * rB.x;
    const det = k11 * k22 - k12 * k12;
    const inv = det !== 0 ? 1 / det : 0;
    out.push({
      j,
      a,
      b,
      rA,
      rB,
      m11: inv * k22,
      m12: -inv * k12,
      m22: inv * k11,
      k11,
      k12,
      k22,
      angularMass: iA + iB > 0 ? 1 / (iA + iB) : 0,
      axis: rotate(a.rot, j.axis),
      // A damaged weld carries less (DMG-001): its limits scale with its integrity.
      lo: -j.limits.tension * j.integrity * dt,
      hi: j.limits.compression * j.integrity * dt,
      shear: j.limits.shear * j.integrity * dt,
      torque: j.limits.torque * j.integrity * dt,
      // No warm start: each step's weld impulse starts from zero. Reapplying last step's impulse
      // after the load has changed (an impact ending, thrust cut, gas pressure dropping) made the
      // solve create kinetic energy, up to 19 J in a crash, which the ledger reported. Loads come
      // from this step's impulse anyway (evaluateJoints).
      P: { x: 0, y: 0 },
      L: 0,
    });
  }
  return out;
}

const pointVel = (r: JointBody, rr: Vec2): Vec2 => add(r.body.velocity, crossSV(r.body.angularVelocity, rr));

function applyLinear(s: JointSolver, P: Vec2, acc: ConstraintAccount): void {
  if (P.x === 0 && P.y === 0) return;
  const before = sub(pointVel(s.b, s.rB), pointVel(s.a, s.rA));
  const A = s.a.body;
  const B = s.b.body;
  A.velocity = sub(A.velocity, scale(P, s.a.invMass));
  A.angularVelocity -= s.a.invInertia * cross(s.rA, P);
  B.velocity = add(B.velocity, scale(P, s.b.invMass));
  B.angularVelocity += s.b.invInertia * cross(s.rB, P);
  const after = sub(pointVel(s.b, s.rB), pointVel(s.a, s.rA));
  acc.predictedKE += dot(P, add(before, after)) / 2;
  if (s.a.invMass !== 0) acc.angular -= cross(add(A.position, s.rA), P);
  if (s.b.invMass !== 0) acc.angular += cross(add(B.position, s.rB), P);
  if (s.a.invMass === 0) acc.externalImpulse = add(acc.externalImpulse, P);
  else if (s.b.invMass === 0) acc.externalImpulse = sub(acc.externalImpulse, P);
}

function applyAngular(s: JointSolver, L: number, acc: ConstraintAccount): void {
  if (L === 0) return;
  const before = s.b.body.angularVelocity - s.a.body.angularVelocity;
  s.a.body.angularVelocity -= s.a.invInertia * L;
  s.b.body.angularVelocity += s.b.invInertia * L;
  const after = s.b.body.angularVelocity - s.a.body.angularVelocity;
  acc.predictedKE += (L * (before + after)) / 2;
  if (s.a.invMass !== 0) acc.angular -= L;
  if (s.b.invMass !== 0) acc.angular += L;
}

/** The largest t in [0, 1] that keeps x + t·d within [lo, hi], given x inside it. */
const reach = (x: number, d: number, lo: number, hi: number): number => Math.max(0, d > 0 && x + d > hi ? (hi - x) / d : d < 0 && x + d < lo ? (lo - x) / d : 1);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * One pass of the weld solve. A joint carries at most its limits (ASM-003): each accumulated
 * impulse stays inside its limit box. Every update minimises kinetic energy over a convex set
 * that contains the current impulse, so no update can add energy, capped or not. The point
 * constraint is solved as a block, cut short where it would leave the box, then slid along the
 * box's faces by one-direction solves. Taking back a capped joint's excess after the solve
 * instead could create kinetic energy, because the other joints had been solved against the
 * full impulse.
 */
export function solveJoints(js: JointSolver[], acc: ConstraintAccount): void {
  for (const s of js) {
    const wRel = s.b.body.angularVelocity - s.a.body.angularVelocity;
    const L = clamp(s.L - wRel * s.angularMass, -s.torque, s.torque);
    applyAngular(s, L - s.L, acc);
    s.L = L;
    const c = sub(pointVel(s.b, s.rB), pointVel(s.a, s.rA));
    const dP = { x: -(s.m11 * c.x + s.m12 * c.y), y: -(s.m12 * c.x + s.m22 * c.y) };
    const n = s.axis;
    const t = { x: -n.y, y: n.x };
    const pn = dot(s.P, n);
    const pt = dot(s.P, t);
    const dn = dot(dP, n);
    const dq = dot(dP, t);
    const f = Math.min(reach(pn, dn, s.lo, s.hi), reach(pt, dq, -s.shear, s.shear));
    const step = scale(dP, f);
    s.P = add(s.P, step);
    applyLinear(s, step, acc);
    if (f < 1) {
      slide(s, n, s.lo, s.hi, acc);
      slide(s, t, -s.shear, s.shear, acc);
    }
  }
}

/** Clears every weld's impulse for this step, to solve it again from the start. */
export function resetJoints(js: JointSolver[]): void {
  for (const s of js) {
    s.P = { x: 0, y: 0 };
    s.L = 0;
  }
}

/** Solves the point constraint along one direction only, keeping that component in [lo, hi]. */
function slide(s: JointSolver, d: Vec2, lo: number, hi: number, acc: ConstraintAccount): void {
  const k = s.k11 * d.x * d.x + 2 * s.k12 * d.x * d.y + s.k22 * d.y * d.y;
  if (!(k > 0)) return;
  const c = dot(sub(pointVel(s.b, s.rB), pointVel(s.a, s.rA)), d);
  const now = dot(s.P, d);
  const next = clamp(now - c / k, lo, hi);
  const step = scale(d, next - now);
  s.P = add(s.P, step);
  applyLinear(s, step, acc);
}

/**
 * Stores each joint's impulse (its load, see evaluateJoints) and returns the joints the solver
 * held at a limit, so they break, with the impulse each would have needed to hold: its demand.
 */
export function finishJoints(js: JointSolver[], acc: ConstraintAccount): Map<string, JointImpulse> {
  const capped = new Map<string, JointImpulse>();
  const near = (x: number, limit: number) => x >= limit * (1 - 1e-9);
  for (const s of js) {
    s.j.impulse = { x: s.P.x, y: s.P.y, angular: s.L };
    const axial = dot(s.P, s.axis);
    if (near(-axial, -s.lo) || near(axial, s.hi) || near(Math.abs(cross(s.axis, s.P)), s.shear) || near(Math.abs(s.L), s.torque)) {
      const c = sub(pointVel(s.b, s.rB), pointVel(s.a, s.rA));
      const wRel = s.b.body.angularVelocity - s.a.body.angularVelocity;
      capped.set(s.j.id, { x: s.P.x - (s.m11 * c.x + s.m12 * c.y), y: s.P.y - (s.m12 * c.x + s.m22 * c.y), angular: s.L - wRel * s.angularMass });
    }
    if (s.P.x !== 0 || s.P.y !== 0 || s.L !== 0) {
      acc.involved.add(s.j.a);
      acc.involved.add(s.j.b);
    }
  }
  return capped;
}

type Adjacency = Map<string, { id: string; a: string; b: string }[]>;

/** Each body's joints, built once per pass (searching every joint from every body was slow with many welds). */
function adjacency(joints: readonly { id: string; a: string; b: string }[]): Adjacency {
  const adj: Adjacency = new Map();
  for (const j of joints) {
    for (const id of [j.a, j.b]) {
      const list = adj.get(id);
      if (list) list.push(j);
      else adj.set(id, [j]);
    }
  }
  return adj;
}

/** The bodies on b's side of a joint (or, in a loop, a set holding a), kept with the topology. */
function farSide(t: Topology, j: Joint): Set<string> {
  let side = t.sides.get(j.id);
  if (!side) {
    t.adj ??= adjacency(t.joints);
    side = sideOf(t.adj, j.b, j.id, j.a);
    t.sides.set(j.id, side);
  }
  return side;
}

/**
 * Bodies reachable from `start` through joints, not using joint `skip`. Stops early once `stop` is
 * reached: then the joint is in a loop, and its callers don't need the rest.
 */
function sideOf(adj: Adjacency, start: string, skip: string, stop: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    for (const j of adj.get(id) ?? []) {
      if (j.id === skip) continue;
      const other = j.a === id ? j.b : j.a;
      if (seen.has(other)) continue;
      seen.add(other);
      if (other === stop) return seen;
      queue.push(other);
    }
  }
  return seen;
}

/**
 * Works out each joint's load from this step's impulses and breaks joints past a limit
 * (ASM-003, ASM-004). The load is the solver's impulse plus, for free assemblies, the
 * centripetal impulse the rigid rotation gave every part on b's side of the joint, plus what
 * it passed on from gas last step (recordGasLoads). Exact for tree-shaped assemblies; a joint in
 * a loop counts only the solver's share.
 */
export function evaluateJoints(world: World, dt: number, rigidImpulse: Map<string, Vec2>, capped: ReadonlyMap<string, JointImpulse>): void {
  const broken = new Set<string>();
  const t = topology(world);
  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  for (const j of world.joints) {
    const A = byId.get(j.a);
    const B = byId.get(j.b);
    if (!A || !B) continue;
    // A joint held at a limit is loaded by what it would have needed, not by what it carried.
    const own = capped.get(j.id) ?? j.impulse;
    let P = { x: own.x, y: own.y };
    let T = own.angular;
    if (rigidImpulse.size && rigidImpulse.has(j.b)) {
      const side = farSide(t, j);
      if (!side.has(j.a)) {
        const pB = add(B.position, rotate(sinCos(B.angle), j.anchorB));
        for (const id of side) {
          const J = rigidImpulse.get(id);
          const body = byId.get(id);
          if (!J || !body) continue;
          P = add(P, J);
          T += cross(sub(body.position, pB), J);
        }
      }
    }
    // Gas pushing the assembly last step (one step behind, so a break is evaluated, and its excess
    // impulse taken back, against this step's solver state).
    if (j.gasImpulse) {
      P = add(P, j.gasImpulse);
      T += j.gasImpulse.angular;
    }
    const F = scale(P, 1 / dt); // force on b
    const axis = rotate(sinCos(A.angle), j.axis);
    const axial = dot(F, axis);
    const tension = Math.max(0, -axial);
    const compression = Math.max(0, axial);
    const shear = Math.abs(cross(axis, F));
    const torque = Math.abs(T / dt);
    const k = j.integrity;
    const parts = {
      tension: tension / (j.limits.tension * k),
      compression: compression / (j.limits.compression * k),
      shear: shear / (j.limits.shear * k),
      torque: torque / (j.limits.torque * k),
    };
    const worst = (Object.keys(parts) as (keyof typeof parts)[]).reduce((w, k) => (parts[k] > parts[w] ? k : w), "tension");
    j.load = { tension, compression, shear, torque, fraction: parts[worst] };
    if (parts[worst] > 1 || capped.has(j.id)) {
      broken.add(j.id);
      world.events.push({ tick: world.tick, type: "joint.break", data: { id: j.id, a: j.a, b: j.b, quantity: worst, load: parts[worst] * j.limits[worst] * k, limit: j.limits[worst] * k } });
    }
  }
  if (broken.size) world.joints = world.joints.filter((j) => !broken.has(j.id));
}

/**
 * Gas pushes a free assembly as one rigid body, so each joint must pass on the difference between
 * what the parts on b's side received from that rigid motion and what the gas pushed on them
 * directly. Stored on the joint for the next step's evaluation (ASM-004 under thrust, RS-10).
 */
export function recordGasLoads(world: World, supplied: Map<string, { x: number; y: number; angular: number }>): void {
  const t = topology(world);
  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  for (const j of world.joints) {
    j.gasImpulse = undefined;
    if (!supplied.size || !supplied.has(j.b)) continue;
    const B = byId.get(j.b);
    if (!B) continue;
    const side = farSide(t, j);
    if (side.has(j.a)) continue; // a loop: the solver shares it
    const pB = add(B.position, rotate(sinCos(B.angle), j.anchorB));
    let x = 0;
    let y = 0;
    let angular = 0;
    for (const id of side) {
      const J = supplied.get(id);
      const body = byId.get(id);
      if (!J || !body) continue;
      x += J.x;
      y += J.y;
      angular += cross(sub(body.position, pB), J) + J.angular;
    }
    j.gasImpulse = { x, y, angular };
  }
}

const JOINT_BAUMGARTE = 0.5;

/** Pulls joint anchors back together and restores the welded angle, without touching velocities. */
export function correctJoints(world: World, byId: Map<string, JointBody>): void {
  for (const j of world.joints) {
    const a = byId.get(j.a);
    const b = byId.get(j.b);
    if (!a || !b || (a.invMass === 0 && b.invMass === 0)) continue;
    const A = a.body;
    const B = b.body;
    const iA = a.invInertia;
    const iB = b.invInertia;
    if (iA + iB > 0) {
      const C = B.angle - A.angle - j.referenceAngle;
      const L = (-JOINT_BAUMGARTE * C) / (iA + iB);
      A.angle -= iA * L;
      B.angle += iB * L;
    }
    const rA = rotate(sinCos(A.angle), j.anchorA);
    const rB = rotate(sinCos(B.angle), j.anchorB);
    const C = sub(add(B.position, rB), add(A.position, rA));
    const mA = a.invMass;
    const mB = b.invMass;
    const k11 = mA + mB + iA * rA.y * rA.y + iB * rB.y * rB.y;
    const k12 = -iA * rA.x * rA.y - iB * rB.x * rB.y;
    const k22 = mA + mB + iA * rA.x * rA.x + iB * rB.x * rB.x;
    const det = k11 * k22 - k12 * k12;
    if (det === 0) continue;
    const inv = 1 / det;
    const P = scale({ x: -(inv * k22 * C.x - inv * k12 * C.y), y: -(-inv * k12 * C.x + inv * k11 * C.y) }, JOINT_BAUMGARTE);
    A.position = sub(A.position, scale(P, mA));
    A.angle -= iA * cross(rA, P);
    B.position = add(B.position, scale(P, mB));
    B.angle += iB * cross(rB, P);
  }
}
