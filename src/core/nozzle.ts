// The nozzle (PRP-012; docs/nozzle-design-thoughts.md §2, §4): one-dimensional isentropic flow
// from a choked throat to the nozzle's exit, in vacuum (the game has no ambient air).
//
// References: NASA Glenn, rocket thrust summary and nozzle design
// (https://www.grc.nasa.gov/www/K-12/airplane/rktthsum.html,
// https://www.grc.nasa.gov/www/BGH/nozzled.html); Sutton & Biblarz, Rocket Propulsion Elements.
// In the game's plane, areas are widths. The divergence loss for a flat (2D) nozzle of half-angle α
// is sin α ÷ α, the mean of cos θ over a fan of half-angle α (the sweep in
// docs/perf/engine-validation.md bears it out: a 61° nozzle within 4%).
//
// Everything is in ratios to the chamber (stagnation) state, so it is pure and cheap to cache:
// speeds in units of the throat's sound speed c*, temperatures and pressures over the chamber's.

import { powPos, sinCos } from "./math.ts";

/** Area ratio A/A* for Mach M (the isentropic area–Mach relation). */
export function areaRatio(mach: number, gamma: number): number {
  const g = gamma;
  return (1 / mach) * powPos((2 / (g + 1)) * (1 + ((g - 1) / 2) * mach * mach), (g + 1) / (2 * (g - 1)));
}

/** The supersonic Mach number where the area is `ratio` times the throat's (1 at the throat). */
export function exitMach(ratio: number, gamma: number): number {
  if (!(ratio > 1)) return 1;
  // Bisection on the supersonic branch: A/A* rises with M above 1. A fixed count, so it is the same everywhere.
  let lo = 1;
  let hi = 2;
  while (areaRatio(hi, gamma) < ratio && hi < 1e3) hi *= 2;
  for (let i = 0; i < 64; i++) {
    const mid = 0.5 * (lo + hi);
    if (areaRatio(mid, gamma) < ratio) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** The flow at area ratio `ratio`: Mach, and temperature and pressure over the chamber's. */
export function flowAt(ratio: number, gamma: number): { mach: number; temperature: number; pressure: number } {
  const g = gamma;
  const mach = exitMach(ratio, g);
  const temperature = 1 / (1 + ((g - 1) / 2) * mach * mach);
  return { mach, temperature, pressure: powPos(temperature, g / (g - 1)) };
}

export interface NozzleFlow {
  /** Exit over throat width (≥ 1), and the exit's Mach number, temperature and pressure ratios. */
  ratio: number;
  mach: number;
  temperature: number;
  pressure: number;
  /**
   * The effective exhaust speed over c*: thrust ÷ (ṁ·c*), λ·vₑ plus the exit's pressure pₑ·Aₑ ÷ ṁ.
   * At the throat alone it is 1 + 1/γ, the chamber model's jet.
   */
  speed: number;
  /** Of that, the momentum part alone, λ·vₑ over c*: what the exhaust carries away as motion. */
  momentum: number;
  /** Thrust over a throat alone's at the same flow: speed ÷ (1 + 1/γ). */
  gain: number;
  /** Per wall: the mean pressure over the chamber's along it, and where its push acts (0 throat, 1 exit). */
  wallPressure: number;
  wallCentre: number;
}

const memo = new Map<string, NozzleFlow>();

/**
 * The nozzle's flow, from its exit-to-throat width ratio, the gas's γ and the walls' half-angle
 * (radians). Pure; cached.
 */
export function nozzleFlow(ratio: number, gamma: number, halfAngle: number): NozzleFlow {
  const key = `${ratio}|${gamma}|${halfAngle}`;
  const hit = memo.get(key);
  if (hit) return hit;
  const g = gamma;
  const eps = Math.max(1, ratio);
  const exit = flowAt(eps, g);
  const sq = Math.sqrt(exit.temperature);
  // In units of the chamber's sound speed a₀: the exit speed vₑ = M·aₑ, and pₑAₑ/ṁ = aₑ²/(γ·vₑ).
  const ve = exit.mach * sq;
  const pTerm = exit.temperature / (g * ve);
  const a = Math.abs(halfAngle);
  const lambda = a > 1e-9 ? sinCos(a).s / a : 1;
  const cStar = Math.sqrt(2 / (g + 1)); // c*/a₀
  const speed = (lambda * ve + pTerm) / cStar;
  // The pressure along a straight wall: the area grows linearly from throat to exit.
  const N = 32;
  let sum = 0;
  let moment = 0;
  for (let k = 0; k < N; k++) {
    const x = (k + 0.5) / N;
    const p = flowAt(1 + (eps - 1) * x, g).pressure;
    sum += p;
    moment += p * x;
  }
  const out: NozzleFlow = {
    ratio: eps,
    mach: exit.mach,
    temperature: exit.temperature,
    pressure: exit.pressure,
    speed,
    momentum: (lambda * ve) / cStar,
    gain: speed / (1 + 1 / g),
    wallPressure: sum / N,
    wallCentre: sum > 0 ? moment / sum : 0.5,
  };
  if (memo.size > 256) memo.clear();
  memo.set(key, out);
  return out;
}
