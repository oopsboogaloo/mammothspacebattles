// Pressure ceilings and the L* rule for the regular rockets (design rules §5; BPD-052).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { body, capRates, component, lstarOf, maxRate, params, pressureCeiling, setParam, stegodonPreset, thrustOgPreset, thrustPreset } from "../../src/app/blueprint/model.ts";
import { burnEfficiency, holdPressure, PRESSURE } from "../../src/app/blueprint/rules.ts";
import { measureNow } from "../../src/app/blueprint/measure.ts";

const scn = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
const t1 = thrustPreset(scn);
const C_STAR = 206 / (1 + 1 / 1.33);
const pressureOf = (bp: typeof t1, id: string) => ((body(bp, id).injector!.rate ?? 0) * C_STAR) / component(bp, id).rocket!.throat;

describe("pressure ceilings and the L* rule (BPD-052)", () => {
  it("BPD-052 a wall holds 2·k·t ÷ L; a pressure-fed engine runs at most its weakest tank's hold over 1.5; L* below 0.3 m burns less, never under 70%", () => {
    expect(PRESSURE).toEqual({ k: 25_700, feedMargin: 1.5, lstar: 0.3, lstarFloor: 0.7 });
    // THRUST 1's wing tanks: 0.1 m walls, 1.5 m long.
    expect(holdPressure(0.1, 1.5)).toBeCloseTo(3426.7, 1);
    expect(holdPressure(0.2, 1.5)).toBeCloseTo(2 * holdPressure(0.1, 1.5), 9);
    expect(burnEfficiency(0.3)).toBe(1);
    expect(burnEfficiency(1)).toBe(1);
    expect(burnEfficiency(0.15)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(burnEfficiency(0.01)).toBe(0.7);
  });

  it("BPD-052 THRUST 1's main engine runs at half its ceiling, set by its wing tanks; its light thrusters' longer chambers (L* 0.30) burn completely", () => {
    const cap = pressureCeiling(t1, "main")!;
    expect(cap.by).toMatch(/^Tank [LR]$/);
    expect(cap.ceiling).toBeCloseTo(holdPressure(0.1, 1.5) / 1.5, 6);
    expect(pressureOf(t1, "main") / cap.ceiling).toBeCloseTo(0.5, 2);
    for (const id of ["main", "back-l", "back-r", "front-l", "front-r"]) {
      expect(lstarOf(component(t1, id).rocket!), id).toBeGreaterThanOrEqual(0.3);
      expect(body(t1, id).injector!.efficiency, id).toBeUndefined();
    }
    expect(component(t1, "back-l").rocket!.chamberLength).toBe(0.19);
    // Properties shows it.
    const ps = params(t1, "main");
    expect(ps.find((p) => p.key === "ceiling")!.value).toBeCloseTo(cap.ceiling, 6);
    expect(ps.find((p) => p.key === "rate")!.max).toBeCloseTo(maxRate(t1, "main"), 2);
  });

  it("BPD-052 the designer stops a rocket at its ceiling: asking for more gets the most; doubling THRUST 1's main engine's flow is allowed, tripling isn't", () => {
    const max = maxRate(t1, "main");
    expect(max / body(t1, "main").injector!.rate!).toBeCloseTo(2, 2);
    expect(body(setParam(t1, "main", "rate", 100), "main").injector!.rate).toBeCloseTo(max, 9);
    expect(body(setParam(t1, "main", "rate", 10), "main").injector!.rate).toBe(10);
  });

  it("BPD-052 an edit that lowers the ceiling brings the flow down to it: thinner tank walls cut THRUST 1's main engine", () => {
    const fast = setParam(t1, "main", "rate", 15);
    const thin = setParam(fast, "tank-l", "wall", 0.06);
    const { bp, cut } = capRates(thin);
    expect(cut).toContain("Main thruster");
    expect(body(bp, "main").injector!.rate).toBeLessThanOrEqual(maxRate(bp, "main") + 1e-9);
    expect(pressureCeiling(bp, "main")!.by).toBe("Tank L");
    // And nothing to cut when nothing is over.
    expect(capRates(t1).cut).toEqual([]);
  });

  it("BPD-052 a chamber too short for the L* rule declares its efficiency and pushes less; THRUST OG's engines declare nothing", () => {
    const short = setParam(t1, "main", "chamberLength", 0.1);
    expect(body(short, "main").injector!.efficiency).toBeCloseTo(Math.SQRT1_2, 6);
    const [a] = measureNow(t1, [{ forward: 1 }]);
    const [b] = measureNow(short, [{ forward: 1 }]);
    expect(b.ahead).toBeLessThan(a.ahead * 0.92);
    expect(thrustOgPreset(scn).ship.bodies.filter((x) => x.injector?.efficiency !== undefined || x.injector?.nozzle)).toEqual([]);
    expect(stegodonPreset(scn).ship.bodies.filter((x) => x.injector?.efficiency !== undefined)).toEqual([]);
  }, 300_000);
});
