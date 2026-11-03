import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  broadPhase,
  collide,
  computeTotals,
  createWorld,
  getProfile,
  massProps,
  normalizeBody,
  sinCos,
  stepInPlace,
  type BodyInput,
  type Profile,
  type World,
} from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

const test: Profile = getProfile("test");
const dt = test.timestep;
const run = (w: World, steps: number) => {
  for (let i = 0; i < steps; i++) stepInPlace(w, [], test);
};

describe("pinned trigonometry", () => {
  it("DET-003 sinCos matches Math.sin/Math.cos to within 2 ulp-scale error", () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (x) => {
        const { s, c } = sinCos(x);
        expect(Math.abs(s - Math.sin(x))).toBeLessThan(1e-15 * Math.max(1, Math.abs(x)));
        expect(Math.abs(c - Math.cos(x))).toBeLessThan(1e-15 * Math.max(1, Math.abs(x)));
      }),
      { numRuns: 5000 },
    );
  });

  it("DET-003 exact at key angles and pinned bits (catches accidental changes)", () => {
    expect(sinCos(0)).toEqual({ s: 0, c: 1 });
    expect(sinCos(Math.PI / 2).s).toBe(1);
    expect(sinCos(Math.PI).c).toBe(-1);
    expect([sinCos(1).s, sinCos(1).c, sinCos(-2.5).s]).toEqual([0.8414709848078965, 0.5403023058681398, -0.5984721441039564]);
    expect(Number.isNaN(sinCos(Infinity).s)).toBe(true);
  });
});

describe("mass properties", () => {
  it("PHY-001 disc, box and polygon give the textbook moment of inertia", () => {
    expect(massProps({ kind: "disc", radius: 2 }, 3).inertia).toBeCloseTo(0.5 * 3 * 4, 12);
    expect(massProps({ kind: "box", width: 2, height: 1 }, 6).inertia).toBeCloseTo((6 * (4 + 1)) / 12, 12);
    const square = { kind: "polygon" as const, vertices: [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }] };
    expect(massProps(square, 2).inertia).toBeCloseTo(massProps({ kind: "box", width: 2, height: 2 }, 2).inertia, 12);
    expect(massProps({ kind: "box", width: 2, height: 1 }, 1).area).toBeCloseTo(2, 12);
  });

  it("PHY-001 polygons are re-centred on their centroid and the body moves to match", () => {
    const b = normalizeBody({ ...disc("t"), shape: { kind: "polygon", vertices: [{ x: 0, y: 0 }, { x: 0, y: 3 }, { x: 3, y: 0 }] } });
    expect(b.position.x).toBeCloseTo(1, 12);
    expect(b.position.y).toBeCloseTo(1, 12);
    if (b.shape.kind !== "polygon") throw new Error("expected polygon");
    const cx = b.shape.vertices.reduce((s, v) => s + v.x, 0) / 3;
    expect(cx).toBeCloseTo(0, 12);
    expect(b.shape.vertices[0]).toEqual({ x: 2, y: -1 }); // reordered counter-clockwise
  });
});

describe("integration", () => {
  it("ORC-001 a free body keeps constant velocity and spin for 10,000 steps", () => {
    const w = createWorld(1, [disc("a", { velocity: { x: 1.5, y: -0.25 }, angularVelocity: 2 })]);
    run(w, 10_000);
    const a = w.bodies[0];
    const t = 10_000 * dt;
    expect(a.velocity).toEqual({ x: 1.5, y: -0.25 });
    expect(a.angularVelocity).toBe(2);
    expect(a.position.x).toBeCloseTo(1.5 * t, 9);
    expect(a.position.y).toBeCloseTo(-0.25 * t, 9);
    expect(a.angle).toBeCloseTo(2 * t, 9);
  });

  it("PHY-002 semi-implicit Euler under gravity matches its closed form and stays near the true parabola", () => {
    const g = { x: 0, y: -9.81 };
    const w = createWorld(1, [disc("a", { velocity: { x: 3, y: 10 } })], g);
    const n = 480;
    run(w, n);
    const t = n * dt;
    const a = w.bodies[0];
    // Discrete solution: y_n = v0·t + g·t²/2 + g·t·dt/2.
    expect(a.position.y).toBeCloseTo(10 * t + (g.y * t * t) / 2 + (g.y * t * dt) / 2, 9);
    expect(Math.abs(a.position.y - (10 * t + (g.y * t * t) / 2))).toBeLessThan(Math.abs(g.y) * t * dt);
    expect(a.velocity.y).toBeCloseTo(10 + g.y * t, 9);
  });

  it("PHY-003 an impulse away from the centre of mass changes both velocity and spin", () => {
    const w = createWorld(1, [box("r", 2, 0.2, { mass: 2 })]);
    stepInPlace(w, [{ type: "body.impulse", id: "r", impulse: { x: 0, y: 4 }, point: { x: 0.5, y: 0 } }], test);
    const r = w.bodies[0];
    const I = massProps(r.shape, 2).inertia;
    expect(r.velocity.y).toBeCloseTo(2, 12);
    expect(r.angularVelocity).toBeCloseTo((0.5 * 4) / I, 12);
  });

  it("PHY-004 without contacts, a step changes position only by velocity × dt", () => {
    const w = createWorld(1, [disc("a", { velocity: { x: 2, y: 1 } }), disc("b", { position: { x: 10, y: 0 }, velocity: { x: -1, y: 0 } })]);
    const before = structuredClone(w.bodies);
    run(w, 1);
    w.bodies.forEach((b, i) => {
      expect(b.velocity).toEqual(before[i].velocity);
      expect(b.position.x).toBe(before[i].position.x + before[i].velocity.x * dt);
      expect(b.position.y).toBe(before[i].position.y + before[i].velocity.y * dt);
    });
  });
});

