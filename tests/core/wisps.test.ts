// The plume's tail (GAS-011): gas gone from the gas model fades out as wisps that still bounce.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWorld, getProfile, parseScenario, initialWorld, spawnWisps, stepInPlace, stepWisps, wispMass, wispRadius, WISP_GROW, WISP_LIFE, type Parcel } from "../../src/core/index.ts";
import { box, readJson, ROOT } from "../helpers.ts";

const parcel = (x: number, vx: number): Parcel => ({ id: 1, mass: 0.004, composition: { h2o: 1 }, position: { x, y: 0 }, velocity: { x: vx, y: 0 }, thermal: 1, radius: 0.035 }) as Parcel;

describe("plume tail (GAS-011)", () => {
  it("GAS-011 a wisp moves on, grows and fades out over its life, its mass fading with it", () => {
    const w = createWorld(1, []);
    spawnWisps(w, [parcel(0, 10)], () => 1500);
    const wp = w.wisps![0];
    for (let i = 0; i < 120; i++) stepWisps(w, 1 / 240);
    expect(wp.position.x).toBeCloseTo(5, 6);
    expect(wispMass(wp)).toBeCloseTo(0.002, 6);
    expect(wispRadius(wp)).toBeCloseTo(0.035 * (1 + (WISP_GROW - 1) / 2), 6);
    for (let i = 0; i < 240 * WISP_LIFE; i++) stepWisps(w, 1 / 240);
    expect(w.wisps).toEqual([]);
  });

  it("GAS-011 wisps bounce off a body and push it, with the push recorded as coming in through the boundary", () => {
    const w = createWorld(1, [box("plate", 0.2, 4, { mass: 1, position: { x: 2, y: 0 } } as never)]);
    spawnWisps(w, Array.from({ length: 50 }, (_, i) => ({ ...parcel(0, 20), id: i, position: { x: 0, y: -1 + i * 0.04 } })), () => 1500);
    for (let i = 0; i < 60; i++) stepInPlace(w, [], getProfile("test"));
    const plate = w.bodies[0];
    expect(plate.velocity.x).toBeGreaterThan(0);
    expect(w.wisps!.every((x) => x.velocity.x < 0)).toBe(true); // all bounced back
    expect(w.ledger.violations).toBe(0);
    // Each wisp gave at most (1 + e) m v.
    expect(plate.velocity.x).toBeLessThan((1.3 * 50 * 0.004 * 20) / 1);
  });

  it("GAS-011 a gunship's exhaust leaves a tail of wisps that fades out within a second of the engines stopping, ledger clean", () => {
    const raw = readJson(join(ROOT, "scenarios", "gunship-2.json")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    Object.assign(raw, { timeline: [], probes: [], assertions: [] });
    const w = initialWorld(parseScenario(raw));
    const sandbox = getProfile("sandbox");
    const on = [{ type: "control.set" as const, channel: "left", value: 1 }, { type: "control.set" as const, channel: "right", value: 1 }];
    stepInPlace(w, on, sandbox);
    let most = 0;
    for (let i = 0; i < 240; i++) {
      stepInPlace(w, [], sandbox);
      most = Math.max(most, w.wisps?.length ?? 0);
    }
    expect(most).toBeGreaterThan(100);
    stepInPlace(w, [{ type: "control.set", channel: "left", value: 0 }, { type: "control.set", channel: "right", value: 0 }], sandbox);
    for (let i = 0; i < 240 * (WISP_LIFE + 0.5); i++) stepInPlace(w, [], sandbox);
    expect(w.wisps?.length ?? 0).toBeLessThan(0.05 * most);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});
