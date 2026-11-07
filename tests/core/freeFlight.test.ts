// Free flight (prototype, profile.gasFreeFlight; docs/perf/gpu-gas-phase0.md §11): gas that can't
// come near a body in the step flies on without pressure, outside the gas step.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, computeTotals, createWorld, freeFlightMask, getProfile, hashValue, initialWorld, parseScenario, stepInPlace, wallBodies, type Command, type Profile } from "../../src/core/index.ts";
import { box, readJson, ROOT } from "../helpers.ts";

const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const withFree = (p: Profile, margin = 2): Profile => ({ ...p, gasFreeFlight: margin });

describe("free flight", () => {
  const test = getProfile("test");
  const parcel = (id: number, x: number, vx: number) => ({ id, mass: 0.01, composition: { air: 1 }, position: { x, y: 0 }, velocity: { x: vx, y: 0 }, thermal: 500, radius: 0.05 });

  it("a parcel that can't reach a body within the margin flies ballistically, and one that can is stepped as gas", () => {
    const bodies = wallBodies([{ ...box("wall", 1, 1), position: { x: 0, y: 0 } }] as never);
    // h = 0.3 m; margin 2: within 0.71 (half-diagonal) + 0.6 + speed × dt of the wall's centre stays gas (500 m/s: 2.08 m in a step).
    const ps = [parcel(1, 1.2, 0), parcel(2, 3, 0), parcel(3, 3, -500)];
    const mask = freeFlightMask(ps as never, bodies, 1 / 240, 2);
    // Near the wall: gas. Far and slow: free. Far but fast enough to arrive within the step: gas.
    expect([...mask]).toEqual([0, 1, 0]);
  });

  it("GAS-007 LED-003 free parcels keep the ledger exact, drift exactly, and leave through the far field on the books", () => {
    const w = createWorld(1, [box("ship", 1, 1)], { x: 0, y: 0 }, { bounds: { min: { x: -100, y: -100 }, max: { x: 100, y: 100 }, farField: 5 } }, test);
    w.gas.parcels = [parcel(1, 3, 100), parcel(2, -3, -1)];
    w.gas.nextId = 3;
    w.ledger.totals = computeTotals(w);
    const p = withFree(test);
    stepInPlace(w, [], p, undefined);
    expect(w.gas.free).toBe(2);
    expect(w.gas.parcels[0].position.x).toBeCloseTo(3 + 100 * p.timestep, 12);
    for (let s = 0; s < 30; s++) stepInPlace(w, [], p);
    // The fast parcel is now past the far field (5 m beyond the ship's circle) and has left, recorded.
    expect(w.gas.parcels.map((q) => q.id)).toEqual([2]);
    expect(w.events.some((e) => e.type === "gas.left")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("free gas meets the same far field as stepped gas (a disc of 0.5 m, far field 5 m, a still parcel at 5.6 m stays either way)", () => {
    const keeps = (p: Profile) => {
      const w = createWorld(1, [{ ...box("d", 1, 1), shape: { kind: "disc", radius: 0.5 } }], { x: 0, y: 0 }, { bounds: { min: { x: -100, y: -100 }, max: { x: 100, y: 100 }, farField: 5 } }, test);
      w.gas.parcels = [parcel(1, 5.6, 0)];
      w.gas.nextId = 2;
      w.ledger.totals = computeTotals(w);
      stepInPlace(w, [], p);
      return { n: w.gas.parcels.length, free: w.gas.free };
    };
    expect(keeps(test).n).toBe(1);
    expect(keeps(withFree(test))).toEqual({ n: 1, free: 1 });
  });

  it("LAND climbs as it does without free flight (within 2%), with the ledger exact and some gas flying free", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "land-twin-engine.json")));
    const prof = getProfile(scn.profile);
    const climb = (p: Profile) => {
      const w = initialWorld(scn);
      let free = 0;
      for (let s = 0; s < 240; s++) {
        stepInPlace(w, s === 0 ? [set("left", 1), set("right", 1)] : [], p);
        free += w.gas.free ?? 0;
      }
      return { vy: assemblyTotals(w, "hull")!.velocity.y, w, free };
    };
    const off = climb(prof);
    const on = climb(withFree(prof));
    expect(off.w.gas.free).toBeUndefined();
    expect(on.free).toBeGreaterThan(0);
    expect(Math.abs(on.vy - off.vy) / off.vy).toBeLessThan(0.02);
    expect(on.w.ledger.violations).toBe(0);
    expect(on.w.ledger.maxResidual.energy).toBeLessThan(1e-6);
  }, 120_000);

  it("DET-001 with free flight, two runs give the same world", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "land-twin-engine.json")));
    const p = withFree(getProfile(scn.profile));
    const go = () => {
      const w = initialWorld(scn);
      for (let s = 0; s < 120; s++) stepInPlace(w, s === 0 ? [set("left", 1), set("right", 1)] : [], p);
      return hashValue(w);
    };
    expect(go()).toBe(go());
  }, 120_000);
});
