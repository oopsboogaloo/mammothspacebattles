// Weld sizes by ship size (BPD-055; Chloe, 17 November 2026): a minimum number of parts before
// Standard welds, and more before Heavy.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { capWelds, component, loxodonPreset, mastodonPreset, maxWeld, phiomiaPreset, removeComponent, setWeld, stegodonPreset, thrustOgPreset, thrustPreset, weldPresetOpen, weldPresetsFor, welds, type Blueprint } from "../../src/app/blueprint/model.ts";
import { maxWeldQuality, WELD_K, WELD_UNLOCK } from "../../src/app/blueprint/rules.ts";

const level = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
const qualities = (bp: Blueprint) =>
  welds(bp)
    .filter((w) => !component(bp, w.a).part?.endsWith("_og") && !component(bp, w.b).part?.endsWith("_og"))
    .flatMap((w) => w.joints.map((j) => j.limits!.tension! / (WELD_K.tension * Math.min(component(bp, w.a).wall ?? 0.1, component(bp, w.b).wall ?? 0.1))));

describe("weld sizes by ship size (BPD-055)", () => {
  it("BPD-055 under 8 parts a ship may use Light welds only; from 8, Standard; from 15, Heavy", () => {
    expect(WELD_UNLOCK).toEqual({ standard: 8, heavy: 15 });
    expect([1, 7, 8, 14, 15, 30].map(maxWeldQuality)).toEqual([0.5, 0.5, 1, 1, 2, 2]);
    const phi = phiomiaPreset(level); // 6 parts
    expect(maxWeld(phi)).toBe(0.5);
    expect(weldPresetOpen(phi, 1)).toEqual({ open: false, why: "Needs a ship of 8 parts or more (this one has 6)" });
    expect(weldPresetOpen(phi, 2).why).toBe("Needs a ship of 15 parts or more (this one has 6)");
    expect(weldPresetOpen(thrustPreset(level), 2).open).toBe(true); // 17 parts
  });

  it("BPD-055 every preset keeps to it: the Phiomia and Loxodon are Light, the Stegodon Light by choice, THRUST 1 and the Mastodon Standard; THRUST OG's welds are its own", () => {
    for (const make of [phiomiaPreset, loxodonPreset, stegodonPreset, thrustPreset, mastodonPreset]) {
      const bp = make(level);
      expect(capWelds(bp).cut, bp.name).toEqual([]);
      for (const q of qualities(bp)) expect(q, bp.name).toBeLessThanOrEqual(maxWeld(bp) + 1e-9);
    }
    expect(new Set(qualities(loxodonPreset(level)).map((q) => Math.round(q * 100) / 100))).toEqual(new Set([0.5]));
    expect(qualities(thrustOgPreset(level))).toEqual([]);
    expect(capWelds(thrustOgPreset(level)).cut).toEqual([]);
  });

  it("BPD-055 a weld stronger than the ship may use steps down to the strongest allowed: a Heavy weld on THRUST 1 becomes Standard when it drops under 15 parts; a Standard one on the Phiomia, Light", () => {
    let t1 = thrustPreset(level);
    const w = welds(t1).find((x) => x.id === "battery|main")!;
    t1 = setWeld(t1, w.id, weldPresetsFor(t1, w.id)[2].limits); // Heavy: allowed at 17 parts
    expect(capWelds(t1).cut).toEqual([]);
    for (const id of ["tractor", "tether", "shield"]) t1 = removeComponent(t1, id);
    expect(t1.components.length).toBe(14);
    const { bp, cut } = capWelds(t1);
    expect(cut).toEqual([`${component(t1, "battery").label} ↔ ${component(t1, "main").label}`]);
    expect(welds(bp).find((x) => x.id === w.id)!.joints[0].limits!.tension).toBeCloseTo(WELD_K.tension * 0.1, 6);
    let phi = phiomiaPreset(level);
    const pw = welds(phi)[0];
    phi = setWeld(phi, pw.id, weldPresetsFor(phi, pw.id)[1].limits);
    expect(capWelds(phi).cut.length).toBe(1);
    expect(qualities(capWelds(phi).bp).every((q) => Math.abs(q - 0.5) < 1e-9)).toBe(true);
  });
});
