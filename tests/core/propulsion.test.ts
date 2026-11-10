import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCommands,
  assemblyTotals,
  burn,
  computeTotals,
  createWorld,
  gasTotals,
  getProfile,
  igniteAndBurn,
  initialWorld,
  injectorStatus,
  invRotate,
  mixture,
  parseScenario,
  runScenario,
  sinCos,
  soundSpeed,
  stepInPlace,
  temperatureOf,
  timelineByStep,
  type Parcel,
  type World, parcelsOf, setParcels, addParcel,
} from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
type Raw = { world: { bodies: { id: string; shape: unknown; position: { x: number; y: number }; angle: number; injector?: Record<string, unknown>; contents?: { resource: string; mass: number; capacity: number }[] }[]; joints: { id: string }[]; links: { id: string }[] }; timeline: unknown[]; end: { steps: number } };
const rs08 = (): Raw => structuredClone(readJson(join(ROOT, "scenarios", "rs08-chemical-rocket.json"))) as Raw;

function runShip(raw: Raw, steps: number, each?: (w: World, s: number) => void): World {
  const scn = parseScenario(raw);
  const w = initialWorld(scn);
  const tl = timelineByStep(scn);
  for (let s = 0; s < steps; s++) {
    stepInPlace(w, tl.get(s) ?? [], getProfile(scn.profile));
    each?.(w, s);
  }
  return w;
}

const parcel = (over: Partial<Parcel> = {}): Parcel => ({
  id: 1,
  mass: 0.01,
  composition: { h2: 1 / 9, o2: 8 / 9 },
  position: { x: 0, y: 0 },
  velocity: { x: 3, y: -1 },
  thermal: 0.01 * mixture({ h2: 1 / 9, o2: 8 / 9 }).cv * 300,
  radius: 0.05,
  ...over,
});

describe("propellant and reactions", () => {
  it("PRP-003 a burn makes products, keeps mass and momentum, and turns exactly the declared heat into thermal energy", () => {
    const p = parcel();
    const before = structuredClone(p);
    const q = burn(p);
    expect(p.mass).toBe(before.mass);
    expect(p.velocity).toEqual(before.velocity);
    expect(p.composition).toEqual({ h2o: 1 });
    // Declared heat: 3.4e7 J per kg of H₂, and the parcel holds 1/9 of its mass as H₂.
    expect(q).toBeCloseTo((0.01 / 9) * 3.4e7, 6);
    expect(p.thermal - before.thermal).toBeCloseTo(q, 9);
    expect(temperatureOf(p)).toBeGreaterThan(2500);
  });

  it("PRP-003 a cold mixture does not ignite by itself, but does next to hot gas", () => {
    const w = createWorld(1);
    setParcels(w.gas, [parcel(), parcel({ id: 2, position: { x: 5, y: 0 } })]);
    expect(igniteAndBurn(w.gas)).toBe(0);
    const hot = parcel({ id: 3, composition: { h2o: 1 }, position: { x: 0.1, y: 0 }, thermal: 0.01 * mixture({ h2o: 1 }).cv * 2000 });
    addParcel(w.gas, hot);
    expect(igniteAndBurn(w.gas)).toBe(1); // only the one within a smoothing length of the hot parcel
    expect(parcelsOf(w.gas)[0].composition).toEqual({ h2o: 1 });
    expect(parcelsOf(w.gas)[1].composition.h2).toBeGreaterThan(0);
  });

  it("PRP-001 propellant in a tank counts toward the assembly's mass and carries its energy in the ledger", () => {
    const raw = rs08();
    const w0 = initialWorld(parseScenario(raw));
    const t0 = computeTotals(w0);
    // 0.2 kg of H₂ holds 0.2 × 3.4e7 J of chemical energy (÷ the sandbox gas scale of 100).
    expect(t0.energy.chemical).toBeCloseTo((0.2 * 3.4e7) / 100, 3);
    const m0 = assemblyTotals(w0, "hull")!.mass;
    const w = runShip(raw, 240);
    const burned = 1.8 - (w.bodies.find((b) => b.id === "tank")!.contents![0].mass + w.bodies.find((b) => b.id === "tank")!.contents![1].mass);
    const inEngine = w.bodies.find((b) => b.id === "engine")!.contents!.reduce((a, c) => a + c.mass, 0);
    expect(burned).toBeGreaterThan(0.4);
    // The assembly lost exactly the propellant that left the tank and the engine's own stores.
    expect(assemblyTotals(w, "hull")!.mass).toBeCloseTo(m0 - burned + inEngine, 9);
    expect(w.ledger.violations).toBe(0);
  });

  it("DEC-13 the sandbox's heavy gas has the same temperature but a sound speed 10× lower", () => {
    const fill = { min: { x: 0, y: 0 }, max: { x: 1, y: 1 }, count: 4, mass: 0.1, temperature: 500 };
    const real = createWorld(1, [], { x: 0, y: 0 }, { gas: [fill] }, getProfile("test"));
    const heavy = createWorld(1, [], { x: 0, y: 0 }, { gas: [fill] }, sandbox);
    expect(gasTotals(heavy.gas).temperature).toBeCloseTo(500, 9);
    expect(soundSpeed(parcelsOf(real.gas)[0]) / soundSpeed(parcelsOf(heavy.gas)[0])).toBeCloseTo(10, 9);
  });
});

