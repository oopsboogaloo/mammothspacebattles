// GPU gas spike (docs/gpu-gas-plan.md, Phase 0): runs the sort and SPH passes of shaders.ts on N
// parcels and times them per substep. Runs wherever WebGPU is: the page asks the simulation worker
// first (simWorker.ts), and falls back to the page if the worker has no WebGPU.
//
// Timing is wall clock round a batch, as the real backend will run: one submit of K substeps in
// one compute pass, then a small read-back (the substep count) that waits for the GPU. Per-pass GPU
// timestamps are not used: browsers round them to 100 µs unless a developer flag is on.
import { clearWgsl, countWgsl, densityWgsl, forceWgsl, scanBlocksWgsl, scanLocalWgsl, scatterWgsl, SCAN_BLOCK, WG } from "./shaders.ts";

export interface SpikeOptions {
  /** Parcel counts to time. */
  sizes: number[];
  /** Substeps per batch (one submit): 4 steps × about 60 substeps at 4× detail. */
  batch: number;
  /** Timed batches per size (after one warm-up); the median is reported. */
  reps: number;
}
export const DEFAULT_SPIKE: SpikeOptions = { sizes: [1000, 4000, 10000, 25000, 50000, 100000], batch: 240, reps: 5 };

export interface SizeResult {
  n: number;
  /** Substeps actually timed per batch (smaller for large n on slow devices). */
  batch: number;
  /** Median wall time per substep, µs: the full substep, the sort alone, and density + force alone. */
  fullUs: number;
  sortUs: number;
  physicsUs: number;
  /** Neighbours per parcel, measured (the work per parcel). */
  neighbours: number;
}
export interface CheckResult {
  pass: boolean;
  /** Largest relative density error against a CPU (float64) sum over every pair. */
  densityError: number;
  /** Every parcel found once after the sort. */
  sortOk: boolean;
  /** |Σ m·v| ÷ Σ m·|v| after 100 substeps of a free cloud. */
  momentumDrift: number;
  message: string;
}
export interface AdapterReport {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  fallback: boolean;
  maxStorageBuffersPerShaderStage: number;
}
export type SpikeEvent =
  | { kind: "adapter"; adapter: AdapterReport; where: "worker" | "page" }
  | { kind: "check"; check: CheckResult }
  | { kind: "size"; result: SizeResult }
  | { kind: "progress"; message: string }
  | { kind: "done" }
  | { kind: "error"; message: string };

// ---------- The gas cloud ----------

/** Exhaust-like parcels at 4× detail: half today's 0.035 m radius, h = 6 radii. */
const RADIUS = 0.0175;
const H = 6 * RADIUS;
const SPACING = 2 * RADIUS;
const CFL = 0.25;
const DT = 1 / 240;

/**
 * N parcels on a jittered square lattice (about 28 neighbours each, like dense gas), the middle
 * third hot (3,000 K) and the rest at 300 K, in a closed box.
 * Mass 0.75 g (a quarter of a 3 g parcel), air (γ = 1.4).
 */
export function makeCloud(n: number, seed = 1): { pv: Float32Array; mu: Float32Array; box: [number, number, number, number] } {
  const side = Math.ceil(Math.sqrt(n));
  const L = side * SPACING;
  const pv = new Float32Array(4 * n);
  const mu = new Float32Array(4 * n);
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const cv = 287.05 / 0.4; // air, J/(kg·K)
  for (let i = 0; i < n; i++) {
    const x = ((i % side) + 0.5 + 0.3 * (rnd() - 0.5)) * SPACING - L / 2;
    const y = (Math.floor(i / side) + 0.5 + 0.3 * (rnd() - 0.5)) * SPACING - L / 2;
    const hot = Math.abs(x) < L / 6 && Math.abs(y) < L / 6;
    pv.set([x, y, 0, 0], 4 * i);
    mu.set([0.00075, cv * (hot ? 3000 : 300), H, 0.4], 4 * i);
  }
  // A closed box just round it (SC-02 with a hot core): the core's expansion sloshes through the
  // cold gas, so parcels keep changing cells while the density, and the work, stay steady.
  const b = L / 2 + 0.5 * RADIUS;
  return { pv, mu, box: [-b, -b, b, b] };
}