describe("narrow phase", () => {
  const at = (shape: BodyInput["shape"], x: number, y: number, angle = 0) => ({ shape, position: { x, y }, rot: sinCos(angle) });
  const D = { kind: "disc", radius: 0.5 } as const;
  const B = { kind: "box", width: 2, height: 1 } as const;

  it("COL-001 disc–disc gives one point with the right separation and normal", () => {
    const m = collide(at(D, 0, 0), at(D, 0.9, 0), 0, 0.001)!;
    expect(m.normal).toEqual({ x: 1, y: 0 });
    expect(m.points).toHaveLength(1);
    expect(m.points[0].separation).toBeCloseTo(-0.1, 12);
    expect(m.points[0].point.x).toBeCloseTo(0.45, 12);
    expect(collide(at(D, 0, 0), at(D, 1.2, 0), 0.1, 0.001)).toBeNull();
    expect(collide(at(D, 0, 0), at(D, 1.05, 0), 0.1, 0.001)!.points[0].separation).toBeCloseTo(0.05, 12);
  });

  it("COL-001 box–disc on a face and at a corner", () => {
    const face = collide(at(B, 0, 0), at(D, 0, 0.9), 0, 0.001)!;
    expect(face.normal.y).toBeCloseTo(1, 12);
    expect(face.points[0].separation).toBeCloseTo(-0.1, 12);
    const corner = collide(at(B, 0, 0), at(D, 1.3, 0.8), 0, 0.001)!;
    expect(corner.normal.x).toBeCloseTo(Math.SQRT1_2, 12);
    expect(corner.normal.y).toBeCloseTo(Math.SQRT1_2, 12);
    expect(corner.points[0].separation).toBeCloseTo(Math.hypot(0.3, 0.3) - 0.5, 12);
    const flipped = collide(at(D, 0, 0.9), at(B, 0, 0), 0, 0.001)!;
    expect(flipped.normal.y).toBeCloseTo(-1, 12);
  });

  it("COL-001 box resting on a box gives two contact points", () => {
    const m = collide(at(B, 0, 0), at({ kind: "box", width: 1, height: 1 }, 0.2, 0.99), 0, 0.001)!;
    expect(m.normal.y).toBeCloseTo(1, 12);
    expect(m.points).toHaveLength(2);
    for (const p of m.points) expect(p.separation).toBeCloseTo(-0.01, 12);
    expect(m.points.map((p) => p.point.x).sort()).toEqual([expect.closeTo(-0.3, 12), expect.closeTo(0.7, 12)]);
  });

  it("COL-001 triangle polygon against a rotated box", () => {
    const tri: BodyInput["shape"] = { kind: "polygon", vertices: [{ x: -0.5, y: -0.3 }, { x: 0.5, y: -0.3 }, { x: 0, y: 0.6 }] };
    const m = collide(at(tri, 0, 0), at(B, 0, 1.0, 0.3), 0, 0.001);
    expect(m).not.toBeNull();
    expect(m!.points.length).toBeGreaterThanOrEqual(1);
    expect(m!.normal.y).toBeGreaterThan(0);
  });
});

