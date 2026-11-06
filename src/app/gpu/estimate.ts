// The reference battle at 4× detail against the gas budget (docs/gpu-gas-plan.md, Phase 0), from
// the spike's measured substep times and the CPU baseline (docs/perf/reference-battle-baseline.json).
//
// Assumptions, each stated on the page:
//   - 4× detail is 4× the parcels at a quarter the mass. In 2D a parcel's size goes as √mass, so
//     radius and smoothing length halve, and the CFL substep halves: 2× the substeps.
//   - The spike runs the sort, density and pressure. The full gas adds walls and their mirror
//     ghosts, chemistry, the far field, spawning and the per-body push sums. On the CPU those cost
//     `restFactor` × the spike's share (from the baseline's phase times, clusters left out: the GPU
//     doesn't need them). The same ratio is assumed on the GPU.
//   - The budget is a share of the real-time step, 1/240 s: half on a mid-range phone, a quarter on a laptop.

export interface Baseline {
  stepsPerSecond: number;
  steady: { parcels: number; parcelsMax: number; substeps: number; gasMsPerStep: number; phasesMs: Record<string, number> };
}
export interface Measured {
  n: number;
  fullUs: number;
}
export const DETAIL = 4;
export const BUDGET_SHARE = { phone: 0.5, laptop: 0.25 } as const;
export type DeviceClass = keyof typeof BUDGET_SHARE;

/** Full gas ÷ the spike's share, from the CPU phase times (clusters excluded). */
export function restFactor(b: Baseline): number {
  const p = b.steady.phasesMs;
  const spike = (p["gas.neighbours"] ?? 0) + (p["gas.density"] ?? 0) + (p["gas.impulses"] ?? 0) + (p["gas.move"] ?? 0);
  const full = (p.gas ?? 0) - (p["gas.clusters"] ?? 0);
  return spike > 0 ? full / spike : 1;
}

/**
 * Substep time at n parcels, µs: linear between the measured sizes, flat below the smallest (the
 * fixed cost of the dispatches dominates there), and along the last slope above the largest.
 */
export function substepUs(ms: readonly Measured[], n: number): number {
  const m = [...ms].sort((a, b) => a.n - b.n);
  if (!m.length) return NaN;
  if (n <= m[0].n) return m[0].fullUs;
  for (let k = 1; k < m.length; k++)
    if (n <= m[k].n) {
      const f = (n - m[k - 1].n) / (m[k].n - m[k - 1].n);
      return m[k - 1].fullUs + f * (m[k].fullUs - m[k - 1].fullUs);
    }
  if (m.length === 1) return (m[0].fullUs * n) / m[0].n;
  const a = m[m.length - 2];
  const b = m[m.length - 1];
  return b.fullUs + ((n - b.n) * (b.fullUs - a.fullUs)) / (b.n - a.n);
}

export interface Estimate {
  parcels: number;
  parcelsPeak: number;
  substeps: number;
  restFactor: number;
  /** Gas ms a step at 4× detail: mean parcels, and the peak. */
  gasMs: number;
  gasMsPeak: number;
  budgetMs: Record<DeviceClass, number>;
  go: Record<DeviceClass, boolean>;
  /** Most parcels the budget allows at these substeps (interpolated). */
  maxParcels: Record<DeviceClass, number>;
  /** Today's CPU gas, ms a step (Node, the development container), for scale. */
  cpuGasMs: number;
}

export function estimate(b: Baseline, ms: readonly Measured[]): Estimate {
  const stepMs = 1000 / b.stepsPerSecond;
  const parcels = DETAIL * b.steady.parcels;
  const parcelsPeak = DETAIL * b.steady.parcelsMax;
  const substeps = Math.sqrt(DETAIL) * b.steady.substeps;
  const rf = restFactor(b);
  const cost = (n: number) => (substeps * substepUs(ms, n) * rf) / 1000;
  const budgetMs = { phone: BUDGET_SHARE.phone * stepMs, laptop: BUDGET_SHARE.laptop * stepMs };
  const maxParcels = (budget: number) => {
    if (cost(1) > budget) return 0;
    let lo = 1;
    let hi = 2;
    while (cost(hi) <= budget && hi < 1e7) hi *= 2;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cost(mid) <= budget) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  const gasMs = cost(parcels);
  const gasMsPeak = cost(parcelsPeak);
  return {
    parcels,
    parcelsPeak,
    substeps,
    restFactor: rf,
    gasMs,
    gasMsPeak,
    budgetMs,
    go: { phone: gasMsPeak <= budgetMs.phone, laptop: gasMsPeak <= budgetMs.laptop },
    maxParcels: { phone: maxParcels(budgetMs.phone), laptop: maxParcels(budgetMs.laptop) },
    cpuGasMs: b.steady.gasMsPerStep,
  };
}
