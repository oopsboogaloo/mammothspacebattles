// The constraint solve (welds and contacts) compiled from Rust (wasm/solver) to WebAssembly
// (docs/perf/rust-trial.md). On by default: the same results bit for bit as the TypeScript in
// physics.ts and joints.ts, which is kept as the reference (`?wasm=0`) and as the fallback where
// WebAssembly can't load. The same module holds the gas step's substep loop (gasWasm.ts).
//
// The world stays in JavaScript objects. Each step the solve's inputs are written into the
// module's memory through typed-array views kept between steps, the module solves, and the results
// are written back: no objects made but the bodies' new velocity and position vectors.
import { SOLVER_WASM_BASE64 } from "./wasm/solver.wasm.ts";
import type { ConstraintAccount, JointBody, JointImpulse } from "./joints.ts";
import type { RB, SolverContact } from "./physics.ts";
import type { Joint, World } from "./world.ts";

interface Exports {
  memory: WebAssembly.Memory;
  reserve(nb: number, nj: number, nc: number, np: number): void;
  bodies_ptr(): number;
  joints_ptr(): number;
  contacts_ptr(): number;
  points_ptr(): number;
  acc_ptr(): number;
  sin_cos_into_acc(x: number): void;
  solve_velocities(nb: number, nj: number, nc: number, iterations: number, dt: number, tolEnergy: number): void;
  correct_positions(nb: number, nj: number, nc: number, slop: number): void;
  gas_reserve_parcels(n: number): void;
  gas_reserve_walls(nw: number, nv: number, nu: number): void;
  gas_ptr(which: number): number;
  gas_step(n: number, nw: number, nu: number, dt: number, timed: number): void;
}
export type WasmExports = Exports;

// Strides and offsets: the same as wasm/solver/src/lib.rs.
const BS = 12;
const JS = 21;
const CS = 8;
const PS = 16;

let ex: Exports | null = null;
let on = true;
/** The clock the module reads when a gas step is timed (gasWasm.ts sets it for the call). */
let clock: () => number = () => 0;
export function setWasmClock(c: () => number): void {
  clock = c;
}

function load(): Exports {
  const bin = atob(SOLVER_WASM_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Synchronous: the module is small (browsers allow this on the main thread up to 8 MB).
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { env: { now: () => clock() } }).exports as unknown as Exports;
}

/** Turns the WebAssembly solver on or off for every world stepped after (`?wasm=0` in the app turns it off). */
export function setWasmSolver(enable: boolean): void {
  on = enable;
}

/** Whether steps use the WebAssembly solver: loaded on first use; if it can't load, the TypeScript one. */
export function wasmSolverOn(): boolean {
  if (on && !ex) {
    try {
      ex = load();
    } catch {
      on = false;
    }
  }
  return on;
}

/** The module, when steps use it (the gas step shares it: gasWasm.ts). */
export function wasmModule(): WasmExports | null {
  return wasmSolverOn() ? ex : null;
}

// Capacities (grown by doubling) and views over the module's memory, made again only when it grows.
const cap = { nb: 0, nj: 0, nc: 0, np: 0 };
let views: { buffer: ArrayBuffer; B: Float64Array; J: Float64Array; C: Float64Array; P: Float64Array; A: Float64Array } | null = null;

function buffers(nb: number, nj: number, nc: number, np: number) {
  const e = ex!;
  if (nb > cap.nb || nj > cap.nj || nc > cap.nc || np > cap.np) {
    cap.nb = Math.max(cap.nb, nb, 64) * (nb > cap.nb ? 2 : 1);
    cap.nj = Math.max(cap.nj, nj, 64) * (nj > cap.nj ? 2 : 1);
    cap.nc = Math.max(cap.nc, nc, 64) * (nc > cap.nc ? 2 : 1);
    cap.np = Math.max(cap.np, np, 128) * (np > cap.np ? 2 : 1);
    e.reserve(cap.nb, cap.nj, cap.nc, cap.np);
    views = null;
  }
  if (!views || views.buffer !== e.memory.buffer) {
    const buffer = e.memory.buffer as ArrayBuffer;
    views = {
      buffer,
      B: new Float64Array(buffer, e.bodies_ptr(), cap.nb * BS),
      J: new Float64Array(buffer, e.joints_ptr(), cap.nj * JS),
      C: new Float64Array(buffer, e.contacts_ptr(), cap.nc * CS),
      P: new Float64Array(buffer, e.points_ptr(), cap.np * PS),
      A: new Float64Array(buffer, e.acc_ptr(), 9),
    };
  }
  return views;
}

