// AI pilots, phase 1: foundations (AIP-001…AIP-007, §9.10).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, getProfile, hashValue, initialWorld, learnShip, parseScenario, pilotChannels, stepInPlace, type PilotGoal, type World } from "../../src/core/index.ts";
import { runPilots } from "../../src/core/pilot.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");

/**
 * Gunship 2 (from the base scenario) on its own, its channels renamed e1.*, with a pilot on its hull.
 * With `gravity`, it floats 30 m above the base asteroid; otherwise in empty space.
 */
function ship(goal: PilotGoal | null, opts: { gravity?: boolean; flight?: number } = {}): World {
  const raw = readJson(join(ROOT, "scenarios", "base.json")) as {
    world: { asteroids: unknown[]; bodies: Record<string, any>[]; links: Record<string, any>[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  raw.world.asteroids = [];
  raw.world.bodies = raw.world.bodies.filter((b) => !b.fixed || (opts.gravity && b.id === "base-rock"));
  const lift = opts.gravity ? 30 : 0;
  for (const b of raw.world.bodies) {
    if (b.fixed) continue;
    const y = b.position.y;
    b.position.y = typeof y === "number" ? y + lift : { $expr: `(${y.$expr}) + ${lift}` };
    if (b.injector) b.injector.channel = `e1.${b.injector.channel}`;
    if (b.tractor) b.tractor.channel = `e1.${b.tractor.channel}`;
  }
  for (const l of raw.world.links) if (l.kind === "control") l.channel = `e1.${l.channel}`;
  if (goal) raw.world.bodies.find((b) => b.id === "hull")!.pilot = { skill: { flight: opts.flight ?? 0.7 }, goal };
  return initialWorld(parseScenario(raw));
}
const hull = (w: World) => w.bodies.find((b) => b.id === "hull")!;
const run = (w: World, steps: number) => {
  for (let i = 0; i < steps; i++) stepInPlace(w, [], sandbox);
};
/** The thrust axis's direction (Gunship 2 pushes along its body +y), rad. */
const axisAngle = (w: World) => hull(w).angle + Math.PI / 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

describe("AI pilot foundations", () => {
  it("AIP-003 AIP-004 it learns its ship from the design: the two engine channels, pushing along the nose with opposite turns; never the cannon, nor a channel shared with another ship", () => {
    const w = ship({ kind: "idle" });
    expect(pilotChannels(w, hull(w))).toEqual(["e1.fire", "e1.left", "e1.right", "e1.tractor"]);
    const model = learnShip(w, hull(w));
    expect(model.map((c) => c.channel)).toEqual(["e1.left", "e1.right"]);
    for (const c of model) {
      expect(c.direction.x).toBeCloseTo(0, 6);
      expect(c.direction.y).toBeCloseTo(1, 6);
    }
    const arm = (c: (typeof model)[number]) => c.point.x * c.direction.y - c.point.y * c.direction.x;
    expect(Math.sign(arm(model[0]))).toBe(-Math.sign(arm(model[1])));
    // A channel shared with another assembly is not its own.
    w.links.push({ id: "x", kind: "control", channel: "e1.left", to: "base-rock", integrity: 1 } as never);
    expect(pilotChannels(w, hull(w))).not.toContain("e1.left");
  });

  it("AIP-006 AIP-007 it turns the ship to a heading and holds it, with the ledger clean", () => {
    const w = ship({ kind: "heading", angle: 0 }); // from pointing up to pointing right
    run(w, 720); // 3 s
    expect(Math.abs(wrap(axisAngle(w)))).toBeLessThan((2 * Math.PI) / 180);
    expect(Math.abs(assemblyTotals(w, "hull")!.angularVelocity)).toBeLessThan(0.05);
    run(w, 960);
    expect(Math.abs(wrap(axisAngle(w)))).toBeLessThan((2 * Math.PI) / 180);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AIP-006 it reaches and holds a velocity, turning to point its thrust, within a tolerance that shrinks with skill", () => {
    for (const flight of [0.3, 1]) {
      const w = ship({ kind: "velocity", velocity: { x: 5, y: 0 } }, { flight });
      run(w, 2400); // 10 s
      const v = assemblyTotals(w, "hull")!.velocity;
      const tol = 0.15 + 0.35 * (1 - flight);
      expect(Math.hypot(v.x - 5, v.y)).toBeLessThan(2 * tol + 0.1);
      expect(Math.abs(assemblyTotals(w, "hull")!.angularVelocity)).toBeLessThan(0.1); // settled, not spinning
    }
  }, 300_000);

  it("AIP-006 it hovers under the base asteroid's gravity", () => {
    const w = ship({ kind: "hover" }, { gravity: true });
    const y0 = assemblyTotals(w, "hull")!.centre.y;
    run(w, 1200); // 5 s
    for (let i = 0; i < 5; i++) {
      run(w, 240);
      const t = assemblyTotals(w, "hull")!;
      expect(Math.hypot(t.velocity.x, t.velocity.y)).toBeLessThan(0.15);
      expect(Math.abs(t.centre.y - y0)).toBeLessThan(1);
    }
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AIP-004 in flight it corrects the design's underestimate of an engine to about what it really gives", () => {
    // What the left engine really gives: fired alone in empty space, averaged once the chamber is up.
    const probe = ship(null);
    const set = { type: "control.set" as const, channel: "e1.left", value: 1 };
    stepInPlace(probe, [set], sandbox);
    run(probe, 23);
    const p0 = assemblyTotals(probe, "hull")!.momentum;
    run(probe, 48);
    const p1 = assemblyTotals(probe, "hull")!.momentum;
    const real = Math.hypot(p1.x - p0.x, p1.y - p0.y) / (48 * sandbox.timestep);
    // The pilot, turning (on the left engine mostly), learns it.
    const w = ship({ kind: "heading", angle: 0 });
    const design = learnShip(w, hull(w)).find((c) => c.channel === "e1.left")!.design;
    expect(design).toBeLessThan(0.7 * real); // the design's guess is low on purpose
    run(w, 720);
    const learned = hull(w).pilot!.model!.channels.find((c) => c.channel === "e1.left")!.gain;
    expect(Math.abs(learned / real - 1)).toBeLessThan(0.2);
  }, 300_000);

  it("AIP-002 a world with a pilot replays exactly, and goes on identically after a save and load", () => {
    const a = ship({ kind: "velocity", velocity: { x: 3, y: 2 } });
    const b = ship({ kind: "velocity", velocity: { x: 3, y: 2 } });
    run(a, 600);
    run(b, 300);
    const c = structuredClone(b); // a saved world, loaded again
    run(b, 300);
    run(c, 300);
    expect(hashValue(b)).toBe(hashValue(a));
    expect(hashValue(c)).toBe(hashValue(a));
  }, 300_000);

  it("AIP-001 a wrecked pilot's ship does nothing more", () => {
    const w = ship({ kind: "heading", angle: 0 });
    run(w, 24);
    hull(w).integrity = 0;
    const before = { ...w.controls };
    run(w, 48);
    expect(hull(w).pilot!.intent).toBe("wrecked");
    expect(w.controls).toEqual(before);
  });

  it("AIP-018 a pilot's decisions cost well under the budget", () => {
    const w = ship({ kind: "velocity", velocity: { x: 3, y: 0 } });
    run(w, 240);
    // Time the pilot alone: make it decide on every call, many times.
    const p = hull(w).pilot!;
    const n = 2000;
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      p.next = 0;
      runPilots(w, sandbox.timestep);
    }
    const perDecision = (performance.now() - t0) / n;
    // It decides every `interval` steps; the budget is 0.2 ms per step.
    expect(perDecision / p.interval).toBeLessThan(0.2);
  });
});
