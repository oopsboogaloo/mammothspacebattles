// Ropes (ROP-001…ROP-008; src/core/rope.ts): a segmented rope from a body to what it has caught.
import { describe, expect, it } from "vitest";
import { castRope, createWorld, getProfile, hashValue, releaseRope, ropeLength, stepInPlace, type BodyInput, type World } from "../../src/core/index.ts";

const sandbox = getProfile("sandbox");
const still = { velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 };
const beam: BodyInput = { id: "beam", fixed: true, mass: 1, shape: { kind: "box", width: 4, height: 0.5 }, position: { x: 0, y: 10 }, ...still };
const ball = (x: number, y: number): BodyInput => ({ id: "ball", mass: 100, friction: 0, restitution: 0, shape: { kind: "disc", radius: 1 }, position: { x, y }, ...still });
const G = { x: 0, y: -100 };
const run = (w: World, seconds: number, each?: (i: number) => void) => {
  for (let i = 0; i < Math.round(seconds * 240); i++) {
    stepInPlace(w, [], sandbox);
    each?.(i);
  }
};
const at = (w: World, id = "ball") => w.bodies.find((b) => b.id === id)!;
const unit = (x: number, y: number) => ({ x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) });
/** A ball below and to the left of a beam, its rope cast at the beam's middle. */
function hung(spec: { range?: number } = {}) {
  const w = createWorld(1, [beam, ball(-6, 4)], G);
  castRope(w, "r", at(w), unit(6, 5.75), { speed: 120, range: spec.range ?? 14 });
  return w;
}

