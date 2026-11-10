// Rigid-body physics for one fixed step (PHY-002…PHY-004, COL-001…COL-006).
//
// Pipeline: field forces → user springs → contacts (sequential impulses with
// warm starting, speculative contacts and a restitution pass) → position
// integration (semi-implicit Euler) → position correction (non-linear
// Gauss–Seidel). Only the integrator writes positions from velocities; the
// contact solver changes velocities only through equal and opposite impulses,
// and position correction moves pairs apart along the contact normal.
// The solver structure follows Box2D (Erin Catto).

import { bodyMass } from "./bodies.ts";
import { collide, type Manifold, type Placed } from "./collide.ts";
import { assemblyOf, assemblyRoots, topologyToken, correctJoints, emptyAccount, finishJoints, prepareJoints, resetJoints, solveJoints, type ConstraintAccount, type JointBody } from "./joints.ts";
import { add, cross, crossSV, dot, invRotate, length, rotate, scale, sinCos, sub, type Rot, type Vec2 } from "./math.ts";
import type { Profile } from "./profile.ts";
import { massProps } from "./shapes.ts";
import type { Body, Contact, World } from "./world.ts";
export type { JointBody };

/** Normal approach speed below which restitution is ignored, so resting contacts don't jitter. m/s */
const RESTITUTION_THRESHOLD = 0.1;
const POSITION_ITERATIONS = 4;
const BAUMGARTE = 0.2;
const MAX_CORRECTION = 0.2; // m per iteration

export interface RB {
  body: Body;
  /** Total mass including stores, kg. */
  mass: number;
  invMass: number;
  invInertia: number;
  inertia: number;
  radius: number;
  rot: Rot;
}

interface SolverPoint {
  rA: Vec2;
  rB: Vec2;
  normalMass: number;
  tangentMass: number;
  separation: number;
  vn0: number;
  normalImpulse: number;
  tangentImpulse: number;
  maxNormalImpulse: number;
  energyLost: number;
  key: number;
  point: Vec2;
  localA: Vec2;
  localB: Vec2;
}

interface SolverContact {
  a: RB;
  b: RB;
  normal: Vec2;
  friction: number;
  restitution: number;
  points: SolverPoint[];
  isNew: boolean;
  /** For disc pairs that collide mid-step: the time of impact within the step, s. */
  toi?: number;
}

/** What the contact solver did, for the ledger. */
export type ContactAccount = ConstraintAccount;

function rigid(body: Body): RB {
  const mass = bodyMass(body);
  const mp = massProps(body.shape, mass);
  const fixed = body.fixed;
  return {
    body,
    mass,
    invMass: fixed ? 0 : 1 / mass,
    invInertia: fixed ? 0 : 1 / mp.inertia,
    inertia: mp.inertia,
    radius: mp.boundingRadius,
    rot: sinCos(body.angle),
  };
}

const placed = (r: RB): Placed => ({ shape: r.body.shape, position: r.body.position, rot: r.rot });

export { rigid };

/**
 * A fixed body's solver view, kept while it is unchanged: a lander's ground is hundreds of fixed
 * bodies, and making each a new one every step was a share of the step's garbage. Nothing changes
 * a view once made.
 */
const fixedViews = new WeakMap<Body, { rb: RB; angle: number; shape: Body["shape"]; mass: number }>();
function fixedView(body: Body): RB {
  const kept = fixedViews.get(body);
  const mass = bodyMass(body);
  if (kept && kept.angle === body.angle && kept.shape === body.shape && kept.mass === mass) return kept.rb;
  const rb = rigid(body);
  fixedViews.set(body, { rb, angle: body.angle, shape: body.shape, mass });
  return rb;
}

export function prepareBodies(world: World): RB[] {
  return world.bodies.map((b) => (b.fixed ? fixedView(b) : rigid(b)));
}

/** Applies uniform gravity to dynamic bodies; returns the impulse and angular impulse delivered. */
export function applyField(rbs: RB[], g: Vec2, dt: number): { impulse: Vec2; angular: number } {
  let ix = 0;
  let iy = 0;
  let ang = 0;
  if (g.x === 0 && g.y === 0) return { impulse: { x: 0, y: 0 }, angular: 0 };
  for (const r of rbs) {
    if (r.invMass === 0) continue;
    const J = { x: r.mass * g.x * dt, y: r.mass * g.y * dt };
    r.body.velocity = { x: r.body.velocity.x + g.x * dt, y: r.body.velocity.y + g.y * dt };
    ix += J.x;
    iy += J.y;
    ang += cross(r.body.position, J);
  }
  return { impulse: { x: ix, y: iy }, angular: ang };
}

