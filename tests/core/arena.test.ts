// Flight-test arena (FLT-010…FLT-013): fuel economy, gravity from asteroids, a world that wraps round.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, createWorld, getProfile, initialWorld, parseScenario, stepInPlace, type Command, type World } from "../../src/core/index.ts";
import { disc, readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const test = getProfile("test");
const both = (v: number): Command[] => [
  { type: "control.set", channel: "left", value: v },
  { type: "control.set", channel: "right", value: v },
];
const fuel = (w: World) => w.bodies.reduce((s, b) => s + (b.contents ?? []).reduce((q, c) => q + c.mass, 0), 0);

describe("flight-test arena", () => {
  it("FLT-010 FLT-013 with an economy of 20 the FT ship burns a twentieth of the propellant for the same exhaust, and the ledger records the rest as supply", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "ft-asteroids.json"))));
    const f0 = fuel(w);
    expect(f0).toBeCloseTo(8.1, 6); // the LAND ship's tank, unchanged: same weight, same handling
    let supply = 0;
    for (let i = 0; i < 240; i++) {
      stepInPlace(w, both(1), sandbox);
      supply += w.ledger.last!.sources.supply.mass;
    }
    const made = (w.gas.nextId - 1) * 0.001; // 1 g parcels
    expect(made).toBeGreaterThan(0.9); // about 1 kg of exhaust a second from two engines
    expect(f0 - fuel(w)).toBeCloseTo(made / 20, 3);
    expect(supply).toBeCloseTo(made * (1 - 1 / 20), 3);
    expect(assemblyTotals(w, "hull")!.velocity.y).toBeGreaterThan(2); // thrust as before
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("FLT-011 a body with gravity pulls others toward it, softened by its core, and feels no pull itself", () => {
    const rock = disc("rock", { mass: 1000, position: { x: 0, y: 0 }, gravity: { mu: 10, core: 1 } });
    const probe = disc("probe", { mass: 2, position: { x: 5, y: 0 } });
    const w = createWorld(1, [rock, probe], { x: 0, y: 0 }, {}, test);
    stepInPlace(w, [], test);
    const dt = test.timestep;
    const expected = -(10 * 5) / (26 * Math.sqrt(26)); // mu·r/(r² + core²)^1.5, toward the rock
    const p = w.bodies.find((b) => b.id === "probe")!;
    expect(p.velocity.x / dt).toBeCloseTo(expected, 9);
    expect(w.bodies.find((b) => b.id === "rock")!.velocity).toEqual({ x: 0, y: 0 }); // one way
    expect(w.ledger.last!.sources.field.momentumX).toBeCloseTo(2 * expected * dt, 12); // recorded as a field
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-012 in a wrapped world a welded ship crossing an edge comes back at the other side whole, and the ledger stays clean", () => {
    const a = disc("a", { mass: 1, position: { x: 8.5, y: 0 }, velocity: { x: 20, y: 5 } });
    const b = disc("b", { mass: 1, position: { x: 9.5, y: 0 }, velocity: { x: 20, y: 5 } });
    const w = createWorld(1, [a, b], { x: 0, y: 0 }, { bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 }, wrap: true }, joints: [{ id: "j", a: "a", b: "b", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.5, y: 0 } }] }, test);
    let boundaryL = 0;
    for (let i = 0; i < 60; i++) {
      stepInPlace(w, [], test);
      boundaryL += w.ledger.last!.sources.boundary.angularMomentum;
    }
    const [pa, pb] = ["a", "b"].map((id) => w.bodies.find((x) => x.id === id)!.position);
    expect(w.joints).toHaveLength(1); // the weld never saw the jump
    expect(pb.x - pa.x).toBeCloseTo(1, 6);
    expect((pa.x + pb.x) / 2).toBeLessThan(0); // it went off the right edge and came in at the left
    expect(boundaryL).toBeCloseTo(-20 * 2 * 5, 6); // a shift D changes L by D × P = (−20 m)(2 × 5 kg·m/s): recorded
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-012 gravity in a wrapped world pulls across the edge, from the nearest copy of the source", () => {
    const rock = disc("rock", { mass: 1000, position: { x: 9.5, y: 0 }, gravity: { mu: 10, core: 1 } });
    const probe = disc("probe", { mass: 1, position: { x: -9.5, y: 0 } });
    const w = createWorld(1, [rock, probe], { x: 0, y: 0 }, { bounds: { min: { x: -10, y: -10 }, max: { x: 10, y: 10 }, wrap: true } }, test);
    stepInPlace(w, [], test);
    // The rock's nearest copy is at x = −10.5, one metre to the probe's left.
    const expected = -10 / (2 * Math.sqrt(2));
    expect(w.bodies.find((b) => b.id === "probe")!.velocity.x / test.timestep).toBeCloseTo(expected, 9);
  });
});
