// The units proof (docs/units-rescale-plan.md, stage 1): every scenario (UNITS-001) and every designer preset in its game (UNITS-002) run in the core's units and
// converted to lengths ×4, masses ×1024, side by side; after every step, every body, weld, gas
// parcel and event must be the same bit for bit once divided by its factor.
import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import { readFile, readJson, scenarioFiles } from "../helpers.ts";
import { proof, proofMigrated } from "../unitsProof.ts";
import { getProfile, initialWorld, parseScenario, runScenario, stepInPlace } from "../../src/core/index.ts";
import { scaleShip } from "../../src/core/scaleScenario.ts";
import { migrateUnits, toCoreUnits } from "../../src/core/migrateUnits.ts";
import { withBlueprint } from "../../src/app/playtest.ts";
import { loxodonPreset, mastodonPreset, phiomiaPreset, stegodonPreset, thrustOgPreset, thrustPreset } from "../../src/app/blueprint/model.ts";

const ONLY = process.env.UNITS_ONLY?.split(",");

describe("the units proof: lengths ×4, masses ×1024 run as the core's own, bit for bit", () => {
  for (const file of scenarioFiles()) {
    const name = basename(file, ".json");
    if (ONLY && !ONLY.includes(name)) continue;
    it(`UNITS-001 ${name}`, () => {
      const r = proof(readFile(file), Number(process.env.UNITS_STEPS ?? 480));
      expect(r.untagged).toEqual([]);
      expect(r.diff).toBe("");
    }, 600_000);
  }
});

describe("the units proof for the designer's presets, flown in Thrust's first level", () => {
  const level = readJson("scenarios/thrust-1.json") as Parameters<typeof thrustPreset>[0];
  for (const make of [thrustOgPreset, thrustPreset, mastodonPreset, stegodonPreset, phiomiaPreset, loxodonPreset]) {
    const bp = make(level);
    if (ONLY && !ONLY.includes(bp.name)) continue;
    it(`UNITS-002 ${bp.name}`, () => {
      const r = proof(withBlueprint(level, bp), Number(process.env.UNITS_STEPS ?? 480));
      expect(r.untagged).toEqual([]);
      expect(r.diff).toBe("");
    }, 600_000);
  }
});

describe("the units proof for timeline commands", () => {
  it("UNITS-001 a drag with a capped acceleration converts with the scenario (drag.set's anchor, target and maxAcceleration)", () => {
    const disc = {
      id: "ball",
      shape: { kind: "disc", radius: 0.5 },
      mass: 2,
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      angle: 0,
      angularVelocity: 0,
    };
    const raw = {
      schema: 1,
      name: "drag",
      profile: "test",
      seed: 1,
      world: { bodies: [disc] },
      timeline: [
        {
          step: 0,
          commands: [
            {
              type: "drag.set",
              id: "ball",
              anchor: { x: 0.2, y: 0 },
              target: { x: 40, y: 10 },
              stiffness: 30,
              maxAcceleration: 10,
            },
          ],
        },
      ],
      end: { steps: 240 },
      probes: [],
      assertions: [],
    };
    const r = proof(raw, 240, false);
    expect(r.untagged).toEqual([]);
    expect(r.diff).toBe("");
  });
});

