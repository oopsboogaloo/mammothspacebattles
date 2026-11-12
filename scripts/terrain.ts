// Checks on a level drawn as one closed outline of its open space (docs/games/mammoth-thrust-design.md
// §4.1): the sky and every cave joined to it. The rock itself is made from the outline when the world
// is (src/core/terrain.ts, TER-001).
//
// The outline runs clockwise round the open space, so the rock is on the left of the way it runs:
// a floor runs right to left, a roof left to right.
export type Vec = { x: number; y: number };

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
