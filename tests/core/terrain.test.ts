// Ground from an outline, which explosions and shells crater (TER-001…TER-005): src/core/terrain.ts.
import { describe, expect, it } from "vitest";
import { TERRAIN_OPS, createRng, createWorld, cutCrater, craterRadius, getProfile, hashValue, nextFloat, parseScenario, ScenarioError, stepInPlace, type BodyInput, type Command, type TerrainSpec, type World } from "../../src/core/index.ts";

const sandbox = getProfile("sandbox");
const P = (x: number, y: number) => ({ x, y });
/** Open sky over flat ground at y = 0, 200 m wide, with walls at the sides: clockwise, the rock on the left. */
const FLAT = [P(-100, 60), P(100, 60), P(100, 0), P(-100, 0)];
const world = (craters: TerrainSpec["craters"] | null = {}, bodies: BodyInput[] = [], outline = FLAT): World =>
  createWorld(1, bodies, { x: 0, y: -4 }, { terrain: { outline, ...(craters ? { craters } : {}) } }, sandbox);
const ball = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): BodyInput =>
  ({ id, shape: { kind: "disc", radius: 0.3 }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.5, ...extra }) as never;
const run = (w: World, seconds: number, commands: Command[] = []) => {
  for (let k = 0; k < Math.round(seconds * 240); k++) stepInPlace(w, k === 0 ? commands : [], sandbox);
};
const at = (w: World, id: string) => w.bodies.find((b) => b.id === id)!;
const rocks = (w: World) => w.bodies.filter((b) => b.id.startsWith("rock-"));
/** Whether a point is inside one of the rock's bodies. */
function inRock(w: World, p: { x: number; y: number }): boolean {
  return rocks(w).some((b) => {
    if (b.shape.kind !== "polygon") return false;
    const vs = b.shape.vertices.map((v) => ({ x: v.x + b.position.x, y: v.y + b.position.y }));
    let sign = 0;
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i];
      const c = vs[(i + 1) % vs.length];
      const s = (c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x);
      if (Math.abs(s) < 1e-9) return false;
      if (sign && Math.sign(s) !== sign) return false;
      sign = Math.sign(s);
    }
    return true;
  });
}

