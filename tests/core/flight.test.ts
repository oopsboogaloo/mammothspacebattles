// M4b flight trials: a twin-engine ship steered only by throttling its engines (RS-16).
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseScenario, runScenario, type RunResult } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const mean = (xs: number[], a: number, b: number) => xs.slice(a, b).reduce((s, x) => s + x, 0) / (b - a);
let r: RunResult;

// Timeline: both engines 0–240, left only 240–360, coasting 360–600 (steps of 1/240 s).
beforeAll(() => {
  r = runScenario(parseScenario(readJson(join(ROOT, "scenarios", "rs16-twin-engine.json"))));
}, 60_000);

describe("twin-engine ship (RS-16)", () => {
  it("passes its scenario assertions", () => {
    expect(r.assertions.filter((a) => !a.pass)).toEqual([]);
  });

  it("FLT-001 at equal throttle it climbs along its axis, with spin no more than jet noise", () => {
    expect(r.probes.vy[240]).toBeGreaterThan(3);
    expect(Math.abs(r.probes.vx[240])).toBeLessThan(0.1 * r.probes.vy[240]);
    expect(Math.max(...r.probes.spin.slice(0, 241).map(Math.abs))).toBeLessThan(0.3);
  });

  it("FLT-002 with only the left engine firing the nose turns right (clockwise), from gas on that engine alone", () => {
    expect(r.probes.spin[360]).toBeLessThan(-0.8);
    // Momentum still balances against the gas: nothing pushed the ship but its exhaust.
    const end = r.steps;
    expect(r.probes.py[end] + r.probes.gasPy[end] + r.probes.leftPy[end]).toBeCloseTo(0, 6);
  });

  it("FLT-003 coasting, the ship and the gas left in its chambers keep their total angular momentum; the spin holds", () => {
    const L = (t: number) => r.probes.Lship[t] + r.probes.Lgas[t] + r.probes.Lgone[t];
    expect(L(r.steps) - L(480)).toBeCloseTo(0, 6);
    expect(Math.abs(r.probes.spin[r.steps] - r.probes.spin[480])).toBeLessThan(0.01);
    expect(r.world.ledger.violations).toBe(0);
  });

  it("FLT-004 uneven thrust loads the welds unevenly: the firing engine's mount carries the thrust", () => {
    const eqL = mean(r.probes.compL, 60, 240);
    const eqR = mean(r.probes.compR, 60, 240);
    expect(Math.abs(eqL - eqR) / eqL).toBeLessThan(0.2); // equal throttle, equal loads
    expect(mean(r.probes.compL, 260, 360)).toBeGreaterThan(3 * mean(r.probes.compR, 260, 360));
    expect(mean(r.probes.compL, 480, 600)).toBeLessThan(1); // nothing pushing while coasting
  });
});
