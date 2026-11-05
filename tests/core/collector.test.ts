// The home base: a big asteroid with gravity, and its egg-cup collector (BAS-001…BAS-004).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, createWorld, getProfile, initialWorld, parseScenario, ScenarioError, stepInPlace, type BodyInput, type Command, type World } from "../../src/core/index.ts";
import { box, disc, readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const at = (w: World, id: string) => w.bodies.find((b) => b.id === id);
const ball = (id: string, radius: number, mass: number, x: number, y: number, over: Record<string, unknown> = {}): BodyInput =>
  ({ ...disc(id, { mass, position: { x, y } } as never), shape: { kind: "disc", radius }, ...over }) as never;
/** A fixed egg cup at the origin: floor, two flared walls; the collector reels into the bowl. */
const cup = (over: Record<string, unknown> = {}): BodyInput[] =>
  [
    { ...box("cup-floor", 6, 0.6, { fixed: true, position: { x: 0, y: 0 } }), collector: { mouth: { x: 0, y: 1.5 }, ...over } },
    box("cup-left", 0.6, 4, { fixed: true, position: { x: -3.6, y: 1.6 }, angle: 0.35 } as never),
    box("cup-right", 0.6, 4, { fixed: true, position: { x: 3.6, y: 1.6 }, angle: -0.35 } as never),
  ] as never;
const collector = (w: World) => at(w, "cup-floor")!.collector!;
const run = (w: World, steps: number, cmds: (i: number) => Command[] = () => []) => {
  for (let i = 0; i < steps; i++) stepInPlace(w, cmds(i), sandbox);
};

describe("collector", () => {
  it("BAS-002 BAS-004 loose cargo near the cup is tethered, reeled in all the way, captured and counted by mineral, with the ledger exact", () => {
    const w = createWorld(1, [...cup(), ball("nugget", 0.8, 20, 6, 7, { mineral: "gold" }), ball("stone", 0.6, 12, -5, 6)]);
    run(w, 240);
    expect(w.events.filter((e) => e.type === "collector.engage")).toHaveLength(1); // one at a time: the nearest first
    run(w, 9600);
    expect(at(w, "nugget")).toBeUndefined();
    expect(at(w, "stone")).toBeUndefined();
    expect(collector(w).delivered).toEqual({ gold: 20, rock: 12 });
    const got = w.events.filter((e) => e.type === "cargo.collected");
    expect(got.map((e) => e.data.mass).sort()).toEqual([12, 20]);
    expect(w.ledger.violations).toBe(0);
    expect(w.ledger.maxResidual.energy).toBeLessThan(1e-6);
  }, 300_000);

  it("BAS-002 it takes neither ship parts nor anything too big for the cup, nor anything out of reach", () => {
    const w = createWorld(1, [
      ...cup(),
      { ...ball("ship", 0.8, 50, 3, 6), tractor: { channel: "t", origin: { x: 0, y: 0 }, direction: { x: 0, y: -1 } } } as never,
      ball("boulder", 4, 200, -9, 9),
      ball("far", 0.5, 10, 0, 30),
    ]);
    run(w, 240);
    expect(collector(w).cargo).toBeUndefined();
    expect(at(w, "ship")!.velocity).toEqual({ x: 0, y: 0 });
    expect(at(w, "far")!.velocity).toEqual({ x: 0, y: 0 });
  });

  it("BAS-003 while a ship still holds the cargo both tethers act, the collector's far softer; once the ship lets go it reels the cargo in", () => {
    const ship = { ...box("ship", 3, 4, { mass: 50, position: { x: 0, y: 30 } }), tractor: { channel: "tractor", origin: { x: 0, y: -2 }, direction: { x: 0, y: -1 } } } as BodyInput;
    const w = createWorld(1, [...cup(), ship as never, ball("nugget", 0.8, 20, 0, 9, { mineral: "gold" })], { x: 0, y: 0 }, { links: [{ id: "c", kind: "control", channel: "tractor", to: "ship" }] });
    const set = (v: number): Command[] => [{ type: "control.set", channel: "tractor", value: v }];
    for (let i = 0; i < 2000 && at(w, "ship")!.tractor!.mode !== "tether"; i++) stepInPlace(w, set(1), sandbox);
    stepInPlace(w, set(0), sandbox);
    expect(at(w, "ship")!.tractor!.mode).toBe("tether");
    expect(collector(w).cargo).toBe("nugget");
    // Held by both: connected, the collector pulling far more gently than the ship's tether can.
    let worst = 0;
    for (let i = 0; i < 480; i++) {
      stepInPlace(w, [], sandbox);
      worst = Math.max(worst, Math.abs(collector(w).tension));
    }
    expect(at(w, "nugget")).toBeDefined();
    expect(collector(w).cargo).toBe("nugget");
    expect(worst).toBeLessThan(0.2 * at(w, "ship")!.tractor!.tether.maxTension);
    // The ship lets go: the collector reels it in.
    run(w, 20, (i) => (i === 0 ? set(1) : i === 10 ? set(0) : []));
    expect(at(w, "ship")!.tractor!.mode).not.toBe("tether");
    for (let i = 0; i < 9600 && at(w, "nugget"); i++) stepInPlace(w, [], sandbox);
    expect(at(w, "nugget")).toBeUndefined();
    expect(collector(w).delivered.gold).toBe(20);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("BAS-004 cargo as big as the cup takes reaches the bowl and is captured; stores count in what is delivered", () => {
    const w = createWorld(1, [...cup(), ball("big", 2.9, 30, 0, 7), ball("tank", 0.5, 1, -6, 6, { contents: [{ resource: "h2", mass: 9, capacity: 9 }] })]);
    for (let i = 0; i < 24000 && (at(w, "big") || at(w, "tank")); i++) stepInPlace(w, [], sandbox);
    expect(at(w, "big")).toBeUndefined();
    expect(at(w, "tank")).toBeUndefined();
    expect(collector(w).delivered.rock).toBeCloseTo(40, 9); // 30 kg, and the tank's 1 kg with its 9 kg of hydrogen
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("BAS-002 a collector must be on a fixed body", () => {
    const raw = readJson(join(ROOT, "scenarios", "base.json")) as { world: { bodies: { id: string; fixed?: boolean }[] } };
    const r = structuredClone(raw);
    for (const b of r.world.bodies) if (b.id === "cup-floor") b.fixed = false;
    expect(() => parseScenario(r)).toThrow(ScenarioError);
    expect(() => parseScenario(raw)).not.toThrow();
  });
});

describe("home base scenario", () => {
  it("BAS-001 Gunship 2 rests on the pad under the base's gravity while the rubble asteroids circle on their orbits", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "base.json"))));
    const rock = at(w, "base-rock")!;
    const centre = rock.position;
    const radius = (pre: string) => {
      const ps = w.bodies.filter((b) => b.id.startsWith(`${pre}-`));
      const m = ps.reduce((s, b) => s + b.mass, 0);
      return Math.hypot(ps.reduce((s, b) => s + b.mass * b.position.x, 0) / m - centre.x, ps.reduce((s, b) => s + b.mass * b.position.y, 0) / m - centre.y);
    };
    const r0 = ["ra", "rb", "rc"].map(radius);
    const hull0 = { ...at(w, "hull")!.position };
    run(w, 2400); // 10 s
    expect(at(w, "hull")!.angle).toBeCloseTo(0, 1);
    expect(Math.hypot(at(w, "hull")!.position.x - hull0.x, at(w, "hull")!.position.y - hull0.y)).toBeLessThan(0.3);
    const v = assemblyTotals(w, "hull")!;
    expect(Math.hypot(v.momentum.x, v.momentum.y) / v.mass).toBeLessThan(0.1);
    ["ra", "rb", "rc"].map(radius).forEach((r, i) => expect(Math.abs(r / r0[i] - 1)).toBeLessThan(0.03));
    // Surface gravity about 2 m/s².
    const g = rock.gravity!;
    const d = 52;
    expect((g.mu * d) / (d * d + g.core * g.core) ** 1.5).toBeGreaterThan(1.6);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);

  it("BAS-002 BAS-004 a gold piece brought near the egg cup is reeled in and delivered", () => {
    const w = initialWorld(parseScenario(readJson(join(ROOT, "scenarios", "base.json"))));
    const floor = at(w, "cup-floor")!;
    stepInPlace(w, [{ type: "body.add", body: ball("nugget", 0.7, 30, floor.position.x + 4, floor.position.y + 7, { mineral: "gold" }) }], sandbox);
    for (let i = 0; i < 9600 && at(w, "nugget"); i++) stepInPlace(w, [], sandbox);
    expect(at(w, "nugget")).toBeUndefined();
    expect(floor.collector!.delivered.gold).toBe(30);
    expect(w.ledger.violations).toBe(0);
  }, 300_000);
});
