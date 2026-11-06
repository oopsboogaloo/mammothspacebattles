// GPU gas Spike 2 (docs/gpu-gas-plan.md, Phase 0b): one work-group per gas cluster, every substep
// of a batch in one dispatch. Spike 1 (shaders.ts) paid a GPU-wide wait between each of a
// substep's 7 passes; here a cluster's threads only wait for each other (a barrier inside one
// compute unit), and clusters run side by side on different compute units.
//
// Each substep, inside the work-group, with a barrier between stages:
//   clear the cluster's table → count parcels per cell → running total → scatter into cell order
//   → density → pressure, heating, move → agree the next substep length (CFL)
// The physics is the same as Spike 1 and the CPU gas (§9.4). Each cluster has its own hashed table
// in GPU memory; its parcels are a contiguous range of the state buffers.
import { cpuDensity, makeCloud, type CheckResult } from "./spike.ts";

/** Parcels on one side of the hashed table per slot (table ≥ 2 × parcels, a power of two). */
function tableSizeFor(n: number, wgs: number): number {
  let t = Math.max(wgs, 64);
  while (t < 2 * n) t *= 2;
  return t;
}

function fusedWgsl(wgs: number): string {
  return /* wgsl */ `
struct Params {
  cellInv: f32,
  cfl: f32,
  hmin: f32,
  dsMax: f32,
  nsub: u32,
  tableSize: u32,
  nTotal: u32,
  _pad: u32,
}
struct Cluster {
  start: u32,
  count: u32,
  tableOffset: u32,
  _pad: u32,
  box: vec4f,       // min x, min y, max x, max y: mirror walls
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
// Parcel state, two vec4 a parcel: (x, y, vx, vy), (mass, u, h, γ − 1). A is the gas between
// substeps; B holds it in cell order during one.
@group(0) @binding(2) var<storage, read_write> stateA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> stateB: array<vec4f>;
// Per cluster, 2 × tableSize: counts, then starts.
@group(0) @binding(4) var<storage, read_write> table: array<atomic<u32>>;
// [0, nTotal): each parcel's (slot, rank); [nTotal, 2 nTotal): each sorted parcel's cell.
@group(0) @binding(5) var<storage, read_write> aux: array<vec2i>;
@group(0) @binding(6) var<storage, read_write> dens: array<vec4f>;
// Per cluster: last substep length, substeps run.
@group(0) @binding(7) var<storage, read_write> stats: array<vec4f>;

const WGS: u32 = ${wgs}u;
const W_C2: f32 = 2.228169203286535;
const G_C2: f32 = 44.56338406573070;
var<workgroup> scan: array<u32, ${wgs}>;
var<workgroup> wmax: atomic<u32>;
var<workgroup> wds: f32;

fn slotOf(c: vec2i) -> u32 {
  return ((bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u)) & (P.tableSize - 1u);
}

@compute @workgroup_size(${wgs})
fn main(@builtin(local_invocation_index) lid: u32, @builtin(workgroup_id) wid: vec3u) {
  let C = clusters[wid.x];
  let s0 = C.start;
  let n = C.count;
  let T = P.tableSize;
  let cnt = C.tableOffset;      // counts
  let st = C.tableOffset + T;   // starts
  if (lid == 0u) {
    wds = min(P.dsMax, P.cfl * P.hmin / 1100.0);
    atomicStore(&wmax, 0u);
  }
  workgroupBarrier();

  for (var k = 0u; k < P.nsub; k++) {
    // 1. Clear the counts.
    for (var s = lid; s < T; s += WGS) { atomicStore(&table[cnt + s], 0u); }
    storageBarrier();
    // 2. Count each parcel into its cell's slot, keeping its rank there.
    for (var i = lid; i < n; i += WGS) {
      let c = vec2i(floor(stateA[2u * (s0 + i)].xy * P.cellInv));
      let s = slotOf(c);
      aux[s0 + i] = vec2i(i32(s), i32(atomicAdd(&table[cnt + s], 1u)));
    }
    storageBarrier();
    // 3. Running total: each thread sums its run of slots, the work-group scans those sums,
    //    then each thread writes its slots' starts.
    let chunk = T / WGS;
    let b = lid * chunk;
    var sum = 0u;
    for (var q = 0u; q < chunk; q++) { sum += atomicLoad(&table[cnt + b + q]); }
    scan[lid] = sum;
    workgroupBarrier();
    for (var off = 1u; off < WGS; off = off << 1u) {
      var v = scan[lid];
      if (lid >= off) { v += scan[lid - off]; }
      workgroupBarrier();
      scan[lid] = v;
      workgroupBarrier();
    }
    var run = 0u;
    if (lid > 0u) { run = scan[lid - 1u]; }
    for (var q = 0u; q < chunk; q++) {
      let c = atomicLoad(&table[cnt + b + q]);
      atomicStore(&table[st + b + q], run);
      run += c;
    }
    storageBarrier();
    // 4. Scatter into cell order (A → B), filing each sorted parcel's cell.
    for (var i = lid; i < n; i += WGS) {
      let sr = aux[s0 + i];
      let d = atomicLoad(&table[st + u32(sr.x)]) + u32(sr.y);
      let p = stateA[2u * (s0 + i)];
      stateB[2u * (s0 + d)] = p;
      stateB[2u * (s0 + d) + 1u] = stateA[2u * (s0 + i) + 1u];
      aux[P.nTotal + s0 + d] = vec2i(floor(p.xy * P.cellInv));
    }
    storageBarrier();
    // 5. Density, then P/ρ² and the sound speed.
    for (var i = lid; i < n; i += WGS) {
      let xi = stateB[2u * (s0 + i)].xy;
      let mi = stateB[2u * (s0 + i) + 1u];
      let ci = aux[P.nTotal + s0 + i];
      var rho = 0.0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let cc = ci + vec2i(dx, dy);
          let s = slotOf(cc);
          let k0 = atomicLoad(&table[st + s]);
          let k1 = k0 + atomicLoad(&table[cnt + s]);
          for (var j = k0; j < k1; j++) {
            if (any(aux[P.nTotal + s0 + j] != cc)) { continue; }
            let d = xi - stateB[2u * (s0 + j)].xy;
            let h = 0.5 * (mi.z + stateB[2u * (s0 + j) + 1u].z);
            let r2 = dot(d, d);
            if (r2 < h * h) {
              let q = sqrt(r2) / h;
              let t = 1.0 - q;
              rho += stateB[2u * (s0 + j) + 1u].x * (W_C2 / (h * h)) * t * t * t * t * (1.0 + 4.0 * q);
            }
          }
        }
      }
      let u = max(0.0, mi.y);
      dens[s0 + i] = vec4f(rho, mi.w * u / rho, sqrt((mi.w + 1.0) * mi.w * u), 0.0);
    }
    storageBarrier();
    // 6. Pressure and viscous pushes from every neighbour, heating, the move (B → A, same order).
    let ds = wds;
    for (var i = lid; i < n; i += WGS) {
      let pi = stateB[2u * (s0 + i)];
      let mi = stateB[2u * (s0 + i) + 1u];
      let di = dens[s0 + i];
      let ci = aux[P.nTotal + s0 + i];
      var dv = vec2f(0.0);
      var du = 0.0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          let cc = ci + vec2i(dx, dy);
          let s = slotOf(cc);
          let k0 = atomicLoad(&table[st + s]);
          let k1 = k0 + atomicLoad(&table[cnt + s]);
          for (var j = k0; j < k1; j++) {
            if (j == i || any(aux[P.nTotal + s0 + j] != cc)) { continue; }
            let pj = stateB[2u * (s0 + j)];
            let mj4 = stateB[2u * (s0 + j) + 1u];
            let d = pi.xy - pj.xy;
            let h = 0.5 * (mi.z + mj4.z);
            let r2 = dot(d, d);
            if (r2 >= h * h || r2 == 0.0) { continue; }
            let r = sqrt(r2);
            let e = d / r;
            let vr = dot(pi.zw - pj.zw, e);
            let dj = dens[s0 + j];
            let mj = mj4.x;
            var visc = 0.0;
            if (vr < 0.0) {
              let muv = (h * vr * r) / (r2 + 0.01 * h * h);
              visc = (-0.5 * (di.z + dj.z) * muv + 2.0 * muv * muv) / (0.5 * (di.x + dj.x));
            }
            let q = r / h;
            let t = 1.0 - q;
            let grad = (G_C2 / (h * h * h)) * q * t * t * t;
            let Jp = ds * mi.x * mj * (di.y + dj.y) * grad;
            var Jv = 0.0;
            if (vr < 0.0) { Jv = min(ds * mi.x * mj * visc * grad, -vr / (1.0 / mi.x + 1.0 / mj)); }
            let J = Jp + Jv;
            if (J > 0.0) {
              dv += (J / mi.x) * e;
              let share = select(0.5, di.y / (di.y + dj.y), di.y + dj.y > 0.0);
              du -= (Jp * share + 0.5 * Jv) * vr / mi.x;
            }
          }
        }
      }
      var v = pi.zw + dv;
      var x = pi.xy + v * ds;
      if (x.x < C.box.x) { x.x = 2.0 * C.box.x - x.x; v.x = -v.x; }
      if (x.x > C.box.z) { x.x = 2.0 * C.box.z - x.x; v.x = -v.x; }
      if (x.y < C.box.y) { x.y = 2.0 * C.box.y - x.y; v.y = -v.y; }
      if (x.y > C.box.w) { x.y = 2.0 * C.box.w - x.y; v.y = -v.y; }
      let u = max(0.0, mi.y + du);
      stateA[2u * (s0 + i)] = vec4f(x, v);
      stateA[2u * (s0 + i) + 1u] = vec4f(mi.x, u, mi.z, mi.w);
      atomicMax(&wmax, bitcast<u32>(sqrt((mi.w + 1.0) * mi.w * u) + length(v)));
    }
    storageBarrier();
    workgroupBarrier();
    // 7. The next substep length, from this cluster's fastest signal.
    if (lid == 0u) {
      let vmax = bitcast<f32>(atomicLoad(&wmax));
      wds = select(P.dsMax, min(P.dsMax, P.cfl * P.hmin / vmax), vmax > 0.0);
      atomicStore(&wmax, 0u);
    }
    workgroupBarrier();
  }
  if (lid == 0u) { stats[wid.x] = vec4f(wds, f32(P.nsub), 0.0, 0.0); }
}`;
}

