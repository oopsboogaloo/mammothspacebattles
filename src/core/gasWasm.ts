// The gas step's substep loop in WebAssembly (wasm/solver/src/gas.rs; docs/perf/rust-trial.md): the
// same results bit for bit as `gasCoreTs` in gas.ts, which is kept as the reference (`?wasm=0`) and
// as the fallback where WebAssembly can't load.
//
// The parcels are packed straight into the module's memory (`gasParcelBuffers`), the walls and
// rigid units `buildWalls` made are written in, the module steps, and stepGas finishes from the
// same memory. The views are kept between steps, so a step makes no typed arrays.
import { setWasmClock, wasmModule, type WasmExports } from "./solverWasm.ts";

// Strides: the same as wasm/solver/src/gas.rs.
const WS = 14;
const VS = 4;
const US = 14;
const OUT_LEN = 12;
const PHASES = ["contacts", "neighbours", "density", "impulses", "move"];

/** Views over the module's gas buffers. */
export interface GasBuffers {
  buffer: ArrayBuffer;
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
  m: Float64Array;
  E: Float64Array;
  hh: Float64Array;
  g1: Float64Array;
  gam: Float64Array;
  rad: Float64Array;
  crushed: Uint8Array;
  W: Float64Array;
  V: Float64Array;
  U: Float64Array;
  partJ: Float64Array;
  touch: Int32Array;
  out: Float64Array;
}

/** What the loop needs of a wall (Wall in gas.ts). */
interface WallIn {
  unit: number;
  disc: boolean;
  cx: number;
  cy: number;
  radius: number;
  vx: Float64Array;
  vy: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** What the loop reads and writes of a rigid unit (Unit in gas.ts). */
interface UnitIo {
  ids: string[];
  M: number;
  I: number;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  w: number;
  ex: number;
  ey: number;
  th: number;
  qc: number;
  qs: number;
  reach: number;
}

// Capacities (grown by doubling) and the views, made again only when the memory or a buffer moves.
const cap = { n: 0, nw: 0, nv: 0, nu: 0 };
let views: GasBuffers | null = null;

function current(e: WasmExports): GasBuffers {
  if (!views || views.buffer !== e.memory.buffer) {
    const buffer = e.memory.buffer as ArrayBuffer;
    const f = (which: number, len: number) => new Float64Array(buffer, e.gas_ptr(which), len);
    views = {
      buffer,
      x: f(0, cap.n),
      y: f(1, cap.n),
      vx: f(2, cap.n),
      vy: f(3, cap.n),
      m: f(4, cap.n),
      E: f(5, cap.n),
      hh: f(6, cap.n),
      g1: f(7, cap.n),
      gam: f(8, cap.n),
      rad: f(9, cap.n),
      crushed: new Uint8Array(buffer, e.gas_ptr(10), cap.n),
      W: f(11, cap.nw * WS),
      V: f(12, cap.nv * VS),
      U: f(13, cap.nu * US),
      partJ: f(14, cap.nw * 3),
      touch: new Int32Array(buffer, e.gas_ptr(15), cap.nw),
      out: f(16, OUT_LEN),
    };
  }
  return views;
}

/** Buffers for n parcels to be packed into, or null when steps use the TypeScript loop. */
export function gasParcelBuffers(n: number): GasBuffers | null {
  const e = wasmModule();
  if (!e) return null;
  if (n > cap.n) {
    cap.n = Math.max(2 * n, 256);
    e.gas_reserve_parcels(cap.n);
    views = null;
  }
  return current(e);
}

/**
 * The substep loop over the n parcels packed into the buffers: moves them and the units, and
 * records in `acc` what gasCoreTs does. Returns the buffers as they are after (the memory may have
 * grown: views held from before are dead), the impulse on walls and the substeps taken.
 */
export function gasCoreWasm(
  n: number,
  walls: readonly WallIn[],
  units: UnitIo[],
  bodies: readonly { id: string }[],
  dt: number,
  acc: { externalImpulse: { x: number; y: number }; angular: number; clamped: number; involved: Set<string> },
  timings?: { clock: () => number; out: Record<string, number> },
): { buffers: GasBuffers; wallImpulse: number; nsub: number } {
  const e = wasmModule()!;
  const nw = walls.length;
  const nu = units.length;
  let nv = 0;
  for (const w of walls) nv += w.vx.length;
  if (nw > cap.nw || nv > cap.nv || nu > cap.nu) {
    if (nw > cap.nw) cap.nw = Math.max(2 * nw, 64);
    if (nv > cap.nv) cap.nv = Math.max(2 * nv, 256);
    if (nu > cap.nu) cap.nu = Math.max(2 * nu, 64);
    e.gas_reserve_walls(cap.nw, cap.nv, cap.nu);
    views = null;
  }
  let b = current(e);
  const { W, V, U } = b;
  let v = 0;
  for (let k = 0; k < nw; k++) {
    const w = walls[k];
    const o = k * WS;
    W[o] = w.unit;
    W[o + 1] = w.disc ? 1 : 0;
    W[o + 2] = w.cx;
    W[o + 3] = w.cy;
    W[o + 4] = w.radius;
    W[o + 5] = w.minX;
    W[o + 6] = w.minY;
    W[o + 7] = w.maxX;
    W[o + 8] = w.maxY;
    W[o + 9] = v;
    W[o + 10] = w.vx.length;
    // The box's bounding circle, as buildWallCells works it out every substep.
    W[o + 11] = 0.5 * (w.minX + w.maxX);
    W[o + 12] = 0.5 * (w.minY + w.maxY);
    W[o + 13] = 0.5 * Math.sqrt((w.maxX - w.minX) ** 2 + (w.maxY - w.minY) ** 2);
    for (let i = 0; i < w.vx.length; i++, v++) {
      const vo = v * VS;
      V[vo] = w.vx[i];
      V[vo + 1] = w.vy[i];
      V[vo + 2] = w.nx[i];
      V[vo + 3] = w.ny[i];
    }
  }
  for (let k = 0; k < nu; k++) {
    const u = units[k];
    const o = k * US;
    U[o] = u.M;
    U[o + 1] = u.I;
    U[o + 2] = u.vx;
    U[o + 3] = u.vy;
    U[o + 4] = u.w;
    U[o + 5] = u.ex;
    U[o + 6] = u.ey;
    U[o + 7] = u.reach;
    U[o + 8] = u.ids.length > 1 ? 1 : 0;
  }

  if (timings) setWasmClock(timings.clock);
  e.gas_step(n, nw, nu, dt, timings ? 1 : 0);

  b = current(e);
  for (let k = 0; k < nu; k++) {
    const u = units[k];
    const o = k * US;
    u.vx = b.U[o + 2];
    u.vy = b.U[o + 3];
    u.w = b.U[o + 4];
    u.cx = b.U[o + 9];
    u.cy = b.U[o + 10];
    u.th = b.U[o + 11];
    u.qc = b.U[o + 12];
    u.qs = b.U[o + 13];
  }
  const out = b.out;
  acc.externalImpulse.x = out[0];
  acc.externalImpulse.y = out[1];
  acc.angular = out[2];
  acc.clamped = out[3];
  // The bodies the gas touched, in the order it first touched them.
  for (let t = 0; t < out[6]; t++) acc.involved.add(bodies[b.touch[t]].id);
  if (timings) for (let k = 0; k < PHASES.length; k++) timings.out[`gas.${PHASES[k]}`] = (timings.out[`gas.${PHASES[k]}`] ?? 0) + out[7 + k];
  return { buffers: b, wallImpulse: out[4], nsub: out[5] };
}
