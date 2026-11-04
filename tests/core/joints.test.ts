import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  assemblyOf,
  assemblyProps,
  bodyMass,
  computeTotals,
  controlInputs,
  createWorld,
  getProfile,
  massProps,
  stepInPlace,
  type JointInput,
  type World,
} from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

const test = getProfile("test");
const dt = test.timestep;
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) stepInPlace(w, [], test);
};
const weld = (id: string, a: string, b: string, anchorA: { x: number; y: number }, anchorB: { x: number; y: number }, limits?: JointInput["limits"]): JointInput => ({ id, a, b, anchorA, anchorB, limits });

/** Two 1 kg unit boxes side by side, welded at the shared face. */
function pair(extra: Partial<Parameters<typeof box>[3]> = {}) {
  return createWorld(1, [box("a", 1, 1, { position: { x: -0.5, y: 0 }, ...extra }), box("b", 1, 1, { position: { x: 0.5, y: 0 }, ...extra })], { x: 0, y: 0 }, { joints: [weld("j", "a", "b", { x: 0.5, y: 0 }, { x: -0.5, y: 0 })] });
}

describe("assemblies", () => {
  it("ORC-004 ASM-001 assembly mass, centre of mass and inertia match hand-computed values (parallel axis)", () => {
    const w = pair();
    const parts = assemblyOf(w, "a").map((id) => {
      const b = w.bodies.find((x) => x.id === id)!;
      return { mass: bodyMass(b), inertia: massProps(b.shape, bodyMass(b)).inertia, position: b.position };
    });
    const p = assemblyProps(parts);
    expect(p.mass).toBe(2);
    expect(p.centreOfMass.x).toBeCloseTo(0, 12);
    // Each box: m(w²+h²)/12 = 1/6 about its centre, plus m·d² = 0.25 about the assembly centre.
    expect(p.inertia).toBeCloseTo(2 * (1 / 6 + 0.25), 12);
    // Same as one 2 × 1 box of 2 kg: 2(4+1)/12.
    expect(p.inertia).toBeCloseTo((2 * 5) / 12, 12);
  });

  it("ASM-001 a welded pair spins as one rigid body, conserving angular momentum", () => {
    const w = pair();
    // Give the assembly a rigid spin about its centre: v = ω × r.
    const omega = 2;
    w.bodies[0].angularVelocity = omega;
    w.bodies[1].angularVelocity = omega;
    w.bodies[0].velocity = { x: 0, y: -omega * 0.5 };
    w.bodies[1].velocity = { x: 0, y: omega * 0.5 };
    w.ledger.totals = computeTotals(w);
    const L0 = w.ledger.totals.angularMomentum;
    run(w, 2400);
    const [a, b] = w.bodies;
    const d = Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
    expect(d).toBeCloseTo(1, 3);
    expect(b.angle - a.angle).toBeCloseTo(0, 3);
    expect(a.angularVelocity).toBeCloseTo(omega, 2);
    expect(computeTotals(w).angularMomentum).toBeCloseTo(L0, 6);
    expect(w.ledger.violations).toBe(0);
  });

  it("ASM-003 a spinning assembly's joint carries the centripetal tension m·ω²·r, and spinning too fast breaks it", () => {
    const spin = (omega: number, tension?: number) => {
      const w = createWorld(1, [box("a", 1, 1, { position: { x: -0.5, y: 0 } }), box("b", 1, 1, { position: { x: 0.5, y: 0 } })], { x: 0, y: 0 }, { joints: [weld("j", "a", "b", { x: 0.5, y: 0 }, { x: -0.5, y: 0 }, tension ? { tension } : undefined)] });
      w.bodies.forEach((b) => {
        b.angularVelocity = omega;
        b.velocity = { x: 0, y: omega * b.position.x };
      });
      w.ledger.totals = computeTotals(w);
      return w;
    };
    const w = spin(2);
    run(w, 240);
    expect(w.joints[0].load.tension).toBeCloseTo(1 * 2 * 2 * 0.5, 3); // 2 N
    // The step's centripetal impulse points half a step's rotation from the end-of-step axis: shear ≈ F·ω·dt/2.
    expect(w.joints[0].load.shear).toBeLessThanOrEqual(2 * (2 * dt) / 2 + 1e-9);
    const fast = spin(10, 40); // needs 50 N
    run(fast, 2);
    expect(fast.events.find((e) => e.type === "joint.break")?.data.quantity).toBe("tension");
    run(fast, 240);
    expect(fast.ledger.violations).toBe(0);
  });

  it("parts of the same assembly don't collide with each other", () => {
    const w = createWorld(1, [box("a", 1, 1), box("b", 1, 1, { position: { x: 0.8, y: 0 } })], { x: 0, y: 0 }, { joints: [weld("j", "a", "b", { x: 0.4, y: 0 }, { x: -0.4, y: 0 })] });
    run(w, 120);
    expect(w.contacts).toHaveLength(0);
    expect(w.bodies[1].position.x - w.bodies[0].position.x).toBeCloseTo(0.8, 3);
  });

  it("ASM-002 when a store's contents change, mass properties update before the next step", () => {
    const w = createWorld(1, [box("tank", 1, 1, { contents: [{ resource: "fuel", mass: 4, capacity: 10 }] })]);
    expect(w.ledger.totals.mass).toBe(5);
    stepInPlace(w, [{ type: "body.set", id: "tank", patch: { contents: [{ resource: "fuel", mass: 9, capacity: 10 }] } }], test);
    expect(w.ledger.totals.mass).toBe(10);
    // An impulse now moves 10 kg, not 5.
    stepInPlace(w, [{ type: "body.impulse", id: "tank", impulse: { x: 10, y: 0 }, point: { x: 0, y: 0 } }], test);
    expect(w.bodies[0].velocity.x).toBeCloseTo(1, 12);
  });
});