describe("injectors", () => {
  it("PRP-002 the injector's flow follows its command, and is limited by its feed links and the supply", () => {
    const emitted = (command: number, feedRate?: number, tankH2?: number) => {
      const raw = rs08();
      raw.timeline = [{ step: 0, commands: [{ type: "control.set", channel: "main", value: command }] }];
      if (feedRate !== undefined) for (const l of raw.world.links as { id: string; rate?: number }[]) if (l.id === "feed-o2") l.rate = feedRate;
      if (tankH2 !== undefined) {
        const tank = raw.world.bodies.find((b) => b.id === "tank")!;
        tank.contents![0].mass = tankH2;
        tank.contents![0].capacity = tankH2;
      }
      const w = runShip(raw, 240); // 1 s
      const e = w.bodies.find((b) => b.id === "engine")!;
      return e.injector!.count * e.injector!.parcelMass;
    };
    expect(emitted(1)).toBeCloseTo(0.5, 1); // 0.5 kg/s for 1 s
    expect(emitted(0.5)).toBeCloseTo(0.25, 1);
    expect(emitted(0)).toBe(0);
    expect(emitted(1, 0.2)).toBeLessThan(0.3); // the O₂ link carries 0.2 kg/s, and the mixture needs 8/9 of the flow as O₂
    expect(emitted(1, undefined, 0.01)).toBeLessThan(0.1); // runs out of H₂
  });

  it("PRP-009 INS-006 with the feed link broken, no new gas is made once the injector's own store is used, and the status says why", () => {
    const raw = rs08();
    let countAtCut = 0;
    let reasons: string[] = [];
    const w = runShip(raw, 360, (world, s) => {
      const e = world.bodies.find((b) => b.id === "engine")!;
      if (s === 120) {
        applyCommands(world, [{ type: "link.remove", id: "feed-o2" }]);
        countAtCut = e.injector!.count;
      }
      if (s === 359) reasons = [injectorStatus(world, e).reason];
    });
    const e = w.bodies.find((b) => b.id === "engine")!;
    // Only what the engine's own O₂ store held (0.08 kg at most) could still go out.
    expect((e.injector!.count - countAtCut) * e.injector!.parcelMass).toBeLessThan(0.1);
    expect(reasons[0]).toBe("No feed: nothing links o2 to it");
    expect(injectorStatus(initialWorld(parseScenario(rs08())), e).reason).toBe('Idle: main = 0');
    expect(w.ledger.violations).toBe(0);
  });

  it("INS-006 an injector with no control link says so", () => {
    const raw = rs08();
    raw.world.links = raw.world.links.filter((l) => l.id !== "ctl-main");
    const w = initialWorld(parseScenario(raw));
    expect(injectorStatus(w, w.bodies.find((b) => b.id === "engine")!).reason).toBe('No control link for channel "main"');
  });
});