/** The welds the solve takes this step, in order (kept between steps). */
const welds: Joint[] = [];

function pointCount(contacts: readonly SolverContact[]): number {
  let n = 0;
  for (const c of contacts) n += c.points.length;
  return n;
}

/** Writes the contacts and their points (lever arms, masses, impulses, local anchors). */
function fillContacts(C: Float64Array, P: Float64Array, contacts: readonly SolverContact[]): void {
  let p = 0;
  for (let i = 0; i < contacts.length; i++) {
    const c = contacts[i];
    const o = i * CS;
    C[o] = c.a.slot!;
    C[o + 1] = c.b.slot!;
    C[o + 2] = c.normal.x;
    C[o + 3] = c.normal.y;
    C[o + 4] = c.friction;
    C[o + 5] = c.restitution;
    C[o + 6] = c.points.length;
    C[o + 7] = p;
    for (const q of c.points) {
      const po = p * PS;
      P[po] = q.rA.x;
      P[po + 1] = q.rA.y;
      P[po + 2] = q.rB.x;
      P[po + 3] = q.rB.y;
      P[po + 4] = q.normalMass;
      P[po + 5] = q.tangentMass;
      P[po + 6] = q.separation;
      P[po + 7] = q.vn0;
      P[po + 8] = q.normalImpulse;
      P[po + 9] = q.tangentImpulse;
      P[po + 10] = q.maxNormalImpulse;
      P[po + 11] = q.energyLost;
      P[po + 12] = q.localA.x;
      P[po + 13] = q.localA.y;
      P[po + 14] = q.localB.x;
      P[po + 15] = q.localB.y;
      p++;
    }
  }
}

/** The welds both of whose bodies are in the solve and not both fixed (prepareJoints, correctJoints). */
function collectWelds(world: World, byId: ReadonlyMap<string, JointBody>): void {
  welds.length = 0;
  for (const j of world.joints) {
    const a = byId.get(j.a);
    const b = byId.get(j.b);
    if (!a || !b || (a.invMass === 0 && b.invMass === 0)) continue;
    welds.push(j);
  }
}

function fillWelds(J: Float64Array, byId: ReadonlyMap<string, JointBody>): void {
  for (let i = 0; i < welds.length; i++) {
    const j = welds[i];
    const o = i * JS;
    J[o] = (byId.get(j.a) as RB).slot!;
    J[o + 1] = (byId.get(j.b) as RB).slot!;
    J[o + 2] = j.anchorA.x;
    J[o + 3] = j.anchorA.y;
    J[o + 4] = j.anchorB.x;
    J[o + 5] = j.anchorB.y;
    J[o + 6] = j.axis.x;
    J[o + 7] = j.axis.y;
    J[o + 8] = j.limits.tension;
    J[o + 9] = j.limits.compression;
    J[o + 10] = j.limits.shear;
    J[o + 11] = j.limits.torque;
    J[o + 12] = j.integrity;
    J[o + 13] = j.referenceAngle;
  }
}

/**
 * The velocity solve of solveContacts and finishJoints, in WebAssembly. Updates the bodies'
 * velocities, the contact points' impulses and energy, both accounts and each weld's impulse;
 * returns the welds held at a limit with their demand, as finishJoints does.
 */
