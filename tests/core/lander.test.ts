import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getProfile, initialWorld, parseScenario, stepInPlace, type World } from "../../src/core/index.ts";

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
    // (100 + 100 × softness + 100 × fuel left) × 2: about 1 m/s of the 2 allowed, a full tank.
    expect(w.lander!.state.score).toBeGreaterThan(480);
    expect(w.lander!.state.score).toBeLessThan(520);
    expect(w.ledger.violations).toBe(0);
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
    expect(String(w.events.filter((e) => e.type === "crashed").at(-1)?.data.reason)).toMatch(/^Hit l1-/);
  });

  it("LND-012 touching a used pad is a crash", () => {
    const { w, step } = game(1);
    w.lander!.state.used = ["pad-1"]; // as if landed on earlier
    step(1.5);
    const reasons = w.events.filter((e) => e.type === "crashed").map((e) => String(e.data.reason));
    expect(reasons.some((r) => r.startsWith("Touched a pad already used"))).toBe(true);
  });

  it("LND-021 a hard crash sets off the tank and leaves wreckage, with the ledger exact", () => {
    const { w, step } = game(8);
    step(2);
    expect(w.events.some((e) => e.type === "crashed")).toBe(true);
    expect(w.events.some((e) => e.type === "detonation" && e.data.id === "l1-tank")).toBe(true);
    expect(w.events.some((e) => e.type === "joint.break")).toBe(true);
    // Most of the ship is still there as wreckage.
    expect(w.bodies.filter((b) => b.id.startsWith("l1-")).length).toBeGreaterThan(10);
    expect(w.ledger.violations).toBe(0);
  });

  it("LND-020 the game ends after the last life", () => {
    const { w, step } = game(8, { lives: 2, pause: 0.5 });
    step(5);
    expect(w.lander!.state.crashes).toBe(2);
    expect(w.lander!.state.phase).toBe("over");
    expect(w.lander!.state.ended).toBe("crashes");
  });

  it("LND-021 the last life's hard crash still explodes before the game ends", () => {
    const { w, step } = game(8, { lives: 1, pause: 0.5 });
    step(2);
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
    scn.world.lander.ship.joints = scn.world.lander.ship.joints.map((j: Record<string, unknown>) => j);
    const s = parseScenario(scn);
    const prof = getProfile(s.profile);
    const w = initialWorld(s);
    for (let k = 0; k < 2 * 240; k++) stepInPlace(w, [], prof);
    expect(w.lander!.state.crashes).toBe(1);
    expect(w.events.some((e) => e.type === "detonation" && e.data.id === "l1-tank")).toBe(true);
  });

  it("LND-041 the scenario is checked: the hull must be one of the ship's bodies", () => {
    const scn = structuredClone(raw);
    scn.world.lander.hull = "l{n}-nothing";
    expect(() => parseScenario(scn)).toThrow(/hull/);
  });
});
