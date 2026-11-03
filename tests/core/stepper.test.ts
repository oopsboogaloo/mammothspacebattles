import { describe, expect, it } from "vitest";
import { advanceStepper, createStepper } from "../../src/core/index.ts";

const dt = 1 / 240;

function run(frameSeconds: number, totalSeconds: number, timeScale = 1, maxStepsPerFrame = 1000) {
  const s = createStepper();
  let steps = 0;
  const frames = Math.round(totalSeconds / frameSeconds);
  for (let i = 0; i < frames; i++) steps += advanceStepper(s, frameSeconds, { timestep: dt, timeScale, maxStepsPerFrame }).steps;
  return steps;
}

describe("fixed-step accumulator", () => {
  it("ARC-006 the number of fixed steps does not depend on frame rate", () => {
    expect(run(1 / 60, 10)).toBe(2400);
    expect(run(1 / 144, 10)).toBeGreaterThanOrEqual(2399);
    expect(run(1 / 144, 10)).toBeLessThanOrEqual(2400);
    expect(run(1 / 30, 10)).toBe(2400);
  });

  it("ARC-006 time scale changes the step count, never the step length", () => {
    expect(run(1 / 60, 1, 4)).toBe(960);
    expect(run(1 / 60, 1, 1 / 16)).toBe(15);
  });

  it("ARC-006 when capped, it reports the achieved scale instead of silently catching up", () => {
    const s = createStepper();
    const r = advanceStepper(s, 1, { timestep: dt, timeScale: 1, maxStepsPerFrame: 40 });
    expect(r.steps).toBe(40);
    expect(r.fellBehind).toBe(true);
    expect(r.achievedScale).toBeCloseTo(40 / 240, 12);
    expect(s.accumulator).toBe(0);
  });

  it("ARC-006 zero or negative frame time runs no steps", () => {
    const s = createStepper();
    expect(advanceStepper(s, 0, { timestep: dt, timeScale: 1, maxStepsPerFrame: 40 }).steps).toBe(0);
    expect(advanceStepper(s, -1, { timestep: dt, timeScale: 1, maxStepsPerFrame: 40 }).steps).toBe(0);
  });
});