// Spike 2b: the same loop, with each cluster's sorted positions and its neighbour table in
// work-group memory (on-chip, far quicker to reach than GPU main memory). The neighbour search
// reads only those for every candidate; main memory is read only for real neighbours (mass,
// smoothing length, velocity, density). The table is counted, then scanned in place into starts,
// so slot s holds sorted parcels [starts[s], starts[s + 1]). The 3 × 3 cells' slots are deduplicated,
// so a parcel is found once even when two cells hash to the same slot, and no cell check is needed.
function sharedWgsl(wgs: number, nmax: number, T: number): string {
  return /* wgsl */ `
struct Params {
  cellInv: f32,
  cfl: f32,
  hmin: f32,
  dsMax: f32,
  nsub: u32,
  tableSize: u32,
  nTotal: u32,
  hmax: f32,
}
struct Cluster {
  start: u32,
  count: u32,
  tableOffset: u32,
  _pad: u32,
  box: vec4f,
}
@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> clusters: array<Cluster>;
@group(0) @binding(2) var<storage, read_write> stateA: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> stateB: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> aux: array<vec2i>;
@group(0) @binding(5) var<storage, read_write> dens: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> stats: array<vec4f>;

const WGS: u32 = ${wgs}u;
const T: u32 = ${T}u;
const W_C2: f32 = 2.228169203286535;
const G_C2: f32 = 44.56338406573070;
var<workgroup> pos: array<vec2f, ${nmax}>;
var<workgroup> tab: array<atomic<u32>, ${T + 1}>;
var<workgroup> scan: array<u32, ${wgs}>;
var<workgroup> wmax: atomic<u32>;
var<workgroup> wds: f32;

fn slotOf(c: vec2i) -> u32 {
  return ((bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u)) & (T - 1u);
}

/** The distinct slots of the 3 × 3 cells round c, into out; returns how many. */
fn slotsAround(c: vec2i, out: ptr<function, array<u32, 9>>) -> u32 {
  var ns = 0u;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let s = slotOf(c + vec2i(dx, dy));
      var seen = false;
      for (var q = 0u; q < ns; q++) { if ((*out)[q] == s) { seen = true; } }
      if (!seen) { (*out)[ns] = s; ns++; }
    }
  }
  return ns;
}

@compute @workgroup_size(${wgs})
fn main(@builtin(local_invocation_index) lid: u32, @builtin(workgroup_id) wid: vec3u) {
  let C = clusters[wid.x];
  let s0 = C.start;
  let n = C.count;
  let hmax2 = P.hmax * P.hmax;
  if (lid == 0u) {
    wds = min(P.dsMax, P.cfl * P.hmin / 1100.0);
    atomicStore(&wmax, 0u);
  }
  workgroupBarrier();

  for (var k = 0u; k < P.nsub; k++) {
    // 1. Clear the table.
    for (var s = lid; s <= T; s += WGS) { atomicStore(&tab[s], 0u); }
    workgroupBarrier();
    // 2. Count, keeping each parcel's rank in its slot.
    for (var i = lid; i < n; i += WGS) {
      let s = slotOf(vec2i(floor(stateA[2u * (s0 + i)].xy * P.cellInv)));
      aux[s0 + i] = vec2i(i32(s), i32(atomicAdd(&tab[s], 1u)));
    }
    workgroupBarrier();
    // 3. Counts → starts, in place; tab[T] = all.
    let chunk = T / WGS;
    let b = lid * chunk;
    var sum = 0u;
    for (var q = 0u; q < chunk; q++) { sum += atomicLoad(&tab[b + q]); }
    scan[lid] = sum;
    workgroupBarrier();
    for (var off = 1u; off < WGS; off = off << 1u) {
      var v = scan[lid];
      if (lid >= off) { v += scan[lid - off]; }
      workgroupBarrier();
      scan[lid] = v;
      workgroupBarrier();
    }
    var run = 0u;
    if (lid > 0u) { run = scan[lid - 1u]; }
    for (var q = 0u; q < chunk; q++) {
      let c = atomicLoad(&tab[b + q]);
      atomicStore(&tab[b + q], run);
      run += c;
    }
    if (lid == WGS - 1u) { atomicStore(&tab[T], run); }
    workgroupBarrier();
    // 4. Scatter into cell order: state A → B, positions into work-group memory.
    for (var i = lid; i < n; i += WGS) {
      let sr = aux[s0 + i];
      let d = atomicLoad(&tab[u32(sr.x)]) + u32(sr.y);
      let p = stateA[2u * (s0 + i)];
      stateB[2u * (s0 + d)] = p;
      stateB[2u * (s0 + d) + 1u] = stateA[2u * (s0 + i) + 1u];
      pos[d] = p.xy;
    }
    storageBarrier();
    workgroupBarrier();
    // 5. Density.
    for (var i = lid; i < n; i += WGS) {
      let xi = pos[i];
      let mi = stateB[2u * (s0 + i) + 1u];
      var slots: array<u32, 9>;
      let ns = slotsAround(vec2i(floor(xi * P.cellInv)), &slots);
      var rho = 0.0;
      for (var u = 0u; u < ns; u++) {
        let k0 = atomicLoad(&tab[slots[u]]);
        let k1 = atomicLoad(&tab[slots[u] + 1u]);
        for (var j = k0; j < k1; j++) {
          let d = xi - pos[j];
          let r2 = dot(d, d);
          if (r2 >= hmax2) { continue; }
          let mj = stateB[2u * (s0 + j) + 1u];
          let h = 0.5 * (mi.z + mj.z);
          if (r2 < h * h) {
            let q = sqrt(r2) / h;
            let t = 1.0 - q;
            rho += mj.x * (W_C2 / (h * h)) * t * t * t * t * (1.0 + 4.0 * q);
          }
        }
      }
      let uu = max(0.0, mi.y);
      dens[s0 + i] = vec4f(rho, mi.w * uu / rho, sqrt((mi.w + 1.0) * mi.w * uu), 0.0);
    }
    storageBarrier();
    // 6. Pushes, heating, move (B → A, same order).
    let ds = wds;
    for (var i = lid; i < n; i += WGS) {
      let xi = pos[i];
      let pi = stateB[2u * (s0 + i)];
      let mi = stateB[2u * (s0 + i) + 1u];
      let di = dens[s0 + i];
      var slots: array<u32, 9>;
      let ns = slotsAround(vec2i(floor(xi * P.cellInv)), &slots);
      var dv = vec2f(0.0);
      var du = 0.0;
      for (var u = 0u; u < ns; u++) {
        let k0 = atomicLoad(&tab[slots[u]]);
        let k1 = atomicLoad(&tab[slots[u] + 1u]);
        for (var j = k0; j < k1; j++) {
          let d = xi - pos[j];
          let r2 = dot(d, d);
          if (r2 >= hmax2 || r2 == 0.0) { continue; }
          let mj4 = stateB[2u * (s0 + j) + 1u];
          let h = 0.5 * (mi.z + mj4.z);
          if (r2 >= h * h) { continue; }
          let pj = stateB[2u * (s0 + j)];
          let r = sqrt(r2);
          let e = d / r;
          let vr = dot(pi.zw - pj.zw, e);
          let dj = dens[s0 + j];
          let mj = mj4.x;
          var visc = 0.0;
          if (vr < 0.0) {
            let muv = (h * vr * r) / (r2 + 0.01 * h * h);
            visc = (-0.5 * (di.z + dj.z) * muv + 2.0 * muv * muv) / (0.5 * (di.x + dj.x));
          }
          let q = r / h;
          let t = 1.0 - q;
          let grad = (G_C2 / (h * h * h)) * q * t * t * t;
          let Jp = ds * mi.x * mj * (di.y + dj.y) * grad;
          var Jv = 0.0;
          if (vr < 0.0) { Jv = min(ds * mi.x * mj * visc * grad, -vr / (1.0 / mi.x + 1.0 / mj)); }
          let J = Jp + Jv;
          if (J > 0.0) {
            dv += (J / mi.x) * e;
            let share = select(0.5, di.y / (di.y + dj.y), di.y + dj.y > 0.0);
            du -= (Jp * share + 0.5 * Jv) * vr / mi.x;
          }
        }
      }
      var v = pi.zw + dv;
      var x = pi.xy + v * ds;
      if (x.x < C.box.x) { x.x = 2.0 * C.box.x - x.x; v.x = -v.x; }
      if (x.x > C.box.z) { x.x = 2.0 * C.box.z - x.x; v.x = -v.x; }
      if (x.y < C.box.y) { x.y = 2.0 * C.box.y - x.y; v.y = -v.y; }
      if (x.y > C.box.w) { x.y = 2.0 * C.box.w - x.y; v.y = -v.y; }
      let uu = max(0.0, mi.y + du);
      stateA[2u * (s0 + i)] = vec4f(x, v);
      stateA[2u * (s0 + i) + 1u] = vec4f(mi.x, uu, mi.z, mi.w);
      atomicMax(&wmax, bitcast<u32>(sqrt((mi.w + 1.0) * mi.w * uu) + length(v)));
    }
    storageBarrier();
    workgroupBarrier();
    // 7. The next substep length.
    if (lid == 0u) {
      let vmax = bitcast<f32>(atomicLoad(&wmax));
      wds = select(P.dsMax, min(P.dsMax, P.cfl * P.hmin / vmax), vmax > 0.0);
      atomicStore(&wmax, 0u);
    }
    workgroupBarrier();
  }
  if (lid == 0u) { stats[wid.x] = vec4f(wds, f32(P.nsub), 0.0, 0.0); }
}`;
}

