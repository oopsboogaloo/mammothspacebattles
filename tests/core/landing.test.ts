// Landing challenge (FLT-005…FLT-008): the judge, on the LAND scenario and on small worlds.
// Also GAS-009 on the LAND ship: exhaust spreads out of the plane, but not out of the engines.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, createWorld, getProfile, initialWorld, parseScenario, stepInPlace, type Command, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

type Raw = { world: { bodies: { id: string; position: { x: number; y: number }; velocity: { x: number; y: number } }[]; bounds: { depth?: number } } };
const raw = () => readJson(join(ROOT, "scenarios", "land-twin-engine.json")) as Raw;
const profile = getProfile("sandbox");

/** The LAND world with the ship moved by (dx, dy) and given velocity v. */
function landWorld(dx = 0, dy = 0, v?: { x: number; y: number }, edit?: (d: Raw) => void): World {
  const d = raw();
  edit?.(d);
  const ship = new Set(["hull", "tank", "wing", "engine-l", "engine-r", "leg-left", "leg-right"].concat(d.world.bodies.map((b) => b.id).filter((id) => /^(chamber|throat|nozzle)-/.test(id))));
  for (const b of d.world.bodies) {
    if (!ship.has(b.id)) continue;
    b.position = { x: b.position.x + dx, y: b.position.y + dy };
    if (v) b.velocity = { ...v };
  }
  return initialWorld(parseScenario(d));
}

function run(w: World, steps: number, control: (w: World) => Command[] = () => []): void {
  for (let i = 0; i < steps && w.challenge!.status.phase === "flying"; i++) stepInPlace(w, control(w), profile);
}

const set = (left: number, right: number): Command[] => [
  { type: "control.set", channel: "left", value: left },
  { type: "control.set", channel: "right", value: right },
];

