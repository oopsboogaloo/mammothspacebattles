// Tractor beam and tether (TRC-001…TRC-006).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeTotals, createWorld, getProfile, initialWorld, parseScenario, ScenarioError, stepInPlace, type BodyInput, type Command, type World } from "../../src/core/index.ts";
import { box, disc, readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const set = (value: number): Command[] => [{ type: "control.set", channel: "tractor", value }];
const ship = (over: Record<string, unknown> = {}): BodyInput =>
  ({ ...box("ship", 3, 4, { mass: 50, position: { x: 0, y: 0 } }), tractor: { channel: "tractor", origin: { x: 0, y: -2 }, direction: { x: 0, y: -1 }, ...over } }) as never;
const world = (others: BodyInput[], over: Record<string, unknown> = {}): World => createWorld(1, [ship(over), ...others], { x: 0, y: 0 }, { links: [{ id: "c", kind: "control", channel: "tractor", to: "ship" }] });
const at = (w: World, id: string) => w.bodies.find((b) => b.id === id)!;
/** Distance from the beam's origin (the ship's tail) to a body. */
const reach = (w: World, id: string) => {
  const s = at(w, "ship");
  const c = Math.cos(s.angle);
  const n = Math.sin(s.angle);
  const o = { x: s.position.x + 2 * n, y: s.position.y - 2 * c };
  return Math.hypot(at(w, id).position.x - o.x, at(w, id).position.y - o.y);
};
const ball = (id: string, radius: number, mass: number, x: number, y: number): BodyInput => ({ ...disc(id, { mass, position: { x, y } } as never), shape: { kind: "disc", radius } }) as never;
/** Holds the button until the tether takes something (at most `max` steps), then releases it. */
const engage = (w: World, max = 4000) => {
  for (let i = 0; i < max && at(w, "ship").tractor!.mode !== "tether"; i++) stepInPlace(w, set(1), sandbox);
  stepInPlace(w, set(0), sandbox);
};
const run = (w: World, steps: number, cmds: (i: number) => Command[] = () => []) => {
  for (let i = 0; i < steps; i++) stepInPlace(w, cmds(i), sandbox);
};

describe("tractor beam", () => {
  it("TRC-001 TRC-002 the beam pulls what is in its wedge toward the ship, and the ship toward it, with the force shared and momentum exact", () => {
    const w = world([
      ball("a", 0.5, 200, 3, -40), // in the wedge
      ball("b", 0.5, 200, -3, -40), // in the wedge
      ball("side", 0.5, 200, 20, -20), // 45° off the axis
      ball("far", 0.5, 200, 0, -60), // past 50 m
    ]);
    run(w, 120, (i) => (i === 0 ? set(1) : []));
    // 400 N shared by two: 200 N each on 200 kg is 1 m/s², toward the ship (up).
    expect(at(w, "a").velocity.y / w.time).toBeCloseTo(1, 2);
    expect(at(w, "b").velocity.y / w.time).toBeCloseTo(1, 2);
    // The ship takes the whole 400 N the other way: 8 m/s² on 50 kg.
    expect(at(w, "ship").velocity.y / w.time).toBeCloseTo(-8, 1);
    expect(at(w, "side").velocity).toEqual({ x: 0, y: 0 });
    expect(at(w, "far").velocity).toEqual({ x: 0, y: 0 });
    const t = computeTotals(w);
    expect(Math.abs(t.momentum.x) + Math.abs(t.momentum.y)).toBeLessThan(1e-9);
    expect(w.ledger.last!.sources.tractor.energy).toBeGreaterThan(0); // the ship powers it
    expect(w.ledger.violations).toBe(0);
  });

  it("TRC-003 within 15 m, something no bigger than the ship is taken on the tether; something too heavy or too big is not", () => {
    const w = world([ball("ball", 1, 50, 1, -40)]);
    run(w, 2000, () => set(1));
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    expect(at(w, "ship").tractor!.cargo).toBe("ball");
    const e = w.events.find((x) => x.type === "tether.engage")!;
    expect(Number(e.data.distance)).toBeLessThanOrEqual(15);

    const heavy = world([ball("rock", 1, 61, 1, -40)]); // over 1.2 × 50 kg
    let nearheavy = Infinity;
    run(heavy, 2000, () => {
      nearheavy = Math.min(nearheavy, reach(heavy, "rock"));
      return set(1);
    });
    expect(nearheavy).toBeLessThan(11); // it came well within reach…
    expect(heavy.events.some((e) => e.type === "tether.engage")).toBe(false); // …and was never taken
    const big = world([ball("rock", 3, 10, 1, -40)]); // wider than the ship
    let nearbig = Infinity;
    run(big, 2000, () => {
      nearbig = Math.min(nearbig, reach(big, "rock"));
      return set(1);
    });
    expect(nearbig).toBeLessThan(11); // it came well within reach…
    expect(big.events.some((e) => e.type === "tether.engage")).toBe(false); // …and was never taken
  });

  it("TRC-004 the tether holds the cargo at 15 m as it swings round the ship, and the ledger stays exact", () => {
    const w = world([ball("ball", 1, 50, 0, -18)]);
    engage(w);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    run(w, 960); // settle
    // Throw the ball sideways: it swings round on the tether.
    stepInPlace(w, [{ type: "body.impulse", id: "ball", impulse: { x: 400, y: 0 }, point: at(w, "ball").position }], sandbox);
    let lo = Infinity;
    let hi = 0;
    for (let i = 0; i < 2400; i++) {
      stepInPlace(w, [], sandbox);
      lo = Math.min(lo, reach(w, "ball"));
      hi = Math.max(hi, reach(w, "ball"));
    }
    expect(lo).toBeGreaterThan(14);
    expect(hi).toBeLessThan(16);
    // It went a long way round: the line from ship to ball turned.
    const s = at(w, "ship");
    const b = at(w, "ball");
    expect(Math.abs(b.position.x - s.position.x)).toBeGreaterThan(6);
    expect(w.ledger.violations).toBe(0);
    expect(w.ledger.maxResidual.energy).toBeLessThan(1e-6);
  });

  it("TRC-005 pressing again lets the cargo go, and the beam stays off until the button is released", () => {
    const w = world([ball("ball", 1, 50, 0, -18)]);
    engage(w);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    run(w, 30, () => set(1)); // pressed and held
    expect(at(w, "ship").tractor!.mode).toBe("off");
    expect(w.events.some((e) => e.type === "tether.release")).toBe(true);
    run(w, 2, (i) => (i === 0 ? set(0) : []));
    run(w, 2, (i) => (i === 0 ? set(1) : []));
    expect(at(w, "ship").tractor!.mode).toBe("tether"); // a fresh press beams again, and the ball is in reach
  });

  it("TRC-006 past its maximum tension the tether breaks", () => {
    const w = world([ball("ball", 1, 50, 0, -18)], { tether: { maxTension: 2000 } });
    engage(w);
    run(w, 960);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    // Yank the ship away at 30 m/s.
    stepInPlace(w, [{ type: "body.impulse", id: "ship", impulse: { x: 0, y: 1500 }, point: at(w, "ship").position }], sandbox);
    run(w, 120);
    const e = w.events.find((x) => x.type === "tether.break");
    expect(e).toBeDefined();
    expect(Number(e!.data.tension)).toBeGreaterThan(2000);
    expect(at(w, "ship").tractor!.mode).not.toBe("tether");
    expect(w.ledger.violations).toBe(0);
  });

  it("TRC-005 TRC-006 a tether that breaks with the button held is not taken again until a fresh press", () => {
    // Close cargo, a weak tether: it breaks at once, and must not re-engage while T stays held.
    const w = world([ball("ball", 1, 50, 0, -11)], { tether: { maxTension: 500 } });
    run(w, 240, () => set(1));
    const engaged = w.events.filter((e) => e.type === "tether.engage").length;
    expect(w.events.some((e) => e.type === "tether.break")).toBe(true);
    expect(engaged).toBe(1);
    expect(at(w, "ship").tractor!.mode).toBe("off");
    expect(w.ledger.violations).toBe(0);
  });

  it("TRC-001 losing the control link lets the cargo go", () => {
    const w = world([ball("ball", 1, 50, 0, -18)]);
    engage(w);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    w.links = [];
    run(w, 2);
    expect(at(w, "ship").tractor!.mode).toBe("off");
    expect(w.events.some((e) => e.type === "tether.release")).toBe(true);
  });

  it("TRC-001 a tractor without its control link does nothing", () => {
    const w = createWorld(1, [ship(), ball("ball", 1, 50, 0, -40)]);
    run(w, 30, () => set(1));
    expect(at(w, "ship").tractor!.mode).toBe("off");
    expect(at(w, "ball").velocity).toEqual({ x: 0, y: 0 });
  });

  it("TRC-001 a scenario's tractor is validated", () => {
    const raw = readJson(join(ROOT, "scenarios", "tractor.json")) as { world: { bodies: { id: string; tractor?: Record<string, unknown> }[] } };
    const bad = (patch: Record<string, unknown>) => {
      const r = structuredClone(raw);
      for (const b of r.world.bodies) if (b.id === "hull") b.tractor = { ...b.tractor, ...patch };
      return () => parseScenario(r);
    };
    expect(bad({ direction: { x: 0, y: 0 } })).toThrow(ScenarioError);
    expect(bad({ arc: 4 })).toThrow(ScenarioError);
    expect(bad({ tether: { length: -1 } })).toThrow(ScenarioError);
    expect(bad({})).not.toThrow();
  });

  it("TRC-003 TRC-004 in the tractor scenario, Gunship 2 beams the ball in and takes it on the tether, with the ledger clean", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "tractor.json")));
    const w = initialWorld(scn);
    for (let i = 0; i < 1200 && at(w, "hull").tractor!.mode !== "tether"; i++) stepInPlace(w, i === 10 ? set(1) : [], sandbox);
    const t = at(w, "hull").tractor!;
    expect(t.mode).toBe("tether");
    expect(t.cargo).toBe("ball");
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});
