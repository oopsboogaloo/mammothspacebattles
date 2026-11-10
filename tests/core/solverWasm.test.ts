// The WebAssembly module (docs/perf/rust-trial.md) holds the constraint solve and the gas loop. It
// was ported from TypeScript line for line and checked bit for bit against it (the TypeScript copies
// are gone); what stays checked here is what the two languages still share.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getProfile, hashValue, initialWorld, parseScenario, sinCos, stepInPlace, timelineByStep, wasmSinCos } from "../../src/core/index.ts";

function load(name: string) {
  const scn = parseScenario(JSON.parse(readFileSync(new URL(`../../scenarios/${name}`, import.meta.url), "utf8")));
  return { profile: getProfile(scn.profile), byStep: timelineByStep(scn), world: initialWorld(scn) };
}

describe("WebAssembly constraint solver", () => {
  it("DET-003 its sinCos gives math.ts's bits", () => {
    const xs = [0, -0, 1e-300, -1e-300, Math.PI / 2, -Math.PI / 2, Math.PI, 3 * Math.PI, 1e6, -1e6, 0.5, -0.5, NaN, Infinity, -Infinity];
    let seed = 12345;
    for (let i = 0; i < 5000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      xs.push((seed / 2147483648 - 0.5) * 2000);
    }
    for (const x of xs) {
      const a = sinCos(x);
      const b = wasmSinCos(x);
      expect(Object.is(a.s, b.s) && Object.is(a.c, b.c), `sinCos(${x})`).toBe(true);
    }
  });
});

describe("WebAssembly gas loop", () => {
  it("DET-001 the gas steps the same timed or not", () => {
    const { profile, byStep, world } = load("rs08-chemical-rocket.json");
    for (let s = 0; s < 60; s++) stepInPlace(world, byStep.get(s) ?? [], profile);
    expect(world.gas.count).toBeGreaterThan(20);
    const timed = structuredClone(world);
    const out: Record<string, number> = {};
    for (let s = 60; s < 90; s++) {
      stepInPlace(world, byStep.get(s) ?? [], profile);
      stepInPlace(timed, byStep.get(s) ?? [], profile, { clock: () => 0, out });
      expect(hashValue(timed)).toBe(hashValue(world));
    }
    // The module reported its phases through the clock it was given.
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["gas.contacts", "gas.neighbours", "gas.impulses"]));
  });
});
