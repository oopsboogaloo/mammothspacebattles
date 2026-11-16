// The blueprint designer's model (docs/blueprint/spec.md; src/app/blueprint/model.ts).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addComponent, body, component, engineGeom, flipComponent, freeSpot, instantiate, jointPoint, overlaps, params, place, removeComponent, reweld, setParam, stats, thrustOgPreset, thrustPreset, welds, weldingOf, worldVertices, response } from "../../src/app/blueprint/model.ts";
import { mixerValues, steerValues } from "../../src/core/index.ts";

const scn = JSON.parse(readFileSync(new URL("../../scenarios/thrust-1.json", import.meta.url), "utf8"));
/** THRUST OG: the game's ship as it is (the gold standard the tests below hold it to). */
const bp = thrustOgPreset(scn);
/** THRUST 1: the same ship from the regular parts. */
const regular = thrustPreset(scn);

/** The same outline, whichever vertex it starts from and whichever way round. */
const sameOutline = (p: { x: number; y: number }[], q: { x: number; y: number }[]) => {
  expect(p.length).toBe(q.length);
  for (const v of p) expect(q.some((w) => Math.hypot(v.x - w.x, v.y - w.y) < 1e-5)).toBe(true);
};

describe("blueprint model", () => {
  it("BPD-012 THRUST OG is the Thrust game's ship exactly: the same bodies, joints and links, with the game's ids", () => {
    const ship = JSON.parse(JSON.stringify(scn.world.thrust.ship).replaceAll("p{n}-", ""));
    expect(bp.ship.bodies).toEqual(ship.bodies);
    expect(bp.ship.joints).toEqual(ship.joints);
    expect(bp.ship.links).toEqual(ship.links);
    // Only the game's numbering went: every id is the game's without its "p{n}-".
    expect(bp.ship.bodies.map((b) => "p{n}-" + b.id)).toEqual(scn.world.thrust.ship.bodies.map((b: { id: string }) => b.id));
    expect(bp.preset).toBe(true);
    // Every part an OG part.
    expect(bp.components.every((c) => c.part?.endsWith("_og"))).toBe(true);
    expect(component(bp, "gun").part).toBe("railgun_og");
  });

  it("BPD-036 THRUST 1 is THRUST OG from the regular parts: the same but for the shells, which the magazines hold (60 each) and feed to the railgun", () => {
    expect(regular.id).not.toBe(bp.id);
    expect(regular.components.map((c) => [c.id, c.part])).toEqual(bp.components.map((c) => [c.id, c.part!.replace(/_og$/, "")]));
    expect(body(regular, "gun").magazine!.count).toBe(0);
    expect(["mag-l", "mag-r"].map((id) => body(regular, id).ammo?.count)).toEqual([60, 60]);
    expect(body(regular, "mag-l").ammo!.shell).toEqual(body(bp, "gun").magazine!.shell);
    expect(regular.ship.links.filter((l) => l.kind === "ammo").map((l) => [l.kind === "ammo" && l.from, l.to])).toEqual([["mag-l", "gun"], ["mag-r", "gun"]]);
    // The same mass; its centre lower, the 20 kg of shells being in the magazines, not the nose.
    const [o, r] = [stats(bp), stats(regular)];
    expect(r.mass).toBeCloseTo(o.mass, 9);
    expect(r.com.y).toBeLessThan(o.com.y - 0.2);
    expect(Math.abs(r.com.x)).toBeLessThan(1e-9);
    // A regular magazine added later feeds the railgun too; removed, its line goes with it.
    const made = instantiate(regular, regular, "mag-l", "Magazine");
    const spot = freeSpot(regular, made.bodies, weldingOf(made.comp));
    const more = addComponent(regular, made, spot.dx, spot.dy);
    expect(more.ship.links.some((l) => l.kind === "ammo" && l.from === made.bodies[0].id && l.to === "gun")).toBe(true);
    expect(component(more, made.comp.id).part).toBe("magazine");
    expect(removeComponent(more, made.comp.id).ship.links.filter((l) => l.kind === "ammo")).toHaveLength(2);
    // Its shells are a property of the magazine.
    expect(params(regular, "mag-l").find((p) => p.key === "ammo")?.value).toBe(60);
    expect(body(setParam(regular, "mag-l", "ammo", 10), "mag-l").ammo!.count).toBe(10);
  });

  it("BPD-012 its wiring gives the game's engine values for every combination of controls, and its gun, tractor and shield answer Actions A, B and C", () => {
    const steps = [0, 0.5, 1];
    for (const forward of steps)
      for (const left of steps)
        for (const right of steps)
          for (const reverse of steps) {
            const c = { forward, left, right, reverse, "action-a": 1, "action-b": 0, "action-c": 1 };
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

describe("placing parts", () => {
  it("BPD-022 a new tank dropped near where Tank R was snaps flush against Generator R, lines up, and welds at two points", () => {
    const b = removeComponent(bp, "tank-r");
    const made = instantiate(b, bp, "tank-r");
    // The template sits where Tank R was; drop it 0.15 m out and 0.1 m low.
    const p = place(b, made.bodies, weldingOf(made.comp), 0.15, -0.1);
    expect(p.snapped).toBe(true);
    expect(p.overlap).toBe(false);
    expect(p.dx).toBeCloseTo(0, 9);
    expect(p.dy).toBeCloseTo(0, 9);
    expect(p.touches).toContain("gen-r");
    const added = addComponent(b, made, p.dx, p.dy);
    const w = welds(added).find((x) => x.id === `gen-r|${made.comp.id}`)!;
    expect(w.joints.length).toBe(2);
    // It feeds every engine, and has no controls of its own.
    const feeds = added.ship.links.filter((l) => l.kind === "feed" && l.from === made.bodies[0].id);
    expect(new Set(feeds.map((l) => (l as { to: string }).to))).toEqual(new Set(["main", "back-l", "back-r", "front-l", "front-r"]));
    expect(added.mix.rows.length).toBe(bp.mix.rows.length);
  });

  it("BPD-022 a part can't be dropped into another; with snapping off it lands on the 0.05 m grid", () => {
    const made = instantiate(bp, bp, "tank-r");
    expect(place(bp, made.bodies, weldingOf(made.comp), -2.05, 0).overlap).toBe(true);
    const p = place(bp, made.bodies, weldingOf(made.comp), 2.013, 3.022, { free: true });
    expect(Math.abs((made.bodies[0].position.x + p.dx) / 0.05 - Math.round((made.bodies[0].position.x + p.dx) / 0.05))).toBeLessThan(1e-6);
    expect(overlaps([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }])).toBe(false);
  });

  it("BPD-022 a new engine gets its own channel and an empty mixer row (the player wires it), fuel from every tank, and a spot that overlaps nothing", () => {
    const made = instantiate(bp, bp, "back-l");
    const spot = freeSpot(bp, made.bodies, weldingOf(made.comp));
    const added = addComponent(bp, made, spot.dx, spot.dy);
    const head = body(added, made.comp.bodies[0]);
    expect(head.injector!.channel).toBe(made.comp.id);
    expect(added.mix.rows.find((r) => r.channel === made.comp.id)).toEqual({ channel: made.comp.id, lines: [] });
    expect(added.ship.links.filter((l) => l.kind === "feed" && l.to === head.id).length).toBe(4);
    // The Thrust ship has no side free for an engine's splayed walls, so this one lands clear of it, overlapping nothing.
    for (const id of made.comp.bodies)
      for (const o of bp.ship.bodies) expect(overlaps(worldVertices(body(added, id)), worldVertices(o))).toBe(false);
  });

  it("BPD-022 a new battery's free spot is flush against the ship, welded", () => {
    const made = instantiate(bp, bp, "battery");
    const spot = freeSpot(bp, made.bodies, weldingOf(made.comp));
    const added = addComponent(bp, made, spot.dx, spot.dy);
    expect(welds(added).some((w) => w.a === made.comp.id || w.b === made.comp.id)).toBe(true);
  });

  it("BPD-022 flipping an engine twice puts it back", () => {
    const twice = flipComponent(flipComponent(bp, "back-l"), "back-l");
    for (const id of component(bp, "back-l").bodies) {
      const p = worldVertices(body(twice, id));
      const q = worldVertices(body(bp, id));
      for (const v of p) expect(q.some((w) => Math.hypot(v.x - w.x, v.y - w.y) < 1e-5)).toBe(true);
    }
    void reweld;
  });
});

describe("pieces", () => {
  it("BPD-023 the preset is one piece; moving the battery away leaves the main thruster, welded only to it, as a second piece and the battery a third", async () => {
    const { pieces, moveComponent } = await import("../../src/app/blueprint/model.ts");
    expect(pieces(bp).length).toBe(1);
    const moved = moveComponent(bp, "battery", 0, -3);
    expect(pieces(moved).length).toBe(3);
  });
});

describe("wiring", () => {
  it("BPD-024 each row is said in words, and the checks find an unwired engine and a forward that turns", async () => {
    const { describeRow, setRow, wiringChecks } = await import("../../src/app/blueprint/model.ts");
    const names: Record<string, string> = { forward: "Forward", left: "Turn left", right: "Turn right", reverse: "Reverse" };
    const n = (id: string) => names[id] ?? id;
    expect(describeRow(regular.mix.rows.find((r) => r.channel === "bl"), n)).toBe("Fires fully on Turn right. Fires fully on Forward, except while Turn left is held.");
    expect(describeRow(regular.mix.rows.find((r) => r.channel === "fr"), n)).toBe("Fires fully on Reverse. Fires fully on Turn right, 50% less while Forward is held.");
    expect(describeRow(undefined, n)).toBe("Not wired: no control drives it.");
    const controls = Object.entries(names).map(([id, name]) => ({ id, name }));
    expect(wiringChecks(regular, controls).every((c) => c.ok)).toBe(true);
    // Unwire the back-left thruster: it is named, and forward now turns the ship.
    const b = setRow(regular, "bl", (r) => ({ ...r, lines: [] }));
    const checks = wiringChecks(b, controls).filter((c) => !c.ok).map((c) => c.text);
    expect(checks[0]).toBe("Not wired: Thruster BL");
    expect(checks.some((t) => t.startsWith("Forward also turns the ship"))).toBe(true);
  });
});

describe("measure", () => {
  it("BPD-025 Measure runs the real physics: Thrust 1 gives the design log's 36.1 m/s² forward and 9.8 reverse, turns that mirror, and no broken welds; the estimate is within 2%", async () => {
    const { measureNow, measureKey } = await import("../../src/app/blueprint/measure.ts");
    const rows: Record<string, number>[] = [{ forward: 1 }, { reverse: 1 }, { left: 1 }, { right: 1 }];
    const [f, rv, l, r] = measureNow(bp, rows);
    expect(f.ahead).toBeCloseTo(36.1, 1);
    expect(rv.ahead).toBeCloseTo(-9.8, 1);
    expect(Math.abs(f.turn)).toBeLessThan(0.1);
    expect(l.turn).toBeGreaterThan(8);
    expect(r.turn).toBeCloseTo(-l.turn, 1);
    expect([f, rv, l, r].every((x) => x.broke === 0)).toBe(true);
    const st = stats(bp);
    for (const [i, c] of rows.entries()) {
      const est = response(bp, c, st);
      const got = [f, rv, l, r][i];
      const want = i < 2 ? got.ahead : got.turn;
      expect(Math.abs((i < 2 ? est.ahead : est.turn) - want) / Math.abs(want)).toBeLessThan(0.02);
    }
    // A change to the ship or its wiring is a different measurement.
    expect(measureKey(setParam(bp, "main", "rate", 7))).not.toBe(measureKey(bp));
    expect(measureKey(structuredClone(bp))).toBe(measureKey(bp));
  }, 60_000);
});

describe("mirror", () => {
  it("BPD-027 mirroring Thruster BL, with BR removed, makes BR again: the same outline, welds and wiring, named BR", async () => {
    const { mirrorComponent, removeComponent, channelsOf, worldVertices: wv } = await import("../../src/app/blueprint/model.ts");
    const b = removeComponent(regular, "back-r");
    const r = mirrorComponent(b, "back-l");
    if ("error" in r) throw new Error(r.error);
    const c = component(r.bp, r.id);
    expect(c.label).toBe("Thruster BR");
    const want = component(regular, "back-r").bodies.flatMap((id) => wv(body(regular, id)));
    const got = c.bodies.flatMap((id) => wv(body(r.bp, id)));
    for (const v of want) expect(got.some((g) => Math.hypot(g.x - v.x, g.y - v.y) < 1e-6)).toBe(true);
    // Welded to Tank R by the touch rule: two points along their 0.8 m shared side (the preset's BR has one).
    expect(welds(r.bp).find((w) => w.id === `${r.id}|tank-r` || w.id === `tank-r|${r.id}`)?.joints.length).toBe(2);
    // Its wiring is BR's: turn left, and forward eased by turn right.
    const row = r.bp.mix.rows.find((x) => x.channel === channelsOf(r.bp, r.id)[0])!;
    expect(row.lines).toEqual(regular.mix.rows.find((x) => x.channel === "br")!.lines);
    // It exhausts downward, as the original.
    const h = body(r.bp, c.bodies[0]);
    expect(h.injector!.direction).toEqual(body(regular, "back-l").injector!.direction);
  });

  it("BPD-027 mirroring is refused, with the reason, where the other side is taken or the part is on the middle line", async () => {
    const { mirrorComponent } = await import("../../src/app/blueprint/model.ts");
    expect(mirrorComponent(bp, "tank-l")).toEqual({ error: expect.stringContaining("other side is taken") });
    expect(mirrorComponent(bp, "main")).toEqual({ error: expect.stringContaining("middle line") });
  });
});

describe("only what is welded to the cockpit answers", () => {
  it("BPD-030 a thruster off the ship stops answering: it burns off its own store, held on, and is dead; the rest still answer; the estimate leaves it out", async () => {
    const { measureWorld } = await import("../../src/app/blueprint/measure.ts");
    const { removeWeld, response, wiringChecks } = await import("../../src/app/blueprint/model.ts");
    const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
    const loose = removeWeld(regular, "battery|main");
    const w = measureWorld(loose);
    const profile = getProfile("sandbox");
    stepInPlace(w, [{ type: "control.set", channel: "forward", value: 1 }], profile);
    const main = () => w.bodies.find((b) => b.id === "main")!;
    // At once its line is cut and it is held on, on a channel of its own the controls don't reach.
    expect(main().injector!.channel).toBe("main.residual");
    expect(w.controls["main.residual"]).toBe(1);
    expect(w.links.some((l) => l.kind === "feed" && l.to === "main")).toBe(false);
    // The back pair, still on the ship, answer Forward.
    expect(w.controls.bl).toBe(1);
    for (let i = 0; i < 240; i++) stepInPlace(w, [], profile);
    // Within a second its store is burned: it is dead.
    expect((main().contents ?? []).reduce((m, c) => m + c.mass, 0)).toBeLessThan(1e-4); // of 0.156 kg
    // The estimate and the checks agree.
    expect(response(loose, { forward: 1 }).throttles.main).toBe(0);
    expect(wiringChecks(loose, [{ id: "forward", name: "Forward" }]).map((c) => c.text)).toContain("Not welded to the cockpit, so they won't answer: Main thruster");
  });

  it("BPD-030 a gun knocked off loses its control; with no cockpit nothing answers", async () => {
    const { measureWorld } = await import("../../src/app/blueprint/measure.ts");
    const { removeComponent, removeWeld } = await import("../../src/app/blueprint/model.ts");
    const { getProfile, stepInPlace } = await import("../../src/core/index.ts");
    let b = removeWeld(bp, "gun|hull");
    b = removeWeld(b, "gun|shield");
    const w = measureWorld(b);
    stepInPlace(w, [], getProfile("sandbox"));
    expect(w.links.some((l) => l.kind === "control" && l.to === "gun")).toBe(false);
    const none = measureWorld(removeComponent(bp, "hull"));
    expect(none.mix).toBeUndefined();
  });
});

describe("actions and overlaps", () => {
  it("BPD-034 the actions are named on screen by the largest thing they drive, or the player's own name for them in this ship", async () => {
    const { actionLabel, setLabel, setRow } = await import("../../src/app/blueprint/model.ts");
    expect(["action-a", "action-b", "action-c"].map((c) => actionLabel(bp, c, c))).toEqual(["FIRE", "BEAM", "SHIELD"]);
    // Action A rewired: 30% to the gun, 100% to the shield: it is SHIELD.
    let b = setRow(bp, "fire", (r) => ({ ...r, lines: [{ control: "action-a", weight: 0.3 }] }));
    b = setRow(b, "shield", (r) => ({ ...r, lines: [...r.lines, { control: "action-a", weight: 1 }] }));
    expect(actionLabel(b, "action-a", "A")).toBe("SHIELD");
    // Named by the player; cleared, automatic again; wired to nothing, its own name.
    expect(actionLabel(setLabel(bp, "action-b", "grab"), "action-b", "B")).toBe("GRAB");
    expect(actionLabel(setLabel(setLabel(bp, "action-b", "grab"), "action-b", ""), "action-b", "B")).toBe("BEAM");
    expect(actionLabel(bp, "boost", "Boost")).toBe("BOOST");
  });

  it("BPD-035 components never overlap: the preset's one overlap is found, and an edit that would make a new one is refused", async () => {
    const { allOverlaps, withoutNewOverlaps } = await import("../../src/app/blueprint/model.ts");
    expect(allOverlaps(bp)).toEqual([["gun", "shield"]]);
    const wider = setParam(bp, "tank-l", "width", 1.7);
    const r = withoutNewOverlaps(bp, wider, "tank-l");
    expect(r.bp).toBe(bp);
    expect(r.blocked).toEqual(["gen-l", "mag-l"]);
    // Narrower is fine.
    expect(withoutNewOverlaps(bp, setParam(bp, "tank-l", "width", 1.4), "tank-l").blocked).toEqual([]);
  });
});

describe("Mastodon Gun Ship, double engines, trapezoids and triangles", async () => {
  const { mastodonPreset, partsTemplate, formVertices, allOverlaps, pieces, engines, engineUnits, mirrorComponent, wiringChecks } = await import("../../src/app/blueprint/model.ts");
  const { measureNow } = await import("../../src/app/blueprint/measure.ts");
  const m = mastodonPreset(scn);
  const moves = [{ id: "forward", name: "Forward" }, { id: "reverse", name: "Reverse" }, { id: "left", name: "Turn left" }, { id: "right", name: "Turn right" }];

  it("BPD-038 the Mastodon is Chloe's drawing: 14 parts in one piece, none overlapping, 6.3 × 2.45 m, four railguns fed by two magazines, wired and balanced", () => {
    expect(m.components).toHaveLength(14);
    expect(pieces(m)).toHaveLength(1);
    expect(allOverlaps(m)).toEqual([]);
    const s = stats(m);
    expect([s.width, s.height]).toEqual([6.3, 2.45]);
    expect(Math.abs(s.com.x)).toBeLessThan(1e-9);
    const guns = m.components.filter((c) => c.kind === "weapon").map((c) => c.id);
    expect(guns).toHaveLength(4);
    for (const g of guns) expect(m.ship.links.filter((l) => l.kind === "ammo" && l.to === g)).toHaveLength(2);
    expect(["mag-l", "mag-r"].map((id) => body(m, id).ammo!.count)).toEqual([100, 100]);
    // Each tank holds Thrust's propellant per square metre: the side tanks 0.7875 m², the centre 0.78 m².
    const thrustO2 = body(bp, "tank-l").contents!.find((c) => c.resource === "o2")!.capacity / 1.5;
    for (const [id, area] of [["tank-l", 0.7875], ["tank-r", 0.7875], ["tank-c", 0.78]] as const) expect(body(m, id).contents!.find((c) => c.resource === "o2")!.capacity).toBeCloseTo(thrustO2 * area, 6);
    // Every head and gun has its control link; the wiring checks find nothing wrong.
    for (const b of m.ship.bodies.filter((x) => x.injector || x.magazine)) expect(m.ship.links.some((l) => l.kind === "control" && l.to === b.id)).toBe(true);
    expect(wiringChecks(m, moves).every((c) => c.ok)).toBe(true);
    // Every railgun welds by two points, as Thrust's does.
    for (const g of guns) expect(welds(m).filter((w) => w.a === g || w.b === g).reduce((n, w) => n + w.joints.length, 0)).toBe(2);
  });

  it("BPD-038 a double engine is one part with two heads back to back, each its own channel: the rear pushes forward, the front back", () => {
    const c = component(m, "eng-l");
    expect(c.heads).toEqual(["eng-l", "eng-l-rev"]);
    expect(engineUnits(m, c).map((u) => u.walls.length)).toEqual([2, 2]);
    expect(engines(m).filter((e) => e.id === "eng-l").map((e) => [e.channel, Math.round(e.dir.y)])).toEqual([["eng-l", 1], ["eng-l-rev", -1]]);
    expect(params(m, "eng-l").find((p) => p.key === "rate")?.label).toBe("Flow (burn rate) (each)");
    // A change to it changes both heads, and they stay back to back, welded.
    const deeper = setParam(m, "eng-l", "headHeight", 0.4);
    const [a, b] = ["eng-l", "eng-l-rev"].map((id) => body(deeper, id));
    expect(a.position.y + 0.2).toBeCloseTo(0.7, 6);
    expect(b.position.y - 0.2).toBeCloseTo(0.7, 6);
    expect(deeper.ship.joints.filter((j) => (j.a === a.id && j.b === b.id) || (j.a === b.id && j.b === a.id))).toHaveLength(2);
    const faster = setParam(m, "eng-l", "rate", 6);
    expect(["eng-l", "eng-l-rev"].map((id) => body(faster, id).injector!.rate)).toEqual([6, 6]);
  });

  it("BPD-038 measured: about 31 m/s² forward and back and 9 rad/s² turning, nothing breaking; Action A fires the four guns", () => {
    const r = measureNow(m, [{ forward: 1 }, { reverse: 1 }, { left: 1 }, { "action-a": 1 }]);
    expect(r[0].ahead).toBeGreaterThan(28);
    expect(r[1].ahead).toBeLessThan(-28);
    expect(r[2].turn).toBeGreaterThan(7);
    expect(r[2].turn).toBeLessThan(12);
    expect(r.map((x) => x.broke)).toEqual([0, 0, 0, 0]);
    expect(r[3].ahead).toBeLessThan(-5); // four guns' recoil
  }, 120_000);

  it("BPD-039 trapezoids and triangles: outlines square to the grid at every quarter turn, so they weld; resizing scales what they hold; mirroring turns them the other way", () => {
    for (const turn of [0, 90, 180, 270]) {
      const vs = formVertices({ kind: "trapezoid", base: 1.4, top: 0.7, height: 0.75, turn });
      expect(vs).toHaveLength(4);
      // One side the base (1.4) and one the top (0.7), both along an axis.
      const sides = vs.map((v, i) => [v, vs[(i + 1) % 4]]).filter(([p, q]) => p.x === q.x || p.y === q.y).map(([p, q]) => Math.hypot(q.x - p.x, q.y - p.y));
      expect(sides.sort()).toEqual([0.7, 1.4]);
    }
    const tri = formVertices({ kind: "triangle", base: 0.6, height: 0.6, apex: 0.3, turn: 0 });
    expect(tri).toContainEqual({ x: 0.3, y: 0.3 }); // a right angle over the base's end
    // The side tank, made bigger: it holds more, and still welds to the magazine and the engine.
    const t0 = body(m, "tank-l");
    const big = setParam(m, "tank-l", "fHeight", 0.75);
    expect(body(big, "tank-l").contents![1].capacity).toBeCloseTo(t0.contents![1].capacity, 9);
    const wider = setParam(m, "tank-l", "fTop", 1.05);
    expect(body(wider, "tank-l").contents![1].capacity).toBeGreaterThan(t0.contents![1].capacity);
    expect(welds(wider).filter((w) => w.a === "tank-l" || w.b === "tank-l").length).toBe(2);
    // Mirrored, the left mount becomes a right one, the same outline turned the other way.
    const noR = removeComponent(removeComponent(m, "gun-or"), "mount-r");
    const r = mirrorComponent(noR, "mount-l");
    if ("error" in r) throw new Error(r.error);
    expect(component(r.bp, r.id).form?.turn).toBe(270);
    sameOutline(worldVertices(body(r.bp, component(r.bp, r.id).bodies[0])), worldVertices(body(m, "mount-r")));
    // A triangle from the list is a frame part, with its outline's properties.
    const parts = partsTemplate();
    expect(params(parts, "triangle").map((p) => p.key)).toEqual(expect.arrayContaining(["fBase", "fHeight", "fApex", "fTurn"]));
  });

  it("BPD-040 a part added from the list has its control links, so the wiring reaches it in Try it", () => {
    for (const [tpl, from] of [[m, "eng-l"], [m, "gun-l"], [bp, "back-l"]] as const) {
      const made = instantiate(regular, tpl, from);
      const out = addComponent(regular, made, 30, 0);
      for (const b of made.bodies.filter((x) => x.injector || x.magazine)) {
        const ch = b.injector?.channel ?? b.magazine!.railgun!.channel;
        expect(out.ship.links.some((l) => l.kind === "control" && l.to === b.id && l.channel === ch)).toBe(true);
      }
    }
    // A double engine added keeps a channel for each head.
    const made = instantiate(regular, m, "eng-l");
    expect(made.comp.heads).toHaveLength(2);
    expect(new Set(made.bodies.filter((b) => b.injector).map((b) => b.injector!.channel)).size).toBe(2);
  });
});

describe("turning and resizing parts (§3.6)", async () => {
  const { rotateComponent, resizeComponent, componentAngle, componentSize, place: placeAt2, mastodonPreset } = await import("../../src/app/blueprint/model.ts");
  type BP = typeof bp;
  const box = (id: string, w: number, h: number, x: number, y: number, deg = 0) => ({ id, shape: { kind: "box" as const, width: w, height: h }, mass: 1, position: { x, y }, velocity: { x: 0, y: 0 }, angle: (deg * Math.PI) / 180, angularVelocity: 0 });
  const two = (deg: number, gap = 0): BP => {
    const r = (v: { x: number; y: number }) => ({ x: v.x * Math.cos((deg * Math.PI) / 180) - v.y * Math.sin((deg * Math.PI) / 180), y: v.x * Math.sin((deg * Math.PI) / 180) + v.y * Math.cos((deg * Math.PI) / 180) });
    const p = r({ x: 0, y: 0.75 + gap });
    return { format: 1, id: "t", name: "T", rev: 1, ship: { bodies: [box("a", 1, 1, 0, 0, deg), box("b", 1, 0.5, p.x, p.y, deg)], joints: [], links: [] }, components: [{ id: "a", kind: "frame", label: "A", bodies: ["a"] }, { id: "b", kind: "frame", label: "B", bodies: ["b"] }], mix: { rules: [], rows: [] } };
  };

  it("BPD-041 parts turned to any angle weld where their sides meet, and snap flush to each other's sides", () => {
    for (const deg of [0, 15, 30, 45, 90]) {
      const w = welds(reweld(two(deg), "b"));
      expect(w.map((x) => x.joints.length)).toEqual([2]);
    }
    // 0.1 m apart, at 30°: dragged near, it snaps flush (along the sides' normal) and would weld.
    const apart = two(30, 0.1);
    const b = body(apart, "b");
    const pl = placeAt2(apart, [b], ["b"], 0, 0, { exclude: "b" });
    expect(pl.snapped).toBe(true);
    expect(pl.touches).toEqual(["a"]);
    expect(Math.hypot(pl.dx, pl.dy)).toBeCloseTo(0.1, 5);
  });

  it("BPD-041 turning a part: about its centre, in whole degrees, back where it was after a full turn; its welds re-form", () => {
    let t = regular;
    for (const deg of [90, 180, -90, 0]) {
      t = rotateComponent(t, "battery", deg);
      expect(componentAngle(t, "battery")).toBe(deg);
    }
    expect(body(t, "battery").position).toEqual(body(regular, "battery").position);
    sameOutline(worldVertices(body(t, "battery")), worldVertices(body(regular, "battery")));
    expect(welds(t).filter((w) => w.a === "battery" || w.b === "battery").length).toBe(welds(regular).filter((w) => w.a === "battery" || w.b === "battery").length);
    // The Angle property turns it too; at 15° it no longer meets the main thruster squarely.
    const tilted = setParam(regular, "battery", "angle", 15);
    expect(componentAngle(tilted, "battery")).toBe(15);
    expect(params(tilted, "battery").find((p) => p.key === "angle")?.value).toBe(15);
  });

  it("BPD-042 resizing from a corner keeps the opposite corner where it is, at any angle; what the part holds goes with its area", () => {
    const t = body(regular, "tank-l");
    // Drag the top-right corner: the bottom-left stays.
    const fixed = { x: t.position.x - 0.75, y: t.position.y - 0.5 };
    const big = resizeComponent(regular, "tank-l", 1.8, 1.2, fixed, { x: 1, y: 1 });
    expect(componentSize(big, "tank-l")).toEqual({ w: 1.8, h: 1.2 });
    expect(body(big, "tank-l").position).toEqual({ x: fixed.x + 0.9, y: fixed.y + 0.6 });
    expect(body(big, "tank-l").contents![1].capacity).toBeCloseTo(t.contents![1].capacity * ((1.8 * 1.2) / 1.5), 9);
    // Turned 30°: the corner opposite the one dragged stays put in the ship's frame.
    const turned = rotateComponent(two(0), "b", 30);
    const bb = body(turned, "b");
    const corner = (src: BP, b: typeof bb, i: number, j: number) => {
      const s = componentSize(src, "b");
      const a = b.angle ?? 0;
      const v = { x: (i * s.w) / 2, y: (j * s.h) / 2 };
      return { x: b.position.x + v.x * Math.cos(a) - v.y * Math.sin(a), y: b.position.y + v.x * Math.sin(a) + v.y * Math.cos(a) };
    };
    const keep = corner(turned, bb, -1, -1);
    const grown = resizeComponent(turned, "b", 1.5, 0.8, keep, { x: 1, y: 1 });
    const now = corner(grown, body(grown, "b"), -1, -1);
    expect(Math.hypot(now.x - keep.x, now.y - keep.y)).toBeLessThan(1e-5);
    // A trapezoid resized along its own axes: the Mastodon's side tank, made deeper (its height runs along x).
    const m = mastodonPreset(scn);
    const s0 = componentSize(m, "tank-l");
    const r0 = body(m, "tank-l");
    const deeper = resizeComponent(m, "tank-l", s0.w + 0.25, s0.h, { x: r0.position.x + s0.w / 2, y: r0.position.y }, { x: -1, y: 0 });
    expect(component(deeper, "tank-l").form).toMatchObject({ base: 1.4, top: 0.7, height: 1 });
  });
});
