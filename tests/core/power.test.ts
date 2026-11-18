// Power (PWR-001…PWR-004): batteries, generators burning propellant, and what draws on them.
import { describe, expect, it } from "vitest";
import { getProfile, initialWorld, parseScenario, powerOf, stepInPlace, type World } from "../../src/core/index.ts";

const sandbox = getProfile("sandbox");
const box = (id: string, x: number, extra: Record<string, unknown> = {}) => ({ id, shape: { kind: "box", width: 1, height: 1 }, mass: 2, position: { x, y: 0 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, ...extra });
const shell = { shape: { kind: "box", width: 0.26, height: 0.22 }, mass: 0.166667, restitution: 0, friction: 0.05 };

/** A row of parts welded together: a battery, a generator, a tank of 4.05 kg, and a railgun of `shells` firing up. */
function ship(opts: { battery?: number; generator?: number; shells?: number; shot?: number } = {}): World {
  const parts = [
    box("bat", 0, opts.battery !== undefined ? { power: { capacity: opts.battery } } : {}),
    box("gen", 1, opts.generator !== undefined ? { power: { output: opts.generator, perKg: 1000 } } : {}),
    box("tank", 2, { contents: [{ resource: "h2", mass: 0.45, capacity: 0.45 }, { resource: "o2", mass: 3.6, capacity: 3.6 }] }),
    box("gun", 3, { mass: 1, magazine: { count: opts.shells ?? 0, reload: 0.125, at: { x: 0, y: 0.65 }, angle: 0, shell, railgun: { channel: "fire", speed: 144, ...(opts.shot ? { shot: opts.shot } : {}) } } }),
  ];
  const weld = (a: string, b: string, x: number) => [-0.3, 0.3].map((y, i) => ({ id: `w-${a}-${b}-${i}`, a, b, anchorA: { x: x, y }, anchorB: { x: -x, y } }));
  return initialWorld(
    parseScenario({
      schema: 2,
      name: "power",
      profile: "sandbox",
      seed: 1,
      world: { units: { length: 1, mass: 1 }, gravity: { x: 0, y: 0 }, bodies: parts, joints: [...weld("bat", "gen", 0.5), ...weld("gen", "tank", 0.5), ...weld("tank", "gun", 0.5)], links: [{ id: "ctl", kind: "control", channel: "fire", to: "gun" }] },
      timeline: [],
      end: { steps: 1 },
      probes: [],
      assertions: [],
    }),
  );
}
const fuel = (w: World) => w.bodies.find((b) => b.id === "tank")!.contents!.reduce((s, c) => s + c.mass, 0);
const fire = (w: World, steps: number) => {
  stepInPlace(w, [{ type: "control.set", channel: "fire", value: 1 }], sandbox);
  for (let i = 1; i < steps; i++) stepInPlace(w, [], sandbox);
};
const shots = (w: World) => w.events.filter((e) => e.type === "railgun.fired").length;

describe("power (PWR-001…PWR-004)", () => {
  it("PWR-001 PWR-004 a battery starts full; each railgun shot draws its energy, and with too little stored it doesn't fire", () => {
    const w = ship({ battery: 10, shells: 10, shot: 3.5 });
    expect(powerOf(w, "gun")).toMatchObject({ stored: 10, capacity: 10, output: 0 });
    fire(w, 400);
    // 10 kJ holds two shots of 3.5 kJ, not three.
    expect(shots(w)).toBe(2);
    expect(powerOf(w, "gun")!.stored).toBeCloseTo(3, 9);
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("PWR-003 a generator refills the batteries, burning 1 kg of propellant for each 1,000 kJ, and burns nothing while they are full", () => {
    const w = ship({ battery: 100, generator: 200, shells: 30, shot: 50 });
    const f0 = fuel(w);
    for (let i = 0; i < 24; i++) stepInPlace(w, [], sandbox);
    expect(fuel(w)).toBe(f0); // full: nothing burned
    fire(w, 240); // a second of fire: 8 shots wanted, 400 kJ, against 100 stored and 200 kW
    const p = powerOf(w, "gun")!;
    const made = (f0 - fuel(w)) * 1000;
    // What was spent came from the store and the generator: shots × 50 = 100 − stored + made.
    expect(shots(w) * 50).toBeCloseTo(100 - p.stored + made, 6);
    expect(shots(w)).toBeGreaterThan(2); // the generator kept it firing past the battery
    expect(shots(w)).toBeLessThan(8); // but not at full rate: 200 kW is 4 shots a second
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("PWR-001 a ship with no battery or generator has no power system: its devices work as before power existed", () => {
    const w = ship({ shells: 3, shot: 3.5 });
    expect(powerOf(w, "gun")).toBeNull();
    fire(w, 120);
    expect(shots(w)).toBe(3);
  }, 60_000);

  it("PWR-003 with its ship's tanks dry a generator makes nothing, and the battery, once spent, stays empty", () => {
    const w = ship({ battery: 10, generator: 200, shells: 10, shot: 3.5 });
    w.bodies.find((b) => b.id === "tank")!.contents!.forEach((c) => (c.mass = 0));
    fire(w, 400);
    expect(shots(w)).toBe(2);
    expect(powerOf(w, "gun")).toMatchObject({ making: 0 });
    expect(powerOf(w, "gun")!.stored).toBeCloseTo(3, 9);
  }, 60_000);
});