/** Applies an impulse at a world point to one body (no reaction: used for user input and springs). */
export function applyImpulseAt(r: { body: Body; invMass: number; invInertia: number }, impulse: Vec2, point: Vec2): void {
  if (r.invMass === 0) return;
  const rr = sub(point, r.body.position);
  r.body.velocity = add(r.body.velocity, scale(impulse, r.invMass));
  r.body.angularVelocity += r.invInertia * cross(rr, impulse);
}

export function applyDrags(world: World, rbs: RB[], dt: number): void {
  for (const d of world.drags) {
    const r = rbs.find((x) => x.body.id === d.id);
    if (!r || r.invMass === 0) continue;
    const anchor = add(r.body.position, rotate(r.rot, d.anchor));
    const rr = sub(anchor, r.body.position);
    const vAnchor = add(r.body.velocity, crossSV(r.body.angularVelocity, rr));
    const m = r.mass;
    const k = d.stiffness * m;
    const c = 2 * Math.sqrt(k * m);
    let f = sub(scale(sub(d.target, anchor), k), scale(vAnchor, c));
    const fMax = d.maxAcceleration * m;
    const fl = length(f);
    if (fl > fMax) f = scale(f, fMax / fl);
    applyImpulseAt(r, scale(f, dt), anchor);
  }
}

function pairKey(a: string, b: string, key: number): string {
  return `${a}\u0000${b}\u0000${key}`;
}

/** Sort-and-sweep broad phase on fattened AABBs (NFR-003). Returns index pairs i<j in a deterministic order. */
/**
 * Pairs of boxes that overlap, in order. With `fixed`, two fixed bodies are never a pair: they can't
 * touch each other. With `group`, two in the same group (an assembly: its parts don't collide) never are.
 */
export function broadPhase(boxes: { minX: number; minY: number; maxX: number; maxY: number }[], fixed?: readonly boolean[], group?: readonly number[]): [number, number][] {
  const n = boxes.length;
  const b = boxBuffers(n);
  boxes.forEach((x, i) => {
    b.minX[i] = x.minX;
    b.minY[i] = x.minY;
    b.maxX[i] = x.maxX;
    b.maxY[i] = x.maxY;
  });
  return [...sweepPairs(n, b, fixed, group)].map((c) => [Math.floor(c / n), c % n]);
}

interface Boxes {
  minX: Float64Array;
  minY: Float64Array;
  maxX: Float64Array;
  maxY: Float64Array;
}
let boxScratch: Boxes = { minX: new Float64Array(0), minY: new Float64Array(0), maxX: new Float64Array(0), maxY: new Float64Array(0) };
const sweepOrder: number[] = [];
const sweepActive: number[] = [];
const sweepCodes: number[] = [];

/** Box arrays for n bodies, reused from step to step (one box object per body, ground included, was most of the churn here). */
function boxBuffers(n: number): Boxes {
  if (boxScratch.minX.length < n) {
    const m = Math.max(n, 2 * boxScratch.minX.length);
    boxScratch = { minX: new Float64Array(m), minY: new Float64Array(m), maxX: new Float64Array(m), maxY: new Float64Array(m) };
  }
  return boxScratch;
}

/**
 * The sweep behind broadPhase, on box arrays. Each pair i<j comes back as the number i·n + j, sorted,
 * which is the same order as sorting the pairs by i then j. The result is reused by the next call.
 */
function sweepPairs(n: number, b: Boxes, fixed?: readonly boolean[], group?: readonly number[]): Float64Array {
  const { minX, minY, maxX, maxY } = b;
  const order = sweepOrder;
  order.length = n;
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((i, j) => minX[i] - minX[j] || i - j);
  const codes = sweepCodes;
  codes.length = 0;
  const active = sweepActive;
  active.length = 0;
  for (let o = 0; o < n; o++) {
    const i = order[o];
    let w = 0;
    for (let k = 0; k < active.length; k++) {
      const j = active[k];
      if (maxX[j] < minX[i]) continue; // falls out of the sweep
      active[w++] = j;
      if (minY[j] <= maxY[i] && minY[i] <= maxY[j] && !(fixed?.[i] && fixed[j]) && !(group && group[i] === group[j])) codes.push(i < j ? i * n + j : j * n + i);
    }
    active.length = w;
    active.push(i);
  }
  return Float64Array.from(codes).sort();
}