describe("ropes", () => {
  it("ROP-002 a cast rope's far end flies out and catches the first thing it hits; the rope then lies straight from it to its holder", () => {
    const w = hung();
    expect(w.ropes![0].mode).toBe("cast");
    run(w, 0.1);
    const r = w.ropes![0];
    expect(r.mode).toBe("held");
    expect(r.anchor!.body).toBe("beam");
    // On the beam's underside, about where it was aimed.
    expect(r.points[0].y).toBeGreaterThan(9.5);
    expect(r.points[0].y).toBeLessThan(9.76);
    expect(Math.abs(r.points[0].x)).toBeLessThan(0.5);
    expect(r.points.length).toBeGreaterThan(12);
    expect(ropeLength(r)).toBeGreaterThan(8);
    expect(ropeLength(r)).toBeLessThan(9);
  });

  it("ROP-003 cast further than it reaches, it comes back and is gone", () => {
    const w = hung({ range: 5 });
    run(w, 0.05);
    expect(w.ropes![0].mode).toBe("back");
    run(w, 0.2);
    expect(w.ropes).toEqual([]);
    // Nothing held the ball: it fell freely.
    expect(at(w).position.y).toBeLessThan(1.5);
  });

  it("ROP-001 a held rope keeps its holder within its length, and no nearer: the holder swings as on a pendulum, and comes back nearly as high", () => {
    const w = hung();
    run(w, 0.3);
    const r = () => w.ropes![0];
    const far = () => Math.hypot(at(w).position.x - r().points[0].x, at(w).position.y - r().points[0].y);
    let longest = 0;
    let highestRight = -Infinity;
    let lowest = Infinity;
    run(w, 1.2, () => {
      longest = Math.max(longest, far() - ropeLength(r()));
      lowest = Math.min(lowest, at(w).position.y);
      if (at(w).position.x > 0) highestRight = Math.max(highestRight, at(w).position.y);
    });
    expect(longest).toBeLessThan(0.01);
    // It began 4 m up on the left, and hangs 8.6 m under the beam at its lowest.
    expect(lowest).toBeLessThan(1.3);
    expect(lowest).toBeGreaterThan(0.9);
    expect(highestRight).toBeGreaterThan(3);
    expect(w.ledger.violations).toBe(0);
  });

  it("ROP-001 a slack rope doesn't hold its holder: only pulled tight does it turn it", () => {
    // The ball right under the beam, thrown up: the rope goes slack and it falls back freely.
    const w = createWorld(1, [beam, ball(0, 3)], G);
    castRope(w, "r", at(w), { x: 0, y: 1 }, { speed: 120, range: 14 });
    run(w, 0.1);
    at(w).velocity = { x: 0, y: 20 };
    w.ledger.totals = { ...w.ledger.totals };
    let top = 0;
    run(w, 0.3, () => (top = Math.max(top, at(w).position.y)));
    // 20 m/s up under 100 m/s² is 2 m.
    expect(top).toBeGreaterThan(4.7);
    expect(top).toBeLessThan(5.2);
  });

  it("ROP-004 a rope bends round what is in its way: over a corner, it holds its holder by its length along the bend", () => {
    // A block whose top-right corner is at the origin; the ball above its edge casts onto its top, then drops off the side.
    const block: BodyInput = { id: "block", fixed: true, mass: 1, friction: 0, restitution: 0, shape: { kind: "box", width: 10, height: 10 }, position: { x: -5, y: -5 }, ...still };
    const w = createWorld(1, [block, ball(1.3, 1.5)], G);
    castRope(w, "r", at(w), unit(-5.3, -1.45), { speed: 120, range: 14 });
    run(w, 0.1);
    const r = () => w.ropes![0];
    expect(r().mode).toBe("held");
    expect(r().anchor!.body).toBe("block");
    const length = ropeLength(r());
    run(w, 3);
    const b = at(w).position;
    const pin = r().points[0];
    // Hanging at rest beside the block, below its top.
    expect(Math.hypot(at(w).velocity.x, at(w).velocity.y)).toBeLessThan(1);
    expect(b.y).toBeLessThan(-0.3);
    expect(b.y).toBeGreaterThan(-length);
    // The straight line from the rope's end to the ball is shorter than the rope: it goes round the corner.
    expect(length - Math.hypot(b.x - pin.x, b.y - pin.y)).toBeGreaterThan(0.15);
    // And the rope lies along the block's top and passes its corner: no point is inside the block.
    expect(r().points.some((p) => Math.hypot(p.x, p.y) < 0.6)).toBe(true);
    expect(r().points.every((p) => !(p.x < -0.02 && p.y < -0.02))).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });

  it("ROP-005 reeled in it lifts its holder, paid out it lowers it, between its least length and its reach", () => {
    const w = createWorld(1, [beam, ball(0, 3)], G);
    castRope(w, "r", at(w), { x: 0, y: 1 }, { speed: 120, range: 9, least: 2 });
    run(w, 0.5);
    const r = () => w.ropes![0];
    const before = at(w).position.y;
    r().reel = -4;
    run(w, 0.5);
    expect(at(w).position.y - before).toBeGreaterThan(1.8);
    expect(at(w).position.y - before).toBeLessThan(2.2);
    run(w, 2);
    expect(ropeLength(r())).toBeCloseTo(2, 6);
    r().reel = 4;
    run(w, 4);
    expect(ropeLength(r())).toBeCloseTo(9, 6);
    expect(at(w).position.y).toBeLessThan(1.2);
    expect(w.ledger.violations).toBe(0);
  });

  it("ROP-006 let go, it comes back to its holder and is gone; the holder falls free", () => {
    const w = hung();
    run(w, 0.6);
    releaseRope(w.ropes![0]);
    run(w, 1 / 240);
    expect(w.ropes![0].mode).toBe("back");
    expect(w.ropes![0].anchor).toBeUndefined();
    run(w, 0.2);
    expect(w.ropes).toEqual([]);
    const v = at(w).velocity.y;
    run(w, 0.1);
    expect(at(w).velocity.y - v).toBeCloseTo(-10, 1);
  });

  it("ROP-007 what it has caught being taken out of the world lets it go", () => {
    const w = hung();
    run(w, 0.3);
    w.bodies = w.bodies.filter((b) => b.id !== "beam");
    run(w, 0.3);
    expect(w.ropes).toEqual([]);
  });

  it("ROP-008 a run with a rope and its replay agree exactly", () => {
    const play = () => {
      const w = hung();
      run(w, 0.5);
      w.ropes![0].reel = -3;
      run(w, 0.5);
      releaseRope(w.ropes![0]);
      run(w, 0.3);
      return hashValue(w);
    };
    expect(play()).toBe(play());
  });
});