// ---------- WebGPU plumbing ----------

export async function openDevice(gpu: GPU): Promise<{ device: GPUDevice; adapter: AdapterReport }> {
  const a = await gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!a) throw new Error("WebGPU is present but gave no adapter");
  const device = await a.requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: Math.min(10, a.limits.maxStorageBuffersPerShaderStage) } });
  const info = a.info;
  return {
    device,
    adapter: {
      vendor: info?.vendor ?? "",
      architecture: info?.architecture ?? "",
      device: info?.device ?? "",
      description: info?.description ?? "",
      fallback: !!(info as { isFallbackAdapter?: boolean } | undefined)?.isFallbackAdapter,
      maxStorageBuffersPerShaderStage: a.limits.maxStorageBuffersPerShaderStage,
    },
  };
}

// WebGPU's flag values (TypeScript's lib has the types but not these constants).
const GPUBufferUsage = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 } as const;
const GPUMapMode = { READ: 0x1 } as const;
const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;

/** The gas on the GPU, with the passes ready to encode. */
export class GpuGas {
  readonly n: number;
  readonly tableSize: number;
  private device: GPUDevice;
  private bufs: Record<string, GPUBuffer> = {};
  private pipes: Record<string, GPUComputePipeline> = {};
  /** Bind groups by pass and by which state buffer (0 or 1) holds the current gas. */
  private groups: Record<string, GPUBindGroup[]> = {};
  /** Which state buffer holds the current gas. */
  cur = 0;
  private cloud: { pv: Float32Array; mu: Float32Array };

  /** Back to the starting cloud. */
  reset() {
    const q = this.device.queue;
    q.writeBuffer(this.bufs.pv0, 0, this.cloud.pv);
    q.writeBuffer(this.bufs.mu0, 0, this.cloud.mu);
    // Start from the signal speed of sound at 3,000 K; the first density pass sets the substep.
    q.writeBuffer(this.bufs.ctrl, 0, new Float32Array([1100, 0]));
    q.writeBuffer(this.bufs.ctrl, 8, new Uint32Array([0, 0]));
    this.cur = 0;
  }

