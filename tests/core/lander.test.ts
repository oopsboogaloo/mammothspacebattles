import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bodyMass, getProfile, hashValue, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";

// Mammoth Lander (docs/games/mammoth-lander.md), on the Easy scenario.
const raw = JSON.parse(readFileSync(new URL("../../scenarios/lander-easy.json", import.meta.url), "utf8"));
const pad1 = raw.world.bodies.find((b: { id: string }) => b.id === "pad-1");
const padTop = pad1.position.y + 0.2;
/** The ship reaches this far below its hull's centre (legs and nozzles), m. */
const REACH = 3.15;

/** A game whose ships start just above pad 1, falling at `v`, with `opts` over the scenario's. */
function game(v: number, opts: Record<string, unknown> = {}): { w: World; step: (s: number) => void } {
  const scn = structuredClone(raw);
  Object.assign(scn.world.lander, { start: { position: { x: pad1.position.x, y: padTop + REACH + 0.1 }, velocity: { x: 0, y: -v } }, ...opts });
  const s = parseScenario(scn);
  const prof = getProfile(s.profile);
  const w = initialWorld(s);
  return { w, step: (secs) => { for (let k = 0; k < secs * 240; k++) stepInPlace(w, [], prof); } };
}

describe("Mammoth Lander", () => {
  it("LND-010 LND-013 a gentle touchdown on a pad lands, scored by the pad's multiplier", () => {
    const { w, step } = game(1);
    step(1.5);
    expect(w.events.find((e) => e.type === "landed")).toBeDefined();
    expect(w.lander!.state.landings.map((l) => l.pad)).toEqual(["pad-1"]);
    // (200 + 100 × fuel left) × 2, less the share damaged: undamaged, a full tank.
    expect(w.challenge!.status.damage).toBe(0);
    expect(w.lander!.state.score).toBe(600);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-014 DMG-008 no speed limit: the welds decide. Gentle is unharmed, firmer bends the legs, hard breaks one off", () => {
    const at = (v: number) => {
      const { w, step } = game(v);
      step(2);
      return { phase: w.events.find((e) => e.type === "landed" || e.type === "crashed")?.type, damage: w.challenge!.status.damage ?? 0, score: w.lander!.state.score };
    };
    const soft = at(2);
    expect(soft).toMatchObject({ phase: "landed", damage: 0 });
    // Firmer: still a landing, the leg welds bent, the score cut by the share damaged.
    const firm = at(3.5);
    expect(firm.phase).toBe("landed");
    expect(firm.damage).toBeGreaterThan(0.1);
    expect(firm.damage).toBeLessThan(0.4);
    expect(firm.score).toBe(Math.round(600 * (1 - firm.damage)));
    // Hard: a leg comes off, and the ship is broken.
    expect(at(5).phase).toBe("crashed");
  });

  it("LND-012 LND-020 a used pad is closed, and the next ship starts in the same world", () => {
    const { w, step } = game(1, { pause: 0.5 });
    step(1.5);
    expect(w.lander!.state.used).toEqual(["pad-1"]);
    // Ship 1 stays parked on the pad, and its engines no longer answer the keys.
    expect(w.links.some((l) => l.kind === "control" && l.to.startsWith("l1-"))).toBe(false);
    while (w.lander!.state.n < 2) step(1 / 240);
    expect(w.bodies.some((b) => b.id === "l1-hull")).toBe(true);
    expect(w.challenge!.goal.used).toEqual(["pad-1"]);
    // Ship 2 starts where ship 1 did, so it comes down on ship 1: the world carried on.
    step(1);
    expect(w.events.some((e) => e.type === "collision" && [String(e.data.a), String(e.data.b)].some((id) => id.startsWith("l1-")) && [String(e.data.a), String(e.data.b)].some((id) => id.startsWith("l2-")))).toBe(true);
  });

  it("LND-012 LND-015 a used pad is ground: resting on it is no landing, and no crash", () => {
    const { w, step } = game(1);
    step(1 / 240); // the ship arrives
    w.lander!.state.used = ["pad-1"]; // as if landed on earlier
    w.challenge!.goal.used = ["pad-1"];
    step(2);
    expect(w.lander!.state.landings).toEqual([]);
    expect(w.lander!.state.crashes).toBe(0);
    expect(w.challenge!.status.phase).toBe("flying"); // resting, free to take off again
  });

  it("LND-015 a ship at rest off the pads may be abandoned: stranded, no score, the next ship comes", () => {
    const { w, step } = game(1, { pause: 0.5 });
    step(1 / 240);
    w.lander!.state.used = ["pad-1"];
    w.challenge!.goal.used = ["pad-1"];
    step(2);
    w.controls.abandon = 1;
    step(0.1);
    expect(w.challenge!.status.phase).toBe("stranded");
    expect(w.lander!.state.stranded).toBe(1);
    expect(w.lander!.state.score).toBe(0);
    step(1);
    expect(w.lander!.state.n).toBe(2);
    expect(w.controls.abandon).toBe(0); // the new ship isn't abandoned
  });

  it("LND-015 a ship at rest off the pads with no fuel left is stranded", () => {
    const { w, step } = game(1);
    step(1 / 240);
    w.lander!.state.used = ["pad-1"];
    w.challenge!.goal.used = ["pad-1"];
    for (const b of w.bodies) if (b.id.startsWith("l1-")) for (const st of b.contents ?? []) st.mass = 0;
    step(2);
    expect(w.challenge!.status.phase).toBe("stranded");
    expect(w.challenge!.status.reason).toMatch(/out of fuel/i);
  });

  it("LND-021 a hard crash breaks the ship, bursts its tank and leaves wreckage, with the ledger exact", () => {
    const { w, step } = game(15);
    step(2);
    expect(w.events.some((e) => e.type === "crashed")).toBe(true);
    expect(w.events.some((e) => e.type === "detonation" && e.data.id === "l1-tank")).toBe(true);
    expect(w.events.some((e) => e.type === "joint.break")).toBe(true);
    // Most of the ship is still there as wreckage.
    expect(w.bodies.filter((b) => b.id.startsWith("l1-")).length).toBeGreaterThan(10);
    expect(w.ledger.violations).toBe(0);
  });

  it("DMG-008 a weld bent all the way breaks with a finite load, so a hard crash still hashes", () => {
    const { w, step } = game(15);
    step(0.5);
    const breaks = w.events.filter((e) => e.type === "joint.break");
    expect(breaks.length).toBeGreaterThan(0);
    for (const e of breaks) expect(Number.isFinite(Number(e.data.load)) && Number.isFinite(Number(e.data.limit))).toBe(true);
    expect(() => hashValue(w)).not.toThrow();
  });

  it("LND-014 a part destroyed outright (and gone) is a crash, not a lighter ship", () => {
    const { w, step } = game(1);
    step(1 / 240);
    w.bodies.find((b) => b.id === "l1-leg-left")!.integrity = 0;
    step(1 / 60);
    expect(w.challenge!.status.phase).toBe("crashed");
    expect(w.challenge!.status.reason).toBe("A part of the ship was destroyed.");
  });

  it("LND-021 a crash that only cracks the tank leaks it, and doesn't set it off", () => {
    const { w, step } = game(10);
    step(2);
    const tank = w.bodies.find((b) => b.id === "l1-tank")!;
    expect(w.events.some((e) => e.type === "crashed")).toBe(true);
    expect(tank.integrity).toBeGreaterThan(0);
    expect(tank.integrity).toBeLessThan(1);
    expect(tank.breach).toBeDefined();
    expect(w.events.some((e) => e.type === "detonation")).toBe(false);
  });

  it("LND-021 a damaged engine fires with less force", () => {
    const burn = (integrity: number) => {
      const { w, step } = game(0);
      step(1 / 240);
      w.gravity = { x: 0, y: 0 };
      w.bodies.find((b) => b.id === "l1-engine-l")!.integrity = integrity;
      const fuel = () => w.bodies.filter((b) => b.id.startsWith("l1-")).reduce((m, b) => m + (b.contents ?? []).reduce((a, st) => a + st.mass, 0), 0);
      const before = fuel();
      w.controls.left = 1;
      step(0.5);
      return before - fuel();
    };
    const whole = burn(1);
    expect(whole).toBeGreaterThan(0);
    expect(burn(0.5) / whole).toBeCloseTo(0.5, 1);
  });

  it("LND-034 when a ship breaks up, the keys reach none of it, and a broken-off engine fires its last propellant", () => {
    const { w, step } = game(0);
    step(1 / 240);
    w.gravity = { x: 0, y: 0 };
    w.controls.left = 1; // firing as it breaks
    step(0.25);
    // The left engine's mounting gives way: the ship has broken apart.
    w.joints = w.joints.filter((j) => j.id !== "l1-w-wing-left");
    step(1 / 240);
    expect(w.challenge!.status.phase).toBe("crashed");
    const engine = w.bodies.find((b) => b.id === "l1-engine-l")!;
    // Its feed lines snapped where the ship came apart; it fires on a channel of its own.
    expect(w.links.some((l) => l.kind === "feed" && l.to === "l1-engine-l")).toBe(false);
    expect(engine.injector!.channel).toBe("l1-sputter");
    step(0.1);
    expect(engine.injector!.firing).toBe(true);
    // The keys move nothing of ship 1 now, and the sputter stops by itself.
    step(0.6);
    expect(engine.injector!.firing).toBe(false);
    w.controls.left = 1;
    w.controls.right = 1;
    step(0.2);
    expect(w.bodies.filter((b) => b.id.startsWith("l1-") && b.injector?.firing)).toEqual([]);
  });

  it("LND-032 a crash plays out before its verdict shows: the next ship waits the watch time too", () => {
    const { w, step } = game(15, { pause: 0.5, watch: 1.25 });
    step(1 / 240);
    while (w.lander!.state.phase === "flying") step(1 / 240);
    expect(w.challenge!.status.phase).toBe("crashed");
    // A landing waits `pause`; a crash `pause` and `watch`, while the UI holds the banner back.
    expect(w.lander!.state.next! - w.time).toBeCloseTo(0.5 + 1.25, 2);
  });

  it("LND-020 the game ends when every ship has flown", () => {
    const { w, step } = game(15, { ships: 2, pause: 0.5 });
    step(8);
    expect(w.lander!.state.crashes).toBe(2);
    expect(w.lander!.state.phase).toBe("over");
    expect(w.lander!.state.ended).toBe("ships");
  });

  it("LND-020 a landing uses a ship too: three ships, landed or crashed, make the game", () => {
    const { w, step } = game(1, { ships: 1, pause: 0.5 });
    step(2.5);
    expect(w.lander!.state.landings).toHaveLength(1);
    expect(w.lander!.state.phase).toBe("over");
    expect(w.lander!.state.ended).toBe("ships");
  });

  it("LND-021 the last ship's hard crash still bursts its tank before the game ends", () => {
    const { w, step } = game(15, { ships: 1, pause: 0.5 });
    step(4);
    expect(w.lander!.state.phase).toBe("over");
    expect(w.events.some((e) => e.type === "detonation" && e.data.id === "l1-tank")).toBe(true);
  });

  it("LND-021 a ship that breaks apart has crashed, whichever part hit first", () => {
    // Tilted and hard onto the pad: welds break as it hits.
    const scn = structuredClone(raw);
    scn.world.lander.start = { position: { x: pad1.position.x, y: padTop + REACH + 2 }, velocity: { x: 0, y: -12 } };
    scn.world.lander.ship.bodies = scn.world.lander.ship.bodies.map((b: { position: { x: number; y: number }; angle?: number }) => {
      const c = Math.cos(0.4);
      const sn = Math.sin(0.4);
      return { ...b, position: { x: c * b.position.x - sn * b.position.y, y: sn * b.position.x + c * b.position.y }, angle: (b.angle ?? 0) + 0.4 };
    });
    const s = parseScenario(scn);
    const prof = getProfile(s.profile);
    const w = initialWorld(s);
    for (let k = 0; k < 2 * 240; k++) stepInPlace(w, [], prof);
    expect(w.lander!.state.crashes).toBe(1);
    expect(w.events.find((e) => e.type === "crashed")?.data.reason).toBe("The ship broke apart.");
  });

  it("LND-040 Emergency: the tank leaks from the start, draining fuel and pushing the ship sideways", () => {
    const scn = JSON.parse(readFileSync(new URL("../../scenarios/lander-emergency.json", import.meta.url), "utf8"));
    scn.world.gravity = { x: 0, y: 0 };
    scn.world.lander.start = { position: { x: 0, y: 900 }, velocity: { x: 0, y: 0 } };
    const s = parseScenario(scn);
    const prof = getProfile(s.profile);
    const w = initialWorld(s);
    for (let k = 0; k < 2 * 240; k++) stepInPlace(w, [], prof);
    const st = w.challenge!.status;
    expect(st.fuel).toBeLessThan(st.fuelStart - 0.2); // no engine firing
    // About a fifth of one engine's thrust, sideways: nearly 0.4 m/s² on the 27 kg ship.
    expect(Math.abs(st.vx)).toBeGreaterThan(0.5);
    expect(Math.abs(st.vx)).toBeLessThan(1.1);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-010 Cave: the deepest pad scores ×6, and the cave doesn't wrap", () => {
    const scn = JSON.parse(readFileSync(new URL("../../scenarios/lander-cave.json", import.meta.url), "utf8"));
    expect(scn.world.bounds.wrap).toBe(false);
    const deep = scn.world.bodies.find((b: { id: string }) => b.id === "pad-5");
    expect(scn.world.lander.pads.find((p: { id: string }) => p.id === "pad-5").multiplier).toBe(6);
    // Deeper pads score more.
    const ys = scn.world.lander.pads.map((p: { id: string }) => scn.world.bodies.find((b: { id: string }) => b.id === p.id).position.y);
    expect(ys).toEqual([...ys].sort((a: number, b: number) => b - a));
    scn.world.lander.start = { position: { x: deep.position.x, y: deep.position.y + 0.2 + REACH + 0.1 }, velocity: { x: 0, y: -1 } };
    const s = parseScenario(scn);
    const prof = getProfile(s.profile);
    const w = initialWorld(s);
    for (let k = 0; k < 1.5 * 240; k++) stepInPlace(w, [], prof);
    expect(w.lander!.state.landings.map((l) => l.pad)).toEqual(["pad-5"]);
    // (100 + a little for softness, about 1.2 m/s of the 1.5 allowed, + 100 for a full tank) × 6.
    expect(w.lander!.state.score).toBeGreaterThan(1300);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-011 Orbital: a gentle touchdown on a pad riding the spinning asteroid lands, judged against the pad", () => {
    const scn = JSON.parse(readFileSync(new URL("../../scenarios/lander-orbital.json", import.meta.url), "utf8"));
    const core = scn.world.bodies.find((b: { id: string }) => b.id === "rock-core");
    expect(core.gravity.mu).toBeGreaterThan(0);
    const w0 = core.angularVelocity;
    expect(w0).toBeGreaterThan(0); // it spins: one turn in 5 to 10 minutes
    expect((2 * Math.PI) / w0).toBeGreaterThan(300);
    expect((2 * Math.PI) / w0).toBeLessThan(600);
    // Just above pad 2 (a crater floor, on the rock's side), tilted to its "up", moving with it and
    // coming down at 1 m/s.
    const pad = scn.world.bodies.find((b: { id: string }) => b.id === "pad-2");
    const a = pad.angle;
    const up = { x: -Math.sin(a), y: Math.cos(a) };
    const h = 0.2 + REACH + 0.1;
    const at = { x: pad.position.x + up.x * h, y: pad.position.y + up.y * h };
    scn.world.lander.start = { position: at, velocity: { x: -w0 * at.y - up.x, y: w0 * at.x - up.y } };
    scn.world.lander.ship.bodies = scn.world.lander.ship.bodies.map((b: { position: { x: number; y: number }; angle?: number }) => ({
      ...b,
      position: { x: Math.cos(a) * b.position.x - Math.sin(a) * b.position.y, y: Math.sin(a) * b.position.x + Math.cos(a) * b.position.y },
      angle: (b.angle ?? 0) + a,
    }));
    const s = parseScenario(scn);
    const prof = getProfile(s.profile);
    const w = initialWorld(s);
    for (let k = 0; k < 2 * 240; k++) stepInPlace(w, [], prof);
    expect(w.events.filter((e) => e.type === "crashed")).toEqual([]);
    expect(w.lander!.state.landings.map((l) => l.pad)).toEqual(["pad-2"]);
    // Measured against the pad: at rest on it, upright to it, though both are moving and turned.
    expect(Math.abs(w.challenge!.status.tilt)).toBeLessThan(3);
    expect(Math.hypot(w.challenge!.status.vx, w.challenge!.status.vy)).toBeLessThan(0.3);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-011 Orbital: the asteroid holds together and spins in place, and the ship starts in orbit", () => {
    const s = parseScenario(JSON.parse(readFileSync(new URL("../../scenarios/lander-orbital.json", import.meta.url), "utf8")));
    const prof = getProfile(s.profile);
    const w = initialWorld(s);
    for (let k = 0; k < 10 * 240; k++) stepInPlace(w, [], prof);
    // Its centre of mass stays put (it was built centred on it).
    const rock = w.bodies.filter((b) => b.id.startsWith("rock-") || b.id.startsWith("pad-"));
    const M = rock.reduce((m, b) => m + bodyMass(b), 0);
    const com = rock.reduce((c, b) => ({ x: c.x + (bodyMass(b) * b.position.x) / M, y: c.y + (bodyMass(b) * b.position.y) / M }), { x: 0, y: 0 });
    expect(Math.hypot(com.x, com.y)).toBeLessThan(0.01);
    expect(w.joints.filter((j) => j.a === "rock-core")).toHaveLength(w.bodies.filter((b) => b.id.startsWith("rock-") || b.id.startsWith("pad-")).length - 1);
    // Still in orbit, about 60 m up.
    const hull = w.bodies.find((b) => b.id === "l1-hull")!;
    expect(Math.hypot(hull.position.x, hull.position.y)).toBeGreaterThan(130);
    expect(w.lander!.state.crashes).toBe(0);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-042 a wrapped level's ground reaches both edges exactly, so there is no hole at the seam", () => {
    for (const name of ["easy", "medium", "hard", "emergency"]) {
      const scn = JSON.parse(readFileSync(new URL(`../../scenarios/lander-${name}.json`, import.meta.url), "utf8"));
      const xs = scn.world.bodies
        .filter((b: { id: string }) => b.id.startsWith("ground-") && !b.id.startsWith("ground-seam"))
        .flatMap((b: { position: { x: number }; shape: { vertices: { x: number }[] } }) => b.shape.vertices.map((v) => v.x + b.position.x));
      expect([Math.min(...xs), Math.max(...xs)]).toEqual([scn.world.bounds.min.x, scn.world.bounds.max.x]);
    }
  });

  it("LND-040 Emergency's ship comes in fast and spinning, as one rigid body", () => {
    const scn = JSON.parse(readFileSync(new URL("../../scenarios/lander-emergency.json", import.meta.url), "utf8"));
    const { velocity, spin } = scn.world.lander.start;
    expect(Math.abs(velocity.x)).toBeGreaterThanOrEqual(20);
    expect(spin).toBeGreaterThan(1);
    const s = parseScenario(scn);
    const w = initialWorld(s);
    stepInPlace(w, [], getProfile(s.profile));
    const ship = w.bodies.filter((b) => b.id.startsWith("l1-"));
    // Every part turns at the spin, and the ship as a whole moves at the start velocity.
    for (const b of ship) expect(b.angularVelocity).toBeCloseTo(spin, 2);
    const m = ship.reduce((a, b) => a + bodyMass(b), 0);
    const px = ship.reduce((a, b) => a + bodyMass(b) * b.velocity.x, 0) / m;
    expect(px).toBeCloseTo(velocity.x, 1);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-041 the scenario is checked: the hull must be one of the ship's bodies", () => {
    const scn = structuredClone(raw);
    scn.world.lander.hull = "l{n}-nothing";
    expect(() => parseScenario(scn)).toThrow(/hull/);
    const lines = structuredClone(raw);
    lines.world.lander.lines = [[{ x: 0, y: 0 }]];
    expect(() => parseScenario(lines)).toThrow(/lines/);
  });
});
