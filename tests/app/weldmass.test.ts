// Welds weigh something (BPD-054; Chloe, 17 November 2026: "they shouldn't be free").
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dropTest } from "../../src/app/blueprint/droptest.ts";
import { measureWorld } from "../../src/app/blueprint/measure.ts";
import { body, component, phiomiaPreset, stats, stegodonPreset, thrustOgPreset, thrustPreset, wallOf, weldMasses, welds, WELD_PRESETS, type Blueprint } from "../../src/app/blueprint/model.ts";
import { WELD_K, weldLimits, weldPointMass } from "../../src/app/blueprint/rules.ts";
import { inCoreUnits } from "../helpers.ts";

const level = inCoreUnits(JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8")));
const total = (bp: Blueprint) => [...weldMasses(bp).values()].reduce((a, m) => a + m, 0);

describe("weld mass (BPD-054)", () => {
  it("BPD-054 a weld point is a fillet bead of the walls' own material: strength with its size, mass with its square", () => {
    expect(weldPointMass(0.1, 1)).toBeCloseTo(0.0341, 4); // Standard
    expect(weldPointMass(0.1, 0.5)).toBeCloseTo(weldPointMass(0.1, 1) / 4, 12); // Light: half the strength, a quarter of the metal
    expect(weldPointMass(0.1, 2)).toBeCloseTo(weldPointMass(0.1, 1) * 4, 12); // Heavy
    expect(weldPointMass(0.05, 1)).toBeCloseTo(weldPointMass(0.1, 1) / 4, 12); // thinner walls, a smaller bead
    expect(weldLimits(0.1, 1).tension).toBe(WELD_K.tension * 0.1);
    expect(WELD_PRESETS.map((p) => p.quality)).toEqual([0.5, 1, 2]);
  });

  it("BPD-054 the welds between parts add their mass to the ship, in the designer and in the physics, half on each part; welds inside a part and on OG parts are free", () => {
    const t1 = thrustPreset(level);
    // All Standard, each on the thinner of the walls it joins (0.1 m, or the small magazines' 0.078 m).
    const thinner = (bp: Blueprint, w: { a: string; b: string }) => Math.min(wallOf(component(bp, w.a)), wallOf(component(bp, w.b)));
    expect(total(t1)).toBeCloseTo(welds(t1).reduce((m, w) => m + w.joints.length * weldPointMass(thinner(t1, w), 1), 0), 9);
    expect(total(t1)).toBeGreaterThan(1);
    // In the physics: each body heavier by its share.
    const w = measureWorld(t1);
    const hull = w.bodies.find((b) => b.id === "hull")!;
    expect(hull.mass).toBeCloseTo(body(t1, "hull").mass + weldMasses(t1).get("hull")!, 9);
    expect(stats(t1).mass).toBeCloseTo(w.bodies.reduce((a, b) => a + b.mass + (b.contents ?? []).reduce((s, c) => s + c.mass, 0) + (b.ammo ? b.ammo.count * b.ammo.shell.mass : 0) + (b.magazine ? b.magazine.count * b.magazine.shell.mass : 0), 0), 6);
    // THRUST OG: free.
    expect(total(thrustOgPreset(level))).toBe(0);
    expect(stats(thrustOgPreset(level)).mass).toBeCloseTo(61.2, 1);
  });

  it("BPD-054 the Phiomia and the Stegodon have Light welds between their parts, and dropped they lose some of them (THRUST 1's Standard ones hold)", () => {
    for (const make of [phiomiaPreset, stegodonPreset]) {
      const bp = make(level);
      for (const w of welds(bp)) for (const j of w.joints) expect(j.limits!.tension, `${bp.name} ${w.id}`).toBeCloseTo(weldLimits(Math.min(component(bp, w.a).wall ?? 0.1, component(bp, w.b).wall ?? 0.1), 0.5).tension, 6);
      expect(dropTest(bp, level).welds.length, bp.name).toBeGreaterThan(0);
    }
    const t1 = thrustPreset(level);
    for (const w of welds(t1)) for (const j of w.joints) expect(j.limits!.tension, w.id).toBeCloseTo(weldLimits(Math.min(wallOf(component(t1, w.a)), wallOf(component(t1, w.b))), 1).tension, 6);
  }, 120_000);
});
