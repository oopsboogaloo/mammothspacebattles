// The gas substep and spinning bodies (§9.4): a body's surface moves at its speed plus its spin
// times its reach from its centre of mass. A fixed 50 m reach made a 7 cm shell fragment spinning
// at 4,000 rad/s read as 200 km/s, and every parcel took the 2,000-substep floor (reference battle,
// docs/perf/gpu-gas-phase0.md §1).
import { describe, expect, it } from "vitest";
import { computeTotals, createWorld, getProfile, stepInPlace, setParcels } from "../../src/core/index.ts";
import { box } from "../helpers.ts";

describe("gas substeps near a spinning body", () => {
  const test = getProfile("test");
  const world = (spin: number) => {
    // A 7 cm fragment spinning in a little cool gas.
    const w = createWorld(1, [box("frag", 0.07, 0.07, { mass: 0.033, angularVelocity: spin })], { x: 0, y: 0 }, { bounds: { min: { x: -50, y: -50 }, max: { x: 50, y: 50 } } }, test);
    setParcels(w.gas, Array.from({ length: 16 }, (_, i) => ({ id: i + 1, mass: 0.001, composition: { air: 1 }, position: { x: 0.12 + 0.07 * (i % 4), y: -0.1 + 0.07 * Math.floor(i / 4) }, velocity: { x: 0, y: 0 }, thermal: 0.001 * 717 * 300, radius: 0.035 })));
    w.gas.nextId = 17;
    w.ledger.totals = computeTotals(w);
    return w;
  };

  it("GAS-004 a fragment spinning at 4,000 rad/s sets the substep by its surface speed (about 200 m/s), not as if 50 m across", () => {
    const still = world(0);
    stepInPlace(still, [], test);
    const spinning = world(4000);
    stepInPlace(spinning, [], test);
    // Its corners move at 4,000 × 0.05 m = 200 m/s, about as fast as the gas's own signal: a handful
    // of substeps more than when still, nowhere near the floor.
    expect(spinning.gas.substeps).toBeLessThan(3 * Math.max(1, still.gas.substeps) + 10);
    expect(spinning.gas.substeps).toBeLessThan(100);
    expect(spinning.ledger.violations).toBe(0);
  });
});
