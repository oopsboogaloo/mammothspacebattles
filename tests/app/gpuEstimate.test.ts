// GPU gas Phase 0 (docs/gpu-gas-plan.md): the budget estimate and the reference battle scene.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "../../docs/perf/reference-battle-baseline.json";
import { estimate, restFactor, substepUs } from "../../src/app/gpu/estimate.ts";
import { initialWorld, parseScenario } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

describe("GPU gas budget estimate", () => {
  it("interpolates substep time between sizes, flat below the smallest, along the last slope above", () => {
    const ms = [
      { n: 10000, fullUs: 200 },
      { n: 1000, fullUs: 50 },
      { n: 4000, fullUs: 80 },
    ];
    expect(substepUs(ms, 500)).toBe(50);
    expect(substepUs(ms, 2500)).toBeCloseTo(65);
    expect(substepUs(ms, 7000)).toBeCloseTo(140);
    expect(substepUs(ms, 16000)).toBeCloseTo(320);
  });

  it("full gas costs the CPU's ratio of all gas phases (clusters aside) to the spike's", () => {
    const p = baseline.steady.phasesMs;
    expect(restFactor(baseline)).toBeCloseTo((p.gas - p["gas.clusters"]) / (p["gas.neighbours"] + p["gas.density"] + p["gas.impulses"] + p["gas.move"]));
  });

  it("4× detail is 4× the parcels and 2× the substeps; the verdict compares the peak with ½ and ¼ of a 1/240 s step", () => {
    const fast = estimate(baseline, [{ n: 1000, fullUs: 1 }]);
    expect(fast.parcels).toBe(4 * baseline.steady.parcels);
    expect(fast.substeps).toBeCloseTo(2 * baseline.steady.substeps);
    expect(fast.budgetMs.phone).toBeCloseTo(1000 / 240 / 2);
    expect(fast.budgetMs.laptop).toBeCloseTo(1000 / 240 / 4);
    expect(fast.go).toEqual({ phone: true, laptop: true });
    expect(fast.maxParcels.laptop).toBeGreaterThan(fast.parcelsPeak);
    // 100 µs a substep at any size: far over either budget, and no parcels fit.
    const slow = estimate(baseline, [{ n: 1000, fullUs: 100 }, { n: 4000, fullUs: 100 }]);
    expect(slow.go).toEqual({ phone: false, laptop: false });
    expect(slow.gasMs).toBeCloseTo((slow.substeps * 100 * slow.restFactor) / 1000);
  });
});

describe("reference battle", () => {
  const scn = parseScenario(readJson(join(ROOT, "scenarios", "reference-battle.json")));
  it("has four ships, the Mammoth among them, every engine on the left and right channels, fired at step 0", () => {
    const w = initialWorld(scn);
    const engines = w.bodies.filter((b) => b.injector && w.links.some((l) => l.kind === "control" && l.to === b.id && (l.channel === "left" || l.channel === "right")));
    expect(new Set(engines.map((b) => b.id.split("-")[0]))).toEqual(new Set(["mam", "gs3", "gs2", "fly"]));
    expect(engines.filter((b) => b.id.startsWith("mam-"))).toHaveLength(4);
    expect(scn.timeline[0].commands).toEqual([
      { type: "control.set", channel: "left", value: 1 },
      { type: "control.set", channel: "right", value: 1 },
    ]);
    // Two armed shells and four rubble asteroids.
    expect(w.bodies.filter((b) => b.explosive)).toHaveLength(2);
    expect(scn.world.asteroids).toHaveLength(4);
  });
});
