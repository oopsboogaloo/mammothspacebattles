// Shields (docs/spec.md §9.12, src/core/shield.ts) on Mammoth Thrust's ship (scripts/thrust.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addBody, computeTotals, getProfile, addParcel, initialWorld, parcelsOf, parseScenario, stepInPlace, type Command, type World } from "../../src/core/index.ts";

const raw = () => JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
const sandbox = getProfile("sandbox");
const set = (channel: string, value: number): Command => ({ type: "control.set", channel, value });
const FIELD = "p1-shield-field";

/** Level 1 with the ship lifted 30 m into the open, at rest. */
function game(lift = 30) {
  const w: World = initialWorld(parseScenario(raw()));
  for (const b of w.bodies.filter((b) => b.id.startsWith("p1-"))) {
    b.position = { x: b.position.x, y: b.position.y + lift };
    b.velocity = { x: 0, y: 0 };
  }
  w.ledger.totals = computeTotals(w);
  const step = (seconds: number, commands: Command[] = []) => {
    for (let i = 0; i < Math.round(seconds * 240); i++) stepInPlace(w, i === 0 ? commands : [], sandbox);
  };
  return { w, step };
}
const body = (w: World, id: string) => w.bodies.find((b) => b.id === id);
const tanks = (w: World) => ["p1-tank-l", "p1-tank-r"].reduce((m, id) => m + (body(w, id)?.contents ?? []).reduce((s, c) => s + c.mass, 0), 0);
const radius = (w: World) => {
  const f = body(w, FIELD);
  return f?.shape.kind === "disc" ? f.shape.radius : 0;
};
/** The ship's centre of mass and its farthest corner from it, the field down. */
function reach(w: World): number {
  const f = body(w, FIELD)!;
  let r = 0;
  for (const b of w.bodies.filter((b) => b.id.startsWith("p1-") && b.id !== FIELD)) r = Math.max(r, Math.hypot(b.position.x - f.position.x, b.position.y - f.position.y));
  return r;
}

