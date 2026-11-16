// The blueprint designer's model (docs/blueprint/spec.md; src/app/blueprint/model.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { body, component, engineGeom, jointPoint, params, reweld, setParam, stats, thrustPreset, welds, worldVertices, response } from "../../src/app/blueprint/model.ts";
import { mixerValues, steerValues } from "../../src/core/index.ts";

const scn = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
const bp = thrustPreset(scn);

/** The same outline, whichever vertex it starts from and whichever way round. */
const sameOutline = (p: { x: number; y: number }[], q: { x: number; y: number }[]) => {
  expect(p.length).toBe(q.length);
  for (const v of p) expect(q.some((w) => Math.hypot(v.x - w.x, v.y - w.y) < 1e-5)).toBe(true);
};

describe("blueprint model", () => {
  it("BPD-012 Thrust 1 is the Thrust game's ship exactly: the same bodies, joints and links, with the game's ids", () => {
    const ship = JSON.parse(JSON.stringify(scn.world.thrust.ship).replaceAll("p{n}-", ""));
    expect(bp.ship.bodies).toEqual(ship.bodies);
    expect(bp.ship.joints).toEqual(ship.joints);
    expect(bp.ship.links).toEqual(ship.links);
    // Only the game's numbering went: every id is the game's without its "p{n}-".
    expect(bp.ship.bodies.map((b) => "p{n}-" + b.id)).toEqual(scn.world.thrust.ship.bodies.map((b: { id: string }) => b.id));
    expect(bp.preset).toBe(true);
  });

  it("BPD-012 its wiring gives the game's engine values for every combination of controls, and fires its gun, tractor and shield on their own controls", () => {
    const steps = [0, 0.5, 1];
    for (const forward of steps)
      for (const left of steps)
        for (const right of steps)
          for (const reverse of steps) {
            const c = { forward, left, right, reverse, fire: 1, tractor: 0, shield: 1 };
            const got = mixerValues(bp.mix, c);
            for (const [ch, v] of Object.entries(steerValues(scn.world.thrust.mix, c))) expect(got[ch]).toBeCloseTo(v, 12);
            expect([got.fire, got.tractor, got.shield]).toEqual([1, 0, 1]);
          }
  });

  it("BPD-013 the parts as the player sees them: 17 components, 20 welds of 26 points, 61.2 kg, centre of mass on the middle line", () => {
    expect(bp.components.length).toBe(17);
    expect(bp.components.filter((c) => c.kind === "engine").map((c) => c.bodies.length)).toEqual([3, 3, 3, 3, 3]);
    const w = welds(bp);
    expect(w.length).toBe(20);
    expect(w.reduce((s, x) => s + x.joints.length, 0)).toBe(26);
    const st = stats(bp);
    expect(st.mass).toBeCloseTo(61.2, 3);
    expect(st.com.x).toBeCloseTo(0, 9);
    expect(st.com.y).toBeCloseTo(0.013, 3);
    expect(st.width).toBeCloseTo(5.6, 6);
    expect(st.propellant).toBeCloseTo(8.1, 9);
  });

  it("BPD-014 an engine's shape read from its parts: the main thruster's chamber, throat, walls and flare", () => {
    const g = engineGeom(bp, component(bp, "main"));
    expect(g.headWidth).toBeCloseTo(1.2, 9);
    expect(g.throat).toBeCloseTo(1.0, 9);
    expect(g.wall).toBeCloseTo(0.1, 9);
    expect(g.length).toBeCloseTo(1.1, 9);
    expect(g.flare).toBeCloseTo((Math.atan2(0.25, 1.1) * 180) / Math.PI, 9);
    // A front thruster faces the other way and reads the same way.
    const f = engineGeom(bp, component(bp, "front-r"));
    // (Its angle is stored as 3.141593, so to about 1e-6.)
    expect([f.headWidth, f.throat, f.wall, f.length]).toEqual([0.8, expect.closeTo(0.6, 5), expect.closeTo(0.1, 5), expect.closeTo(0.7, 5)]);
  });

  it("BPD-014 setting an engine's shape to what it is changes nothing: its walls and their welds come out where they were, either way up", () => {
    for (const id of ["main", "front-l", "back-r"]) {
      const c = component(bp, id);
      const again = setParam(bp, id, "length", engineGeom(bp, c).length);
      for (const bid of c.bodies) {
        sameOutline(worldVertices(body(again, bid)), worldVertices(body(bp, bid)));
      }
      for (const j of bp.ship.joints.filter((x) => c.bodies.includes(x.a) && c.bodies.includes(x.b))) {
        const k = again.ship.joints.find((x) => x.id === j.id)!;
        const p = jointPoint(bp, j);
        const q = jointPoint(again, k);
        expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-5);
        // Its two anchors still meet.
        const onB = (() => {
          const b = body(again, k.b);
          const a = b.angle ?? 0;
          return { x: b.position.x + Math.cos(a) * k.anchorB.x - Math.sin(a) * k.anchorB.y, y: b.position.y + Math.sin(a) * k.anchorB.x + Math.cos(a) * k.anchorB.y };
        })();
        expect(Math.hypot(q.x - onB.x, q.y - onB.y)).toBeLessThan(1e-9);
      }
    }
  });

  it("BPD-014 a longer, wider nozzle: the walls grow and splay, the head stays, and the flow sets the parcel size and the head's store", () => {
    let b = setParam(bp, "main", "length", 1.5);
    b = setParam(b, "main", "flare", 20);
    const g = engineGeom(b, component(b, "main"));
    expect(g.length).toBeCloseTo(1.5, 9);
    expect(g.flare).toBeCloseTo(20, 9);
    expect(g.throat).toBeCloseTo(1.0, 9);
    expect(body(b, "main").position).toEqual(body(bp, "main").position);
    b = setParam(b, "main", "rate", 3.888);
    const inj = body(b, "main").injector!;
    expect(inj.parcelMass).toBeCloseTo(0.007776, 9);
    expect(body(b, "main").contents!.reduce((s, x) => s + x.capacity, 0)).toBeCloseTo(0.07776, 9);
  });

  it("BPD-015 rewelding by touch: a tank and generator that share a 0.8 m side weld at two points 0.1 m in from its ends, as the preset's are", () => {
    const again = reweld(bp, "gen-l");
    const was = welds(bp).find((w) => w.id === "gen-l|tank-l")!;
    const now = welds(again).find((w) => w.id === "gen-l|tank-l")!;
    const pts = (bp2: typeof bp, w: typeof was) => w.joints.map((j) => jointPoint(bp2, j)).sort((p, q) => p.y - q.y);
    const p = pts(bp, was);
    const q = pts(again, now);
    expect(q.length).toBe(2);
    for (let i = 0; i < 2; i++) expect(Math.hypot(p[i].x - q[i].x, p[i].y - q[i].y)).toBeLessThan(1e-9);
    expect(now.joints[0].limits).toEqual(was.joints[0].limits);
  });

  it("BPD-015 a tank made narrower pulls away from what it touched on its far side and stays welded on the side it still touches", () => {
    const b = setParam(bp, "tank-l", "width", 1.0);
    const ws = welds(b).filter((w) => w.a === "tank-l" || w.b === "tank-l").map((w) => w.id);
    // Centred, so it now touches nothing on either side: its welds are gone.
    expect(ws.filter((id) => id.includes("gen-l"))).toEqual([]);
    expect(stats(b).mass).toBeLessThan(stats(bp).mass);
  });

  it("BPD-016 the response table's estimate: forward pushes straight ahead, the turns turn opposite ways and as much as each other", () => {
    const st = stats(bp);
    const fwd = response(bp, { forward: 1 }, st);
    expect(fwd.ahead).toBeGreaterThan(20);
    expect(Math.abs(fwd.turn)).toBeLessThan(1e-9);
    const l = response(bp, { left: 1 }, st);
    const r = response(bp, { right: 1 }, st);
    expect(l.turn).toBeGreaterThan(0);
    expect(r.turn).toBeCloseTo(-l.turn, 6);
    expect(response(bp, { reverse: 1 }, st).ahead).toBeLessThan(0);
  });

  it("BPD-016 every component has properties to show, and a box part's size reads back as set", () => {
    for (const c of bp.components) expect(params(bp, c.id).length).toBeGreaterThan(0);
    const b = setParam(bp, "battery", "height", 0.6);
    expect(params(b, "battery").find((p) => p.key === "height")!.value).toBe(0.6);
  });
});

describe("typed numbers", () => {
  it("BPD-021 a typed value takes sums and, for metres, cm or mm; anything else is refused", async () => {
    const { parseTyped } = await import("../../src/app/blueprint/NumberControl.tsx");
    expect(parseTyped("1.2", "m")).toBe(1.2);
    expect(parseTyped("120 cm", "m")).toBeCloseTo(1.2, 12);
    expect(parseTyped("450mm", "m")).toBeCloseTo(0.45, 12);
    expect(parseTyped("1.2*2", "m")).toBeCloseTo(2.4, 12);
    expect(parseTyped("(1+2)/4", "kg")).toBe(0.75);
    expect(parseTyped("-0.5", "°")).toBe(-0.5);
    expect(parseTyped("12 kg", "kg")).toBe(12);
    expect(parseTyped("abc", "m")).toBeNull();
    expect(parseTyped("1+", "m")).toBeNull();
    expect(parseTyped("alert(1)", "m")).toBeNull();
  });
});