export function solveVelocitiesWasm(
  world: World,
  rbs: readonly RB[],
  contacts: readonly SolverContact[],
  byId: ReadonlyMap<string, JointBody>,
  dt: number,
  iterations: number,
  tolEnergy: number,
  account: ConstraintAccount,
  jointAccount: ConstraintAccount,
): Map<string, JointImpulse> {
  collectWelds(world, byId);
  const np = pointCount(contacts);
  const { B, J, C, P, A } = buffers(rbs.length, welds.length, contacts.length, np);
  for (let i = 0; i < rbs.length; i++) {
    const r = rbs[i];
    const body = r.body;
    r.slot = i;
    const o = i * BS;
    B[o] = body.velocity.x;
    B[o + 1] = body.velocity.y;
    B[o + 2] = body.angularVelocity;
    B[o + 3] = body.position.x;
    B[o + 4] = body.position.y;
    B[o + 5] = body.angle;
    B[o + 6] = r.invMass;
    B[o + 7] = r.invInertia;
    B[o + 8] = r.rot.s;
    B[o + 9] = r.rot.c;
    B[o + 10] = r.mass;
    B[o + 11] = r.inertia;
  }
  fillWelds(J, byId);
  fillContacts(C, P, contacts);

  ex!.solve_velocities(rbs.length, welds.length, contacts.length, iterations, dt, tolEnergy);

  for (let i = 0; i < rbs.length; i++) {
    const body = rbs[i].body;
    const o = i * BS;
    const vx = B[o];
    const vy = B[o + 1];
    if (!Object.is(vx, body.velocity.x) || !Object.is(vy, body.velocity.y)) body.velocity = { x: vx, y: vy };
    body.angularVelocity = B[o + 2];
  }
  let p = 0;
  for (const c of contacts)
    for (const q of c.points) {
      const po = p++ * PS;
      q.normalImpulse = P[po + 8];
      q.tangentImpulse = P[po + 9];
      q.maxNormalImpulse = P[po + 10];
      q.energyLost = P[po + 11];
    }
  account.externalImpulse = { x: A[0], y: A[1] };
  account.angular = A[2];
  account.predictedKE = A[3];
  jointAccount.externalImpulse = { x: A[4], y: A[5] };
  jointAccount.angular = A[6];
  jointAccount.predictedKE = A[7];

  // finishJoints: each weld's impulse (its load), and the welds held at a limit.
  const capped = new Map<string, JointImpulse>();
  for (let i = 0; i < welds.length; i++) {
    const j = welds[i];
    const o = i * JS;
    const px = J[o + 14];
    const py = J[o + 15];
    const L = J[o + 16];
    j.impulse = { x: px, y: py, angular: L };
    if (J[o + 17] !== 0) capped.set(j.id, { x: J[o + 18], y: J[o + 19], angular: J[o + 20] });
    if (px !== 0 || py !== 0 || L !== 0) {
      jointAccount.involved.add(j.a);
      jointAccount.involved.add(j.b);
    }
  }
  return capped;
}

/** correctPositions in WebAssembly: welds pulled together, then contacts pushed apart, four times. */
export function correctPositionsWasm(world: World, rbs: readonly RB[], contacts: readonly SolverContact[], byId: ReadonlyMap<string, JointBody>, slop: number): void {
  collectWelds(world, byId);
  const { B, J, C, P } = buffers(rbs.length, welds.length, contacts.length, pointCount(contacts));
  for (let i = 0; i < rbs.length; i++) {
    const r = rbs[i];
    const body = r.body;
    r.slot = i;
    const o = i * BS;
    B[o + 3] = body.position.x;
    B[o + 4] = body.position.y;
    B[o + 5] = body.angle;
    B[o + 6] = r.invMass;
    B[o + 7] = r.invInertia;
  }
  fillWelds(J, byId);
  fillContacts(C, P, contacts);

  ex!.correct_positions(rbs.length, welds.length, contacts.length, slop);

  for (let i = 0; i < rbs.length; i++) {
    const body = rbs[i].body;
    const o = i * BS;
    const x = B[o + 3];
    const y = B[o + 4];
    if (!Object.is(x, body.position.x) || !Object.is(y, body.position.y)) body.position = { x, y };
    body.angle = B[o + 5];
  }
}

/** sinCos from the module, for the test that it matches math.ts bit for bit. */
export function wasmSinCos(x: number): { s: number; c: number } {
  ex ??= load();
  const { A } = buffers(0, 0, 0, 0);
  ex.sin_cos_into_acc(x);
  return { s: A[0], c: A[1] };
}
