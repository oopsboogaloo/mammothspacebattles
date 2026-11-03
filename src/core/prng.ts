// Seeded PRNG whose state lives in the world (ARC-004).
// sfc32, seeded with splitmix32. Uses only 32-bit integer ops, so results are
// identical in every JavaScript engine.

export interface RngState {
  s: [number, number, number, number];
}

function splitmix32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
}

export function createRng(seed: number): RngState {
  if (!Number.isInteger(seed)) throw new Error(`Seed must be an integer, got ${seed}`);
  const next = splitmix32(seed);
  const rng: RngState = { s: [next(), next(), next(), next()] };
  // Discard the first outputs so similar seeds diverge quickly.
  for (let i = 0; i < 12; i++) nextU32(rng);
  return rng;
}

export function nextU32(rng: RngState): number {
  let [a, b, c, d] = rng.s;
  const t = (((a + b) | 0) + d) | 0;
  d = (d + 1) | 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) | 0;
  c = (c << 21) | (c >>> 11);
  c = (c + t) | 0;
  rng.s = [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
  return t >>> 0;
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: RngState): number {
  return nextU32(rng) / 4294967296;
}
