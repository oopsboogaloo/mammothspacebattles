// A cold parcel and its hot neighbours (§9.4): when a pair's push turns heat into motion, the heat
// comes from the parcels by their pressure, not by their share of the impulse. Charged by the
// impulse, a cold parcel paid for its neighbour's push, went below zero at any substep, and the
// halving retries took step 155 of the reference battle to 413 substeps (574 ms), then clamped 11 J.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getProfile, initialWorld, parseScenario, stepInPlace, timelineByStep } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

describe("cold parcels under a hot neighbour's push", () => {
  it("GAS-004 the reference battle's first 160 steps each take under 100 substeps, with the ledger exact", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "reference-battle.json")));
    const prof = getProfile(scn.profile);
    const tl = timelineByStep(scn);
    const w = initialWorld(scn);
    let worst = 0;
    for (let s = 0; s < 160; s++) {
      stepInPlace(w, tl.get(s) ?? [], prof);
      worst = Math.max(worst, w.gas.substeps);
    }
    expect(worst).toBeLessThan(100);
    expect(w.ledger.violations).toBe(0);
  }, 120_000);
});
