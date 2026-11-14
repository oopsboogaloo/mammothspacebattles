// Mammoth Thrust's game in the world (docs/games/mammoth-thrust.md; src/core/thrust.ts) and its levels (scripts/thrust.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERRAIN_OPS, addBody, computeTotals, plantCoolant, runPlant, transmitterTips, createWorld, cutCrater, getProfile, hashValue, initialWorld, parseScenario, ScenarioError, stepInPlace, THRUST_SCORES, thrustFuel, generatorOnline, turretOnline, turretWorks, type Command, type World } from "../../src/core/index.ts";
import { narrowest } from "../../scripts/terrain.ts";
import { bearingsOnto } from "../../scripts/aim.ts";

/** A level's scenario; "test" is the first level 1, kept for the tests of the ship, the tether and the first turret. */
const raw = (n: number | "test") => JSON.parse(readFileSync(new URL(`../../scenarios/thrust-${n}.json`, import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });

/** A game on level `n`, with `edit` over the scenario. `step(s)` runs s game seconds, the commands on its first step. */
function game(n: number | "test" = "test", edit?: (scn: ReturnType<typeof raw>) => void): { w: World; step: (seconds: number, commands?: Command[]) => void } {
  const scn = raw(n);
  edit?.(scn);
  const w = initialWorld(parseScenario(scn));
  return {
    w,
    step: (seconds, commands = []) => {
      const k = Math.round(seconds * 240);
      for (let i = 0; i < k; i++) stepInPlace(w, i === 0 ? commands : [], sandbox);
    },
  };
}
const st = (w: World) => w.thrust!.state;
const body = (w: World, id: string) => w.bodies.find((b) => b.id === id);
const hull = (w: World) => body(w, `p${st(w).n}-hull`)!;
const pod = (w: World) => body(w, "pod")!;
const parts = (w: World, n: number) => w.bodies.filter((b) => b.id.startsWith(`p${n}-`) && !b.id.includes("-shell-"));
/** After moving things by hand: the ledger starts from the world as it now is. */
const settle = (w: World) => {
  w.ledger.totals = computeTotals(w);
};
/** Moves the ship flying so its hull is at `to`, at rest. */
function moveShip(w: World, to: { x: number; y: number }): void {
  const h = hull(w);
  const d = { x: to.x - h.position.x, y: to.y - h.position.y };
  for (const b of parts(w, st(w).n)) {
    b.position = { x: b.position.x + d.x, y: b.position.y + d.y };
    b.velocity = { x: 0, y: 0 };
  }
  settle(w);
}
/** The ship 9 m over the pod with the pod on its tether, the tractor's button let go. */
function withPod(n: number | "test" = "test", edit?: (scn: ReturnType<typeof raw>) => void) {
  const g = game(n, edit);
  moveShip(g.w, { x: pod(g.w).position.x, y: pod(g.w).position.y + 9 });
  g.step(0.1, [set("tractor", 1)]);
  g.step(0.05, [set("tractor", 0)]);
  return g;
}
const types = (w: World) => new Set(w.events.map((e) => e.type));

describe("Mammoth Thrust", () => {
  it("MTH-010 MTH-011 MTH-093 a level is fixed ground that can't be damaged under 4 m/s² of gravity, wrapping round at its sides with no walls, the pod on its stand and the ship at the start", () => {
    for (const n of [1, 2, 3]) {
      const { w } = game(n);
      expect(w.gravity).toEqual({ x: 0, y: -4 });
      // It wraps round at its sides (MTH-093): the ground's two ends meet at one height, and there is
      // no rock at either side above it.
      expect(w.bounds.wrap).toBe(true);
      const ground = raw(n).world.terrain.outline.slice(2);
      expect(ground[0].x).toBe(w.bounds.max.x);
      expect(ground[ground.length - 1].x).toBe(w.bounds.min.x);
      expect(ground[0].y).toBe(ground[ground.length - 1].y);
      const side = w.bodies.filter((b) => b.id.startsWith("rock-") && b.shape.kind === "polygon" && b.shape.vertices.some((v) => Math.min(Math.abs(b.position.x + v.x - w.bounds.min.x), Math.abs(b.position.x + v.x - w.bounds.max.x)) < 0.5 && b.position.y + v.y > ground[0].y + 1 && b.position.y + v.y < w.thrust!.spec.top));
      expect(side.map((b) => b.id)).toEqual([]);
      const rock = w.bodies.filter((b) => b.id.startsWith("rock-"));
      expect(rock.length).toBeGreaterThan(20);
      expect(rock.every((b) => b.fixed && !b.material)).toBe(true);
      expect(st(w)).toMatchObject({ phase: "flying", lives: 5, n: 1, score: 0, pod: "stand" });
      expect(hull(w).position.x).toBeCloseTo(w.thrust!.spec.start.x, 6);
      expect(hull(w).position.y).toBeCloseTo(w.thrust!.spec.start.y, 6);
      expect(pod(w).mass).toBe(34);
      expect(w.thrust!.spec.level).toBe(n);
    }
    // The test level (the first level 1) has one turret of the first kind: a base, a mount, a
    // carriage with its gun, a battery, a generator, a pipe and a fuel tank (MTH-031).
    for (const [n, count] of [["test", 1]] as const) {
      const { w } = game(n);
      expect(w.thrust!.spec.turrets).toHaveLength(count);
      for (let k = 1; k <= count; k++) {
        for (const part of ["base", "mount", "carriage", "gun", "battery", "gen", "pipe", "tank"]) expect(body(w, `t${k}-${part}`), `t${k}-${part}`).toBeDefined();
        expect(body(w, `t${k}-base`)!.fixed).toBe(true);
        expect(body(w, `t${k}-tank`)!.fixed).toBe(false);
        expect(turretWorks(w, body(w, `t${k}-carriage`)!)).toBe(true);
      }
    }
    // Level 1 has no cave; level 2's pod is in its chamber, 75 m under the surface.
    expect(raw(1).world.thrust.view.caves).toHaveLength(0);
    expect(raw(2).world.thrust.view.caves).toHaveLength(1);
    expect(pod(game(2).w).position.y).toBeLessThan(-25);
  });

  it("MTH-096 WPN-013 level 1 is Chloe's surface: an electric turret on its own power, a fuel tank feeding a generator through a pipe, the generator charging a capacitor, the capacitor powering the turret; nothing moves as it starts", () => {
    const s = raw(1);
    expect(s.world.thrust.turrets).toEqual(["t1-breech"]);
    expect(s.world.thrust.tanks).toEqual(["fuel-1", "fuel-2"]);
    expect(s.world.thrust.view.cables).toHaveLength(2);
    const { w, step } = game(1);
    const breech = body(w, "t1-breech")!;
    expect(breech.turret).toMatchObject({ battery: "t1-cap", cabled: true });
    expect(body(w, "t1-cap")!.charge).toEqual({ shots: 5, capacity: 5 });
    expect(body(w, "t1-gen")!.generator).toMatchObject({ battery: "t1-cap" });
    const pipes = w.bodies.filter((b) => b.id.startsWith("t1-pipe-"));
    expect(pipes.length).toBeGreaterThan(1);
    // Every piece of pipe lies in the open, where a slug can reach it, not inside the rock.
    const outline: { x: number; y: number }[] = s.world.terrain.outline;
    const open = (p: { x: number; y: number }) => {
      let c = false;
      for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
        const a = outline[i];
        const b = outline[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    for (const b of pipes) expect(open(b.position), b.id).toBe(true);
    // The new fuel tanks: round, on two legs.
    expect(body(w, "fuel-1")!.shape).toEqual({ kind: "disc", radius: 1 });
    expect(body(w, "fuel-1-leg-l")).toBeDefined();
    expect(generatorOnline(w, body(w, "t1-gen")!)).toBe(true);
    expect(turretOnline(w, breech)).toBe(true);
    breech.turret!.enabled = false;
    const at = new Map(w.bodies.map((b) => [b.id, { ...b.position }]));
    step(3);
    for (const b of w.bodies.filter((x) => /^(t1|fuel|pod|stand)/.test(x.id))) expect(Math.hypot(b.position.x - at.get(b.id)!.x, b.position.y - at.get(b.id)!.y), b.id).toBeLessThan(0.05);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-097 WPN-013 level 2 is Chloe's chamber: three electric turrets, two of them on one capacitor (the surface's, by a long cable to the chamber's roof), the third on its own down the chamber's wall; nothing moves as it starts", () => {
    const s = raw(2);
    expect(s.world.thrust.turrets).toEqual(["t1-breech", "t2-breech", "t3-breech"]);
    expect(s.world.thrust.tanks).toEqual(["fuel-1", "fuel-2", "fuel-3"]);
    const { w, step } = game(2);
    expect(body(w, "t1-breech")!.turret!.battery).toBe("t1-cap");
    expect(body(w, "t2-breech")!.turret!.battery).toBe("t1-cap");
    expect(body(w, "t3-breech")!.turret!.battery).toBe("t3-cap");
    for (const g of ["t1-gen", "t3-gen"]) expect(generatorOnline(w, body(w, g)!), g).toBe(true);
    for (const b of w.bodies) if (b.turret) b.turret.enabled = false;
    const at = new Map(w.bodies.map((b) => [b.id, { ...b.position }]));
    step(3);
    for (const b of w.bodies.filter((x) => /^(t\d|fuel|pod|stand)/.test(x.id)))
      expect(Math.hypot(b.position.x - at.get(b.id)!.x, b.position.y - at.get(b.id)!.y), b.id).toBeLessThan(/barrel|breech/.test(b.id) ? 0.2 : 0.05);
    expect(w.ledger.violations).toBe(0);
  });

  it("WPN-013 the capacitor empties as the turret fires and the generator fills it again, burning the tank's fuel; red when it can't", () => {
    // The ship held over the valley, in the turret's sight.
    const { w, step } = game(1, (s) => (s.world.gravity = { x: 0, y: 0 }));
    const cap = body(w, "t1-cap")!;
    const gen = body(w, "t1-gen")!;
    const breech = body(w, "t1-breech")!;
    const fuel = () => (body(w, "fuel-1")?.contents ?? []).reduce((m, c) => m + c.mass, 0);
    const full = fuel();
    moveShip(w, { x: -10, y: 40 });
    let least = 5;
    for (let k = 0; k < 40; k++) {
      step(0.25);
      least = Math.min(least, cap.charge!.shots);
    }
    expect(w.events.filter((e) => e.type === "turret.fire" && e.data.id === "t1-breech").length).toBeGreaterThan(3);
    expect(least).toBeLessThan(5);
    expect(fuel()).toBeLessThan(full); // the generator burned some to fill it again
    // The pipe broken: the generator is offline at once, and the capacitor runs down and is red.
    const piece = w.bodies.find((b) => b.id === "t1-pipe-2")!;
    piece.integrity = 0;
    step(0.05);
    expect(generatorOnline(w, gen)).toBe(false);
    cap.charge!.shots = 0.5;
    expect(turretOnline(w, breech)).toBe(false);
    const shots = cap.charge!.shots;
    step(2);
    expect(cap.charge!.shots).toBeCloseTo(shots, 6); // nothing fills it
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("WPN-013 a generator goes red once its tank is dry (the beam can drain it); a destroyed capacitor puts the turret out of action, a destroyed generator doesn't at once", () => {
    const dry = game(1);
    expect(generatorOnline(dry.w, body(dry.w, "t1-gen")!)).toBe(true);
    for (const c of body(dry.w, "fuel-1")!.contents!) c.mass = 0;
    settle(dry.w);
    dry.step(0.1);
    expect(generatorOnline(dry.w, body(dry.w, "t1-gen")!)).toBe(false);
    expect(body(dry.w, "fuel-1")!.siphon).toBe(true);
    const gone = game(1);
    body(gone.w, "t1-cap")!.integrity = 0;
    gone.step(0.1);
    expect(st(gone.w).turretsOut).toEqual(["t1-breech"]);
    const noGen = game(1);
    body(noGen.w, "t1-gen")!.integrity = 0;
    noGen.step(0.1);
    expect(st(noGen.w).turretsOut).toEqual([]);
    expect(turretOnline(noGen.w, body(noGen.w, "t1-breech")!)).toBe(true); // on its capacitor's 5 shots
  });

  it("MTH-012 the narrowest passage of a cave is measured, and rock is a crust on the rock side of the outline", () => {
    // A box of open space 20 m wide and 60 m deep under a wide sky: clockwise, rock on the left.
    const P = (x: number, y: number) => ({ x, y });
    const air = [P(-100, 100), P(100, 100), P(100, 0), P(10, 0), P(10, -60), P(-10, -60), P(-10, 0), P(-100, 0)];
    expect(narrowest(air, -1)).toBeCloseTo(160, 6); // only the shaft's floor is wholly below -1: 160 m up to the sky's top
    expect(narrowest(air, 1)).toBeCloseTo(20, 6); // with its walls: 20 m across
    // The rock made from that outline (TER-001): the floor's crust lies under the floor, and none reaches into the open shaft.
    const made = createWorld(1, [], { x: 0, y: 0 }, { terrain: { outline: air } }, sandbox);
    const rock = made.bodies.map((b) => (b.shape.kind === "polygon" ? b.shape.vertices.map((v) => ({ x: v.x + b.position.x, y: v.y + b.position.y })) : []));
    const inShaft = (v: { x: number; y: number }) => Math.abs(v.x) < 10 - 1e-6 && v.y > -60 + 1e-6 && v.y < 0;
    expect(rock.every((vs) => !vs.some(inShaft))).toBe(true);
    expect(rock.some((vs) => vs.some((v) => v.y < -70))).toBe(true);
    // Level 2's shaft (Chloe's drawing) is about 20 m wide: no narrower than the 18 m it declares.
    const l2 = raw(2).world.thrust.view;
    expect(narrowest([...l2.caves[0]], 40)).toBeGreaterThanOrEqual(18);
  });

  it("MTH-093 flown off one side the ship comes back in at the other, the pod on its tether with it", () => {
    const g = withPod("test", (sc) => (sc.world.gravity = { x: 0, y: 0 }));
    const { w } = g;
    // The ship and pod high over the right side (the ground there is 61 m up), moving right at 15 m/s.
    const shift = (ids: World["bodies"], dx: number, dy: number) => {
      for (const b of ids) {
        b.position = { x: b.position.x + dx, y: b.position.y + dy };
        b.velocity = { x: 15, y: 0 };
      }
    };
    const ship = parts(w, 1);
    const h = hull(w);
    shift([...ship, pod(w)], w.bounds.max.x - 4 - h.position.x, 100 - h.position.y);
    settle(w);
    expect(st(w).pod).toBe("tether");
    g.step(2);
    // 30 m on: past the right side and in from the left.
    expect(hull(w).position.x).toBeGreaterThan(w.bounds.min.x + 20);
    expect(hull(w).position.x).toBeLessThan(w.bounds.min.x + 30);
    expect(pod(w).position.x).toBeLessThan(w.bounds.min.x + 30);
    expect(st(w).pod).toBe("tether");
    expect(w.events.some((e) => e.type === "tether.break")).toBe(false);
    expect(Math.abs(hull(w).tractor!.tension)).toBeLessThan(5000);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-020 the ship is Mammoth Asteroids' with a tractor unit and a tether unit, turns at about 7 rad/s², and fires slugs with no charge", () => {
    const { w, step } = game("test", (s) => (s.world.gravity = { x: 0, y: 0 }));
    // The cockpit works the beam and holds the tether, through the two units.
    expect(hull(w).tractor).toMatchObject({ channel: "tractor", beamFrom: "p1-tractor", tetherFrom: "p1-tether", only: ["pod"], mode: "off" });
    expect(body(w, "p1-tractor")).toBeDefined();
    expect(body(w, "p1-tether")).toBeDefined();
    expect(body(w, "p1-gun")!.magazine!.count).toBe(120);
    expect(body(w, "p1-gun")!.magazine!.shell.explosive).toBeUndefined();
    step(0.2);
    step(0.5, [set("left", 1)]);
    const turning = Math.abs(hull(w).angularVelocity) / 0.5;
    // (Faster than Asteroids' ship: it carries half the fuel, MTH-094.)
    expect(turning).toBeGreaterThan(8);
    expect(turning).toBeLessThan(10);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-021 holding the tractor on the pod within the tether's length takes it on the tether, gently; pressing again lets it go", () => {
    const { w, step } = withPod();
    expect(st(w).pod).toBe("tether");
    expect(hull(w).tractor).toMatchObject({ mode: "tether", cargo: "pod" });
    // Taken at 9 m on a 12 m tether that pays out (TRC-010): nothing is thrown or broken.
    expect(types(w).has("joint.break")).toBe(false);
    expect(Math.hypot(hull(w).velocity.x, hull(w).velocity.y)).toBeLessThan(3);
    step(0.8, [set("left", 1), set("right", 1)]);
    step(0.02, [set("left", 0), set("right", 0)]);
    expect(pod(w).position.y).toBeGreaterThan(st(w).stand.y + 1); // lifted off its stand
    step(0.05, [set("tractor", 1)]);
    step(0.05, [set("tractor", 0)]);
    expect(types(w).has("tether.release")).toBe(true);
    expect(st(w).pod).toBe("loose");
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-021 the tether takes the pod from up to 22 m off and reels it in to 12 m, gently; hard thrust and a turn don't make it let go", () => {
    const { w } = game("test", (s) => Object.assign(s.world.thrust, { top: 100000, turrets: [] }));
    moveShip(w, { x: pod(w).position.x + 3, y: pod(w).position.y + 20 });
    const far = game();
    moveShip(far.w, { x: pod(far.w).position.x, y: pod(far.w).position.y + 24 });
    far.step(0.1, [set("tractor", 1)]);
    expect(st(far.w).pod).not.toBe("tether"); // 24 m is past its reach
    let worst = 0;
    const fly = (seconds: number, commands: Command[]) => {
      const n = Math.round(seconds * 240);
      for (let i = 0; i < n; i++) {
        stepInPlace(w, i === 0 ? commands : [], sandbox);
        worst = Math.max(worst, Math.abs(hull(w).tractor!.tension));
      }
    };
    const apart = () => Math.hypot(pod(w).position.x - hull(w).position.x, pod(w).position.y - hull(w).position.y);
    fly(0.1, [set("tractor", 1)]);
    expect(st(w).pod).toBe("tether");
    expect(Number(w.events.find((e) => e.type === "tether.engage")!.data.distance)).toBeGreaterThan(19);
    fly(0.05, [set("tractor", 0)]);
    // Hovering on short burns while it reels in at 6 m/s.
    for (let k = 0; k < 6; k++) {
      fly(0.08, [set("left", 1), set("right", 1)]);
      fly(0.3, [set("left", 0), set("right", 0)]);
    }
    expect(hull(w).tractor!.paid).toBeUndefined(); // reeled in
    expect(apart()).toBeGreaterThan(11);
    expect(apart()).toBeLessThan(13.5);
    expect(worst).toBeLessThan(2000); // nothing snatched: the pod weighs 136 N
    fly(3, [set("left", 1), set("right", 1)]);
    fly(0.4, [set("right", 0)]);
    fly(1.5, [set("right", 1)]);
    expect(st(w).pod).toBe("tether");
    expect(types(w).has("tether.break")).toBe(false);
    expect(types(w).has("tether.release")).toBe(false);
    expect(types(w).has("joint.break")).toBe(false);
    // No weld of the ship has been bent by towing it.
    expect(Math.min(...w.joints.filter((j) => j.a.startsWith("p1-")).map((j) => j.integrity))).toBe(1);
    expect(hull(w).tractor!.tether.maxTension).toBe(100000);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-027 the beam pulls anything free in its wedge (wreckage too), but the tether takes the pod alone", () => {
    const { w, step } = game("test", (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
      // A loose piece of an earlier ship, 6 m under where the ship will be.
      s.world.bodies.push({ id: "p0-wreck", shape: { kind: "box", width: 0.6, height: 0.6 }, mass: 2, position: { x: 12, y: 27 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
    });
    // 39 m over the pod: beyond the tether's reach (22 m), within the beam's (40 m).
    moveShip(w, { x: 12, y: 33 });
    step(0.03, [set("tractor", 1)]);
    expect(hull(w).tractor!.mode).toBe("beam");
    expect(hull(w).tractor!.targets).toContain("p0-wreck");
    expect(body(w, "p0-wreck")!.velocity.y).toBeGreaterThan(0);
    // The wreck comes within the tether's length, and isn't taken.
    step(2);
    expect(hull(w).tractor!.cargo).not.toBe("p0-wreck");
  });

  it("MTH-022 with the tractor unit lost there is no beam at all", () => {
    const { w, step } = game();
    w.bodies = w.bodies.filter((b) => b.id !== "p1-tractor");
    w.joints = w.joints.filter((j) => j.a !== "p1-tractor" && j.b !== "p1-tractor");
    moveShip(w, { x: pod(w).position.x, y: pod(w).position.y + 9 });
    step(0.4, [set("tractor", 1)]);
    expect(types(w).has("tractor.on")).toBe(false);
    expect(st(w).pod).toBe("stand");
  });

  it("MTH-022 with the tether unit lost the beam still pulls, but the pod can't be held", () => {
    const { w, step } = game();
    w.bodies = w.bodies.filter((b) => b.id !== "p1-tether");
    w.joints = w.joints.filter((j) => j.a !== "p1-tether" && j.b !== "p1-tether");
    moveShip(w, { x: pod(w).position.x, y: pod(w).position.y + 9 });
    step(0.4, [set("tractor", 1)]);
    expect(types(w).has("tractor.on")).toBe(true);
    expect(types(w).has("tether.engage")).toBe(false);
    expect(st(w).pod).not.toBe("tether");
    expect(pod(w).velocity.y).toBeGreaterThan(0); // the beam is lifting it
  });

  it("MTH-023 MTH-050 a lost ship costs a life and nothing on the level is reset: the wreck and the pod stay, and a new ship beams in at the start, protected for a moment", () => {
    const { w, step } = withPod();
    step(0.6, [set("left", 1), set("right", 1)]);
    step(0.05, [set("left", 0), set("right", 0), set("tractor", 1)]); // let the pod go
    step(0.05, [set("tractor", 0)]);
    // The pod set down off its stand, on the hollow's floor.
    pod(w).position = { x: 17, y: -7 };
    pod(w).velocity = { x: 0, y: 0 };
    settle(w);
    step(2 / 240, [set("destruct", 1)]);
    expect(types(w).has("thrust.destruct")).toBe(true);
    expect(w.controls.destruct).toBe(0);
    step(0.1);
    expect(st(w)).toMatchObject({ phase: "between", lives: 4, n: 1 });
    expect(w.links.some((l) => l.kind === "control" && l.to.startsWith("p1-"))).toBe(false); // the keys fly only the next ship
    // After any loss there are 3 s on screen (1.5 game s) to watch it go before the page says the
    // ship is lost, and then the usual wait for the next one.
    expect(st(w).noteAt! - w.time).toBeGreaterThan(1.3);
    expect(st(w).next! - st(w).noteAt!).toBeCloseTo(1.25, 6);
    step(1.5);
    expect(st(w).phase).toBe("between");
    step(1.2);
    expect(st(w)).toMatchObject({ phase: "flying", lives: 4, n: 2, pod: "loose" });
    expect(hull(w).position.x).toBeCloseTo(w.thrust!.spec.start.x, 6);
    expect(parts(w, 1).length).toBeGreaterThan(5); // the wreck is still there
    expect(pod(w).integrity).toBe(1);
    // The pod lies about where it was left (the ship's explosion overhead rolled it a little): not back on its stand.
    expect(Math.hypot(pod(w).position.x - 17, pod(w).position.y + 7)).toBeLessThan(6);
    expect(Math.hypot(pod(w).position.x - st(w).stand.x, pod(w).position.y - st(w).stand.y)).toBeGreaterThan(2);
    // Protected: its parts carry no material until the grace is over.
    expect(st(w).graceUntil).toBeDefined();
    expect(parts(w, 2).every((b) => !b.material)).toBe(true);
    step(1.05);
    expect(st(w).graceUntil).toBeUndefined();
    expect(hull(w).material).toBeDefined();
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-050 five ships lost and the game is over, with no sixth ship", () => {
    const { w, step } = game();
    for (let k = 0; k < 5; k++) {
      step(2 / 240, [set("destruct", 1)]);
      step(2.9);
    }
    expect(st(w)).toMatchObject({ phase: "over", reason: "ships", lives: 0, n: 5 });
    expect(w.events.filter((e) => e.type === "thrust.ship")).toHaveLength(5);
    expect(w.events.filter((e) => e.type === "thrust.over")).toHaveLength(1);
    step(0.5, [set("destruct", 1)]);
    expect(st(w).n).toBe(5);
  }, 60_000);

  it("MTH-024 MTH-051 the level is complete when the ship is above the top with the pod on its tether: 2,000 for the pod and 100 for each kg of fuel left", () => {
    // A low top, so the climb is short: 30 m, with the start under it.
    const { w, step } = withPod("test", (s) => Object.assign(s.world.thrust, { top: 30, start: { x: -63, y: 25 } }));
    step(0.02, [set("left", 1), set("right", 1)]);
    for (let t = 0; t < 8 && st(w).phase === "flying"; t += 0.25) step(0.25);
    expect(st(w).phase).toBe("won");
    expect(hull(w).position.y).toBeGreaterThan(w.thrust!.spec.top);
    // The fuel is counted the moment the level is won; the engines have burned a little more since.
    const fuel = st(w).bonus!.fuel;
    const now = THRUST_SCORES.fuel * thrustFuel(w).mass;
    expect(st(w).bonus!.pod).toBe(2000);
    expect(fuel).toBeGreaterThanOrEqual(Math.floor(now));
    expect(fuel).toBeLessThan(now + 60);
    expect(fuel).toBeGreaterThan(500);
    expect(st(w).score).toBe(2000 + fuel);
    expect(w.events.filter((e) => e.type === "thrust.won")).toHaveLength(1);
    const score = st(w).score;
    step(0.2);
    expect(st(w).score).toBe(score); // won once
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-103 a ship more every 8,000 points, whenever the score passes one, and none again for points brought from the level before", () => {
    const { w, step } = game();
    step(0.1);
    st(w).score = 7900;
    step(0.05);
    expect(st(w).lives).toBe(5);
    st(w).score = 8100;
    step(0.05);
    expect(st(w).lives).toBe(6);
    st(w).score = 24500; // past two more at once
    step(0.05);
    expect(st(w).lives).toBe(8);
    expect(w.events.filter((e) => e.type === "thrust.extraLife")).toHaveLength(2);
    const next = game("test", (s) => (s.world.thrust.carry = { score: 24500, lives: 8 }));
    next.step(0.1);
    expect(st(next.w).lives).toBe(8);
    st(next.w).score = 32000;
    next.step(0.05);
    expect(st(next.w).lives).toBe(9);
  });
  it("MTH-026 a ship above the top without the pod is beamed back to the start as it is, upright and at rest, with no life lost", () => {
    const { w, step } = game();
    const top = w.thrust!.spec.top;
    body(w, "p1-tank-l")!.integrity = 0.6; // some damage to keep
    moveShip(w, { x: 20, y: top - 3 });
    for (const b of parts(w, 1)) b.velocity = { x: 3, y: 20 };
    settle(w);
    const before = thrustFuel(w).mass;
    step(0.3);
    expect(w.events.filter((e) => e.type === "thrust.back")).toHaveLength(1);
    expect(st(w)).toMatchObject({ phase: "flying", lives: 5, n: 1 });
    expect(st(w).stats.back).toBe(1);
    const start = w.thrust!.spec.start;
    expect(Math.abs(hull(w).position.x - start.x)).toBeLessThan(0.5);
    expect(hull(w).position.y).toBeLessThan(start.y + 0.01);
    expect(hull(w).position.y).toBeGreaterThan(start.y - 1); // it has only begun to fall again
    expect(Math.abs(hull(w).velocity.x)).toBeLessThan(0.5);
    expect(body(w, "p1-tank-l")!.integrity).toBeLessThanOrEqual(0.6);
    expect(body(w, "p1-tank-l")!.integrity).toBeGreaterThan(0.5);
    expect(thrustFuel(w).mass).toBeGreaterThan(before - 0.5); // less only what leaked from the holed tank
    expect(parts(w, 1).length).toBe(parts(game().w, 1).length); // every part came with it, still welded
    expect(types(w).has("joint.break")).toBe(false);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-025 the pod is very hard to destroy: a 30 m/s crash into rock and a slug both leave it whole; destroyed, the game is over", () => {
    const crash = game();
    pod(crash.w).position = { x: 12, y: 5 };
    pod(crash.w).velocity = { x: 0, y: -30 };
    settle(crash.w);
    crash.step(1);
    expect(types(crash.w).has("collision")).toBe(true);
    expect(pod(crash.w).integrity).toBe(1);

    // A slug from the ship's own gun, in empty space: the pod 10 m ahead of the muzzle.
    const shot = game("test", (s) => (s.world.gravity = { x: 0, y: 0 }));
    pod(shot.w).position = { x: hull(shot.w).position.x, y: hull(shot.w).position.y + 12 };
    settle(shot.w);
    shot.step(0.4, [set("fire", 1)]);
    expect(types(shot.w).has("railgun.fired")).toBe(true);
    expect(pod(shot.w).velocity.y).toBeGreaterThan(0.1); // it was struck
    expect(pod(shot.w).integrity).toBe(1);

    const gone = game();
    pod(gone.w).integrity = 0;
    gone.step(0.1);
    expect(st(gone.w)).toMatchObject({ phase: "over", reason: "pod", pod: "gone", lives: 5 });
    expect(gone.w.events.filter((e) => e.type === "thrust.over")).toHaveLength(1);
  });

  it("MTH-050 out of fuel costs nothing by itself, but a ship lying still with empty tanks is lost", () => {
    const { w, step } = game();
    moveShip(w, { x: -63, y: 12.6 }); // just over the flat ground
    for (const b of parts(w, 1)) for (const c of b.contents ?? []) c.mass = 0;
    settle(w);
    step(0.5);
    expect(st(w).phase).toBe("flying"); // not at once
    for (let k = 0; k < 25 && st(w).phase === "flying"; k++) step(0.1);
    expect(hull(w)).toBeDefined(); // it set down in one piece
    expect(w.events.filter((e) => e.type === "thrust.lost")).toHaveLength(1);
    expect(st(w).lives).toBe(4);
    // Lost this way too, there are 3 s on screen to watch before the page says so.
    expect(st(w).noteAt! - w.time).toBeGreaterThan(1.3);
    expect(st(w).next! - st(w).noteAt!).toBeCloseTo(1.25, 6);
  });

it("MTH-030 MTH-036 a turret wakes when it sees the ship, waits, then turns its gun to a bearing in its arc and fires; with no ship flying it watches for nothing", () => {
    const { w, step } = game();
    const turret = () => body(w, "t1-carriage")!.turret!;
    const fired = () => w.events.filter((e) => e.type === "turret.fire");
    // At the start the ship is 125 m from the turret: out of its 80 m.
    step(0.2);
    expect(turret().target).toBe("p1-hull");
    expect(turret().sees).toBe(false);
    moveShip(w, { x: 20, y: 30 }); // over the hollow, in plain sight of the ledge
    step(1.4);
    expect(turret().sees).toBe(true);
    expect(fired()).toHaveLength(0); // 1.5 game s (3 on screen) from first sight
    moveShip(w, { x: 20, y: 30 });
    step(1.5);
    expect(fired().length).toBeGreaterThanOrEqual(1);
    for (const f of fired()) expect(Math.abs(Number(f.data.angle))).toBeLessThanOrEqual(Math.PI / 3 + 1e-9);
    expect(w.bodies.some((b) => b.id.startsWith("t1-carriage-shell-"))).toBe(true); // a bolt in flight
    // The ship lost: the turret has nothing to watch for until the next one flies.
    step(2 / 240, [set("destruct", 1)]);
    step(0.1);
    expect(st(w).phase).toBe("between");
    expect(turret().target).toBeUndefined();
    const count = fired().length;
    step(1);
    expect(fired()).toHaveLength(count);
  });

  it("MTH-035 MTH-038 MTH-031 a slug on a turret's fuel tank sets the tank off, and the explosion alone puts the turret out of action: 750, once", () => {
    const { w, step } = game("test", (s) => (s.world.gravity = { x: 0, y: 0 }));
    // The ship upside down 14 m over the tank, its gun pointing down at it.
    const h = hull(w);
    const to = { x: 38 - 2.4, y: 5 + 14 };
    const from = { ...h.position };
    for (const b of parts(w, 1)) {
      b.position = { x: to.x - (b.position.x - from.x), y: to.y - (b.position.y - from.y) };
      b.angle += Math.PI;
    }
    settle(w);
    expect(st(w).turretsOut).toEqual([]);
    step(0.02, [set("fire", 1)]);
    step(0.6, [set("fire", 0)]);
    expect(w.events.filter((e) => e.type === "railgun.fired" && e.data.id === "p1-gun")).toHaveLength(1);
    expect(body(w, "t1-tank")).toBeUndefined();
    expect(w.events.some((e) => e.type === "detonation")).toBe(true);
    expect(turretWorks(w, body(w, "t1-carriage") ?? ({} as never))).toBe(false);
    expect(st(w).turretsOut).toEqual(["t1-carriage"]);
    expect(st(w).score).toBe(750);
    expect(w.events.filter((e) => e.type === "thrust.turret")).toHaveLength(1);
    expect(body(w, "t1-base")).toBeDefined(); // the plate on the rock stays
    step(0.5);
    expect(st(w).score).toBe(750);
    expect(parts(w, 1).length).toBe(parts(game().w, 1).length); // 14 m off, the ship is untouched
  });

  it("MTH-037 a turret whose battery is destroyed is out of action; one whose generator is destroyed fires on from its battery", () => {
    const flat = game();
    body(flat.w, "t1-battery")!.integrity = 0;
    flat.step(0.05);
    expect(st(flat.w).turretsOut).toEqual(["t1-carriage"]);
    const { w, step } = game();
    body(w, "t1-gen")!.integrity = 0;
    moveShip(w, { x: 20, y: 30 });
    step(2);
    expect(st(w).turretsOut).toEqual([]);
    expect(w.events.some((e) => e.type === "turret.fire")).toBe(true);
    expect(body(w, "t1-battery")!.charge!.shots).toBeLessThan(5);
  });

  it("MTH-032 a bolt that bursts 2 m from the ship pushes it measurably and destroys no part of it; the ledger records the gas it makes", () => {
    const { w, step } = game("test", (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
      s.world.thrust.tanks = [];
      s.world.bodies = s.world.bodies.filter((b: { id: string }) => !b.id.startsWith("t1-"));
      s.world.joints = [];
      s.world.links = [];
    });
    const bolt = raw("test").world.bodies.find((b: { id: string }) => b.id === "t1-carriage").magazine.shell;
    expect(bolt.explosive).toMatchObject({ charge: 0.05, gas: 6, radius: 0.6 });
    const h = hull(w).position;
    const welds = w.joints.length;
    const before = parts(w, 1).length;
    // The bolt comes down on a small post 2 m off the right wing's tip (the tip is 2.8 m from the hull's centre).
    step(0.6, [
      { type: "body.add", body: { ...bolt, id: "bolt", position: { x: h.x + 4.8, y: h.y + 5 }, velocity: { x: 0, y: -40 }, angle: 0, angularVelocity: 0, explosive: { ...bolt.explosive, armed: true } } },
      { type: "body.add", body: { id: "post", fixed: true, shape: { kind: "box", width: 0.4, height: 0.4 }, mass: 1, position: { x: h.x + 4.8, y: h.y - 0.4 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 } },
    ] as never);
    expect(w.events.some((e) => e.type === "detonation")).toBe(true);
    const ps = parts(w, 1);
    const m = ps.reduce((sum, b) => sum + b.mass, 0);
    const vx = ps.reduce((sum, b) => sum + b.mass * b.velocity.x, 0) / m;
    expect(vx).toBeLessThan(-0.3); // pushed away from the burst
    expect(vx).toBeGreaterThan(-2);
    expect(ps.length).toBe(before);
    expect(ps.every((b) => b.integrity > 0.9)).toBe(true);
    expect(w.joints.length).toBe(welds);
    expect(w.ledger.violations).toBe(0);
  });

it("MTH-060 the level's rock can be cratered by explosions: a ship destroyed on the ground leaves craters; a slug leaves none, and is spent in the rock", () => {
    const { w, step } = game("test", (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
    });
    expect(w.terrain!.craters).toMatchObject({ blast: 0.6, bullet: 0, least: 1, limit: 250 });
    // The ship upside down 12 m over the flat ground at the start (the ground there is at y = 10).
    const h = hull(w);
    const from = { ...h.position };
    for (const b of parts(w, 1)) {
      b.position = { x: -63 - (b.position.x - from.x), y: 22 - (b.position.y - from.y) };
      b.angle += Math.PI;
    }
    settle(w);
    step(0.02, [set("fire", 1)]);
    step(0.5, [set("fire", 0)]);
    expect(w.events.some((e) => e.type === "railgun.fired")).toBe(true);
    expect(w.terrain!.holes).toHaveLength(0); // no crater for a bullet
    expect(w.bodies.some((b) => b.id.includes("-shell-"))).toBe(false); // but the slug is spent in the rock
    // The ship set down there and destroyed by its pilot: its magazines' blasts (6 m) leave 3.6 m
    // craters. Its tanks', engines' and battery's blasts are too small to leave any.
    for (const b of parts(w, 1)) b.position = { x: b.position.x, y: b.position.y - 9.5 };
    settle(w);
    step(0.1, [set("destruct", 1)]);
    expect(w.events.filter((e) => e.type === "detonation").length).toBeGreaterThan(5);
    expect(w.terrain!.holes.length).toBeGreaterThanOrEqual(1);
    expect(w.terrain!.holes.length).toBeLessThanOrEqual(2);
    for (const c of w.terrain!.holes) expect(c.r).toBeCloseTo(3.6, 6);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-061 a turret whose ground is cut away comes loose: half undermined it tips into the hole, still whole and still watching for the ship; one on a roof falls and breaks", () => {
    const { w, step } = game();
    step(0.2);
    expect(body(w, "t1-base")).toMatchObject({ fixed: true });
    expect(cutCrater(w, { x: 40, y: 3.5 }, 3, TERRAIN_OPS)).toBe(true); // under the right half of the turret on its ledge
    settle(w);
    expect(body(w, "t1-base")).toMatchObject({ fixed: false, mass: 100 });
    step(3);
    expect(body(w, "t1-base")!.position.y).toBeLessThan(4.5); // it was at 5.15
    expect(Math.abs(body(w, "t1-base")!.angle)).toBeGreaterThan(0.5); // tipped into the hole
    expect(w.joints.filter((j) => j.id.startsWith("t1-"))).toHaveLength(12); // nothing broke
    expect(turretWorks(w, body(w, "t1-carriage")!)).toBe(true);
    expect(body(w, "t1-carriage")!.turret!.target).toBe("p1-hull");
    expect(st(w).turretsOut).toEqual([]);
    expect(w.ledger.violations).toBe(0);

    // Level 2's third turret hangs from the left of the chamber's roof, 30 m over the floor.
    const roof = game(2);
    roof.step(0.2);
    const base = body(roof.w, "t3-base")!.position;
    expect(cutCrater(roof.w, { x: base.x, y: base.y + 2 }, 4.5, TERRAIN_OPS)).toBe(true);
    settle(roof.w);
    roof.step(1);
    expect(body(roof.w, "t3-base")!.velocity.y).toBeLessThan(-3); // falling
    roof.step(5);
    expect(body(roof.w, "t3-base")!.position.y).toBeLessThan(-25); // on the floor
    expect(st(roof.w).turretsOut).toEqual(["t3-breech"]); // broken by the fall: out of action
    expect(st(roof.w).score).toBe(750);
  });

  it("MTH-061 the pod's stand comes loose with its ground, and the pod with it: loose, not lost", () => {
    const { w, step } = game();
    step(0.2);
    expect(cutCrater(w, { x: 12, y: -10 }, 2.5, TERRAIN_OPS)).toBe(true); // under the stand
    settle(w);
    for (const id of ["stand", "stand-l", "stand-r"]) expect(body(w, id)!.fixed).toBe(false);
    step(3);
    expect(body(w, "stand")!.position.y).toBeLessThan(-9); // down in the crater (it was at -7.85)
    expect(pod(w).position.y).toBeLessThan(st(w).stand.y - 1);
    expect(st(w)).toMatchObject({ pod: "loose", phase: "flying" });
    expect(pod(w).integrity).toBe(1);
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-062 an engine knocked off the ship no longer answers the controls: it burns out what it holds and is dead, and its tank leaks; a gun knocked off doesn't fire", () => {
    const { w, step } = game("test", (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
    });
    step(0.2);
    // The left back thruster comes off its wing (its weld to the tank is cut), and drifts clear.
    const loose = new Set(["p1-back-l", "p1-back-l-wall-a", "p1-back-l-wall-b"]);
    w.joints = w.joints.filter((j) => loose.has(j.a) === loose.has(j.b));
    for (const b of w.bodies) if (loose.has(b.id)) b.velocity = { x: -3, y: -3 };
    settle(w);
    step(0.1);
    const engine = body(w, "p1-back-l")!;
    // Its fuel line is cut and its control is no longer the pilot's.
    expect(w.links.some((l) => l.kind === "feed" && l.to === "p1-back-l")).toBe(false);
    expect(w.links.some((l) => l.kind === "control" && l.to === "p1-back-l" && l.channel === "bl")).toBe(false);
    expect(w.events.some((e) => e.type === "thrust.line")).toBe(true);
    expect(body(w, "p1-tank-l")!.integrity).toBeLessThan(1); // the tank leaks where the line left it
    // It burns off what is left in it, on a channel of its own, and is then dead: holding "right"
    // (which fires that thruster on a whole ship) feeds it nothing and lights nothing in it.
    expect(engine.injector!.channel).toBe("p1-back-l.residual");
    step(1.5);
    const held = () => engine.contents!.reduce((m, c) => m + c.mass, 0);
    expect(held()).toBeLessThan(1e-6);
    const lit = () => w.events.filter((e) => e.type === "ignition" && e.data.id === "p1-back-l").length;
    const before = lit();
    step(1, [set("right", 1)]);
    expect(w.controls.bl).toBe(1); // the pilot is asking for it
    expect(held()).toBeLessThan(1e-6);
    expect(lit()).toBe(before);
    expect(body(w, "p1-front-r")!.contents!.reduce((m, c) => m + c.mass, 0)).toBeGreaterThan(0); // the thrusters still on the ship do fire
    step(0.02, [set("right", 0)]);
    // The gun knocked off: the fire control no longer reaches it.
    w.joints = w.joints.filter((j) => j.a !== "p1-gun" && j.b !== "p1-gun");
    body(w, "p1-gun")!.velocity = { x: 0, y: 4 };
    settle(w);
    step(0.1);
    const fired = w.events.filter((e) => e.type === "railgun.fired").length;
    step(0.6, [set("fire", 1)]);
    expect(w.events.filter((e) => e.type === "railgun.fired")).toHaveLength(fired);
    expect(st(w).phase).toBe("flying"); // the ship itself flies on
  });

  it("the score and ships left carry over from the level before", () => {
    const { w } = game(2, (s) => (s.world.thrust.carry = { score: 3530, lives: 2 }));
    expect(st(w)).toMatchObject({ score: 3530, lives: 2, phase: "flying" });
  });

  it("DET-001 the same flight twice gives the same world", () => {
    const fly = () => {
      const { w, step } = withPod(2);
      step(0.5, [set("left", 1), set("right", 1)]);
      step(0.3, [set("right", 0), set("fire", 1)]);
      step(0.4, [set("left", 0), set("reverse", 1)]);
      return hashValue(w);
    };
    expect(fly()).toBe(fly());
  });

  it("SCN-002 a malformed game is refused with the path of each fault", () => {
    const bad = raw(1);
    Object.assign(bad.world.thrust, { hull: "hull", tractor: "p{n}-nothing", start: { x: 0, y: 500 }, pod: "nope", lives: 0, scores: 3, turrets: ["pod"], carry: { score: -1, lives: 0 }, view: { colour: "", pitch: 0, sky: [], caves: [[]] } });
    let paths: string[] = [];
    try {
      parseScenario(bad);
    } catch (e) {
      paths = (e as ScenarioError).errors.map((i) => i.path);
    }
    for (const p of ["hull", "tractor", "start", "pod", "lives", "scores", "turrets[0]", "carry.score", "carry.lives", "view.colour", "view.pitch", "view.sky", "view.caves[0]"]) expect(paths).toContain(`$.world.thrust.${p}`);
    const none = raw(1);
    none.world.thrust = 1;
    expect(() => parseScenario(none)).toThrow(ScenarioError);
  });
  /** The ship at rest `up` m over a body, with no gravity, its tanks holding `share` of a full load. */
  function over(id: string, share: number, up = 12, n: number | "test" = "test") {
    const g = game(n, (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
    });
    const b = body(g.w, id)!;
    for (const t of ["p1-tank-l", "p1-tank-r"]) for (const c of body(g.w, t)!.contents!) c.mass = c.capacity * share;
    moveShip(g.w, { x: b.position.x, y: b.position.y + up });
    return g;
  }
  const holds = (w: World, id: string) => (body(w, id)?.contents ?? []).reduce((m, c) => m + c.mass, 0);

  it("MTH-042 holding the beam on a fuel tank moves its fuel to the ship, the tank where it stood; emptied, it scores 300 once", () => {
    for (const n of [1, 2]) expect(raw(n).world.thrust.tanks.filter((id: string) => id.startsWith("fuel-")).length).toBeGreaterThan(0);
    // The ship's tanks empty: they hold 8.1 kg, as much as the fuel tank.
    const { w, step } = over("fuel-1", 0);
    const mass = computeTotals(w).mass;
    const at = { ...body(w, "fuel-1")!.position };
    const before = thrustFuel(w).mass;
    expect(holds(w, "fuel-1")).toBeCloseTo(8.1, 6);
    step(2, [set("tractor", 1)]);
    // 2 kg a game second (the ship burns a little of it as it comes).
    expect(thrustFuel(w).mass - before).toBeGreaterThan(3.5);
    expect(holds(w, "fuel-1")).toBeCloseTo(4.1, 1);
    expect(hull(w).tractor!.siphoning).toBe("fuel-1");
    expect(st(w).score).toBe(0);
    // Let go, nothing moves.
    step(1, [set("tractor", 0)]);
    expect(holds(w, "fuel-1")).toBeCloseTo(4.1, 1);
    step(3, [set("tractor", 1)]);
    expect(holds(w, "fuel-1")).toBeCloseTo(0, 6);
    expect(thrustFuel(w).mass - before).toBeGreaterThan(7);
    expect(w.ledger.violations).toBe(0);
    expect(st(w).score).toBe(THRUST_SCORES.tank);
    expect(THRUST_SCORES.tank).toBe(300);
    expect(w.events.filter((e) => e.type === "thrust.tank")).toHaveLength(1);
    expect(body(w, "fuel-1")!.position).toEqual(at);
    expect(computeTotals(w).mass).toBeCloseTo(mass, 6);
    step(1);
    expect(st(w).score).toBe(300);
  });

  it("MTH-042 a full ship takes nothing, and a tank emptied some other way scores nothing", () => {
    const { w, step } = over("fuel-1", 1);
    step(2, [set("tractor", 1)]);
    // Only what the ship burns in that time is made up.
    expect(thrustFuel(w).mass).toBeCloseTo(thrustFuel(w).capacity, 2);
    expect(holds(w, "fuel-1")).toBeGreaterThan(7.5);
    const other = over("fuel-1", 1);
    for (const c of body(other.w, "fuel-1")!.contents!) c.mass = 0;
    settle(other.w);
    other.step(0.5);
    expect(st(other.w).score).toBe(0);
  });

  it("MTH-038 a turret's fuel tank gives up its fuel to the beam too, and the turret then has only its battery", () => {
    const { w, step } = over("t1-tank", 0);
    // The beam pulls the turret's other pieces too (TRC-013), and they drag the ship down onto it:
    // here only the siphon is under test, so the beam pulls the pod alone.
    hull(w).tractor!.pullAny = false;
    const held = holds(w, "t1-tank");
    expect(held).toBeGreaterThan(1);
    step(6, [set("tractor", 1)]);
    expect(holds(w, "t1-tank")).toBeCloseTo(0, 6);
    expect(st(w).score).toBe(300);
    expect(body(w, "t1-tank")!.explosive).toBeUndefined();
  });

  it("MTH-043 a destroyed fuel tank explodes with what it still holds: a full charge full, half half drained, none empty", () => {
    const full = over("fuel-1", 0.25);
    const charge = body(full.w, "fuel-1")!.explosive!.charge;
    full.step(2, [set("tractor", 1)]);
    expect(body(full.w, "fuel-1")!.explosive!.charge / charge).toBeCloseTo(4.1 / 8.1, 1);
    full.step(0.1, [set("tractor", 0)]);
    body(full.w, "fuel-1")!.integrity = 0;
    full.step(0.1);
    expect(body(full.w, "fuel-1")).toBeUndefined();
    expect(full.w.events.some((e) => e.type === "detonation")).toBe(true);
    // Emptied first, it only breaks.
    const empty = over("fuel-1", 0);
    empty.step(5, [set("tractor", 1)]);
    expect(body(empty.w, "fuel-1")!.explosive).toBeUndefined();
    body(empty.w, "fuel-1")!.integrity = 0;
    empty.step(0.1, [set("tractor", 0)]);
    expect(empty.w.events.some((e) => e.type === "detonation")).toBe(false);
  });
  /** Level 4 with every turret off, after `settle` game seconds. */
  function cave(settle = 0.5) {
    const g = game(4);
    for (const b of g.w.bodies) if (b.turret) b.turret.enabled = false;
    g.step(settle);
    return g;
  }
  /** Where a slug comes from at each part of turret 6 or 5, in the turret's frame: the side of it that faces the open. */
  const FROM: Record<string, [number, number]> = { barrel: [1, 0.15], breech: [1, 0.1], arc: [0.3, 1], "node-r": [1, 0.25], "node-l": [-1, 0.25] };
  /** A slug from the ship's gun, as fired, 3 m off part `part` of turret `k` and flying straight at it. */
  function slugAt(w: World, k: number, part: string, n: number): void {
    const t = body(w, `t${k}-${part}`)!.position;
    const a = body(w, `t${k}-base`)!.angle;
    const [dx, dy] = FROM[part];
    const L = Math.hypot(dx, dy);
    const u = { x: (Math.cos(a) * dx - Math.sin(a) * dy) / L, y: (Math.sin(a) * dx + Math.cos(a) * dy) / L };
    const shell = structuredClone(body(w, "p1-gun")!.magazine!.shell) as Record<string, unknown>;
    addBody(w, { ...shell, id: `p1-shell-t${n}`, position: { x: t.x + 3 * u.x, y: t.y + 3 * u.y }, velocity: { x: -144 * u.x, y: -144 * u.y }, angle: 0, angularVelocity: 0 } as never);
    settle(w);
  }

  it("MTH-092 level 3 is Chloe's canyon: eight electric turrets, the power plant on the left ledge and its line across the canyon to the four on the right, four fuel tanks and the pod on its pillar; nothing moves as it starts", () => {
    const s = raw(3);
    expect(s.world.thrust.title ?? s.title).toContain("canyon");
    expect(s.world.thrust.view.caves).toHaveLength(1);
    expect(s.world.thrust.turrets).toHaveLength(8);
    expect(s.world.thrust.tanks).toEqual(["fuel-1", "fuel-2", "fuel-3", "fuel-4"]);
    const plant = s.world.thrust.plant;
    expect(plant.turrets.filter((t: { needs?: string[] }) => t.needs?.includes("tx")).map((t: { id: string }) => t.id)).toEqual(["t1-breech", "t3-breech", "t4-breech", "t5-breech"]);
    const g = game(3);
    const { w } = g;
    expect(pod(w).position.y).toBeLessThan(-110);
    const hanging = [1, 2, 3, 4, 5, 6, 7, 8].filter((k) => Math.cos(body(w, `t${k}-base`)!.angle) < 0);
    expect(hanging).toEqual([2, 5, 6]);
    expect(st(w).plant!.up.tx).toBe(true);
    const at = new Map(w.bodies.map((b) => [b.id, { ...b.position }]));
    for (const b of w.bodies) if (b.turret) b.turret.enabled = false;
    g.step(3);
    const moved = (id: string) => Math.hypot(body(w, id)!.position.x - at.get(id)!.x, body(w, id)!.position.y - at.get(id)!.y);
    for (let k = 1; k <= 8; k++) for (const part of ["arc", "node-l", "node-r", "breech", "barrel"]) expect(moved(`t${k}-${part}`), `t${k}-${part}`).toBeLessThan(0.1);
    for (let k = 1; k <= 4; k++) expect(moved(`fuel-${k}`), `fuel-${k}`).toBeLessThan(0.05);
    for (const id of ["pod", "plant-core", "plant-tower", "aerial-1-mast", "aerial-2-mast"]) expect(moved(id), id).toBeLessThan(0.05);
    expect(st(w).phase).toBe("flying");
    expect(w.ledger.violations).toBe(0);
  });

  it("MTH-014 level 4 is Chloe's winding cave: six electric turrets, three fuel tanks and the pod 130 m down, and nothing moves as it starts", () => {
    const s = raw(4);
    expect(s.world.thrust.view.caves).toHaveLength(1);
    expect(s.world.thrust.turrets).toHaveLength(6);
    expect(s.world.thrust.tanks).toEqual(["fuel-1", "fuel-2", "fuel-3"]);
    const { w } = game(4);
    expect(pod(w).position.y).toBeLessThan(-125);
    // Two hang from the rock: one on the right wall, one from the roof.
    const hanging = [1, 2, 3, 4, 5, 6].filter((k) => Math.cos(body(w, `t${k}-base`)!.angle) < 0);
    expect(hanging).toEqual([4, 5]);
    const at = new Map(w.bodies.map((b) => [b.id, { ...b.position }]));
    const { w: after } = cave(3);
    for (const k of [1, 2, 3, 4, 5, 6])
      for (const part of ["arc", "node-l", "node-r", "breech", "barrel"]) {
        const p = body(after, `t${k}-${part}`)!.position;
        // (The barrel hanging from the right wall sags 5 cm under its bolts.)
        expect(Math.hypot(p.x - at.get(`t${k}-${part}`)!.x, p.y - at.get(`t${k}-${part}`)!.y), `t${k}-${part}`).toBeLessThan(0.1);
      }
    for (const k of [1, 2, 3]) expect(Math.hypot(body(after, `fuel-${k}`)!.position.x - at.get(`fuel-${k}`)!.x, body(after, `fuel-${k}`)!.position.y - at.get(`fuel-${k}`)!.y)).toBeLessThan(0.05);
    expect(after.ledger.violations).toBe(0);
  });

  it("MTH-070 an electric turret is a base, an arc, two power nodes and a two-part barrel that rides the arc; it needs no power, and fires at the ship", () => {
    const { w, step } = game(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
    for (const k of [1, 2, 3, 4, 5, 6]) {
      for (const part of ["base", "arc", "node-l", "node-r", "breech", "barrel"]) expect(body(w, `t${k}-${part}`), `t${k}-${part}`).toBeDefined();
      for (const part of ["battery", "gen", "tank"]) expect(body(w, `t${k}-${part}`)).toBeUndefined();
      expect(body(w, `t${k}-base`)!.fixed).toBe(true);
      expect(body(w, `t${k}-breech`)!.turret!.battery).toBeUndefined();
      expect(turretWorks(w, body(w, `t${k}-breech`)!)).toBe(true);
    }
    // The barrel turns about the arc's centre: its root stays on the arc as it swings 0.8 rad.
    const pivot = w.joints.find((j) => j.id === "t6-w-pivot")!;
    const arc = body(w, "t6-arc")!;
    const c = Math.cos(arc.angle);
    const s = Math.sin(arc.angle);
    const centre = { x: arc.position.x + c * pivot.anchorA.x - s * pivot.anchorA.y, y: arc.position.y + s * pivot.anchorA.x + c * pivot.anchorA.y };
    const radius = () => Math.hypot(body(w, "t6-breech")!.position.x - centre.x, body(w, "t6-breech")!.position.y - centre.y);
    const r0 = radius();
    body(w, "t6-breech")!.turret!.enabled = false;
    pivot.turn!.target = 0.8;
    step(2);
    expect(body(w, "t6-breech")!.angle - body(w, "t6-base")!.angle).toBeCloseTo(0.8, 1);
    expect(radius()).toBeCloseTo(r0, 1);
    // With the ship in sight, 21 m over it, it fires.
    body(w, "t6-breech")!.turret!.enabled = true;
    moveShip(w, { x: 37.6, y: -110 });
    step(6);
    expect(w.events.some((e) => e.type === "railgun.fired" && e.data.id === "t6-breech")).toBe(true);
    expect(body(w, "t6-breech")!.magazine!.count).toBeLessThan(40);
  });

  // On the floor (6) and hanging from the roof (5). Twelve short runs each: given time on a slow machine.
  it.each([6, 5])("MTH-071 one slug on the barrel or a power node puts electric turret %i out of action, the node with a blast; the arc takes two", (k) => {
    {
      const hits = (part: string, n = 1) => {
        const g = cave();
        for (let i = 0; i < n; i++) {
          slugAt(g.w, k, part, i);
          g.step(0.5);
        }
        g.step(1.5);
        const breech = body(g.w, `t${k}-breech`);
        expect(g.w.ledger.violations).toBe(0);
        return { works: !!breech && turretWorks(g.w, breech), w: g.w };
      };
      // The barrel: knocked off at its weld, or destroyed; the breech destroyed.
      expect(hits("barrel").works, `t${k} barrel`).toBe(false);
      expect(hits("breech").works, `t${k} breech`).toBe(false);
      // The arc: one slug damages it, two destroy it.
      const once = hits("arc");
      expect(once.works, `t${k} arc once`).toBe(true);
      expect(body(once.w, `t${k}-arc`)!.integrity).toBeLessThan(0.5);
      const twice = hits("arc", 2);
      expect(body(twice.w, `t${k}-arc`), `t${k} arc twice`).toBeUndefined();
      expect(twice.works).toBe(false);
      // A power node, either: it goes up, and its blast alone wrecks the turret, which scores.
      for (const side of ["node-l", "node-r"]) {
        const node = hits(side);
        expect(node.w.events.some((e) => e.type === "detonation"), `t${k} ${side}`).toBe(true);
        expect(node.works, `t${k} ${side}`).toBe(false);
        expect(st(node.w).turretsOut).toContain(`t${k}-breech`);
        expect(st(node.w).score).toBeGreaterThanOrEqual(THRUST_SCORES.turret);
      }
    }
  }, 120_000);


  it("WPN-012 an electric turret is online only while on, powered and whole: its nodes, aim, barrel and gun", () => {
    const fresh = () => {
      const { w } = game(4);
      return { w, breech: body(w, "t6-breech")! };
    };
    expect(fresh().breech.turret!.nodes).toEqual(["t6-node-l", "t6-node-r"]);
    let g = fresh();
    expect(turretOnline(g.w, g.breech)).toBe(true);
    g.breech.turret!.powered = false;
    expect(turretOnline(g.w, g.breech)).toBe(false);
    g = fresh();
    g.breech.turret!.enabled = false;
    expect(turretOnline(g.w, g.breech)).toBe(false);
    // A node destroyed, or knocked off its base.
    g = fresh();
    body(g.w, "t6-node-r")!.integrity = 0;
    expect(turretOnline(g.w, g.breech)).toBe(false);
    g = fresh();
    g.w.joints = g.w.joints.filter((j) => j.id !== "t6-w-node-l");
    expect(turretOnline(g.w, g.breech)).toBe(false);
    // Its aim can't turn: the pivot damaged past turning.
    g = fresh();
    g.w.joints.find((j) => j.id === "t6-w-pivot")!.integrity = 0.2;
    expect(turretOnline(g.w, g.breech)).toBe(false);
    // Its barrel lost; its gun destroyed.
    g = fresh();
    g.w.joints = g.w.joints.filter((j) => j.id !== "t6-w-barrel");
    expect(turretOnline(g.w, g.breech)).toBe(false);
    g = fresh();
    g.breech.integrity = 0;
    expect(turretOnline(g.w, g.breech)).toBe(false);
  });

  // ---- The power plant (level 4, the winding cave) ----
  const plantState = (w: World) => st(w).plant!;
  const poweredTurrets = (w: World) => w.bodies.filter((b) => b.turret).map((b) => `${b.id.split("-")[0]}:${b.turret!.powered ? "on" : "off"}`).join(" ");
  /** A slug from the ship's gun at `at`, from 6 m off along (-1, 1): the plant's left and top face the open. */
  function slugAtPoint(w: World, at: { x: number; y: number }, n: number, from = { x: -6, y: 6 }): void {
    const shell = structuredClone(body(w, "p1-gun")!.magazine!.shell) as Record<string, unknown>;
    const L = Math.hypot(from.x, from.y);
    addBody(w, { ...shell, id: `p1-gun-shell-t${n}`, position: { x: at.x + from.x, y: at.y + from.y }, velocity: { x: (-144 * from.x) / L, y: (-144 * from.y) / L }, angle: 0, angularVelocity: 0 } as never);
    settle(w);
  }

  it("MTH-080 WPN-011 the power plant powers the level's turrets; a slug takes it offline 10 s on screen, each more while it is down 4 s more, and the turrets stop meanwhile", () => {
    const { w, step } = game(4);
    step(0.5);
    expect(plantState(w)).toMatchObject({ hits: 0, holes: 0, up: { tx: true } });
    expect(poweredTurrets(w)).toBe("t1:on t2:on t3:on t4:on t5:on t6:on");
    // The tower: a hit, but no hole.
    const tower = body(w, "plant-tower")!;
    slugAtPoint(w, { x: tower.position.x, y: tower.position.y + 4 }, 1, { x: 0, y: 6 });
    step(0.2);
    expect(plantState(w)).toMatchObject({ hits: 1, holes: 0 });
    const first = plantState(w).offlineUntil;
    const hitAt = w.events.find((e) => e.type === "plant.hit")!.tick / 240;
    expect(first - hitAt).toBeCloseTo(5, 1); // 10 s on screen
    expect(poweredTurrets(w)).toBe("t1:off t2:off t3:off t4:off t5:off t6:off");
    w.bodies = w.bodies.filter((b) => b.id !== "p1-gun-shell-t1"); // out of the way of the next
    settle(w);
    slugAtPoint(w, { x: tower.position.x, y: tower.position.y + 4 }, 2, { x: 0, y: 6 });
    step(0.2);
    expect(plantState(w).offlineUntil - first).toBeCloseTo(2, 6); // 4 s more on screen
    step(first + 2 - w.time + 0.1);
    expect(poweredTurrets(w)).toBe("t1:on t2:on t3:on t4:on t5:on t6:on");
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("MTH-081 DMG-009 slugs in the domes leak the coolant as gas: each adds 0.1 kg/s, 4 minutes for one on screen; every third opens a new leak, the others make the newest bigger", () => {
    const { w, step } = game(4);
    const spec = w.thrust!.spec.plant!;
    expect(plantCoolant(w, spec)).toBeCloseTo(12, 9);
    const leaks = () => spec.domes.flatMap((id) => body(w, id)!.vents!.holes.map((h) => h.size ?? 1));
    /** The coolant lost over 2 game seconds, kg/s. */
    const rate = () => {
      const c0 = plantCoolant(w, spec);
      step(2);
      return (c0 - plantCoolant(w, spec)) / 2;
    };
    // Six slugs, each on its own spot along the domes' left sides and tops.
    const spots = ["plant-dome-l", "plant-core", "plant-dome-r"].flatMap((id) => {
      const d = body(w, id)!.position;
      return [{ x: d.x - 2.7, y: d.y }, { x: d.x - 1, y: d.y + 4.2 }];
    });
    const hit = (k: number) => {
      slugAtPoint(w, spots[k], k);
      step(0.3);
    };
    hit(0);
    expect(leaks()).toEqual([1]);
    // 12 kg at 0.1 kg/s: 120 game seconds, 4 minutes on screen.
    expect(rate()).toBeCloseTo(0.1, 2);
    hit(1);
    hit(2);
    expect(plantState(w).holes).toBe(1);
    expect(leaks()).toEqual([3]);
    expect(rate()).toBeCloseTo(0.3, 2);
    hit(3);
    expect(leaks().sort()).toEqual([1, 3]);
    expect(plantState(w).holes).toBe(2);
    expect(rate()).toBeCloseTo(0.4, 2);
    expect(w.events.some((e) => e.type === "vent")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("MTH-081 a leak's gas pushes what is in it: a body held in the jet is pushed away from the dome", () => {
    const { w, step } = game(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
    const dome = body(w, "plant-dome-l")!;
    slugAtPoint(w, { x: dome.position.x - 2.7, y: dome.position.y }, 0);
    step(0.3);
    for (let k = 1; k < 3; k++) {
      slugAtPoint(w, { x: dome.position.x - 1, y: dome.position.y + 4.2 }, k, { x: -6 + k, y: 6 });
      step(0.3);
    }
    expect(plantState(w).holes).toBe(1);
    // A crate 3 m out in front of the leak.
    const hole = dome.vents!.holes[0];
    const out = { x: dome.position.x + hole.point.x + 3 * hole.normal.x, y: dome.position.y + hole.point.y + 3 * hole.normal.y };
    addBody(w, { id: "crate", shape: { kind: "box", width: 1, height: 1 }, mass: 5, position: out, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.5 } as never);
    settle(w);
    step(1.5);
    const v = body(w, "crate")!.velocity;
    expect(v.x * hole.normal.x + v.y * hole.normal.y).toBeGreaterThan(0.05);
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("MTH-082 with no coolant left the plant goes critical: 10 s on screen, then it blows; with the pod still down the game is over", () => {
    const { w, step } = game(4);
    step(0.2);
    body(w, "plant-core")!.contents![0].mass = 0.001;
    settle(w);
    step(0.1);
    const at = plantState(w).critical!;
    expect(at - w.time).toBeGreaterThan(4.8);
    expect(poweredTurrets(w)).toBe("t1:off t2:off t3:off t4:off t5:off t6:off");
    step(at - w.time - 0.2);
    expect(st(w).phase).toBe("flying");
    step(0.4);
    expect(plantState(w).blown).toBe(true);
    expect(st(w)).toMatchObject({ phase: "over", reason: "plant" });
    expect(w.events.some((e) => e.type === "detonation")).toBe(true);
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("MTH-082 out with the pod while the plant is critical: 2000 more", () => {
    const g = withPod(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
    expect(st(g.w).pod).toBe("tether");
    body(g.w, "plant-core")!.contents![0].mass = 0.001;
    settle(g.w);
    g.step(0.1);
    expect(plantState(g.w).critical).toBeDefined();
    // Ship and pod lifted together past the top.
    const d = { x: 0, y: g.w.thrust!.spec.top + 5 - hull(g.w).position.y };
    for (const b of g.w.bodies) if (b.id.startsWith("p1-") || b.id === "pod") b.position = { x: b.position.x + d.x, y: b.position.y + d.y };
    settle(g.w);
    g.step(0.1);
    expect(st(g.w).phase).toBe("won");
    expect(st(g.w).bonus!.plant).toBe(2000);
  }, 60_000);

  it("MTH-083 the antennae carry the power across the cave: one destroyed, the turret beyond them (the left ledge's) has no power, and the rest do", () => {
    const { w, step } = game(4);
    step(0.2);
    expect(plantState(w).up.tx).toBe(true);
    const mast = body(w, "aerial-1-mast")!;
    slugAtPoint(w, { x: mast.position.x, y: mast.position.y }, 1, { x: 0, y: 5 });
    step(0.5);
    expect(body(w, "aerial-1-mast")?.integrity ?? 0).toBeLessThanOrEqual(0);
    expect(plantState(w).up.tx).toBe(false);
    expect(poweredTurrets(w)).toBe("t1:on t2:on t3:off t4:on t5:on t6:on");
    expect(w.ledger.violations).toBe(0);
  }, 60_000);

  it("MTH-084 ASM-009 a ship in the shock between the antennae loses all control for 1 s on screen; with the antennae down there is no shock", () => {
    const fly = (down: boolean) => {
      const { w, step } = game(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
      step(0.1);
      const [a, b] = transmitterTips(w, w.thrust!.spec.plant!.transmitters[0])!;
      if (down) {
        body(w, "aerial-2-mast")!.integrity = 0;
        step(0.1);
      }
      moveShip(w, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      step(0.02, [set("left", 1), set("right", 1)]);
      const links = () => w.links.filter((l) => l.kind === "control" && l.to.startsWith("p1-")).map((l) => (l.off ? 0 : 1));
      return { w, step, links };
    };
    const shocked = fly(false);
    expect(shocked.w.events.filter((e) => e.type === "plant.shock")).toHaveLength(1);
    expect(shocked.links().every((k) => k === 0)).toBe(true);
    // Keys held, nothing fires: it doesn't move.
    shocked.step(0.4);
    expect(Math.hypot(hull(shocked.w).velocity.x, hull(shocked.w).velocity.y)).toBeLessThan(0.2);
    // Out of the shock, after half a game second (1 s on screen) the controls come back and the engines fire.
    const at = hull(shocked.w).position;
    moveShip(shocked.w, { x: at.x, y: at.y + 10 });
    shocked.step(0.2);
    expect(shocked.links().every((k) => k === 1)).toBe(true);
    shocked.step(1);
    expect(hull(shocked.w).velocity.y).toBeGreaterThan(0.5);
    expect(shocked.w.events.filter((e) => e.type === "plant.shock")).toHaveLength(1);
    const free = fly(true);
    expect(free.w.events.some((e) => e.type === "plant.shock")).toBe(false);
    expect(free.links().every((k) => k === 1)).toBe(true);
  }, 60_000);
  it("MTH-084 a piece the ship has lost, lying in the shock, doesn't shock the ship elsewhere", () => {
    const { w, step } = game(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
    step(0.1);
    const [a, b] = transmitterTips(w, w.thrust!.spec.plant!.transmitters[0])!;
    // The left tank's front thruster, broken off and put in the beam; the ship well clear of it.
    const lost = body(w, "p1-front-l")!;
    w.joints = w.joints.filter((j) => j.a !== lost.id && j.b !== lost.id);
    moveShip(w, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 10 });
    lost.position = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    lost.velocity = { x: 0, y: 0 };
    step(0.3);
    expect(w.events.some((e) => e.type === "plant.shock")).toBe(false);
    // The ship itself in the beam still is.
    moveShip(w, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    step(0.05);
    expect(w.events.filter((e) => e.type === "plant.shock")).toHaveLength(1);
  }, 60_000);
  it("MTH-084 a ship with its shield up passes through the shock; with it down it is shocked", () => {
    const fly = (shield: boolean) => {
      const { w, step } = game(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
      step(0.1);
      const [a, b] = transmitterTips(w, w.thrust!.spec.plant!.transmitters[0])!;
      moveShip(w, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 10 });
      if (shield) step(0.3, [set("shield", 1)]);
      moveShip(w, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      step(0.2);
      return w;
    };
    const up = fly(true);
    expect(up.bodies.some((b) => b.id === "p1-shield-field")).toBe(true);
    expect(up.events.some((e) => e.type === "plant.shock")).toBe(false);
    expect(fly(false).events.some((e) => e.type === "plant.shock")).toBe(true);
  }, 60_000);
  it("MTH-102 debris striking a dome hard enough punches a leak in it and knocks the plant offline; gently, nothing", () => {
    const knock = (v: number) => {
      const { w, step } = game(4, (s) => (s.world.gravity = { x: 0, y: 0 }));
      step(0.1);
      const dome = body(w, "plant-dome-l")!;
      const holes = dome.vents!.holes.length;
      addBody(w, { id: "junk", shape: { kind: "box", width: 0.8, height: 0.15 }, mass: 0.6, position: { x: dome.position.x - 5.7, y: dome.position.y + 1 }, velocity: { x: v, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.3, material: { name: "hull", threshold: 150, toughness: 3000 } } as never);
      settle(w);
      step(1);
      return { leaks: body(w, "plant-dome-l")!.vents!.holes.length - holes, knocks: w.events.filter((e) => e.type === "plant.knock").length, offline: plantState(w).offlineUntil > w.time, w };
    };
    const soft = knock(20);
    expect(soft.leaks).toBe(0);
    expect(soft.knocks).toBe(0);
    const hard = knock(40);
    expect(hard.knocks).toBe(1);
    expect(hard.leaks).toBe(1);
    expect(hard.offline).toBe(true);
    expect(hard.w.ledger.violations).toBe(0);
    // Hard enough to destroy the debris: it still holes the dome (taken before the debris leaves the world).
    const smashed = knock(200);
    expect(smashed.w.bodies.some((b) => b.id === "junk")).toBe(false);
    expect(smashed.knocks).toBe(1);
    expect(smashed.leaks).toBe(1);
    expect(smashed.w.ledger.violations).toBe(0);
  }, 60_000);
  it("MTH-088 an explosion that reaches a dome punches several leaks in it, more the nearer it went off, and knocks the plant offline", () => {
    const blast = (gap: number) => {
      const { w, step } = game(4);
      step(0.2);
      const dome = body(w, "plant-dome-l")!;
      // A charge as a fuel tank's (0.3 kg, reach 4 m), `gap` m off the dome's left side, set off.
      addBody(w, { id: "bomb", shape: { kind: "box", width: 0.4, height: 0.4 }, mass: 1, position: { x: dome.position.x - 2.7 - gap - 0.2, y: dome.position.y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.5, explosive: { charge: 0.3, arm: 1e6, fragments: 0, radius: 4, trigger: true } } as never);
      settle(w);
      step(0.1);
      expect(w.events.some((e) => e.type === "detonation" && e.data.id === "bomb")).toBe(true);
      return { w, leaks: dome.vents!.holes.length, off: plantState(w).offlineUntil > w.time };
    };
    const close = blast(0.3);
    expect(close.leaks).toBe(3);
    expect(close.off).toBe(true);
    expect(close.w.events.filter((e) => e.type === "plant.blast")).toHaveLength(1);
    const further = blast(2.5);
    expect(further.leaks).toBeGreaterThanOrEqual(1);
    expect(further.leaks).toBeLessThan(3);
    // Out of its reach: nothing.
    const far = blast(6);
    expect(far.leaks).toBe(0);
    expect(far.off).toBe(false);
    for (const r of [close, further, far]) expect(r.w.ledger.violations).toBe(0);
  }, 60_000);

  it("MTH-101 level 6 is Chloe's warren: eighteen electric turrets, six fuel tanks, the plant on the lower shelf and six transmitters; the roof's turrets need one of three links and then one of three more; nothing moves as it starts", () => {
    const s = raw(6);
    expect(s.world.thrust.turrets).toHaveLength(18);
    expect(s.world.thrust.tanks).toHaveLength(6);
    expect(s.world.thrust.plant.transmitters).toHaveLength(6);
    const { w, step } = game(6);
    step(0.1);
    expect(w.bodies.filter((b) => b.turret).every((b) => b.turret!.powered)).toBe(true);
    const needs = new Map<string, string[]>(s.world.thrust.plant.turrets.map((t: { id: string; needs?: string[] }) => [t.id, t.needs ?? []]));
    const roof = [...needs].filter(([, n]) => n.length === 2).map(([id]) => id);
    const middle = [...needs].filter(([, n]) => n.length === 1).map(([id]) => id);
    expect(roof).toHaveLength(6);
    expect(middle).toHaveLength(7);
    // The three links from the lower shelf down: the middle shelf and the roof go dark; the rest don't.
    w.bodies = w.bodies.filter((b) => !/^aerial-(5|6|7|8|9|10)-/.test(b.id));
    settle(w);
    step(0.1);
    for (const b of w.bodies.filter((x) => x.turret)) expect(b.turret!.powered, b.id).toBe(needs.get(b.id)!.length === 0);
    // Settled, with every turret off, nothing on the rock moves.
    const g = game(6);
    for (const b of g.w.bodies) if (b.turret) b.turret.enabled = false;
    const at = new Map(g.w.bodies.map((b) => [b.id, { ...b.position }]));
    g.step(3);
    for (const b of g.w.bodies.filter((x) => /^(t\d|fuel|pod|stand|plant|aerial)/.test(x.id)))
      expect(Math.hypot(b.position.x - at.get(b.id)!.x, b.position.y - at.get(b.id)!.y), b.id).toBeLessThan(/barrel|breech/.test(b.id) ? 0.2 : 0.1);
    expect(g.w.ledger.violations).toBe(0);
  }, 120_000);

  it("MTH-099 WPN-014 no turret fires within 10° of a bearing whose bolt would land on the plant: every level's bearings are worked out and set", () => {
    for (const n of [3, 4, 5, 6]) {
      const s = raw(n);
      const w = initialWorld(parseScenario(s));
      const parts = w.thrust!.spec.plant!.parts;
      for (const c of w.bodies.filter((b) => b.turret)) {
        // The scenario carries what the bolts' flights give now.
        expect(c.turret!.avoid ?? [], `level ${n} ${c.id}`).toEqual(bearingsOnto(w, c, parts, { margin: (10 * Math.PI) / 180, step: Math.PI / 720 }));
        // And outside those ranges no bolt lands on the plant (tried more finely).
        const hits = bearingsOnto(w, c, parts, { margin: 0, step: Math.PI / 1440 });
        for (const [lo, hi] of hits) for (const th of [lo, (lo + hi) / 2, hi]) expect((c.turret!.avoid ?? []).some(([a, b]) => th >= a - 1e-6 && th <= b + 1e-6), `level ${n} ${c.id} ${th}`).toBe(true);
      }
    }
    // Level 4's turrets under its mouth have bearings they avoid, and the asteroid's two nearest the plant.
    const avoid = (n: number, id: string) => raw(n).world.bodies.find((b: { id: string }) => b.id === id).turret.avoid;
    for (const id of ["t1-breech", "t2-breech", "t3-breech"]) expect(avoid(4, id)?.length, id).toBeGreaterThan(0);
  }, 120_000);

  it("WPN-014 a turret never fires on a bearing it avoids: a random one picks another", () => {
    const { w, step } = game(4, (s) => {
      for (const b of s.world.bodies) if (b.turret) b.turret.avoid = b.id === "t1-breech" ? [[-0.87, 0.6]] : b.turret.avoid;
    });
    moveShip(w, { x: 30, y: -10 });
    for (let k = 0; k < 40; k++) {
      step(0.25);
      moveShip(w, { x: 30, y: -10 });
    }
    const fired = w.events.filter((e) => e.type === "turret.fire" && e.data.id === "t1-breech");
    expect(fired.length).toBeGreaterThan(0);
    for (const f of fired) expect(Number(f.data.angle)).toBeGreaterThan(0.6);
  }, 60_000);

  it("MTH-089 below half its coolant the plant's power fails now and then for 2 to 3 s on screen, more often the less is left", () => {
    // The plant's own rules (plant.ts), run step by step for 40 game seconds with the world held still:
    // a whole level for that long is more than a slow machine's test time allows.
    const outages = (share: number) => {
      const { w } = game(4);
      const core = body(w, "plant-core")!;
      core.contents![0].mass = core.contents![0].capacity * share;
      const dt = 1 / 240;
      for (let k = 0; k < 40 * 240; k++) {
        w.tick += 1;
        w.time += dt;
        runPlant(w, w.thrust!.spec.plant!, st(w).plant!, null, dt);
      }
      const list = w.events.filter((e) => e.type === "plant.outage");
      for (const e of list) {
        const last = Number(e.data.until) - e.tick / 240;
        expect(last).toBeGreaterThanOrEqual(1 - 1e-6);
        expect(last).toBeLessThanOrEqual(1.5 + 1e-6);
      }
      return list.length;
    };
    expect(outages(0.6)).toBe(0);
    const quarter = outages(0.25);
    const little = outages(0.05);
    expect(quarter).toBeGreaterThan(0);
    expect(little).toBeGreaterThan(quarter);
  }, 120_000);
  it("MTH-091 FLT-015 TER-007 level 5 is Chloe's asteroid: rock as an island in open space, pulling toward its middle as a uniform ball, left by getting 300 m from it", () => {
    const s = raw(5);
    expect(s.world.gravity).toEqual({ x: 0, y: 0 });
    expect(s.world.terrain.islands).toHaveLength(1);
    expect(s.world.thrust.turrets).toHaveLength(13);
    expect(s.world.thrust.tanks).toEqual(["fuel-1", "fuel-2", "fuel-3", "fuel-4"]);
    const { w, step } = game(5);
    expect(w.thrust!.spec.escape).toEqual({ centre: { x: 0, y: 0 }, radius: 300 });
    // Rock all round the asteroid's surface, none out in the open; no walls: the square of open
    // space wraps round on every side (MTH-093).
    const rock = w.bodies.filter((b) => b.id.startsWith("rock-s"));
    expect(rock.length).toBeGreaterThan(30);
    expect(rock.every((b) => Math.hypot(b.position.x, b.position.y) < 125 + 5)).toBe(true);
    expect(w.bounds).toMatchObject({ min: { x: -340, y: -340 }, max: { x: 340, y: 340 }, wrap: true });
    // The pull on a 1 kg ball held still 140 m out, and in the open middle of its caves, 23 m from
    // its source: 4 m/s² at 84 m, falling as 1/r² outside and in a straight line to nothing inside.
    const core = body(w, "rock-core")!.position;
    const pullAt = (x: number, y: number) => {
      const g = game(5, (sc) => {
        sc.world.thrust.turrets = [];
        sc.world.bodies.push({ id: "probe", shape: { kind: "disc", radius: 0.1 }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
      });
      g.step(1 / 240);
      const v = body(g.w, "probe")!.velocity;
      const r = Math.hypot(x - core.x, y - core.y);
      return { r, a: Math.hypot(v.x, v.y) * 240, inward: -(v.x * (x - core.x) + v.y * (y - core.y)) / r > 0 };
    };
    const far = pullAt(core.x, core.y + 140);
    expect(far.a).toBeCloseTo((4 * 84 * 84) / (140 * 140), 2);
    expect(far.inward).toBe(true);
    const inside = pullAt(-20, -5);
    expect(inside.a).toBeCloseTo((4 * inside.r) / 84, 2);
    expect(inside.inward).toBe(true);
    // The plant powers every turret; the upper part's four through either transmitter.
    const powered = () => w.bodies.filter((b) => b.turret).map((b) => b.turret!.powered);
    step(0.1);
    expect(powered().every(Boolean)).toBe(true);
    const upper = s.world.thrust.plant.turrets.filter((t: { needs?: string[] }) => t.needs).map((t: { id: string }) => t.id);
    expect(upper).toEqual(["t1-breech", "t2-breech", "t5-breech", "t7-breech"]);
    // Settled, nothing on the rock moves (turrets off), and the ledger is clean.
    for (const b of w.bodies) if (b.turret) b.turret.enabled = false;
    const at = new Map(w.bodies.map((b) => [b.id, { ...b.position }]));
    step(3);
    for (const b of w.bodies.filter((x) => /^(t\d|fuel|pod|plant|aerial)/.test(x.id)))
      expect(Math.hypot(b.position.x - at.get(b.id)!.x, b.position.y - at.get(b.id)!.y), b.id).toBeLessThan(/barrel|breech/.test(b.id) ? 0.2 : 0.1);
    expect(w.ledger.violations).toBe(0);
  }, 120_000);

  it("MTH-095 a turret fed by either of two transmitters has power while one is up", () => {
    const { w, step } = game(5, (s) => (s.world.thrust.turrets = []));
    step(0.1);
    const t1 = body(w, "t1-breech")!;
    expect(t1.turret!.powered).toBe(true);
    // One transmitter's antenna gone: still powered; both: not.
    w.bodies = w.bodies.filter((b) => !b.id.startsWith("aerial-1-"));
    settle(w);
    step(0.1);
    expect(st(w).plant!.up).toMatchObject({ tx1: false, tx2: true });
    expect(t1.turret!.powered).toBe(true);
    w.bodies = w.bodies.filter((b) => !b.id.startsWith("aerial-3-"));
    settle(w);
    step(0.1);
    expect(st(w).plant!.up).toMatchObject({ tx1: false, tx2: false });
    expect(t1.turret!.powered).toBe(false);
    // The lower and right parts' turrets don't need them.
    expect(body(w, "t13-breech")!.turret!.powered).toBe(true);
  });

  it("MTH-091 on the asteroid, a ship with the pod 300 m from the middle wins, and one without it is sent back", () => {
    const g = withPod(5, (s) => {
      s.world.thrust.turrets = [];
    });
    expect(st(g.w).pod).toBe("tether");
    // Ship and pod moved together out past 300 m, to the right.
    const d = { x: 305 - hull(g.w).position.x, y: 0 - hull(g.w).position.y };
    for (const b of g.w.bodies) if (b.id.startsWith("p1-") || b.id === "pod") b.position = { x: b.position.x + d.x, y: b.position.y + d.y };
    settle(g.w);
    g.step(0.05);
    expect(st(g.w).phase).toBe("won");
    const alone = game(5, (s) => (s.world.thrust.turrets = []));
    moveShip(alone.w, { x: -302, y: 10 });
    alone.step(0.05);
    expect(st(alone.w).phase).toBe("flying");
    expect(st(alone.w).stats.back).toBe(1);
  }, 60_000);
});

