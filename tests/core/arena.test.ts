// Flight-test arena (FLT-010…FLT-013): fuel economy, gravity from asteroids, a world that wraps round.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyOf, assemblyTotals, createWorld, getProfile, initialWorld, parseScenario, stepInPlace, type Command, type World } from "../../src/core/index.ts";
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
    // 1 g parcels, and what the chambers still hold.
    const made = (w.gas.nextId - 1) * 0.001 + w.bodies.reduce((m, b) => m + (b.injector?.vessel?.mass ?? 0), 0);
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

  describe("economy engine details", () => {
    const engine = (fuelMass: number, vx: number) =>
      createWorld(
        1,
        [
          {
            ...disc("e", { mass: 1, velocity: { x: vx, y: 0 } }),
            contents: [{ resource: "o2", mass: fuelMass, capacity: 1 }],
            injector: { channel: "main", mixture: { o2: 1 }, speed: 0, igniter: false, economy: 20, outlet: { x: 0, y: -0.6 }, direction: { x: 0, y: -1 } },
          },
        ],
        { x: 0, y: 0 },
        { links: [{ id: "c", kind: "control", channel: "main", to: "e" }] },
        sandbox,
      );
    const fire: Command[] = [{ type: "control.set", channel: "main", value: 1 }];

    it("FLT-010 an economy engine fires on the last propellant a discounted parcel needs", () => {
      const w = engine(0.0001, 0); // a twentieth of a 1 g parcel is 0.05 g: enough for two
      stepInPlace(w, fire, sandbox);
      expect(w.gas.parcels.length).toBeGreaterThan(0);
    });

    it("FLT-010 the made mass arrives moving with the engine, so a fast engine's exhaust is as warm as a still one's", () => {
      const still = engine(0.5, 0);
      const fast = engine(0.5, 100);
      stepInPlace(still, fire, sandbox);
      stepInPlace(fast, fire, sandbox);
      const t = (w: World) => w.gas.parcels[0].thermal;
      expect(t(fast) / t(still)).toBeCloseTo(1, 6); // equal up to rounding (the made mass carries 4.75 J at 100 m/s)
      expect(t(still)).toBeGreaterThan(0);
      expect(fast.ledger.violations).toBe(0);
    });
  });

  it("FLT-012 gas crossing an edge with a ship wraps with it, and gas crossing alone wraps on its own; none is lost", () => {
    // Single parcels feel no pressure, so they fly straight: one beside the ship, one 40 m below it.
    const one = (y: number) => ({ min: { x: 8.9, y: y - 0.05 }, max: { x: 9.0, y: y + 0.05 }, count: 1, mass: 0.001, temperature: 300, composition: { air: 1 }, velocity: { x: 20, y: 0 } });
    const w = createWorld(
      1,
      [disc("ship", { mass: 1, position: { x: 9.6, y: 20 }, velocity: { x: 20, y: 0 } })],
      { x: 0, y: 0 },
      { bounds: { min: { x: -30, y: -30 }, max: { x: 30, y: 30 }, wrap: true }, gas: [one(20.7), one(-20)] },
      test,
    );
    w.bounds.min.x = -10; // a 20 m-wide arena, 60 m tall
    w.bounds.max.x = 10;
    const [near, alone] = [...w.gas.parcels].sort((a, b) => b.position.y - a.position.y);
    const [gap, x0] = [near.position.x - w.bodies[0].position.x, alone.position.x];
    for (let i = 0; i < 60; i++) stepInPlace(w, [], test); // 0.25 s: 5 m to the right, across x = 10
    expect(w.gas.parcels).toHaveLength(2);
    expect(w.gas.removed.count).toBe(0);
    expect(w.events.some((e) => e.type === "gas.left")).toBe(false);
    const ship = w.bodies[0].position;
    expect(ship.x).toBeLessThan(0); // the ship came back in at the left…
    expect(near.position.x - ship.x).toBeCloseTo(gap, 6); // …with the parcel beside it, still beside it
    expect(alone.position.x).toBeCloseTo(x0 + 5 - 20, 6); // the lone parcel wrapped by itself
    expect(w.ledger.violations).toBe(0);
  });

  describe("breakable ship (FT-B)", () => {
    /** The FT-B ship dropped onto rock-d at `v` m/s, legs first, with its strengths set. */
    const crash = (v: number, material: number, welds: number, steps = 360) => {
      const raw = readJson(join(ROOT, "scenarios", "ft-breakable.json")) as { world: { bodies: { gravity?: unknown; position: { x: number; y: number }; velocity: { x: number; y: number } }[] } };
      for (const b of raw.world.bodies) {
        if (b.gravity) continue;
        b.position = { x: b.position.x + 37.7, y: b.position.y - 2.5 }; // legs about 3 m above the rock
        b.velocity = { x: 0, y: -v };
      }
      const w = initialWorld(parseScenario(raw, { material, welds }));
      for (let i = 0; i < steps; i++) stepInPlace(w, [], sandbox);
      return w;
    };

    it("DMG-002 DMG-003 turned down, the ship comes apart on a rock; turned up, it bounces off whole", () => {
      const weak = crash(8, 0.2, 0.1);
      expect(assemblyOf(weak, "hull").length).toBeLessThan(5);
      expect(weak.bodies.filter((b) => b.integrity === 0).length).toBeGreaterThan(1);
      expect(weak.ledger.violations).toBe(0);
      const strong = crash(8, 50, 100);
      expect(assemblyOf(strong, "hull")).toHaveLength(19);
      expect(strong.bodies.every((b) => b.integrity === 1)).toBe(true);
      expect(assemblyTotals(strong, "hull")!.velocity.y).toBeGreaterThan(0); // bounced
      expect(strong.ledger.violations).toBe(0);
    }, 300_000);

    it("COL-006 LED-003 a ship coming apart on a rock creates no energy: a solve that gains is redone without warm starts", () => {
      // Its contacts' warm starts added up to 144 J a step while its welds took back less, a net
      // gain of up to 13 J; plain FT gained 0.19 J landing hard on the same rock.
      for (const [v, m, k] of [[8, 1, 1], [15, 1, 1], [8, 50, 100]]) {
        const w = crash(v, m, k, 240);
        expect(w.ledger.violations, `${v} m/s at ${m}× / ${k}×`).toBe(0);
      }
    }, 300_000);
  });
});
