// Explosive shells (WPN): detonation on impact, shrapnel, blast gas and blast damage.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeTotals, createWorld, explosiveEnergy, getProfile, initialWorld, parseScenario, ScenarioError, stepInPlace, timelineByStep, type World } from "../../src/core/index.ts";
import { box, disc, readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const test = getProfile("test");

/** Runs a scenario file `steps` steps with its own timeline. */
function run(file: string, steps: number, values: Record<string, number> = {}, edit?: (raw: { world: { bodies: { id: string; explosive?: unknown }[] } }) => void): World {
  const raw = readJson(join(ROOT, "scenarios", `${file}.json`)) as never;
  edit?.(raw);
  const scn = parseScenario(raw, values);
  const w = initialWorld(scn);
  const by = timelineByStep(scn);
  for (let i = 0; i < steps; i++) stepInPlace(w, by.get(i) ?? [], sandbox);
  return w;
}

describe("explosive shells", () => {
  it("WPN-005 WPN-006 an armed shell detonates when it strikes the ship, not in the barrel: fragments fly, the charge's energy goes exactly into them and the gas", () => {
    const w = run("cannon-explosive", 480);
    const det = w.events.filter((e) => e.type === "detonation");
    expect(det).toHaveLength(1);
    expect(det[0].tick).toBeGreaterThan(200); // fired at 120; it struck the ship, not the barrel
    expect(det[0].data.fragments).toBe(6);
    expect(w.bodies.filter((b) => /^shell-f\d+$/.test(b.id))).toHaveLength(6);
    expect(w.bodies.some((b) => b.id === "shell")).toBe(false);
    expect(w.ledger.violations).toBe(0);
    expect(w.ledger.maxResidual.energy).toBeLessThan(1e-6);
  }, 300_000);

  it("WPN-005 WPN-006 an explosive shell wrecks more of the ship than a solid one", () => {
    const destroyed = (w: World) => w.events.filter((e) => e.type === "destroyed").length;
    const explosive = run("cannon-explosive", 480);
    const solid = run("cannon-explosive", 480, {}, (raw) => {
      for (const b of raw.world.bodies) if (b.id === "shell") delete b.explosive;
    });
    expect(destroyed(explosive)).toBeGreaterThan(destroyed(solid) + 2);
  }, 300_000);

  it("WPN-005 WPN-006 the charge's chemical energy is in the ledger until it goes off; the blast gas is held a step, then released, and the ledger is exact throughout", () => {
    const raw = readJson(join(ROOT, "scenarios", "cannon-explosive.json")) as never;
    const scn = parseScenario(raw);
    const w = initialWorld(scn);
    const by = timelineByStep(scn);
    const E = explosiveEnergy(w.bodies.find((b) => b.id === "shell")!.explosive!, w.gas.scale);
    const chem0 = computeTotals(w).energy.chemical;
    let tick = -1;
    for (let i = 0; i < 400 && tick < 0; i++) {
      stepInPlace(w, by.get(i) ?? [], sandbox);
      if (w.events.some((e) => e.type === "detonation")) tick = w.tick;
    }
    // The step it went off: no blast gas yet, but it is held, with its mass.
    expect(w.blasts).toHaveLength(1);
    expect(w.gas.parcels.some((p) => p.composition.co2)).toBe(false);
    // The charge's energy has left the chemical store (the propellant burnt long before).
    expect(computeTotals(w).energy.chemical).toBeLessThan(chem0 - E + 1e-6);
    stepInPlace(w, by.get(tick) ?? [], sandbox);
    expect(w.blasts).toHaveLength(0);
    expect(w.gas.parcels.filter((p) => p.composition.co2).length).toBeGreaterThan(0);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("WPN-005 WPN-006 blast damage falls off with distance and stops at the blast radius", () => {
    // A 1 kg shell with 0.5 kg of explosive, no fragments, flying into a fixed wall; three hull
    // plates at different distances from where it strikes.
    const plate = (id: string, x: number) => box(id, 0.3, 0.3, { position: { x, y: 1.5 }, material: { threshold: 0, toughness: 1e9 }, fixed: true });
    const w = createWorld(1, [
      box("wall", 0.4, 4, { fixed: true, position: { x: 0, y: 0 } }),
      { ...disc("shell", { radius: 0.1, mass: 1, position: { x: -0.5, y: 0 }, velocity: { x: 50, y: 0 } } as never), shape: { kind: "disc", radius: 0.1 }, explosive: { charge: 0.5, fragments: 0, radius: 3, armed: true } } as never,
      plate("near", -0.6),
      plate("mid", -1.6),
      plate("far", -4),
    ]);
    for (let i = 0; i < 20; i++) stepInPlace(w, [], test);
    expect(w.events.some((e) => e.type === "detonation")).toBe(true);
    const loss = (id: string) => 1 - w.bodies.find((b) => b.id === id)!.integrity;
    expect(loss("near")).toBeGreaterThan(loss("mid"));
    expect(loss("mid")).toBeGreaterThan(0);
    expect(loss("far")).toBe(0);
    expect(w.ledger.violations).toBe(0);
  });

  it("WPN-005 WPN-006 a charge heavier than its shell, or more than eight fragments, is refused", () => {
    const raw = readJson(join(ROOT, "scenarios", "cannon-explosive.json")) as { world: { bodies: { id: string; explosive?: Record<string, unknown> }[] } };
    const bad = (patch: Record<string, unknown>) => {
      const r = structuredClone(raw);
      for (const b of r.world.bodies) if (b.id === "shell") b.explosive = { ...b.explosive, ...patch };
      return () => parseScenario(r);
    };
    expect(bad({ charge: 50 })).toThrow(ScenarioError);
    expect(bad({ fragments: 16 })).toThrow(ScenarioError);
    expect(bad({ fragments: 8 })).not.toThrow();
  });

  it("WPN-005 WPN-006 Gunship 2's explosive shells load from the magazine with their charge in the ledger, and burst on the rubble asteroids", () => {
    const raw = readJson(join(ROOT, "scenarios", "gunship-blast.json")) as never;
    const scn = parseScenario(raw);
    const w = initialWorld(scn);
    const set = (channel: string, value: number) => ({ type: "control.set" as const, channel, value });
    for (let i = 0; i < 360; i++) stepInPlace(w, i === 24 ? [set("fire", 1)] : i === 40 ? [set("fire", 0)] : [], sandbox);
    expect(w.events.some((e) => e.type === "detonation")).toBe(true);
    expect(w.events.some((e) => e.type === "joint.break" && /^r[a-d]-b/.test(String(e.data.id)))).toBe(true); // asteroid bonds broke
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("WPN-006 AST-003 on rock, the blast wrecks the pieces at the hit and leaves the far side whole", () => {
    const shoot = (rock: boolean) => {
      const raw = readJson(join(ROOT, "scenarios", "gunship-blast.json")) as { world: { asteroids: { material?: unknown }[] } };
      if (!rock) for (const a of raw.world.asteroids) delete a.material;
      const w = initialWorld(parseScenario(raw));
      const set = (channel: string, value: number) => ({ type: "control.set" as const, channel, value });
      for (let i = 0; i < 200; i++) stepInPlace(w, i === 24 ? [set("fire", 1)] : i === 40 ? [set("fire", 0)] : [], sandbox);
      return w;
    };
    const w = shoot(true);
    const det = w.events.find((e) => e.type === "detonation")!;
    const wrecked = w.bodies.filter((b) => /^r[a-d]-\d+$/.test(b.id) && b.integrity === 0);
    expect(wrecked.length).toBeGreaterThan(0);
    // Every wrecked piece is at the blast: within its radius (2 m) plus a piece's size.
    for (const b of wrecked) expect(Math.hypot(b.position.x - Number(det.data.x), b.position.y - Number(det.data.y))).toBeLessThan(3.5);
    // The far side of the 5 m rock is untouched.
    expect(w.bodies.filter((b) => /^rc-\d+$/.test(b.id) && Math.hypot(b.position.x - Number(det.data.x), b.position.y - Number(det.data.y)) > 5).every((b) => b.integrity === 1)).toBe(true);
    expect(w.ledger.violations).toBe(0);
    // Without a material, nothing on the rock is wrecked.
    expect(shoot(false).bodies.some((b) => /^r[a-d]-\d+$/.test(b.id) && b.integrity < 1)).toBe(false);
  }, 300_000);
});