  constructor(device: GPUDevice, cloud: { pv: Float32Array; mu: Float32Array; box: [number, number, number, number] }) {
    this.device = device;
    const n = cloud.pv.length / 4;
    this.n = n;
    let T = SCAN_BLOCK;
    while (T < 2 * n) T *= 2;
    if (T / SCAN_BLOCK > SCAN_BLOCK) throw new Error(`too many parcels for one block scan: ${n}`);
    this.tableSize = T;
    const buf = (name: string, size: number, usage = STORAGE) => (this.bufs[name] = device.createBuffer({ size: Math.max(16, size), usage }));
    buf("params", 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    buf("nBlocks", 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    buf("counts", 4 * T);
    buf("starts", 4 * T);
    buf("blocks", 4 * SCAN_BLOCK);
    buf("slotRank", 8 * n);
    buf("cellOf", 8 * n);
    buf("dens", 16 * n);
    buf("ctrl", 16);
    buf("pv0", 16 * n);
    buf("pv1", 16 * n);
    buf("mu0", 16 * n);
    buf("mu1", 16 * n);
    buf("readback", 16, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const p = new ArrayBuffer(48);
    const u = new Uint32Array(p);
    const f = new Float32Array(p);
    u[0] = n;
    u[1] = T - 1;
    f[2] = 1 / H;
    f[3] = CFL;
    f[4] = H;
    f[5] = DT;
    f.set(cloud.box, 6);
    device.queue.writeBuffer(this.bufs.params, 0, p);
    device.queue.writeBuffer(this.bufs.nBlocks, 0, new Uint32Array([T / SCAN_BLOCK, 0, 0, 0]));
    this.cloud = cloud;
    this.reset();

    const pipe = (name: string, code: string) => {
      const module = device.createShaderModule({ code });
      this.pipes[name] = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
    };
    pipe("clear", clearWgsl);
    pipe("count", countWgsl);
    pipe("scanLocal", scanLocalWgsl);
    pipe("scanBlocks", scanBlocksWgsl);
    pipe("scatter", scatterWgsl);
    pipe("density", densityWgsl);
    pipe("force", forceWgsl);
    const b = this.bufs;
    const group = (name: string, list: (s: 0 | 1) => GPUBuffer[]) => {
      this.groups[name] = ([0, 1] as const).map((s) =>
        device.createBindGroup({ layout: this.pipes[name].getBindGroupLayout(0), entries: list(s).map((buffer, binding) => ({ binding, resource: { buffer } })) }),
      );
    };
    const pv = (s: number) => (s ? b.pv1 : b.pv0);
    const mu = (s: number) => (s ? b.mu1 : b.mu0);
    group("clear", () => [b.params, b.counts]);
    group("count", (s) => [b.params, b.counts, pv(s), b.slotRank]);
    group("scanLocal", () => [b.params, b.counts, b.starts, b.blocks]);
    group("scanBlocks", () => [b.blocks, b.nBlocks]);
    group("scatter", (s) => [b.params, b.starts, b.blocks, b.slotRank, pv(s), mu(s), pv(1 - s), mu(1 - s), b.cellOf]);
    group("density", (s) => [b.params, b.counts, b.starts, b.blocks, b.cellOf, pv(s), mu(s), b.dens, b.ctrl]);
    group("force", (s) => [b.params, b.counts, b.starts, b.blocks, b.cellOf, pv(s), mu(s), b.dens, b.ctrl, pv(1 - s), mu(1 - s)]);
  }

  private dispatch(pass: GPUComputePassEncoder, name: string, threads: number) {
    pass.setPipeline(this.pipes[name]);
    pass.setBindGroup(0, this.groups[name][this.cur]);
    pass.dispatchWorkgroups(Math.ceil(threads / WG));
  }
  /** The counting sort: the gas ends up in the other buffer, in cell order. */
  encodeSort(pass: GPUComputePassEncoder) {
    this.dispatch(pass, "clear", this.tableSize);
    this.dispatch(pass, "count", this.n);
    this.dispatch(pass, "scanLocal", this.tableSize / 2);
    pass.setPipeline(this.pipes.scanBlocks);
    pass.setBindGroup(0, this.groups.scanBlocks[0]);
    pass.dispatchWorkgroups(1);
    this.dispatch(pass, "scatter", this.n);
    this.cur = 1 - this.cur;
  }
  /** Density, then pressure, heating and the move, from the cells filed at the last sort. */
  encodePhysics(pass: GPUComputePassEncoder) {
    this.dispatch(pass, "density", this.n);
    this.dispatch(pass, "force", this.n);
    this.cur = 1 - this.cur;
  }
  /** Density alone (for the correctness check). */
  encodeDensity(pass: GPUComputePassEncoder) {
    this.dispatch(pass, "density", this.n);
  }
  /** Runs K substeps of the chosen parts in one submit, then waits for a 16-byte read-back. */
  async runBatch(k: number, parts: { sort: boolean; physics: boolean }): Promise<number> {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();
    for (let s = 0; s < k; s++) {
      if (parts.sort) this.encodeSort(pass);
      if (parts.physics) this.encodePhysics(pass);
    }
    pass.end();
    enc.copyBufferToBuffer(this.bufs.ctrl, 0, this.bufs.readback, 0, 16);
    const t0 = performance.now();
    this.device.queue.submit([enc.finish()]);
    await this.bufs.readback.mapAsync(GPUMapMode.READ);
    const t = performance.now() - t0;
    this.bufs.readback.unmap();
    return t;
  }
  async read(name: "pv" | "mu" | "dens" | "cellOf" | "counts"): Promise<ArrayBuffer> {
    const src = name === "pv" ? (this.cur ? this.bufs.pv1 : this.bufs.pv0) : name === "mu" ? (this.cur ? this.bufs.mu1 : this.bufs.mu0) : this.bufs[name];
    const out = this.device.createBuffer({ size: src.size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = this.device.createCommandEncoder();
    enc.copyBufferToBuffer(src, 0, out, 0, src.size);
    this.device.queue.submit([enc.finish()]);
    await out.mapAsync(GPUMapMode.READ);
    const copy = out.getMappedRange().slice(0);
    out.destroy();
    return copy;
  }
  destroy() {
    for (const b of Object.values(this.bufs)) b.destroy();
  }
}

// ---------- Correctness (also what CI runs, on the software adapter) ----------

/** Density by brute force over every pair, float64, as the CPU gas sums it. */
export function cpuDensity(pv: Float32Array, mu: Float32Array): Float64Array {
  const n = pv.length / 4;
  const rho = new Float64Array(n);
  const W = 7 / Math.PI;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const h = 0.5 * (mu[4 * i + 2] + mu[4 * j + 2]);
      const r = Math.sqrt((pv[4 * i] - pv[4 * j]) ** 2 + (pv[4 * i + 1] - pv[4 * j + 1]) ** 2);
      if (r >= h) continue;
      const q = r / h;
      const t = 1 - q;
      rho[i] += mu[4 * j] * (W / (h * h)) * t * t * t * t * (1 + 4 * q);
    }
  return rho;
}

export async function checkGas(device: GPUDevice, n = 3000): Promise<CheckResult> {
  // Sort and density once, against the CPU.
  const cloud = makeCloud(n, 7);
  const gas = new GpuGas(device, cloud);
  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  gas.encodeSort(pass);
  pass.end();
  const pass2 = enc.beginComputePass();
  gas.encodeDensity(pass2);
  pass2.end();
  device.queue.submit([enc.finish()]);
  const pv = new Float32Array(await gas.read("pv"));
  const mu = new Float32Array(await gas.read("mu"));
  const dens = new Float32Array(await gas.read("dens"));
  const counts = new Uint32Array(await gas.read("counts"));
  gas.destroy();
  // The sort keeps every parcel once: same multiset of (x, y, u).
  const key = (a: Float32Array, b: Float32Array, i: number) => `${a[4 * i]},${a[4 * i + 1]},${b[4 * i + 1]}`;
  const before = new Map<string, number>();
  for (let i = 0; i < n; i++) before.set(key(cloud.pv, cloud.mu, i), (before.get(key(cloud.pv, cloud.mu, i)) ?? 0) + 1);
  let sortOk = counts.reduce((a, c) => a + c, 0) === n;
  for (let i = 0; i < n && sortOk; i++) {
    const k = key(pv, mu, i);
    const c = before.get(k) ?? 0;
    if (c === 0) sortOk = false;
    else before.set(k, c - 1);
  }
  const ref = cpuDensity(pv, mu);
  let densityError = 0;
  for (let i = 0; i < n; i++) densityError = Math.max(densityError, Math.abs(dens[4 * i] - ref[i]) / ref[i]);

  // Momentum over 100 substeps of the cloud expanding freely (its box far away): pairs are
  // equal and opposite, so Σ m·v stays at zero to float rounding.
  const free = makeCloud(n, 9);
  free.box = [-1e3, -1e3, 1e3, 1e3];
  for (let i = 0; i < n; i++) free.pv[4 * i + 2] = 0.1 * Math.sin(i); // some motion; Σ ≠ 0 in general
  let px0 = 0;
  let py0 = 0;
  for (let i = 0; i < n; i++) {
    px0 += free.mu[4 * i] * free.pv[4 * i + 2];
    py0 += free.mu[4 * i] * free.pv[4 * i + 3];
  }
  const g2 = new GpuGas(device, free);
  await g2.runBatch(100, { sort: true, physics: true });
  const pv2 = new Float32Array(await g2.read("pv"));
  const mu2 = new Float32Array(await g2.read("mu"));
  g2.destroy();
  let px = 0;
  let py = 0;
  let pAbs = 0;
  let finite = true;
  for (let i = 0; i < n; i++) {
    const m = mu2[4 * i];
    px += m * pv2[4 * i + 2];
    py += m * pv2[4 * i + 3];
    pAbs += m * Math.hypot(pv2[4 * i + 2], pv2[4 * i + 3]);
    if (!Number.isFinite(pv2[4 * i]) || !Number.isFinite(mu2[4 * i + 1])) finite = false;
  }
  const momentumDrift = Math.hypot(px - px0, py - py0) / Math.max(1e-30, pAbs);
  const pass_ = sortOk && densityError < 1e-4 && momentumDrift < 1e-4 && finite && pAbs > 0;
  return {
    pass: pass_,
    densityError,
    sortOk,
    momentumDrift,
    message: pass_ ? "ok" : `sort ${sortOk ? "ok" : "FAILED"}, density error ${densityError.toExponential(2)}, momentum drift ${momentumDrift.toExponential(2)}${finite ? "" : ", NaN"}`,
  };
}

// ---------- Timing ----------

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Neighbours per parcel within h, counted on the CPU over the cloud's grid. */
function neighbourCount(pv: Float32Array): number {
  const n = pv.length / 4;
  const cells = new Map<string, number[]>();
  const c = (v: number) => Math.floor(v / H);
  for (let i = 0; i < n; i++) {
    const k = `${c(pv[4 * i])},${c(pv[4 * i + 1])}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
  }
  let pairs = 0;
  const sample = Math.min(n, 2000);
  for (let i = 0; i < sample; i++) {
    const cx = c(pv[4 * i]);
    const cy = c(pv[4 * i + 1]);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (j === i) continue;
          if ((pv[4 * i] - pv[4 * j]) ** 2 + (pv[4 * i + 1] - pv[4 * j + 1]) ** 2 < H * H) pairs++;
        }
  }
  return pairs / sample;
}

export async function timeSize(device: GPUDevice, n: number, opts: SpikeOptions): Promise<SizeResult> {
  const cloud = makeCloud(n);
  const gas = new GpuGas(device, cloud);
  // Warm up (pipelines, first touch), and shrink the batch if one would take over half a second:
  // mobile GPUs can reset a device that runs too long.
  let batch = opts.batch;
  const warm = await gas.runBatch(Math.min(batch, 20), { sort: true, physics: true });
  const perSub = warm / Math.min(batch, 20);
  while (batch > 10 && perSub * batch > 500) batch = Math.ceil(batch / 2);
  // Each mode from the starting cloud. The density and force passes need cells filed by a sort, so
  // "density + force alone" runs on the cells of one sort at the start.
  const time = async (parts: { sort: boolean; physics: boolean }) => {
    gas.reset();
    if (!parts.sort) await gas.runBatch(1, { sort: true, physics: false });
    const ts: number[] = [];
    for (let r = 0; r < opts.reps; r++) ts.push(await gas.runBatch(batch, parts));
    return (1000 * median(ts)) / batch;
  };
  const fullUs = await time({ sort: true, physics: true });
  const sortUs = await time({ sort: true, physics: false });
  const physicsUs = await time({ sort: false, physics: true });
  gas.reset();
  await gas.runBatch(batch, { sort: true, physics: true });
  const neighbours = neighbourCount(new Float32Array(await gas.read("pv")));
  gas.destroy();
  return { n, batch, fullUs, sortUs, physicsUs, neighbours };
}

/** The whole spike: adapter, correctness check, then each size. */
export async function runSpike(gpu: GPU, opts: SpikeOptions, emit: (e: SpikeEvent) => void, where: "worker" | "page"): Promise<void> {
  try {
    const { device, adapter } = await openDevice(gpu);
    let lost = "";
    void device.lost.then((info) => (lost = info.message || info.reason || "lost"));
    emit({ kind: "adapter", adapter, where });
    emit({ kind: "progress", message: "Checking the GPU's results against the CPU…" });
    emit({ kind: "check", check: await checkGas(device) });
    for (const n of opts.sizes) {
      if (lost) throw new Error(`GPU device lost: ${lost}`);
      emit({ kind: "progress", message: `Timing ${n.toLocaleString("en")} parcels…` });
      emit({ kind: "size", result: await timeSize(device, n, opts) });
    }
    device.destroy();
    emit({ kind: "done" });
  } catch (err) {
    emit({ kind: "error", message: err instanceof Error ? err.message : String(err) });
  }
}
