// Damage (DMG-001…DMG-003, DMG-005): integrity, the damage rule, failure, armour (RS-11).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyOf, assemblyTotals, BREACH_WIDTH, createWorld, getProfile, injectorStatus, initialWorld, LEAK_PARCEL, LEAK_RATE, leakRate, MATERIALS, parseScenario, runScenario, stepInPlace, type Material, type World, parcelsOf } from "../../src/core/index.ts";
import { box, disc, readJson, ROOT } from "../helpers.ts";

const test = getProfile("test");
const run = (w: World, n: number) => {
  for (let i = 0; i < n; i++) stepInPlace(w, [], test);
};
const soft: Material = { threshold: 2.5, toughness: 20 };

/** Two 1 kg discs meeting head on at 5 m/s each, with no bounce: 25 J of kinetic energy becomes heat. */
function headOn(ma?: Material, mb?: Material): World {
  return createWorld(1, [
    disc("a", { position: { x: -1, y: 0 }, velocity: { x: 5, y: 0 }, restitution: 0, material: ma }),
    disc("b", { position: { x: 1, y: 0 }, velocity: { x: -5, y: 0 }, restitution: 0, material: mb }),
  ]);
}

const body = (w: World, id: string) => w.bodies.find((b) => b.id === id)!;

describe("damage", () => {
  it("DMG-001 every body, joint and link starts whole, and a scenario may set integrity between 0 and 1", () => {
    const w = createWorld(1, [box("a", 1, 1, { contents: [{ resource: "o2", mass: 1, capacity: 1 }] }), box("b", 1, 1, { position: { x: 1, y: 0 }, contents: [{ resource: "o2", mass: 0, capacity: 1 }] })], { x: 0, y: 0 }, {
      joints: [{ id: "j", a: "a", b: "b", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.5, y: 0 } }],
      links: [{ id: "f", kind: "feed", from: "a", to: "b", resource: "o2", rate: 1 }],
    });
    expect(w.bodies.map((b) => b.integrity)).toEqual([1, 1]);
    expect(w.joints[0].integrity).toBe(1);
    expect(w.links[0].integrity).toBe(1);
    const raw = readJson(join(ROOT, "scenarios", "rs11-armour-ram.json")) as { world: { bodies: Record<string, unknown>[] } };
    raw.world.bodies[0].integrity = 1.5;
    raw.world.bodies[1].material = { threshold: -1, toughness: 0 };
    let paths: string[] = [];
    try {
      parseScenario(raw);
    } catch (e) {
      paths = (e as { errors: { path: string }[] }).errors.map((x) => x.path);
    }
    expect(paths.sort()).toEqual(["$.world.bodies[0].integrity", "$.world.bodies[1].material.threshold", "$.world.bodies[1].material.toughness"]);
  });

  it("DMG-002 each body takes half the energy its contact lost; above its threshold it loses (share − threshold) ÷ toughness", () => {
    const w = headOn(soft, soft);
    let heat = 0;
    for (let i = 0; i < 120 && !w.events.some((e) => e.type === "damage"); i++) {
      stepInPlace(w, [], test);
      heat = w.contacts.reduce((s, c) => s + c.energyLost, 0);
    }
    expect(heat).toBeCloseTo(25, 6); // ½ · (½ kg) · (10 m/s)²
    const expected = 1 - (heat / 2 - soft.threshold) / soft.toughness; // 1 − (12.5 − 2.5)/20 = 0.5
    expect(body(w, "a").integrity).toBeCloseTo(expected, 12);
    expect(body(w, "b").integrity).toBeCloseTo(expected, 12);
    expect(expected).toBeCloseTo(0.5, 6);
    const e = w.events.find((x) => x.type === "damage")!;
    expect(e.data).toMatchObject({ id: "a" });
    expect(Number(e.data.energy)).toBeCloseTo(12.5, 6);
  });

  it("DMG-002 a hit below the threshold does nothing, and a body with no material can't be damaged", () => {
    const below = headOn({ threshold: 13, toughness: 20 }, undefined);
    run(below, 120);
    expect(below.bodies.map((b) => b.integrity)).toEqual([1, 1]);
    expect(below.events.some((e) => e.type === "damage")).toBe(false);
  });

  it("DMG-002 damage only reads the world: motion and the ledger are the same with or without materials", () => {
    const plain = headOn();
    const hurt = headOn(soft, soft);
    run(plain, 120);
    run(hurt, 120);
    expect(hurt.bodies.map((b) => [b.position, b.velocity])).toEqual(plain.bodies.map((b) => [b.position, b.velocity]));
    expect(hurt.ledger.totals).toEqual(plain.ledger.totals);
    expect(hurt.ledger.violations).toBe(0);
  });

  it("DMG-003 DMG-007 at 0 a body is destroyed: its welds and links break and it leaves the world in a burst of dust", () => {
    const w = createWorld(
      1,
      [
        disc("ram", { mass: 20, position: { x: -2, y: 0 }, velocity: { x: 25, y: 0 }, restitution: 0 }),
        {
          ...disc("engine", { material: MATERIALS.tank }),
          contents: [{ resource: "o2", mass: 1, capacity: 1 }],
          injector: { channel: "main", mixture: { o2: 1 }, igniter: false },
        },
        box("hull", 1, 1, { position: { x: 1, y: 0 } }),
      ],
      { x: 0, y: 0 },
      { joints: [{ id: "j", a: "engine", b: "hull", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.5, y: 0 } }], links: [{ id: "c", kind: "control", channel: "main", to: "engine" }] },
    );
    expect(injectorStatus(w, body(w, "engine")).firing).toBe(false); // idle until commanded
    for (let i = 0; i < 120 && w.bodies.some((b) => b.id === "engine"); i++) stepInPlace(w, [], test);
    expect(w.bodies.some((b) => b.id === "engine")).toBe(false);
    const tick = w.events.find((e) => e.type === "destroyed")!.tick;
    expect(w.events.filter((e) => e.tick === tick).map((e) => e.type)).toEqual(expect.arrayContaining(["damage", "destroyed", "joint.break", "link.break", "destroyed.removed"]));
    expect(w.events.find((e) => e.type === "joint.break")!.data.quantity).toBe("damage");
    expect(w.joints).toHaveLength(0);
    expect(w.links).toHaveLength(0);
    expect(w.dust!.length).toBeGreaterThan(0);
    expect(parcelsOf(w.gas)).toHaveLength(0);
    expect(w.ledger.violations).toBe(0);
  });


  it("DMG-003 a weld near the hit is damaged too, and a damaged weld breaks at its limits × its integrity", () => {
    // A weld at half integrity holding 1 kg against a 1.2 N·s pull: 0.6 N·s is too much for half of 200 N over one step.
    const pull = (integrity: number) => {
      const w = createWorld(1, [box("a", 1, 1, { position: { x: -0.5, y: 0 } }), box("b", 1, 1, { position: { x: 0.5, y: 0 } })], { x: 0, y: 0 }, {
        joints: [{ id: "j", a: "a", b: "b", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.5, y: 0 }, limits: { tension: 200 }, integrity }],
      });
      stepInPlace(w, [{ type: "body.impulse", id: "b", impulse: { x: 0.6, y: 0 }, point: { x: 0.5, y: 0 } }], test);
      return w.joints.length;
    };
    expect(pull(1)).toBe(1); // needs 0.3 N·s = 72 N for a step: under 200 N
    expect(pull(0.3)).toBe(0); // under 60 N: breaks
    // The weld on the struck face loses as much as the body; one on the far side loses nothing.
    const w = createWorld(
      1,
      [disc("ram", { mass: 20, position: { x: -2, y: 0 }, velocity: { x: 3, y: 0 }, restitution: 0 }), box("plate", 1, 1, { material: { threshold: 0, toughness: 1000 } }), box("near", 0.2, 0.2, { position: { x: -0.4, y: 0.6 } }), box("far", 0.2, 0.2, { position: { x: 0.6, y: 0 } })],
      { x: 0, y: 0 },
      {
        joints: [
          { id: "jn", a: "plate", b: "near", anchorA: { x: -0.4, y: 0.5 }, anchorB: { x: 0, y: -0.1 }, limits: { tension: 1e6, compression: 1e6, shear: 1e6, torque: 1e6 } },
          { id: "jf", a: "plate", b: "far", anchorA: { x: 0.5, y: 0 }, anchorB: { x: -0.1, y: 0 }, limits: { tension: 1e6, compression: 1e6, shear: 1e6, torque: 1e6 } },
        ],
      },
    );
    run(w, 120);
    const lost = 1 - body(w, "plate").integrity;
    expect(lost).toBeGreaterThan(0);
    const j = (id: string) => w.joints.find((x) => x.id === id)!;
    expect(1 - j("jn").integrity).toBeGreaterThan(0);
    expect(1 - j("jn").integrity).toBeLessThan(lost);
    expect(j("jf").integrity).toBe(1); // a body radius (0.71 m) or more from the hit
  });

  it("DMG-005 RS-11: the ram destroys the bare tank; armour takes the hit and the tank behind it is untouched", () => {
    const scn = parseScenario(readJson(join(ROOT, "scenarios", "rs11-armour-ram.json")));
    const r = runScenario(scn);
    expect(r.assertions.filter((a) => !a.pass)).toEqual([]);
    const w = initialWorld(scn);
    run(w, 240);
    expect(w.bodies.some((b) => b.id === "tank-a")).toBe(false); // destroyed, gone in a burst of dust
    expect(body(w, "tank-b").integrity).toBe(1);
    expect(body(w, "armour").integrity).toBeLessThan(1);
    expect(w.events.filter((e) => e.type === "damage").map((e) => e.data.id)).not.toContain("tank-b");
    // Slower, the bare tank survives, damaged, and the armour isn't marked at all.
    const slow = parseScenario(readJson(join(ROOT, "scenarios", "rs11-armour-ram.json")), { v: 4 });
    const s = initialWorld(slow);
    run(s, 480);
    expect(body(s, "tank-a").integrity).toBeGreaterThan(0);
    expect(body(s, "tank-a").integrity).toBeLessThan(1);
    expect(body(s, "armour").integrity).toBe(1);
  });

  describe("leaks (DMG-004)", () => {
    /** A free 2 kg box holding oxygen, damaged by hand (no hit): it leaks from the top of its outline. */
    const tank = (integrity: number, o2: number, extra: { resource: string; mass: number; capacity: number }[] = []) =>
      createWorld(1, [box("t", 1, 1, { mass: 2, integrity, contents: [{ resource: "o2", mass: o2, capacity: 4 }, ...extra] })]);
    const leaked = (w: World, steps: number) => {
      const m0 = w.bodies[0].contents![0].mass;
      run(w, steps);
      return m0 - w.bodies[0].contents![0].mass;
    };

    it("DMG-004 a damaged store leaks at LEAK_RATE × (1 − integrity) × how full it is: breach size and pressure", () => {
      expect(leakRate(tank(0.5, 4).bodies[0])).toBeCloseTo(LEAK_RATE * 0.5, 12);
      expect(leakRate(tank(0.5, 2).bodies[0])).toBeCloseTo(LEAK_RATE * 0.25, 12); // half the pressure
      expect(leakRate(tank(0.75, 4).bodies[0])).toBeCloseTo(LEAK_RATE * 0.25, 12); // half the breach
      // Over 0.5 s the store drains as dm/dt = −rate: exponentially, within one parcel.
      for (const [integrity, o2] of [[0.5, 4], [0.75, 4], [0.5, 2]]) {
        const w = tank(integrity, o2);
        const k = (LEAK_RATE * (1 - integrity)) / 4;
        expect(Math.abs(leaked(w, 120) - o2 * (1 - Math.exp(-k * 0.5)))).toBeLessThan(LEAK_PARCEL * 1.01);
        expect(w.ledger.violations).toBe(0);
      }
      expect(tank(0.5, 4).events.some((e) => e.type === "leak")).toBe(false);
      const w = tank(0.5, 4);
      run(w, 1);
      expect(w.events.filter((e) => e.type === "leak").map((e) => e.data.id)).toEqual(["t"]);
    });

    it("DMG-004 a whole store, or a store of something that isn't a gas, doesn't leak", () => {
      expect(leaked(tank(1, 4), 60)).toBe(0);
      const w = tank(0.5, 0, [{ resource: "fuel", mass: 1, capacity: 1 }]);
      run(w, 60);
      expect(w.bodies[0].contents![1].mass).toBe(1);
      expect(parcelsOf(w.gas)).toHaveLength(0);
    });

    it("DMG-004 the leak is a jet: it pushes the body the other way, conserving momentum, and spreads across the breach", () => {
      const w = tank(0.2, 4);
      run(w, 120);
      const gasP = parcelsOf(w.gas).reduce((s, p) => s + p.mass * p.velocity.y, 0);
      expect(w.gas.count).toBeGreaterThan(50);
      expect(gasP).toBeGreaterThan(0); // up, out of the top
      expect(w.bodies[0].velocity.y * 2 + w.bodies[0].contents![0].mass * w.bodies[0].velocity.y + gasP).toBeCloseTo(0, 9);
      const xs = parcelsOf(w.gas).map((p) => p.position.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.5 * BREACH_WIDTH * 0.8 * 0.5);
      expect(w.ledger.violations).toBe(0);
    });

    it("DMG-004 a hit opens the breach where it struck; a breach pressed against a body stays shut", () => {
      // Slow enough that the bare tank is damaged, not destroyed.
      const scn = parseScenario(readJson(join(ROOT, "scenarios", "rs11-armour-ram.json")), { v: 8 });
      const w = initialWorld(scn);
      run(w, 480);
      const a = body(w, "tank-a");
      expect(a.breach!.normal.x).toBeLessThan(-0.9); // the rams came from the left
      expect(a.contents![0].mass).toBeLessThan(6);
      expect(w.gas.count).toBeGreaterThan(0);
      // Gas expanding into vacuum spreads every way, but on the whole it went out of the struck side, backwards.
    const mean = parcelsOf(w.gas).reduce((t, p) => t + p.velocity.x, 0) / w.gas.count;
    expect(mean).toBeLessThan(a.velocity.x);
      // A damaged tank resting on its breach, on a floor: nothing comes out.
      const shut = createWorld(1, [box("t", 1, 1, { mass: 2, integrity: 0.5, angle: Math.PI, position: { x: 0, y: 0.5 }, contents: [{ resource: "o2", mass: 4, capacity: 4 }] }), box("floor", 4, 0.2, { fixed: true, position: { x: 0, y: -0.1 } })]);
      run(shut, 60);
      expect(parcelsOf(shut.gas)).toHaveLength(0);
    });
  });

  it("DMG-006 a wrecked nozzle wall breaks away, so the exhaust meets a different shape: RS-08 loses thrust and turns", () => {
    const fly = (wreck: boolean) => {
      const raw = readJson(join(ROOT, "scenarios", "rs08-chemical-rocket.json")) as { world: { bodies: { id: string; integrity?: number }[] } };
      if (wreck) raw.world.bodies.find((b) => b.id === "nozzle-left")!.integrity = 0;
      const scn = parseScenario(raw);
      const w = initialWorld(scn);
      const sandbox = getProfile("sandbox");
      for (let i = 0; i < 480; i++) stepInPlace(w, i === 0 ? scn.timeline[0].commands : [], sandbox);
      expect(w.ledger.violations).toBe(0);
      return w;
    };
    const intact = fly(false);
    const broken = fly(true);
    expect(assemblyOf(intact, "hull")).toContain("nozzle-left");
    expect(assemblyOf(broken, "hull")).not.toContain("nozzle-left");
    expect(broken.events.find((e) => e.type === "joint.break")!.data).toMatchObject({ b: "nozzle-left", quantity: "damage" });
    const [a, b] = [assemblyTotals(intact, "hull")!, assemblyTotals(broken, "hull")!];
    expect(b.velocity.y).toBeLessThan(0.9 * a.velocity.y); // less thrust along the axis
    expect(Math.abs(b.angularVelocity)).toBeGreaterThan(3 * Math.abs(a.angularVelocity)); // and a turn
  }, 300_000);
});
