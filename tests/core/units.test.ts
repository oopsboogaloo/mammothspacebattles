// The units proof (docs/units-rescale-plan.md, stage 1): every scenario (UNITS-001) and every designer preset in its game (UNITS-002) run in the core's units and
// converted to lengths ×4, masses ×1024, side by side; after every step, every body, weld, gas
// parcel and event must be the same bit for bit once divided by its factor.
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, scenarioFiles } from "../helpers.ts";
import { proof } from "../unitsProof.ts";
import { withBlueprint } from "../../src/app/playtest.ts";
import { loxodonPreset, mastodonPreset, phiomiaPreset, stegodonPreset, thrustOgPreset, thrustPreset } from "../../src/app/blueprint/model.ts";

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

describe("the units proof for the designer's presets, flown in Thrust's first level", () => {
  const level = readJson("scenarios/thrust-1.json") as Parameters<typeof thrustPreset>[0];
  for (const make of [thrustOgPreset, thrustPreset, mastodonPreset, stegodonPreset, phiomiaPreset, loxodonPreset]) {
    const bp = make(level);
    if (ONLY && !ONLY.includes(bp.name)) continue;
    it(`UNITS-002 ${bp.name}`, () => {
      const r = proof(withBlueprint(level, bp), Number(process.env.UNITS_STEPS ?? 480));
      expect(r.untagged).toEqual([]);
      expect(r.diff).toBe("");
    }, 600_000);
  }
});
