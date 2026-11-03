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
  angularMass: number;
  P: Vec2;
  L: number;
}

/** Union-find over joints: body id → id of its assembly's root (the smallest id in it). */
export function assemblyRoots(world: World): Map<string, string> {
  const parent = new Map<string, string>();
  for (const b of world.bodies) parent.set(b.id, b.id);
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
  for (const j of world.joints) {
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

/** The ids of every body in `id`'s assembly, sorted. */
export function assemblyOf(world: World, id: string): string[] {
  const roots = assemblyRoots(world);
  const root = roots.get(id);
  return [...roots.entries()].filter(([, r]) => r === root).map(([b]) => b).sort();
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

export function prepareJoints(world: World, byId: Map<string, JointBody>): JointSolver[] {
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
      angularMass: iA + iB > 0 ? 1 / (iA + iB) : 0,
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

export function solveJoints(js: JointSolver[], acc: ConstraintAccount): void {
  for (const s of js) {
    const wRel = s.b.body.angularVelocity - s.a.body.angularVelocity;
    const dL = -wRel * s.angularMass;
    s.L += dL;
    applyAngular(s, dL, acc);
    const c = sub(pointVel(s.b, s.rB), pointVel(s.a, s.rA));
    const dP = { x: -(s.m11 * c.x + s.m12 * c.y), y: -(s.m12 * c.x + s.m22 * c.y) };
    s.P = add(s.P, dP);
    applyLinear(s, dP, acc);
  }
}

/** Stores each joint's accumulated impulse for warm starting next step. */
export function finishJoints(js: JointSolver[], acc: ConstraintAccount): void {
  for (const s of js) {
    s.j.impulse = { x: s.P.x, y: s.P.y, angular: s.L };
    if (s.P.x !== 0 || s.P.y !== 0 || s.L !== 0) {
      acc.involved.add(s.j.a);
      acc.involved.add(s.j.b);
    }
  }
}

/** Bodies reachable from `start` through joints, not using joint `skip`. */
function sideOf(world: World, start: string, skip: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.pop()!;
    for (const j of world.joints) {
      if (j.id === skip) continue;
      const other = j.a === id ? j.b : j.b === id ? j.a : null;
      if (other && !seen.has(other)) {
        seen.add(other);
        queue.push(other);
      }
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
export function evaluateJoints(world: World, dt: number, rigidImpulse: Map<string, Vec2>, rigid: (b: Body) => JointBody): ConstraintAccount {
  const acc = emptyAccount();
  const broken = new Set<string>();
  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  for (const j of world.joints) {
    const A = byId.get(j.a);
    const B = byId.get(j.b);
    if (!A || !B) continue;
    let P = { x: j.impulse.x, y: j.impulse.y };
    let T = j.impulse.angular;
    if (rigidImpulse.size && rigidImpulse.has(j.b)) {
      const side = sideOf(world, j.b, j.id);
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
    const parts = {
      tension: tension / j.limits.tension,
      compression: compression / j.limits.compression,
      shear: shear / j.limits.shear,
      torque: torque / j.limits.torque,
    };
    const worst = (Object.keys(parts) as (keyof typeof parts)[]).reduce((w, k) => (parts[k] > parts[w] ? k : w), "tension");
    j.load = { tension, compression, shear, torque, fraction: parts[worst] };
    if (parts[worst] > 1) {
      broken.add(j.id);
      world.events.push({ tick: world.tick, type: "joint.break", data: { id: j.id, a: j.a, b: j.b, quantity: worst, load: parts[worst] * j.limits[worst], limit: j.limits[worst] } });
      // A joint that breaks only carries up to its limit: take back the rest of this step's solver impulse.
      const keep = 1 / parts[worst];
      const s = { a: rigid(A), b: rigid(B), rA: rotate(sinCos(A.angle), j.anchorA), rB: rotate(sinCos(B.angle), j.anchorB) } as JointSolver;
      applyLinear(s, scale({ x: j.impulse.x, y: j.impulse.y }, keep - 1), acc);
      applyAngular(s, j.impulse.angular * (keep - 1), acc);
    }
  }
  if (broken.size) world.joints = world.joints.filter((j) => !broken.has(j.id));
  return acc;
}

/**
 * Gas pushes a free assembly as one rigid body, so each joint must pass on the difference between
 * what the parts on b's side received from that rigid motion and what the gas pushed on them
 * directly. Stored on the joint for the next step's evaluation (ASM-004 under thrust, RS-10).
 */
export function recordGasLoads(world: World, supplied: Map<string, { x: number; y: number; angular: number }>): void {
  const byId = new Map(world.bodies.map((b) => [b.id, b]));
  for (const j of world.joints) {
    j.gasImpulse = undefined;
    if (!supplied.size || !supplied.has(j.b)) continue;
    const B = byId.get(j.b);
    if (!B) continue;
    const side = sideOf(world, j.b, j.id);
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