describe("landing challenge", () => {
  it("FLT-005 the LAND scenario opens with the ship flying, its altitude, speed, tilt and propellant known", () => {
    const w = landWorld();
    const s = w.challenge!.status;
    expect(s.phase).toBe("flying");
    expect(s.altitude).toBeCloseTo(13.65, 6); // feet 1.35 m below the ship's origin, 15 m up
    expect(s.vx).toBeCloseTo(1.2, 6);
    expect(s.tilt).toBe(0);
    expect(s.fuel).toBeCloseTo(8.1, 6);
    expect(s.fuelStart).toBeCloseTo(8.1, 6);
  });

  it("FLT-006 a fall with no thrust onto the terrain is a crash off the pad", () => {
    const w = landWorld();
    run(w, 2400);
    const s = w.challenge!.status;
    expect(s.phase).toBe("crashed");
    expect(s.reason).toMatch(/^Touched the ground off the pad/);
    expect(w.events.some((e) => e.type === "crashed" && e.tick === s.at)).toBe(true);
    // The impact itself is clean: the ledger finds nothing for 1.5 s after it (welds don't warm start).
    for (let i = 0; i < 360; i++) stepInPlace(w, [], profile);
    expect(w.ledger.violations).toBe(0);
  });

  it("FLT-006 a fall with no thrust onto the pad is a crash for hitting it too hard", () => {
    // Straight above the pad's centre (x = 8): the ship's centre line is x = 0 + (−14) in the file.
    const w = landWorld(22, 0, { x: 0, y: 0 });
    run(w, 2400);
    const s = w.challenge!.status;
    expect(s.phase).toBe("crashed");
    expect(s.reason).toMatch(/^Hit the pad at [0-9.]+ m\/s: land slower than 1\.5 m\/s\.$/);
  });

  it("FLT-007 a slow, upright descent onto the pad lands, with a score", () => {
    // 1.5 m above the pad and still. The autopilot flies as a pilot would: both engines hold the
    // descent near 0.5 m/s, one engine alone corrects tilt (the left one turns the nose right), and
    // the engines are cut just above the pad, where their own exhaust would otherwise cushion it.
    const w = landWorld(22, -12.15, { x: 0, y: 0 });
    let prev = 0;
    run(w, 4800, (x) => {
      const s = x.challenge!.status;
      const target = -Math.min(0.5, 0.2 + 0.2 * s.altitude);
      const rate = (s.tilt - prev) * 240;
      prev = s.tilt;
      const err = s.tilt + 0.4 * rate;
      const lift = s.vy < target;
      let L = lift ? 1 : 0;
      let R = lift ? 1 : 0;
      if (err > 1) [L, R] = [1, lift && err < 4 ? 1 : 0];
      if (err < -1) [L, R] = [lift && err > -4 ? 1 : 0, 1];
      if (s.altitude < 0.35) [L, R] = [0, 0];
      return set(L, R);
    });
    const s = w.challenge!.status;
    expect(s.phase, s.reason).toBe("landed");
    expect(s.touchdown).toBeLessThan(1.5);
    expect(Math.abs(s.tilt)).toBeLessThan(12);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(1000);
    expect(s.reason).toMatch(/^Landed at /);
    expect(w.events.filter((e) => e.type === "landed")).toHaveLength(1);
    // It stays down, and the ledger stays clean, with the exhaust still around it.
    for (let i = 0; i < 240; i++) stepInPlace(w, [], profile);
    expect(w.challenge!.status.altitude).toBeLessThan(0.05);
    expect(w.ledger.violations).toBe(0);
  }, 300_000); // gas under coverage on CI runs several times slower than here

  it("FLT-008 a ship that comes to rest tipped over is a crash, even after a gentle touch", () => {
    // A tall box leaning at 60° on a pad, barely moving: it falls onto its side and rests at 90°.
    const w = createWorld(
      1,
      [
        { id: "pad", shape: { kind: "box", width: 10, height: 0.4 }, mass: 1, fixed: true, position: { x: 0, y: -0.2 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, friction: 0.9 },
        { id: "ship", shape: { kind: "box", width: 0.4, height: 2 }, mass: 5, position: { x: 0, y: 0.75 }, velocity: { x: 0, y: 0 }, angle: Math.PI / 3, angularVelocity: 0, friction: 0.9 },
      ],
      { x: 0, y: -1.6 },
      { challenge: { kind: "landing", ship: "ship", pad: "pad", maxSpeed: 1.5, maxTilt: 12 } },
      profile,
    );
    run(w, 4800);
    const s = w.challenge!.status;
    expect(s.phase).toBe("crashed");
    expect(s.reason).toMatch(/^Came to rest tilted \d+°: land within 12° of upright\.$/);
  });

  it("FLT-005 the verdict is part of the world: the same run reaches it at the same step, and it stays", () => {
    const a = landWorld();
    const b = landWorld();
    run(a, 2400);
    run(b, 2400);
    expect(b.challenge).toEqual(a.challenge);
    const at = a.challenge!.status.at;
    for (let i = 0; i < 60; i++) stepInPlace(a, [], profile);
    expect(a.challenge!.status.phase).toBe("crashed");
    expect(a.challenge!.status.at).toBe(at);
  });

  it("FLT-005 a challenge must name a ship in the world and a fixed pad", () => {
    const d = raw() as unknown as { world: { challenge: Record<string, unknown> } };
    d.world.challenge = { kind: "landing", ship: "nope", pad: "hull", maxSpeed: 0, maxTilt: 12 };
    let errors: { path: string }[] = [];
    try {
      parseScenario(d);
    } catch (e) {
      errors = (e as { errors: { path: string }[] }).errors;
    }
    expect(errors.map((x) => x.path).sort()).toEqual(["$.world.challenge.maxSpeed", "$.world.challenge.pad", "$.world.challenge.ship"]);
  });

  it("GAS-009 after the engines cut out the exhaust under the ship spreads out of the plane, so it no longer holds the ship up", () => {
    // 0.6 m above the pad, fire both engines for 0.25 s, then cut them, and watch the push of the gas
    // over a window while the ship is still in the air: gravity alone should then set its fall.
    const w = landWorld(22, 0.6 - 13.65, { x: 0, y: 0 });
    for (let i = 0; i < 60; i++) stepInPlace(w, set(1, 1), profile);
    for (let i = 0; i < 84; i++) stepInPlace(w, set(0, 0), profile); // to 0.35 s after the cut
    const a = assemblyTotals(w, "hull")!;
    for (let i = 0; i < 96; i++) stepInPlace(w, set(0, 0), profile); // to 0.75 s after
    const b = assemblyTotals(w, "hull")!;
    expect(w.challenge!.status.phase).toBe("flying");
    const push = b.mass * ((b.velocity.y - a.velocity.y) / (96 * profile.timestep) + 1.6);
    expect(Math.abs(push)).toBeLessThan(0.03 * b.mass * 1.6); // under 3% of its weight (it was about 7%)
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("GAS-009 gas inside the engines doesn't spread out of the plane: thrust in open space changes by under 5%", () => {
    // The jets are chaotic: a few millimetres' offset changes a 0.5 s climb by 1–2%. So compare the
    // mean of four slightly offset climbs, with and without the depth.
    const climb = (depth: boolean, dx: number) => {
      const w = landWorld(22 + dx, 20 - 13.65, { x: 0, y: 0 }, (d) => {
        if (!depth) delete d.world.bounds.depth;
      });
      for (let i = 0; i < 120; i++) stepInPlace(w, set(1, 1), profile);
      expect(w.ledger.violations).toBe(0);
      return assemblyTotals(w, "hull")!.velocity.y;
    };
    const offsets = [0, 0.003, 0.007, 0.011];
    const mean = (depth: boolean) => offsets.reduce((s, dx) => s + climb(depth, dx), 0) / offsets.length;
    const flat = mean(false);
    expect(flat).toBeGreaterThan(0.5);
    expect(Math.abs(mean(true) - flat)).toBeLessThan(0.05 * flat);
  }, 600_000);
});
