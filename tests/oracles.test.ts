// Physics oracles (§6.3) and starter-scenario sweeps (SCN-009): each scenario's
// assertions encode the closed-form answer, so running it across many parameter
// values checks the physics against independent formulas.
import fc from "fast-check";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario, runScenario } from "../src/core/index.ts";
import { readJson, ROOT } from "./helpers.ts";

const load = (name: string) => readJson(join(ROOT, "scenarios", `${name}.json`));
const failures = (name: string, values: Record<string, number> = {}) =>
  runScenario(parseScenario(load(name), values))
    .assertions.filter((a) => !a.pass)
    .map((a) => `#${a.index} ${a.kind}: ${a.message}`);

describe("SC-01 elastic collision of two discs", () => {
  it("ORC-002 RS-01 defaults: A leaves at −2.5 m/s and B at +0.5 m/s", () => {
    const r = runScenario(parseScenario(load("sc01-elastic-collision")));
    expect(r.passed).toBe(true);
    expect(r.probes.vax.at(-1)).toBeCloseTo(-2.5, 12);
    expect(r.probes.vbx.at(-1)).toBeCloseTo(0.5, 12);
  });

  it("SCN-009 ORC-002 sweep: masses, speeds, restitution and offset all match the closed form", () => {
    fc.assert(
      fc.property(
        fc.record({
          mA: fc.double({ min: 0.1, max: 100, noNaN: true }),
          mB: fc.double({ min: 0.1, max: 100, noNaN: true }),
          vA: fc.double({ min: 0.5, max: 20, noNaN: true }),
          vB: fc.double({ min: -20, max: -0.5, noNaN: true }),
          e: fc.double({ min: 0, max: 1, noNaN: true }),
          offset: fc.double({ min: 0, max: 0.9, noNaN: true }),
        }),
        (values) => {
          expect(failures("sc01-elastic-collision", values)).toEqual([]);
        },
      ),
      { numRuns: 40, seed: 101 },
    );
  });
});

describe("RS-02 rod hit off-centre", () => {
  it("ORC-003 COL-003 defaults: linear and angular velocity match the impulse equations", () => {
    expect(failures("rs02-off-centre-impact")).toEqual([]);
  });

  it("SCN-009 ORC-003 sweep over offset, restitution and speed", () => {
    fc.assert(
      fc.property(
        fc.record({ d: fc.double({ min: 0, max: 0.9, noNaN: true }), e: fc.double({ min: 0, max: 1, noNaN: true }), v: fc.double({ min: 1, max: 10, noNaN: true }) }),
        (values) => {
          expect(failures("rs02-off-centre-impact", values)).toEqual([]);
        },
      ),
      { numRuns: 30, seed: 202 },
    );
  });
});

describe("RS-03 bullet against a thin wall", () => {
  it("COL-004 a bullet at limit.maxSpeed never passes a wall limit.minThickness thick", () => {
    expect(failures("rs03-bullet-thin-wall")).toEqual([]);
  });

  it("COL-004 PHY-002 sweep over speed and restitution", () => {
    fc.assert(
      fc.property(fc.record({ speed: fc.double({ min: 10, max: 2000, noNaN: true }), e: fc.double({ min: 0, max: 1, noNaN: true }) }), (values) => {
        expect(failures("rs03-bullet-thin-wall", values)).toEqual([]);
      }),
      { numRuns: 30, seed: 303 },
    );
  });
});

describe("RS-04 box stack", () => {
  it("COL-005 five boxes settle with under tol.penetration overlap and stay still", () => {
    expect(failures("rs04-box-stack")).toEqual([]);
  });
});

describe("parameters", () => {
  it("SCN-008 a scenario's parameters have defaults, units and ranges, and out-of-range values are rejected", () => {
    const scn = parseScenario(load("sc01-elastic-collision"));
    expect(scn.parameters?.map((p) => p.id)).toEqual(["mA", "mB", "vA", "vB", "e", "offset"]);
    expect(scn.values).toEqual({ mA: 1, mB: 3, vA: 2, vB: -1, e: 1, offset: 0 });
    expect(scn.world.bodies[0].mass).toBe(1);
    expect(parseScenario(load("sc01-elastic-collision"), { mA: 7 }).world.bodies[0].mass).toBe(7);
    expect(() => parseScenario(load("sc01-elastic-collision"), { mA: 1000 })).toThrow(/values\.mA: must be within 0\.1\.\.100/);
    expect(() => parseScenario(load("sc01-elastic-collision"), { nope: 1 })).toThrow(/unknown parameter "nope"/);
  });

  it("SCN-008 an unknown {$param} reference is reported with its path", () => {
    const raw = load("sc01-elastic-collision") as Record<string, unknown>;
    const bad = JSON.parse(JSON.stringify(raw).replace('{"$param":"mB"}', '{"$param":"mZ"}'));
    expect(() => parseScenario(bad)).toThrow(/\$\.world\.bodies\[1\]\.mass: unknown parameter "mZ"/);
  });

  it("SCN-010 starter scenarios declare what to look for, overlays and graphs", () => {
    for (const name of ["sc01-elastic-collision", "rs02-off-centre-impact", "rs03-bullet-thin-wall", "rs04-box-stack"]) {
      const scn = parseScenario(load(name));
      expect(scn.ui?.lookFor?.length, name).toBeGreaterThan(40);
      expect(scn.ui?.graphs?.length, name).toBeGreaterThan(0);
      for (const g of scn.ui!.graphs!) expect(scn.probes.map((p) => p.id), `${name} graph ${g}`).toContain(g);
    }
  });
});
