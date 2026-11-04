// Asteroids, first look (AST-001…AST-003): the seeded generator, and fracture by the weld rules.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyOf, computeTotals, createWorld, generateAsteroid, getProfile, initialWorld, parseScenario, polygonArea, stepInPlace, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const spec = { id: "a", seed: 7, pieces: 20, radius: 6, density: 300, bond: 300_000, position: { x: 0, y: 0 } };
const parts = (w: World, prefix: string) => new Set(w.bodies.filter((b) => b.id.startsWith(prefix)).map((b) => assemblyOf(w, b.id).sort()[0])).size;

describe("asteroid generator", () => {
  it("AST-002 the same seed gives the same asteroid; another seed, another", () => {
    expect(generateAsteroid(spec)).toEqual(generateAsteroid(spec));
    expect(generateAsteroid({ ...spec, seed: 8 })).not.toEqual(generateAsteroid(spec));
  });

  it("AST-001 AST-002 an asteroid is the requested number of convex pieces, tiling it, welded into one rock", () => {
    const a = generateAsteroid(spec);
    expect(a.bodies).toHaveLength(20);
    const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints }); // throws on any invalid polygon
    expect(parts(w, "a-")).toBe(1);
    // Pieces meet edge to edge: their areas add up to the mass the density says.
    const area = a.bodies.reduce((s, b) => s + (b.shape.kind === "polygon" ? polygonArea(b.shape.vertices) : 0), 0);
    expect(a.bodies.reduce((s, b) => s + b.mass, 0)).toBeCloseTo(300 * area, 6);
    // A bond's limits scale with its shared edge: tension = bond × length, torque = bond × length² / 4.
    for (const j of a.joints) {
      const len = j.limits!.tension! / 300_000;
      expect(j.limits!.torque).toBeCloseTo((300_000 * len * len) / 4, 6);
      expect(len).toBeGreaterThan(0);
    }
  });

  it("AST-001 an asteroid left alone, or spinning slowly, stays whole", () => {
    for (const w0 of [0, 0.5]) {
      const a = generateAsteroid({ ...spec, angularVelocity: w0 });
      const w = createWorld(1, a.bodies, { x: 0, y: 0 }, { joints: a.joints }, sandbox);
      for (let i = 0; i < 480; i++) stepInPlace(w, [], sandbox);
      expect(w.events.some((e) => e.type === "joint.break")).toBe(false);
      expect(w.ledger.violations).toBe(0);
    }
  }, 300_000);

  it("AST-003 two asteroids colliding fast shatter into parts, with mass and momentum conserved", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "asteroid-collision.json")), { speed: 12 });
    const w = initialWorld(scn);
    const t0 = computeTotals(w);
    for (let i = 0; i < 960; i++) stepInPlace(w, [], sandbox);
    const t1 = computeTotals(w);
    expect(parts(w, "big-")).toBeGreaterThan(3);
    expect(parts(w, "small-")).toBeGreaterThan(3);
    expect(t1.mass).toBeCloseTo(t0.mass, 6);
    expect(t1.momentum.x).toBeCloseTo(t0.momentum.x, 3);
    expect(t1.momentum.y).toBeCloseTo(t0.momentum.y, 3);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AST-002 a scenario's asteroids are validated", () => {
    const raw = readJson(join(ROOT, "scenarios", "asteroid-collision.json")) as { world: { asteroids: Record<string, unknown>[] } };
    raw.world.asteroids[0].pieces = 0;
    raw.world.asteroids[1].radius = -1;
    let paths: string[] = [];
    try {
      parseScenario(raw);
    } catch (e) {
      paths = (e as { errors: { path: string }[] }).errors.map((x) => x.path);
    }
    expect(paths.sort()).toEqual(["$.world.asteroids[0].pieces", "$.world.asteroids[1].radius"]);
  });
});
