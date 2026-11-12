// Ground for a level drawn as one closed outline of its open space (docs/games/mammoth-thrust-design.md
// §4.1): the sky and every cave joined to it. The rock is a crust along the outline on its rock side,
// as Mammoth Lander's Cave 2 is built (scripts/lander.ts), so overhangs and roofs work.
//
// The outline runs clockwise round the open space, so the rock is on the left of the way it runs:
// a floor runs right to left, a roof left to right.
type Json = Record<string, unknown>;
export type Vec = { x: number; y: number };

/** How deep the crust goes, m, and the longest piece of it (a long wall is cut up, so each piece has a small box). */
const CRUST = 15;
const LONGEST = 40;

const round = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/**
 * How far it is from p along unit vector u to the next stretch of the outline, past segment `skip`.
 * Into the rock, that is how thick the rock is there; into the open, how wide the open space is.
 */
function reach(outline: Vec[], p: Vec, u: Vec, skip: number): number {
  let best = Infinity;
  for (let j = 0; j < outline.length; j++) {
    if (j === skip) continue;
    const a = outline[j];
    const b = outline[(j + 1) % outline.length];
    const e = { x: b.x - a.x, y: b.y - a.y };
    const den = u.x * e.y - u.y * e.x;
    if (Math.abs(den) < 1e-12) continue;
    const w = { x: a.x - p.x, y: a.y - p.y };
    const t = (w.x * e.y - w.y * e.x) / den; // along u
    const k = (w.x * u.y - w.y * u.x) / den; // along the segment
    if (t > 1e-6 && k >= 0 && k <= 1) best = Math.min(best, t);
  }
  return best;
}

/** The outline with every segment longer than `longest` cut into equal pieces. */
function cut(outline: Vec[], longest: number): Vec[] {
  const out: Vec[] = [];
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / longest));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  });
  return out;
}

/**
 * The rock round a closed outline of open space: a fixed quad along each segment on its rock side,
 * 15 m deep, or less where the rock is thinner, so no crust reaches through into the open.
 */
export function crust(air: Vec[], prefix: string): Json[] {
  const outline = cut(air, LONGEST);
  const bodies: Json[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) continue;
    const u = { x: -(b.y - a.y) / L, y: (b.x - a.x) / L };
    let depth = CRUST;
    for (let k = 0; k <= 8; k++) {
      const f = k / 8;
      depth = Math.min(depth, 0.98 * reach(outline, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, u, i));
    }
    depth = Math.max(depth, 0.05);
    const vertices = [a, b, { x: b.x + u.x * depth, y: b.y + u.y * depth }, { x: a.x + u.x * depth, y: a.y + u.y * depth }].map((v) => ({ x: round(v.x), y: round(v.y) }));
    bodies.push({ id: `${prefix}${i}`, fixed: true, mass: 1, friction: 0.9, position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, shape: { kind: "polygon", vertices } });
  }
  return bodies;
}

/**
 * The narrowest the open space is, m, measured straight across from the middle of each segment that
 * lies wholly below `below` (the caves, not the sky's valleys).
 */
export function narrowest(air: Vec[], below: number): number {
  let least = Infinity;
  for (let i = 0; i < air.length; i++) {
    const a = air[i];
    const b = air[(i + 1) % air.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6 || a.y > below || b.y > below) continue;
    const into = { x: (b.y - a.y) / L, y: -(b.x - a.x) / L }; // the open side: the right of the way it runs
    least = Math.min(least, reach(air, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, into, i));
  }
  return least;
}
