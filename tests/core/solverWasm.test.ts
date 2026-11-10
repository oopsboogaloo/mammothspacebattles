// The WebAssembly constraint solver and gas loop (docs/perf/rust-trial.md) must give the
// TypeScript's results bit for bit, so the switch changes speed and garbage, never the physics.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { clusterGas, hashValue, getProfile, initialWorld, parseScenario, runClusterJob, setWasmSolver, sinCos, wallBodies, wasmSolverOn, stepInPlace, timelineByStep, wasmSinCos, type Command, type World } from "../../src/core/index.ts";

/** Every control channel pulsed (from step 40: all on, one off, all off, a third of a second each), so engines fire. */
function pulse(world: World, s: number): Command[] {
  if (s % 40) return [];
  const channels = [...new Set(world.links.flatMap((l) => (l.kind === "control" ? [l.channel] : [])))];
  const k = (s / 40 + 2) % 3;
  if (k === 1) return channels.slice(0, 1).map((channel) => ({ type: "control.set", channel, value: 0 }));
  return channels.map((channel) => ({ type: "control.set", channel, value: k === 0 ? 1 : 0 }));
}

function load(name: string) {
  const scn = parseScenario(JSON.parse(readFileSync(new URL(`../../scenarios/${name}`, import.meta.url), "utf8")));
  return { profile: getProfile(scn.profile), byStep: timelineByStep(scn), world: initialWorld(scn) };
}

function hashes(name: string, steps: number, wasm: boolean, thrust = false): { hashes: string[]; parcels: number } {
  setWasmSolver(wasm);
  const { profile, byStep, world } = load(name);
  const out: string[] = [];
  let parcels = 0;
  for (let s = 0; s < steps; s++) {
    stepInPlace(world, [...(byStep.get(s) ?? []), ...(thrust ? pulse(world, s) : [])], profile);
    parcels = Math.max(parcels, world.gas.parcels.length);
    out.push(hashValue(world));
  }
  return { hashes: out, parcels };
}

describe("WebAssembly constraint solver", () => {
  it("is on by default", () => expect(wasmSolverOn()).toBe(true));

  afterEach(() => setWasmSolver(true));

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

  // Welds that bend and break, a spinning assembly, a 130-part welded rock, rubble on a gunship.
  for (const [name, steps] of [
    ["rs05b-spinning-assembly.json", 240],
    ["ft-breakable.json", 240],
    ["lander-orbital.json", 120],
    ["gunship-rubble.json", 120],
  ] as const) {
    it(`DET-001 ${name}: the same hash every step as the TypeScript solver`, () => {
      const ts = hashes(name, steps, false).hashes;
      const rs = hashes(name, steps, true).hashes;
      expect(rs.findIndex((h, i) => h !== ts[i])).toBe(-1);
    });
  }
});

describe("WebAssembly gas loop", () => {
  afterEach(() => setWasmSolver(true));

  // Gas in a closed box, a rocket, a battle; then ships whose engines the test pulses: the lander
  // over a 130-part rock (a welded ship as one rigid unit), with a leaking tank, and a gunship.
  // (`node scripts/wasm-compare.ts --thrust scenarios/*.json` compares every scenario, for longer.)
  for (const [name, steps, thrust] of [
    ["sc02-gas-in-a-box.json", 10, false],
    ["rs08-chemical-rocket.json", 120, false],
    ["reference-battle.json", 25, false],
    ["lander-orbital.json", 130, true],
    ["lander-emergency.json", 110, true],
    ["gunship-2.json", 90, true],
  ] as const) {
    it(`DET-001 ${name}: the same hash every step as the TypeScript gas loop`, () => {
      const ts = hashes(name, steps, false, thrust);
      const rs = hashes(name, steps, true, thrust);
      expect(ts.parcels).toBeGreaterThan(20);
      expect(rs.hashes.findIndex((h, i) => h !== ts.hashes[i])).toBe(-1);
    });
  }

  it("DET-001 a cluster job gives the same result in either loop, timed or not, wherever it was made", () => {
    const { profile, byStep, world } = load("rs08-chemical-rocket.json");
    for (let s = 0; s < 60; s++) stepInPlace(world, byStep.get(s) ?? [], profile);
    const jobs = () => clusterGas(world.gas, wallBodies(world.bodies), world.joints, profile.timestep, world.bounds, world.gravity, [], false, true)!.jobs;
    expect(jobs()[0].wasm).toBe(true);
    const plain = (wasm: boolean, timed: boolean) => jobs().map((j) => runClusterJob({ ...j, wasm, timed }, () => 0));
    const ts = plain(false, false);
    const rs = plain(true, true);
    expect(ts.length).toBeGreaterThan(0);
    expect(ts[0].parcels.length).toBeGreaterThan(20);
    for (const r of [...ts, ...rs]) r.timings = {};
    expect(rs).toEqual(ts);
    // Made where the TypeScript loop is in use (`?wasm=0`), a job says so, for a helper thread.
    setWasmSolver(false);
    expect(jobs()[0].wasm).toBe(false);
  });
});
