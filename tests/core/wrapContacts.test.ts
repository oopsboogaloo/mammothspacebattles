// Collisions across the edges of a wrapped world (FLT-015, Mammoth Asteroids).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { broadPhaseWrapped, createWorld, getProfile, hashValue, nearestOffset, stepInPlace, type BodyInput, type World } from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

const test = getProfile("test");
const BOUNDS = { min: { x: -10, y: -10 }, max: { x: 10, y: 10 }, wrap: true };
const W = 20;

/** Into the rectangle, as wrapping would put it. */
const wrapped = (p: { x: number; y: number }) => ({ x: p.x - W * Math.round(p.x / W), y: p.y - W * Math.round(p.y / W) });
const body = (w: World, id: string) => w.bodies.find((b) => b.id === id)!;

/** A pair closing on each other along `dir` through `at`, each `gap / 2` from it. */
function pair(kind: "disc" | "box", at: { x: number; y: number }, dir: number, gap: number, speed: number, spin: number, tilt: number): BodyInput[] {
  const n = { x: Math.cos(dir), y: Math.sin(dir) };
  const make = (id: string, s: number): BodyInput => {
    const over = {
      mass: id === "a" ? 1 : 2.5,
      position: wrapped({ x: at.x + (s * n.x * gap) / 2, y: at.y + (s * n.y * gap) / 2 }),
      velocity: { x: -s * n.x * speed, y: -s * n.y * speed },
      angle: id === "a" ? tilt : -0.5 * tilt,
      angularVelocity: s * spin,
      restitution: 0.4,
      friction: 0.5,
    };
    return kind === "disc" ? disc(id, over) : box(id, 0.9, 0.6, over);
  };
  return [make("a", -1), make("b", 1)];
}

function run(bodies: BodyInput[], steps: number): { w: World; touched: boolean; across: boolean } {
  const w = createWorld(1, bodies, { x: 0, y: 0 }, { bounds: BOUNDS }, test);
  let touched = false;
  let across = false;
  for (let i = 0; i < steps; i++) {
    stepInPlace(w, [], test);
    for (const c of w.contacts) {
      if (c.normalImpulse > 0) touched = true;
      if (c.shift) across = true;
    }
  }
  return { w, touched, across };
}

/** What a pair's motion is, wherever in the world it is: velocities, angles, and b from a. */
function motion(w: World): number[] {
  const a = body(w, "a");
  const b = body(w, "b");
  const d = nearestOffset(w, a.position, b.position);
  return [a.velocity.x, a.velocity.y, a.angularVelocity, a.angle, b.velocity.x, b.velocity.y, b.angularVelocity, b.angle, d.x, d.y];
}

