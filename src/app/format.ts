// Readable numbers with SI prefixes (§8.2 principle 8).

const PREFIXED = new Set(["N", "J", "W", "m", "N·s", "Pa", "m/s", "m/s²"]);
const PREFIXES: [number, string][] = [
  [1e9, "G"],
  [1e6, "M"],
  [1e3, "k"],
  [1, ""],
  [1e-3, "m"],
  [1e-6, "µ"],
];

/** Formats a value with `digits` significant figures, e.g. 1240 N → "1.24 kN", 0.0035 m → "3.50 mm". */
export function fmt(value: number, unit = "", digits = 3): string {
  if (!Number.isFinite(value)) return `${value}${unit ? " " + unit : ""}`;
  if (value === 0) return `0${unit ? " " + unit : ""}`;
  const abs = Math.abs(value);
  // Speeds below 1 m/s read better as "0.500 m/s" than "500 mm/s".
  if (PREFIXED.has(unit) && !(unit.startsWith("m/") && abs < 1)) {
    for (const [scale, prefix] of PREFIXES) {
      if (abs >= scale * 0.9995) return `${(value / scale).toPrecision(digits)} ${prefix}${unit}`;
    }
  }
  if (abs >= 1e5 || abs < 1e-3) return `${value.toExponential(digits - 1)}${unit ? " " + unit : ""}`;
  return `${value.toPrecision(digits)}${unit ? " " + unit : ""}`;
}

/** Fixed decimals for editable fields: no prefixes, so typed values round-trip. */
export function plain(value: number, decimals = 3): string {
  if (!Number.isFinite(value)) return String(value);
  const s = value.toFixed(decimals);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

export const deg = (rad: number) => (rad * 180) / Math.PI;
export const rad = (degrees: number) => (degrees * Math.PI) / 180;