/**
 * Assemblies by body index (body i of the world is rbs[i]): `lists` holds each assembly's indices, in
 * order of first appearance, and `group[i]` the number of body i's assembly, in the same order.
 * Built once per topology, not every step (two maps and hundreds of arrays a step).
 */
interface Groups {
  lists: number[][];
  group: number[];
}
const groupsByTopology = new WeakMap<object, Groups>();
function assemblyGroups(world: World): Groups {
  const token = topologyToken(world);
  let g = groupsByTopology.get(token);
  if (g) return g;
  const roots = assemblyRoots(world);
  const index = new Map<string, number>();
  const lists: number[][] = [];
  const group = world.bodies.map((b, i) => {
    const root = roots.get(b.id) ?? b.id;
    let k = index.get(root);
    if (k === undefined) {
      index.set(root, (k = index.size));
      lists.push([]);
    }
    lists[k].push(i);
    return k;
  });
  g = { lists, group };
  groupsByTopology.set(token, g);
  return g;
}

/**
 * Velocity solve for one step: contacts and joints together (sequential impulses).
 * Bodies in the same assembly don't collide with each other.
 */
export function solveContacts(world: World, rbs: RB[], profile: Profile): { account: ContactAccount; jointAccount: ConstraintAccount; capped: ReturnType<typeof finishJoints>; solved: SolvedContacts } {
  const dt = profile.timestep;
  const slop = profile.tol.penetration / 2;
  const sweep = rbs.map((r) => (r.invMass === 0 ? 0 : (length(r.body.velocity) + Math.abs(r.body.angularVelocity) * r.radius) * dt));
  const boxes = boxBuffers(rbs.length);
  for (let i = 0; i < rbs.length; i++) {
    const r = rbs[i];
    const e = sweep[i] + slop;
    const p = r.body.position;
    const rad = (r.body.shape.kind === "disc" ? r.body.shape.radius : r.radius) + e;
    boxes.minX[i] = p.x - rad;
    boxes.minY[i] = p.y - rad;
    boxes.maxX[i] = p.x + rad;
    boxes.maxY[i] = p.y + rad;
  }

  const previous = new Map<string, Contact>();
  // A contact's last impulse was sized for the assembly it pushed then. If welds broke last step,
  // the parts of that assembly now move on their own, and reapplying it (warm starting) can make
  // the solve create kinetic energy, up to 18 J a step as a ship came apart on a rock. Those parts'
  // contacts start from zero instead.
  const loosened = new Set<string>();
  for (const e of world.events) {
    if (e.type !== "joint.break" || e.tick !== world.tick - 1) continue;
    for (const id of [String(e.data.a), String(e.data.b)]) for (const m of assemblyOf(world, id)) loosened.add(m);
  }
  for (const c of world.contacts) if (!loosened.has(c.a) && !loosened.has(c.b)) previous.set(pairKey(c.a, c.b, c.key), c);
  // Pairs that were actually pushing last step; a speculative contact with no impulse is not a touch.
  const previousPairs = new Set(world.contacts.filter((c) => c.normalImpulse > 0).map((c) => `${c.a}\u0000${c.b}`));

  const roots = world.joints.length ? assemblyRoots(world) : null;
  const contacts: SolverContact[] = [];
  // Fixed bodies never touch each other: a lander's ground is hundreds of them, overlapping their
  // neighbours' boxes (12,000 pairs a step, all thrown away).
  // Parts of one assembly never touch each other either: a welded asteroid's 130 parts overlapped
  // their neighbours' boxes, hundreds of pairs a step, all thrown away below.
  const group = roots ? assemblyGroups(world).group : undefined;
  const nb = rbs.length;
  for (const code of sweepPairs(nb, boxes, rbs.map((r) => r.invMass === 0), group)) {
    const i = Math.floor(code / nb);
    const j = code % nb;
    const a = rbs[i];
    const b = rbs[j];
    if (a.invMass === 0 && b.invMass === 0) continue;
    if (roots && roots.get(a.body.id) === roots.get(b.body.id)) continue;
    const m = collide(placed(a), placed(b), sweep[i] + sweep[j] + slop, slop);
    if (!m) continue;
    let toi: number | undefined;
    if (a.body.shape.kind === "disc" && b.body.shape.kind === "disc") {
      const impact = discImpact(a, b, m, dt);
      if (impact === null) continue;
      toi = impact;
    }
    const n = m.normal;
    const t = { x: n.y, y: -n.x };
    const points: SolverPoint[] = m.points.map((p) => {
      // A disc pair hitting mid-step is solved in its time-of-impact configuration: lever arms along the normal.
      const rA = toi !== undefined ? scale(n, (a.body.shape as { radius: number }).radius) : sub(p.point, a.body.position);
      const rB = toi !== undefined ? scale(n, -(b.body.shape as { radius: number }).radius) : sub(p.point, b.body.position);
      const rnA = cross(rA, n);
      const rnB = cross(rB, n);
      const rtA = cross(rA, t);
      const rtB = cross(rB, t);
      const kN = a.invMass + b.invMass + a.invInertia * rnA * rnA + b.invInertia * rnB * rnB;
      const kT = a.invMass + b.invMass + a.invInertia * rtA * rtA + b.invInertia * rtB * rtB;
      const dv = sub(add(b.body.velocity, crossSV(b.body.angularVelocity, rB)), add(a.body.velocity, crossSV(a.body.angularVelocity, rA)));
      const prev = previous.get(pairKey(a.body.id, b.body.id, p.key));
      const surfA = sub(p.point, scale(n, p.separation / 2));
      const surfB = add(p.point, scale(n, p.separation / 2));
      return {
        rA,
        rB,
        normalMass: kN > 0 ? 1 / kN : 0,
        tangentMass: kT > 0 ? 1 / kT : 0,
        separation: p.separation,
        vn0: dot(dv, n),
        normalImpulse: prev ? prev.normalImpulse : 0,
        tangentImpulse: prev ? prev.tangentImpulse : 0,
        maxNormalImpulse: 0,
        energyLost: 0,
        key: p.key,
        point: p.point,
        localA: invRotate(a.rot, sub(surfA, a.body.position)),
        localB: invRotate(b.rot, sub(surfB, b.body.position)),
      };
    });
    contacts.push({
      a,
      b,
      normal: n,
      friction: Math.sqrt(a.body.friction * b.body.friction),
      restitution: Math.max(a.body.restitution, b.body.restitution),
      points,
      isNew: !previousPairs.has(`${a.body.id}\u0000${b.body.id}`),
      toi,
    });
  }

  const account: ContactAccount = emptyAccount();
  const jointAccount = emptyAccount();
  const byId = new Map<string, JointBody>(rbs.map((r) => [r.body.id, r]));
  const joints = prepareJoints(world, byId, dt);

  // Applies impulse `lambda` along `dir` at a contact point: +B, −A. Tracks energy and external impulse exactly.
  const relVel = (c: SolverContact, p: SolverPoint): Vec2 =>
    sub(add(c.b.body.velocity, crossSV(c.b.body.angularVelocity, p.rB)), add(c.a.body.velocity, crossSV(c.a.body.angularVelocity, p.rA)));
  const apply = (c: SolverContact, p: SolverPoint, dir: Vec2, lambda: number) => {
    if (lambda === 0) return;
    const before = dot(relVel(c, p), dir);
    const P = scale(dir, lambda);
    const A = c.a.body;
    const B = c.b.body;
    A.velocity = sub(A.velocity, scale(P, c.a.invMass));
    A.angularVelocity -= c.a.invInertia * cross(p.rA, P);
    B.velocity = add(B.velocity, scale(P, c.b.invMass));
    B.angularVelocity += c.b.invInertia * cross(p.rB, P);
    const after = dot(relVel(c, p), dir);
    const dE = (lambda * (before + after)) / 2;
    p.energyLost -= dE;
    account.predictedKE += dE;
    // Moment of each impulse about the origin, on the dynamic bodies it acts on.
    if (c.a.invMass !== 0) account.angular -= cross(add(A.position, p.rA), P);
    if (c.b.invMass !== 0) account.angular += cross(add(B.position, p.rB), P);
    if (c.a.invMass === 0) account.externalImpulse = add(account.externalImpulse, P);
    else if (c.b.invMass === 0) account.externalImpulse = sub(account.externalImpulse, P);
  };

  const solve = (warm: boolean) => {
    // Warm start contacts from the previous step's impulses (welds start from zero: see prepareJoints).
    if (warm) {
      for (const c of contacts) {
        const t = { x: c.normal.y, y: -c.normal.x };
        for (const p of c.points) {
          apply(c, p, c.normal, p.normalImpulse);
          apply(c, p, t, p.tangentImpulse);
        }
      }
    }

    for (let it = 0; it < profile.solverIterations; it++) {
      solveJoints(joints, jointAccount);
      for (const c of contacts) {
        const n = c.normal;
        const t = { x: n.y, y: -n.x };
        for (const p of c.points) {
          // Friction, limited by the current normal impulse (Coulomb).
          const vt = dot(relVel(c, p), t);
          const maxF = c.friction * p.normalImpulse;
          const newT = Math.max(-maxF, Math.min(maxF, p.tangentImpulse - vt * p.tangentMass));
          apply(c, p, t, newT - p.tangentImpulse);
          p.tangentImpulse = newT;
        }
        for (const p of c.points) {
          // Non-penetration. A positive separation lets the bodies close exactly that gap this step (speculative contact).
          const vn = dot(relVel(c, p), n);
          const bias = p.separation > 0 ? p.separation / dt : 0;
          const newN = Math.max(0, p.normalImpulse - (vn + bias) * p.normalMass);
          apply(c, p, n, newN - p.normalImpulse);
          p.normalImpulse = newN;
          p.maxNormalImpulse = Math.max(p.maxNormalImpulse, newN);
        }
      }
    }

    // Restitution: contacts that engaged this step leave at −e × their approach speed.
    // This also runs for e = 0, so a speculative impact finishes within one step instead of
    // carrying leftover approach speed into the next step (where the normal has rotated).
    for (const c of contacts) {
      for (const p of c.points) {
        if (p.vn0 > -RESTITUTION_THRESHOLD || p.maxNormalImpulse === 0) continue;
        const vn = dot(relVel(c, p), c.normal);
        let newN = Math.max(0, p.normalImpulse - (vn + c.restitution * p.vn0) * p.normalMass);
        // Newton's restitution with friction can add energy in off-centre impacts (Kane's paradox).
        // Cap the extra impulse so this point never returns more energy than it has absorbed this step:
        // the work of impulse λ is λ·vn + λ²/(2·normalMass), which must stay ≤ energyLost.
        const extra = newN - p.normalImpulse;
        if (extra > 0 && p.normalMass > 0) {
          const L0 = Math.max(0, p.energyLost);
          const limit = p.normalMass * (-vn + Math.sqrt(vn * vn + (2 * L0) / p.normalMass));
          if (extra > limit) newN = p.normalImpulse + Math.max(0, limit);
        }
        apply(c, p, c.normal, newN - p.normalImpulse);
        p.normalImpulse = newN;
      }
    }
  };
  // Keep what the solve starts from, in case it has to run again.
  const v0 = rbs.map((r) => ({ v: r.body.velocity, w: r.body.angularVelocity }));
  const ke0 = rbs.reduce((e, r) => (r.invMass === 0 ? e : e + 0.5 * r.mass * (r.body.velocity.x ** 2 + r.body.velocity.y ** 2) + 0.5 * r.inertia * r.body.angularVelocity ** 2), 0);
  const warmImpulses = contacts.map((c) => c.points.map((p) => ({ n: p.normalImpulse, t: p.tangentImpulse })));
  solve(true);
  // Every weld and contact update lowers kinetic energy or leaves it, except reapplying contacts' last
  // impulses (warm starting). Iterations usually take that back, but not always: a ship coming apart
  // on a rock gained up to 13 J a step, its contacts adding far more than its welds removed. If the
  // solve gained more than the ledger allows (finishLedger), solve the step again with every contact
  // starting from zero, which can't gain energy.
  const gained = account.predictedKE + jointAccount.predictedKE;
  if (gained > profile.tol.energy + 1e-5 * ke0 && warmImpulses.some((ps) => ps.some((q) => q.n !== 0 || q.t !== 0))) {
    rbs.forEach((r, i) => {
      r.body.velocity = v0[i].v;
      r.body.angularVelocity = v0[i].w;
    });
    for (const c of contacts)
      for (const p of c.points) {
        p.normalImpulse = 0;
        p.tangentImpulse = 0;
        p.maxNormalImpulse = 0;
        p.energyLost = 0;
      }
    for (const acc of [account, jointAccount]) {
      acc.externalImpulse = { x: 0, y: 0 };
      acc.angular = 0;
      acc.predictedKE = 0;
      acc.involved.clear();
    }
    resetJoints(joints);
    solve(false);
  }

  // Record contacts for warm starting, overlays and damage (COL-006).
  const records: Contact[] = [];
  for (const c of contacts) {
    let total = 0;
    for (const p of c.points) {
      if (p.maxNormalImpulse > 0 || p.normalImpulse > 0) {
        account.involved.add(c.a.body.id);
        account.involved.add(c.b.body.id);
      }
      total += p.normalImpulse;
      records.push({
        a: c.a.body.id,
        b: c.b.body.id,
        key: p.key,
        point: p.point,
        normal: c.normal,
        separation: p.separation,
        normalImpulse: p.normalImpulse,
        tangentImpulse: p.tangentImpulse,
        energyLost: p.energyLost,
      });
    }
    if (c.isNew && total > 0) {
      world.events.push({
        tick: world.tick,
        type: "collision",
        data: { a: c.a.body.id, b: c.b.body.id, impulse: total, speed: -Math.min(...c.points.map((p) => p.vn0)) },
      });
    }
  }
  world.contacts = records;
  const capped = finishJoints(joints, jointAccount);
  return { account, jointAccount, capped, solved: { contacts, byId } };
}