describe("collisions across a wrapped world's edges", () => {
  const edges: [string, { x: number; y: number }, number][] = [
    ["the right edge", { x: 10, y: 3 }, 0],
    ["the left edge", { x: -10, y: -4 }, Math.PI],
    ["the top edge", { x: 2, y: 10 }, Math.PI / 2],
    ["the bottom edge", { x: -6, y: -10 }, -Math.PI / 2],
    ["a corner", { x: 10, y: 10 }, Math.PI / 4],
    ["the opposite corner", { x: -10, y: -10 }, (-3 * Math.PI) / 4],
  ];

  for (const kind of ["disc", "box"] as const) {
    it(`FLT-015 two ${kind === "disc" ? "discs" : "boxes"} meeting across an edge or a corner move exactly as the same pair away from the edges`, () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...edges),
          fc.double({ min: -0.6, max: 0.6, noNaN: true }), // off the edge's normal, rad
          fc.double({ min: -0.15, max: 0.15, noNaN: true }), // along the normal: the pair isn't centred on the edge, m (little enough that they meet across it)
          fc.double({ min: 2, max: 8, noNaN: true }), // closing speed of each, m/s
          fc.double({ min: -3, max: 3, noNaN: true }), // spin, rad/s
          fc.double({ min: -1, max: 1, noNaN: true }), // tilt, rad
          ([, at, dir], off, along, speed, spin, tilt) => {
            // Nothing exactly lined up: a hit that lands exactly on a step, or two faces exactly
            // parallel, goes one way or the other on the last bit of a position.
            const d = dir + off + 0.0071;
            const here = { x: at.x + along * Math.cos(dir), y: at.y + along * Math.sin(dir) };
            const edge = run(pair(kind, here, d, 1.9371, speed, spin, tilt + 0.0137), 120);
            const middle = run(pair(kind, { x: 0.3, y: -0.2 }, d, 1.9371, speed, spin, tilt + 0.0137), 120);
            expect(edge.touched).toBe(true);
            expect(edge.across).toBe(true);
            expect(middle.across).toBe(false);
            const m = motion(middle.w);
            motion(edge.w).forEach((v, i) => expect(v).toBeCloseTo(m[i], 7));
            expect(edge.w.ledger.violations).toBe(0);
          },
        ),
        { numRuns: 100 },
      );
    });
  }

  it("FLT-015 an elastic hit across an edge keeps momentum and energy, and the ledger is clean", () => {
    const a = disc("a", { mass: 1, position: { x: 9.2, y: 0.1 }, velocity: { x: 3, y: 0 }, restitution: 1, friction: 0 });
    const b = disc("b", { mass: 3, position: { x: -9.2, y: -0.2 }, velocity: { x: -1, y: 0.5 }, restitution: 1, friction: 0 });
    const w = createWorld(1, [a, b], { x: 0, y: 0 }, { bounds: BOUNDS }, test);
    const p0 = { x: 1 * 3 + 3 * -1, y: 3 * 0.5 };
    const e0 = 0.5 * 1 * 9 + 0.5 * 3 * (1 + 0.25);
    let hit = false;
    let contactL = 0;
    for (let i = 0; i < 120; i++) {
      stepInPlace(w, [], test);
      hit ||= w.events.some((e) => e.type === "collision");
      contactL += w.ledger.last!.sources.contact.angularMomentum;
    }
    expect(hit).toBe(true);
    const [va, vb] = [body(w, "a").velocity, body(w, "b").velocity];
    expect(va.x).toBeLessThan(0); // it bounced
    expect(1 * va.x + 3 * vb.x).toBeCloseTo(p0.x, 9);
    expect(1 * va.y + 3 * vb.y).toBeCloseTo(p0.y, 9);
    expect(0.5 * (va.x ** 2 + va.y ** 2) + 1.5 * (vb.x ** 2 + vb.y ** 2)).toBeCloseTo(e0, 9);
    // Angular momentum about the origin is not kept across an edge (the two sides of the contact are
    // a world apart); the ledger records what the contact changed.
    expect(Math.abs(contactL)).toBeGreaterThan(1);
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-015 a welded rock straddling an edge is hit, and damaged at the right place, from across it", () => {
    const material = { name: "rock", threshold: 0.1, toughness: 50 };
    // The rock's outer parts are past the right edge, so they are really at the left of the world.
    const rock: BodyInput[] = [
      box("r1", 1, 1, { mass: 20, position: { x: 8.9, y: 0 }, material }),
      box("r2", 1, 1, { mass: 5, position: { x: 9.9, y: 0 }, material }),
      box("r3", 1, 1, { mass: 5, position: { x: 8.9, y: 1 }, material }),
      box("r4", 1, 1, { mass: 5, position: { x: 9.9, y: 1 }, material }),
    ];
    const joints = [
      { id: "j12", a: "r1", b: "r2", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.5, y: 0 } },
      { id: "j13", a: "r1", b: "r3", anchorA: { x: 0, y: 0.5 }, anchorB: { x: 0, y: -0.5 } },
      { id: "j24", a: "r2", b: "r4", anchorA: { x: 0, y: 0.5 }, anchorB: { x: 0, y: -0.5 } },
    ];
    // The bullet sorts first, so the rock's part is the pair's second body: the one whose copy is hit.
    const bullet = disc("bullet", { mass: 1, shape: { kind: "disc", radius: 0.2 }, position: { x: -8.5, y: 0.3 }, velocity: { x: -12, y: 0 } });
    const w = createWorld(1, [bullet, ...rock], { x: 0, y: 0 }, { bounds: BOUNDS, joints }, test);
    let hit: { a: string; b: string } | undefined;
    for (let i = 0; i < 60 && !hit; i++) {
      stepInPlace(w, [], test);
      const e = w.events.find((x) => x.type === "collision");
      if (e) hit = { a: String(e.data.a), b: String(e.data.b) };
    }
    expect(hit).toEqual({ a: "bullet", b: "r2" });
    const c = w.contacts.find((k) => k.normalImpulse > 0)!;
    expect(c.shift).toEqual({ x: -20, y: 0 });
    expect(c.point.x).toBeCloseTo(-9.6, 1); // on the bullet's side: r2's right face, come round
    expect(body(w, "bullet").velocity.x).toBeGreaterThan(0); // it bounced off
    expect(body(w, "bullet").position.x).toBeLessThan(-8.5); // at the left of the world, where it was
    expect(body(w, "r2").integrity).toBeLessThan(1);
    expect(body(w, "r1").integrity).toBe(1);
    // r2 was hit on its right face at (10.4, 0.3): its weld to r4, half a metre from there, is
    // damaged; its weld to r1, a metre away at its left face, is not.
    expect(w.joints.find((j) => j.id === "j24")!.integrity).toBeLessThan(1);
    expect(w.joints.find((j) => j.id === "j12")!.integrity).toBe(1);
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-015 a box rests on fixed ground that reaches it only from across the edge", () => {
    // Ground at the left of the world, 1 m of it past the left edge: the crate stands at the right
    // edge, on that metre and the three before it as they come round.
    const ground = box("ground", 4, 1, { fixed: true, position: { x: -9, y: -5 } });
    const crate = box("crate", 1, 1, { mass: 2, position: { x: 9.6, y: -3.9 }, friction: 0.8 });
    const w = createWorld(1, [ground, crate], { x: 0, y: -9.81 }, { bounds: BOUNDS }, test);
    for (let i = 0; i < 480; i++) stepInPlace(w, [], test);
    const c = body(w, "crate");
    expect(c.position.y).toBeCloseTo(-4, 2);
    expect(Math.hypot(c.velocity.x, c.velocity.y)).toBeLessThan(1e-3);
    expect(w.contacts.some((k) => k.shift)).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-015 a pair that meets across an edge is found once, from either side, with the higher body's shift", () => {
    const bx = (x: number, y: number, r = 0.6) => ({ minX: x - r, maxX: x + r, minY: y - r, maxY: y + r });
    // 0 and 1 across the right/left edge (both boxes cross it); 2 and 3 across a corner; 4 alone.
    const boxes = [bx(9.7, 0), bx(-9.8, 0.2), bx(9.6, 9.7), bx(-9.7, -9.6), bx(0, 0)];
    expect(broadPhaseWrapped(boxes, BOUNDS)).toEqual([
      { i: 0, j: 1, sx: 20, sy: 0 },
      { i: 2, j: 3, sx: 20, sy: 20 },
    ]);
    // In the other order the shift is the other way.
    expect(broadPhaseWrapped([boxes[1], boxes[0]], BOUNDS)).toEqual([{ i: 0, j: 1, sx: -20, sy: 0 }]);
    // Two fixed bodies, or two of one assembly, are no pair across an edge either.
    expect(broadPhaseWrapped(boxes.slice(0, 2), BOUNDS, [true, true])).toEqual([]);
    expect(broadPhaseWrapped(boxes.slice(0, 2), BOUNDS, undefined, [0, 0])).toEqual([]);
  });

  it("FLT-015 away from the edges a wrapped world steps exactly as one that doesn't wrap", () => {
    const bodies = () => [
      ...pair("box", { x: 1, y: 2 }, 0.3, 2, 5, 2, 0.4),
      disc("c", { position: { x: -3, y: 2.2 }, velocity: { x: 6, y: 0 }, restitution: 0.8 }),
    ];
    const open = createWorld(1, bodies(), { x: 0, y: 0 }, { bounds: { ...BOUNDS, wrap: false } }, test);
    const round = createWorld(1, bodies(), { x: 0, y: 0 }, { bounds: BOUNDS }, test);
    for (let i = 0; i < 90; i++) {
      stepInPlace(open, [], test);
      stepInPlace(round, [], test);
    }
    expect(open.contacts.length + round.contacts.length).toBeGreaterThan(0);
    expect(hashValue(round.bodies)).toBe(hashValue(open.bodies));
    expect(hashValue(round.contacts)).toBe(hashValue(open.contacts));
  });
});