describe("contact solver", () => {
  const momentum = (w: World) => computeTotals(w);

  it("COL-002 random collisions between free bodies conserve momentum and angular momentum and never add energy", () => {
    const shape = fc.oneof(
      fc.record({ kind: fc.constant("disc" as const), radius: fc.double({ min: 0.1, max: 1, noNaN: true }) }),
      fc.record({ kind: fc.constant("box" as const), width: fc.double({ min: 0.2, max: 2, noNaN: true }), height: fc.double({ min: 0.2, max: 2, noNaN: true }) }),
    );
    const body = (id: string, x: number) =>
      fc.record({
        shape,
        mass: fc.double({ min: 0.1, max: 10, noNaN: true }),
        restitution: fc.double({ min: 0, max: 1, noNaN: true }),
        friction: fc.double({ min: 0, max: 1, noNaN: true }),
        y: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
        vx: fc.double({ min: 0.5, max: 5, noNaN: true }),
        angle: fc.double({ min: -3, max: 3, noNaN: true }),
        w: fc.double({ min: -3, max: 3, noNaN: true }),
      }).map((r) => ({ ...disc(id), shape: r.shape, mass: r.mass, restitution: r.restitution, friction: r.friction, position: { x, y: r.y }, velocity: { x: x < 0 ? r.vx : -r.vx, y: 0 }, angle: r.angle, angularVelocity: r.w }));
    fc.assert(
      fc.property(body("a", -2), body("b", 2), (a, b) => {
        const w = createWorld(1, [a, b]);
        const before = momentum(w);
        run(w, 480);
        const after = momentum(w);
        const scaleP = 1 + Math.abs(before.momentum.x) + Math.abs(before.momentum.y);
        expect(Math.abs(after.momentum.x - before.momentum.x)).toBeLessThan(1e-9 * scaleP);
        expect(Math.abs(after.momentum.y - before.momentum.y)).toBeLessThan(1e-9 * scaleP);
        expect(w.ledger.violations).toBe(0);
        expect(after.energy.kinetic).toBeLessThanOrEqual(before.energy.kinetic * (1 + 1e-9) + 1e-12);
        expect(after.energy.total).toBeCloseTo(before.energy.total, 6);
      }),
      { numRuns: 60 },
    );
  });

  it("COL-002 restitution 1 and no friction: head-on discs swap to the closed-form velocities", () => {
    const w = createWorld(1, [
      disc("a", { mass: 1, restitution: 1, friction: 0, position: { x: -3, y: 0 }, velocity: { x: 2, y: 0 } }),
      disc("b", { mass: 3, restitution: 1, friction: 0, position: { x: 3, y: 0 }, velocity: { x: -1, y: 0 } }),
    ]);
    run(w, 600);
    expect(w.bodies[0].velocity.x).toBeCloseTo(-2.5, 12);
    expect(w.bodies[1].velocity.x).toBeCloseTo(0.5, 12);
    expect(w.ledger.thermal).toBeCloseTo(0, 12);
  });

  it("COL-002 restitution 0 makes equal discs move off together", () => {
    const w = createWorld(1, [
      disc("a", { restitution: 0, friction: 0, position: { x: -2, y: 0 }, velocity: { x: 2, y: 0 } }),
      disc("b", { restitution: 0, friction: 0, position: { x: 2, y: 0 } }),
    ]);
    run(w, 600);
    expect(w.bodies[0].velocity.x).toBeCloseTo(1, 9);
    expect(w.bodies[1].velocity.x).toBeCloseTo(1, 9);
    expect(w.ledger.thermal).toBeCloseTo(1, 9); // ½·1·2² − ½·2·1²
  });

  it("COL-002 friction spins up a sliding disc on a fixed floor", () => {
    const w = createWorld(
      1,
      [box("floor", 20, 1, { fixed: true, position: { x: 0, y: -0.5 }, friction: 0.5 }), disc("a", { position: { x: 0, y: 0.5 }, velocity: { x: 3, y: 0 }, friction: 0.5, restitution: 0 })],
      { x: 0, y: -9.81 },
    );
    run(w, 480);
    const a = w.bodies.find((b) => b.id === "a")!;
    // Rolls without slipping once friction has done its work: v = −ω r, v = (2/3)·v0 for a disc.
    expect(a.velocity.x).toBeCloseTo(2, 2);
    expect(a.angularVelocity).toBeCloseTo(-4, 1);
  });

  it("COL-006 contacts record their impulse and the energy each turned into heat", () => {
    const w = createWorld(1, [
      disc("a", { restitution: 0.5, friction: 0, position: { x: -0.6, y: 0 }, velocity: { x: 1, y: 0 } }),
      disc("b", { restitution: 0.5, friction: 0, position: { x: 0.6, y: 0 } }),
    ]);
    const ke0 = computeTotals(w).energy.kinetic;
    let lost = 0;
    let impulse = 0;
    for (let i = 0; i < 120; i++) {
      run(w, 1);
      for (const c of w.contacts) {
        lost += c.energyLost;
        impulse += c.normalImpulse;
      }
    }
    expect(impulse).toBeGreaterThan(0);
    expect(lost).toBeCloseTo(ke0 - computeTotals(w).energy.kinetic, 9);
    expect(w.events.some((e) => e.type === "collision")).toBe(true);
  });
});

