// Railgun (WPN-008): Gunship 3's gun, launching shells with no propellant gas.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeTotals, getProfile, initialWorld, parseScenario, stepInPlace, type World, parcelsOf } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
/** Gunship 3 alone in empty space, at rest. */
function gunship(extra: Record<string, unknown>[] = []): World {
  const raw = readJson(join(ROOT, "scenarios", "base.json")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  raw.world.asteroids = [];
  raw.world.bodies = [...raw.world.bodies.filter((b: { fixed?: boolean }) => !b.fixed), ...extra];
  raw.world.gravity = { x: 0, y: 0 };
  Object.assign(raw, { timeline: [], probes: [], assertions: [] });
  delete raw.ui;
  return initialWorld(parseScenario(raw));
}
const fire = (on: boolean) => [{ type: "control.set" as const, channel: "fire", value: on ? 1 : 0 }];

describe("railgun (WPN-008)", () => {
  it("WPN-008 WPN-002 it fires the step F is pressed, launching the shell along the bore at its speed, with momentum exact and the energy from the ship's power", () => {
    const w = gunship();
    stepInPlace(w, [], sandbox);
    const p0 = computeTotals(w).momentum;
    stepInPlace(w, fire(true), sandbox);
    const shot = w.events.filter((e) => e.type === "railgun.fired");
    expect(shot).toHaveLength(1);
    const shell = w.bodies.find((b) => b.id === "breech-shell-1")!;
    const gun = w.bodies.find((b) => b.id === "breech")!;
    expect(shell.velocity.y - gun.velocity.y).toBeGreaterThan(90); // 96 m/s, less what the gun moved
    expect(Math.abs(shell.velocity.x)).toBeLessThan(1e-6);
    expect(gun.velocity.y).toBeLessThan(0); // recoil
    const p1 = computeTotals(w).momentum;
    expect(Math.hypot(p1.x - p0.x, p1.y - p0.y)).toBeLessThan(1e-9);
    expect(w.ledger.last!.sources.power.energy).toBeGreaterThan(4000); // ½ × 1 kg × 96² ≈ 4.6 kJ
    expect(w.ledger.violations).toBe(0);
    expect(parcelsOf(w.gas).filter((p) => p.composition.h2o).length).toBe(0); // no propellant gas
    // Held, it fires again each time it has reloaded (0.25 s).
    for (let i = 0; i < 240; i++) stepInPlace(w, [], sandbox);
    expect(w.events.filter((e) => e.type === "railgun.fired").length).toBeGreaterThanOrEqual(4);
    expect(w.ledger.violations).toBe(0);
  }, 120_000);

  it("WPN-008 a blocked muzzle does not fire: no shell appears inside or past what blocks it", () => {
    // A thin plate across the muzzle, just past the barrel's end (barrel tip at y = 5.07).
    const w = gunship([{ id: "plate", shape: { kind: "box", width: 2, height: 0.05 }, mass: 1000, position: { x: 0, y: 5.25 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 }]);
    stepInPlace(w, fire(true), sandbox);
    for (let i = 0; i < 60; i++) stepInPlace(w, [], sandbox);
    expect(w.events.some((e) => e.type === "railgun.fired")).toBe(false);
    expect(w.bodies.some((b) => b.id.startsWith("breech-shell-") && b.position.y > 5.25)).toBe(false);
    expect(w.ledger.violations).toBe(0);
  }, 120_000);
});