describe("Shield", () => {
  it("SHD-001 held on, the field grows from nothing to its radius round the ship's centre of mass, burns fuel while up, and goes when let go or the fuel runs out", () => {
    const { w, step } = game();
    const full = tanks(w);
    step(1 / 240, [set("shield", 1)]);
    expect(radius(w)).toBeLessThan(0.1);
    step(0.1);
    const half = radius(w);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(w.bodies.find((b) => b.shield)!.shield!.radius);
    step(0.4);
    const spec = w.bodies.find((b) => b.shield)!.shield!;
    expect(radius(w)).toBeCloseTo(spec.radius, 6);
    expect(radius(w)).toBeGreaterThan(reach(w));
    // 0.5 s at 0.8 kg/s, less what the engines' heads took to fill.
    const burned = full - tanks(w);
    expect(burned).toBeGreaterThan(0.4 - 1e-6);
    expect(burned).toBeLessThan(0.6);
    step(0.1, [set("shield", 0)]);
    expect(body(w, FIELD)).toBeUndefined();
    // Down, it burns nothing: what goes now only tops up the engines' heads.
    const left = tanks(w);
    step(0.5);
    expect(left - tanks(w)).toBeLessThan(0.1);
    // With the tanks empty it doesn't come up.
    for (const id of ["p1-tank-l", "p1-tank-r"]) for (const c of body(w, id)!.contents!) c.mass = 0;
    w.ledger.totals = computeTotals(w);
    step(0.2, [set("shield", 1)]);
    expect(body(w, FIELD)).toBeUndefined();
    expect(w.ledger.violations).toBe(0);
  });

  it("SHD-005 while it is up the engines and the gun don't work; let go, they do", () => {
    const { w, step } = game();
    step(0.5, [set("shield", 1), set("forward", 1), set("fire", 1)]);
    expect(body(w, "p1-hull")!.velocity.y).toBeCloseTo(-2, 1);
    expect(w.bodies.some((b) => b.id.includes("-shell-") && Math.hypot(b.velocity.x, b.velocity.y) > 50)).toBe(false);
    expect(w.links.filter((l) => l.off === "shield").map((l) => l.id).sort()).toEqual(["p1-ctl-back-l", "p1-ctl-back-r", "p1-ctl-fire", "p1-ctl-front-l", "p1-ctl-front-r", "p1-ctl-main"]);
    step(0.5, [set("shield", 0)]);
    expect(w.links.some((l) => l.off)).toBe(false);
    expect(body(w, "p1-hull")!.velocity.y).toBeGreaterThan(0);
    expect(w.ledger.violations).toBe(0);
  });

  it("SHD-002 the field is a surface for everything but its own ship: a rock thrown at it bounces off, pushes the ship, and costs extra fuel", () => {
    const { w, step } = game();
    step(0.5, [set("shield", 1)]);
    const f = body(w, FIELD)!;
    addBody(w, { id: "rock-x", shape: { kind: "disc", radius: 0.3 }, mass: 1, position: { x: f.position.x + 8, y: f.position.y }, velocity: { x: -10, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0.3, friction: 0.3 });
    w.ledger.totals = computeTotals(w);
    const before = tanks(w);
    step(0.6);
    const rock = body(w, "rock-x")!;
    expect(rock.velocity.x).toBeGreaterThan(0);
    expect(Math.hypot(rock.position.x - f.position.x, rock.position.y - f.position.y)).toBeGreaterThan(radius(w));
    expect(body(w, "p1-hull")!.velocity.x).toBeLessThan(-0.1);
    const hits = w.events.filter((e) => e.type === "shield.hit");
    expect(hits).toHaveLength(1);
    expect(before - tanks(w)).toBeGreaterThan(0.8 * 0.6 + 0.1 - 1e-6);
    expect(w.ledger.violations).toBe(0);
  });

  it("SHD-002 falling onto rock at 8 m/s with it up, the ship comes down on the field: nothing of it touches the rock or breaks", () => {
    // 8 m over where it comes to rest on the field (the start is 62 m up).
    const { w, step } = game(-53);
    const welds = w.joints.length;
    let fastest = 0;
    for (let k = 0; k < 40; k++) {
      step(0.1, k === 0 ? [set("shield", 1)] : []);
      fastest = Math.min(fastest, body(w, "p1-hull")!.velocity.y);
    }
    expect(fastest).toBeLessThan(-7.5);
    expect(Math.abs(body(w, "p1-hull")!.velocity.y)).toBeLessThan(0.1);
    expect(w.events.some((e) => e.type === "shield.hit" && String(e.data.by).startsWith("rock-"))).toBe(true);
    expect(w.contacts.some((c) => c.a.startsWith("p1-") !== c.b.startsWith("p1-") && c.a !== FIELD && c.b !== FIELD)).toBe(false);
    expect(w.joints.length).toBe(welds + 1);
    expect(w.bodies.filter((b) => b.id.startsWith("p1-") && b.integrity < 1)).toEqual([]);
    expect(w.ledger.violations).toBe(0);
  });

  it("SHD-003 gas meets it as a wall: a puff blown at the ship is turned back at the field", () => {
    const { w, step } = game();
    step(0.4, [set("shield", 1)]);
    const f = body(w, FIELD)!;
    const r = radius(w);
    // A puff 6 m to the right, blowing left at 15 m/s.
    for (let k = 0; k < 24; k++) {
      const y = f.position.y - 1.15 + (k % 12) * 0.2;
      addParcel(w.gas, { id: w.gas.nextId++, mass: 0.002, composition: { co2: 1 }, position: { x: f.position.x + 6 + Math.floor(k / 12) * 0.2, y }, velocity: { x: -15, y: 0 }, thermal: 0, radius: 0.1 });
    }
    w.ledger.totals = computeTotals(w);
    let closest = Infinity;
    for (let k = 0; k < 60; k++) {
      step(1 / 120);
      for (const p of parcelsOf(w.gas)) closest = Math.min(closest, Math.hypot(p.position.x - f.position.x, p.position.y - f.position.y));
    }
    expect(closest).toBeGreaterThan(r - 0.1);
    expect(parcelsOf(w.gas).reduce((s, p) => s + p.velocity.x, 0)).toBeGreaterThan(-15 * 24 * 0.25);
    expect(w.ledger.violations).toBe(0);
  });

  it("SHD-004 a blast outside the field doesn't damage what it covers", () => {
    const charge = (up: boolean) => {
      const { w, step } = game();
      if (up) step(0.5, [set("shield", 1)]);
      const h = body(w, "p1-tank-r")!;
      addBody(w, { id: "bomb", shape: { kind: "box", width: 0.4, height: 0.4 }, mass: 1, position: { x: h.position.x + 4.5, y: h.position.y }, velocity: { x: 0, y: 0 }, angle: 0, angularVelocity: 0, restitution: 0, friction: 0.5, explosive: { charge: 0.3, arm: 1e6, fragments: 0, radius: 6, trigger: true } } as never);
      w.ledger.totals = computeTotals(w);
      step(0.05);
      expect(w.events.some((e) => e.type === "detonation" && e.data.id === "bomb")).toBe(true);
      expect(w.ledger.violations).toBe(0);
      return Math.min(...w.bodies.filter((b) => b.id.startsWith("p1-") && b.material).map((b) => b.integrity));
    };
    expect(charge(false)).toBeLessThan(1);
    expect(charge(true)).toBe(1);
  });
});
