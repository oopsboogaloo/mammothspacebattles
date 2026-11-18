// The drop test (BPD-053): THRUST OG's landing on Thrust's first level is the damage benchmark, and
// nothing the designer does may change it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dropTest } from "../../src/app/blueprint/droptest.ts";
import { thrustOgPreset, thrustPreset } from "../../src/app/blueprint/model.ts";
import { inCoreUnits } from "../helpers.ts";

const level = inCoreUnits(JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8")));

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

  it("BPD-053 DMG-009 THRUST 1 lands as THRUST OG does: its welds stiff, it stays true until something snaps, loses its battery's welds, and its engine fires; the same every time", () => {
    const a = dropTest(thrustPreset(level), level);
    expect(dropTest(thrustPreset(level), level)).toEqual(a);
    expect(a.welds.slice(0, 2).sort()).toEqual(["w-main-battery-0", "w-main-battery-1"]);
    expect(a.integrityLost).toBeGreaterThan(0.2);
    expect(a.destroyed).toBe(0);
    expect(a.flex).toBeLessThan(2); // it was 24° before its welds were stiff
  }, 120_000);
});
