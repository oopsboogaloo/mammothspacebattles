// The nozzle's 1D isentropic flow (PRP-012), against textbook values.
import { describe, expect, it } from "vitest";
import { areaRatio, exitMach, flowAt, nozzleFlow } from "../../src/core/nozzle.ts";

describe("nozzleFlow (PRP-012)", () => {
  it("PRP-012 the isentropic relations match the standard tables (NACA Report 1135, γ 1.4)", () => {
    // M 2: A/A* 1.6875, T/T0 0.5556, p/p0 0.1278. M 3: A/A* 4.2346, T/T0 0.3571, p/p0 0.02722.
    expect(areaRatio(2, 1.4)).toBeCloseTo(1.6875, 4);
    expect(areaRatio(3, 1.4)).toBeCloseTo(4.2346, 4);
    expect(exitMach(1.6875, 1.4)).toBeCloseTo(2, 4);
    expect(exitMach(4.2346, 1.4)).toBeCloseTo(3, 4);
    const m2 = flowAt(1.6875, 1.4);
    expect(m2.temperature).toBeCloseTo(0.5556, 4);
    expect(m2.pressure).toBeCloseTo(0.1278, 4);
    const m3 = flowAt(4.2346, 1.4);
    expect(m3.temperature).toBeCloseTo(0.3571, 4);
    expect(m3.pressure).toBeCloseTo(0.02722, 5);
    // The throat itself: Mach 1, T*/T0 = 2/(γ + 1).
    expect(exitMach(1, 1.4)).toBe(1);
    expect(flowAt(1, 1.33).temperature).toBeCloseTo(2 / 2.33, 12);
  });

  it("PRP-012 with no nozzle the jet is the chamber model's, c*·(1 + 1/γ); a nozzle's gain is the textbook thrust coefficient's", () => {
    for (const g of [1.2, 1.33, 1.4]) {
      expect(nozzleFlow(1, g, 0).speed).toBeCloseTo(1 + 1 / g, 12);
      expect(nozzleFlow(1, g, 0).gain).toBeCloseTo(1, 12);
    }
    // Ideal, in vacuum, over a throat alone (docs/nozzle-design-thoughts.md §2): at γ 1.33, 1.16 at
    // ratio 2, 1.21 at 2.8, 1.27 at 5, 1.33 at 10; at γ 1.2, 1.40 at 10.
    expect(nozzleFlow(2, 1.33, 0).gain).toBeCloseTo(1.16, 2);
    expect(nozzleFlow(2.8, 1.33, 0).gain).toBeCloseTo(1.21, 2);
    expect(nozzleFlow(5, 1.33, 0).gain).toBeCloseTo(1.27, 2);
    expect(nozzleFlow(10, 1.33, 0).gain).toBeCloseTo(1.33, 2);
    expect(nozzleFlow(10, 1.2, 0).gain).toBeCloseTo(1.4, 2);
    // As a thrust coefficient C_F = F ÷ (p₀A*): a throat alone at γ 1.2 is 1.24, and ratio 10 about
    // 1.74 (a NASA test measured 1.70 at ratio 8 in vacuum; NTRS 19980223581).
    const cfThroat = (g: number) => (g + 1) * (2 / (g + 1)) ** (g / (g - 1));
    expect(cfThroat(1.2)).toBeCloseTo(1.24, 2);
    expect(cfThroat(1.2) * nozzleFlow(10, 1.2, 0).gain).toBeCloseTo(1.74, 2);
  });

  it("PRP-012 flaring the walls costs the momentum term sin α ÷ α; a wider nozzle gives more, a narrower one never less than its throat", () => {
    const straight = nozzleFlow(2.8, 1.33, 0);
    const flared = nozzleFlow(2.8, 1.33, (30 * Math.PI) / 180);
    expect(flared.speed).toBeLessThan(straight.speed);
    // Only the momentum term pays: λ = sin 30° ÷ (π/6) = 0.955.
    const pTerm = straight.speed - flared.speed;
    expect(pTerm).toBeGreaterThan(0);
    let last = 0;
    for (const r of [1, 1.2, 1.5, 2, 3, 5, 8]) {
      const f = nozzleFlow(r, 1.33, 0);
      expect(f.gain).toBeGreaterThanOrEqual(last);
      last = f.gain;
    }
    expect(nozzleFlow(0.5, 1.33, 0).gain).toBe(1);
  });

  it("PRP-012 the walls feel the pressure falling from the throat's to the exit's, pushing hardest near the throat", () => {
    const f = nozzleFlow(3, 1.33, 0.2);
    const pStar = flowAt(1, 1.33).pressure;
    expect(f.wallPressure).toBeLessThan(pStar);
    expect(f.wallPressure).toBeGreaterThan(f.pressure);
    expect(f.wallCentre).toBeGreaterThan(0);
    expect(f.wallCentre).toBeLessThan(0.5);
  });
});