/**
 * Two discs closing within this step: returns the time of impact and rewrites the
 * manifold to the line of centres at that moment, or null if they will not meet
 * this step. Already-touching discs return undefined (an ordinary contact).
 * Bodies are taken to move in straight lines over one step.
 */
function discImpact(a: RB, b: RB, m: Manifold, dt: number): number | undefined | null {
  const p = m.points[0];
  if (p.separation <= 0) return undefined;
  const ra = (a.body.shape as { radius: number }).radius;
  const R = ra + (b.body.shape as { radius: number }).radius;
  const d0 = sub(b.body.position, a.body.position);
  const u = sub(b.body.velocity, a.body.velocity);
  const qa = dot(u, u);
  const qb = 2 * dot(d0, u);
  const qc = dot(d0, d0) - R * R;
  const disc = qb * qb - 4 * qa * qc;
  if (!(qa > 0) || disc < 0) return null;
  const t = (-qb - Math.sqrt(disc)) / (2 * qa);
  if (!(t >= 0 && t <= dt)) return null;
  const n = scale(add(d0, scale(u, t)), 1 / R);
  const sep = dot(d0, n) - R;
  m.normal = n;
  m.points = [{ point: add(a.body.position, scale(n, ra + sep / 2)), separation: sep, key: p.key }];
  return t;
}

