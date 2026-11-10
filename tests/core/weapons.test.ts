// Weapons, first look (M6): the gas cannon test scenario (GUN).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, bodyMass, computeTotals, createWorld, getProfile, initialWorld, parseScenario, stepInPlace, type World, parcelsOf } from "../../src/core/index.ts";
import { box, readJson, ROOT } from "../helpers.ts";

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
    const gas = parcelsOf(w.gas).reduce((s, p) => s + p.mass * p.velocity.x, 0) + gone;
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

describe("magazine", () => {
  const test = getProfile("test");
  /** A spinning, drifting 10 kg block carrying three 1 kg shells, loaded 1 m out along its +x axis. */
  const carrier = (reload = 0.5) =>
    createWorld(1, [
      {
        ...box("gun", 1, 1, { mass: 10, velocity: { x: 1, y: -2 }, angularVelocity: 0.5 }),
        magazine: { count: 3, reload, at: { x: 1, y: 0 }, angle: 0, shell: { shape: { kind: "box", width: 0.3, height: 0.3 }, mass: 1 } },
      },
    ]);

  it("WPN-001 shells in a magazine are part of the body's mass; loading one keeps mass and momentum exact", () => {
    const w = carrier();
    const gun = w.bodies[0];
    expect(bodyMass(gun)).toBe(13);
    const t0 = computeTotals(w);
    stepInPlace(w, [], test); // the first loads at once
    expect(w.bodies.map((b) => b.id)).toEqual(["gun", "gun-shell-1"]);
    expect(bodyMass(w.bodies[0])).toBe(12);
    const shell = w.bodies[1];
    // It appears where it was put, moving with that point of the spinning body.
    const g = w.bodies[0];
    expect(Math.hypot(shell.position.x - g.position.x, shell.position.y - g.position.y)).toBeCloseTo(1, 2);
    const t1 = computeTotals(w);
    expect(t1.mass).toBeCloseTo(t0.mass, 12);
    expect(t1.momentum.x).toBeCloseTo(t0.momentum.x, 9);
    expect(t1.momentum.y).toBeCloseTo(t0.momentum.y, 9);
    expect(w.ledger.violations).toBe(0);
    expect(w.events.find((e) => e.type === "loaded")!.data).toMatchObject({ id: "gun", shell: "gun-shell-1", left: 2 });
  });

  it("WPN-001 the next shell waits until the bore is clear and the reload time has passed", () => {
    const w = carrier(0.5);
    stepInPlace(w, [], test);
    for (let i = 0; i < 240; i++) stepInPlace(w, [], test);
    expect(w.bodies.filter((b) => b.id.startsWith("gun-shell"))).toHaveLength(1); // the first never left the bore
    const shell = w.bodies.find((b) => b.id === "gun-shell-1")!;
    shell.position = { x: shell.position.x + 5, y: shell.position.y }; // move it out of the way
    stepInPlace(w, [], test);
    expect(w.bodies.filter((b) => b.id.startsWith("gun-shell"))).toHaveLength(2); // timer long past: loads at once
    expect(w.bodies[0].magazine!.count).toBe(1);
  });
});

