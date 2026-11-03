import fc from "fast-check";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCommands,
  assemblyTotals,
  computeTotals,
  createWorld,
  gasTotals,
  getProfile,
  mixture,
  parseScenario,
  R_GAS,
  runScenario,
  SPECIES,
  stepInPlace,
  temperatureOf,
  type BodyInput,
  type GasFill,
  type World,
} from "../../src/core/index.ts";
import { box, disc, readJson, ROOT } from "../helpers.ts";

const test = getProfile("test");
const scenario = (name: string, values: Record<string, number> = {}) => parseScenario(readJson(join(ROOT, "scenarios", `${name}.json`)), values);

function run(w: World, steps: number): void {
  for (let s = 0; s < steps; s++) stepInPlace(w, [], test);
}

/** A sealed 2 m box of four fixed or free walls, inner corners at ±1. */
function sealedBox(opts: { fixed?: boolean; mass?: number; velocity?: { x: number; y: number }; angularVelocity?: number } = {}): { bodies: BodyInput[]; joints: never[] | object[] } {
  const m = (opts.mass ?? 10) / 4;
  const v = opts.velocity ?? { x: 0, y: 0 };
  const w = opts.angularVelocity ?? 0;
  const part = (id: string, wd: number, ht: number, x: number, y: number): BodyInput =>
    box(id, wd, ht, { mass: m, fixed: opts.fixed ?? false, position: { x, y }, velocity: { x: v.x - w * y, y: v.y + w * x }, angularVelocity: w, restitution: 0, friction: 0 });
  const bodies = [part("bottom", 2.2, 0.1, 0, -1.05), part("left", 0.1, 2, -1.05, 0), part("right", 0.1, 2, 1.05, 0), part("top", 2.2, 0.1, 0, 1.05)];
  const limits = { tension: 1e9, compression: 1e9, shear: 1e9, torque: 1e9 };
  const joints = opts.fixed
    ? []
    : [
        { id: "j1", a: "left", b: "top", anchorA: { x: 0, y: 1 }, anchorB: { x: -1.05, y: -0.05 }, limits },
        { id: "j2", a: "left", b: "bottom", anchorA: { x: 0, y: -1 }, anchorB: { x: -1.05, y: 0.05 }, limits },
        { id: "j3", a: "right", b: "top", anchorA: { x: 0, y: 1 }, anchorB: { x: 1.05, y: -0.05 }, limits },
        { id: "j4", a: "right", b: "bottom", anchorA: { x: 0, y: -1 }, anchorB: { x: 1.05, y: 0.05 }, limits },
      ];
  return { bodies, joints };
}

const fill = (over: Partial<GasFill> = {}): GasFill => ({ min: { x: -1, y: -1 }, max: { x: 1, y: 1 }, count: 100, mass: 0.5, temperature: 300, composition: { air: 1 }, ...over });

