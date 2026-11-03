import fc from "fast-check";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { getProfile, parseScenario, runScenario, type Command, type Scenario } from "../src/core/index.ts";
import { disc, readJson, scenarioFiles } from "./helpers.ts";

const files = scenarioFiles();

describe("scenario files", () => {
  it("there is at least the empty M0 scenario", () => {
    expect(files.map((f) => basename(f))).toContain("empty.json");
  });

  for (const file of files) {
    describe(basename(file), () => {
      it("SCN-004 validates and every assertion passes", () => {
        const result = runScenario(parseScenario(readJson(file)));
        const failed = result.assertions.filter((a) => !a.pass).map((a) => `#${a.index} ${a.kind}: ${a.message}`);
        expect(failed).toEqual([]);
      });

      it("DET-001 two runs give identical hashes after every step", () => {
        const scn = parseScenario(readJson(file));
        // Gas scenarios hash every parcel each step; their first 40 steps cover the gas phase fully.
        const steps = scn.world.gas?.length ? Math.min(40, scn.end.steps) : scn.end.steps;
        const a = runScenario(scn, { recordHashes: true, steps });
        const b = runScenario(scn, { recordHashes: true, steps });
        expect(a.hashes!.length).toBe(steps + 1);
        expect(b.hashes).toEqual(a.hashes);
      }, 30_000); // RS-00 hashes a 200-body world every step, twice: slow on CI runners under coverage
    });
  }
});

describe("determinism over random scenarios", () => {
  const command: fc.Arbitrary<Command> = fc.oneof(
    fc.record({ type: fc.constant("rng.sample" as const), label: fc.string({ minLength: 1, maxLength: 3 }) }),
    fc.record({ type: fc.constant("body.add" as const), body: fc.string({ minLength: 1, maxLength: 3 }).map((id) => disc(id)) }),
  );

  it("DET-001 ARC-004 any seed and command timeline replays identically", () => {
    fc.assert(
      fc.property(fc.integer(), fc.array(fc.tuple(fc.nat(19), command), { maxLength: 15 }), (seed, entries) => {
        // Drop duplicate body ids so every generated scenario is valid.
        const seen = new Set<string>();
        const timeline = entries
          .filter(([, c]) => c.type !== "body.add" || (!seen.has(c.body.id) && (seen.add(c.body.id), true)))
          .map(([step, c]) => ({ step, commands: [c] }));
        const scn: Scenario = parseScenario({
          schema: 1,
          name: "random",
          profile: "test",
          seed,
          world: { bodies: [] },
          timeline,
          end: { steps: 20 },
          probes: [{ id: "n", path: "events.length" }],
          assertions: [],
        });
        const a = runScenario(scn, { recordHashes: true });
        const b = runScenario(scn, { recordHashes: true });
        expect(b.hashes).toEqual(a.hashes);
        expect(b.probes).toEqual(a.probes);
      }),
      { numRuns: 200 },
    );
  });

  it("DET-001 different seeds produce different results when randomness is used", () => {
    const make = (seed: number) =>
      parseScenario({
        schema: 1,
        name: "seeded",
        profile: "test",
        seed,
        world: { bodies: [] },
        timeline: [{ step: 0, commands: [{ type: "rng.sample", label: "x" }] }],
        end: { steps: 1 },
        probes: [],
        assertions: [],
      });
    expect(runScenario(make(1)).finalHash).not.toBe(runScenario(make(2)).finalHash);
  });

  it("the test profile is the one scenarios use by default", () => {
    expect(getProfile("test").timestep).toBe(1 / 240);
  });
});
