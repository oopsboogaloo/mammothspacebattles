// GPU gas Phase 0 (docs/gpu-gas-plan.md): the budget estimate and the reference battle scene.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import baseline from "../../docs/perf/reference-battle-baseline.json";
import { estimate, estimateFused, restFactor, substepUs } from "../../src/app/gpu/estimate.ts";
import { sharedBytes } from "../../src/app/gpu/fused.ts";
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

describe("GPU gas budget estimate, one work-group per cluster (Spike 2)", () => {
  it("times a step by the largest cluster, at 1×, 2× and 4× detail, from the runs with as many clusters as the battle", () => {
    const c = baseline.steady.clusters;
    expect(c.count).toBeGreaterThanOrEqual(4);
    expect(c.sizes[0]).toBeGreaterThan(c.sizes[1]);
    const ms = [
      // Runs with one cluster are ignored when runs with enough clusters exist.
      { n: 250, clusters: 1, wgs: 256, us: 1 },
      { n: 250, clusters: 10, wgs: 256, us: 20 },
      { n: 250, clusters: 10, wgs: 1024, us: 10 },
      { n: 3000, clusters: 10, wgs: 256, us: 40 },
      { n: 3000, clusters: 10, wgs: 1024, us: 80 },
    ];
    const e = estimateFused(baseline, ms)!;
    expect(e.measuredClusters).toBe(10);
    expect(e.details.map((d) => d.detail)).toEqual([1, 2, 4]);
    const d4 = e.details[2];
    expect(d4.biggest).toBe(4 * c.sizes[0]);
    expect(d4.substeps).toBeCloseTo(2 * baseline.steady.substeps);
    // The faster work-group size at each cluster size: 10 µs at 250, 40 µs at 3,000.
    expect(d4.usPerSubstep).toBeCloseTo(10 + ((d4.biggest - 250) * 30) / 2750);
    expect(d4.gasMs).toBeCloseTo((d4.substeps * d4.usPerSubstep * e.restFactor) / 1000);
    expect(d4.go.laptop).toBe(d4.gasMs <= 1000 / 240 / 4);
  });

  it("leaves out runs that failed (a refused kernel times as nothing)", () => {
    const e = estimateFused(baseline, [
      { n: 250, clusters: 5, wgs: 256, us: 150 },
      { n: 250, clusters: 5, wgs: 1024, us: NaN },
      { n: 250, clusters: 5, wgs: 1024, us: 0 },
    ])!;
    // Only the good row counts: 150 µs at 250 parcels, scaled to the largest cluster.
    expect(e.details[0].usPerSubstep).toBeCloseTo((150 * baseline.steady.clusters.sizes[0]) / 250);
    expect(estimateFused(baseline, [{ n: 250, clusters: 5, wgs: 1024, us: NaN }])).toBeNull();
  });

  it("gives no estimate before any run", () => {
    expect(estimateFused(baseline, [])).toBeNull();
  });
});

describe("Spike 2b work-group memory", () => {
  it("the battle's largest cluster at 4× detail fits 32 KB (Apple's limit) at 1,024 threads; 3,000 parcels does not", () => {
    const biggest = 4 * baseline.steady.clusters.sizes[0];
    const table = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 1024)));
    expect(sharedBytes(1024, biggest, table(biggest))).toBeLessThanOrEqual(32 * 1024);
    expect(sharedBytes(1024, 3000, table(3000))).toBeGreaterThan(32 * 1024);
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
