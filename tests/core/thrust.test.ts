// Mammoth Thrust's game in the world (docs/games/mammoth-thrust.md; src/core/thrust.ts) and its levels (scripts/thrust.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERRAIN_OPS, addBody, computeTotals, plantCoolant, runPlant, transmitterTips, createWorld, cutCrater, getProfile, hashValue, initialWorld, parseScenario, ScenarioError, stepInPlace, THRUST_SCORES, thrustFuel, turretOnline, turretWorks, type Command, type World } from "../../src/core/index.ts";
import { narrowest } from "../../scripts/terrain.ts";

const raw = (n: number) => JSON.parse(readFileSync(new URL(`../../scenarios/thrust-${n}.json`, import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });

/** A game on level `n`, with `edit` over the scenario. `step(s)` runs s game seconds, the commands on its first step. */
function game(n = 1, edit?: (scn: ReturnType<typeof raw>) => void): { w: World; step: (seconds: number, commands?: Command[]) => void } {
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
function withPod(n = 1, edit?: (scn: ReturnType<typeof raw>) => void) {
  const g = game(n, edit);
  moveShip(g.w, { x: pod(g.w).position.x, y: pod(g.w).position.y + 9 });
  g.step(0.1, [set("tractor", 1)]);
  g.step(0.05, [set("tractor", 0)]);
  return g;
}
const types = (w: World) => new Set(w.events.map((e) => e.type));

describe("Mammoth Thrust", () => {
  it("MTH-010 MTH-011 a level is fixed ground that can't be damaged under 4 m/s² of gravity, with no wrap, the pod on its stand and the ship at the start", () => {
    for (const n of [1, 2, 3]) {
      const { w } = game(n);
      expect(w.gravity).toEqual({ x: 0, y: -4 });
      expect(w.bounds.wrap).toBeFalsy();
      const rock = w.bodies.filter((b) => b.id.startsWith("rock-"));
      expect(rock.length).toBeGreaterThan(20);
      expect(rock.every((b) => b.fixed && !b.material)).toBe(true);
      expect(st(w)).toMatchObject({ phase: "flying", lives: 3, n: 1, score: 0, pod: "stand" });
      expect(hull(w).position.x).toBeCloseTo(w.thrust!.spec.start.x, 6);
      expect(hull(w).position.y).toBeCloseTo(w.thrust!.spec.start.y, 6);
      expect(pod(w).mass).toBe(34);
      expect(w.thrust!.spec.level).toBe(n);
    }
    // Level 1 has one turret, level 2 three: each a base, a mount, a carriage with its gun, a battery, a generator, a pipe and a fuel tank (MTH-031).
    for (const [n, count] of [[1, 1], [2, 3]] as const) {
      const { w } = game(n);
      expect(w.thrust!.spec.turrets).toHaveLength(count);
      for (let k = 1; k <= count; k++) {
        for (const part of ["base", "mount", "carriage", "gun", "battery", "gen", "pipe", "tank"]) expect(body(w, `t${k}-${part}`), `t${k}-${part}`).toBeDefined();
        expect(body(w, `t${k}-base`)!.fixed).toBe(true);
        expect(body(w, `t${k}-tank`)!.fixed).toBe(false);
        expect(turretWorks(w, body(w, `t${k}-carriage`)!)).toBe(true);
      }
    }
    // Level 1 has no cave; level 2's pod is far below its surface.
    expect(raw(1).world.thrust.view.caves).toHaveLength(0);
    expect(raw(2).world.thrust.view.caves).toHaveLength(1);
    expect(pod(game(2).w).position.y).toBeLessThan(-100);
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
    // Level 2's shaft is 30 m wide: no narrower than the 25 m the generator insists on.
    const l2 = raw(2).world.thrust.view;
    expect(narrowest([...l2.caves[0]], 15)).toBeGreaterThanOrEqual(25);
  });

  it("MTH-020 the ship is Mammoth Asteroids' with a tractor unit and a tether unit, turns at about 7 rad/s², and fires slugs with no charge", () => {
    const { w, step } = game(1, (s) => (s.world.gravity = { x: 0, y: 0 }));
    // The cockpit works the beam and holds the tether, through the two units.
    expect(hull(w).tractor).toMatchObject({ channel: "tractor", beamFrom: "p1-tractor", tetherFrom: "p1-tether", only: ["pod"], mode: "off" });
    expect(body(w, "p1-tractor")).toBeDefined();
    expect(body(w, "p1-tether")).toBeDefined();
    expect(body(w, "p1-gun")!.magazine!.count).toBe(120);
    expect(body(w, "p1-gun")!.magazine!.shell.explosive).toBeUndefined();
    step(0.2);
    step(0.5, [set("left", 1)]);
    const turning = Math.abs(hull(w).angularVelocity) / 0.5;
    expect(turning).toBeGreaterThan(6.3);
    expect(turning).toBeLessThan(7.7);
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
    const { w } = game(1, (s) => Object.assign(s.world.thrust, { top: 100000, turrets: [] }));
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
    const { w, step } = game(1, (s) => {
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
    expect(st(w)).toMatchObject({ phase: "between", lives: 2, n: 1 });
    expect(w.links.some((l) => l.kind === "control" && l.to.startsWith("p1-"))).toBe(false); // the keys fly only the next ship
    // After any loss there are 3 s on screen (1.5 game s) to watch it go before the page says the
    // ship is lost, and then the usual wait for the next one.
    expect(st(w).noteAt! - w.time).toBeGreaterThan(1.3);
    expect(st(w).next! - st(w).noteAt!).toBeCloseTo(1.25, 6);
    step(1.5);
    expect(st(w).phase).toBe("between");
    step(1.2);
    expect(st(w)).toMatchObject({ phase: "flying", lives: 2, n: 2, pod: "loose" });
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

  it("MTH-050 three ships lost and the game is over, with no fourth ship", () => {
    const { w, step } = game();
    for (let k = 0; k < 3; k++) {
      step(2 / 240, [set("destruct", 1)]);
      step(2.9);
    }
    expect(st(w)).toMatchObject({ phase: "over", reason: "ships", lives: 0, n: 3 });
    expect(w.events.filter((e) => e.type === "thrust.ship")).toHaveLength(3);
    expect(w.events.filter((e) => e.type === "thrust.over")).toHaveLength(1);
    step(0.5, [set("destruct", 1)]);
    expect(st(w).n).toBe(3);
  });

  it("MTH-024 MTH-051 the level is complete when the ship is above the top with the pod on its tether: 2,000 for the pod and 100 for each kg of fuel left", () => {
    // A low top, so the climb is short: 30 m, with the start under it.
    const { w, step } = withPod(1, (s) => Object.assign(s.world.thrust, { top: 30, start: { x: -63, y: 25 } }));
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
    expect(fuel).toBeGreaterThan(1000);
    expect(st(w).score).toBe(2000 + fuel);
    expect(w.events.filter((e) => e.type === "thrust.won")).toHaveLength(1);
    const score = st(w).score;
    step(0.2);
    expect(st(w).score).toBe(score); // won once
    expect(w.ledger.violations).toBe(0);
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
    expect(st(w)).toMatchObject({ phase: "flying", lives: 3, n: 1 });
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
    const shot = game(1, (s) => (s.world.gravity = { x: 0, y: 0 }));
    pod(shot.w).position = { x: hull(shot.w).position.x, y: hull(shot.w).position.y + 12 };
    settle(shot.w);
    shot.step(0.4, [set("fire", 1)]);
    expect(types(shot.w).has("railgun.fired")).toBe(true);
    expect(pod(shot.w).velocity.y).toBeGreaterThan(0.1); // it was struck
    expect(pod(shot.w).integrity).toBe(1);

    const gone = game();
    pod(gone.w).integrity = 0;
    gone.step(0.1);
    expect(st(gone.w)).toMatchObject({ phase: "over", reason: "pod", pod: "gone", lives: 3 });
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
    expect(st(w).lives).toBe(2);
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
    const { w, step } = game(1, (s) => (s.world.gravity = { x: 0, y: 0 }));
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
    const { w, step } = game(1, (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
      s.world.thrust.tanks = [];
      s.world.bodies = s.world.bodies.filter((b: { id: string }) => !b.id.startsWith("t1-"));
      s.world.joints = [];
      s.world.links = [];
    });
    const bolt = raw(1).world.bodies.find((b: { id: string }) => b.id === "t1-carriage").magazine.shell;
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
    const { w, step } = game(1, (s) => {
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

    // Level 2's third turret hangs from the chamber's roof, 50 m over the floor.
    const roof = game(2);
    roof.step(0.2);
    expect(cutCrater(roof.w, { x: -30, y: -60.5 }, 2.5, TERRAIN_OPS)).toBe(true);
    settle(roof.w);
    roof.step(1);
    expect(body(roof.w, "t3-base")!.velocity.y).toBeLessThan(-3); // falling
    roof.step(5);
    expect(body(roof.w, "t3-base")!.position.y).toBeLessThan(-105); // on the floor
    expect(st(roof.w).turretsOut).toEqual(["t3-carriage"]); // broken by the fall: out of action
    expect(st(roof.w).score).toBe(750);
    expect(pod(roof.w).integrity).toBe(1); // it came down on the pod, which is very hard to destroy
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
    const { w, step } = game(1, (s) => {
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
  function over(id: string, share: number, up = 12, n = 1) {
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
    const { w, step } = over("fuel-1", 0.25);
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
    const { w, step } = over("t1-tank", 0.25);
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
    const empty = over("fuel-1", 0.25);
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

  it("MTH-080 WPN-011 the power plant powers the level's turrets; a slug takes it offline 5 s on screen, each more while it is down 2 s more, and the turrets stop meanwhile", () => {
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
    expect(first - hitAt).toBeCloseTo(2.5, 1); // 5 s on screen
    expect(poweredTurrets(w)).toBe("t1:off t2:off t3:off t4:off t5:off t6:off");
    w.bodies = w.bodies.filter((b) => b.id !== "p1-gun-shell-t1"); // out of the way of the next
    settle(w);
    slugAtPoint(w, { x: tower.position.x, y: tower.position.y + 4 }, 2, { x: 0, y: 6 });
    step(0.2);
    expect(plantState(w).offlineUntil - first).toBeCloseTo(1, 6); // 2 s more on screen
    step(first + 1 - w.time + 0.1);
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
  it("MTH-091 FLT-015 TER-007 level 5 is an asteroid: rock as an island in open space, pulling toward its centre as a uniform ball, left by getting 150 m from its centre", () => {
    const s = raw(5);
    expect(s.world.gravity).toEqual({ x: 0, y: 0 });
    expect(s.world.terrain.islands).toHaveLength(1);
    const { w, step } = game(5);
    expect(w.thrust!.spec.escape).toEqual({ centre: { x: 0, y: 0 }, radius: 150 });
    // Rock all round the asteroid's surface, none in the open beside it.
    const rock = w.bodies.filter((b) => b.id.startsWith("rock-s"));
    expect(rock.length).toBeGreaterThan(30);
    expect(rock.every((b) => Math.hypot(b.position.x, b.position.y) < 90 + 5 || Math.max(Math.abs(b.position.x), Math.abs(b.position.y)) > 170 - 1)).toBe(true);
    // The pull on a 1 kg ball held still at 135 m, 90 m (the surface, over the sea of rock: a probe in
    // the open beside it) and 45 m from the centre, in the tunnel's direction where needed.
    const pullAt = (x: number, y: number) => {
      const g = game(5, (sc) => {
        sc.world.thrust.turrets = [];
        sc.world.bodies.push({ id: "probe", shape: { kind: "disc", radius: 0.1 }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
      });
      g.step(1 / 240);
      const v = body(g.w, "probe")!.velocity;
      return { a: Math.hypot(v.x, v.y) * 240, inward: -(v.x * x + v.y * y) / Math.hypot(x, y) > 0 };
    };
    const far = pullAt(0, 135);
    expect(far.a).toBeCloseTo((4 * 90 * 90) / (135 * 135), 2);
    expect(far.inward).toBe(true);
    expect(pullAt(-90.5, 0).a).toBeCloseTo(4 * (90 / 90.5) ** 2, 2);
    // Inside, in the chamber 30 m from the centre: a straight line to nothing, 4 × 30/90.
    const inside = pullAt(0, 30);
    expect(inside.a).toBeCloseTo((4 * 30) / 90, 2);
    expect(inside.inward).toBe(true);
    // Settled, nothing on the rock moves (turrets off), and the ledger is clean.
    for (const b of w.bodies) if (b.turret) b.turret.enabled = false;
    const at = new Map(w.bodies.map((b) => [b.id, { ...b.position }]));
    step(3);
    // (A barrel held across the pull sags a little on its joint: 13 cm on the tunnel's outer wall.)
    for (const b of w.bodies.filter((x) => x.id.startsWith("t") || x.id.startsWith("fuel") || x.id === "pod"))
      expect(Math.hypot(b.position.x - at.get(b.id)!.x, b.position.y - at.get(b.id)!.y), b.id).toBeLessThan(/barrel|breech/.test(b.id) ? 0.2 : 0.1);
    expect(w.ledger.violations).toBe(0);
  }, 120_000);

  it("MTH-091 on the asteroid, a ship with the pod 150 m from the centre wins, and one without it is sent back", () => {
    const g = withPod(5, (s) => {
      s.world.thrust.turrets = [];
    });
    expect(st(g.w).pod).toBe("tether");
    // Ship and pod moved together out past 150 m, to the right.
    const d = { x: 155 - hull(g.w).position.x, y: 0 - hull(g.w).position.y };
    for (const b of g.w.bodies) if (b.id.startsWith("p1-") || b.id === "pod") b.position = { x: b.position.x + d.x, y: b.position.y + d.y };
    settle(g.w);
    g.step(0.05);
    expect(st(g.w).phase).toBe("won");
    const alone = game(5, (s) => (s.world.thrust.turrets = []));
    moveShip(alone.w, { x: -152, y: 10 });
    alone.step(0.05);
    expect(st(alone.w).phase).toBe("flying");
    expect(st(alone.w).stats.back).toBe(1);
  }, 60_000);
});

