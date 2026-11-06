// WGSL for the GPU gas spike (docs/gpu-gas-plan.md, Phase 0): a hashed-grid counting sort and the
// SPH density and pressure passes, in the same form as the CPU gas (§9.4: Wendland C2 in 2D, support
// h, pair smoothing length the mean of the two, ideal gas P = (γ − 1)·ρ·u, Monaghan viscosity
// capped at the impulse that stops a pair closing). No walls, chemistry or far field: those come
// in Phases 1–3. Each substep is these dispatches, in one compute pass:
//   clear → count → scanLocal → scanBlocks → scatter → density → force
// The grid is hashed (a table about twice the parcels), so its cost follows the gas, not the
// arena: plumes are sparse across a ±500 m world.

export const WG = 256;
/** Table entries each scan workgroup handles (2 per thread). */
export const SCAN_BLOCK = 2 * WG;

const common = /* wgsl */ `
struct Params {
  n: u32,
  mask: u32,        // table size − 1 (a power of two)
  cellInv: f32,     // 1 / cell size; the cell is at least the largest smoothing length
  cfl: f32,
  hmin: f32,
  dsMax: f32,
  boxMin: vec2f,
  boxMax: vec2f,
  _pad: vec2f,
}
@group(0) @binding(0) var<uniform> P: Params;

fn cellOfPos(p: vec2f) -> vec2i { return vec2i(floor(p * P.cellInv)); }
fn slotOf(c: vec2i) -> u32 {
  let h = (bitcast<u32>(c.x) * 73856093u) ^ (bitcast<u32>(c.y) * 19349663u);
  return h & P.mask;
}
const W_C2: f32 = 2.228169203286535;   // 7 / π
const G_C2: f32 = 44.56338406573070;   // 140 / π
const VISC_ALPHA: f32 = 1.0;
const VISC_BETA: f32 = 2.0;
`;

/** Zeroes the table counts. */
export const clearWgsl = /* wgsl */ `
${common}
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x <= P.mask) { atomicStore(&counts[g.x], 0u); }
}`;

/** Each parcel counts itself into its cell's slot, keeping its rank there for the scatter. */
export const countWgsl = /* wgsl */ `
${common}
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> pv: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> slotRank: array<vec2u>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= P.n) { return; }
  let s = slotOf(cellOfPos(pv[i].xy));
  slotRank[i] = vec2u(s, atomicAdd(&counts[s], 1u));
}`;

// An exclusive prefix sum over 512 entries per workgroup (two per thread, then a Hillis–Steele scan
// of the 256 pair sums in workgroup memory). `scanLocal` writes each block's starts and its total;
// `scanBlocks` scans the totals in place (at most 512 blocks: tables up to 2^18).
const scanBody = (load: string, store: string, total: string) => /* wgsl */ `
var<workgroup> tmp: array<u32, ${WG}>;
@compute @workgroup_size(${WG})
fn main(@builtin(local_invocation_id) l: vec3u, @builtin(workgroup_id) w: vec3u) {
  let base = w.x * ${SCAN_BLOCK}u + 2u * l.x;
  let a = ${load.replaceAll("IDX", "base")};
  let b = ${load.replaceAll("IDX", "base + 1u")};
  tmp[l.x] = a + b;
  workgroupBarrier();
  for (var off = 1u; off < ${WG}u; off = off << 1u) {
    var v = tmp[l.x];
    if (l.x >= off) { v = v + tmp[l.x - off]; }
    workgroupBarrier();
    tmp[l.x] = v;
    workgroupBarrier();
  }
  let before = select(0u, tmp[l.x - 1u], l.x > 0u);
  ${store.replaceAll("IDX", "base").replaceAll("VAL", "before")}
  ${store.replaceAll("IDX", "base + 1u").replaceAll("VAL", "before + a")}
  if (l.x == ${WG - 1}u) { ${total} }
}`;

export const scanLocalWgsl = /* wgsl */ `
${common}
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> starts: array<u32>;
@group(0) @binding(3) var<storage, read_write> blocks: array<u32>;
${scanBody("select(0u, atomicLoad(&counts[IDX]), IDX <= P.mask)", "if (IDX <= P.mask) { starts[IDX] = VAL; }", "blocks[w.x] = tmp[l.x];")}`;