describe("terrain", () => {
  it("TER-001 the rock is a crust of fixed bodies along the outline, on its rock side; things rest on it", () => {
    const w = world(null, [ball("b", 5, 3)]);
    expect(rocks(w).length).toBeGreaterThanOrEqual(4);
    expect(rocks(w).every((b) => b.fixed && !b.material)).toBe(true);
    expect(inRock(w, P(0, -1))).toBe(true); // under the ground
    expect(inRock(w, P(0, -14))).toBe(true); // 15 m of it
    expect(inRock(w, P(0, 1))).toBe(false); // the open sky
    expect(inRock(w, P(101, 31))).toBe(true); // the wall at the side
    run(w, 3);
    expect(at(w, "b").position.y).toBeCloseTo(0.3, 1);
    // Without `craters` the ground can't be cut.
    expect(cutCrater(w, P(0, 0), 2, TERRAIN_OPS)).toBe(false);
    expect(w.terrain!.holes).toHaveLength(0);
  });

  it("TER-001 a crater is open space cut into the rock: what was resting there falls into it, and the crust is made afresh round it", () => {
    const w = world({}, [ball("b", 0.4, 0.3)]);
    run(w, 0.5);
    const before = rocks(w).length;
    expect(cutCrater(w, P(0, 0), 2, TERRAIN_OPS)).toBe(true);
    expect(w.terrain!.holes).toMatchObject([{ x: 0, y: 0, r: 2 }]);
    expect(rocks(w).length).toBeGreaterThan(before);
    expect(inRock(w, P(0, -1))).toBe(false); // in the bowl
    expect(inRock(w, P(0, -2.5))).toBe(true); // under it
    expect(inRock(w, P(-3, -0.5))).toBe(true); // beside it
    expect(w.events.filter((e) => e.type === "terrain.crater")).toHaveLength(1);
    expect((w.dust ?? []).length).toBeGreaterThan(10); // the rock leaves as dust
    run(w, 4);
    expect(at(w, "b").position.y).toBeLessThan(-1); // down in the bowl
    expect(at(w, "b").position.y).toBeGreaterThan(-2); // and no further
    // A crater in open space, or inside one already there, changes nothing and isn't kept.
    expect(cutCrater(w, P(20, 10), 2, TERRAIN_OPS)).toBe(false);
    expect(cutCrater(w, P(0.2, 0), 1, TERRAIN_OPS)).toBe(false);
    expect(w.terrain!.holes).toHaveLength(1);
    expect(w.ledger.violations).toBe(0);
  });

  it("TER-001 craters on craters dig as deep as anyone digs: a shaft 18 m down, past the first crust, still has rock round it", () => {
    const w = world();
    for (let k = 0; k <= 12; k++) expect(cutCrater(w, P(0, -1.5 * k), 2, TERRAIN_OPS)).toBe(true);
    stepInPlace(w, [{ type: "body.add", body: ball("b", 0, 3) } as never], sandbox);
    run(w, 6);
    expect(at(w, "b").position.y).toBeLessThan(-18);
    expect(at(w, "b").position.y).toBeGreaterThan(-20.1); // the shaft's floor: nothing fell through
    expect(Math.abs(at(w, "b").position.x)).toBeLessThan(2); // nor out of its sides
    expect(inRock(w, P(0, -21))).toBe(true);
    expect(inRock(w, P(3, -17))).toBe(true);
  });

  it("TER-001 no rock is left inside any crater, and the rock round every crater is whole, wherever they fall", () => {
    const w = world();
    const rng = createRng(11);
    for (let k = 0; k < 60; k++) cutCrater(w, P(-30 + 60 * nextFloat(rng), -4 * nextFloat(rng)), 0.5 + 2.5 * nextFloat(rng), TERRAIN_OPS);
    expect(w.terrain!.holes.length).toBeGreaterThan(30);
    for (const h of w.terrain!.holes) {
      // Well inside the crater: open. (Its rim is a polygon of 8 to 16 sides, so within 0.9 of its radius.)
      for (let a = 0; a < 8; a++) {
        const p = P(h.x + 0.85 * h.r * Math.cos(a), h.y + 0.85 * h.r * Math.sin(a));
        expect(inRock(w, p), `rock inside crater at ${h.x.toFixed(1)}, ${h.y.toFixed(1)}`).toBe(false);
      }
    }
    // And the rock round them holds: balls dropped all over the field come to rest in the craters or
    // on the ground between, none lower than the deepest crater's floor (4 m down, 3 m of radius).
    const drops: Command[] = [];
    for (let k = 0; k < 30; k++) drops.push({ type: "body.add", body: ball(`drop-${k}`, -29 + 2 * k, 2 + (k % 3)) } as never);
    run(w, 7, drops);
    for (let k = 0; k < 30; k++) {
      const b = at(w, `drop-${k}`);
      expect(b.position.y, `drop-${k} fell through at x ${b.position.x.toFixed(1)}`).toBeGreaterThan(-7.3);
      expect(b.position.y).toBeLessThan(0.5);
      expect(Math.hypot(b.velocity.x, b.velocity.y)).toBeLessThan(3); // at rest or rolling, not falling
    }
  });

  it("TER-002 an explosion on the ground leaves a crater 0.6 of its blast's reach across; one too small for the least crater, or in the air, leaves none", () => {
    const charge = (id: string, x: number, y: number, radius: number): BodyInput =>
      ball(id, x, y, { velocity: { x: 0, y: -20 }, explosive: { charge: 0.2, fragments: 0, radius, armed: true } });
    const w = world({}, [charge("a", -20, 2, 4), charge("b", 20, 2, 0.5)]);
    run(w, 0.5);
    expect(w.events.filter((e) => e.type === "detonation")).toHaveLength(2);
    const holes = [...w.terrain!.holes].sort((p, q) => p.x - q.x);
    expect(holes).toHaveLength(1); // the 0.5 m blast would leave 0.3 m, under the least (0.5 m): none
    expect(holes[0].r).toBeCloseTo(2.4, 6); // 0.6 × 4 m
    expect(craterRadius(w.terrain!, 0.5)).toBe(0);
    expect(craterRadius(w.terrain!, 1)).toBeCloseTo(0.6, 6);
    expect(craterRadius(w.terrain!, 100)).toBe(8); // no bigger than the most
    expect(craterRadius(w.terrain!, 0)).toBe(0);
    expect(Math.abs(holes[0].x + 20)).toBeLessThan(0.5);
    // In the air: a charge that goes off 30 m up.
    const air = world({}, [ball("c", 0, 30, { explosive: { charge: 0.2, fragments: 0, radius: 4, armed: true } }), ball("hit", 0, 29, { fixed: true })]);
    air.gravity = { x: 0, y: -40 };
    run(air, 0.5);
    expect(air.events.some((e) => e.type === "detonation")).toBe(true);
    expect(air.terrain!.holes).toHaveLength(0);
  });

  it("TER-003 a solid shell that strikes the rock leaves a small crater where it struck and is spent; one with a charge is left to its explosion", () => {
    const w = world({}, [ball("gun-shell-1", 0, 5, { velocity: { x: 3, y: -60 } }), ball("loose", 30, 5, { velocity: { x: 0, y: -60 } })]);
    run(w, 0.3);
    expect(at(w, "gun-shell-1")).toBeUndefined(); // spent in the rock
    expect(w.terrain!.holes).toHaveLength(1);
    expect(w.terrain!.holes[0]).toMatchObject({ r: 0.5 });
    expect(Math.abs(w.terrain!.holes[0].y)).toBeLessThan(0.35); // at the surface
    expect(at(w, "loose")).toBeDefined(); // not a shell: no crater, and it stays
    expect(w.ledger.violations).toBe(0); // the shell left through the boundary
    const live = world({}, [ball("gun-shell-1", 0, 5, { velocity: { x: 0, y: -60 }, explosive: { charge: 0.1, fragments: 0, radius: 5, armed: true } })]);
    run(live, 0.3);
    expect(live.terrain!.holes).toHaveLength(1);
    expect(live.terrain!.holes[0].r).toBeCloseTo(3, 6); // its explosion's crater, not a bullet's
    // With `bullet` 0 a shell leaves no crater, and is spent all the same.
    const none = world({ bullet: 0 }, [ball("gun-shell-1", 0, 5, { velocity: { x: 0, y: -60 } })]);
    run(none, 0.3);
    expect(at(none, "gun-shell-1")).toBeUndefined();
    expect(none.terrain!.holes).toHaveLength(0);
    expect(none.ledger.violations).toBe(0);
  });

it("TER-006 what is anchored to the rock comes loose when a crater cuts the rock at its foot, with what is welded to it, and the physics takes it from there", () => {
    const plate = (id: string, x: number, extra: Record<string, unknown> = {}): BodyInput =>
      ({ id, fixed: true, shape: { kind: "box", width: 6, height: 0.3 }, mass: 1, position: { x, y: 0.15 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, friction: 0.9, anchored: { mass: 80 }, ...extra }) as never;
    const block = (id: string, x: number): BodyInput => ({ id, shape: { kind: "box", width: 1, height: 1 }, mass: 2, position: { x, y: 0.8 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.5 }) as never;
    const w = createWorld(
      1,
      [plate("near", 0), block("on-near", 0), plate("far", 40), block("on-far", 40)],
      { x: 0, y: -4 },
      {
        terrain: { outline: FLAT, craters: {} },
        joints: [
          { id: "w-near", a: "near", b: "on-near", anchorA: { x: 0, y: 0.15 }, anchorB: { x: 0, y: -0.5 } },
          { id: "w-far", a: "far", b: "on-far", anchorA: { x: 0, y: 0.15 }, anchorB: { x: 0, y: -0.5 } },
        ],
      },
      sandbox,
    );
    run(w, 0.5);
    expect(at(w, "near").fixed).toBe(true);
    // A charge goes off on the ground under the near plate, right of its middle: a 2.4 m crater that
    // leaves rock under its left end only.
    run(w, 3, [{ type: "body.add", body: ball("charge", 1, 0.35, { explosive: { charge: 0.2, fragments: 0, radius: 4, armed: true, trigger: true } }) } as never]);
    expect(w.terrain!.holes).toHaveLength(1);
    expect(w.events.filter((e) => e.type === "terrain.loose").map((e) => e.data.id)).toEqual(["near"]);
    // The near plate is a free body of its declared mass now. (Whether its block is still welded on
    // is the blast's business; Mammoth Thrust's turret test checks that welds survive coming loose.)
    expect(at(w, "near")).toMatchObject({ fixed: false, mass: 80 });
    expect(at(w, "near").anchored).toBeUndefined();
    // It has gone into the hole at that end: lower than it was, and tipped.
    expect(at(w, "near").position.y).toBeLessThan(0.1);
    expect(Math.abs(at(w, "near").angle)).toBeGreaterThan(0.1);
    // The far plate's rock wasn't touched: it is as fixed as ever.
    expect(at(w, "far")).toMatchObject({ fixed: true, position: { x: 40, y: 0.15 } });
    expect(at(w, "on-far").position.y).toBeCloseTo(0.8, 2);
    expect(w.ledger.violations).toBe(0); // the mass that came loose is on the books
  });

  it("TER-006 anchored bodies of one group come loose together, welded to each other", () => {
    const part = (id: string, x: number, y: number, wd: number, ht: number): BodyInput =>
      ({ id, fixed: true, shape: { kind: "box", width: wd, height: ht }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, friction: 0.9, anchored: { mass: 10, group: "cup" } }) as never;
    const w = world({}, [part("floor", 0, 0.15, 2.3, 0.3), part("lip-l", -1, 0.475, 0.3, 0.35), part("lip-r", 1, 0.475, 0.3, 0.35), ball("b", 0, 1.3, { shape: { kind: "disc", radius: 1 } })]);
    run(w, 0.5);
    // A crater that reaches only the cup's right end.
    expect(cutCrater(w, P(3, -0.6), 2, TERRAIN_OPS)).toBe(true);
    for (const id of ["floor", "lip-l", "lip-r"]) expect(at(w, id).fixed).toBe(false);
    expect(w.joints.map((j) => j.id).sort()).toEqual(["floor+lip-l", "floor+lip-r"]);
    expect(w.events.filter((e) => e.type === "terrain.loose")).toHaveLength(3);
    // A crater nowhere near anything anchored loosens nothing.
    const still = world({}, [part("floor", 0, 0.15, 2.3, 0.3)]);
    expect(cutCrater(still, P(30, 0), 2, TERRAIN_OPS)).toBe(true);
    expect(at(still, "floor").fixed).toBe(true);
  });

  it("TER-005 no more craters are kept than the limit, and no more small ones than their share", () => {
    const w = world({ limit: 6, small: 3 });
    for (let k = 0; k < 8; k++) cutCrater(w, P(-40 + 3 * k, 0), 0.5, TERRAIN_OPS);
    expect(w.terrain!.holes).toHaveLength(3);
    for (let k = 0; k < 8; k++) cutCrater(w, P(10 + 6 * k, 0), 2, TERRAIN_OPS);
    expect(w.terrain!.holes).toHaveLength(6);
  });

  it("DET-001 the same craters in the same order give the same ground", () => {
    const dig = () => {
      const w = world({}, [ball("b", 1, 4)]);
      const rng = createRng(3);
      for (let k = 0; k < 25; k++) cutCrater(w, P(-10 + 20 * nextFloat(rng), -3 * nextFloat(rng)), 0.5 + 2 * nextFloat(rng), TERRAIN_OPS);
      run(w, 2);
      return hashValue(w);
    };
    expect(dig()).toBe(dig());
  });

  it("SCN-002 a malformed terrain is refused", () => {
    const scn = (terrain: unknown) => ({ schema: 1, name: "t", title: "t", description: "", profile: "sandbox", seed: 1, world: { bodies: [], terrain }, timeline: [], end: { steps: 1 }, probes: [], assertions: [] });
    expect(() => parseScenario(scn({ outline: FLAT, craters: {} }))).not.toThrow();
    const anchored = (a: unknown, fixed = true) => ({ ...scn({ outline: FLAT }), world: { terrain: { outline: FLAT }, bodies: [{ id: "a", fixed, shape: { kind: "box", width: 1, height: 1 }, mass: 1, position: P(0, 0), velocity: P(0, 0), angle: 0, angularVelocity: 0, anchored: a }] } });
    expect(() => parseScenario(anchored({ mass: 5, group: "g" }))).not.toThrow();
    for (const bad of [anchored(3), anchored({ mass: 0 }), anchored({ mass: 5, group: 3 }), anchored({ mass: 5 }, false)]) expect(() => parseScenario(bad)).toThrow(ScenarioError);
    for (const bad of [3, { outline: [P(0, 0)] }, { outline: FLAT, prefix: 3 }, { outline: FLAT, craters: 3 }, { outline: FLAT, craters: { blast: 0 } }, { outline: FLAT, craters: { limit: -1 } }]) expect(() => parseScenario(scn(bad))).toThrow(ScenarioError);
  });
});
