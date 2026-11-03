import { describe, expect, it } from "vitest";
import {
  SCENARIO_SCHEMA,
  ScenarioError,
  evaluateFormula,
  migrateScenario,
  parseScenario,
  resolvePath,
  runScenario,
  type Assertion,
} from "../../src/core/index.ts";
import { baseScenario, disc } from "../helpers.ts";

function errorsOf(raw: unknown) {
  try {
    parseScenario(raw);
  } catch (e) {
    if (e instanceof ScenarioError) return e.errors;
    throw e;
  }
  return [];
}

describe("scenario format", () => {
  it("SCN-001 a scenario holds schema, profile, seed, world, timeline, end, probes and assertions", () => {
    const scn = parseScenario({
      ...baseScenario(),
      world: { bodies: [disc("a")] },
      timeline: [{ step: 2, commands: [{ type: "rng.sample", label: "x" }] }],
      assertions: [{ kind: "valueAt", probe: "tick", step: "end", equals: 10, tol: 0 }],
    });
    expect(Object.keys(scn).sort()).toEqual(["assertions", "end", "name", "probes", "profile", "schema", "seed", "timeline", "values", "world"]);
    expect(runScenario(scn).passed).toBe(true);
  });

  it("SCN-002 reports every error with its JSON path, not just the first", () => {
    const errs = errorsOf({
      schema: 1,
      name: "",
      profile: "nope",
      seed: 1.5,
      world: { bodies: [{ id: "a", shape: { kind: "box" }, mass: -1, position: { x: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 }] },
      timeline: [{ step: 99, commands: [{ type: "teleport" }] }],
      end: { steps: 10 },
      probes: [{ id: "p", path: "bodies[[" }],
      assertions: [{ kind: "valueAt", probe: "missing", step: 0, equals: 0, tol: -1 }, { kind: "formula", at: 0, left: "p +", right: "q", tol: 0 }],
    });
    const paths = errs.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "$.name",
        "$.profile",
        "$.seed",
        "$.world.bodies[0].shape.width",
        "$.world.bodies[0].shape.height",
        "$.world.bodies[0].mass",
        "$.world.bodies[0].position.y",
        "$.timeline[0].step",
        "$.timeline[0].commands[0].type",
        "$.probes[0].path",
        "$.assertions[0].probe",
        "$.assertions[0].tol",
        "$.assertions[1].left",
        "$.assertions[1].right",
      ]),
    );
    expect(errs.length).toBeGreaterThanOrEqual(14);
  });

  it("SCN-002 rejects duplicate body and probe ids and non-objects", () => {
    const paths = errorsOf({
      ...baseScenario(),
      world: { bodies: [disc("a"), disc("a")] },
      probes: [{ id: "p", path: "tick" }, { id: "p", path: "time" }],
    }).map((e) => e.path);
    expect(paths).toEqual(["$.world.bodies[1].id", "$.probes[1].id"]);
    expect(errorsOf([])).toEqual([{ path: "$", message: "must be a JSON object" }]);
  });

  it("SCN-002 the error message lists each path for people reading the CLI output", () => {
    expect(() => parseScenario({ ...baseScenario(), seed: "x" })).toThrow(/\$\.seed: must be a finite number/);
  });

  it("SCN-007 a scenario from a newer schema is rejected with a clear message", () => {
    expect(() => parseScenario({ ...baseScenario(), schema: SCENARIO_SCHEMA + 1 })).toThrow(/newer than this build supports/);
  });

  it("SCN-007 an older schema with no migration is rejected", () => {
    expect(() => parseScenario({ ...baseScenario(), schema: 0 })).toThrow(/no migration from schema 0/);
  });

  it("SCN-007 migrations are applied in order up to the current schema", () => {
    const old = { ...baseScenario(), schema: -1, title: "legacy" } as Record<string, unknown>;
    const migrations = {
      [-1]: (r: Record<string, unknown>) => ({ ...r, schema: 0, name: r.title }),
      0: (r: Record<string, unknown>) => {
        const { title: _drop, ...rest } = r;
        void _drop;
        return { ...rest, schema: 1 };
      },
    };
    const migrated = migrateScenario(old, migrations) as Record<string, unknown>;
    expect(migrated.schema).toBe(1);
    expect(migrated.name).toBe("legacy");
    expect(migrated).not.toHaveProperty("title");
    expect(parseScenario(migrated).name).toBe("legacy");
  });
});

