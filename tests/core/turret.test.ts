// Turrets (WPN-009, WPN-010) and the joint that aims them (ASM-008): src/core/turret.ts, built from scripts/turretParts.ts.
import { describe, expect, it } from "vitest";
import { createWorld, getProfile, parseScenario, ScenarioError, stepInPlace, turretWorks, type BodyInput, type World } from "../../src/core/index.ts";
import { turret, type TurretTuning } from "../../scripts/turretParts.ts";

const sandbox = getProfile("sandbox");
const BOLT = { shape: { kind: "disc", radius: 0.12 }, mass: 0.3, restitution: 0, friction: 0.3 }; // solid: these tests are about the gun
const T: TurretTuning = { range: 80, wait: 1, hold: 0.25, aim: "random", arc: Math.PI / 3, rate: 2.1, bolt: BOLT, speed: 40, reload: 0.5, bolts: 40, shots: 5, charge: 1, burn: 0.02, fuel: 8.1 };
const still = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): BodyInput =>
  ({ id, fixed: true, shape: { kind: "disc", radius: 1 }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, ...extra }) as never;

/** A turret standing at the origin under 4 m/s² of gravity, watching `target` (a fixed disc at 20, 30 unless given). */
function world(over: Partial<TurretTuning> = {}, o: { seed?: number; angle?: number; others?: BodyInput[]; target?: string | null } = {}): World {
  const t = turret("t1", { x: 0, y: 0 }, o.angle ?? 0, { ...T, ...over }, o.seed ?? 7);
  const w = createWorld(1, [...(t.bodies as never[]), ...(o.others ?? [still("target", 20, 30)])], { x: 0, y: -4 }, { joints: t.joints as never, links: t.links as never }, sandbox);
  if (o.target !== null) at(w, "t1-carriage").turret!.target = o.target ?? "target";
  return w;
}
const at = (w: World, id: string) => w.bodies.find((b) => b.id === id)!;
const pivot = (w: World) => w.joints.find((j) => j.id === "t1-w-pivot")!;
const run = (w: World, seconds: number) => {
  for (let k = 0; k < Math.round(seconds * 240); k++) stepInPlace(w, [], sandbox);
};
const fires = (w: World) => w.events.filter((e) => e.type === "turret.fire");
const lag = (w: World) => Math.abs(at(w, "t1-carriage").angle - at(w, "t1-mount").angle - pivot(w).referenceAngle);
const drop = (w: World, ...ids: string[]) => {
  w.bodies = w.bodies.filter((b) => !ids.includes(b.id));
  w.joints = w.joints.filter((j) => !ids.includes(j.a) && !ids.includes(j.b));
  w.links = w.links.filter((l) => !ids.includes(l.to) && !(l.kind === "feed" && ids.includes(l.from)));
};