/**
 * After integration, moves disc pairs that collided mid-step onto their true paths:
 * old velocity until the time of impact, new velocity after it. Without this the
 * impulse would effectively act at the start of the step.
 */
export function applyImpactFix(solved: SolvedContacts): void {
  for (const c of solved.contacts) {
    if (c.toi === undefined) continue;
    const t = { x: c.normal.y, y: -c.normal.x };
    for (const p of c.points) {
      if (p.normalImpulse === 0 && p.tangentImpulse === 0) continue;
      const P = add(scale(c.normal, p.normalImpulse), scale(t, p.tangentImpulse));
      const A = c.a.body;
      const B = c.b.body;
      A.position = add(A.position, scale(P, c.a.invMass * c.toi));
      A.angle += c.a.invInertia * cross(p.rA, P) * c.toi;
      B.position = sub(B.position, scale(P, c.b.invMass * c.toi));
      B.angle -= c.b.invInertia * cross(p.rB, P) * c.toi;
    }
  }
}

/** Solver state handed from the velocity solve to position correction within one step. */
export interface SolvedContacts {
  contacts: SolverContact[];
  byId: Map<string, JointBody>;
}

/**
 * Semi-implicit Euler position update, using the velocities after forces and contacts.
 * A free assembly of welded parts moves exactly as one rigid body for the step: positions
 * and velocities rotate together about its centre of mass. Sliding each part in a straight
 * line instead loses angular momentum by (ω·dt)²/2 per step (a welded pair visibly slows
 * its spin). Returns the impulse each part received from that rotation, i.e. the
 * centripetal impulse its joints supplied, so joint loads can include it.
 */
