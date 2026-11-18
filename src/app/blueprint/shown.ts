// The designer works in the core's units (the blueprint's numbers, the design rules), and shows and
// takes figures in the game's (lengths ×4, masses ×1024: ../units.ts; docs/units-rescale-plan.md).
// Every figure shown passes through here by its unit, and every figure typed comes back.
import { ACCEL, ENERGY, FLOW, FORCE, LEN, MASS, MOMENTUM, POWER, PRESSURE, SPEED } from "../units.ts";

const FACTORS: Record<string, number> = {
  m: LEN,
  "m²": LEN * LEN,
  kg: MASS,
  "kg/s": FLOW,
  "m/s": SPEED,
  "m/s²": ACCEL,
  N: FORCE,
  "N·s": MOMENTUM,
  "N·m": ENERGY,
  J: ENERGY,
  kJ: ENERGY,
  kW: POWER,
  "N/m": PRESSURE,
};

/** What a figure in `unit` is multiplied by to show it (1 for angles, ratios, seconds, counts). */
export const shownFactor = (unit: string): number => FACTORS[unit] ?? 1;
/** A figure as shown. */
export const shown = (v: number, unit: string): number => v * shownFactor(unit);
/** A figure typed in, back in the designer's units. */
export const fromShown = (v: number, unit: string): number => v / shownFactor(unit);
/** Decimals for a figure grown by its factor: as many fewer as the factor has digits, at least none. */
export const shownDecimals = (decimals: number, unit: string): number => Math.max(0, decimals - Math.floor(Math.log10(shownFactor(unit))));

/** A number field as shown: its value, range and step in the game's units. */
export function shownParam<P extends { value: number; min: number; max: number; step: number; decimals: number; unit: string }>(p: P): P {
  const k = shownFactor(p.unit);
  if (k === 1) return p;
  return { ...p, value: p.value * k, min: p.min * k, max: p.max * k, step: p.step * k, decimals: shownDecimals(p.decimals, p.unit) };
}
