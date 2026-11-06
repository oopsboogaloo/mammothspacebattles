// AI pilots, phase 1: foundations (AIP-001…AIP-007, §9.10).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aimAt, assemblyTotals, getProfile, hashValue, initialWorld, learnShip, parseScenario, pilotChannels, stepInPlace, type PilotGoal, type World } from "../../src/core/index.ts";
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
    if (b.magazine?.railgun) b.magazine.railgun.channel = `e1.${b.magazine.railgun.channel}`;
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

  it("AIP-001 DMG-007 a pilot destroyed with its hull lets go of every control and does nothing more", () => {
    const w = ship({ kind: "heading", angle: 0 });
    run(w, 24);
    expect(Object.values(w.controls).some((v) => v > 0)).toBe(true);
    w.bodies.find((b) => b.id === "hull")!.integrity = 0;
    run(w, 48);
    expect(w.bodies.some((b) => b.id === "hull")).toBe(false);
    for (const ch of ["e1.left", "e1.right"]) expect(w.controls[ch] ?? 0).toBe(0);
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

describe("AI pilot navigation (phase 2)", () => {
  const near = (w: World, p: { x: number; y: number }) => {
    const c = assemblyTotals(w, "hull")!.centre;
    return Math.hypot(c.x - p.x, c.y - p.y);
  };

  it("AIP-008 it flies to a point 60 m off and stops there, turning round to brake in time", () => {
    const target = { x: 60, y: 2.6 };
    const w = ship({ kind: "point", target });
    let far = 0;
    for (let i = 0; i < 3600; i++) {
      stepInPlace(w, [], sandbox);
      far = Math.max(far, assemblyTotals(w, "hull")!.centre.x);
    }
    expect(near(w, target)).toBeLessThan(2);
    const v = assemblyTotals(w, "hull")!.velocity;
    expect(Math.hypot(v.x, v.y)).toBeLessThan(0.5);
    expect(far).toBeLessThan(target.x + 4); // no great overshoot
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AIP-008 under the base's gravity it flies across and holds there", () => {
    const target = { x: 40, y: 32 };
    const w = ship({ kind: "point", target }, { gravity: true });
    run(w, 4800);
    expect(near(w, target)).toBeLessThan(3);
    const v = assemblyTotals(w, "hull")!.velocity;
    expect(Math.hypot(v.x, v.y)).toBeLessThan(0.5);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AIP-009 it keeps station on a drifting body", () => {
    const w = ship(null);
    // Heavy, so the ship's exhaust doesn't push it about.
    const buoy = { id: "buoy", shape: { kind: "disc", radius: 0.5 }, mass: 1000, position: { x: 30, y: 10 }, velocity: { x: 1.5, y: 0.5 }, angle: 0, angularVelocity: 0 };
    stepInPlace(w, [{ type: "body.add", body: buoy as never }], sandbox);
    hull(w).pilot = { ...structuredClone(ship({ kind: "idle" }).bodies.find((b) => b.id === "hull")!.pilot!), goal: { kind: "station", body: "buoy", offset: { x: -12, y: 0 } } };
    run(w, 2400); // 10 s to get there
    let worst = 0;
    let dv = 0;
    for (let i = 0; i < 2400; i++) {
      stepInPlace(w, [], sandbox);
      const b = w.bodies.find((x) => x.id === "buoy")!;
      worst = Math.max(worst, near(w, { x: b.position.x - 12, y: b.position.y }));
      const v = assemblyTotals(w, "hull")!.velocity;
      dv += Math.hypot(v.x - b.velocity.x, v.y - b.velocity.y) / 2400;
    }
    expect(worst).toBeLessThan(3.5);
    expect(dv).toBeLessThan(0.6);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AIP-010 sent through a rock, it steers round it and never touches it", () => {
    const w = ship({ kind: "point", target: { x: 80, y: 2.6 } });
    const rock = { id: "rock", shape: { kind: "disc", radius: 5 }, mass: 2000, position: { x: 40, y: 2.6 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 };
    stepInPlace(w, [{ type: "body.add", body: rock as never }], sandbox);
    let touched = false;
    let steered = false;
    for (let i = 0; i < 6000; i++) {
      stepInPlace(w, [], sandbox);
      touched ||= w.contacts.some((c) => c.a === "rock" || c.b === "rock");
      steered ||= (hull(w).pilot!.plan?.avoiding?.length ?? 0) > 0;
    }
    expect(steered).toBe(true);
    expect(touched).toBe(false);
    expect(near(w, { x: 80, y: 2.6 })).toBeLessThan(3);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("AIP-015 AIP-010 in Ignoring mode it patrols its route through the asteroids, touching nothing, and keeps going round", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "ai-patrol.json"))));
    const pilotBody = () => w.bodies.find((b) => b.id === "e1-hull")!;
    const own = new Set(w.bodies.filter((b) => b.id.startsWith("e1-")).map((b) => b.id));
    const reached = new Set<number>();
    let contacts = 0;
    for (let i = 0; i < 14400; i++) {
      stepInPlace(w, [], sandbox);
      const g = pilotBody().pilot!.goal;
      if (g.kind === "route") reached.add(g.index ?? 0);
      contacts += w.contacts.filter((c) => own.has(c.a) !== own.has(c.b) && !/e1-breech-shell/.test(c.a + c.b)).length;
    }
    expect([...reached].sort()).toEqual([0, 1, 2, 3, 4]); // round the loop and back to the start
    expect(contacts).toBe(0);
    expect(pilotBody().pilot!.mode).toBe("ignoring");
    expect(w.ledger.violations).toBe(0);
  }, 600_000);
});

