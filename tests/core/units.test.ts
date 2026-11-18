// The units proof (docs/units-rescale-plan.md, stage 1): every scenario run in the core's units and
// converted to lengths ×4, masses ×1024, side by side; after every step, every body, weld, gas
// parcel and event must be the same bit for bit once divided by its factor.
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, scenarioFiles } from "../helpers.ts";
import { proof } from "../unitsProof.ts";

const ONLY = process.env.UNITS_ONLY?.split(",");

describe("the units proof: lengths ×4, masses ×1024 run as the core's own, bit for bit", () => {
  for (const file of scenarioFiles()) {
    const name = basename(file, ".json");
    if (ONLY && !ONLY.includes(name)) continue;
    it(`UNITS-001 ${name}`, () => {
      const r = proof(readJson(file), Number(process.env.UNITS_STEPS ?? 480));
      expect(r.untagged).toEqual([]);
      expect(r.diff).toBe("");
    }, 600_000);
  }
});