export function integratePositions(rbs: RB[], dt: number, world?: World): Map<string, Vec2> {
  const rigidImpulse = new Map<string, Vec2>();
  const grouped = new Uint8Array(rbs.length);
  if (world && world.joints.length) {
    for (const list of assemblyGroups(world).lists) {
      if (list.length < 2 || list.some((i) => rbs[i].invMass === 0)) continue;
      const members = list.map((i) => rbs[i]);
      for (const i of list) grouped[i] = 1;
      let M = 0;
      let cx = 0;
      let cy = 0;
      let px = 0;
      let py = 0;
      for (const m of members) {
        M += m.mass;
        cx += m.mass * m.body.position.x;
        cy += m.mass * m.body.position.y;
        px += m.mass * m.body.velocity.x;
        py += m.mass * m.body.velocity.y;
      }
      // In plain numbers (every welded part, every step), the same operations in the same order
      // as the vector helpers (sub, dot, cross, rotate, add, scale), so the results are identical.
      const comX = cx / M;
      const comY = cy / M;
      const vcomX = px / M;
      const vcomY = py / M;
      let I = 0;
      let Lrel = 0;
      for (const m of members) {
        const dx = m.body.position.x - comX;
        const dy = m.body.position.y - comY;
        I += m.inertia + m.mass * (dx * dx + dy * dy);
        Lrel += m.mass * (dx * (m.body.velocity.y - vcomY) - dy * (m.body.velocity.x - vcomX)) + m.inertia * m.body.angularVelocity;
      }
      const q = sinCos((Lrel / I) * dt);
      const newComX = comX + vcomX * dt;
      const newComY = comY + vcomY * dt;
      for (const m of members) {
        const rx = m.body.position.x - comX;
        const ry = m.body.position.y - comY;
        m.body.position = { x: newComX + (q.c * rx - q.s * ry), y: newComY + (q.s * rx + q.c * ry) };
        const ux = m.body.velocity.x - vcomX;
        const uy = m.body.velocity.y - vcomY;
        const v = { x: vcomX + (q.c * ux - q.s * uy), y: vcomY + (q.s * ux + q.c * uy) };
        rigidImpulse.set(m.body.id, { x: (v.x - m.body.velocity.x) * m.mass, y: (v.y - m.body.velocity.y) * m.mass });
        m.body.velocity = v;
        m.body.angle += m.body.angularVelocity * dt;
      }
    }
  }
  for (let i = 0; i < rbs.length; i++) {
    const r = rbs[i];
    if (r.invMass === 0 || grouped[i]) continue;
    const b = r.body;
    b.position = { x: b.position.x + b.velocity.x * dt, y: b.position.y + b.velocity.y * dt };
    b.angle += b.angularVelocity * dt;
  }
  return rigidImpulse;
}

