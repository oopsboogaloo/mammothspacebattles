// The WebAssembly module (docs/perf/rust-trial.md) holds the constraint solve and the gas loop. It
// was ported from TypeScript line for line and checked bit for bit against it (the TypeScript copies
// are gone); what stays checked here is what the two languages still share.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clusterGas, getProfile, hashValue, initialWorld, parseScenario, runClusterJob, sinCos, stepInPlace, timelineByStep, wallBodies, wasmSinCos } from "../../src/core/index.ts";

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
  it("DET-001 a cluster job gives the same result timed or not, and run twice", () => {
    const { profile, byStep, world } = load("rs08-chemical-rocket.json");
    for (let s = 0; s < 60; s++) stepInPlace(world, byStep.get(s) ?? [], profile);
    const before = hashValue(world);
    const jobs = () => clusterGas(world.gas, wallBodies(world.bodies), world.joints, profile.timestep, world.bounds, world.gravity, [], false, true)!.jobs;
    const run = (timed: boolean) => jobs().map((j) => runClusterJob({ ...j, timed }, () => 0));
    const a = run(false);
    const b = run(true);
    const c = run(false);
    expect(a.length).toBeGreaterThan(0);
    expect(a[0].parcels.length).toBeGreaterThan(20);
    for (const r of [...a, ...b, ...c]) r.timings = {};
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    // The jobs were copies: the world is as it was.
    expect(hashValue(world)).toBe(before);
  });
});
