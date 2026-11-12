// Mammoth Thrust's game in the world (docs/games/mammoth-thrust.md; src/core/thrust.ts) and its levels (scripts/thrust.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeTotals, getProfile, hashValue, initialWorld, parseScenario, ScenarioError, stepInPlace, THRUST_SCORES, thrustFuel, turretWorks, type Command, type World } from "../../src/core/index.ts";
import { crust, narrowest } from "../../scripts/terrain.ts";

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
    for (const n of [1, 2]) {
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
    const rock = crust(air, "r-") as unknown as { shape: { vertices: { x: number; y: number }[] } }[];
    // The floor's crust lies under the floor, and no crust reaches into the open shaft.
    const inShaft = (v: { x: number; y: number }) => Math.abs(v.x) < 10 - 1e-6 && v.y > -60 + 1e-6 && v.y < 0;
    expect(rock.every((b) => !b.shape.vertices.some(inShaft))).toBe(true);
    expect(rock.some((b) => b.shape.vertices.some((v) => v.y < -70))).toBe(true);
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

  it("MTH-027 the beam and the tether work on the pod alone: wreckage in the beam, nearer than the pod, is left where it is", () => {
    const { w, step } = game(1, (s) => {
      s.world.gravity = { x: 0, y: 0 };
      s.world.thrust.turrets = [];
      // A loose piece of an earlier ship, 6 m under where the ship will be.
      s.world.bodies.push({ id: "p0-wreck", shape: { kind: "box", width: 0.6, height: 0.6 }, mass: 2, position: { x: 12, y: 7 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 });
    });
    moveShip(w, { x: 12, y: 13 });
    step(0.3, [set("tractor", 1)]);
    expect(body(w, "p0-wreck")!.velocity).toEqual({ x: 0, y: 0 });
    expect(hull(w).tractor!.targets).not.toContain("p0-wreck");
    expect(hull(w).tractor).toMatchObject({ mode: "tether", cargo: "pod" }); // the pod, 20 m off, past the wreck
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
});

