// A blueprint ship's wiring (docs/blueprint/spec.md §10; src/core/mixer.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorld, getProfile, initialWorld, mixerValues, parseScenario, ScenarioError, steerMixer, steerValues, stepInPlace, type Mixer } from "../../src/core/index.ts";

const thrust = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");

describe("mixer", () => {
  it("BPD-010 the Thrust ship's steering mix, as mixer lines, gives the same engine values as steerValues for every combination of controls", () => {
    const steer = thrust.world.thrust.mix;
    const m = steerMixer(steer);
    const steps = [0, 0.25, 0.4, 0.5, 0.75, 1];
    let n = 0;
    for (const forward of steps)
      for (const left of steps)
        for (const right of steps)
          for (const reverse of steps) {
            const c = { forward, left, right, reverse };
            const want = steerValues(steer, c);
            const got = mixerValues(m, c);
            for (const ch of Object.keys(want)) expect(got[ch]).toBeCloseTo(want[ch], 12);
            n++;
          }
    expect(n).toBe(6 ** 4);
  });

  it("BPD-011 lines: the largest wins by default, or the sum (up to 1), or the least; weights scale; eased lines fall with their easing control; a limit caps the row", () => {
    const m: Mixer = {
      rows: [
        { channel: "a", lines: [{ control: "x", weight: 0.5 }, { control: "y", weight: 1, ease: { control: "z", amount: 0.5 } }] },
        { channel: "b", combine: "sum", lines: [{ control: "x", weight: 0.75 }, { control: "y", weight: 0.75 }] },
        { channel: "c", combine: "min", lines: [{ control: "x", weight: 1 }, { control: "y", weight: 0.5 }] },
        { channel: "d", limit: 0.3, lines: [{ control: "x", weight: 1 }] },
        { channel: "e", lines: [] },
      ],
    };
    expect(mixerValues(m, { x: 1, y: 1, z: 1 })).toEqual({ a: 0.5, b: 1, c: 0.5, d: 0.3, e: 0 });
    expect(mixerValues(m, { x: 0, y: 0.8, z: 0 })).toEqual({ a: 0.8, b: 0.6000000000000001, c: 0, d: 0, e: 0 });
    // Controls outside 0..1 are clamped.
    expect(mixerValues(m, { x: 5, y: -2 }).d).toBe(0.3);
  });

  it("BPD-011 opposites: held together they cancel, and what they share counts as the third control", () => {
    const m: Mixer = {
      rules: [{ opposites: ["l", "r"], both: "f" }],
      rows: [
        { channel: "L", lines: [{ control: "l", weight: 1 }] },
        { channel: "R", lines: [{ control: "r", weight: 1 }] },
        { channel: "F", lines: [{ control: "f", weight: 1 }] },
      ],
    };
    expect(mixerValues(m, { l: 1, r: 1 })).toEqual({ L: 0, R: 0, F: 1 });
    expect(mixerValues(m, { l: 1, r: 0.25 })).toEqual({ L: 0.75, R: 0, F: 0.25 });
  });

  it("BPD-011 in the world: the controls held set the driven channels each step, before the physics", () => {
    const w = createWorld(1, [], { x: 0, y: 0 }, { mix: steerMixer(thrust.world.thrust.mix) });
    stepInPlace(w, [{ type: "control.set", channel: "forward", value: 1 }, { type: "control.set", channel: "right", value: 1 }], sandbox);
    expect(["main", "bl", "br", "fl", "fr"].map((c) => w.controls[c] ?? 0)).toEqual([1, 1, 0, 0, 0.5]);
  });

  it("BPD-011 a scenario carries a mix, and a bad one is refused with where it is wrong", () => {
    const scn = { schema: 1, name: "mix", profile: "sandbox", seed: 1, world: { bodies: [], mix: steerMixer(thrust.world.thrust.mix) }, timeline: [], end: { steps: 1 }, probes: [], assertions: [] };
    expect(initialWorld(parseScenario(scn)).mix?.rows.length).toBe(5);
    const bad = structuredClone(scn) as { world: { mix: { rows: { channel: string; combine?: string; lines: { weight: number }[] }[] } } };
    bad.world.mix.rows[1].channel = "main";
    bad.world.mix.rows[2].lines[0].weight = 2;
    bad.world.mix.rows[3].combine = "avg";
    let paths: string[] = [];
    try {
      parseScenario(bad);
    } catch (e) {
      paths = (e as ScenarioError).errors.map((x) => x.path);
    }
    expect(paths).toEqual(["$.world.mix.rows[1].channel", "$.world.mix.rows[2].lines[0].weight", "$.world.mix.rows[3].combine"]);
  });
});
