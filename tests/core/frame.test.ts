// A rotating frame (FLT-017; Chloe, 14 November 2026: Mammoth Thrust's level 7 turns): the world is
// simulated in a frame turning about a centre; everything free feels its Coriolis and centrifugal forces.
import { describe, expect, it } from "vitest";
import { createWorld, getProfile, stepInPlace, type World } from "../../src/core/index.ts";

const P = getProfile("sandbox");
const omega = -(2 * Math.PI) / 60; // clockwise, a turn a game minute
/** A point and velocity in the frame, as seen from outside it (turned by Ω·t). */
function outside(w: World, p: { x: number; y: number }, v: { x: number; y: number }) {
  const t = omega * w.time;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const vin = { x: v.x - omega * p.y, y: v.y + omega * p.x };
  return { p: { x: c * p.x - s * p.y, y: s * p.x + c * p.y }, v: { x: c * vin.x - s * vin.y, y: s * vin.x + c * vin.y } };
}
const ball = (at: { x: number; y: number }, v: { x: number; y: number }, w = 0) => ({ id: "b", shape: { kind: "disc" as const, radius: 0.5 }, mass: 1, position: at, velocity: v, angle: 0, angularVelocity: w });

describe("rotating frame", () => {
  it("FLT-017 a body at rest outside the frame stays at rest as the frame turns under it (half a turn), and the ledger is exact", () => {
    const at = { x: 30, y: 10 };
    // At rest outside, it moves in the frame at −Ω×r and spins at −Ω.
    const w = createWorld(1, [ball(at, { x: omega * at.y, y: -omega * at.x }, -omega)], { x: 0, y: 0 }, { frame: { centre: { x: 0, y: 0 }, omega } }, P);
    for (let i = 0; i < 240 * 30; i++) stepInPlace(w, [], P);
    const b = w.bodies[0];
    const o = outside(w, b.position, b.velocity);
    expect(Math.hypot(o.p.x - at.x, o.p.y - at.y)).toBeLessThan(0.15); // 31.6 m out, half a turn later
    expect(Math.hypot(o.v.x, o.v.y)).toBeLessThan(0.01);
    expect(b.angularVelocity).toBeCloseTo(-omega, 9);
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-017 a body moving straight outside the frame keeps its speed, and fixed bodies feel nothing", () => {
    const at = { x: -20, y: 5 };
    const vin = { x: 3, y: 1 };
    const w = createWorld(1, [ball(at, { x: vin.x + omega * at.y, y: vin.y - omega * at.x }), { id: "rock", fixed: true, shape: { kind: "box", width: 2, height: 2 }, mass: 1, position: { x: 50, y: 50 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 }], { x: 0, y: 0 }, { frame: { centre: { x: 0, y: 0 }, omega } }, P);
    for (let i = 0; i < 240 * 10; i++) stepInPlace(w, [], P);
    const b = w.bodies.find((x) => x.id === "b")!;
    const o = outside(w, b.position, b.velocity);
    expect(Math.hypot(o.v.x, o.v.y)).toBeCloseTo(Math.hypot(vin.x, vin.y), 2);
    // Ten seconds of straight flight from where it started.
    expect(Math.hypot(o.p.x - (at.x + vin.x * 10), o.p.y - (at.y + vin.y * 10))).toBeLessThan(0.15);
    const rock = w.bodies.find((x) => x.id === "rock")!;
    expect(rock.position).toEqual({ x: 50, y: 50 });
    expect(w.ledger.violations).toBe(0);
  });
});
