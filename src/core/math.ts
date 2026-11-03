// Vector helpers and pinned trigonometry (DET-003).
// sinCos uses fdlibm's kernel polynomials with Cody–Waite range reduction, so it
// gives the same bits in every JavaScript engine, unlike Math.sin/Math.cos.

export interface Vec2 {
  x: number;
  y: number;
}

export const v2 = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
/** 2D cross product a × b (a scalar). */
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
/** s × v for scalar s (angular velocity) and vector v. */
export const crossSV = (s: number, v: Vec2): Vec2 => ({ x: -s * v.y, y: s * v.x });
export const length = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const lengthSq = (a: Vec2): number => a.x * a.x + a.y * a.y;
export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

export interface Rot {
  c: number;
  s: number;
}
export const rotate = (q: Rot, v: Vec2): Vec2 => ({ x: q.c * v.x - q.s * v.y, y: q.s * v.x + q.c * v.y });
export const invRotate = (q: Rot, v: Vec2): Vec2 => ({ x: q.c * v.x + q.s * v.y, y: -q.s * v.x + q.c * v.y });

// fdlibm k_sin.c / k_cos.c coefficients.
const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;
// π/2 split into three parts (fdlibm e_rem_pio2.c) so k·PIO2_1 is exact.
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_3 = 2.02226624871116645580e-21;
const INV_PIO2 = 6.36619772367581382433e-1;

function kSin(x: number): number {
  const z = x * x;
  return x + x * z * (S1 + z * (S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))));
}
function kCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

/** Deterministic sin and cos of an angle in radians. Accurate to ~1 ulp for |x| < 1e6. */
export function sinCos(x: number): Rot {
  if (!Number.isFinite(x)) return { c: NaN, s: NaN };
  const k = Math.round(x * INV_PIO2);
  const r = x - k * PIO2_1 - k * PIO2_2 - k * PIO2_3;
  const s = kSin(r);
  const c = kCos(r);
  switch (((k % 4) + 4) % 4) {
    case 0:
      return { s, c };
    case 1:
      return { s: c, c: -s };
    case 2:
      return { s: -s, c: -c };
    default:
      return { s: -c, c: s };
  }
}