describe("gas parcels", () => {
  it("GAS-001 a parcel has mass, composition, position, velocity, thermal energy and radius", () => {
    const w = createWorld(1, [], { x: 0, y: 0 }, { gas: [fill({ count: 16, mass: 0.16, temperature: 400, velocity: { x: 2, y: -1 } })] }, test);
    expect(w.gas.parcels).toHaveLength(16);
    for (const p of w.gas.parcels) {
      expect(p.mass).toBeCloseTo(0.01, 12);
      expect(p.composition).toEqual({ air: 1 });
      expect(p.velocity).toEqual({ x: 2, y: -1 });
      expect(p.radius).toBeCloseTo(0.25, 12); // half of the 0.5 m lattice spacing
      expect(Math.abs(p.position.x)).toBeLessThan(1);
      // Thermal energy = m·cv·T, with cv = R / (M·(γ − 1)) for air.
      expect(p.thermal).toBeCloseTo(0.01 * (R_GAS / (SPECIES.air.molarMass * 0.4)) * 400, 9);
      expect(temperatureOf(p)).toBeCloseTo(400, 9);
    }
    expect(w.events.length).toBe(0);
    expect(computeTotals(w).mass).toBeCloseTo(0.16, 12);
  });

  it("GAS-001 mixtures combine specific heats by mass fraction", () => {
    const m = mixture({ air: 0.5, helium: 0.5 });
    const rAir = R_GAS / SPECIES.air.molarMass;
    const rHe = R_GAS / SPECIES.helium.molarMass;
    const cv = 0.5 * (rAir / 0.4) + 0.5 * (rHe / (2 / 3));
    expect(m.cv).toBeCloseTo(cv, 6);
    expect(m.gamma).toBeCloseTo(1 + (0.5 * rAir + 0.5 * rHe) / cv, 12);
  });

  it("GAS-002 a free cloud conserves momentum and angular momentum to float precision", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e6 }), fc.integer({ min: 40, max: 120 }), fc.double({ min: 50, max: 2000, noNaN: true }), (seed, count, T) => {
        const w = createWorld(seed, [], { x: 0, y: 0 }, { gas: [fill({ count, temperature: T, jitter: 30 })] }, test);
        const p0 = gasTotals(w.gas);
        run(w, 6);
        const p1 = gasTotals(w.gas);
        expect(Math.abs(p1.momentum.x - p0.momentum.x)).toBeLessThan(1e-10);
        expect(Math.abs(p1.momentum.y - p0.momentum.y)).toBeLessThan(1e-10);
        expect(Math.abs(p1.angularMomentum - p0.angularMomentum)).toBeLessThan(1e-10);
        expect(w.ledger.violations).toBe(0);
      }),
      { numRuns: 8 },
    );
  });

  it("GAS-003 wall pressure rises in proportion to density and to temperature", () => {
    const pressure = (mass: number, T: number) => {
      const { bodies } = sealedBox({ fixed: true });
      const w = createWorld(1, bodies, { x: 0, y: 0 }, { gas: [fill({ count: 100, mass, temperature: T })] }, test);
      run(w, 60);
      const w0 = w.gas.wallImpulse;
      const t0 = w.time;
      run(w, 60);
      return (w.gas.wallImpulse - w0) / (w.time - t0) / 8;
    };
    const base = pressure(0.5, 300);
    // Ideal gas: P = (γ − 1)·ρ·u. Twice the density or twice the temperature doubles it.
    expect(base / ((0.4 * 0.5 * mixture({ air: 1 }).cv * 300) / 4)).toBeCloseTo(1, 1);
    expect(pressure(1, 300) / base).toBeCloseTo(2, 1);
    expect(pressure(0.5, 600) / base).toBeCloseTo(2, 1);
  });

  it("GAS-004 gas hitting a free body pushes it at the contact point, conserving momentum, angular momentum and energy", () => {
    // A blob of gas moving right hits the lower half of a disc: the disc moves right and spins.
    const target = disc("t", { shape: { kind: "disc", radius: 0.4 }, mass: 0.2, position: { x: 0.8, y: 0.3 } });
    const w = createWorld(1, [target], { x: 0, y: 0 }, { gas: [{ ...fill({ count: 64, mass: 0.05, temperature: 300 }), min: { x: -0.6, y: -0.2 }, max: { x: 0, y: 0.4 }, velocity: { x: 100, y: 0 } }] }, test);
    const t0 = computeTotals(w);
    run(w, 20);
    const t1 = computeTotals(w);
    const b = w.bodies[0];
    expect(b.velocity.x).toBeGreaterThan(0.5);
    // The gas struck below the centre, so the push gives clockwise spin.
    expect(b.angularVelocity).toBeLessThan(0);
    expect(t1.momentum.x).toBeCloseTo(t0.momentum.x, 10);
    expect(t1.momentum.y).toBeCloseTo(t0.momentum.y, 10);
    expect(t1.angularMomentum).toBeCloseTo(t0.angularMomentum, 10);
    expect(Math.abs(t1.energy.total - t0.energy.total)).toBeLessThan(1e-6);
    expect(w.ledger.violations).toBe(0);
  });

  it("GAS-004 a fixed wall's push is attributed to contact, not left as a residual", () => {
    const wall = box("wall", 0.2, 2, { fixed: true, position: { x: 0.6, y: 0 } });
    const w = createWorld(1, [wall], { x: 0, y: 0 }, { gas: [{ ...fill({ count: 64, mass: 0.05 }), min: { x: -0.5, y: -0.5 }, max: { x: 0.3, y: 0.3 }, velocity: { x: 50, y: 0 } }] }, test);
    run(w, 30);
    expect(gasTotals(w.gas).momentum.x).toBeLessThan(0); // bounced back
    expect(w.ledger.violations).toBe(0);
    expect(w.ledger.maxResidual.momentumX).toBeLessThan(1e-9);
  });

  it("GAS-005 GAS-002 a sealed box gains momentum only from its own gas: box plus gas stays at zero", () => {
    // Gas packed into the left half rushes across; the box rocks, but the sum never moves.
    const { bodies, joints } = sealedBox();
    const w = createWorld(1, bodies, { x: 0, y: 0 }, { joints: joints as never, gas: [fill({ count: 120, max: { x: 0, y: 1 } })] }, test);
    let maxBox = 0;
    for (let s = 0; s < 60; s++) {
      stepInPlace(w, [], test);
      const boxP = assemblyTotals(w, "top")!.momentum;
      const gasP = gasTotals(w.gas).momentum;
      maxBox = Math.max(maxBox, Math.abs(boxP.x));
      expect(Math.abs(boxP.x + gasP.x)).toBeLessThan(1e-11);
      expect(Math.abs(boxP.y + gasP.y)).toBeLessThan(1e-11);
    }
    expect(maxBox).toBeGreaterThan(0.01); // it did rock
    expect(w.ledger.violations).toBe(0);
  });

  it("GAS-006 gas released in vacuum expands freely and its centre of mass keeps its velocity (RS-07)", () => {
    const r = runScenario(scenario("rs07-gas-burst", { count: 100 }));
    expect(r.assertions.filter((a) => !a.pass)).toEqual([]);
    expect(r.probes.spread.at(-1)! / r.probes.spread[0]).toBeGreaterThan(2);
    expect(r.probes.thermal.at(-1)!).toBeLessThan(r.probes.thermal[0]); // it cooled as it expanded
  });

  it("GAS-007 parcels leaving the world boundary are removed and the ledger records what they carried", () => {
    const w = createWorld(1, [], { x: 0, y: -9.81 }, { bounds: { min: { x: -2, y: -2 }, max: { x: 2, y: 2 } }, gas: [fill({ count: 36, mass: 0.05, min: { x: 0.5, y: -0.5 }, max: { x: 1.5, y: 0.5 }, velocity: { x: 300, y: 0 } })] }, test);
    const before = computeTotals(w);
    let boundary = { mass: 0, momentumX: 0, energy: 0 };
    for (let s = 0; s < 12; s++) {
      stepInPlace(w, [], test);
      const b = w.ledger.last!.sources.boundary;
      boundary = { mass: boundary.mass + b.mass, momentumX: boundary.momentumX + b.momentumX, energy: boundary.energy + b.energy };
    }
    expect(w.gas.removed.count).toBeGreaterThan(0);
    expect(w.gas.parcels.length + w.gas.removed.count).toBe(36);
    expect(boundary.mass).toBeCloseTo(-w.gas.removed.mass, 12);
    expect(boundary.momentumX).toBeCloseTo(-w.gas.removed.momentum.x, 9);
    expect(boundary.energy).toBeCloseTo(-w.gas.removed.energy, 6);
    expect(computeTotals(w).mass + w.gas.removed.mass).toBeCloseTo(before.mass, 12);
    expect(w.events.some((e) => e.type === "gas.left")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("PRF-003 a huge fill is refused without building it", () => {
    const w = createWorld(1, [], { x: 0, y: 0 }, {}, test);
    const t0 = performance.now();
    applyCommands(w, [{ type: "gas.fill", fill: fill({ count: 4_000_000, min: { x: -100, y: -100 }, max: { x: 100, y: 100 } }) }], test);
    expect(w.gas.parcels.length).toBe(0);
    expect(w.events.at(-1)!.type).toBe("limit.refused");
    expect(performance.now() - t0).toBeLessThan(500); // stops at the limit instead of making 4 million parcels
  });

  it("GAS-004 GAS-005 a sealed box moving at 100 m/s, or spinning, keeps its gas: walls move with the gas substeps", () => {
    for (const [v, spin] of [
      [100, 0],
      [0, 5],
    ]) {
      const { bodies, joints } = sealedBox({ velocity: { x: v, y: 0 }, angularVelocity: spin });
      const w = createWorld(1, bodies, { x: 0, y: 0 }, { joints: joints as never, gas: [fill({ count: 100, velocity: { x: v, y: 0 } })] }, test);
      run(w, 30);
      const b = assemblyTotals(w, "top")!;
      for (const p of w.gas.parcels) expect(Math.hypot(p.position.x - b.centre.x, p.position.y - b.centre.y)).toBeLessThan(1.42);
      if (v) expect(b.velocity.x).toBeCloseTo(v, 2);
      expect(w.ledger.violations).toBe(0);
    }
  });

  it("PRF-003 a fill that would exceed limit.gasParcels is refused and recorded", () => {
    const w = createWorld(1, [], { x: 0, y: 0 }, {}, test);
    applyCommands(w, [{ type: "gas.fill", fill: fill({ count: 3969 }) }], test); // a 63 × 63 lattice
    expect(w.gas.parcels.length).toBe(3969);
    const rng = structuredClone(w.rng);
    applyCommands(w, [{ type: "gas.fill", fill: fill({ count: 2025, min: { x: 2, y: 2 }, max: { x: 3, y: 3 } }) }], test);
    expect(w.gas.parcels.length).toBe(3969);
    expect(w.rng).toEqual(rng); // a refused fill draws no random numbers
    const e = w.events.find((x) => x.type === "limit.refused")!;
    expect(e.data).toEqual({ entity: "gasParcels", requested: 2025, existing: 3969, limit: test.limit.gasParcels });
    expect(computeTotals(w).mass).toBeCloseTo(0.5, 12); // nothing was added
  });

  it("gas.remove takes out the parcels in a rectangle, as a user edit", () => {
    const w = createWorld(1, [], { x: 0, y: 0 }, { gas: [fill({ count: 100 })] }, test);
    applyCommands(w, [{ type: "gas.remove", min: { x: -1, y: -1 }, max: { x: 0, y: 1 } }], test);
    expect(w.gas.parcels.length).toBe(50);
    stepInPlace(w, [], test);
    expect(w.ledger.last!.sources.user.mass).toBeCloseTo(-0.25, 12);
    expect(w.ledger.violations).toBe(0);
  });

  it("parcels are not placed inside bodies", () => {
    const w = createWorld(1, [disc("rock", { shape: { kind: "disc", radius: 0.5 } })], { x: 0, y: 0 }, { gas: [fill({ count: 100 })] }, test);
    expect(w.gas.parcels.length).toBeLessThan(100);
    for (const p of w.gas.parcels) expect(Math.hypot(p.position.x, p.position.y)).toBeGreaterThan(0.5);
    expect(computeTotals(w).mass).toBeCloseTo(1.5, 12); // the fill's mass is spread over the parcels made
  });
});

describe("sealed box oracle", () => {
  it("ORC-006 any gas layout in a moving, spinning sealed box conserves momentum, angular momentum and energy", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e6 }),
        fc.double({ min: -0.9, max: 0.5, noNaN: true }),
        fc.double({ min: -0.9, max: 0.5, noNaN: true }),
        fc.double({ min: -3, max: 3, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        (seed, x0, y0, vx, spin) => {
          const { bodies, joints } = sealedBox({ velocity: { x: vx, y: 0 }, angularVelocity: spin });
          const w = createWorld(seed, bodies, { x: 0, y: 0 }, { joints: joints as never, gas: [fill({ count: 40, mass: 0.3, min: { x: x0, y: y0 }, max: { x: x0 + 0.4, y: y0 + 0.4 }, jitter: 20, velocity: { x: vx, y: 0 } })] }, test);
          run(w, 12);
          expect(w.ledger.violations).toBe(0);
          expect(w.ledger.maxResidual.momentumX).toBeLessThan(test.tol.momentum);
          expect(w.ledger.maxResidual.angularMomentum).toBeLessThan(test.tol.angularMomentum);
          expect(w.ledger.maxResidual.energy).toBeLessThan(test.tol.energy);
          // Nothing escaped the box (inner corners are √2 m from its centre).
          const c = assemblyTotals(w, "top")!.centre;
          for (const p of w.gas.parcels) expect(Math.hypot(p.position.x - c.x, p.position.y - c.y)).toBeLessThan(1.42);
        },
      ),
      { numRuns: 6 },
    );
  });

  it("ORC-006 a symmetric, settled fill leaves the box still (SC-02)", () => {
    const r = runScenario(scenario("sc02-gas-in-a-box", { count: 100 }), { steps: 120 });
    const c = Math.sqrt(1.4 * 0.4 * mixture({ air: 1 }).cv * 300); // speed of sound, m/s
    const fastest = Math.max(...r.probes.boxVx.map(Math.abs), ...r.probes.boxVy.map(Math.abs));
    expect(fastest).toBeLessThan(test.tol.velocity * c);
    expect(r.world.ledger.violations).toBe(0);
  });

  describe("out of the plane (GAS-009)", () => {
    const sandbox = getProfile("sandbox");
    const cloud = (depth: number | undefined, bodies: Parameters<typeof createWorld>[1] = []) =>
      createWorld(1, bodies, { x: 0, y: 0 }, { bounds: { min: { x: -50, y: -50 }, max: { x: 50, y: 50 }, ...(depth ? { depth } : {}) }, gas: [fill({ count: 100, mass: 0.1, temperature: 300 })] }, sandbox);
    const mass = (w: ReturnType<typeof cloud>) => w.gas.parcels.reduce((m, p) => m + p.mass, 0);

    it("GAS-009 with a depth, gas older than DEPTH_DELAY spreads out at its sound speed, and the ledger records what leaves", () => {
      const w = cloud(2);
      const m0 = mass(w);
      for (let s = 0; s < 24; s++) stepInPlace(w, [], sandbox); // 0.1 s: none leaves yet
      expect(mass(w)).toBe(m0);
      let boundary = 0;
      for (let s = 0; s < 48; s++) {
        stepInPlace(w, [], sandbox);
        boundary += w.ledger.last!.sources.boundary.mass;
      }
      expect(mass(w)).toBeLessThan(0.9 * m0);
      expect(mass(w) + w.gas.removed.mass).toBeCloseTo(m0, 12);
      expect(boundary).toBeCloseTo(-w.gas.removed.mass, 12);
      expect(w.ledger.violations).toBe(0);
    });

    it("GAS-009 without a depth no gas leaves through the plane and parcels carry no age", () => {
      const w = cloud(undefined);
      const m0 = mass(w);
      for (let s = 0; s < 72; s++) stepInPlace(w, [], sandbox);
      expect(mass(w) + w.gas.removed.mass).toBeCloseTo(m0, 12);
      expect(w.gas.removed.mass).toBe(0);
      expect(w.gas.parcels.every((p) => p.age === undefined)).toBe(true);
    });

    it("GAS-009 gas inside an engine's declared interior stays in the plane", () => {
      // An idle engine head above the world whose declared interior covers the whole world, so the
      // expanding cloud stays inside it.
      const head = { id: "head", shape: { kind: "box" as const, width: 1, height: 0.2 }, mass: 1, fixed: true, position: { x: 0, y: 60 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, injector: { channel: "main", outlet: { x: 0, y: 0 }, direction: { x: 0, y: -1 }, chamber: { width: 200, length: 120 } } };
      const open = cloud(2);
      const engine = cloud(2, [head]);
      for (let s = 0; s < 72; s++) {
        stepInPlace(open, [], sandbox);
        stepInPlace(engine, [], sandbox);
      }
      expect(mass(engine)).toBeGreaterThan(0.99 * (mass(engine) + engine.gas.removed.mass));
      expect(mass(open)).toBeLessThan(0.9 * (mass(open) + open.gas.removed.mass));
      expect(engine.ledger.violations).toBe(0);
    });
  });
});