describe("magazine, review findings", () => {
  const test = getProfile("test");
  const still = (shell: object, at: { x: number; y: number }) =>
    createWorld(1, [{ ...box("gun", 1, 1, { mass: 10, velocity: { x: 1, y: -2 }, angularVelocity: 0.5 }), magazine: { count: 3, reload: 0.5, at, angle: 0, shell } } as never]);

  it("WPN-001 a shell that carries stores counts their mass too, in the magazine and when it loads", () => {
    const w = still({ shape: { kind: "box", width: 0.3, height: 0.3 }, mass: 1, contents: [{ resource: "o2", mass: 2, capacity: 2 }] }, { x: 1, y: 0 });
    expect(bodyMass(w.bodies[0])).toBe(19); // 10 + 3 × (1 + 2)
    const t0 = computeTotals(w);
    stepInPlace(w, [], test);
    expect(w.bodies).toHaveLength(2);
    const t1 = computeTotals(w);
    expect(t1.mass).toBeCloseTo(t0.mass, 12);
    expect(t1.momentum.x).toBeCloseTo(t0.momentum.x, 9);
    expect(t1.momentum.y).toBeCloseTo(t0.momentum.y, 9);
    expect(w.ledger.violations).toBe(0);
  });

  it("WPN-001 a polygon shell off its own centre is checked for room where it really lands", () => {
    // Its centroid is 1 m left of its origin: placed at x = 1 it would land inside the carrier.
    const shell = { shape: { kind: "polygon", vertices: [{ x: -1.15, y: -0.15 }, { x: -0.85, y: -0.15 }, { x: -0.85, y: 0.15 }, { x: -1.15, y: 0.15 }] }, mass: 1 };
    const inside = still(shell, { x: 1, y: 0 });
    stepInPlace(inside, [], test);
    expect(inside.bodies).toHaveLength(1); // no room: it waits
    const outside = still(shell, { x: 2.5, y: 0 });
    stepInPlace(outside, [], test);
    const g = outside.bodies[0];
    const s = outside.bodies[1];
    expect(Math.hypot(s.position.x - g.position.x, s.position.y - g.position.y)).toBeCloseTo(1.5, 2);
    expect(outside.ledger.violations).toBe(0);
  });
});

describe("gunship (GS)", () => {
  it("WPN-001 WPN-003 a shot from the nose cannon recoils the whole ship, and the next shell loads after firing stops", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "gunship.json")));
    const w = initialWorld(scn);
    const set = (v: number) => [{ type: "control.set" as const, channel: "fire", value: v }];
    for (let i = 0; i < 360; i++) stepInPlace(w, i === 24 ? set(1) : i === 48 ? set(0) : [], sandbox);
    const shell = w.bodies.find((b) => b.id === "breech-shell-1")!;
    expect(shell.velocity.y).toBeGreaterThan(30);
    expect(assemblyTotals(w, "hull")!.velocity.y).toBeLessThan(-0.5); // recoil down the ship's axis: 0.86 m/s with 30 shells (60 kg) still aboard
    expect(w.bodies.find((b) => b.id === "breech")!.magazine!.count).toBe(28); // second loaded, 28 of 30 left
    expect(w.bodies.some((b) => b.id === "breech-shell-2")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});

describe("gunship 2 (GS2)", () => {
  /** Spin after half a second on the left engine alone. */
  const turn = (file: string) => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", `${file}.json`))));
    for (let i = 0; i < 120; i++) stepInPlace(w, i === 0 ? [{ type: "control.set", channel: "left", value: 1 }] : [], sandbox);
    expect(w.ledger.violations).toBe(0);
    return Math.abs(assemblyTotals(w, "hull")!.angularVelocity);
  };

  it("FLT-002 WPN-003 with the engines further apart, the cannon lower and half the shells, it turns about twice as fast", () => {
    expect(turn("gunship-2")).toBeGreaterThan(1.7 * turn("gunship")); // 2.0 against 1.0 rad/s
  }, 300_000);

  it("WPN-001 the cannon burns its charge with the engines' economy: a shot takes a 20th of it from the tank", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "gunship-2.json"))));
    const breech = () => w.bodies.find((b) => b.id === "breech")!;
    const stored = () => breech().contents!.reduce((s, c) => s + c.mass, 0);
    expect(stored()).toBeCloseTo(0.1 / 20, 9); // one shot's draw for the default 0.1 kg charge
    for (let i = 0; i < 360; i++) stepInPlace(w, i === 24 ? [{ type: "control.set", channel: "fire", value: 1 }] : i === 36 ? [{ type: "control.set", channel: "fire", value: 0 }] : [], sandbox);
    expect(w.bodies.find((b) => b.id === "breech-shell-1")!.velocity.y).toBeGreaterThan(30);
    expect(breech().magazine!.count).toBe(13); // 15, one fired, one loaded
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});