describe("joints", () => {
  const hanging = (limits?: JointInput["limits"]) =>
    createWorld(
      1,
      [box("ceiling", 4, 0.2, { fixed: true, position: { x: 0, y: 0.1 } }), box("weight", 0.5, 0.5, { mass: 3, position: { x: 0, y: -0.25 } })],
      { x: 0, y: -10 },
      { joints: [weld("rope", "ceiling", "weight", { x: 0, y: -0.1 }, { x: 0, y: 0.25 }, limits)] },
    );

  it("ASM-003 a joint records its load: a hanging 3 kg weight pulls with m·g of tension", () => {
    const w = hanging();
    run(w, 240);
    const j = w.joints[0];
    expect(j.load.tension).toBeCloseTo(30, 1);
    expect(j.load.compression).toBe(0);
    expect(j.load.shear).toBeLessThan(0.1);
    expect(j.load.fraction).toBeCloseTo(30 / j.limits.tension, 3);
    expect(w.bodies.find((b) => b.id === "weight")!.position.y).toBeCloseTo(-0.25, 3);
    expect(w.ledger.violations).toBe(0);
  });

  it("ASM-004 a joint breaks when a load passes its limit, and the event says which", () => {
    const w = hanging({ tension: 25 });
    run(w, 60);
    expect(w.joints).toHaveLength(0);
    const e = w.events.find((x) => x.type === "joint.break")!;
    expect(e.data).toMatchObject({ id: "rope", quantity: "tension" });
    expect(Number(e.data.load)).toBeGreaterThan(25);
    run(w, 120);
    expect(w.bodies.find((b) => b.id === "weight")!.velocity.y).toBeLessThan(-1); // now falling
  });

  it("ASM-004 shear and torque limits break joints too", () => {
    const w = hanging({ torque: 1 });
    stepInPlace(w, [{ type: "body.impulse", id: "weight", impulse: { x: 2, y: 0 }, point: { x: 0, y: -0.25 } }], test);
    run(w, 5);
    expect(w.events.find((x) => x.type === "joint.break")?.data.quantity).toMatch(/torque|shear/);
  });

  it("ASM-005 when joints break, the parts become separate assemblies and momentum and angular momentum are conserved", () => {
    fc.assert(
      fc.property(fc.double({ min: -20, max: 20, noNaN: true }), fc.double({ min: -20, max: 20, noNaN: true }), fc.double({ min: -0.5, max: 0.5, noNaN: true }), (jx, jy, at) => {
        const w = createWorld(
          1,
          [0, 1, 2].map((i) => box(`p${i}`, 1, 0.5, { position: { x: i, y: 0 } })),
          { x: 0, y: 0 },
          { joints: [weld("j01", "p0", "p1", { x: 0.5, y: 0 }, { x: -0.5, y: 0 }, { tension: 30, compression: 30, shear: 30, torque: 10 }), weld("j12", "p1", "p2", { x: 0.5, y: 0 }, { x: -0.5, y: 0 })] },
        );
        stepInPlace(w, [{ type: "body.impulse", id: "p2", impulse: { x: jx, y: jy }, point: { x: 2 + at, y: 0.25 } }], test);
        run(w, 240);
        expect(w.ledger.violations).toBe(0);
        const t = computeTotals(w);
        expect(t.momentum.x).toBeCloseTo(jx, 6);
        expect(t.momentum.y).toBeCloseTo(jy, 6);
        if (w.joints.length < 2) expect(assemblyOf(w, "p0")).not.toContain("p2");
      }),
      { numRuns: 40 },
    );
  });

  it("ASM-004 a weld breaking under an off-centre hit creates no kinetic energy", () => {
    // Found by the property above on CI: a chain of three, the weak weld between the first two.
    // Taking back the weak weld's excess after the solve gained up to 13% in kinetic energy.
    for (const jx of [0, 5, -10, 20])
      for (const jy of [-20, -5, -1.4459740393571492, 3, 15])
        for (const at of [-0.4, 0, 0.09563707261820766, 0.4]) {
          const w = createWorld(
            1,
            [0, 1, 2].map((i) => box(`p${i}`, 1, 0.5, { position: { x: i, y: 0 } })),
            { x: 0, y: 0 },
            { joints: [weld("j01", "p0", "p1", { x: 0.5, y: 0 }, { x: -0.5, y: 0 }, { tension: 30, compression: 30, shear: 30, torque: 10 }), weld("j12", "p1", "p2", { x: 0.5, y: 0 }, { x: -0.5, y: 0 })] },
          );
          stepInPlace(w, [{ type: "body.impulse", id: "p2", impulse: { x: jx, y: jy }, point: { x: 2 + at, y: 0.25 } }], test);
          expect(w.ledger.violations, `${jx} ${jy} ${at}`).toBe(0);
          expect(w.ledger.totals.energy.kinetic).toBeLessThanOrEqual(w.ledger.last!.sources.user.energy + 1e-9);
          const brk = w.events.find((e) => e.type === "joint.break");
          if (brk) expect(Number(brk.data.load)).toBeGreaterThan(Number(brk.data.limit) * (1 - 1e-9)); // the demand, at least the limit
        }
  });

  it("SBX-015 detaching a part removes its joints; it keeps its momentum", () => {
    const w = pair();
    w.bodies.forEach((b) => (b.velocity = { x: 1, y: 0.5 }));
    w.ledger.totals = computeTotals(w);
    stepInPlace(w, [{ type: "body.detach", id: "b" }], test);
    expect(w.joints).toHaveLength(0);
    expect(w.bodies[1].velocity).toEqual({ x: 1, y: 0.5 });
    expect(assemblyOf(w, "a")).toEqual(["a"]);
  });

  it("joint commands validate their bodies and ids", () => {
    const w = pair();
    expect(() => stepInPlace(w, [{ type: "joint.add", joint: weld("j", "a", "b", { x: 0, y: 0 }, { x: 0, y: 0 }) }], test)).toThrow(/Duplicate joint/);
    expect(() => stepInPlace(w, [{ type: "joint.add", joint: weld("k", "a", "a", { x: 0, y: 0 }, { x: 0, y: 0 }) }], test)).toThrow(/two different bodies/);
    expect(() => stepInPlace(w, [{ type: "joint.remove", id: "zz" }], test)).toThrow(/No joint/);
    stepInPlace(w, [{ type: "joint.set", id: "j", limits: { tension: 1 } }], test);
    expect(w.joints[0].limits.tension).toBe(1);
  });
});