/** Work-group memory the shared kernel needs, bytes. */
export function sharedBytes(wgs: number, nmax: number, T: number): number {
  return 8 * nmax + 4 * (T + 1) + 4 * wgs + 8;
}
/** The shared kernel's table: slots ≥ the largest cluster's parcels and the threads, a power of two. */
function sharedTableFor(nmax: number, wgs: number): number {
  let t = Math.max(wgs, 64);
  while (t < nmax) t *= 2;
  return t;
}

export type FusedMode = "global" | "shared";

// WebGPU's flag values (TypeScript's lib has the types but not these constants).
const USAGE = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const;
const STORAGE = USAGE.STORAGE | USAGE.COPY_DST | USAGE.COPY_SRC;
const H = 6 * 0.0175;

type Cloud = ReturnType<typeof makeCloud>;

/** Several clusters' gas on the GPU, stepped by the fused kernel. */
export class FusedGas {
  readonly counts: number[];
  readonly starts: number[];
  readonly nTotal: number;
  private device: GPUDevice;
  private bufs: Record<string, GPUBuffer> = {};
  private pipe: GPUComputePipeline;
  private group: GPUBindGroup;
  private clouds: Cloud[];
  readonly wgs: number;
  readonly mode: FusedMode;

  constructor(device: GPUDevice, clouds: Cloud[], wgs: number, mode: FusedMode = "global") {
    this.device = device;
    this.wgs = wgs;
    this.mode = mode;
    this.clouds = clouds;
    this.counts = clouds.map((c) => c.pv.length / 4);
    this.starts = this.counts.map((_, k) => this.counts.slice(0, k).reduce((a, b) => a + b, 0));
    this.nTotal = this.counts.reduce((a, b) => a + b, 0);
    const nmax = Math.max(...this.counts);
    const T = mode === "shared" ? sharedTableFor(nmax, wgs) : tableSizeFor(nmax, wgs);
    const K = clouds.length;
    const buf = (name: string, size: number, usage = STORAGE) => (this.bufs[name] = device.createBuffer({ size: Math.max(16, size), usage }));
    buf("params", 32, USAGE.UNIFORM | USAGE.COPY_DST);
    buf("clusters", 32 * K);
    buf("stateA", 32 * this.nTotal);
    buf("stateB", 32 * this.nTotal);
    buf("table", mode === "shared" ? 16 : 4 * 2 * T * K);
    buf("aux", 8 * 2 * this.nTotal);
    buf("dens", 16 * this.nTotal);
    buf("stats", 16 * K);
    buf("readback", 16 * K, USAGE.MAP_READ | USAGE.COPY_DST);
    const p = new ArrayBuffer(32);
    const f = new Float32Array(p);
    const u = new Uint32Array(p);
    f[0] = 1 / H;
    f[1] = 0.25;
    f[2] = H;
    f[3] = 1 / 240;
    f[7] = H; // largest smoothing length (shared kernel)
    u[5] = T;
    u[6] = this.nTotal;
    device.queue.writeBuffer(this.bufs.params, 0, p);
    const cl = new ArrayBuffer(32 * K);
    const clu = new Uint32Array(cl);
    const clf = new Float32Array(cl);
    clouds.forEach((c, k) => {
      clu.set([this.starts[k], this.counts[k], 2 * T * k, 0], 8 * k);
      clf.set(c.box, 8 * k + 4);
    });
    device.queue.writeBuffer(this.bufs.clusters, 0, cl);
    this.reset();
    // A GPU can refuse the kernel (e.g. more threads than it allows for this much code): catch that
    // here (see ready()), or every dispatch would silently do nothing and time as near zero.
    device.pushErrorScope("internal");
    device.pushErrorScope("validation");
    this.memory = mode === "shared" ? sharedBytes(wgs, nmax, T) : 0;
    const module = device.createShaderModule({ code: mode === "shared" ? sharedWgsl(wgs, nmax, T) : fusedWgsl(wgs) });
    this.pipe = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    const b = this.bufs;
    this.group = device.createBindGroup({
      layout: this.pipe.getBindGroupLayout(0),
      entries: (mode === "shared" ? [b.params, b.clusters, b.stateA, b.stateB, b.aux, b.dens, b.stats] : [b.params, b.clusters, b.stateA, b.stateB, b.table, b.aux, b.dens, b.stats]).map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    this.errors = Promise.all([device.popErrorScope(), device.popErrorScope()]);
  }
  private errors: Promise<(GPUError | null)[]>;
  /** Work-group memory the kernel uses, bytes (shared mode). */
  readonly memory: number;

  /** Throws if the GPU refused the kernel or its buffers. */
  async ready(): Promise<void> {
    const limit = this.device.limits.maxComputeWorkgroupStorageSize;
    if (this.memory > limit) throw new Error(`needs ${(this.memory / 1024).toFixed(1)} KB of work-group memory; this GPU allows ${(limit / 1024).toFixed(0)} KB`);
    const errs = (await this.errors).filter((e): e is GPUError => !!e);
    if (errs.length) throw new Error(`the GPU refused the ${this.wgs}-thread kernel: ${errs.map((e) => e.message).join("; ")}`);
  }

  /** Back to the starting clouds. */
  reset() {
    const s = new Float32Array(8 * this.nTotal);
    this.clouds.forEach((c, k) => {
      for (let i = 0; i < this.counts[k]; i++) {
        s.set(c.pv.subarray(4 * i, 4 * i + 4), 8 * (this.starts[k] + i));
        s.set(c.mu.subarray(4 * i, 4 * i + 4), 8 * (this.starts[k] + i) + 4);
      }
    });
    this.device.queue.writeBuffer(this.bufs.stateA, 0, s);
  }

  /**
   * Runs nsub substeps of every cluster in one dispatch, then waits for the per-cluster stats, and
   * throws unless every cluster reports all nsub substeps run.
   */
  async run(nsub: number): Promise<number> {
    this.device.queue.writeBuffer(this.bufs.params, 16, new Uint32Array([nsub]));
    this.device.queue.writeBuffer(this.bufs.stats, 0, new Float32Array(this.bufs.stats.size / 4));
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(this.counts.length);
    pass.end();
    enc.copyBufferToBuffer(this.bufs.stats, 0, this.bufs.readback, 0, this.bufs.stats.size);
    const t0 = performance.now();
    this.device.queue.submit([enc.finish()]);
    await this.bufs.readback.mapAsync(0x1);
    const t = performance.now() - t0;
    const stats = new Float32Array(this.bufs.readback.getMappedRange().slice(0));
    this.bufs.readback.unmap();
    for (let k = 0; k < this.counts.length; k++)
      if (stats[4 * k + 1] !== nsub) throw new Error(`cluster ${k} ran ${stats[4 * k + 1]} of ${nsub} substeps: the GPU did not run the kernel`);
    return t;
  }

  async read(name: "stateA" | "stateB" | "dens"): Promise<Float32Array> {
    const src = this.bufs[name];
    const out = this.device.createBuffer({ size: src.size, usage: USAGE.MAP_READ | USAGE.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, out, 0, src.size);
    this.device.queue.submit([enc.finish()]);
    await out.mapAsync(0x1);
    const copy = new Float32Array(out.getMappedRange().slice(0));
    out.destroy();
    return copy;
  }

  destroy() {
    for (const b of Object.values(this.bufs)) b.destroy();
  }
}

/** Splits interleaved state (two vec4 a parcel) for one cluster into the cloud's pv and mu. */
function unpack(state: Float32Array, start: number, n: number): { pv: Float32Array; mu: Float32Array } {
  const pv = new Float32Array(4 * n);
  const mu = new Float32Array(4 * n);
  for (let i = 0; i < n; i++) {
    pv.set(state.subarray(8 * (start + i), 8 * (start + i) + 4), 4 * i);
    mu.set(state.subarray(8 * (start + i) + 4, 8 * (start + i) + 8), 4 * i);
  }
  return { pv, mu };
}

/**
 * The fused kernel against the CPU: three clusters of different sizes, one substep, then each
 * cluster's density (computed on its sorted, pre-move parcels) against a float64 sum over every
 * pair, and every parcel found once; then Σ m·v over 100 substeps of free clouds.
 */
export async function checkFused(device: GPUDevice, wgs = 256, mode: FusedMode = "global"): Promise<CheckResult> {
  // The shared kernel's clusters must fit work-group memory (16 KB in WebGPU's default limits).
  const sizes = mode === "shared" ? [1000, 700, 300] : [1500, 700, 300];
  const clouds = sizes.map((n, k) => makeCloud(n, 3 + k));
  const gas = new FusedGas(device, clouds, wgs, mode);
  await gas.ready();
  await gas.run(1);
  const B = await gas.read("stateB");
  const dens = await gas.read("dens");
  gas.destroy();
  let densityError = 0;
  let sortOk = true;
  clouds.forEach((c, k) => {
    const n = gas.counts[k];
    const s = gas.starts[k];
    const { pv, mu } = unpack(B, s, n);
    const want = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const key = `${c.pv[4 * i]},${c.pv[4 * i + 1]}`;
      want.set(key, (want.get(key) ?? 0) + 1);
    }
    for (let i = 0; i < n; i++) {
      const key = `${pv[4 * i]},${pv[4 * i + 1]}`;
      const left = want.get(key) ?? 0;
      if (!left) sortOk = false;
      else want.set(key, left - 1);
    }
    const ref = cpuDensity(pv, mu);
    for (let i = 0; i < n; i++) densityError = Math.max(densityError, Math.abs(dens[4 * (s + i)] - ref[i]) / ref[i]);
  });

  const free = [makeCloud(sizes[0], 9), makeCloud(600, 10)];
  let px0 = 0;
  const py0 = 0;
  for (const c of free) {
    c.box = [-1e3, -1e3, 1e3, 1e3];
    for (let i = 0; i < c.pv.length / 4; i++) {
      c.pv[4 * i + 2] = 0.1 * Math.sin(i);
      px0 += c.mu[4 * i] * c.pv[4 * i + 2];
    }
  }
  const g2 = new FusedGas(device, free, wgs, mode);
  await g2.ready();
  await g2.run(100);
  const A = await g2.read("stateA");
  g2.destroy();
  let px = 0;
  let py = 0;
  let pAbs = 0;
  let finite = true;
  for (let i = 0; i < g2.nTotal; i++) {
    const m = A[8 * i + 4];
    px += m * A[8 * i + 2];
    py += m * A[8 * i + 3];
    pAbs += m * Math.hypot(A[8 * i + 2], A[8 * i + 3]);
    if (!Number.isFinite(A[8 * i]) || !Number.isFinite(A[8 * i + 5])) finite = false;
  }
  const momentumDrift = Math.hypot(px - px0, py - py0) / Math.max(1e-30, pAbs);
  const pass = sortOk && densityError < 1e-4 && momentumDrift < 1e-4 && finite && pAbs > 0;
  return {
    pass,
    densityError,
    sortOk,
    momentumDrift,
    message: pass ? "ok" : `sort ${sortOk ? "ok" : "FAILED"}, density error ${densityError.toExponential(2)}, momentum drift ${momentumDrift.toExponential(2)}${finite ? "" : ", NaN"}`,
  };
}

export interface FusedResult {
  /** Parcels in each cluster. */
  n: number;
  /** Clusters run side by side. */
  clusters: number;
  /** Threads in each cluster's work-group. */
  wgs: number;
  /** Where the neighbour search reads from: GPU main memory (Spike 2) or work-group memory (2b). */
  mode: FusedMode;
  /** Substeps in the timed dispatch. */
  batch: number;
  /** Median wall time per substep, µs (all clusters together); NaN if the run failed. */
  us: number;
  /** Why the run failed, if it did. */
  error?: string;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Times `clusters` clusters of n parcels each, every substep of a batch in one dispatch. */
export async function timeFused(device: GPUDevice, n: number, clusters: number, wgs: number, batch: number, reps: number, mode: FusedMode = "global"): Promise<FusedResult> {
  const clouds = Array.from({ length: clusters }, (_, k) => makeCloud(n, 1 + k));
  const gas = new FusedGas(device, clouds, wgs, mode);
  try {
    await gas.ready();
    // Warm up; shrink the batch if a dispatch would take over half a second (phones can reset the GPU).
    const warm = await gas.run(10);
    while (batch > 10 && (warm / 10) * batch > 500) batch = Math.ceil(batch / 2);
    const ts: number[] = [];
    for (let r = 0; r < reps; r++) {
      gas.reset();
      ts.push(await gas.run(batch));
    }
    return { n, clusters, wgs, mode, batch, us: (1000 * median(ts)) / batch };
  } catch (err) {
    return { n, clusters, wgs, mode, batch, us: NaN, error: err instanceof Error ? err.message : String(err) };
  } finally {
    gas.destroy();
  }
}