describe("engines", () => {
  it("PRP-004 a sealed chamber with a firing injector produces no net thrust", () => {
    const raw = rs08();
    // Close the throat and drop the nozzle: one plate spans the chamber floor.
    raw.world.bodies = raw.world.bodies.filter((b) => !b.id.startsWith("nozzle") && b.id !== "throat-right");
    const floor = raw.world.bodies.find((b) => b.id === "throat-left")!;
    floor.shape = { kind: "box", width: 1.0, height: 0.1 };
    floor.position = { x: 0, y: -0.45 };
    raw.world.joints = raw.world.joints.filter((j) => !j.id.includes("nozzle") && j.id !== "w-right-throat");
    const j = raw.world.joints.find((x) => x.id === "w-left-throat") as unknown as { anchorB: { x: number; y: number } };
    j.anchorB = { x: -0.45, y: 0.05 };
    let fastest = 0;
    const w = runShip(raw, 120, (world) => {
      const a = assemblyTotals(world, "hull")!;
      const g = gasTotals(world.gas);
      fastest = Math.max(fastest, Math.abs(a.velocity.y));
      expect(Math.abs(a.momentum.y + g.momentum.y)).toBeLessThan(1e-9);
    });
    expect(gasTotals(w.gas).count).toBeGreaterThan(50); // it did fire into the chamber
    // Gas rattling in the closed chamber moves the ship a little, but no net thrust builds up.
    expect(fastest).toBeLessThan(0.05);
    expect(w.ledger.violations).toBe(0);
  });

  it("PRP-005 thrust is along the nozzle axis: a ship turned 90° accelerates along the turned axis", () => {
    const raw = rs08();
    const q = sinCos(Math.PI / 2);
    for (const b of raw.world.bodies) {
      b.position = { x: q.c * b.position.x - q.s * b.position.y, y: q.s * b.position.x + q.c * b.position.y };
      b.angle = Math.PI / 2;
    }
    const w = runShip(raw, 240);
    const v = assemblyTotals(w, "hull")!.velocity;
    // The nose points along −x now.
    expect(v.x).toBeLessThan(-2);
    expect(Math.abs(v.y)).toBeLessThan(0.5 * Math.abs(v.x));
    expect(w.ledger.violations).toBe(0);
  });

  it("PRP-008 changing the nozzle's geometry changes the thrust", () => {
    const withFlare = runShip(rs08(), 360);
    const raw = rs08();
    raw.world.bodies = raw.world.bodies.filter((b) => !b.id.startsWith("nozzle"));
    raw.world.joints = raw.world.joints.filter((j) => !j.id.includes("nozzle"));
    const plain = runShip(raw, 360);
    const flare = assemblyTotals(withFlare, "hull")!.momentum.y;
    const hole = assemblyTotals(plain, "hull")!.momentum.y;
    // The same propellant burned, but the impulse differs by more than the jet's noise.
    expect(Math.abs(flare - hole) / Math.max(flare, hole)).toBeGreaterThan(0.02);
  });

  it("PRP-006 an engine whose thrust line misses the centre of mass spins the ship (RS-09)", () => {
    const r = runScenario(parseScenario(readJson(join(ROOT, "scenarios", "rs09-off-axis-thruster.json"))));
    expect(r.passed).toBe(true);
    expect(r.probes.spin.at(-1)!).toBeLessThan(-0.2);
  });

  it("ASM-004 PRP-005 a mount too weak for full thrust breaks, under load from gas on the engine walls (RS-10)", () => {
    const r = runScenario(parseScenario(readJson(join(ROOT, "scenarios", "rs10-weak-engine-mount.json"))));
    expect(r.passed).toBe(true);
    const e = r.world.events.find((x) => x.type === "joint.break")!;
    expect(e.data.id).toBe("w-engine-mount");
    expect(e.data.quantity).toBe("compression");
  });

  it("PRP-007 ORC-007 ORC-008 a full burn matches the rocket equation, and the ship's impulse is minus the exhaust's momentum (RS-08)", () => {
    const raw = rs08();
    const scn = parseScenario(raw);
    const w0 = initialWorld(scn);
    const m0 = assemblyTotals(w0, "hull")!.mass;
    const inside = new Set<number>();
    let mOut = 0;
    let exhaust = 0;
    let exhaustP = { x: 0, y: 0 };
    const w = runShip(raw, scn.end.steps, (world) => {
      const a = assemblyTotals(world, "hull")!;
      const eng = world.bodies.find((b) => b.id === "engine")!;
      const q = sinCos(eng.angle);
      const alive = new Set<number>();
      for (const p of parcelsOf(world.gas)) {
        alive.add(p.id);
        // In the engine's frame: has the parcel passed the nozzle exit (1.1 m below the chamber centre)?
        const local = invRotate(q, { x: p.position.x - eng.position.x, y: p.position.y - eng.position.y });
        const below = local.y < -1.6;
        if (!below) inside.add(p.id);
        else if (inside.has(p.id)) {
          inside.delete(p.id);
          const rel = invRotate(q, { x: p.velocity.x - a.velocity.x, y: p.velocity.y - a.velocity.y });
          mOut += p.mass;
          exhaust += -p.mass * rel.y;
          exhaustP = { x: exhaustP.x + p.mass * p.velocity.x, y: exhaustP.y + p.mass * p.velocity.y };
        }
      }
      for (const id of [...inside]) if (!alive.has(id)) inside.delete(id);
    });
    const a = assemblyTotals(w, "hull")!;
    const ve = exhaust / mOut;
    const dv = Math.hypot(a.velocity.x, a.velocity.y);
    const predicted = ve * Math.log(m0 / a.mass);
    expect(mOut).toBeGreaterThan(1.6); // nearly all 1.8 kg went out through the nozzle
    expect(Math.abs(dv - predicted) / predicted).toBeLessThan(sandbox.tol.rocket);
    // ORC-008: the ship's momentum is minus what the gas carries, in flight or already gone.
    const g = gasTotals(w.gas);
    expect(a.momentum.y + g.momentum.y + w.gas.removed.momentum.y).toBeCloseTo(0, 6);
    expect(-exhaustP.y / a.momentum.y).toBeGreaterThan(0.9);
  }, 60_000);
});
