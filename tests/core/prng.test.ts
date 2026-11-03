import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalParse, canonicalStringify, createRng, createWorld, nextFloat, nextU32, type RngState } from "../../src/core/index.ts";

describe("PRNG", () => {
  it("ARC-004 the same seed gives the same sequence", () => {
    fc.assert(
      fc.property(fc.integer({ min: -(2 ** 31), max: 2 ** 32 - 1 }), (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        for (let i = 0; i < 50; i++) expect(nextU32(a)).toBe(nextU32(b));
      }),
    );
  });

  it("ARC-004 different seeds give different sequences", () => {
    const seqs = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const r = createRng(seed);
      seqs.add([nextU32(r), nextU32(r), nextU32(r)].join(","));
    }
    expect(seqs.size).toBe(200);
  });

  it("ARC-004 the generator state lives in the world and survives serialisation", () => {
    const world = createWorld(7);
    nextU32(world.rng);
    const copy = canonicalParse(canonicalStringify(world)) as unknown as { rng: RngState };
    expect(nextU32(copy.rng)).toBe(nextU32(world.rng));
  });

  it("ARC-004 pinned output for seed 1 (catches accidental algorithm changes)", () => {
    const r = createRng(1);
    const first = [nextU32(r), nextU32(r), nextU32(r)];
    expect(first).toMatchInlineSnapshot(`
      [
        1828152527,
        3394835397,
        2967886022,
      ]
    `);
  });

  it("nextFloat is in [0, 1) and roughly uniform", () => {
    const r = createRng(123);
    const bins = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = nextFloat(r);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      bins[Math.floor(x * 10)]++;
    }
    for (const b of bins) expect(Math.abs(b - 10_000)).toBeLessThan(500);
  });

  it("rejects non-integer seeds", () => {
    expect(() => createRng(1.5)).toThrow(/integer/);
  });
});