/**
 * Two Gunship 2s in empty space: the player's (its own ids and channels) at `player`, pointing up,
 * and an AI one (ids e1-*, channels e1.*) at `ai`, with a pilot in `mode`.
 */
function duel(o: { mode: string; ai?: { x: number; y: number }; player?: { x: number; y: number; vx?: number; vy?: number }; combat?: number; route?: boolean }): World {
  const raw = readJson(join(ROOT, "scenarios", "base.json")) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  type B = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const shift = (p: B, dx: number, dy: number) => ({ x: typeof p.x === "number" ? p.x + dx : { $expr: `(${p.x.$expr}) + ${dx}` }, y: typeof p.y === "number" ? p.y + dy : { $expr: `(${p.y.$expr}) + ${dy}` } });
  const parts: B[] = raw.world.bodies.filter((b: B) => !b.fixed);
  const ids = new Set(parts.map((b) => b.id));
  const pl = o.player ?? { x: 0, y: 0 };
  const ai = o.ai ?? { x: 0, y: 60 };
  const player = parts.map((b) => ({ ...structuredClone(b), position: shift(b.position, pl.x, pl.y), velocity: { x: pl.vx ?? 0, y: pl.vy ?? 0 } }));
  const enemy = parts.map((b) => {
    const c = structuredClone(b);
    c.id = `e1-${b.id}`;
    c.position = shift(b.position, ai.x, ai.y);
    if (c.injector) c.injector.channel = `e1.${c.injector.channel}`;
    if (c.tractor) c.tractor.channel = `e1.${c.tractor.channel}`;
    if (c.magazine?.railgun) c.magazine.railgun.channel = `e1.${c.magazine.railgun.channel}`;
    return c;
  });
  enemy.find((b) => b.id === "e1-hull")!.pilot = { skill: { flight: 0.7, combat: o.combat ?? 0.5 }, mode: o.mode, goal: { kind: "idle" }, ...(o.route !== false && o.mode !== "hunting" ? { route: { waypoints: [ai, { x: ai.x + 1, y: ai.y }], loop: true } } : {}) };
  const joints = raw.world.joints.filter((j: B) => ids.has(j.a));
  const links = raw.world.links.filter((l: B) => ids.has(l.to));
  raw.world.bodies = [...player, ...enemy];
  raw.world.joints = [...joints, ...joints.map((j: B) => ({ ...j, id: `e1-${j.id}`, a: `e1-${j.a}`, b: `e1-${j.b}` }))];
  raw.world.links = [...links, ...links.map((l: B) => ({ ...l, id: `e1-${l.id}`, to: `e1-${l.to}`, ...(l.from ? { from: `e1-${l.from}` } : {}), ...(l.channel ? { channel: `e1.${l.channel}` } : {}) }))];
  raw.world.gravity = { x: 0, y: 0 };
  raw.world.asteroids = [];
  delete raw.world.bounds;
  Object.assign(raw, { timeline: [], probes: [], assertions: [] });
  delete raw.ui;
  return initialWorld(parseScenario(raw));
}
const enemyPilot = (w: World) => w.bodies.find((b) => b.id === "e1-hull")!.pilot!;