/** Pushes overlapping pairs apart along their normals without touching velocities (non-linear Gauss–Seidel). */
export function correctPositions(world: World, solved: SolvedContacts, profile: Profile): void {
  const slop = profile.tol.penetration / 2;
  const contacts = solved.contacts;
  for (let it = 0; it < POSITION_ITERATIONS; it++) {
    correctJoints(world, solved.byId);
    for (const c of contacts) {
      const A = c.a.body;
      const B = c.b.body;
      for (const p of c.points) {
        const qA = sinCos(A.angle);
        const qB = sinCos(B.angle);
        const pA = add(A.position, rotate(qA, p.localA));
        const pB = add(B.position, rotate(qB, p.localB));
        const sep = dot(sub(pB, pA), c.normal);
        const C = Math.max(-MAX_CORRECTION, Math.min(0, BAUMGARTE * (sep + slop)));
        if (C >= 0) continue;
        const rA = sub(pA, A.position);
        const rB = sub(pB, B.position);
        const rnA = cross(rA, c.normal);
        const rnB = cross(rB, c.normal);
        const K = c.a.invMass + c.b.invMass + c.a.invInertia * rnA * rnA + c.b.invInertia * rnB * rnB;
        if (K <= 0) continue;
        const P = scale(c.normal, -C / K);
        A.position = sub(A.position, scale(P, c.a.invMass));
        A.angle -= c.a.invInertia * cross(rA, P);
        B.position = add(B.position, scale(P, c.b.invMass));
        B.angle += c.b.invInertia * cross(rB, P);
      }
    }
  }
}
