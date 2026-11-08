import { describe, expect, it } from "vitest";
import { extrapolate, MAX_LEAD_S, nextShownTime, sourceOf } from "../../src/app/smooth.ts";
import { createWorld } from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

describe("smooth motion on screen", () => {
  it("ARC-006 the shown clock moves every frame while results come in bunches", () => {
    // Results every third frame, each 3 frames' worth: the shown time still moves on each frame.
    let shown = 0;
    let latest = 0;
    const dt = 1 / 60;
    const moves: number[] = [];
    for (let f = 1; f <= 120; f++) {
      if (f % 3 === 0) latest += 3 * dt;
      const next = nextShownTime(shown, latest, dt, 1);
      moves.push(next - shown);
      shown = next;
    }
    expect(Math.min(...moves.slice(30))).toBeGreaterThan(0.5 * dt);
    expect(Math.abs(shown - latest)).toBeLessThan(3 * dt);
  });

  it("ARC-006 the shown clock stays near the latest world, and starts afresh from a different run", () => {
    // A long stall: the shown time runs on, but no further than the limit.
    let shown = 5;
    for (let f = 0; f < 60; f++) shown = nextShownTime(shown, 5, 1 / 60, 1);
    expect(shown).toBeCloseTo(5 + MAX_LEAD_S);
    expect(nextShownTime(30, 0, 1 / 60, 1)).toBe(0); // a reset
  });

  it("ARC-006 the shown clock never runs backwards: ahead of the world, it waits for it", () => {
    // Ahead after a stall; the world comes in behind it.
    let shown = 5.08;
    for (let f = 0; f < 30; f++) {
      const next = nextShownTime(shown, 5, 1 / 60, 1);
      expect(next).toBeGreaterThanOrEqual(shown);
      shown = next;
    }
  });

  it("ARC-006 draws what moves carried on by its velocity, leaving the world itself alone", () => {
    const w = createWorld(1, [disc("a", { velocity: { x: 2, y: 0 }, angularVelocity: 1 }), box("floor", 4, 0.5, { fixed: true, position: { x: 0, y: -1 } })]);
    const s = extrapolate(w, 0.5);
    expect(s.bodies[0].position).toEqual({ x: 1, y: 0 });
    expect(s.bodies[0].angle).toBeCloseTo(0.5);
    expect(s.bodies[1]).toBe(w.bodies[1]);
    expect(w.bodies[0].position).toEqual({ x: 0, y: 0 });
    expect(sourceOf(s)).toBe(w);
    expect(extrapolate(w, 0)).toBe(w);
  });
});
