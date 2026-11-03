import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalParse, canonicalStringify, createWorld, hashString, hashValue, stepInPlace, getProfile, type Body } from "../../src/core/index.ts";
import { disc } from "../helpers.ts";

const finite = fc.double({ min: -1e6, max: 1e6, noNaN: true });
const vec = fc.record({ x: finite, y: finite });
const body = fc.record({
  id: fc.string({ minLength: 1, maxLength: 6 }),
  shape: fc.record({ kind: fc.constant("disc" as const), radius: fc.double({ min: 0.01, max: 100, noNaN: true }) }),
  mass: fc.double({ min: 0.001, max: 1e6, noNaN: true }),
  position: vec,
  velocity: vec,
  angle: finite,
  angularVelocity: finite,
});
const bodies = fc.uniqueArray(body, { selector: (b) => b.id, maxLength: 8 });

describe("canonical serialisation", () => {
  it("ARC-003 world → JSON → world → JSON gives identical bytes", () => {
    fc.assert(
      fc.property(fc.integer(), bodies, fc.nat(50), (seed, bs, steps) => {
        const world = createWorld(seed, bs as Body[]);
        for (let i = 0; i < steps; i++) stepInPlace(world, i % 7 === 0 ? [{ type: "rng.sample", label: `s${i}` }] : [], getProfile("test"));
        const once = canonicalStringify(world);
        const twice = canonicalStringify(canonicalParse(once));
        expect(twice).toBe(once);
        expect(canonicalParse(once)).toEqual(world);
      }),
    );
  });

  it("ARC-003 preserves -0 and full double precision", () => {
    const text = canonicalStringify({ a: -0, b: 0.1 + 0.2, c: 5e-324, d: 1.7976931348623157e308 });
    const back = canonicalParse(text) as Record<string, number>;
    expect(Object.is(back.a, -0)).toBe(true);
    expect(back.b).toBe(0.1 + 0.2);
    expect(back.c).toBe(5e-324);
    expect(back.d).toBe(1.7976931348623157e308);
  });

  it("ARC-003 key order does not change the output", () => {
    expect(canonicalStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("ARC-003 rejects values that cannot round-trip", () => {
    expect(() => canonicalStringify({ x: NaN })).toThrow(/\$\.x/);
    expect(() => canonicalStringify([Infinity])).toThrow(/\$\[0\]/);
    expect(() => canonicalStringify({ f: () => 1 })).toThrow(/function/);
  });
});

describe("hashing", () => {
  it("DET-002 hash is stable for a known input", () => {
    expect(hashString("")).toBe(hashString(""));
    expect(hashString("mammoth")).toMatchInlineSnapshot(`"c95bea77d4c56846"`);
  });

  it("DET-002 equal worlds hash equal; any change changes the hash", () => {
    const a = createWorld(3, [disc("a"), disc("b", { mass: 2 })]);
    const b = createWorld(3, [disc("b", { mass: 2 }), disc("a")]);
    expect(hashValue(a)).toBe(hashValue(b));
    b.bodies[0].position.x = 1e-12;
    expect(hashValue(a)).not.toBe(hashValue(b));
  });

  it("DET-002 hash is 16 hex characters", () => {
    expect(hashValue(createWorld(1))).toMatch(/^[0-9a-f]{16}$/);
  });
});