describe("ledger", () => {
  it("LED-001 totals cover mass, momentum, angular momentum about the origin and energy by form", () => {
    const w = createWorld(1, [disc("a", { mass: 2, position: { x: 0, y: 3 }, velocity: { x: 1, y: 0 }, angularVelocity: 1 })], { x: 0, y: -10 });
    const t = computeTotals(w);
    expect(t.mass).toBe(2);
    expect(t.momentum).toEqual({ x: 2, y: 0 });
    expect(t.angularMomentum).toBeCloseTo(2 * (0 * 0 - 3 * 1) + 0.5 * 2 * 0.25 * 1, 12);
    expect(t.energy.kinetic).toBeCloseTo(1 + 0.5 * 0.25, 12);
    expect(t.energy.potential).toBeCloseTo(60, 12);
  });

  it("LED-002 gravity, fixed contacts and user impulses are each attributed to their source", () => {
    const w = createWorld(
      1,
      [box("floor", 10, 1, { fixed: true, position: { x: 0, y: -0.5 } }), disc("a", { position: { x: 0, y: 0.5 }, restitution: 0 })],
      { x: 0, y: -10 },
    );
    run(w, 240);
    stepInPlace(w, [{ type: "body.impulse", id: "a", impulse: { x: 3, y: 0 }, point: { x: 0, y: 0.5 } }], test);
    const s = w.ledger.last!.sources;
    expect(s.field.momentumY).toBeCloseTo(-10 * dt, 12);
    expect(s.contact.momentumY).toBeCloseTo(10 * dt, 6); // the floor holds the disc up
    expect(s.user.momentumX).toBeCloseTo(3, 12);
    expect(w.ledger.violations).toBe(0);
    expect(Math.abs(w.ledger.last!.residual.momentumX)).toBeLessThan(1e-12);
  });

  it("LED-003 an unattributed change is recorded as a violation naming the step, quantity, size and entities", () => {
    const w = createWorld(1, [disc("a"), disc("b", { position: { x: 5, y: 0 } })]);
    run(w, 3);
    stepInPlace(w, [{ type: "debug.kick", id: "b", dv: { x: 0.25, y: 0 } }], test);
    const v = w.events.filter((e) => e.type === "violation");
    expect(w.ledger.violations).toBeGreaterThanOrEqual(2);
    expect(v.map((e) => e.data.quantity)).toEqual(expect.arrayContaining(["momentum", "energy"]));
    const m = v.find((e) => e.data.quantity === "momentum")!;
    expect(m.tick).toBe(4);
    expect(m.data.magnitude).toBeCloseTo(0.25, 12);
    expect(m.data.entities).toBe("b");
  });

  it("LED-004 per-subsystem timings are reported through an injected clock", () => {
    const w = createWorld(1, [disc("a")]);
    let t = 0;
    const out: Record<string, number> = {};
    stepInPlace(w, [], test, { clock: () => (t += 1), out });
    expect(Object.keys(out)).toEqual(["commands", "forces", "contacts", "integrate", "gas", "ledger"]);
    expect(Object.values(out).every((x) => x === 1)).toBe(true);
  });
});

describe("broad phase", () => {
  const randomBoxes = (n: number, seed: number) => {
    let s = seed;
    const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const side = Math.sqrt(n) * 4; // constant density: about one body per 16 m²
    return Array.from({ length: n }, () => {
      const x = r() * side;
      const y = r() * side;
      const h = 0.3 + r() * 0.7;
      return { minX: x - h, minY: y - h, maxX: x + h, maxY: y + h };
    });
  };

  it("NFR-003 finds exactly the overlapping pairs (checked by brute force)", () => {
    const boxes = randomBoxes(400, 7);
    const brute: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY) brute.push(`${i},${j}`);
      }
    expect(broadPhase(boxes).map((p) => p.join(","))).toEqual(brute.sort((p, q) => {
      const [a, b] = p.split(",").map(Number);
      const [c, d] = q.split(",").map(Number);
      return a - c || b - d;
    }));
  });

  it("NFR-003 work grows sub-quadratically from 100 to 1,000 to 5,000 bodies", () => {
    // Best of several runs, so a busy machine doesn't skew one measurement.
    const time = (n: number) => {
      const boxes = randomBoxes(n, 3);
      let best = Infinity;
      for (let k = 0; k < 7; k++) {
        const t0 = performance.now();
        broadPhase(boxes);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    time(1000); // warm up the JIT
    const t1k = time(1000);
    const t5k = time(5000);
    // Quadratic would be 25×; sort-and-sweep at constant density is ~n log n (≈ 6×).
    expect(t5k / t1k).toBeLessThan(18);
    expect(broadPhase(randomBoxes(5000, 3)).length).toBeLessThan(5000 * 3);
    expect(broadPhase(randomBoxes(100, 3)).length).toBeLessThan(100 * 3);
  });
});
