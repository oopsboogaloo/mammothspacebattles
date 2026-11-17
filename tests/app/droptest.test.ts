// The drop test (BPD-053): THRUST OG's landing on Thrust's first level is the damage benchmark, and
// nothing the designer does may change it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dropTest } from "../../src/app/blueprint/droptest.ts";
import { thrustOgPreset, thrustPreset } from "../../src/app/blueprint/model.ts";

const level = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));

describe("the drop test (BPD-053)", () => {
  it("BPD-053 THRUST OG dropped on Thrust's first level loses what it always has: its battery's welds and its main engine's right nozzle wall, and takes the landing through its contacts", () => {
    const r = dropTest(thrustOgPreset(level), level);
    expect(r.impactSpeed).toBeGreaterThan(12);
    expect(r.impactSpeed).toBeLessThan(14);
    expect(r.welds).toEqual(["w-battery-main", "w-battery-hull", "w-main-wall-b", "w-gen-battery-l"]);
    expect(r.biggestHit).toBeGreaterThan(150); // over the parts' damage threshold
    expect(r.integrityLost).toBeGreaterThan(0.1);
    expect(r.integrityLost).toBeLessThan(0.3);
    expect(r.destroyed).toBe(0);
    expect(r.flex).toBeLessThan(1); // rigid until it snaps
  }, 120_000);

  it("BPD-053 the drop test measures where a landing's energy goes, the same every time (THRUST 1 today: most of it into its welds)", () => {
    const a = dropTest(thrustPreset(level), level);
    expect(dropTest(thrustPreset(level), level)).toEqual(a);
    expect(a.energyLost).toBeGreaterThan(0);
    expect(a.contactEnergy).toBeGreaterThan(0);
    // Recorded, not a target: THRUST 1 takes about 15% of its landing through its contacts and bends 24°.
    expect(a.contactEnergy / a.energyLost).toBeLessThan(0.5);
  }, 120_000);
});
