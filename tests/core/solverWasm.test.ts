// The WebAssembly constraint solver (docs/perf/rust-trial.md) must give the TypeScript's results
// bit for bit, so the switch changes speed and garbage, never the physics.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { hashValue, getProfile, initialWorld, parseScenario, setWasmSolver, sinCos, wasmSolverOn, stepInPlace, timelineByStep, wasmSinCos } from "../../src/core/index.ts";

function hashes(name: string, steps: number, wasm: boolean): string[] {
  setWasmSolver(wasm);
  const scn = parseScenario(JSON.parse(readFileSync(new URL(`../../scenarios/${name}`, import.meta.url), "utf8")));
  const profile = getProfile(scn.profile);
  const byStep = timelineByStep(scn);
  const world = initialWorld(scn);
  const out: string[] = [];
  for (let s = 0; s < steps; s++) {
    stepInPlace(world, byStep.get(s) ?? [], profile);
    out.push(hashValue(world));
  }
  return out;
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
      const ts = hashes(name, steps, false);
      const rs = hashes(name, steps, true);
      expect(rs.findIndex((h, i) => h !== ts[i])).toBe(-1);
    });
  }
});
