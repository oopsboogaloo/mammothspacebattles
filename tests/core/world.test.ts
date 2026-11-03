import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createWorld, getProfile, hashValue, step, stepInPlace, type Command } from "../../src/core/index.ts";
import { disc } from "../helpers.ts";

const test = getProfile("test");

describe("world and step", () => {
  it("ARC-002 step advances exactly one fixed step and leaves the input untouched", () => {
    const w0 = createWorld(1, [disc("a")]);
    const before = hashValue(w0);
    const w1 = step(w0, [], test);
    expect(hashValue(w0)).toBe(before);
    expect(w1.tick).toBe(1);
    expect(w1.time).toBe(test.timestep);
  });

  it("ARC-002 step and stepInPlace give identical results", () => {
    const cmds: Command[][] = [[{ type: "body.add", body: disc("x") }], [{ type: "rng.sample", label: "r" }], [], [{ type: "body.set", id: "x", patch: { mass: 4 } }]];
    let pure = createWorld(5);
    const mutable = createWorld(5);
    for (const c of cmds) {
      pure = step(pure, c, test);
      stepInPlace(mutable, c, test);
    }
    expect(hashValue(pure)).toBe(hashValue(mutable));
  });

  it("ARC-002 time is derived from the tick count, so it does not drift", () => {
    const w = createWorld(1);
    for (let i = 0; i < 240 * 60; i++) stepInPlace(w, [], test);
    expect(w.time).toBe(60);
  });

  it("DET-004 bodies iterate in id order whatever order they were added in", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.string({ minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 12 }), (ids) => {
        const w = createWorld(1);
        stepInPlace(w, ids.map((id) => ({ type: "body.add", body: disc(id) })), test);
        const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        expect(w.bodies.map((b) => b.id)).toEqual(sorted);
        const reversed = createWorld(1);
        stepInPlace(reversed, [...ids].reverse().map((id) => ({ type: "body.add", body: disc(id) })), test);
        expect(hashValue(reversed)).toBe(hashValue(w));
      }),
    );
  });

  it("commands report bad ids and duplicates", () => {
    const w = createWorld(1, [disc("a")]);
    expect(() => stepInPlace(w, [{ type: "body.add", body: disc("a") }], test)).toThrow(/Duplicate/);
    expect(() => stepInPlace(createWorld(1), [{ type: "body.remove", id: "nope" }], test)).toThrow(/No body/);
    expect(() => stepInPlace(createWorld(1), [{ type: "body.set", id: "nope", patch: {} }], test)).toThrow(/No body/);
  });

  it("body.add copies its input, so later edits to the command don't leak in", () => {
    const b = disc("a");
    const w = createWorld(1);
    stepInPlace(w, [{ type: "body.add", body: b }], test);
    b.mass = 99;
    expect(w.bodies[0].mass).toBe(1);
  });

  it("rng.sample draws from the world PRNG and records an event", () => {
    const w = createWorld(9);
    stepInPlace(w, [{ type: "rng.sample", label: "a" }, { type: "rng.sample", label: "b" }], test);
    expect(w.events.map((e) => e.data.label)).toEqual(["a", "b"]);
    expect(w.events[0].data.value).not.toBe(w.events[1].data.value);
  });
});
