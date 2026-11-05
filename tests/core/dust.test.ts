// Destroyed bodies leave the world in a puff of dust (DMG-007).
import { describe, expect, it } from "vitest";
import { computeTotals, createWorld, getProfile, stepInPlace } from "../../src/core/index.ts";
import { box, disc } from "../helpers.ts";

const test = getProfile("test");

describe("destroyed bodies (DMG-007)", () => {
  it("DMG-007 a body at 0 integrity leaves the world with its welds, in a burst of dust; the ledger records it leaving", () => {
    const w = createWorld(1, [
      box("a", 1, 1, { position: { x: 0, y: 0 }, velocity: { x: 2, y: 0 } } as never),
      box("b", 1, 1, { position: { x: 1, y: 0 }, velocity: { x: 2, y: 0 } } as never),
    ], { x: 0, y: 0 }, { joints: [{ id: "j", a: "a", b: "b", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.5, y: 0 } }] } as never);
    stepInPlace(w, [], test);
    const m0 = computeTotals(w).mass;
    w.bodies.find((b) => b.id === "b")!.integrity = 0;
    stepInPlace(w, [], test);
    expect(w.bodies.map((b) => b.id)).toEqual(["a"]);
    expect(w.joints).toEqual([]);
    expect(computeTotals(w).mass).toBeCloseTo(m0 - 1, 12);
    expect(w.ledger.last!.sources.boundary.mass).toBeCloseTo(-1, 12);
    expect(w.ledger.violations).toBe(0);
    expect(w.events.some((e) => e.type === "destroyed.removed" && e.data.id === "b")).toBe(true);
    // Dust where it was, moving with it on average, lasting 20–30 s.
    const dust = w.dust!;
    expect(dust.length).toBeGreaterThanOrEqual(10);
    const mx = dust.reduce((s, d) => s + d.position.x, 0) / dust.length;
    expect(Math.abs(mx - 1 - 2 / 240)).toBeLessThan(0.3);
    expect(dust.every((d) => d.life >= 20 && d.life <= 30)).toBe(true);
    // It drifts and fades: about half gone by 25 s, all by 30.
    const dt = test.timestep;
    for (let t = 0; t < 25; t += dt) stepInPlace(w, [], test);
    expect(w.dust!.length).toBeGreaterThan(0);
    expect(w.dust!.length).toBeLessThan(dust.length);
    for (let t = 0; t < 5.1; t += dt) stepInPlace(w, [], test);
    expect(w.dust).toEqual([]);
  }, 120_000);

  it("DMG-007 a rock piece smashed by a heavy fast hit is destroyed and removed; fixed bodies never are", () => {
    const rock = { name: "rock", threshold: 10, toughness: 200 };
    const w = createWorld(1, [
      { ...box("piece", 1, 1, { position: { x: 0, y: 0 } } as never), material: rock } as never,
      { ...disc("ram", { mass: 50, position: { x: -3, y: 0 }, velocity: { x: 60, y: 0 } } as never) } as never,
      { ...box("ground", 4, 1, { fixed: true, position: { x: 0, y: -5 } } as never), material: rock, integrity: 0 } as never,
    ]);
    for (let i = 0; i < 120; i++) stepInPlace(w, [], test);
    expect(w.events.some((e) => e.type === "destroyed" && e.data.id === "piece")).toBe(true);
    expect(w.bodies.some((b) => b.id === "piece")).toBe(false);
    expect(w.bodies.some((b) => b.id === "ground")).toBe(true);
    expect(w.dust!.some((d) => d.kind === "rock")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  });
});