describe("schema 1 → 2: the migration to the game's units (UNITS-003)", () => {
  // A schema 1 scenario with all that stands for a number: parameters with units, placeholders,
  // formulas with lengths in them, assertions on probes of several dimensions, and a camera.
  const old = {
    schema: 1,
    name: "migration",
    profile: "test",
    seed: 1,
    parameters: [
      { id: "size", label: "Box size", unit: "m", min: 0.5, max: 2, default: 1 },
      { id: "m", label: "Mass", unit: "kg", min: 1, max: 10, default: 2 },
      { id: "v", label: "Speed", unit: "m/s", min: 1, max: 20, default: 6 },
      { id: "hard", label: "Hardness", unit: "×", min: 0.5, max: 2, default: 1 },
    ],
    world: {
      gravity: { x: 0, y: -9.81 },
      bodies: [
        { id: "ground", shape: { kind: "box", width: 20, height: 1 }, mass: 1, fixed: true, position: { x: 0, y: -0.5 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 },
        {
          id: "box",
          shape: { kind: "box", width: { $param: "size" }, height: { $param: "size" } },
          mass: { $param: "m" },
          position: { x: 0, y: { $expr: "1.5 + size / 2" } },
          velocity: { x: { $param: "v" }, y: 0 },
          angle: 0,
          angularVelocity: 0,
          material: { name: "hull", threshold: { $expr: "20 * hard" }, toughness: 600 },
        },
      ],
    },
    timeline: [],
    end: { steps: 240 },
    probes: [
      { id: "y", path: "bodies[id=box].position.y" },
      { id: "vx", path: "bodies[id=box].velocity.x" },
      { id: "p", path: "assembly[id=box].momentum.x" },
    ],
    assertions: [
      { kind: "rangeOver", probe: "y", from: 0, to: "end", min: 0, max: 3 },
      { kind: "valueAt", probe: "vx", step: 0, equals: { $param: "v" }, tol: 1e-9 },
      { kind: "formula", at: 0, left: "p", right: "m * v", tol: 1e-9 },
      { kind: "ledgerResidual", quantity: "energy", maxAbs: 1 },
    ],
    ui: { camera: { x: 0, y: 2, zoom: 40 } },
  };

  it("UNITS-003 a schema 1 scenario migrates to schema 2 exactly: it runs bit for bit as before, and its assertions still pass", () => {
    const m = migrateUnits(old) as typeof old & { parameters: { default: number }[]; ui: { camera: { x: number; y: number; zoom: number } } };
    expect(m.schema).toBe(2);
    // Parameters by their units; a factor-free one as it was.
    expect(m.parameters.map((p) => p.default)).toEqual([4, 2048, 24, 1]);
    expect(m.ui.camera).toEqual({ x: 0, y: 8, zoom: 10 });
    const game = parseScenario(m);
    expect(game.world.units).toEqual({ length: 4, mass: 1024 });
    expect(game.world.bodies[1].position.y).toBe(4 * 2); // (1.5 + 1/2) m, ×4
    expect(game.world.bodies[1].material?.threshold).toBe(20 * 16384);
    expect(proofMigrated(old, 240, false).diff).toBe("");
    expect(runScenario(game).assertions.filter((a) => !a.pass)).toEqual([]);
  });

  it("UNITS-003 a schema 1 file loads migrated, and the core's units can still be asked for", () => {
    expect(parseScenario(old).world.units).toEqual({ length: 4, mass: 1024 });
    expect(parseScenario(old, {}, { coreUnits: true }).world.units).toBeUndefined();
    // Back again: the inverse gives the schema 1 numbers.
    const back = toCoreUnits(migrateUnits(old)) as typeof old;
    expect(back.schema).toBe(1);
    expect(back.world.bodies[0].shape).toEqual(old.world.bodies[0].shape);
    expect(back.ui).toEqual(old.ui);
  });
});

describe("saved ships in the game's units", () => {
  it("UNITS-003 a prefab saved from a running world (a gun with its magazine's timer and count, an engine with its chamber) converts, leaving state with no dimension as it is", () => {
    const w = initialWorld(parseScenario(readJson("scenarios/gunship.json") as Record<string, unknown>));
    for (let i = 0; i < 30; i++) stepInPlace(w, [], getProfile("sandbox"));
    const bodies = structuredClone(w.bodies.filter((b) => b.magazine || b.injector));
    expect(bodies.some((b) => b.magazine)).toBe(true);
    expect(() => scaleShip({ bodies }, { length: 4, mass: 1024 })).toThrow(/no dimension known/);
    const out = scaleShip({ bodies }, { length: 4, mass: 1024 }, { strict: false });
    const gun = out.bodies.find((b) => b.magazine)!;
    const before = bodies.find((b) => b.magazine)!;
    expect(gun.mass).toBe(before.mass * 1024);
    expect(gun.magazine!.timer).toBe(before.magazine!.timer);
    expect(gun.magazine!.loaded).toBe(before.magazine!.loaded);
  });
});
