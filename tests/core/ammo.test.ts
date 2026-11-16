// Shell feeds (WPN-015): shells stored in one body (a magazine) and passed to a gun welded to it.
import { describe, expect, it } from "vitest";
import { computeTotals, getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";

const sandbox = getProfile("sandbox");
const shell = { shape: { kind: "box", width: 0.26, height: 0.22 }, mass: 0.2, restitution: 0, friction: 0.05 };
const box = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, shape: { kind: "box", width: 1, height: 1 }, mass: 3, position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, ...extra });

/** A railgun with no shells of its own, a magazine of 3 welded under it, and one of 5 floating free. */
function world(): World {
  return initialWorld(
    parseScenario({
      schema: 1,
      name: "ammo",
      profile: "sandbox",
      seed: 1,
      world: {
        gravity: { x: 0, y: 0 },
        bodies: [
          box("gun", 0, 1, { mass: 1, magazine: { count: 0, reload: 0.125, at: { x: 0, y: 0.65 }, angle: 0, shell, railgun: { channel: "fire", speed: 100 } } }),
          box("mag", 0, 0, { ammo: { count: 3, shell } }),
          box("loose", 5, 0, { ammo: { count: 5, shell } }),
        ],
        joints: [
          { id: "w1", a: "gun", b: "mag", anchorA: { x: -0.4, y: -0.5 }, anchorB: { x: -0.4, y: 0.5 } },
          { id: "w2", a: "gun", b: "mag", anchorA: { x: 0.4, y: -0.5 }, anchorB: { x: 0.4, y: 0.5 } },
        ],
        links: [
          { id: "ctl", kind: "control", channel: "fire", to: "gun" },
          { id: "feed-mag", kind: "ammo", from: "mag", to: "gun" },
          { id: "feed-loose", kind: "ammo", from: "loose", to: "gun" },
        ],
      },
      timeline: [],
      end: { steps: 1 },
      probes: [],
      assertions: [],
    }),
  );
}
const get = (w: World, id: string) => w.bodies.find((b) => b.id === id)!;

describe("shell feeds (WPN-015)", () => {
  it("WPN-015 a gun with no shells takes them one at a time from a magazine welded to it, with the mass and momentum exact; a magazine not welded to it feeds nothing", () => {
    const w = world();
    const m0 = computeTotals(w).mass;
    stepInPlace(w, [], sandbox);
    // One shell moved into the gun, at once: the mass is the same, only where it is has changed.
    expect([get(w, "gun").magazine!.count, get(w, "mag").ammo!.count]).toEqual([1, 2]);
    expect(computeTotals(w).mass).toBeCloseTo(m0, 12);
    const p0 = computeTotals(w).momentum;
    stepInPlace(w, [{ type: "control.set", channel: "fire", value: 1 }], sandbox);
    for (let i = 0; i < 240; i++) stepInPlace(w, [], sandbox);
    // All three fired, and no more: the loose magazine is not joined to the gun.
    expect(w.events.filter((e) => e.type === "railgun.fired")).toHaveLength(3);
    expect([get(w, "gun").magazine!.count, get(w, "mag").ammo!.count, get(w, "loose").ammo!.count]).toEqual([0, 0, 5]);
    const p1 = computeTotals(w).momentum;
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeLessThan(1e-9);
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("WPN-015 scenarios check an ammo link's ends: shells stored at one, a gun at the other", () => {
    const bad = () =>
      initialWorld(
        parseScenario({
          schema: 1,
          name: "ammo-bad",
          profile: "sandbox",
          seed: 1,
          world: { bodies: [box("a", 0, 0), box("b", 3, 0, { ammo: { count: 1, shell } })], links: [{ id: "x", kind: "ammo", from: "a", to: "b" }] },
          timeline: [],
          end: { steps: 1 },
          probes: [],
          assertions: [],
        }),
      );
    expect(bad).toThrow(/ammo link/);
  });
});
