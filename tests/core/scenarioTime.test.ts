// Scenario files count time in steps of 1/240 s whatever the profile's timestep (SCENARIO_TICK), so a
// file means the same at any step rate.
import { describe, expect, it } from "vitest";
import { scenarioStep, simStep } from "../../src/core/index.ts";

describe("scenario time", () => {
  it("SCN-004 scenario steps are 1/240 s: the same at 240 steps a second, halved at 120, and back again", () => {
    expect(simStep({ timestep: 1 / 240 }, 480)).toBe(480);
    expect(simStep({ timestep: 1 / 120 }, 480)).toBe(240);
    expect(scenarioStep({ timestep: 1 / 120 }, 240)).toBe(480);
    for (let t = 0; t < 1000; t++) expect(simStep({ timestep: 1 / 120 }, scenarioStep({ timestep: 1 / 120 }, t))).toBe(t);
  });
});