describe("magazine stop", () => {
  it("WPN-001 a stop holds the loaded shell in the bore through hard turns, and retracts when the fire command comes", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "gunship-2.json"))));
    const set = (channel: string, value: number) => ({ type: "control.set" as const, channel, value });
    const breech = () => w.bodies.find((b) => b.id === "breech")!;
    const dryBefore = breech().mass;
    stepInPlace(w, [set("left", 1)], sandbox);
    const stop = w.bodies.find((b) => b.id === "breech-stop")!;
    expect(stop).toBeDefined(); // deployed with the first shell, out of the breech's own mass
    expect(breech().mass).toBeCloseTo(dryBefore - stop.mass, 12);
    // Along the bore, from the breech: where the shell sits.
    const along = () => {
      const b = breech();
      const s = w.bodies.find((x) => x.id === "breech-shell-1")!;
      return -Math.sin(b.angle) * (s.position.x - b.position.x) + Math.cos(b.angle) * (s.position.y - b.position.y);
    };
    // Hard turns one way, then the other, without firing: the shell stays put.
    for (let i = 1; i < 720; i++) stepInPlace(w, i === 360 ? [set("left", 0), set("right", 1)] : [], sandbox);
    expect(Math.abs(along() - 0.55)).toBeLessThan(0.25);
    expect(w.bodies.filter((b) => b.id.startsWith("breech-shell"))).toHaveLength(1); // none lost, none reloaded
    // Fire: the stop goes back into the breech, and the shell leaves fast.
    for (let i = 0; i < 240; i++) stepInPlace(w, i === 0 ? [set("right", 0), set("fire", 1)] : i === 12 ? [set("fire", 0)] : [], sandbox);
    expect(w.events.some((e) => e.type === "unlatched")).toBe(true);
    const s = w.bodies.find((b) => b.id === "breech-shell-1")!;
    expect(Math.hypot(s.velocity.x - breech().velocity.x, s.velocity.y - breech().velocity.y)).toBeGreaterThan(30);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});

describe("magazine stop, review findings", () => {
  const set = (channel: string, value: number) => ({ type: "control.set" as const, channel, value });
  /** Gunship 2 with its first shell and stop loaded, everything drifting at `drift`. */
  const loaded = (drift: { x: number; y: number }, edit?: (w: World) => void) => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "gunship-2.json"))));
    for (const b of w.bodies) if (!b.fixed) b.velocity = { x: b.velocity.x + drift.x, y: b.velocity.y + drift.y };
    edit?.(w);
    w.ledger.totals = computeTotals(w);
    stepInPlace(w, [], sandbox); // loads the shell and deploys the stop
    return w;
  };

  it("WPN-001 retracting the stop doesn't depend on how fast the ship drifts: no spin from common motion", () => {
    const still = loaded({ x: 0, y: 0 });
    const moving = loaded({ x: 10, y: -7 });
    stepInPlace(still, [set("fire", 1)], sandbox);
    stepInPlace(moving, [set("fire", 1)], sandbox);
    const spin = (w: World) => w.bodies.find((b) => b.id === "breech")!.angularVelocity;
    expect(still.events.some((e) => e.type === "unlatched")).toBe(true);
    // Was 0.04 rad/s apart. What is left comes from the scenario's asteroids, whose pull differs a
    // little once the drifting copy has moved.
    expect(Math.abs(spin(moving) - spin(still))).toBeLessThan(1e-4);
    expect(moving.ledger.violations).toBe(0);
  }, 300_000);

  it("WPN-001 a cannon that can't fire (its control link gone) keeps its stop in", () => {
    const w = loaded({ x: 0, y: 0 }, (x) => {
      x.links = x.links.filter((l) => !(l.kind === "control" && l.to === "breech"));
    });
    for (let i = 0; i < 30; i++) stepInPlace(w, i === 0 ? [set("fire", 1)] : [], sandbox);
    expect(w.events.some((e) => e.type === "unlatched")).toBe(false);
    expect(w.bodies.some((b) => b.id === "breech-stop")).toBe(true);
  }, 300_000);
});