describe("AI pilot combat (phase 3)", () => {
  it("AIP-011 it leads a moving target: a shell on its aim meets the target, allowing for its own motion; with no lead it aims where the target is", () => {
    const from = { x: 0, y: 0 };
    const own = { x: 1, y: -2 };
    const target = { x: 80, y: 30 };
    const tv = { x: -3, y: 6 };
    const muzzle = 45;
    const d = aimAt(from, own, target, tv, muzzle, 1);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    // Shell velocity = ours + muzzle along d; find the time it is nearest the target, and check it meets it.
    const sv = { x: own.x + muzzle * d.x, y: own.y + muzzle * d.y };
    const r = { x: target.x - from.x, y: target.y - from.y };
    const w = { x: tv.x - sv.x, y: tv.y - sv.y };
    const t = -(r.x * w.x + r.y * w.y) / (w.x * w.x + w.y * w.y);
    expect(t).toBeGreaterThan(0);
    expect(Math.hypot(r.x + w.x * t, r.y + w.y * t)).toBeLessThan(1e-9);
    const flat = aimAt(from, own, target, tv, muzzle, 0);
    expect(flat.x).toBeCloseTo(target.x / Math.hypot(target.x, target.y), 12);
    expect(flat.y).toBeCloseTo(target.y / Math.hypot(target.x, target.y), 12);
  });

  it("AIP-015 AIP-016 scenarios take the combat modes, a side and a detection range; Cautious and Evading need a route", () => {
    const raw = readJson(join(ROOT, "scenarios", "ai-patrol.json")) as { world: { bodies: Record<string, any>[] } }; // eslint-disable-line @typescript-eslint/no-explicit-any
    const pilot = () => raw.world.bodies.find((b) => b.id === "e1-hull")!.pilot;
    for (const mode of ["hunting", "cautious", "evading"]) {
      Object.assign(pilot(), { mode, side: "pirates", detect: 120 });
      expect(() => parseScenario(structuredClone(raw))).not.toThrow();
    }
    const route = pilot().route;
    delete pilot().route;
    expect(() => parseScenario(structuredClone(raw))).toThrow(); // evading, no route
    pilot().mode = "hunting";
    expect(() => parseScenario(structuredClone(raw))).not.toThrow(); // a hunter needs none
    pilot().route = route;
    for (const bad of [{ mode: "berserk" }, { detect: -5 }, { side: 3 }]) {
      const r = structuredClone(raw);
      Object.assign(r.world.bodies.find((b) => b.id === "e1-hull")!.pilot, bad);
      expect(() => parseScenario(r)).toThrow();
    }
  });

  it("AIP-003 it never touches a gun whose fire channel another ship shares, and only a fighting pilot works its own trigger", () => {
    const w = ship({ kind: "idle" });
    w.links.push({ id: "x", kind: "control", channel: "e1.fire", to: "elsewhere", integrity: 1 } as never);
    hull(w).pilot!.mode = "hunting";
    w.controls["e1.fire"] = 0.7;
    run(w, 24);
    expect(w.controls["e1.fire"]).toBe(0.7);
    const m = ship({ kind: "idle" }); // manual, owning its gun: it leaves the trigger to whoever set it
    m.controls["e1.fire"] = 0.7;
    run(m, 24);
    expect(m.controls["e1.fire"]).toBe(0.7);
  }, 120_000);

  it("AIP-015 a Cautious pilot is not provoked by an armed ship closing on it without firing", () => {
    const w = duel({ mode: "cautious", ai: { x: 0, y: 30 }, player: { x: 0, y: 0, vy: 8 } });
    run(w, 240);
    expect(enemyPilot(w).combat?.grudgeUntil).toBeUndefined();
    expect(enemyPilot(w).intent).toMatch(/watching hull/);
  }, 120_000);

  it("AIP-011 AIP-012 AIP-015 a Hunting pilot closes on the player's ship, aims, fires and hits it, with the ledger clean", () => {
    const w = duel({ mode: "hunting", ai: { x: 0, y: 45 }, combat: 1 });
    const player = () => new Set(w.bodies.filter((b) => !b.id.startsWith("e1-")).map((b) => b.id));
    let hit = false;
    for (let i = 0; i < 2400 && !hit; i++) {
      stepInPlace(w, [], sandbox);
      const own = player();
      hit = w.events.some((e) => e.tick === w.tick - 1 && (e.type === "detonation" || e.type === "collision") && /^e1-breech-shell-/.test(String(e.data.id ?? e.data.a) + String(e.data.b ?? "")) && (own.has(String(e.data.a)) || own.has(String(e.data.b)) || e.type === "detonation"));
    }
    expect(enemyPilot(w).combat!.shots).toBeGreaterThan(0);
    expect(enemyPilot(w).combat!.muzzle).toBeGreaterThan(60); // learned from its shots: Gunship 3 fires at about 96 m/s
    expect(hit).toBe(true);
    expect(w.ledger.violations).toBe(0);
  }, 600_000);
});