describe("links", () => {
  const tanks = () =>
    createWorld(
      1,
      [
        box("left", 1, 1, { position: { x: -1, y: 0 }, contents: [{ resource: "fuel", mass: 8, capacity: 10 }] }),
        box("right", 1, 1, { position: { x: 1, y: 0 }, contents: [{ resource: "fuel", mass: 0, capacity: 10 }] }),
        disc("engine", { position: { x: 0, y: -2 } }),
      ],
      { x: 0, y: 0 },
      { joints: [weld("j", "left", "right", { x: 1, y: 0 }, { x: -1, y: 0 })] },
    );

  it("ASM-006 links have zero mass; control links carry channel values to a component", () => {
    const w = tanks();
    const m0 = computeTotals(w).mass;
    stepInPlace(w, [{ type: "link.add", link: { id: "c1", kind: "control", channel: "main", to: "engine" } }], test);
    expect(computeTotals(w).mass).toBe(m0);
    expect(controlInputs(w, "engine")).toEqual({ main: 0 });
    stepInPlace(w, [{ type: "control.set", channel: "main", value: 0.75 }], test);
    expect(controlInputs(w, "engine")).toEqual({ main: 0.75 });
    stepInPlace(w, [{ type: "link.remove", id: "c1" }], test);
    expect(controlInputs(w, "engine")).toEqual({});
  });

  it("ASM-006 feed links move a resource between stores at up to their rate, shifting the centre of mass", () => {
    const w = tanks();
    stepInPlace(w, [{ type: "link.add", link: { id: "f1", kind: "feed", from: "left", to: "right", resource: "fuel", rate: 2 } }], test);
    run(w, 240);
    const [left, right] = w.bodies.filter((b) => b.id !== "engine");
    expect(left.contents![0].mass).toBeCloseTo(8 - 2 * (241 * dt), 9);
    expect(right.contents![0].mass).toBeCloseTo(2 * (241 * dt), 9);
    expect(computeTotals(w).mass).toBeCloseTo(8 + 1 + 1 + 1, 12);
    expect(w.ledger.violations).toBe(0);
    run(w, 240 * 4);
    expect(left.contents![0].mass).toBe(0); // stops when empty
  });

  it("ASM-006 a feed link needs a matching store at both ends", () => {
    const w = tanks();
    expect(() => stepInPlace(w, [{ type: "link.add", link: { id: "f", kind: "feed", from: "left", to: "engine", resource: "fuel", rate: 1 } }], test)).toThrow(/store at both ends; engine has none/);
  });
});