describe("assertions", () => {
  const run = (assertions: Assertion[], extra: Record<string, unknown> = {}) =>
    runScenario(parseScenario({ ...baseScenario(), ...extra, assertions })).assertions;

  it("SCN-003 valueAt passes within tolerance and fails outside it", () => {
    const [ok, bad] = run([
      { kind: "valueAt", probe: "tick", step: 4, equals: 4, tol: 0 },
      { kind: "valueAt", probe: "tick", step: 4, equals: 5, tol: 0.5 },
    ]);
    expect(ok.pass).toBe(true);
    expect(bad.pass).toBe(false);
    expect(bad.message).toMatch(/tick@4 = 4\.00000, expected 5\.00000/);
  });

  it("SCN-003 rangeOver checks every tick in the interval", () => {
    const [ok, bad] = run([
      { kind: "rangeOver", probe: "tick", from: 0, to: "end", min: 0, max: 10 },
      { kind: "rangeOver", probe: "tick", from: 0, to: "end", max: 9 },
    ]);
    expect(ok.pass).toBe(true);
    expect(bad.pass).toBe(false);
    expect(bad.message).toMatch(/tick@10/);
  });

  it("SCN-003 event occurred / did not occur within a window", () => {
    const results = run(
      [
        { kind: "event", type: "rng.sample", occurred: true, from: 3, to: 3 },
        { kind: "event", type: "rng.sample", occurred: false, from: 4 },
        { kind: "event", type: "rng.sample", occurred: true, to: 2 },
      ],
      { timeline: [{ step: 3, commands: [{ type: "rng.sample", label: "x" }] }] },
    );
    expect(results.map((r) => r.pass)).toEqual([true, true, false]);
  });

  it("SCN-003 formula compares two expressions over probes, with @step and @end references", () => {
    const results = run(
      [
        { kind: "formula", at: "end", left: "time", right: "tick / 240", tol: 1e-12 },
        { kind: "formula", at: 5, left: "tick@end - tick@0", right: "2 * tick", tol: 0 },
        { kind: "formula", at: "end", left: "ln(tick)", right: "2.3", tol: 0.01, relative: true },
        { kind: "formula", at: "end", left: "tick", right: "11", tol: 0.5 },
      ],
      { probes: [{ id: "tick", path: "tick" }, { id: "time", path: "time" }] },
    );
    expect(results.map((r) => r.pass)).toEqual([true, true, true, false]);
  });

  it("SCN-003 LED-003 ledgerResidual passes for clean physics and fails when the ledger is bypassed", () => {
    const bodies = [disc("a", { velocity: { x: 1, y: 0 } })];
    const [clean] = run([{ kind: "ledgerResidual", quantity: "momentum", maxAbs: 1e-9 }], { world: { bodies } });
    expect(clean.pass).toBe(true);
    const [kicked] = run([{ kind: "ledgerResidual", quantity: "momentum", maxAbs: 1e-9 }], {
      world: { bodies },
      timeline: [{ step: 2, commands: [{ type: "debug.kick", id: "a", dv: { x: 0.5, y: 0 } }] }],
    });
    expect(kicked.pass).toBe(false);
    expect(kicked.message).toMatch(/largest momentum residual 0\.5/);
  });

  it("SCN-003 a probe that does not resolve to a number records NaN and fails its assertion", () => {
    const [r] = run([{ kind: "valueAt", probe: "gone", step: 0, equals: 0, tol: 1 }], { probes: [{ id: "gone", path: "bodies[id=zz].mass" }] });
    expect(r.pass).toBe(false);
    expect(r.message).toMatch(/NaN/);
  });
});

describe("formula language", () => {
  const lookup = (id: string, at: number | "here" | "end") => (id === "v" ? (at === "end" ? 10 : at === "here" ? 5 : Number(at)) : NaN);

  it("respects precedence, unary minus, powers and functions", () => {
    expect(evaluateFormula("1 + 2 * 3", lookup)).toBe(7);
    expect(evaluateFormula("(1 + 2) * 3", lookup)).toBe(9);
    expect(evaluateFormula("-2 ^ 2", lookup)).toBe(-4);
    expect(evaluateFormula("2 ^ 3 ^ 2", lookup)).toBe(512);
    expect(evaluateFormula("sqrt(16) + abs(-1) + min(2, 3) + max(2, 3)", lookup)).toBe(10);
    expect(evaluateFormula("v + v@end + v@3", lookup)).toBe(18);
    expect(evaluateFormula("1e3 * .5", lookup)).toBe(500);
  });

  it("rejects malformed input", () => {
    for (const bad of ["1 +", "(1", "1 2", "ln(1, 2)", "$", "1 )"]) expect(() => evaluateFormula(bad, lookup), bad).toThrow();
  });
});

describe("probe paths", () => {
  const world = { tick: 3, bodies: [{ id: "a", mass: 2, position: { x: 1 } }], events: [] };
  it("resolve keys, indexes and id selectors", () => {
    expect(resolvePath(world, "tick")).toBe(3);
    expect(resolvePath(world, "bodies[0].mass")).toBe(2);
    expect(resolvePath(world, "bodies[id=a].position.x")).toBe(1);
    expect(resolvePath(world, "bodies.length")).toBe(1);
    expect(resolvePath(world, "bodies[id=b].mass")).toBeUndefined();
    expect(resolvePath(world, "tick.x.y")).toBeUndefined();
  });
  it("reject invalid syntax", () => {
    for (const bad of ["", "bodies[", "bodies[x]", "1abc", "a b"]) expect(() => resolvePath(world, bad), bad).toThrow();
  });
});