describe("turrets", () => {
  it("ASM-008 a turned joint's rest angle moves to its target at its rate, inside its limits, and the gun follows it, held as a weld holds", () => {
    const w = world({}, { target: null });
    pivot(w).turn!.target = 0.84;
    run(w, 0.2);
    expect(pivot(w).referenceAngle).toBeCloseTo(0.2 * 2.1, 6); // 2.1 rad/s
    expect(lag(w)).toBeLessThan(0.05);
    run(w, 0.4);
    expect(pivot(w).referenceAngle).toBe(0.84);
    expect(at(w, "t1-carriage").angle).toBeCloseTo(0.84, 1);
    expect(at(w, "t1-gun").angle).toBeCloseTo(0.84, 1); // the barrel with it
    // Past its limit it stops at the limit.
    pivot(w).turn!.target = -9;
    run(w, 1.2);
    expect(pivot(w).referenceAngle).toBeCloseTo(-Math.PI / 3, 6);
    expect(lag(w)).toBeLessThan(0.02);
    // The turret stands on its welds under gravity: nothing has broken or moved off.
    expect(w.joints).toHaveLength(12);
    expect(Math.hypot(at(w, "t1-tank").position.x + 2.4, at(w, "t1-tank").position.y - 0.8)).toBeLessThan(0.02);
    expect(w.ledger.violations).toBe(0);
  });

  it("ASM-008 a damaged mount turns the gun slower, and below 30% not at all", () => {
    const w = world({}, { target: null });
    at(w, "t1-mount").integrity = 0.5;
    pivot(w).turn!.target = 1;
    run(w, 0.2);
    expect(pivot(w).referenceAngle).toBeCloseTo(0.2 * 2.1 * 0.5, 6);
    at(w, "t1-mount").integrity = 0.29;
    const stuck = pivot(w).referenceAngle;
    run(w, 0.2);
    expect(pivot(w).referenceAngle).toBe(stuck);
    expect(turretWorks(w, at(w, "t1-carriage"))).toBe(false);
  });

  it("WPN-009 it fires only at something it can see: in range, with a clear line, and not before its wait from first sight", () => {
    const seen = world();
    run(seen, 0.95);
    expect(fires(seen)).toHaveLength(0); // still waiting
    run(seen, 1.5);
    expect(fires(seen).length).toBeGreaterThanOrEqual(1);
    expect(fires(seen)[0].tick / 240).toBeGreaterThanOrEqual(1);
    expect(at(seen, "t1-carriage").turret).toMatchObject({ sees: true });

    const none = world({}, { target: null });
    const far = world({}, { others: [still("target", 60, 80)] }); // 100 m off
    const behind = world({}, { others: [still("target", 20, 30), { ...still("wall", 10, 15), shape: { kind: "box", width: 12, height: 1 } } as never] });
    for (const w of [none, far, behind]) {
      run(w, 2.5);
      expect(fires(w)).toHaveLength(0);
      expect(at(w, "t1-carriage").turret!.sees).toBe(false);
      expect(pivot(w).referenceAngle).toBe(0); // the gun hasn't stirred
    }
    const off = world();
    at(off, "t1-carriage").turret!.enabled = false;
    run(off, 2.5);
    expect(fires(off)).toHaveLength(0);
  });

  it("WPN-009 the gun is on its bearing before every shot: it turns to a random bearing in its arc, the same for the same seed", () => {
    const shots = (seed: number) => {
      const w = world({}, { seed });
      const out: number[] = [];
      for (let k = 0; k < 240 * 5; k++) {
        const before = fires(w).length;
        stepInPlace(w, [], sandbox);
        if (fires(w).length > before) {
          // The step it fires: the joint is at the bearing it picked, and the gun is on the joint's angle.
          expect(pivot(w).referenceAngle).toBe(Math.min(pivot(w).turn!.max, Math.max(pivot(w).turn!.min, pivot(w).turn!.target)));
          expect(lag(w)).toBeLessThan(0.06);
          out.push(pivot(w).referenceAngle);
        }
      }
      expect(w.events.filter((e) => e.type === "railgun.fired")).toHaveLength(out.length); // every shot it called left the gun
      return out;
    };
    const a = shots(7);
    expect(a.length).toBeGreaterThanOrEqual(4);
    for (const b of a) expect(Math.abs(b)).toBeLessThanOrEqual(Math.PI / 3);
    expect(new Set(a.map((b) => b.toFixed(3))).size).toBe(a.length); // a new bearing each time
    expect(Math.max(...a) - Math.min(...a)).toBeGreaterThan(0.5); // across its arc
    expect(shots(7)).toEqual(a);
    expect(shots(8)).not.toEqual(a);
  });

  it("WPN-009 aiming at the ship, it turns toward where the target is now and fires within its spread of it", () => {
    const w = world({ aim: "ship" });
    run(w, 4);
    expect(fires(w).length).toBeGreaterThanOrEqual(3);
    // The target is at 20, 30 from the origin: about 0.63 rad clockwise of straight up from the pivot.
    const bearing = -Math.atan2(20 - 0.9, 30 - 0.7);
    for (const f of fires(w)) expect(Math.abs(Number(f.data.angle) - bearing)).toBeLessThan(0.14 + 0.03);
    // A target outside its arc: it turns as far as it can and holds its fire.
    const low = world({ aim: "ship" }, { others: [still("target", 40, 2)] });
    run(low, 3);
    expect(fires(low)).toHaveLength(0);
    expect(pivot(low).referenceAngle).toBeCloseTo(-Math.PI / 3, 6);
  });

  it("WPN-010 each shot takes one from the battery; with no fuel reaching the generator it fires what the battery holds and falls quiet", () => {
    const w = world({ charge: 1 });
    run(w, 6);
    const fed = fires(w).length;
    expect(fed).toBeGreaterThan(6); // more than a battery's worth: the generator keeps it charged
    expect(at(w, "t1-tank").contents!.reduce((m, s) => m + s.mass, 0)).toBeLessThan(8.1); // and burns fuel doing it
    expect(w.ledger.violations).toBe(0); // the burnt fuel is on the books
    // The pipe cut: nothing reaches the generator.
    const cut = world({ charge: 1 });
    drop(cut, "t1-pipe");
    run(cut, 8);
    expect(fires(cut).length).toBeGreaterThanOrEqual(5);
    expect(fires(cut).length).toBeLessThanOrEqual(6); // the battery's five, and what was already in the generator
    expect(at(cut, "t1-battery").charge!.shots).toBeLessThan(1);
    expect(turretWorks(cut, at(cut, "t1-carriage"))).toBe(true); // whole, but out of power
    // The same with the tank drained (stolen): quiet once the battery is flat.
    const dry = world({ charge: 1 });
    for (const s of at(dry, "t1-tank").contents!) s.mass = 0;
    run(dry, 8);
    expect(fires(dry).length).toBeLessThanOrEqual(6);
  });

  it("WPN-009 WPN-010 a turret without its barrel, its carriage's joint or its battery can't fire", () => {
    for (const part of ["t1-gun", "t1-battery", "t1-mount"]) {
      const w = world();
      expect(turretWorks(w, at(w, "t1-carriage"))).toBe(true);
      drop(w, part);
      expect(turretWorks(w, at(w, "t1-carriage"))).toBe(false);
      run(w, 2.5);
      expect(fires(w)).toHaveLength(0);
    }
    const wreck = world();
    at(wreck, "t1-carriage").integrity = 0;
    expect(turretWorks(wreck, at(wreck, "t1-carriage"))).toBe(false);
    expect(turretWorks(wreck, at(wreck, "t1-tank"))).toBe(false); // not a turret at all
  });

  it("WPN-009 a turret hanging from a roof works as one standing on the ground", () => {
    const w = world({}, { angle: Math.PI, others: [still("target", 20, -30)] });
    run(w, 4);
    expect(fires(w).length).toBeGreaterThanOrEqual(3);
    expect(w.joints).toHaveLength(12);
    expect(lag(w)).toBeLessThan(0.06);
    expect(w.ledger.violations).toBe(0);
  });

  it("SCN-002 malformed turrets, batteries, generators and turned joints are refused", () => {
    const t = turret("t1", { x: 0, y: 0 }, 0, T, 1);
    const scn = (edit: (bodies: Record<string, unknown>[], joints: Record<string, unknown>[]) => void) => {
      const bodies = structuredClone(t.bodies);
      const joints = structuredClone(t.joints);
      edit(bodies, joints);
      return { schema: 1, name: "t", title: "t", description: "", profile: "sandbox", seed: 1, world: { bodies, joints, links: t.links }, timeline: [], end: { steps: 1 }, probes: [], assertions: [] };
    };
    const part = (bodies: Record<string, unknown>[], id: string) => bodies.find((b) => b.id === id)!;
    expect(() => parseScenario(scn(() => {}))).not.toThrow();
    const bad: [string, Parameters<typeof scn>[0]][] = [
      ["turret.aim", (b) => ((part(b, "t1-carriage").turret as Record<string, unknown>).aim = "wild")],
      ["turret.range", (b) => ((part(b, "t1-carriage").turret as Record<string, unknown>).range = 0)],
      ["turret.enabled", (b) => ((part(b, "t1-carriage").turret as Record<string, unknown>).enabled = "yes")],
      ["turret", (b) => (part(b, "t1-carriage").turret = 3)],
      ["charge", (b) => (part(b, "t1-battery").charge = 3)],
      ["charge.capacity", (b) => (part(b, "t1-battery").charge = { shots: 1, capacity: 0 })],
      ["generator", (b) => (part(b, "t1-gen").generator = 3)],
      ["generator.burn", (b) => (part(b, "t1-gen").generator = { battery: "t1-battery", burn: -1, rate: 1 })],
      ["turn.rate", (_, j) => ((j.find((x) => x.id === "t1-w-pivot")!.turn as Record<string, unknown>).rate = 0)],
      ["turn", (_, j) => (j.find((x) => x.id === "t1-w-pivot")!.turn = { rate: 1, min: 1, max: 0, target: 0 })],
    ];
    for (const [path, edit] of bad) {
      let paths: string[] = [];
      try {
        parseScenario(scn(edit));
      } catch (e) {
        paths = (e as ScenarioError).errors.map((x) => x.path);
      }
      expect(paths.some((p) => p.endsWith(`.${path}`)), path).toBe(true);
    }
  });
});
