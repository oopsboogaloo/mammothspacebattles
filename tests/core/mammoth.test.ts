// The Mammoth (scenarios/mammoth.json): a big four-engine ship with the lander's push.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assemblyTotals, getProfile, initialWorld, parseScenario, stepInPlace, type Command, type World } from "../../src/core/index.ts";
import { readJson, ROOT } from "../helpers.ts";

const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
type Raw = { world: { bodies: { id: string; shape: { kind: string; width?: number; height?: number }; tractor?: { tetherFrom?: string } }[]; links: { kind: string; from?: string; to: string; channel?: string }[]; asteroids?: unknown[] } };
const raw = () => readJson(join(ROOT, "scenarios", "mammoth.json")) as Raw;

/** The Mammoth alone in empty space, with the named parts wrecked and gone. */
function ship(out: string[] = [], extra: Raw["world"]["bodies"] = []): World {
  const r = raw();
  r.world.asteroids = [];
  r.world.bodies.push(...extra);
  const w = initialWorld(parseScenario(r));
  for (const id of out) w.bodies.find((b) => b.id === id)!.integrity = 0;
  stepInPlace(w, [], sandbox);
  return w;
}
const totals = (w: World) => assemblyTotals(w, "cockpit")!;
const breaks = (w: World) => w.events.filter((e) => e.type === "joint.break").length;

describe("the Mammoth", () => {
  it("has the parts asked for: an 8 m cockpit, generator, battery, two tanks feeding all four engines, a railgun, and a separate tractor and tether generator", () => {
    const r = raw();
    const at = (id: string) => r.world.bodies.find((b) => b.id === id)!;
    expect(at("cockpit").shape).toMatchObject({ kind: "box", width: 4, height: 6 }); // plus a 2 m semicircular nose: 8 m long
    expect(at("nose").shape.kind).toBe("polygon");
    for (const id of ["generator", "battery"]) expect(at(id).shape).toMatchObject({ kind: "box", width: 2, height: 2 });
    for (const id of ["tractor", "tether-gen"]) expect(at(id).shape).toMatchObject({ kind: "box", width: 1, height: 1 });
    expect(at("tractor").tractor!.tetherFrom).toBe("tether-gen");
    const engines = ["engine-fl", "engine-rl", "engine-fr", "engine-rr"];
    for (const e of engines)
      for (const t of ["tank-l", "tank-r"]) {
        expect(r.world.links.some((l) => l.kind === "feed" && l.from === t && l.to === e)).toBe(true);
      }
    expect(r.world.links.filter((l) => l.kind === "control" && l.channel === "left").map((l) => l.to)).toEqual(["engine-fl", "engine-rl"]);
    expect(r.world.links.filter((l) => l.kind === "control" && l.channel === "right").map((l) => l.to)).toEqual(["engine-fr", "engine-rr"]);
  });

  it("pushes like the lander (about 6.3 m/s²) and turns about half as fast, holding together with a clean ledger", () => {
    const w = ship();
    stepInPlace(w, [set("left", 1), set("right", 1)], sandbox);
    for (let i = 0; i < 120; i++) stepInPlace(w, [], sandbox); // the chambers come up
    const v0 = totals(w).velocity.y;
    for (let i = 0; i < 240; i++) stepInPlace(w, [], sandbox);
    const a = (totals(w).velocity.y - v0) / (240 * sandbox.timestep);
    expect(a).toBeGreaterThan(5.8);
    expect(a).toBeLessThan(7);
    expect(breaks(w)).toBe(0);
    expect(w.ledger.violations).toBe(0);

    const s = ship();
    stepInPlace(s, [set("left", 1)], sandbox);
    for (let i = 1; i < 120; i++) stepInPlace(s, [], sandbox);
    const spin = Math.abs(totals(s).angularVelocity);
    expect(spin).toBeGreaterThan(0.4); // the lander: 1.3 rad/s
    expect(spin).toBeLessThan(0.75);
  }, 60_000);

  it("flies on with one engine out, or one each side: tapping the stronger side holds its heading", () => {
    for (const out of [["engine-fl"], ["engine-fl", "engine-rr"]]) {
      const w = ship(out);
      const v0 = totals(w).velocity;
      let worst = 0;
      for (let i = 0; i < 240 * 3; i++) {
        const angle = w.bodies.find((b) => b.id === "cockpit")!.angle;
        const err = angle + 0.3 * totals(w).angularVelocity;
        worst = Math.max(worst, Math.abs(angle));
        stepInPlace(w, [set("left", err < -0.02 ? 0 : 1), set("right", err > 0.02 ? 0 : 1)], sandbox);
      }
      const v = totals(w).velocity;
      expect(worst).toBeLessThan(0.05); // under 3°
      expect(Math.hypot(v.x - v0.x, v.y - v0.y)).toBeGreaterThan(6);
      expect(w.ledger.violations).toBe(0);
    }
  }, 60_000);

  it("TRC-007 tows on a 25 m tether only while its tether generator is aboard", () => {
    const rock = { id: "rock", shape: { kind: "disc", radius: 1 }, mass: 30, position: { x: 0, y: -24 }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0 } as never;
    for (const [out, tows] of [[[], true], [["tether-gen"], false]] as const) {
      const w = ship([...out], [rock]);
      for (let i = 0; i < 60; i++) stepInPlace(w, [set("tractor", 1)], sandbox);
      expect(w.events.some((e) => e.type === "tether.engage")).toBe(tows);
      expect(w.bodies.find((b) => b.id === "tractor")!.tractor!.targets.length > 0 || tows).toBe(true); // the beam pulls either way
      expect(w.ledger.violations).toBe(0);
    }
  });
});
