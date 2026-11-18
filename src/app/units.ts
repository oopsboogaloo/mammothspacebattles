// The game's units in the core's (docs/units-rescale-plan.md; Chloe, 18 November 2026): lengths ×4,
// masses ×1024, time kept. The app's figures were set in the core's units; each is written here as
// that figure times its dimension's factor, so the old figure stays readable and the new one exact.
import { D, factor, GAME_UNITS } from "../core/units.ts";

const f = (d: (typeof D)[keyof typeof D]) => factor(GAME_UNITS, d);
/** m */
export const LEN = f(D.length);
/** m² */
export const AREA = f(D.area);
/** kg */
export const MASS = f(D.mass);
/** m/s, m/s² */
export const SPEED = f(D.speed);
export const ACCEL = f(D.accel);
/** kg/s */
export const FLOW = f(D.massRate);
/** N */
export const FORCE = f(D.force);
/** N·s, kg·m/s */
export const MOMENTUM = f(D.momentum);
/** J (kJ), N·m */
export const ENERGY = f(D.energy);
/** W (kW) */
export const POWER = f(D.power);
/** N/m (a 2D pressure, a stiffness) */
export const PRESSURE = f(D.pressure);
/** kg/m² */
export const DENSITY = f(D.density);
/** J/kg (kJ/kg) */
export const SPECIFIC = f(D.specificEnergy);
/** Pixels per metre: a zoom shrinks as metres grow. */
export const ZOOM = 1 / LEN;
