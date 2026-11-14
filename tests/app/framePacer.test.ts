// Frame pacing (framePacer.ts): half rate and lighter drawing while frames run long, back once there's room.
import { describe, expect, it } from "vitest";
import { FramePacer } from "../../src/app/framePacer.ts";

/** Runs the pacer over rAF callbacks every `every` ms for `seconds`, each drawn frame's work `work` ms. */
function run(p: FramePacer, start: number, every: number, seconds: number, work: number) {
  let t = start;
  let drawn = 0;
  let skipped = 0;
  while (t < start + seconds * 1000) {
    const pace = p.frame(t);
    if (pace.skip) skipped++;
    else {
      drawn++;
      p.done(work);
    }
    t += every;
  }
  return { t, drawn, skipped };
}

describe("frame pacing", () => {
  it("PRF at 60 fps it draws every frame; long frames (25 fps) for over a second drop it to half rate, lighter", () => {
    const p = new FramePacer();
    const fast = run(p, 0, 1000 / 60, 3, 4);
    expect(fast.skipped).toBe(0);
    expect(p.half).toBe(false);
    const slow = run(p, fast.t, 40, 3, 30);
    expect(p.half).toBe(true);
    expect(slow.skipped).toBeGreaterThan(0);
    expect(p.frame(slow.t + 40).lite || p.frame(slow.t + 80).lite).toBe(true);
  });

  it("PRF at half rate it draws every other frame, and goes back to full once 30 fps is held with work to spare for 3 s", () => {
    const p = new FramePacer();
    run(p, 0, 40, 3, 30);
    expect(p.half).toBe(true);
    // The device catches up: rAF at 60 Hz, little work a frame.
    const half = run(p, 10_000, 1000 / 60, 1, 3);
    expect(Math.abs(half.drawn - half.skipped)).toBeLessThanOrEqual(1);
    run(p, 11_000, 1000 / 60, 4, 3);
    expect(p.half).toBe(false);
    // Still heavy at half rate: it stays there.
    const q = new FramePacer();
    run(q, 0, 40, 3, 30);
    run(q, 10_000, 1000 / 60, 6, 14);
    expect(q.half).toBe(true);
  });
});
