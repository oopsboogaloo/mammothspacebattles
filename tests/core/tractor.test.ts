// Tractor beam and tether (TRC-001…TRC-007).
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
/** Distance from the ship's centre of mass to a body's (each is one body here): what the tether holds. */
const reach = (w: World, id: string) => Math.hypot(at(w, id).position.x - at(w, "ship").position.x, at(w, id).position.y - at(w, "ship").position.y);
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

  it("TRC-004 the tether holds the cargo at 15 m from the ship's centre of mass as it swings round, never spinning the ship, and the ledger stays exact", () => {
    const w = world([ball("ball", 1, 50, 0, -18)]);
    engage(w);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    run(w, 960); // settle
    // Throw the ball sideways: it swings round on the tether.
    stepInPlace(w, [{ type: "body.impulse", id: "ball", impulse: { x: 400, y: 0 }, point: at(w, "ball").position }], sandbox);
    let lo = Infinity;
    let hi = 0;
    let spin = 0;
    for (let i = 0; i < 2400; i++) {
      stepInPlace(w, [], sandbox);
      lo = Math.min(lo, reach(w, "ball"));
      hi = Math.max(hi, reach(w, "ball"));
      spin = Math.max(spin, Math.abs(at(w, "ship").angularVelocity));
    }
    // Between the centres of mass, it pulls along the line through the ship's: it never spins it.
    expect(spin).toBeLessThan(1e-9);
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
    const w = world([ball("ball", 1, 50, 0, -16)], { tether: { maxTension: 2000 } }); // reaches 15 m slowly enough not to snap it
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

  it("TRC-007 a tractor with its own tether generator makes no tether without it, and lets go when it is lost", () => {
    // The generator welded to the ship's side.
    const withGen = (welded: boolean): World =>
      createWorld(1, [ship({ tetherFrom: "gen" }), box("gen", 1, 1, { mass: 5, position: { x: welded ? 2 : 30, y: 0 } }), ball("ball", 1, 40, 0, -18)], { x: 0, y: 0 }, {
        links: [{ id: "c", kind: "control", channel: "tractor", to: "ship" }],
        joints: welded ? [{ id: "j", a: "ship", b: "gen", anchorA: { x: 1.5, y: 0 }, anchorB: { x: -0.5, y: 0 } }] : [],
      });
    const w = withGen(true);
    engage(w);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    run(w, 60);
    at(w, "gen").integrity = 0; // wrecked: it leaves the world
    run(w, 2);
    expect(w.bodies.some((b) => b.id === "gen")).toBe(false);
    expect(at(w, "ship").tractor!.mode).toBe("off");
    expect(w.events.some((e) => e.type === "tether.release")).toBe(true);
    expect(w.ledger.violations).toBe(0);

    // A generator not on the ship: the beam pulls the ball right in, but no tether is made.
    const loose = withGen(false);
    let near = Infinity;
    run(loose, 1500, () => {
      near = Math.min(near, reach(loose, "ball"));
      return set(1);
    });
    expect(near).toBeLessThan(10);
    expect(loose.events.some((e) => e.type === "tether.engage")).toBe(false);
    expect(at(loose, "ship").tractor!.targets).toContain("ball");

    // It must name a body in the world.
    const raw = { schema: 1, name: "t", seed: 1, world: { bodies: [{ ...ship({ tetherFrom: "nope" }) }] }, end: { steps: 1 } };
    expect(() => parseScenario(raw)).toThrow(/tetherFrom/);
    expect(() => parseScenario(raw)).toThrow(ScenarioError);
  });

  it("TRC-010 a tether that pays out starts at the distance its cargo was taken at and lengthens to its length, so the two aren't thrown apart", () => {
    // Taken at 9 m on a 15 m tether. At its full length at once, the spring pushes the two apart hard.
    const at9 = () => [ball("ball", 1, 50, 0, -9)];
    const hard = world(at9());
    engage(hard);
    run(hard, 24);
    const thrown = Math.abs(at(hard, "ball").velocity.y - at(hard, "ship").velocity.y);
    const soft = world(at9(), { tether: { payOut: 4 } });
    engage(soft);
    expect(at(soft, "ship").tractor!.paid).toBeCloseTo(9, 1);
    run(soft, 24);
    const eased = Math.abs(at(soft, "ball").velocity.y - at(soft, "ship").velocity.y);
    expect(thrown).toBeGreaterThan(8);
    expect(eased).toBeLessThan(4.5); // no faster than it pays out
    run(soft, 600);
    expect(at(soft, "ship").tractor!.paid).toBeUndefined(); // paid out: its full length from now on
    expect(reach(soft, "ball")).toBeGreaterThan(14);
    expect(reach(soft, "ball")).toBeLessThan(16);
    expect(soft.ledger.violations).toBe(0);
    // Letting go forgets how far it had paid out.
    const again = world(at9(), { tether: { payOut: 4 } });
    engage(again);
    run(again, 1, () => set(1));
    expect(at(again, "ship").tractor).toMatchObject({ mode: "off" });
    expect(at(again, "ship").tractor!.paid).toBeUndefined();
    expect(() => parseScenario({ ...(readJson(join(ROOT, "scenarios", "tractor.json")) as object), world: { bodies: [ship({ tether: { payOut: 0 } })] } })).toThrow(ScenarioError);
  });

  it("TRC-010 a tether with a reach takes cargo from further off than its length and reels it in, without snatching it", () => {
    const w = world([ball("ball", 1, 20, 0, -24)], { tether: { reach: 25, payOut: 5, damping: 1.5 } });
    engage(w, 5);
    expect(at(w, "ship").tractor).toMatchObject({ mode: "tether", cargo: "ball" });
    expect(at(w, "ship").tractor!.paid).toBeGreaterThan(23);
    let worst = 0;
    run(w, 720, () => {
      worst = Math.max(worst, Math.abs(at(w, "ship").tractor!.tension));
      return [];
    });
    expect(at(w, "ship").tractor!.paid).toBeUndefined();
    expect(reach(w, "ball")).toBeGreaterThan(14);
    expect(reach(w, "ball")).toBeLessThan(16);
    expect(worst).toBeLessThan(300); // a 9 m stretch on the bare spring would be 18,000 N
    expect(w.ledger.violations).toBe(0);
    // Past its reach, the beam only pulls.
    const far = world([ball("ball", 1, 20, 0, -30)], { tether: { reach: 25, payOut: 5 } });
    run(far, 2, () => set(1));
    expect(at(far, "ship").tractor!.mode).toBe("beam");
  });

  it("TRC-011 a tractor that names its cargo pulls and takes nothing else", () => {
    const w = world([ball("junk", 0.5, 5, 0, -6), ball("prize", 0.5, 5, 1, -12)], { only: ["prize"] });
    run(w, 2, () => set(1));
    expect(at(w, "junk").velocity).toEqual({ x: 0, y: 0 });
    expect(at(w, "ship").tractor).toMatchObject({ mode: "tether", cargo: "prize" });
    expect(() => parseScenario({ ...(readJson(join(ROOT, "scenarios", "tractor.json")) as object), world: { bodies: [ship({ only: "prize" })] } })).toThrow(ScenarioError);
  });

  it("TRC-013 with pullAny the beam pulls everything free in its wedge, and the tether still takes only what is named", () => {
    const w = world([ball("junk", 0.5, 5, 0, -6), ball("prize", 0.5, 5, 0.5, -30)], { only: ["prize"], pullAny: true, tether: { length: 12, reach: 12 } });
    run(w, 24, () => set(1));
    // The junk, nearer, is pulled, but never taken; the prize, beyond the tether's reach, is pulled too.
    expect(at(w, "junk").velocity.y).toBeGreaterThan(0);
    expect(at(w, "prize").velocity.y).toBeGreaterThan(0);
    expect(at(w, "ship").tractor!.mode).toBe("beam");
    // Pulled within reach, the prize is taken.
    run(w, 2400, () => set(1));
    expect(at(w, "ship").tractor).toMatchObject({ mode: "tether", cargo: "prize" });
    expect(() => parseScenario({ ...(readJson(join(ROOT, "scenarios", "tractor.json")) as object), world: { bodies: [ship({ pullAny: "yes" })] } })).toThrow(ScenarioError);
  });

  it("TRC-014 a beam with a top speed draws nothing in faster than it: the pull fades to nothing at that closing speed, and momentum is kept", () => {
    const pull = (maxSpeed?: number) => {
      const w = world([ball("rock", 0.5, 20, 0, -45)], { range: 50, ...(maxSpeed !== undefined ? { maxSpeed } : {}), tether: { length: 1, reach: 1 } });
      let fastest = 0;
      for (let i = 0; i < 240 * 6; i++) {
        stepInPlace(w, i === 0 ? set(1) : [], sandbox);
        fastest = Math.max(fastest, at(w, "rock").velocity.y - at(w, "ship").velocity.y);
      }
      return { fastest, w };
    };
    const limited = pull(3);
    expect(limited.fastest).toBeGreaterThan(2.9);
    expect(limited.fastest).toBeLessThan(3.1);
    expect(limited.w.ledger.violations).toBe(0);
    // Without one it comes in much faster.
    expect(pull().fastest).toBeGreaterThan(10);
    expect(() => parseScenario({ ...(readJson(join(ROOT, "scenarios", "tractor.json")) as object), world: { bodies: [ship({ maxSpeed: -1 })] } })).toThrow(ScenarioError);
  });

  it("TRC-012 a tractor that names its beam's generator has no beam, and holds nothing, once that part is off the ship", () => {
    const gen = { ...box("gen", 1, 1, { mass: 2, position: { x: 0, y: 2.5 } }) } as BodyInput;
    const make = () =>
      createWorld(1, [ship({ beamFrom: "gen" }), gen, ball("ball", 1, 20, 0, -10)], { x: 0, y: 0 }, { links: [{ id: "c", kind: "control", channel: "tractor", to: "ship" }], joints: [{ id: "w", a: "ship", b: "gen", anchorA: { x: 0, y: 2 }, anchorB: { x: 0, y: -0.5 } }] });
    const w = make();
    engage(w, 5);
    expect(at(w, "ship").tractor!.mode).toBe("tether");
    w.joints = [];
    run(w, 2);
    expect(at(w, "ship").tractor!.mode).toBe("off");
    expect(w.events.some((e) => e.type === "tether.release")).toBe(true);
    const none = make();
    none.joints = [];
    run(none, 3, () => set(1));
    expect(none.events.some((e) => e.type === "tractor.on")).toBe(false);
  });
  it("TRC-008 a siphon draws a marked body's propellant through the beam into the ship's tanks at its rate, without pulling it, until the beam is off, the source is empty or the tanks are full", () => {
    const store = (mass: number, capacity: number) => [{ resource: "h2", mass, capacity }];
    const make = (room: number) => {
      const w = world([{ ...ball("tank", 0.5, 5, 0, -20), siphon: true, contents: store(3, 3) } as never, { ...ball("plain", 0.5, 5, 2, -12), contents: store(3, 3) } as never], { only: [], siphon: { rate: 1, into: ["ship"] } });
      at(w, "ship").contents = store(0, room);
      w.ledger.totals = computeTotals(w);
      return w;
    };
    const held = (w: World, id: string) => at(w, id).contents![0]!.mass;
    const w = make(5);
    const mass = computeTotals(w).mass;
    run(w, 480, (i) => (i === 0 ? set(1) : []));
    // 1 kg/s for 2 s, from the marked body only, which the beam doesn't move.
    expect(held(w, "ship")).toBeCloseTo(2, 2);
    expect(held(w, "tank")).toBeCloseTo(1, 2);
    expect(held(w, "plain")).toBe(3);
    expect(at(w, "tank").velocity).toEqual({ x: 0, y: 0 });
    expect(at(w, "ship").tractor!.siphoning).toBe("tank");
    expect(computeTotals(w).mass).toBeCloseTo(mass, 9);
    expect(w.events.filter((e) => e.type === "siphon.on")).toHaveLength(1);
    // The beam off: nothing more moves, and no feed is left behind.
    run(w, 240, (i) => (i === 0 ? set(0) : []));
    expect(held(w, "tank")).toBeCloseTo(1, 2);
    expect(at(w, "ship").tractor!.siphoning).toBeUndefined();
    expect(w.links.some((l) => l.id.startsWith("siphon:"))).toBe(false);
    expect(w.events.filter((e) => e.type === "siphon.off")).toHaveLength(1);
    // On again, to the end: the source empty.
    run(w, 480, (i) => (i === 0 ? set(1) : []));
    expect(held(w, "tank")).toBeCloseTo(0, 6);
    expect(held(w, "ship")).toBeCloseTo(3, 6);
    expect(at(w, "ship").tractor!.siphoning).toBeUndefined();
    // Tanks with room for 2 kg take 2 kg.
    const small = make(2);
    run(small, 960, (i) => (i === 0 ? set(1) : []));
    expect(held(small, "ship")).toBeCloseTo(2, 6);
    expect(held(small, "tank")).toBeCloseTo(1, 6);
    // Out of the wedge, nothing is drawn.
    const off = make(5);
    at(off, "tank").position = { x: 30, y: -20 };
    run(off, 240, (i) => (i === 0 ? set(1) : []));
    expect(held(off, "tank")).toBe(3);
    expect(() => parseScenario({ ...(readJson(join(ROOT, "scenarios", "tractor.json")) as object), world: { bodies: [ship({ siphon: { rate: 0, into: "ship" } })] } })).toThrow(ScenarioError);
  });
});