export const scanBlocksWgsl = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> blocks: array<u32>;
@group(0) @binding(1) var<uniform> nBlocks: vec4u;
${scanBody("select(0u, blocks[IDX], IDX < nBlocks.x)", "if (IDX < nBlocks.x) { blocks[IDX] = VAL; }", "")}`;

/** Moves each parcel to its sorted place (slot start + block offset + rank), keeping its cell. */
export const scatterWgsl = /* wgsl */ `
${common}
@group(0) @binding(1) var<storage, read> starts: array<u32>;
@group(0) @binding(2) var<storage, read> blocks: array<u32>;
@group(0) @binding(3) var<storage, read> slotRank: array<vec2u>;
@group(0) @binding(4) var<storage, read> pvIn: array<vec4f>;
@group(0) @binding(5) var<storage, read> muIn: array<vec4f>;
@group(0) @binding(6) var<storage, read_write> pvOut: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> muOut: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> cellOf: array<vec2i>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i >= P.n) { return; }
  let sr = slotRank[i];
  let d = starts[sr.x] + blocks[sr.x / ${SCAN_BLOCK}u] + sr.y;
  let p = pvIn[i];
  pvOut[d] = p;
  muOut[d] = muIn[i];
  cellOf[d] = cellOfPos(p.xy);
}`;

// The neighbour loop shared by density and force: the 3×3 cells round parcel i's cell (as filed at
// the last sort), each looked up in the hashed table; entries of another cell that hash to the same
// slot are skipped by their filed cell.
const neighbours = (body: string) => /* wgsl */ `
  let ci = cellOf[i];
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let cc = ci + vec2i(dx, dy);
      let s = slotOf(cc);
      let k0 = starts[s] + blocks[s / ${SCAN_BLOCK}u];
      let k1 = k0 + atomicLoad(&counts[s]);
      for (var j = k0; j < k1; j++) {
        if (any(cellOf[j] != cc)) { continue; }
        ${body}
      }
    }
  }`;

/**
 * Density (ρ = Σ m·W, self included), then P/ρ² and the sound speed. Thread 0 also turns the
 * last substep's fastest signal speed into this substep's length (CFL), and resets it.
 */
export const densityWgsl = /* wgsl */ `
${common}
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> starts: array<u32>;
@group(0) @binding(3) var<storage, read> blocks: array<u32>;
@group(0) @binding(4) var<storage, read> cellOf: array<vec2i>;
@group(0) @binding(5) var<storage, read> pv: array<vec4f>;
@group(0) @binding(6) var<storage, read> mu: array<vec4f>;
@group(0) @binding(7) var<storage, read_write> dens: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> ctrl: array<atomic<u32>, 4>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x;
  if (i == 0u) {
    let vmax = bitcast<f32>(atomicLoad(&ctrl[0]));
    var ds = P.dsMax;
    if (vmax > 0.0) { ds = min(P.dsMax, P.cfl * P.hmin / vmax); }
    atomicStore(&ctrl[1], bitcast<u32>(ds));
    atomicStore(&ctrl[0], 0u);
    atomicAdd(&ctrl[2], 1u);
  }
  if (i >= P.n) { return; }
  let xi = pv[i].xy;
  let hi = mu[i].z;
  var rho = 0.0;
  ${neighbours(/* wgsl */ `
        let d = xi - pv[j].xy;
        let h = 0.5 * (hi + mu[j].z);
        let r2 = dot(d, d);
        if (r2 < h * h) {
          let q = sqrt(r2) / h;
          let t = 1.0 - q;
          rho += mu[j].x * (W_C2 / (h * h)) * t * t * t * t * (1.0 + 4.0 * q);
        }`)}
  let m = mu[i];
  let u = max(0.0, m.y);
  dens[i] = vec4f(rho, m.w * u / rho, sqrt((m.w + 1.0) * m.w * u), 0.0);
}`;

/**
 * Pressure and viscous impulses from every neighbour (each pair computed alike from both sides, so
 * equal and opposite), the heating they do, then the move. Writes the next state in the same order
 * and the fastest signal speed (sound + speed) for the next substep.
 */
export const forceWgsl = /* wgsl */ `
${common}
@group(0) @binding(1) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read> starts: array<u32>;
@group(0) @binding(3) var<storage, read> blocks: array<u32>;
@group(0) @binding(4) var<storage, read> cellOf: array<vec2i>;
@group(0) @binding(5) var<storage, read> pv: array<vec4f>;
@group(0) @binding(6) var<storage, read> mu: array<vec4f>;
@group(0) @binding(7) var<storage, read> dens: array<vec4f>;
@group(0) @binding(8) var<storage, read_write> ctrl: array<atomic<u32>, 4>;
@group(0) @binding(9) var<storage, read_write> pvOut: array<vec4f>;
@group(0) @binding(10) var<storage, read_write> muOut: array<vec4f>;
var<workgroup> wmax: atomic<u32>;
@compute @workgroup_size(${WG})
fn main(@builtin(global_invocation_id) g: vec3u, @builtin(local_invocation_id) l: vec3u) {
  let i = g.x;
  if (l.x == 0u) { atomicStore(&wmax, 0u); }
  workgroupBarrier();
  if (i < P.n) {
    let ds = bitcast<f32>(atomicLoad(&ctrl[1]));
    let pi = pv[i];
    let mi = mu[i];
    let di = dens[i];
    var dv = vec2f(0.0);
    var du = 0.0;
    ${neighbours(/* wgsl */ `
        if (j == i) { continue; }
        let pj = pv[j];
        let d = pi.xy - pj.xy;
        let h = 0.5 * (mi.z + mu[j].z);
        let r2 = dot(d, d);
        if (r2 >= h * h || r2 == 0.0) { continue; }
        let r = sqrt(r2);
        let e = d / r;
        let vr = dot(pi.zw - pj.zw, e);
        let dj = dens[j];
        let mj = mu[j].x;
        var visc = 0.0;
        if (vr < 0.0) {
          let muv = (h * vr * r) / (r2 + 0.01 * h * h);
          visc = (-VISC_ALPHA * 0.5 * (di.z + dj.z) * muv + VISC_BETA * muv * muv) / (0.5 * (di.x + dj.x));
        }
        let q = r / h;
        let t = 1.0 - q;
        let grad = (G_C2 / (h * h * h)) * q * t * t * t;
        let Jp = ds * mi.x * mj * (di.y + dj.y) * grad;
        var Jv = ds * mi.x * mj * visc * grad;
        if (vr < 0.0) { Jv = min(Jv, -vr / (1.0 / mi.x + 1.0 / mj)); } else { Jv = 0.0; }
        let J = Jp + Jv;
        if (J > 0.0) {
          dv += (J / mi.x) * e;
          let share = select(0.5, di.y / (di.y + dj.y), di.y + dj.y > 0.0);
          du -= (Jp * share + 0.5 * Jv) * vr / mi.x;
        }`)}
    var v = pi.zw + dv;
    var x = pi.xy + v * ds;
    // The box: mirror walls.
    if (x.x < P.boxMin.x) { x.x = 2.0 * P.boxMin.x - x.x; v.x = -v.x; }
    if (x.x > P.boxMax.x) { x.x = 2.0 * P.boxMax.x - x.x; v.x = -v.x; }
    if (x.y < P.boxMin.y) { x.y = 2.0 * P.boxMin.y - x.y; v.y = -v.y; }
    if (x.y > P.boxMax.y) { x.y = 2.0 * P.boxMax.y - x.y; v.y = -v.y; }
    let u = max(0.0, mi.y + du);
    pvOut[i] = vec4f(x, v);
    muOut[i] = vec4f(mi.x, u, mi.z, mi.w);
    let c = sqrt((mi.w + 1.0) * mi.w * u);
    atomicMax(&wmax, bitcast<u32>(c + length(v)));
  }
  workgroupBarrier();
  if (l.x == 0u) { atomicMax(&ctrl[0], atomicLoad(&wmax)); }
}`;
