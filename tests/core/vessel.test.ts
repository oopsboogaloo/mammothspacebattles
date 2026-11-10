// Engine chambers held as one volume of gas (PRP-011, §10.1).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, computeTotals, getProfile, initialWorld, parseScenario, stepInPlace, type Command, type World, parcelsOf } from "../../src/core/index.ts";
import { mixture } from "../../src/core/gas.ts";
import { expD, lnPos, powPos } from "../../src/core/math.ts";
import { vesselPressure, vesselShape } from "../../src/core/vessel.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const land = (edit?: (raw: { world: { bodies: { id: string; position: { x: number; y: number }; shape: { width?: number } }[] } }) => void): World => {
  const raw = readJson(join(ROOT, "scenarios", "land-twin-engine.json")) as never;
  edit?.(raw);
  return initialWorld(parseScenario(raw));
};
const fire = (w: World, steps: number, cmds: Command[] = [set("left", 1), set("right", 1)]) => {
  for (let i = 0; i < steps; i++) stepInPlace(w, i === 0 ? cmds : [], sandbox);
};
const engine = (w: World) => w.bodies.find((b) => b.id === "engine-l")!;

describe("chambers held as one volume", () => {
  it("PRP-011 PRP-002 LAND's engines hold their chamber gas as one volume and let it out through the throat, with the ledger clean", () => {
    const w = land();
    const shape = vesselShape(w, engine(w))!;
    expect(shape.sealed).toBe(true);
    expect(shape.area).toBeGreaterThan(0.5); // about 0.8 m × 0.85 m
    expect(shape.openTo - shape.openFrom).toBeCloseTo(0.3, 1); // the gap between the throat pieces
    fire(w, 240);
    const v = engine(w).injector!.vessel!;
    expect(v.mass).toBeGreaterThan(0.01);
    expect(Object.keys(v.composition)).toContain("h2o"); // it burned
    // No parcels upstream of the throat: in the engine's frame, the throat is shape.throat below the outlet.
    const b = engine(w);
    const c = Math.cos(-b.angle);
    const s = Math.sin(-b.angle);
    const above = parcelsOf(w.gas).filter((p) => {
      const dx = p.position.x - b.position.x;
      const dy = p.position.y - b.position.y;
      const lx = c * dx - s * dy;
      const ly = s * dx + c * dy;
      return Math.abs(lx) < 0.4 && ly > b.injector!.outlet.y - shape.throat + 0.01 && ly < b.injector!.outlet.y;
    });
    expect(above).toHaveLength(0);
    expect(w.gas.count).toBeGreaterThan(50); // the exhaust
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("PRP-005 PRP-011 the jet's thrust is close to the choked-throat value, ṁ·c*·(1 + 1/γ)", () => {
    // In open space: no ground under the jet, no gravity, no gas leaving out of the plane.
    const w = land();
    w.gravity = { x: 0, y: 0 };
    w.bounds = { ...w.bounds, depth: undefined };
    for (const b of w.bodies) if (!b.fixed) b.position = { x: b.position.x, y: b.position.y + 20 };
    w.ledger.totals = computeTotals(w);
    fire(w, 240); // to a steady state
    const p0 = assemblyTotals(w, "hull")!.momentum.y;
    const m0 = computeTotals(w).mass;
    for (let i = 0; i < 120; i++) stepInPlace(w, [], sandbox);
    const t = assemblyTotals(w, "hull")!;
    const thrust = (t.momentum.y - p0) / 0.5;
    const v = engine(w).injector!.vessel!;
    const gamma = mixture(v.composition).gamma;
    const u = v.thermal / v.mass;
    const cStar = Math.sqrt(gamma * (gamma - 1) * u * (2 / (gamma + 1)));
    const mdot = 2 * engine(w).injector!.rate; // both engines at full command
    // The jet leaves at c*·(1 + 1/γ), so its recoil is the ideal; the plug and the nozzle walls add a
    // little (LAND: about 1.05). Before, the throat pressure came only through the sparse parcels just
    // released, and LAND made 79% (gpu-gas-phase0.md §15).
    expect(thrust / (mdot * cStar * (1 + 1 / gamma))).toBeGreaterThan(0.95);
    expect(thrust / (mdot * cStar * (1 + 1 / gamma))).toBeLessThan(1.15);
    expect(computeTotals(w).mass).toBeLessThan(m0); // gas leaves the world as it goes far
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("PRP-004 PRP-011 a chamber with its throat shut builds pressure but lets nothing out and makes no thrust", () => {
    // Widen the throat pieces of both engines until they meet (their welds keep their centres).
    const w = land((raw) => {
      for (const b of raw.world.bodies) if (/^throat-/.test(b.id)) b.shape.width = 0.65;
    });
    w.gravity = { x: 0, y: 0 };
    for (const b of w.bodies) if (!b.fixed) b.position = { x: b.position.x, y: b.position.y + 5 }; // off the pad
    w.ledger.totals = computeTotals(w);
    const shape = vesselShape(w, engine(w))!;
    expect(shape.sealed).toBe(true);
    expect(shape.openTo - shape.openFrom > 0).toBe(false); // no opening
    fire(w, 120);
    const v = engine(w).injector!.vessel!;
    expect(v.mass).toBeGreaterThan(0.05);
    expect(vesselPressure(v, shape.area)).toBeGreaterThan(1000);
    expect(parcelsOf(w.gas)).toHaveLength(0);
    expect(Math.abs(assemblyTotals(w, "hull")!.momentum.y)).toBeLessThan(1e-9);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("PRP-011 DMG-006 when a chamber wall is wrecked, the chamber's gas spills out as parcels where it was, and nothing is lost", () => {
    const w = land();
    fire(w, 120);
    const held = engine(w).injector!.vessel!.mass;
    expect(held).toBeGreaterThan(0.01);
    const before = computeTotals(w);
    w.bodies.find((b) => b.id === "chamber-left-l")!.integrity = 0; // wreckage: its welds break
    let left = 0; // what leaves at the boundary meanwhile (far field, out of the plane)
    stepInPlace(w, [set("left", 0), set("right", 0)], sandbox);
    left += w.ledger.last!.sources.boundary.mass;
    stepInPlace(w, [], sandbox);
    left += w.ledger.last!.sources.boundary.mass;
    expect(engine(w).injector!.vessel).toBeUndefined();
    // The spilled gas is where the chamber was: within a metre of the engine.
    const b = engine(w);
    const near = parcelsOf(w.gas).filter((p) => Math.hypot(p.position.x - b.position.x, p.position.y - b.position.y) < 1.2);
    expect(near.reduce((m, p) => m + p.mass, 0)).toBeGreaterThan(0.5 * held);
    expect(computeTotals(w).mass - left).toBeCloseTo(before.mass, 9);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("PRP-011 ASM-004 the chamber's pressure loads the welds that hold its walls", () => {
    const w = land();
    fire(w, 120);
    const v = engine(w).injector!.vessel!;
    const P = vesselPressure(v, vesselShape(w, engine(w))!.area);
    // The side wall's weld to the head carries the push on that wall: P × the wall's length in the chamber.
    const j = w.joints.find((x) => x.id === "w-head-left-l")!;
    const load = Math.hypot(j.gasImpulse!.x, j.gasImpulse!.y) / sandbox.timestep;
    expect(load).toBeGreaterThan(0.3 * P * 0.8);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("PRP-011 WPN-001 a gun's breech keeps its gas as parcels, to drive the shell", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "gunship-2.json"))));
    expect(vesselShape(w, w.bodies.find((b) => b.id === "breech")!)).toBeNull();
    expect(vesselShape(w, engine(w))?.sealed).toBe(true);
  });
});

describe("pinned maths", () => {
  it("DET-003 ln, exp and pow from + − × ÷ match the engine's to about 1e-14", () => {
    for (let i = 0; i < 2000; i++) {
      const x = Math.exp((i / 2000) * 60 - 30);
      expect(Math.abs(lnPos(x) - Math.log(x))).toBeLessThan(1e-14 * Math.max(1, Math.abs(Math.log(x))));
      const y = (i / 2000) * 200 - 100;
      expect(Math.abs(expD(y) / Math.exp(y) - 1)).toBeLessThan(1e-14);
      const g = 1.1 + (i / 2000) * 0.6;
      expect(Math.abs(powPos(2 / (g + 1), 1 / (g - 1)) / Math.pow(2 / (g + 1), 1 / (g - 1)) - 1)).toBeLessThan(1e-14);
    }
  });
});
