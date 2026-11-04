// Weapons, first look (M6): the gas cannon test scenario (GUN).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");

/** The cannon test with some parameters, run for `steps`; returns the world and the gas momentum that left. */
function shoot(values: Record<string, number>, steps: number, noRockGravity = false): { w: World; gone: number } {
  const raw = readJson(join(ROOT, "scenarios", "cannon-test.json")) as { world: { bodies: { gravity?: unknown }[] } };
  if (noRockGravity) for (const b of raw.world.bodies) delete b.gravity;
  const scn = parseScenario(raw, values);
  const w = initialWorld(scn);
  let gone = 0;
  for (let i = 0; i < steps; i++) {
    stepInPlace(w, scn.timeline.filter((t) => t.step === w.tick).flatMap((t) => t.commands), sandbox);
    gone -= w.ledger.last!.sources.boundary.momentumX;
  }
  return { w, gone };
}

describe("cannon (GUN)", () => {
  it("WPN-001 WPN-002 ORC-009 gas in the barrel drives the shell, the cannon recoils, and shell, cannon and gas momenta balance", () => {
    // Without the asteroids' gravity, which would pull the 100 kg cannon by about 2 N·s meanwhile.
    const { w, gone } = shoot({}, 180, true); // fires at 0.5 s; 0.25 s later the shell is clear of the barrel
    const shell = w.bodies.find((b) => b.id === "shell")!;
    const cannon = assemblyTotals(w, "breech")!;
    expect(shell.velocity.x).toBeGreaterThan(20);
    expect(cannon.velocity.x).toBeLessThan(0);
    const gas = w.gas.parcels.reduce((s, p) => s + p.mass * p.velocity.x, 0) + gone;
    const pShell = shell.mass * shell.velocity.x;
    // Everything started at rest (ORC-009).
    expect(Math.abs(pShell + cannon.mass * cannon.velocity.x + gas)).toBeLessThan(1e-6);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("WPN-001 the shot's speed comes from the charge, the shell and the barrel, not a setting", () => {
    const speed = (v: Record<string, number>) => shoot(v, 180).w.bodies.find((b) => b.id === "shell")!.velocity.x;
    const base = speed({});
    expect(speed({ charge: 0.2 })).toBeGreaterThan(base * 1.1); // more propellant, faster
    expect(speed({ shellMass: 10 })).toBeLessThan(base * 0.9); // heavier shell, slower
  }, 600_000);
});
